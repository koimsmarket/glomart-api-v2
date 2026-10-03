'use strict';
/* GM_ASSET_PACK_MANAGER_V007_STANDALONE_CATEGORY_ROOT
 * Category client sync contract:
 *   base_started_at : YYYYMMDD_HHMM of current base
 *   last_updated_at : YYYYMMDD_HHMM of latest published cumulative delta
 */
const fs=require('fs');
const path=require('path');
const os=require('os');
const categoryHnsw=require('./category_hnsw_pack');
const LANGS=['kr','en','vi','zh','ja','tw','th','uz','ne','km','id','tl','mn','my','kk','si','ru','bn','ur','lo','hi','tr','fa','es','fr'];
const COL={kr:'name_ko',en:'name_en',vi:'name_vi',zh:'name_zh',ja:'name_ja',tw:'name_tw',th:'name_th',uz:'name_uz',ne:'name_ne',km:'name_km',id:'name_id',tl:'name_tl',mn:'name_mn',my:'name_my',kk:'name_kk',si:'name_si',ru:'name_ru',bn:'name_bn',ur:'name_ur',lo:'name_lo',hi:'name_hi',tr:'name_tr',fa:'name_fa',es:'name_es',fr:'name_fr'};
// Category packs are runtime-generated assets. Never write them under /app/public.
// Cloudtype deploy image may expose /app as read-only. Keep category packs in one
// dedicated writable folder. GM_CATEGORY_PACK_ROOT can point at a mounted/persistent
// volume; otherwise use the container temp area so generation works immediately.
const CATEGORY_ROOT=path.resolve(process.env.GM_CATEGORY_PACK_ROOT || path.join(os.tmpdir(),'glomart-category-pack'));
const UI_ROOT=path.join(__dirname,'..','public','data','gm-assets','ui');
const PRIVATE_ROOT=path.join(CATEGORY_ROOT,'_state');
const BASE_SNAPSHOT_FILE=path.join(PRIVATE_ROOT,'category_base_snapshot.json');
let poolRef=null,timer=null,pumping=false;
let lastState={state:'IDLE',running:false,last_error:'',last_run_at:null,last_result:null};
function s(v){return String(v==null?'':v).trim();}
function n(v,d=0){const x=Number(v);return Number.isFinite(x)?Math.trunc(x):d;}
function mkdirp(p){fs.mkdirSync(p,{recursive:true});}
function writeJson(file,obj){mkdirp(path.dirname(file));const tmp=file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(obj),'utf8');fs.renameSync(tmp,file);}
function readJson(file,fallback){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch(_e){return fallback;}}
function kstParts(){const d=new Date(Date.now()+9*60*60*1000);const yy=String(d.getUTCFullYear()),mo=String(d.getUTCMonth()+1).padStart(2,'0'),da=String(d.getUTCDate()).padStart(2,'0'),hh=String(d.getUTCHours()).padStart(2,'0'),mi=String(d.getUTCMinutes()).padStart(2,'0');return {token:yy+mo+da+'_'+hh+mi,hhmm:hh+':'+mi,iso:new Date().toISOString()};}
function inWindow(now,start,end){if(start===end)return true;if(start<end)return now>=start&&now<end;return now>=start||now<end;}
async function ensureDefaults(db){
  const rows=[
    ['asset_pack_background_mode','AUTO','STRING','ASSET','AUTO','정적 자산팩 자동 생성: OFF/AUTO/ON'],
    ['asset_pack_auto_start','00:00','STRING','ASSET','AUTO','카테고리/UI 사전 자동 생성 시작시간 KST'],
    ['asset_pack_auto_end','08:00','STRING','ASSET','AUTO','카테고리/UI 사전 자동 생성 종료시간 KST'],
    ['category_pack_base_target','1','VERSION','ASSET','FIXED','카테고리 기준본 내부 순번(legacy 호환)'],
    ['category_pack_base_published','0','VERSION','ASSET','FIXED','카테고리 기준본 배포 내부 순번(legacy 호환)'],
    ['category_pack_delta_target','0','VERSION','ASSET','FIXED','카테고리 누적본 내부 순번(legacy 호환)'],
    ['category_pack_delta_published','0','VERSION','ASSET','FIXED','카테고리 누적본 배포 내부 순번(legacy 호환)'],
    ['category_pack_base_started_at','','STRING','ASSET','FIXED','카테고리 기준본 시작시각 YYYYMMDD_HHMM'],
    ['category_pack_last_updated_at','','STRING','ASSET','FIXED','카테고리 최종 업데이트시각 YYYYMMDD_HHMM'],
    ['ui_dictionary_target','1','VERSION','ASSET','FIXED','관리자가 요청한 UI 사전 배포 버전'],
    ['ui_dictionary_published','0','VERSION','ASSET','FIXED','실제 생성 완료된 UI 사전 배포 버전']
  ];
  for(const x of rows){await db.query(`INSERT INTO gm_runtime_config(config_key,config_value,value_type,category,mode,enabled,description,updated_at) VALUES($1,$2,$3,$4,$5,TRUE,$6,now()) ON CONFLICT(config_key) DO NOTHING`,x);}
}
async function versionState(db){const c=await config(db),meta=categoryMeta(),base=s(c.category_pack_base_started_at||meta.base_started_at),updated=s(c.category_pack_last_updated_at||meta.last_updated_at||base);let baseCount=0,lastDeltaCount=0;try{if(base){const bp=readJson(path.join(CATEGORY_ROOT,'base',base,'kr.json'),null);baseCount=n(bp&&bp.count,0);}if(base&&updated&&updated!==base){const dp=readJson(path.join(CATEGORY_ROOT,'delta',updated,'kr.json'),null);lastDeltaCount=n(dp&&dp.count,0);}}catch(_e){}return {base_started_at:base,last_updated_at:updated,base_category_count:baseCount,last_delta_count:lastDeltaCount};}
async function pendingRows(db,limit=200){try{const r=await db.query(`SELECT pending_id,gm_code,change_kind,source_mall,cp_code,parent_gm_code,parent_cp_code,name_ko,depth,status,first_seen_at,last_seen_at,published_at FROM gm_category_pack_pending ORDER BY CASE status WHEN 'PENDING' THEN 0 ELSE 1 END,last_seen_at DESC LIMIT $1`,[Math.max(1,Math.min(1000,n(limit,200)))]);return r.rows||[];}catch(e){if(e&&e.code==='42P01')return [];throw e;}}
async function pendingCount(db){try{const r=await db.query(`SELECT count(*)::int AS c FROM gm_category_pack_pending WHERE status='PENDING'`);return n(r.rows[0]&&r.rows[0].c);}catch(e){if(e&&e.code==='42P01')return 0;throw e;}}
async function config(db){await ensureDefaults(db);const r=await db.query(`SELECT config_key,config_value FROM gm_runtime_config WHERE config_key LIKE 'asset_pack_%' OR config_key LIKE 'category_pack_%' OR config_key LIKE 'ui_dictionary_%'`);const m={};for(const x of r.rows)m[x.config_key]=s(x.config_value);return m;}
async function setConfig(db,key,value){await db.query(`UPDATE gm_runtime_config SET config_value=$2,updated_at=now() WHERE config_key=$1`,[key,String(value)]);}
function parentCode(code,depth){const a=s(code).toUpperCase().split('-');if(depth<=0||!a.length)return '';for(let i=depth;i<a.length;i++)a[i]='0'.repeat(Math.max(1,String(a[i]||'').length));return a.join('-');}
function rowCore(r){const code=s(r.gm_code).toUpperCase(),depth=n(r.depth);return {gm_code:code,parent_code:parentCode(code,depth),depth,leaf_yn:s(r.leaf_yn).toUpperCase()||'N',display_yn:s(r.display_yn).toUpperCase()||'Y',sort_order:n(r.sort_order),keyword:s(r.keyword)||s(r.keyword_seed)||s(r.name_ko),name_ko:s(r.name_ko)};}
function localized(r,lang){const core=rowCore(r),col=COL[lang]||'name_ko';return Object.assign(core,{name:s(r[col])||s(r.name_ko)});}
function signature(r){const o={};for(const k of ['gm_code','depth','leaf_yn','display_yn','sort_order','keyword','keyword_seed','name_ko',...Object.values(COL)])o[k]=r[k]==null?'':r[k];return JSON.stringify(o);}
async function categoryRows(db){const cols=['gm_code','depth','leaf_yn','display_yn','sort_order','keyword','keyword_seed','name_ko',...Array.from(new Set(Object.values(COL)))];const q=await db.query(`SELECT ${cols.join(',')} FROM gm_category WHERE COALESCE(display_yn,'Y')='Y' ORDER BY depth,COALESCE(sort_order,2147483647),category_id`);return q.rows||[];}
function categoryMeta(){return readJson(path.join(CATEGORY_ROOT,'meta.json'),{base_started_at:'',last_updated_at:'',base_version:0,delta_versions:[],updated_at:null,languages:LANGS});}
function packFiles(kind,token){const root=path.join(CATEGORY_ROOT,kind,token);return LANGS.map(lang=>path.join(root,lang+'.json'));}
function hnswFile(token){return path.join(CATEGORY_ROOT,'hnsw',token,'index.json');}
function hnswState(token){const file=token?hnswFile(token):'';if(!file||!fs.existsSync(file))return {ok:false,version:s(token),count:0,bytes:0};const j=readJson(file,null);return {ok:!!(j&&j.graph&&Array.isArray(j.codes)&&n(j.count,-1)===j.codes.length),version:s(token),count:n(j&&j.count,0),bytes:fs.statSync(file).size};}
function publishHnsw(rows,token,baseToken,legacyV){const pack=categoryHnsw.build(rows,token,baseToken);writeJson(hnswFile(token),pack);if(n(legacyV)>0)writeJson(path.join(CATEGORY_ROOT,'hnsw','v'+n(legacyV),'index.json'),pack);const st=hnswState(token);if(!st.ok||st.count!==pack.count){const e=new Error('CATEGORY_HNSW_VERIFY_FAILED '+JSON.stringify(st));e.code='HNSW_VERIFY';throw e;}return st;}
function verifyPack(kind,token,expectedCount){const files=packFiles(kind,token),missing=[],bad=[];for(const f of files){if(!fs.existsSync(f)){missing.push(path.basename(f));continue;}const j=readJson(f,null);if(!j||!Array.isArray(j.items)||n(j.count,-1)!==n(expectedCount,-2))bad.push(path.basename(f));}return {ok:missing.length===0&&bad.length===0,total:LANGS.length,ready:LANGS.length-missing.length-bad.length,missing,bad};}
function categoryFileState(){const meta=categoryMeta(),base=s(meta.base_started_at),updated=s(meta.last_updated_at),baseCheck=base?verifyPack('base',base,n(readJson(path.join(CATEGORY_ROOT,'base',base,'kr.json'),{}).count,0)):{ok:false,total:LANGS.length,ready:0,missing:LANGS.map(x=>x+'.json'),bad:[]};let deltaCheck={ok:true,total:0,ready:0,missing:[],bad:[]};if(base&&updated&&updated!==base){const kr=readJson(path.join(CATEGORY_ROOT,'delta',updated,'kr.json'),{});deltaCheck=verifyPack('delta',updated,n(kr.count,0));}return {base_started_at:base,last_updated_at:updated,base_files:baseCheck,delta_files:deltaCheck,hnsw:hnswState(s(meta.hnsw_version||updated||base))};}
async function publishBase(db,version){
  const rows=await categoryRows(db),legacyV=n(version),tm=kstParts(),baseToken=tm.token;
  const targetDir=path.join(CATEGORY_ROOT,'base',baseToken);
  if(fs.existsSync(targetDir)){const e=new Error('CATEGORY_BASE_ALREADY_EXISTS_THIS_MINUTE');e.code='SAME_MINUTE';throw e;}
  for(const lang of LANGS){
    const pack={type:'base',base_started_at:baseToken,last_updated_at:baseToken,legacy_version:legacyV,lang,count:rows.length,items:rows.map(r=>localized(r,lang))};
    writeJson(path.join(targetDir,lang+'.json'),pack);
    if(legacyV>0)writeJson(path.join(CATEGORY_ROOT,'base','v'+legacyV,lang+'.json'),pack);
  }
  const check=verifyPack('base',baseToken,rows.length);
  if(!check.ok){const e=new Error('CATEGORY_BASE_25LANG_VERIFY_FAILED '+JSON.stringify(check));e.code='PACK_VERIFY';throw e;}
  const hnsw=publishHnsw(rows,baseToken,baseToken,legacyV);
  const snap={base_started_at:baseToken,legacy_version:legacyV,rows:{}};
  for(const r of rows)snap.rows[s(r.gm_code).toUpperCase()]={sig:signature(r),row:r};
  writeJson(BASE_SNAPSHOT_FILE,snap);
  writeJson(path.join(CATEGORY_ROOT,'meta.json'),{base_started_at:baseToken,last_updated_at:baseToken,hnsw_version:baseToken,hnsw_count:hnsw.count,base_version:legacyV,delta_versions:[],updated_at:tm.iso,languages:LANGS,base_files:check.ready});
  await setConfig(db,'category_pack_base_started_at',baseToken);
  await setConfig(db,'category_pack_last_updated_at',baseToken);
  try{await db.query(`UPDATE gm_category_pack_pending SET status='PUBLISHED',published_at=now(),updated_at=now() WHERE status='PENDING'`);}catch(e){if(!(e&&e.code==='42P01'))throw e;}
  await setConfig(db,'category_pack_base_published',legacyV);
  return {kind:'category_base',base_started_at:baseToken,last_updated_at:baseToken,hnsw_version:baseToken,hnsw_count:hnsw.count,hnsw_bytes:hnsw.bytes,version:legacyV,count:rows.length,languages:LANGS.length,files_ready:check.ready};
}
async function publishDelta(db,version){
  const current=await categoryRows(db),snap=readJson(BASE_SNAPSHOT_FILE,null),legacyV=n(version),tm=kstParts();
  if(!snap||!snap.rows||!s(snap.base_started_at)){const e=new Error('CATEGORY_BASE_NOT_READY');e.code='BASE_NOT_READY';throw e;}
  const c0=await config(db),vs={base_started_at:s(c0.category_pack_base_started_at),last_updated_at:s(c0.category_pack_last_updated_at)};
  const curMap=new Map(current.map(r=>[s(r.gm_code).toUpperCase(),r])),changes=[];
  for(const r of current){const code=s(r.gm_code).toUpperCase(),old=snap.rows[code];if(!old||old.sig!==signature(r))changes.push({op:'upsert',row:r});}
  for(const code of Object.keys(snap.rows))if(!curMap.has(code))changes.push({op:'delete',gm_code:code});
  if(!changes.length){
    const stableToken=s(vs.last_updated_at)||s(snap.base_started_at),existingHnsw=hnswState(stableToken);
    if(stableToken&&!existingHnsw.ok){
      // Existing category-pack deployments may predate HNSW. Build only HNSW for the
      // current full category state without changing base/delta version timestamps.
      const legacyCurrent=n(c0.category_pack_delta_published,0)||n(c0.category_pack_base_published,0),hnsw=publishHnsw(current,stableToken,s(snap.base_started_at),legacyCurrent),meta0=categoryMeta();
      writeJson(path.join(CATEGORY_ROOT,'meta.json'),Object.assign({},meta0,{base_started_at:s(meta0.base_started_at||snap.base_started_at),last_updated_at:stableToken,hnsw_version:stableToken,hnsw_count:hnsw.count,updated_at:tm.iso,languages:LANGS}));
      return {kind:'category_delta',state:'NO_CHANGES',hnsw_rebuilt:true,base_started_at:s(snap.base_started_at),last_updated_at:stableToken,hnsw_version:stableToken,hnsw_count:hnsw.count,hnsw_bytes:hnsw.bytes,version:n(c0.category_pack_delta_published,0),count:0,languages:LANGS.length,files_ready:0};
    }
    return {kind:'category_delta',state:'NO_CHANGES',hnsw_rebuilt:false,base_started_at:s(snap.base_started_at),last_updated_at:stableToken,hnsw_version:s(categoryMeta().hnsw_version||''),hnsw_count:n(categoryMeta().hnsw_count,0),version:n(c0.category_pack_delta_published,0),count:0,languages:LANGS.length,files_ready:0};
  }
  const baseToken0=s(snap.base_started_at)||s(vs.base_started_at);if(tm.token===baseToken0||tm.token===s(vs.last_updated_at)){const e=new Error('CATEGORY_PACK_SAME_MINUTE_PUBLISH_BLOCKED');e.code='SAME_MINUTE';throw e;}
  const updateToken=tm.token,baseToken=s(snap.base_started_at)||s(vs.base_started_at),targetDir=path.join(CATEGORY_ROOT,'delta',updateToken);
  if(fs.existsSync(targetDir)){const e=new Error('CATEGORY_DELTA_ALREADY_EXISTS_THIS_MINUTE');e.code='SAME_MINUTE';throw e;}
  for(const lang of LANGS){
    const items=changes.map(x=>x.op==='delete'?{op:'delete',gm_code:x.gm_code}:{op:'upsert',item:localized(x.row,lang)});
    const pack={type:'delta',base_started_at:baseToken,last_updated_at:updateToken,legacy_version:legacyV,lang,count:items.length,items};
    writeJson(path.join(targetDir,lang+'.json'),pack);
    if(legacyV>0)writeJson(path.join(CATEGORY_ROOT,'delta','v'+legacyV,lang+'.json'),pack);
  }
  const check=verifyPack('delta',updateToken,changes.length);
  if(!check.ok){const e=new Error('CATEGORY_DELTA_25LANG_VERIFY_FAILED '+JSON.stringify(check));e.code='PACK_VERIFY';throw e;}
  // HNSW always represents the full current category set, never only the delta rows.
  const hnsw=publishHnsw(current,updateToken,baseToken,legacyV);
  const meta0=categoryMeta(),ds=Array.from(new Set([...(meta0.delta_versions||[]).map(Number),legacyV])).filter(x=>x>0).sort((a,b)=>a-b);
  writeJson(path.join(CATEGORY_ROOT,'meta.json'),{base_started_at:baseToken,last_updated_at:updateToken,hnsw_version:updateToken,hnsw_count:hnsw.count,base_version:n(meta0.base_version||snap.legacy_version),delta_versions:ds,updated_at:tm.iso,languages:LANGS,base_files:LANGS.length,delta_files:check.ready});
  if(!s(c0.category_pack_base_started_at))await setConfig(db,'category_pack_base_started_at',baseToken);
  await setConfig(db,'category_pack_last_updated_at',updateToken);
  try{await db.query(`UPDATE gm_category_pack_pending SET status='PUBLISHED',published_at=now(),updated_at=now() WHERE status='PENDING'`);}catch(e){if(!(e&&e.code==='42P01'))throw e;}
  await setConfig(db,'category_pack_delta_published',legacyV);
  return {kind:'category_delta',state:'PUBLISHED',base_started_at:baseToken,last_updated_at:updateToken,hnsw_version:updateToken,hnsw_count:hnsw.count,hnsw_bytes:hnsw.bytes,version:legacyV,count:changes.length,cumulative_since_base:true,languages:LANGS.length,files_ready:check.ready};
}
async function publishUi(db,version){const q=await db.query(`SELECT gm_code AS dict_key, kr AS source_text, kr AS source_value FROM gm_ui_dictionary ORDER BY gm_code`);const items=(q.rows||[]).map(x=>({dict_key:s(x.dict_key),source_text:s(x.source_text),value:s(x.source_value)})),v=n(version);writeJson(path.join(UI_ROOT,'ko','v'+v+'.json'),{type:'ui_dictionary',lang:'ko',version:v,count:items.length,items});writeJson(path.join(UI_ROOT,'meta.json'),{version:v,updated_at:new Date().toISOString(),lang:'ko',count:items.length});await setConfig(db,'ui_dictionary_published',v);return {kind:'ui_dictionary',version:v,count:items.length};}
async function runPending(db,force=false){
  const c=await config(db),mode=s(c.asset_pack_background_mode||'AUTO').toUpperCase();if(!force){if(mode==='OFF')return {state:'OFF'};if(mode==='AUTO'&&!inWindow(kstParts().hhmm,c.asset_pack_auto_start||'00:00',c.asset_pack_auto_end||'08:00'))return {state:'AUTO_TIME_WAIT'};}
  const results=[],bt=n(c.category_pack_base_target,1),bp=n(c.category_pack_base_published,0),ut=n(c.ui_dictionary_target,1),up=n(c.ui_dictionary_published,0);let baseMade=false;
  if(bt>bp){results.push(await publishBase(db,bt));baseMade=true;}
  const pc=await pendingCount(db),c2=await config(db),dt=n(c2.category_pack_delta_target,0),dp=n(c2.category_pack_delta_published,0);
  // BASE를 만든 같은 실행에서는 DELTA를 만들지 않는다. BASE 자체가 현재 카테고리 전체를 포함한다.
  if(!baseMade&&(pc>0||dt>dp)){
    let v=dt;if(!(dt>dp)){const r=await db.query(`UPDATE gm_runtime_config SET config_value=(COALESCE(NULLIF(config_value,''),'0')::bigint+1)::text,updated_at=now() WHERE config_key='category_pack_delta_target' RETURNING config_value`);v=n(r.rows[0].config_value);}
    const dr=await publishDelta(db,v);results.push(dr);
    // 수동/자동으로 요청 순번만 올라갔지만 실제 변경이 없으면 시간 버전은 유지하고 내부 요청만 소진한다.
    if(dr&&dr.state==='NO_CHANGES'&&dt>dp)await setConfig(db,'category_pack_delta_published',dt);
  }
  if(ut>up)results.push(await publishUi(db,ut));return {state:results.length?'PUBLISHED':'NO_PENDING',results};
}
async function pump(){if(!poolRef||pumping)return;pumping=true;lastState.running=true;try{const r=await runPending(poolRef,false);lastState.state=r.state;lastState.last_result=r;lastState.last_error='';lastState.last_run_at=new Date().toISOString();}catch(e){lastState.state='ERROR';lastState.last_error=String(e&&e.stack||e);}finally{lastState.running=false;pumping=false;}}
function ensureStarted(pool){if(pool)poolRef=pool;if(timer||!poolRef)return;timer=setInterval(()=>pump().catch(()=>{}),60000);if(timer.unref)timer.unref();setTimeout(()=>pump().catch(()=>{}),2000);}
function status(){return Object.assign({},lastState);}
module.exports={LANGS,ensureDefaults,versionState,pendingRows,pendingCount,config,status,ensureStarted,runPending,publishBase,publishDelta,publishUi,categoryMeta,categoryFileState,verifyPack,hnswState,paths:{CATEGORY_ROOT,UI_ROOT}};
