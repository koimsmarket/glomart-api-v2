'use strict';
/* GM_CATEGORY_BATCH_SPECIAL_V020
 * Special category product collection module.
 * V020:
 * - last_search_at is the SPECIAL completion timestamp.
 * - updated_at is only a target freshness filter; recent single-search/category updates are skipped.
 * - one-time migration copies existing created_at -> last_search_at, then never repeats it.
 * - category claims no longer hold a PostgreSQL pool client/advisory lock for the full search.
 * - apply month and top-category order are persisted in gm_runtime_config.
 */
const express=require('express');
const router=express.Router();
const ADMIN_IDS=new Set(['derzon','derzon1287','msoon']);
const control={mode:'STOPPED',batch_date:'',updated_at:null,updated_by:'',command:''};
const CONTROL_CONFIG_KEY='special_category_batch_control';
const APPLY_YM_CONFIG_KEY='special_category_apply_ym';
const ORDER_CONFIG_KEY='special_category_order';
const BACKFILL_CONFIG_KEY='special_category_last_search_backfill_v1';
const DEFAULT_APPLY_YM='2026-08';
const DEFAULT_ORDER=[
 {no:1,prefix:'FD',name:'식품'},
 {no:2,prefix:'HS',name:'생활용품'},
 {no:3,prefix:'KW',name:'주방용품'},
 {no:4,prefix:'BP',name:'뷰티'},
 {no:5,prefix:'FA',name:'패션의류/잡화'}
];
const CLAIM_TTL_MS=10*60*1000;
const CONTROL_MODES=new Set(['RUN','PAUSE','STOPPED']);
let controlLoaded=false;
let controlLoadPromise=null;
const leases=new Map();
let poolRef=null;
const S=v=>String(v==null?'':v).trim();
function pool(req){const p=req.app&&req.app.locals&&req.app.locals.pool;if(!p)throw new Error('DB_POOL_NOT_AVAILABLE');poolRef=p;return p;}
function auth(req,res){const m=S((req.body&&req.body.member_id)||(req.query&&req.query.member_id));if(!ADMIN_IDS.has(m)){res.status(403).json({ok:false,error:'ADMIN_ID_REQUIRED'});return null;}return m;}
function log(tag,o){console.log('[GM_CATEGORY_BATCH_SPECIAL_V020 '+tag+']',JSON.stringify(Object.assign({ts:new Date().toISOString()},o||{})));}
function splitKeywords(v){return [...new Set(S(v).split('/').map(g=>S(g).split('|').map(x=>S(x)).filter(Boolean)[0]||'').filter(Boolean))];}
function categoryPayload(r){if(!r)return null;const source=S(r.keyword)||S(r.name_ko);return Object.assign({},r,{keywords:splitKeywords(source)});}
function NK(v){return S(v).toLowerCase().replace(/\s+/g,'');}
function pairKeyword(canonical,original){const out=[];[canonical,original].forEach(v=>{const t=S(v);if(t&&!out.some(x=>NK(x)===NK(t)))out.push(t);});return out.join('|');}
async function learnedCanonical(c,original){
 const dk=NK(original);if(!dk)return '';
 const dm=await c.query(`SELECT keyword_canonical FROM gm_category_keyword
   WHERE keyword_normalized=$1 AND status IN ('active','confirmed','auto')
   ORDER BY CASE WHEN COALESCE(lang_code,'')='ko' THEN 0 WHEN COALESCE(lang_code,'')='' THEN 1 ELSE 2 END,
            confidence_score DESC NULLS LAST,updated_at DESC NULLS LAST LIMIT 1`,[dk]);
 return S(dm.rows[0]&&dm.rows[0].keyword_canonical);
}
async function syncLearnedCategoryKeywords(lease,opt){
 opt=opt||{};const c=lease&&lease.client;if(!c)return {applied:false,reason:'lease_missing'};
 const qr=await c.query('SELECT category_id,name_ko,keyword FROM gm_category WHERE category_id=$1 LIMIT 1',[lease.category_id]);
 const row=qr.rows[0];if(!row)return {applied:false,reason:'category_missing'};
 const base=S(row.keyword)||S(row.name_ko);const groups=base.split('/').map(x=>S(x)).filter(Boolean);const out=[];const mappings=[];
 for(const group of groups){
  const toks=group.split('|').map(x=>S(x)).filter(Boolean);
  const original=toks.length>=2?toks[1]:(toks[0]||'');
  if(!original){continue;}
  const canonical=(await learnedCanonical(c,original))||original;
  const pair=NK(canonical)!==NK(original)?pairKeyword(canonical,original):group;
  out.push(pair);
  if(NK(canonical)!==NK(original))mappings.push({original,canonical,pair});
 }
 const merged=out.join('/');
 let categoryUpdated=0;
 if(merged&&merged!==S(row.keyword)){const cr=await c.query('UPDATE gm_category SET keyword=$2,updated_at=now() WHERE category_id=$1',[row.category_id,merged]);categoryUpdated=Number(cr.rowCount||0);}
 // 상품 keyword는 스페셜 완료 시 일괄 덮어쓰지 않는다.
 // routes/product.js 공통 UPSERT가 실제로 해당 상품이 잡힌 검색어만 | 로 누적한다.
 // 이렇게 해야 1차 검색에만 나온 상품/2차 검색에만 나온 상품/양쪽에 나온 상품을 정확히 구분한다.
 const productUpdated=0;
 log('KEYWORD_SYNC',{stage:S(opt.stage)||'complete',category_id:row.category_id,before:S(row.keyword),after:merged,mappings,category_updated:categoryUpdated,product_updated:productUpdated});
 return {applied:!!mappings.length,category_id:row.category_id,keyword:merged,mappings,category_updated:categoryUpdated,product_updated:productUpdated};
}
function batchDate(v){const x=S(v);return /^\d{4}-\d{2}-\d{2}$/.test(x)?x:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
function applyYmCutoffIso(v){
 const m=/^(\d{4})-(\d{2})$/.exec(S(v));
 if(!m)return applyYmCutoffIso(DEFAULT_APPLY_YM);
 let y=Number(m[1]),mo=Number(m[2]);
 if(mo<1||mo>12)return applyYmCutoffIso(DEFAULT_APPLY_YM);
 mo+=1;if(mo===13){y+=1;mo=1;}
 return `${String(y).padStart(4,'0')}-${String(mo).padStart(2,'0')}-01T00:00:00.000Z`;
}
function normalizeOrder(v){
 let a=v;
 if(typeof a==='string'){try{a=JSON.parse(a);}catch(_e){a=[];}}
 if(!Array.isArray(a))a=[];
 const seen=new Set(),out=[];
 for(const x of a){
  const no=Number(x&&x.no),prefix=S(x&&x.prefix).toUpperCase().replace(/[^A-Z0-9]/g,''),name=S(x&&x.name);
  if(!Number.isFinite(no)||no<=0||!prefix||seen.has(prefix))continue;
  seen.add(prefix);out.push({no,prefix,name});
 }
 out.sort((a,b)=>a.no-b.no||a.prefix.localeCompare(b.prefix));
 return out.length?out:DEFAULT_ORDER.map(x=>Object.assign({},x));
}
async function ensureSpecialConfig(p){
 await p.query(`INSERT INTO gm_runtime_config(config_key,config_value,value_type,category,mode,enabled,description,updated_at)
  VALUES($1,$2,'STRING','SPECIAL','AUTO',TRUE,$3,now()) ON CONFLICT(config_key) DO NOTHING`,
  [APPLY_YM_CONFIG_KEY,DEFAULT_APPLY_YM,'SPECIAL 카테고리 대상 기준 연월(UTC, YYYY-MM)']);
 await p.query(`INSERT INTO gm_runtime_config(config_key,config_value,value_type,category,mode,enabled,description,updated_at)
  VALUES($1,$2,'JSON','SPECIAL','AUTO',TRUE,$3,now()) ON CONFLICT(config_key) DO NOTHING`,
  [ORDER_CONFIG_KEY,JSON.stringify(DEFAULT_ORDER),'SPECIAL 대분류 처리 번호순']);
}
async function loadSpecialPlan(p){
 await ensureSpecialConfig(p);
 const q=await p.query('SELECT config_key,config_value FROM gm_runtime_config WHERE config_key=ANY($1::text[])',[ [APPLY_YM_CONFIG_KEY,ORDER_CONFIG_KEY] ]);
 const m={};for(const r of q.rows)m[S(r.config_key)]=S(r.config_value);
 const apply_ym=/^\d{4}-\d{2}$/.test(m[APPLY_YM_CONFIG_KEY])?m[APPLY_YM_CONFIG_KEY]:DEFAULT_APPLY_YM;
 const order=normalizeOrder(m[ORDER_CONFIG_KEY]);
 return {apply_ym,cutoff:applyYmCutoffIso(apply_ym),order};
}
async function ensureLastSearchBackfill(p){
 const c=await p.connect();
 try{
  await c.query('BEGIN');
  await c.query("SELECT pg_advisory_xact_lock(hashtext($1))",[BACKFILL_CONFIG_KEY]);
  const done=await c.query('SELECT 1 FROM gm_runtime_config WHERE config_key=$1 LIMIT 1',[BACKFILL_CONFIG_KEY]);
  if(done.rows.length){await c.query('COMMIT');return {applied:false,rows:0};}
  const u=await c.query("UPDATE gm_category SET last_search_at=created_at WHERE UPPER(COALESCE(leaf_yn,''))='Y' AND last_search_at IS NULL AND created_at IS NOT NULL");
  await c.query(`INSERT INTO gm_runtime_config(config_key,config_value,value_type,category,mode,enabled,description,updated_at)
   VALUES($1,$2,'STRING','SPECIAL','FIXED',TRUE,$3,now())`,
   [BACKFILL_CONFIG_KEY,new Date().toISOString(),'V020 최초 1회: 기존 created_at을 last_search_at으로 이관']);
  await c.query('COMMIT');
  log('LAST_SEARCH_BACKFILL',{rows:Number(u.rowCount||0)});
  return {applied:true,rows:Number(u.rowCount||0)};
 }catch(e){try{await c.query('ROLLBACK');}catch(_e){}throw e;}finally{c.release();}
}
function pruneLeases(){
 const now=Date.now();
 for(const [d,l] of leases){if(!l||Number(l.expires_at||0)<=now){leases.delete(d);log('CLAIM_EXPIRE',{device_id:d,category_id:l&&l.category_id});}}
}
function claimedIds(exceptDevice){
 pruneLeases();const s=new Set();
 for(const [d,l] of leases){if(d!==exceptDevice&&l&&l.category_id)s.add(Number(l.category_id));}
 return s;
}

function controlSnapshot(){return {mode:control.mode,batch_date:control.batch_date,updated_at:control.updated_at,updated_by:control.updated_by,command:control.command};}
function applyControlSnapshot(v){
 const x=v&&typeof v==='object'?v:{};
 const mode=S(x.mode).toUpperCase();
 if(CONTROL_MODES.has(mode))control.mode=mode;
 control.batch_date=S(x.batch_date);
 control.updated_at=x.updated_at||null;
 control.updated_by=ADMIN_IDS.has(S(x.updated_by))?S(x.updated_by):'';
 control.command=S(x.command);
}
async function loadControl(p){
 const q=await p.query('SELECT config_value FROM gm_runtime_config WHERE config_key=$1 LIMIT 1',[CONTROL_CONFIG_KEY]);
 if(q.rows.length){
  try{applyControlSnapshot(JSON.parse(S(q.rows[0].config_value)||'{}'));}
  catch(e){log('CONTROL_RESTORE_ERROR',{error:S(e&&e.message||e)});}
 }
 controlLoaded=true;
 log('CONTROL_RESTORE',{found:q.rows.length>0,mode:control.mode,batch_date:control.batch_date,updated_by:control.updated_by,updated_at:control.updated_at});
 return control;
}
async function ensureControl(p){
 if(controlLoaded)return control;
 if(!controlLoadPromise)controlLoadPromise=loadControl(p).catch(e=>{controlLoadPromise=null;throw e;});
 try{return await controlLoadPromise;}finally{if(controlLoaded)controlLoadPromise=null;}
}
async function persistControl(p){
 const snap=controlSnapshot();
 await p.query(`INSERT INTO gm_runtime_config(config_key,config_value,value_type,category,mode,enabled,description,updated_at)
  VALUES($1,$2,'JSON','SPECIAL','FIXED',TRUE,$3,now())
  ON CONFLICT(config_key) DO UPDATE SET config_value=EXCLUDED.config_value,value_type='JSON',category='SPECIAL',mode='FIXED',enabled=TRUE,description=EXCLUDED.description,updated_at=now()`,
  [CONTROL_CONFIG_KEY,JSON.stringify(snap),'SPECIAL 관리자 배치 RUN/PAUSE/STOPPED 및 batch_date 영속 상태']);
 log('CONTROL_PERSIST',{mode:snap.mode,batch_date:snap.batch_date,updated_by:snap.updated_by,updated_at:snap.updated_at});
}

router.get('/api/special/category-batch/control',async(req,res)=>{const m=auth(req,res);if(!m)return;try{const p=pool(req);await ensureControl(p);await ensureLastSearchBackfill(p);const plan=await loadSpecialPlan(p);res.json({ok:true,version:'GM_CATEGORY_BATCH_SPECIAL_V020',control,plan});}catch(e){log('CONTROL_READ_ERROR',{member:m,error:S(e&&e.message||e)});res.status(500).json({ok:false,error:'CONTROL_READ_FAILED'});}});
router.post('/api/special/category-batch/command',async(req,res)=>{const m=auth(req,res);if(!m)return;const p=pool(req);try{await ensureControl(p);await ensureLastSearchBackfill(p);const plan=await loadSpecialPlan(p);const cmd=S(req.body&&req.body.command);if(cmd==='#카테고리 검색#')control.mode='RUN';else if(cmd==='#카테고리 일시정지#')control.mode='PAUSE';else if(cmd==='#카테고리 중지#')control.mode='STOPPED';else return res.status(400).json({ok:false,error:'UNKNOWN_COMMAND'});if(cmd==='#카테고리 검색#')control.batch_date=batchDate(req.body&&req.body.batch_date||control.batch_date);control.updated_at=new Date().toISOString();control.updated_by=m;control.command=cmd;await persistControl(p);log('COMMAND',{member:m,mode:control.mode,batch_date:control.batch_date});res.json({ok:true,control,plan});}catch(e){log('COMMAND_ERROR',{member:m,error:S(e&&e.message||e)});res.status(500).json({ok:false,error:'CONTROL_SAVE_FAILED'});}});

async function release(deviceId,complete,p){
 const l=leases.get(deviceId);if(!l)return null;
 try{
  if(complete)await p.query('UPDATE gm_category SET last_search_at=NOW() WHERE category_id=$1',[l.category_id]);
 }finally{leases.delete(deviceId);}
 return l.category_id;
}
async function refreshLeaseCategory(p,lease){
 if(!lease)return null;
 try{await syncLearnedCategoryKeywords({category_id:lease.category_id,client:p},{products:false,stage:'lease'});}catch(e){log('KEYWORD_SYNC_ERROR',{stage:'lease',category_id:lease.category_id,error:S(e&&e.message||e)});}
 const q=await p.query("SELECT category_id,gm_code,name_ko,keyword,leaf_yn,created_at,updated_at,last_search_at FROM gm_category WHERE category_id=$1 AND UPPER(COALESCE(leaf_yn,''))='Y'",[lease.category_id]);
 return q.rows[0]||null;
}
router.post('/api/special/category-batch/next',async(req,res)=>{
 const m=auth(req,res);if(!m)return;
 const p=pool(req),deviceId=S(req.body&&req.body.device_id);
 if(!deviceId)return res.status(400).json({ok:false,error:'device_id required'});
 try{await ensureControl(p);await ensureLastSearchBackfill(p);}catch(e){log('CONTROL_READ_ERROR',{member:m,stage:'next',error:S(e&&e.message||e)});return res.status(500).json({ok:false,error:'CONTROL_READ_FAILED'});}
 const plan=await loadSpecialPlan(p),bd=batchDate(req.body&&req.body.batch_date||control.batch_date);
 if(control.mode!=='RUN')return res.json({ok:true,state:control.mode,category:null,batch_date:bd,plan});
 pruneLeases();
 if(leases.has(deviceId)){
  const l=leases.get(deviceId);l.expires_at=Date.now()+CLAIM_TTL_MS;
  const r=await refreshLeaseCategory(p,l);
  return res.json({ok:true,state:'LEASED',batch_date:bd,category:categoryPayload(r),plan});
 }
 const prefixes=plan.order.map(x=>x.prefix);
 if(!prefixes.length)return res.json({ok:true,state:'EMPTY',category:null,batch_date:bd,plan});
 const caseSql=plan.order.map((x,i)=>`WHEN gm_code LIKE $${i+3} THEN ${Number(x.no)}`).join(' ');
 const params=[plan.cutoff,prefixes].concat(prefixes.map(x=>x+'-%'));
 const q=await p.query(`SELECT category_id,gm_code,name_ko,keyword,leaf_yn,depth,sort_order,created_at,updated_at,last_search_at
   FROM gm_category
   WHERE COALESCE(name_ko,'')<>''
     AND UPPER(COALESCE(leaf_yn,''))='Y'
     AND split_part(gm_code,'-',1)=ANY($2::text[])
     AND (updated_at IS NULL OR updated_at < $1::timestamptz)
     AND (last_search_at IS NULL OR last_search_at < $1::timestamptz)
   ORDER BY CASE ${caseSql} ELSE 999999 END ASC, depth ASC, sort_order ASC, category_id ASC
   LIMIT 240`,params);
 const claimedNow=claimedIds(deviceId);
 let chosen=null;
 for(const row of q.rows){if(!claimedNow.has(Number(row.category_id))){chosen=row;break;}}
 if(!chosen)return res.json({ok:true,state:'EMPTY',category:null,batch_date:bd,plan});
 const lease={category_id:Number(chosen.category_id),member_id:m,leased_at:Date.now(),expires_at:Date.now()+CLAIM_TTL_MS,apply_ym:plan.apply_ym,cutoff:plan.cutoff};
 leases.set(deviceId,lease);
 log('CLAIM',{device_id:deviceId,category_id:lease.category_id,gm_code:chosen.gm_code,name_ko:chosen.name_ko,apply_ym:plan.apply_ym,cutoff:plan.cutoff,ttl_ms:CLAIM_TTL_MS});
 const refreshed=await refreshLeaseCategory(p,lease);
 return res.json({ok:true,state:'LEASED',batch_date:bd,category:categoryPayload(refreshed||chosen),plan});
});
router.post('/api/special/category-batch/complete',async(req,res)=>{
 const m=auth(req,res);if(!m)return;const p=pool(req);
 const d=S(req.body&&req.body.device_id),id=Number(req.body&&req.body.category_id||0);pruneLeases();const l=leases.get(d);
 if(!l||Number(l.category_id)!==id)return res.status(409).json({ok:false,error:'LEASE_MISMATCH'});
 let keywordSync=null;
 try{keywordSync=await syncLearnedCategoryKeywords({category_id:id,client:p});}catch(e){keywordSync={applied:false,error:S(e&&e.message||e)};log('KEYWORD_SYNC_ERROR',{device_id:d,category_id:id,error:keywordSync.error});}
 await release(d,true,p);
 log('CATEGORY_DONE',{device_id:d,category_id:id,keyword_sync:keywordSync});
 res.json({ok:true,category_id:id,keyword_sync:keywordSync});
});
router.post('/api/special/category-batch/release',async(req,res)=>{const m=auth(req,res);if(!m)return;const p=pool(req);const d=S(req.body&&req.body.device_id),id=await release(d,false,p);res.json({ok:true,category_id:id});});

router.get('/api/special/category-batch/search-state',async(req,res)=>{const m=auth(req,res);if(!m)return;const p=pool(req),kw=S(req.query.keyword),st=S(req.query.started_at),rid=S(req.query.request_id);if(!st||(!kw&&!rid))return res.status(400).json({ok:false,error:'started_at and keyword/request_id required'});let q;if(rid){q=await p.query(`SELECT COUNT(*)::int total,COUNT(*) FILTER(WHERE status='pending')::int pending,COUNT(*) FILTER(WHERE status='processing')::int processing,COUNT(*) FILTER(WHERE status='done')::int done,COUNT(*) FILTER(WHERE status='failed')::int failed,COUNT(DISTINCT mall_code)::int mall_count,ARRAY_REMOVE(ARRAY_AGG(DISTINCT keyword),NULL) keywords,MAX(created_at) last_created_at FROM gm_product_upsert_queue WHERE request_id LIKE $1 AND created_at >= $2::timestamptz`,[rid+'%',st]);}else{q=await p.query(`SELECT COUNT(*)::int total,COUNT(*) FILTER(WHERE status='pending')::int pending,COUNT(*) FILTER(WHERE status='processing')::int processing,COUNT(*) FILTER(WHERE status='done')::int done,COUNT(*) FILTER(WHERE status='failed')::int failed,COUNT(DISTINCT mall_code)::int mall_count,ARRAY_REMOVE(ARRAY_AGG(DISTINCT keyword),NULL) keywords,MAX(created_at) last_created_at FROM gm_product_upsert_queue WHERE keyword=$1 AND created_at >= $2::timestamptz`,[kw,st]);}const x=q.rows[0]||{},last=x.last_created_at?new Date(x.last_created_at).getTime():0,quiet=last?Math.max(0,(Date.now()-last)/1000):0,settled=Number(x.total||0)>0&&Number(x.pending||0)===0&&Number(x.processing||0)===0&&quiet>=5;res.json({ok:true,total:+x.total||0,pending:+x.pending||0,processing:+x.processing||0,done:+x.done||0,failed:+x.failed||0,mall_count:+x.mall_count||0,keywords:x.keywords||[],quiet_sec:Math.round(quiet*10)/10,settled});});

// V019: category SPECIAL no longer owns image-vector queues or workers.
// Keep the old status URL as a harmless compatibility response for older controllers.
router.get('/api/special/category-batch/vector-status',(req,res)=>{
 const m=auth(req,res);if(!m)return;
 res.json({ok:true,detached:true,managed_by:'background/image-vector'});
});

module.exports=router;
