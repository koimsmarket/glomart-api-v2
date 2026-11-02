'use strict';
// V003: complete existing category language cells only; never overwrite translations.
// Admin-only finalization is enforced in routes/builder/admin_reauth.js.
const LANGS=require('../ui/ui_dictionary_v2').FOREIGN;
const quote=s=>'"'+s.replace(/"/g,'""')+'"';
const delays=[1000,2000,3000,5000,8000];
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function langTag(lang){return lang==='tw'?'zh-TW':lang==='zh'?'zh-CN':lang;}
async function columns(db){
 const r=await db.query("SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='gm_category'");
 const cols=new Set(r.rows.map(x=>x.column_name));
 if(!cols.has('name_ko'))throw Error('CATEGORY_SOURCE_COLUMN_MISSING');
 if(LANGS.some(l=>!cols.has('name_'+l)))throw Error('CATEGORY_LANGUAGE_COLUMNS_MISSING');
 return cols;
}
function missingExpr(){return LANGS.map(l=>`NULLIF(BTRIM(${quote('name_'+l)}::text),'') IS NULL`).join(' OR ');}
async function inspect(db){
 await columns(db);
 const r=await db.query(`SELECT COUNT(*)::int AS n FROM gm_category WHERE NULLIF(BTRIM(name_ko),'') IS NOT NULL AND (${missingExpr()})`);
 return Number(r.rows[0].n||0);
}
async function translate(source,lang){
 const ctl=new AbortController(),timeout=setTimeout(()=>ctl.abort(),9000);
 try{
  const url='https://translate.googleapis.com/translate_a/single?client=gtx&sl=ko&tl='+encodeURIComponent(langTag(lang))+'&dt=t&q='+encodeURIComponent(source);
  const r=await fetch(url,{signal:ctl.signal});
  if(!r.ok){const e=Error('HTTP_'+r.status);e.status=r.status;throw e;}
  const j=await r.json(),t=Array.isArray(j&&j[0])?j[0].map(x=>Array.isArray(x)?x[0]||'':'').join('').trim():'';
  if(!t)throw Error('EMPTY_TRANSLATION');
  const tokens=x=>(String(x).match(/%[dsm]/g)||[]).join('|');
  if(tokens(source)!==tokens(t))throw Error('PLACEHOLDER_MISMATCH');
  return t;
 }finally{clearTimeout(timeout);}
}
async function complete(db,progress){
 await columns(db);
 const q=await db.query(`SELECT ctid::text AS row_token, name_ko AS source_text, ${LANGS.map(l=>quote('name_'+l)).join(',')} FROM gm_category WHERE NULLIF(BTRIM(name_ko),'') IS NOT NULL AND (${missingExpr()}) ORDER BY ctid`);
 const jobs=[];
 for(const row of q.rows){for(const lang of LANGS){if(!String(row['name_'+lang]||'').trim())jobs.push({token:row.row_token,source:String(row.source_text),lang});}}
 progress.total.category=jobs.length;progress.done.category=0;progress.failed.category=0;
 // A single memory queue, not parallel 25-language bursts. Successful rows persist in DB.
 for(const job of jobs){
  let translated='',permanent=false;
  for(let i=0;i<delays.length;i++){
   try{translated=await translate(job.source,job.lang);break;}
   catch(e){if(e.status===400||e.status===401||e.status===403){permanent=true;break;}
    if(i+1<delays.length)await pause(delays[i]+Math.floor(Math.random()*300));}
  }
  if(translated){
   await db.query(`UPDATE gm_category SET ${quote('name_'+job.lang)}=$1 WHERE ctid=$2::tid AND name_ko=$3 AND NULLIF(BTRIM(${quote('name_'+job.lang)}::text),'') IS NULL`,[translated,job.token,job.source]);
  }else{progress.failed.category++;}
  progress.done.category++;
  if(!permanent)await pause(300);
 }
 progress.remaining.category=await inspect(db);
 return progress.remaining.category===0;
}
// Category BASE/DELTA ownership remains in the existing asset pack manager.
// This function is called only after both dictionaries pass final missing-cell checks.
async function publish(db){
 const mgr=require('../../asset_pack_manager');
 const cfg=await mgr.config(db);
 const initial=await mgr.versionState(db);
 let result;
 if(!initial.base_started_at){
  const v=Math.max(Number(cfg.category_pack_base_target||0),Number(cfg.category_pack_base_published||0))+1;
  result=await mgr.publishBase(db,v);
 }else{
  const v=Math.max(Number(cfg.category_pack_delta_target||0),Number(cfg.category_pack_delta_published||0))+1;
  result=await mgr.publishDelta(db,v);
 }
 const state=mgr.categoryFileState();
 if(!state.base_files||!state.base_files.ok)throw Error('CATEGORY_BASE_PACK_VERIFY_FAILED');
 if(state.delta_files&&state.delta_files.total&&!state.delta_files.ok)throw Error('CATEGORY_DELTA_PACK_VERIFY_FAILED');
 if(result&&result.state==='NO_CHANGES')return {ok:true,unchanged:true,result,version:state.last_updated_at};
 if(!result||result.files_ready!==mgr.LANGS.length)throw Error('CATEGORY_PACK_PUBLISH_NOT_CONFIRMED');
 return {ok:true,unchanged:false,result,version:state.last_updated_at};
}
module.exports={inspect,complete,publish,LANGS};
