// GM_DETAIL_CONTENT_BUILDER_V006: collector-only access; existing Builder gate stays derzon-only.
'use strict';
const express=require('express'),crypto=require('crypto'),fs=require('fs'),path=require('path');
const {gmVerifyHash}=require('./GM_MEMBER_PASSWORD');
const {upsertProduct}=require('../services/product/upsert');
const router=express.Router();
const ALLOWED=new Set(['derzon','derzon1287','msoon']);
const COOKIE='__Host-gm_dc';
const SESSION_MS=8*3600000,IDLE_MS=3600000,LEASE_SEC=300;
const sessions=new Map(), failures=new Map();
function db(req){return req.app.locals.pool||req.app.locals.db;}
function response(res,status,error){return res.status(status).set('Cache-Control','no-store').json({ok:false,error});}
function sameOrigin(req){try{const origin=new URL(req.get('origin')||'');return origin.protocol==='https:'&&origin.host===req.get('host');}catch(_){return false;}}
function cookies(req){const m=String(req.get('cookie')||'').match(/(?:^|;\s*)__Host-gm_dc=([a-f0-9]{64})(?:;|$)/);return m&&m[1]||'';}
function hash(t){return crypto.createHash('sha256').update(t).digest('hex');}
function setCookie(res,v,age){res.set('Set-Cookie',`${COOKIE}=${v}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${age}`);}
function session(req){const t=cookies(req);if(!t)return null;const k=hash(t),s=sessions.get(k),now=Date.now();if(!s)return null;if(s.expires<now||now-s.last>IDLE_MS){sessions.delete(k);return null;}s.last=now;return s;}
function clean(v){return String(v==null?'':v).trim();}
function permitted(req,res,next){const s=session(req);if(!s)return response(res,401,'COLLECTOR_LOGIN_REQUIRED');req.collectorAccount=s.id;next();}
function writeSafe(req,res,next){if(!sameOrigin(req))return response(res,403,'ORIGIN_REJECTED');next();}
function page(req,res){const s=session(req);res.set('Cache-Control','no-store');if(!s)return res.sendFile(path.join(__dirname,'../public/detail_collector_login.html'));return res.sendFile(path.join(__dirname,'../public/detail_collector.html'));}
router.get(['/detail_collector.html','/detail_collector.js','/detail_collector_login.html','/public/detail_collector.html','/public/detail_collector.js','/public/detail_collector_login.html'],(req,res)=>res.sendStatus(404));
router.get(['/detail-collector','/detail-collector/'],page);
router.get('/detail-collector/app.js',(req,res)=>{if(!session(req))return res.sendStatus(401);res.set('Cache-Control','no-store').type('js').sendFile(path.join(__dirname,'../public/detail_collector.js'));});
router.get('/api/gm/detail-collector/session',(req,res)=>res.set('Cache-Control','no-store').json({ok:true,account:session(req)?.id||null,allowed:['derzon','derzon1287','msoon']}));
router.post('/api/gm/detail-collector/login',writeSafe,async(req,res)=>{
 const id=clean(req.body?.account),password=typeof req.body?.password==='string'?req.body.password:'';
 if(!ALLOWED.has(id)||!password||password.length>256)return response(res,401,'INVALID_CREDENTIALS');
 const key=String(req.ip||''),now=Date.now(),f=failures.get(key)||{start:now,count:0};
 if(now-f.start>900000){f.start=now;f.count=0;}if(f.count>=5)return response(res,429,'TOO_MANY_ATTEMPTS');
 try{const pool=db(req);if(!pool)return response(res,503,'DB_NOT_READY');
   const r=await pool.query('SELECT password_hash FROM gm_member WHERE member_id=$1 LIMIT 1',[id]);
   if(!r.rows[0]?.password_hash||!(await gmVerifyHash(password,String(r.rows[0].password_hash)))){f.count++;failures.set(key,f);return response(res,401,'INVALID_CREDENTIALS');}
   failures.delete(key);const token=crypto.randomBytes(32).toString('hex');sessions.set(hash(token),{id,expires:now+SESSION_MS,last:now});setCookie(res,token,SESSION_MS/1000);
   return res.set('Cache-Control','no-store').json({ok:true,account:id});
 }catch(e){console.error('[DETAIL_COLLECTOR_AUTH]',e.code||'ERROR');return response(res,503,'AUTH_UNAVAILABLE');}
});
router.post('/api/gm/detail-collector/logout',writeSafe,(req,res)=>{const token=cookies(req);if(token)sessions.delete(hash(token));setCookie(res,'',0);res.json({ok:true});});
router.get('/api/gm/detail-collector/categories',permitted,async(req,res)=>{
 try{const r=await db(req).query("SELECT gm_code,gm_parent_code,name_ko,depth,sort_order FROM gm_category WHERE COALESCE(gm_code,'')<>'' ORDER BY depth,sort_order,gm_code");return res.set('Cache-Control','no-store').json({ok:true,categories:r.rows});}
 catch(e){return response(res,503,'CATEGORY_QUERY_FAILED');}
});
router.get('/api/gm/detail-collector/status',permitted,async(req,res)=>{
 try{const r=await db(req).query("SELECT COUNT(*)::int AS claims,COUNT(*) FILTER (WHERE lease_until>now() AND state='leased')::int AS active,COUNT(*) FILTER (WHERE state='completed')::int AS complete FROM gm_detail_collector_claim");return res.set('Cache-Control','no-store').json({ok:true,account:req.collectorAccount,statistics:r.rows[0]});}
 catch(e){return response(res,503,e.code==='42P01'?'MIGRATION_145_REQUIRED':'STATUS_QUERY_FAILED');}
});
// Atomic lease: same PID can belong to at most one PC while unexpired. No server-side website collection.
router.post('/api/gm/detail-collector/claim',writeSafe,permitted,async(req,res)=>{
 const codes=Array.isArray(req.body?.category_codes)?[...new Set(req.body.category_codes.map(clean).filter(x=>/^[A-Z0-9-]{2,64}$/.test(x)))]:[];
 const client=clean(req.body?.client_id);if(!codes.length||codes.length>19000||!/^[-\w]{8,100}$/.test(client))return response(res,400,'INVALID_SELECTION_OR_CLIENT');
 const pool=db(req),token=crypto.randomBytes(32).toString('hex');
 try{
  // SQL uses the existing category code assignments and ignores already stored detail content.
  const candidates=await pool.query(`SELECT DISTINCT ON (p.product_id) p.product_id,p.item_id,p.vendor_item_id
    FROM gm_product p WHERE p.mall_code='CPKR' AND p.product_id~'^[0-9]{5,}$'
      AND string_to_array(COALESCE(p.glomart_code,''),'|') && $1::text[]
      AND NOT EXISTS(SELECT 1 FROM gm_cpkr_detail_content d WHERE d.product_id=p.product_id)
      AND NOT EXISTS(SELECT 1 FROM gm_detail_collector_claim l WHERE l.product_id=p.product_id AND (l.state='completed' OR (l.state='leased' AND l.lease_until>now())))
    ORDER BY p.product_id,p.product_uid LIMIT 150`,[codes]);
  for(const row of candidates.rows){
   const q=await pool.query(`INSERT INTO gm_detail_collector_claim(product_id,account_id,client_id,token_hash,lease_until,state,updated_at)
    VALUES($1,$2,$3,$4,now()+interval '300 seconds','leased',now())
    ON CONFLICT(product_id) DO UPDATE SET account_id=EXCLUDED.account_id,client_id=EXCLUDED.client_id,
    token_hash=EXCLUDED.token_hash,lease_until=EXCLUDED.lease_until,state='leased',updated_at=now()
    WHERE gm_detail_collector_claim.state<>'completed' AND gm_detail_collector_claim.lease_until<now()
    RETURNING product_id`,[row.product_id,req.collectorAccount,client,hash(token)]);
   if(q.rowCount)return res.set('Cache-Control','no-store').json({ok:true,claim:{...row,lease_token:token,expires_in_seconds:LEASE_SEC}});
  }
  return res.set('Cache-Control','no-store').json({ok:true,claim:null,reason:'NONE_AVAILABLE_IN_BATCH'});
 }catch(e){console.error('[DETAIL_COLLECTOR_CLAIM]',e.code||'ERROR');return response(res,503,e.code==='42P01'?'MIGRATION_145_REQUIRED':'CLAIM_FAILED');}
});
router.post('/api/gm/detail-collector/result',writeSafe,permitted,async(req,res)=>{
 const pid=clean(req.body?.product_id),token=clean(req.body?.lease_token),client=clean(req.body?.client_id),item=req.body?.item;
 if(!/^\d{5,}$/.test(pid)||!item||typeof item!=='object'||Array.isArray(item)||!/^[a-f0-9]{64}$/.test(token))return response(res,400,'INVALID_RESULT');
 if(clean(item.productId||item.product_id)!==pid)return response(res,400,'PID_MISMATCH');
 if(item.partial===true||item.final===false)return response(res,400,'PARTIAL_RESULT');
 const pool=db(req);
 try{
  const r=await pool.query("SELECT 1 FROM gm_detail_collector_claim WHERE product_id=$1 AND account_id=$2 AND client_id=$3 AND token_hash=$4 AND state='leased' AND lease_until>now()",[pid,req.collectorAccount,client,hash(token)]);
  if(!r.rowCount)return response(res,409,'LEASE_EXPIRED_OR_NOT_OWNED');
  const content=[item.detailBlocks,item.detailImages,item.detailTexts,item.detail_blocks,item.detail_images];
  if(!content.some(x=>Array.isArray(x)&&x.length))return response(res,400,'DETAIL_CONTENT_MISSING');
  const outcome=await upsertProduct(pool,{...item,source:'connector-detail-coupang'});
  if(!outcome?.ok)return response(res,422,'UPSERT_FAILED');
  const saved=await pool.query('SELECT 1 FROM gm_cpkr_detail_content WHERE product_id=$1',[pid]);
  if(!saved.rowCount)return response(res,422,'DETAIL_JSON_NOT_SAVED');
  // Do not count a partially saved option set as a completed job.
  const opt=outcome.item?.option_result||{};
  if(opt.error||opt.balance_ok===false||opt.complete_for_count===false)return response(res,422,'OPTION_UPSERT_INCOMPLETE');
  await pool.query("UPDATE gm_detail_collector_claim SET state='completed',lease_until=now(),updated_at=now() WHERE product_id=$1 AND account_id=$2 AND client_id=$3 AND token_hash=$4 AND state='leased'",[pid,req.collectorAccount,client,hash(token)]);
  return res.set('Cache-Control','no-store').json({ok:true,product_id:pid,option_result:opt});
 }catch(e){console.error('[DETAIL_COLLECTOR_RESULT]',e.code||'ERROR');return response(res,503,'RESULT_SAVE_FAILED');}
});
router.post('/api/gm/detail-collector/release',writeSafe,permitted,async(req,res)=>{
 const pid=clean(req.body?.product_id),token=clean(req.body?.lease_token),client=clean(req.body?.client_id);
 if(!/^\d{5,}$/.test(pid)||!/^[a-f0-9]{64}$/.test(token))return response(res,400,'INVALID_LEASE');
 try{await db(req).query("UPDATE gm_detail_collector_claim SET lease_until=now(),state='released',updated_at=now() WHERE product_id=$1 AND account_id=$2 AND client_id=$3 AND token_hash=$4 AND state='leased'",[pid,req.collectorAccount,client,hash(token)]);return res.json({ok:true});}
 catch(_){return response(res,503,'RELEASE_FAILED');}
});
module.exports=router;
