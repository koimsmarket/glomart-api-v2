 'use strict';
// GM_BUILDER_TRANSLATION_V001: manual one-cell online correction only; no automatic loop.
const express=require('express');
const router=express.Router();
const {dbFrom}=require('./core');
const LANGS=['en','zh','vi','ja','tw','th','uz','ne','km','id','tl','mn','my','kk','si','ru','bn','ur','lo','hi','tr','fa','es','fr'];
const DOMAINS={keyword:{table:'gm_keyword_translate',source:['main_keyword_ko','keyword_ko'],prefix:'keyword_'},category:{table:'gm_category',source:['name_ko'],prefix:'name_'},ui:{table:'gm_ui_dictionary',source:['kr'],prefix:''}};
const s=v=>String(v==null?'':v).trim();
const hasKo=v=>/[가-힣]/.test(s(v));
const quote=x=>'"'+x.replace(/"/g,'""')+'"';
let blockedUntil=0, running=false;
async function columns(db,table){const q=await db.query('SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=$1',[table]);return new Set(q.rows.map(x=>x.column_name));}
async function locate(db,type,limit=30){
 const cfg=DOMAINS[type];if(!cfg)throw Error('INVALID_DOMAIN');
 const cols=await columns(db,cfg.table),src=cfg.source.find(c=>cols.has(c));
 if(!src)throw Error('SOURCE_COLUMN_MISSING '+cfg.table);
 const pairs=LANGS.filter(l=>cols.has(cfg.prefix+l)).map(l=>[l,cfg.prefix+l]);
 if(!pairs.length)throw Error('LANGUAGE_COLUMNS_MISSING '+cfg.table);
 const missing=pairs.map(([l,c])=>`NULLIF(BTRIM(${quote(c)}::text),'') IS NULL`).join(' OR ');
 const select=pairs.map(([l,c])=>`${quote(c)} AS ${quote(l)}`).join(',');
 const r=await db.query(`SELECT ctid::text AS row_token, ${quote(src)} AS source_text, ${select} FROM ${quote(cfg.table)} WHERE NULLIF(BTRIM(${quote(src)}::text),'') IS NOT NULL AND (${missing}) ${type==='ui'&&cols.has('active_yn')?"AND active_yn='Y'":''} LIMIT $1`,[Math.max(1,Math.min(100,limit))]);
 return {rows:r.rows.map(x=>({row_token:x.row_token,source_text:x.source_text,missing:pairs.filter(([l])=>!s(x[l])).map(([l])=>l)})),pairs,src};
}
router.get('/api/gm/builder/translation-backfill/status',async(req,res)=>{
 const db=dbFrom(req),result={};
 for(const type of Object.keys(DOMAINS)){try{const v=await locate(db,type,30);result[type]={ok:true,sample:v.rows,total_sample:v.rows.length,limited:true};}catch(e){result[type]={ok:false,error:String(e.message||e)};}}
 res.json({ok:true,domains:result,rate_limit_until:blockedUntil>Date.now()?new Date(blockedUntil).toISOString():null});
});
async function onlineTranslate(ko,lang){
 const tl=lang==='tw'?'zh-TW':lang==='zh'?'zh-CN':lang;
 const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),9000);
 try{
 const url='https://translate.googleapis.com/translate_a/single?client=gtx&sl=ko&tl='+encodeURIComponent(tl)+'&dt=t&q='+encodeURIComponent(ko);
 const r=await fetch(url,{signal:controller.signal});if(r.status===429){const e=Error('HTTP_429');e.is429=true;throw e;}
 if(!r.ok)throw Error('HTTP_'+r.status);
 const j=await r.json();const t=Array.isArray(j&&j[0])?j[0].map(x=>Array.isArray(x)?x[0]||'':'').join('').trim():'';
 if(!t)throw Error('EMPTY_TRANSLATION');
 const tokens=v=>(String(v).match(/%[dsm]/g)||[]).join('|');if(tokens(t)!==tokens(ko))throw Error('PLACEHOLDER_MISMATCH');
 return t;
 }finally{clearTimeout(timeout);}
}
router.post('/api/gm/builder/translation-backfill/one',express.json({limit:'8kb'}),async(req,res)=>{
 // Browser-only same-origin check to reduce cross-site triggering; this is not authentication.
 // Cloudtype/reverse proxies may report req.protocol='http' for a public HTTPS page.
 // Match the browser Origin authority to the incoming Host; never trust forwarded protocol.
 const origin=s(req.get('origin'));const host=s(req.get('host')).toLowerCase();
 let originHost='';try{const parsed=new URL(origin);if(/^https?:$/.test(parsed.protocol))originHost=parsed.host.toLowerCase();}catch(_origin){}
 const fetchSite=s(req.get('sec-fetch-site')).toLowerCase();
 if(!originHost||originHost!==host||(fetchSite&&fetchSite!=='same-origin'&&fetchSite!=='none'))return res.status(403).json({ok:false,error:'SAME_ORIGIN_REQUIRED'});
 if(running)return res.status(409).json({ok:false,error:'TRANSLATION_BUSY'});
 if(Date.now()<blockedUntil)return res.status(429).json({ok:false,error:'HTTP_429_COOLDOWN',retry_after:new Date(blockedUntil).toISOString()});
 const type=s(req.body&&req.body.domain),lang=s(req.body&&req.body.lang),token=s(req.body&&req.body.row_token);
 const cfg=DOMAINS[type];if(!cfg||!LANGS.includes(lang)||!/^[0-9]+,[0-9]+$/.test(token))return res.status(400).json({ok:false,error:'INVALID_SELECTION'});
 running=true;const db=dbFrom(req);
 try{
 const cols=await columns(db,cfg.table),src=cfg.source.find(x=>cols.has(x)),target=cfg.prefix+lang;
 if(!src||!cols.has(target))throw Error('COLUMN_NOT_PRESENT');
 const q=await db.query(`SELECT ${quote(src)} AS ko, ${quote(target)} AS translated ${type==='ui'?', gm_code':''} FROM ${quote(cfg.table)} WHERE ctid=$1::tid LIMIT 1`,[token]);
 const row=q.rows[0];if(!row)throw Error('ROW_CHANGED_RELOAD');
 if(s(row.translated))return res.json({ok:true,skipped:'ALREADY_TRANSLATED'});
 if(!hasKo(row.ko))return res.json({ok:true,skipped:'SOURCE_NOT_KOREAN'});
 const translated=await onlineTranslate(s(row.ko),lang);
 const update=await db.query(`UPDATE ${quote(cfg.table)} SET ${quote(target)}=$1 ${type==='ui'&&cols.has('translation_status')?",translation_status='PARTIAL'":''} WHERE ctid=$2::tid AND ${quote(src)}=$3 AND NULLIF(BTRIM(${quote(target)}::text),'') IS NULL RETURNING ${type==='ui'?'gm_code':'ctid::text AS row_token'}`,[translated,token,row.ko]);
 if(!update.rowCount)return res.json({ok:true,skipped:'CONCURRENTLY_UPDATED'});
 if(type==='ui'){
  try{const ui=require('../../services/ui_dictionary_v2');const foreign=ui.FOREIGN.filter(x=>cols.has(x));const check=await db.query(`SELECT ${foreign.map(quote).join(',')} FROM gm_ui_dictionary WHERE gm_code=$1`,[update.rows[0].gm_code]);const missing=foreign.filter(l=>!s(check.rows[0]&&check.rows[0][l]));await db.query(`UPDATE gm_ui_dictionary SET translation_status=$2 WHERE gm_code=$1`,[update.rows[0].gm_code,missing.length?'PARTIAL':'READY']);}catch(e){console.warn('[BUILDER_TRANSLATION_STATUS]',String(e.message||e));}
  try{require('../../services/ui_dictionary_auto_publish').queue(db);}catch(e){console.warn('[BUILDER_TRANSLATION_PUBLISH]',String(e.message||e));}
 }
 res.json({ok:true,domain:type,lang,source:s(row.ko),translated});
 }catch(e){if(e.is429)blockedUntil=Date.now()+15*60*1000;res.status(e.is429?429:500).json({ok:false,error:String(e.message||e),rate_limit_until:blockedUntil>Date.now()?new Date(blockedUntil).toISOString():null});}
 finally{running=false;}
});

// V002: bounded sequential batch; deliberately no concurrent translation calls.
router.post('/api/gm/builder/translation-backfill/batch',express.json({limit:'8kb'}),async(req,res)=>{
 // Browser-only same-origin check to reduce cross-site triggering; this is not authentication.
 // Cloudtype/reverse proxies may report req.protocol='http' for a public HTTPS page.
 // Match the browser Origin authority to the incoming Host; never trust forwarded protocol.
 const origin=s(req.get('origin'));const host=s(req.get('host')).toLowerCase();
 let originHost='';try{const parsed=new URL(origin);if(/^https?:$/.test(parsed.protocol))originHost=parsed.host.toLowerCase();}catch(_origin){}
 const fetchSite=s(req.get('sec-fetch-site')).toLowerCase();
 if(!originHost||originHost!==host||(fetchSite&&fetchSite!=='same-origin'&&fetchSite!=='none'))return res.status(403).json({ok:false,error:'SAME_ORIGIN_REQUIRED'});
 if(running)return res.status(409).json({ok:false,error:'TRANSLATION_BUSY'});
 if(Date.now()<blockedUntil)return res.status(429).json({ok:false,error:'HTTP_429_COOLDOWN'});
 const type=s(req.body&&req.body.domain),cfg=DOMAINS[type],limit=Math.max(1,Math.min(100,Number(req.body&&req.body.limit)||50));
 if(!cfg)return res.status(400).json({ok:false,error:'INVALID_DOMAIN'});
 running=true;const db=dbFrom(req);let completed=0,skipped=0,failed=0,halted='';
 try{
  const cols=await columns(db,cfg.table),src=cfg.source.find(c=>cols.has(c));
  if(!src)throw Error('SOURCE_COLUMN_MISSING');
  const pairs=LANGS.filter(l=>cols.has(cfg.prefix+l)).map(l=>[l,cfg.prefix+l]);
  if(pairs.length!==LANGS.length)throw Error('LANGUAGE_COLUMNS_INCOMPLETE: '+pairs.length+'/'+LANGS.length);
  // Query row+language candidates directly; only cells that remain empty are selected.
  const predicate=pairs.map(([l,c])=>`NULLIF(BTRIM(${quote(c)}::text),'') IS NULL`).join(' OR ');
  const query=await db.query(`SELECT ctid::text AS row_token, ${quote(src)} AS source_text, ${pairs.map(([l,c])=>quote(c)+' AS '+quote(l)).join(',')} FROM ${quote(cfg.table)} WHERE NULLIF(BTRIM(${quote(src)}::text),'') IS NOT NULL AND (${predicate}) LIMIT $1`,[Math.max(limit,100)]);
  let processed=0;
  outer: for(const row of query.rows){
   if(Date.now()<blockedUntil){halted='HTTP_429_COOLDOWN';break;}
   if(!hasKo(row.source_text)){skipped++;continue;}
   for(const lang of pairs.filter(([l])=>!s(row[l]))){
   if(processed>=limit)break outer;
   processed++;
   const col=lang[1],code=lang[0];
   try{
    const trans=await onlineTranslate(s(row.source_text),code);
    const upd=await db.query(`UPDATE ${quote(cfg.table)} SET ${quote(col)}=$1 WHERE ctid=$2::tid AND ${quote(src)}=$3 AND NULLIF(BTRIM(${quote(col)}::text),'') IS NULL RETURNING ctid`,[trans,row.row_token,row.source_text]);
    if(upd.rowCount)completed++;else skipped++;
   }catch(e){failed++;if(e.is429){blockedUntil=Date.now()+15*60*1000;halted='HTTP_429';break outer;}halted=String(e.message||e);break outer;}
   }
  }
  if(type==='ui'&&completed){
   try{require('../../services/ui_dictionary_auto_publish').queue(db);}catch(e){console.warn('[BUILDER_TRANSLATION_PUBLISH]',String(e.message||e));}
  }
  res.json({ok:true,domain:type,completed,skipped,failed,halted,examined:processed,rate_limit_until:blockedUntil>Date.now()?new Date(blockedUntil).toISOString():null});
 }catch(e){res.status(500).json({ok:false,error:String(e.message||e),completed,skipped,failed});}finally{running=false;}
});

module.exports=router;
