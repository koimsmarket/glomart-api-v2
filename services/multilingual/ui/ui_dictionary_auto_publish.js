'use strict';
// GM_UI_DICTIONARY_AUTO_V002: runtime-discovered UI phrases only.
// Publication uses a DB-stored content fingerprint; no version churn on repeated visits.
const crypto=require('crypto');
const fs=require('fs');
const path=require('path');
const os=require('os');
const zlib=require('zlib');
// Same writable-temp policy as category packs; never write into /app/public.
const ROOT=path.resolve(process.env.GM_UI_AUTO_PACK_ROOT || path.join(os.tmpdir(),'glomart-ui-dictionary-auto'));
function atomicJSON(file,data){fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=file+'.'+process.pid+'.tmp';fs.writeFileSync(tmp,JSON.stringify(data),'utf8');fs.renameSync(tmp,file);}
function diskPack(lang,version){const file=path.join(ROOT,version,lang+'.json');try{const o=JSON.parse(fs.readFileSync(file,'utf8'));return o&&o.version===version&&o.lang===lang?o:null;}catch(_){return null;}}
function materialize(version,hash,packs){for(const lang of LANGS)atomicJSON(path.join(ROOT,version,lang+'.json'),packs[lang]);atomicJSON(path.join(ROOT,'meta.json'),{ok:true,version,hash,languages:LANGS,count:packs.kr.count});}

const ui=require('./ui_dictionary_v2');
const {LANGS}=ui;
const KEY='gm_ui_dictionary_auto_version';
const HASH='gm_ui_dictionary_auto_hash';
// Durable last-known-good pack: survives ephemeral disk loss and new DB captures.
const SNAPSHOT='gm_ui_dictionary_auto_published_snapshot_v1';
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
// Include the JSON contract in the fingerprint: V017's filtered packs require one new release.
// Subsequent deployments reuse the same hash/version unless dictionary content changes.
function fingerprint(rows){return crypto.createHash('sha256').update('aligned_kr_fallback_v1|').update(JSON.stringify(rows.map(x=>LANGS.map(l=>l==='kr'?[x.gm_code,x.kr]:x[l])))).digest('hex');}
let published=null;
function packSet(rows,version){
 const packs={};for(const lang of LANGS)packs[lang]={type:'ui_dictionary',lang,version,count:rows.length,items:rows.map(x=>({dict_key:x.gm_code,source_text:x.kr,value:lang==='kr'?x.kr:(x[lang]||x.kr)}))};
 return packs;
}

async function savedPackSet(db,version,hash){
 try{
  const raw=await read(db,SNAPSHOT);if(!raw)return null;
  const obj=JSON.parse(zlib.gunzipSync(Buffer.from(raw,'base64')).toString('utf8'));
  if(!obj||obj.version!==version||obj.hash!==hash||!Array.isArray(obj.rows))return null;
  if(fingerprint(obj.rows)!==hash)return null;
  return packSet(obj.rows,version);
 }catch(e){console.warn('[GM_UI_PACK_SNAPSHOT_READ_ERROR]',String(e.message||e));return null;}
}
function validPackSet(packs,version){
 if(!packs||!LANGS.every(l=>packs[l]&&packs[l].version===version&&packs[l].lang===l&&Array.isArray(packs[l].items)))return false;
 const ko=packs.kr.items;
 const keys=ko.map(x=>String(x.dict_key||''));
 if(new Set(keys).size!==keys.length)return false;
 return LANGS.every(l=>packs[l].count===ko.length&&packs[l].items.length===ko.length&&packs[l].items.every((x,i)=>String(x.dict_key||'')===keys[i]&&String(x.source_text||'')===String(ko[i].source_text||'')));
}

function rowsFromPacks(packs){
 const ko=packs.kr.items;
 return ko.map((item,i)=>{
  const row={gm_code:item.dict_key,kr:item.source_text};
  for(const lang of LANGS){if(lang!=='kr')row[lang]=packs[lang].items[i].value;}
  return row;
 });
}
async function persistLegacySnapshot(db,version,hash,packs){
 // Upgrade an existing on-disk legacy release without rewriting its published version.
 // Only byte-identical source data (as proven by the historical fingerprint) qualifies.
 if(!validPackSet(packs,version)||!LANGS.every(l=>packs[l].items.length===packs.kr.items.length))return false;
 const rows=rowsFromPacks(packs);
 if(fingerprint(rows)!==hash)return false;
 const compressed=zlib.gzipSync(Buffer.from(JSON.stringify({version,hash,rows}),'utf8')).toString('base64');
 await set(db,SNAPSHOT,compressed);
 console.log('[GM_UI_PACK_LEGACY_SNAPSHOT_SAVED]',JSON.stringify({version,count:rows.length}));
 return true;
}
async function restorePublished(db,version,hash){
 if(!version||!hash)return null;
 if(published&&published.version===version&&published.hash===hash&&validPackSet(published.packs,version))return published.packs;
 const saved=await savedPackSet(db,version,hash);
 if(saved&&validPackSet(saved,version)){
  materialize(version,hash,saved);published={version,hash,packs:saved};return saved;
 }
 // Before V009, files were the only backup. Promote only a complete, verified
 // on-disk release to a durable snapshot. Never rebuild an old version from
 // today's changed dictionary.
 const disk={};
 if(LANGS.every(l=>{disk[l]=diskPack(l,version);return !!disk[l];})&&validPackSet(disk,version)){
  if(!(await persistLegacySnapshot(db,version,hash,disk))){
   console.warn('[GM_UI_PACK_LEGACY_UNVERIFIED]',version);
   return null;
  }
  published={version,hash,packs:disk};return disk;
 }
 return null;
}

async function publish(db){
 if(running)return {ok:false,error:"ALREADY_PUBLISHING"};running=true;
 try{
  const rows=await snapshot(db);
   const missing=rows.reduce((n,r)=>n+LANGS.filter(l=>!String(r[l]||'').trim()).length,0);
   const hash=fingerprint(rows),prevHash=await read(db,HASH),prev=await read(db,KEY);
  if(prevHash===hash && prev){
   const existing=await rehydrate(db);
   if(!existing.ready)throw Error('EXISTING_UI_PACK_NOT_RECOVERABLE');
   console.log('[GM_UI_PACK_UNCHANGED]',prev);return {ok:true,ready:true,version:prev,unchanged:true};
  }
  const v=versionNow();
  if(prev===v){ // Preserve yyMMdd_HHmm uniqueness: publish once the minute rolls over.
   return {ok:false,error:'VERSION_MINUTE_COLLISION'};
  }
  const packs=packSet(rows,v);
  // Publish all files first, then DB metadata. Rebuilds never change version.
  materialize(v,hash,packs);
  // Persist validated content before switching the public version.
  const compressed=zlib.gzipSync(Buffer.from(JSON.stringify({version:v,hash,rows}),'utf8')).toString('base64');
  await set(db,SNAPSHOT,compressed);
  await set(db,HASH,hash);await set(db,KEY,v);
  published={version:v,hash,packs};
  console.log('[GM_UI_PACK_PUBLISHED]',JSON.stringify({version:v,count:rows.length,languages:LANGS.length,missing,partial:missing>0}));return {ok:true,ready:true,version:v};
 }catch(e){console.error('[GM_UI_PACK_PUBLISH_ERROR]',String(e&&e.message||e));return {ok:false,error:String(e&&e.message||e)};}
 finally{running=false;}
}
function queue(db){ /* GM_UI_AUTO_V002: retain changed DB, publish only after admin finalize. */ pendingDb=db; }
async function current(db){
 const v=await read(db,KEY),hash=await read(db,HASH);
 if(!v||!hash)return {version:v,ready:false};
 let packs=await restorePublished(db,v,hash);
 if(!packs){
  // Pre-V009 published versions can be rebuilt ONLY when the live source is
  // identical to the version hash. Otherwise retain safe Cafe24 fallback.
  const rows=await snapshot(db);
  const liveHash=fingerprint(rows);
  if(liveHash!==hash){
   // A deployment erases temp/. Rebuild a new release from completed DB
   // cells without changing the historical version's contents. Missing cells
   // are simply absent from their language pack, not a global publish blocker.
   const missing=rows.reduce((n,r)=>n+LANGS.filter(l=>!String(r[l]||'').trim()).length,0);
   console.warn('[GM_UI_PACK_RECOVER_NEW_VERSION]',JSON.stringify({previous:v,missing,reason:'SNAPSHOT_MISSING_SOURCE_CHANGED'}));
   const repaired=await publish(db);
   if(!repaired.ok)return {version:v,ready:false};
   return {version:repaired.version,ready:true};
  }
  packs=packSet(rows,v);materialize(v,hash,packs);published={version:v,hash,packs};
  // Upgrade pre-snapshot releases to durable DB storage so the next deploy can
  // regenerate all language files without relying on temp/.
  await persistLegacySnapshot(db,v,hash,packs);
  console.log('[GM_UI_PACK_REBUILT_FROM_DB]',JSON.stringify({version:v,count:rows.length,languages:LANGS.length}));
 }
 if(!LANGS.every(l=>diskPack(l,v))){materialize(v,hash,packs);console.log('[GM_UI_PACK_FILES_RESTORED]',v);}
 return {version:v,ready:true};
}
async function rehydrate(db){
 const m=await current(db);
 if(m.ready)console.log('[GM_UI_PACK_REHYDRATE_DONE]',JSON.stringify({version:m.version,files:LANGS.length,root:ROOT}));
 else console.warn('[GM_UI_PACK_REHYDRATE_DEFER]',JSON.stringify(m));
 return m;
}

async function getPack(db,lang,version){const m=await current(db);if(!m.ready||m.version!==version||!LANGS.includes(lang))return null;return diskPack(lang,version)||published.packs[lang]||null;}
// GM_UI_AUTO_V028: event-only auto-completion. Never run an idle polling timer.
// The existing UI translation engine owns per-phrase retries (up to five attempts).
let autoTimer=null, autoRunning=false, autoAgain=false, autoDb=null;
const autoState={state:'IDLE',reason:'',started_at:null,finished_at:null,remaining:null,version:null,error:null,events:0};
function autoStatus(){return {...autoState,running:autoRunning,scheduled:!!autoTimer,upstream:ui.upstreamStatus()};}
function scheduleAutomation(db,reason){
 if(!db)return;
 autoDb=db;autoState.reason=String(reason||'EVENT');autoState.events++;
 if(autoRunning){autoAgain=true;return;}
 if(autoTimer)clearTimeout(autoTimer);
 autoState.state='SCHEDULED';
 autoTimer=setTimeout(()=>{autoTimer=null;void runAutomation();},1200);
 if(autoTimer.unref)autoTimer.unref();
}
async function runAutomation(){
 if(autoRunning){autoAgain=true;return;}
 autoRunning=true;const db=autoDb,reason=autoState.reason;
 autoState.state='RUNNING';autoState.started_at=new Date().toISOString();autoState.error=null;
 try{
  // Wait only for already queued translation jobs. This is not a perpetual check.
  await ui.whenIdle();
  const pipeline=require('./index');
  const progress={total:{ui:0},done:{ui:0},remaining:{ui:0}};
  const complete=await pipeline.complete(db,progress);
  autoState.remaining=progress.remaining.ui;
  const upstream=ui.upstreamStatus();
  // Compute hash first, so a failed translator never emits a false publish success.
  const rows=await snapshot(db),hash=fingerprint(rows),publishedHash=await read(db,HASH);
  if(hash===publishedHash){
   const old=await current(db);autoState.version=old.version||null;
   autoState.state=upstream.rate_limited?'RATE_LIMITED':'NO_CHANGE';
   autoState.error=upstream.rate_limited?(upstream.last_error||'TRANSLATION_RATE_LIMITED'):null;
   console.warn('[GM_UI_AUTO_NO_NEW_TRANSLATIONS]',JSON.stringify({reason,state:autoState.state,remaining:autoState.remaining,http:upstream.last_http}));
   return;
  }
  // Automatic event may publish verified successful cells; manual 10-row action never does.
  const result=await publish(db);
  if(!result||!result.ok||!result.ready)throw Error('UI_PUBLISH_FAILED '+JSON.stringify(result));
  autoState.version=result.version;
  autoState.state=result.unchanged?'NO_CHANGE':complete?'PUBLISHED':'PARTIAL_PUBLISHED';
  console.log('[GM_UI_AUTO_PUBLISH_RESULT_V031]',JSON.stringify({reason,state:autoState.state,version:result.version,unchanged:!!result.unchanged,remaining:autoState.remaining}));
 }catch(e){autoState.state='ERROR';autoState.error=String(e&&e.message||e);console.error('[GM_UI_AUTO_V028_ERROR]',autoState.error);}
 finally{
  autoState.finished_at=new Date().toISOString();autoRunning=false;
  if(autoAgain){autoAgain=false;scheduleAutomation(autoDb,'NEW_WORD_DURING_RUN');}
 }
}
module.exports={queue,current,getPack,rehydrate,publishCompleted:publish,LANGS,ROOT,scheduleAutomation,autoStatus};
