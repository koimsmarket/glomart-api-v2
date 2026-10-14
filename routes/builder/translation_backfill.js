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
 const secret=s(process.env.GM_BUILDER_TRANSLATION_ADMIN_TOKEN);
 if(!secret||s(req.get('x-gm-builder-translation-token'))!==secret)return res.status(403).json({ok:false,error:'ADMIN_TOKEN_REQUIRED'});
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
module.exports=router;
