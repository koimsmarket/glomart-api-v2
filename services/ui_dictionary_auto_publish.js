'use strict';
// GM_UI_DICTIONARY_AUTO_V002: runtime-discovered UI phrases only.
// Publication uses a DB-stored content fingerprint; no version churn on repeated visits.
const crypto=require('crypto');
const fs=require('fs');
const path=require('path');
const os=require('os');
// Same writable-temp policy as category packs; never write into /app/public.
const ROOT=path.resolve(process.env.GM_UI_AUTO_PACK_ROOT || path.join(os.tmpdir(),'glomart-ui-dictionary-auto'));
function atomicJSON(file,data){fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=file+'.'+process.pid+'.tmp';fs.writeFileSync(tmp,JSON.stringify(data),'utf8');fs.renameSync(tmp,file);}
function diskPack(lang,version){const file=path.join(ROOT,version,lang+'.json');try{const o=JSON.parse(fs.readFileSync(file,'utf8'));return o&&o.version===version&&o.lang===lang?o:null;}catch(_){return null;}}
function materialize(version,hash,packs){for(const lang of LANGS)atomicJSON(path.join(ROOT,version,lang+'.json'),packs[lang]);atomicJSON(path.join(ROOT,'meta.json'),{ok:true,version,hash,languages:LANGS,count:packs.kr.count});}

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
  if(prevHash===hash && prev){await rehydrate(db);console.log('[GM_UI_PACK_UNCHANGED]',prev);return;}
  const v=versionNow();
  if(prev===v){ // Preserve yyMMdd_HHmm uniqueness: publish once the minute rolls over.
   const ms=60000-(Date.now()%60000)+250;
   timer=setTimeout(()=>{timer=null;queue(db);},ms);if(timer.unref)timer.unref();return;
  }
  const packs={};
  for(const lang of LANGS){packs[lang]={type:'ui_dictionary',lang,version:v,count:rows.length,items:rows.map(x=>({dict_key:x.gm_code,source_text:x.kr,value:lang==='kr'?x.kr:(x[lang]||x.kr)}))};}
  // Publish all files first, then DB metadata. Rebuilds never change version.
  materialize(v,hash,packs);
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
   materialize(v,hash,packs);
   published={version:v,hash,packs};
 }
 // Files may have disappeared after a Cloudtype redeploy. Never bump version for this.
 if(!LANGS.every(l=>diskPack(l,v))){materialize(v,hash,published.packs);console.log('[GM_UI_PACK_FILES_RESTORED]',v);}
 return {version:v,ready:true};
}
async function rehydrate(db){
 const version=await read(db,KEY),hash=await read(db,HASH);
 if(!version||!hash){console.log('[GM_UI_PACK_REHYDRATE_SKIP] no published version');return {ready:false};}
 const rows=await snapshot(db),actual=fingerprint(rows);
 if(actual!==hash){console.warn('[GM_UI_PACK_REHYDRATE_DEFER] DB changed after publish; retaining published version until next publish');queue(db);return {ready:false};}
 const packs={};
 for(const lang of LANGS)packs[lang]={type:'ui_dictionary',lang,version,count:rows.length,items:rows.map(x=>({dict_key:x.gm_code,source_text:x.kr,value:lang==='kr'?x.kr:(x[lang]||x.kr)}))};
 materialize(version,hash,packs);published={version,hash,packs};
 console.log('[GM_UI_PACK_REHYDRATE_DONE]',JSON.stringify({version,files:LANGS.length,count:rows.length,root:ROOT,db_version_unchanged:true}));
 return {version,ready:true};
}

async function getPack(db,lang,version){const m=await current(db);if(!m.ready||m.version!==version||!LANGS.includes(lang))return null;return diskPack(lang,version)||published.packs[lang]||null;}
module.exports={queue,current,getPack,rehydrate,LANGS,ROOT};
