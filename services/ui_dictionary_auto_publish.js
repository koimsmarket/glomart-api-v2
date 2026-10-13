'use strict';
// GM_UI_DICTIONARY_AUTO_V002: runtime-discovered UI phrases only.
// Publication uses a DB-stored content fingerprint; no version churn on repeated visits.
const crypto=require('crypto');
const ui=require('./ui_dictionary_v2');
const {LANGS}=ui;
const KEY='gm_ui_dictionary_auto_version';
const HASH='gm_ui_dictionary_auto_hash';
let timer=null, running=false, pendingDb=null;
function versionNow(){
 const d=new Date(Date.now()+9*3600000), p=n=>String(n).padStart(2,'0');
 return 'gm_v2_'+p(d.getUTCFullYear()%100)+p(d.getUTCMonth()+1)+p(d.getUTCDate())+'_'+p(d.getUTCHours())+p(d.getUTCMinutes());
}
async function read(db,key){const r=await db.query('SELECT config_value FROM gm_runtime_config WHERE config_key=$1',[key]);return r.rows.length?String(r.rows[0].config_value||''):'';}
async function set(db,key,value){await db.query(`INSERT INTO gm_runtime_config(config_key,config_value,value_type,category,mode,enabled,description,updated_at)
 VALUES($1,$2,'STRING','ASSET','AUTO',TRUE,'UI auto dictionary generated version',now())
 ON CONFLICT(config_key) DO UPDATE SET config_value=EXCLUDED.config_value,updated_at=now()`,[key,value]);}
async function snapshot(db){
 const r=await db.query(`SELECT gm_code,kr,${LANGS.filter(x=>x!=='kr').join(',')} FROM gm_ui_dictionary WHERE active_yn='Y' ORDER BY gm_code`);
 return r.rows||[];
}
function fingerprint(rows){return crypto.createHash('sha256').update(JSON.stringify(rows.map(x=>LANGS.map(l=>l==='kr'?[x.gm_code,x.kr]:x[l])))).digest('hex');}
let published=null;
async function publish(db){
 if(running)return;running=true;
 try{
  const rows=await snapshot(db); const hash=fingerprint(rows),prevHash=await read(db,HASH),prev=await read(db,KEY);
  if(prevHash===hash && prev){console.log('[GM_UI_PACK_UNCHANGED]',prev);return;}
  const v=versionNow();
  if(prev===v){ // Preserve yyMMdd_HHmm uniqueness: publish once the minute rolls over.
   const ms=60000-(Date.now()%60000)+250;
   timer=setTimeout(()=>{timer=null;queue(db);},ms);if(timer.unref)timer.unref();return;
  }
  const packs={};
  for(const lang of LANGS){packs[lang]={type:'ui_dictionary',lang,version:v,count:rows.length,items:rows.map(x=>({dict_key:x.gm_code,source_text:x.kr,value:lang==='kr'?x.kr:(x[lang]||x.kr)}))};}
  // Persist metadata only after every language's JSON has been generated in memory.
  await set(db,KEY,v);await set(db,HASH,hash);
  published={version:v,hash,packs};
  console.log('[GM_UI_PACK_PUBLISHED]',JSON.stringify({version:v,count:rows.length,languages:LANGS.length}));
 }catch(e){console.error('[GM_UI_PACK_PUBLISH_ERROR]',String(e&&e.message||e));}
 finally{running=false;}
}
function queue(db){pendingDb=db;if(timer)return;timer=setTimeout(()=>{timer=null;publish(pendingDb);},300);if(timer.unref)timer.unref();}
async function current(db){
 const v=await read(db,KEY),hash=await read(db,HASH);
 if(!published||published.version!==v||published.hash!==hash){
   const rows=await snapshot(db),actual=fingerprint(rows);
   if(!v||!hash||actual!==hash){queue(db);return {version:v,ready:false};}
   const packs={};for(const lang of LANGS)packs[lang]={type:'ui_dictionary',lang,version:v,count:rows.length,items:rows.map(x=>({dict_key:x.gm_code,source_text:x.kr,value:lang==='kr'?x.kr:(x[lang]||x.kr)}))};
   published={version:v,hash,packs};
 }
 return {version:v,ready:true};
}
async function getPack(db,lang,version){const m=await current(db);if(!m.ready||m.version!==version)return null;return published.packs[lang]||null;}
module.exports={queue,current,getPack,LANGS};
