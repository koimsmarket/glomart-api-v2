'use strict';
/* GM_ASSET_PACK_MANAGER_V001
 * Category static pack + UI dictionary source pack publisher.
 * DB schema is NOT changed. Versions/schedule live in gm_runtime_config rows.
 */
const fs=require('fs');
const path=require('path');

const LANGS=['kr','en','vi','zh','ja','tw','th','uz','ne','km','id','tl','mn','my','kk','si','ru','bn','ur','lo','hi','tr','fa','es','fr'];
const COL={kr:'name_ko',en:'name_en',vi:'name_vi',zh:'name_zh',ja:'name_ja',tw:'name_tw',th:'name_th',uz:'name_uz',ne:'name_ne',km:'name_km',id:'name_id',tl:'name_tl',mn:'name_mn',my:'name_my',kk:'name_kk',si:'name_si',ru:'name_ru',bn:'name_bn',ur:'name_ur',lo:'name_lo',hi:'name_hi',tr:'name_tr',fa:'name_fa',es:'name_es',fr:'name_fr'};
const PUBLIC_ROOT=path.join(__dirname,'..','public','data','gm-assets');
const CATEGORY_ROOT=path.join(PUBLIC_ROOT,'category');
const UI_ROOT=path.join(PUBLIC_ROOT,'ui');
const PRIVATE_ROOT=path.join(__dirname,'..','storage','gm-assets');
const SNAPSHOT_FILE=path.join(PRIVATE_ROOT,'category_snapshot.json');
let poolRef=null,timer=null,pumping=false;
let lastState={state:'IDLE',running:false,last_error:'',last_run_at:null,last_result:null};
function s(v){return String(v==null?'':v).trim();}
function n(v,d=0){const x=Number(v);return Number.isFinite(x)?Math.trunc(x):d;}
function mkdirp(p){fs.mkdirSync(p,{recursive:true});}
function writeJson(file,obj){mkdirp(path.dirname(file));const tmp=file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(obj),'utf8');fs.renameSync(tmp,file);}
function readJson(file,fallback){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch(_e){return fallback;}}
function kstHHMM(){const d=new Date(Date.now()+9*60*60*1000);return String(d.getUTCHours()).padStart(2,'0')+':'+String(d.getUTCMinutes()).padStart(2,'0');}
function inWindow(now,start,end){if(start===end)return true;if(start<end)return now>=start&&now<end;return now>=start||now<end;}
async function ensureDefaults(db){
  const rows=[
    ['asset_pack_background_mode','AUTO','STRING','ASSET','AUTO','정적 자산팩 자동 생성: OFF/AUTO/ON'],
    ['asset_pack_auto_start','00:00','STRING','ASSET','AUTO','카테고리/UI 사전 자동 생성 시작시간 KST'],
    ['asset_pack_auto_end','08:00','STRING','ASSET','AUTO','카테고리/UI 사전 자동 생성 종료시간 KST'],
    ['category_pack_base_target','1','VERSION','ASSET','FIXED','관리자가 요청한 카테고리 기준본 버전'],
    ['category_pack_base_published','0','VERSION','ASSET','실제 생성 완료된 카테고리 기준본 버전'],
    ['category_pack_delta_target','0','VERSION','ASSET','관리자가 요청한 카테고리 누적본 버전'],
    ['category_pack_delta_published','0','VERSION','ASSET','실제 생성 완료된 카테고리 누적본 버전'],
    ['ui_dictionary_target','1','VERSION','ASSET','관리자가 요청한 UI 사전 배포 버전'],
    ['ui_dictionary_published','0','VERSION','ASSET','실제 생성 완료된 UI 사전 배포 버전']
  ];
  for(const x of rows){await db.query(`INSERT INTO gm_runtime_config(config_key,config_value,value_type,category,mode,enabled,description,updated_at)
    VALUES($1,$2,$3,$4,$5,TRUE,$6,now()) ON CONFLICT(config_key) DO NOTHING`,x);}
}
async function config(db){await ensureDefaults(db);const r=await db.query(`SELECT config_key,config_value FROM gm_runtime_config WHERE config_key LIKE 'asset_pack_%' OR config_key LIKE 'category_pack_%' OR config_key LIKE 'ui_dictionary_%'`);const m={};for(const x of r.rows)m[x.config_key]=s(x.config_value);return m;}
async function setConfig(db,key,value){await db.query(`UPDATE gm_runtime_config SET config_value=$2,updated_at=now() WHERE config_key=$1`,[key,String(value)]);}
function parentCode(code,depth){const a=s(code).toUpperCase().split('-');if(depth<=0||!a.length)return '';for(let i=depth;i<a.length;i++)a[i]='0'.repeat(Math.max(1,String(a[i]||'').length));return a.join('-');}
function rowCore(r){const code=s(r.gm_code).toUpperCase(),depth=n(r.depth);return {gm_code:code,parent_code:parentCode(code,depth),depth,leaf_yn:s(r.leaf_yn).toUpperCase()||'N',display_yn:s(r.display_yn).toUpperCase()||'Y',sort_order:n(r.sort_order),keyword:s(r.keyword)||s(r.keyword_seed)||s(r.name_ko),name_ko:s(r.name_ko)};}
function localized(r,lang){const core=rowCore(r),col=COL[lang]||'name_ko';return Object.assign(core,{name:s(r[col])||s(r.name_ko)});}
function signature(r){const o={};for(const k of ['gm_code','depth','leaf_yn','display_yn','sort_order','keyword','keyword_seed','name_ko',...Object.values(COL)])o[k]=r[k]==null?'':r[k];return JSON.stringify(o);}
async function categoryRows(db){const cols=['gm_code','depth','leaf_yn','display_yn','sort_order','keyword','keyword_seed','name_ko',...Array.from(new Set(Object.values(COL)))];const q=await db.query(`SELECT ${cols.join(',')} FROM gm_category WHERE COALESCE(display_yn,'Y')='Y' ORDER BY depth,COALESCE(sort_order,2147483647),category_id`);return q.rows||[];}
function categoryMeta(){return readJson(path.join(CATEGORY_ROOT,'meta.json'),{base_version:0,delta_versions:[],updated_at:null,languages:LANGS});}
async function publishBase(db,version){
  const rows=await categoryRows(db),v=n(version);
  for(const lang of LANGS)writeJson(path.join(CATEGORY_ROOT,'base','v'+v,lang+'.json'),{type:'base',version:v,lang,count:rows.length,items:rows.map(r=>localized(r,lang))});
  const snap={version:v,rows:{}};for(const r of rows)snap.rows[s(r.gm_code).toUpperCase()]={sig:signature(r),row:r};writeJson(SNAPSHOT_FILE,snap);
  const meta={base_version:v,delta_versions:[],updated_at:new Date().toISOString(),languages:LANGS};writeJson(path.join(CATEGORY_ROOT,'meta.json'),meta);
  await setConfig(db,'category_pack_base_published',v);return {kind:'category_base',version:v,count:rows.length};
}
async function publishDelta(db,version){
  const current=await categoryRows(db),snap=readJson(SNAPSHOT_FILE,null),v=n(version);
  if(!snap||!snap.rows)return publishBase(db,n((await config(db)).category_pack_base_target,1));
  const curMap=new Map(current.map(r=>[s(r.gm_code).toUpperCase(),r]));const changes=[];
  for(const r of current){const code=s(r.gm_code).toUpperCase(),old=snap.rows[code];if(!old||old.sig!==signature(r))changes.push({op:'upsert',row:r});}
  for(const code of Object.keys(snap.rows))if(!curMap.has(code))changes.push({op:'delete',gm_code:code});
  for(const lang of LANGS){const items=changes.map(x=>x.op==='delete'?{op:'delete',gm_code:x.gm_code}:{op:'upsert',item:localized(x.row,lang)});writeJson(path.join(CATEGORY_ROOT,'delta','v'+v,lang+'.json'),{type:'delta',version:v,lang,count:items.length,items});}
  const next={version:v,rows:{}};for(const r of current)next.rows[s(r.gm_code).toUpperCase()]={sig:signature(r),row:r};writeJson(SNAPSHOT_FILE,next);
  const meta=categoryMeta();const ds=Array.from(new Set([...(meta.delta_versions||[]).map(Number),v])).filter(x=>x>0).sort((a,b)=>a-b);writeJson(path.join(CATEGORY_ROOT,'meta.json'),{base_version:n(meta.base_version),delta_versions:ds,updated_at:new Date().toISOString(),languages:LANGS});
  await setConfig(db,'category_pack_delta_published',v);return {kind:'category_delta',version:v,count:changes.length};
}
async function publishUi(db,version){
  const q=await db.query(`SELECT dict_key,source_text,source_value FROM gm_ui_dictionary_source ORDER BY dict_key`);const items=(q.rows||[]).map(x=>({dict_key:s(x.dict_key),source_text:s(x.source_text),value:s(x.source_value)}));const v=n(version);
  writeJson(path.join(UI_ROOT,'ko','v'+v+'.json'),{type:'ui_dictionary',lang:'ko',version:v,count:items.length,items});writeJson(path.join(UI_ROOT,'meta.json'),{version:v,updated_at:new Date().toISOString(),lang:'ko',count:items.length});await setConfig(db,'ui_dictionary_published',v);return {kind:'ui_dictionary',version:v,count:items.length};
}
async function runPending(db,force=false){
  const c=await config(db);const mode=s(c.asset_pack_background_mode||'AUTO').toUpperCase();if(!force){if(mode==='OFF')return {state:'OFF'};if(mode==='AUTO'&&!inWindow(kstHHMM(),c.asset_pack_auto_start||'00:00',c.asset_pack_auto_end||'08:00'))return {state:'AUTO_TIME_WAIT'};}
  const results=[];const bt=n(c.category_pack_base_target,1),bp=n(c.category_pack_base_published,0),dt=n(c.category_pack_delta_target,0),dp=n(c.category_pack_delta_published,0),ut=n(c.ui_dictionary_target,1),up=n(c.ui_dictionary_published,0);
  if(bt>bp)results.push(await publishBase(db,bt));
  const c2=await config(db);if(n(c2.category_pack_delta_target,0)>n(c2.category_pack_delta_published,0))results.push(await publishDelta(db,n(c2.category_pack_delta_target,0)));
  if(ut>up)results.push(await publishUi(db,ut));
  return {state:results.length?'PUBLISHED':'NO_PENDING',results};
}
async function pump(){if(!poolRef||pumping)return;pumping=true;lastState.running=true;try{const r=await runPending(poolRef,false);lastState.state=r.state;lastState.last_result=r;lastState.last_error='';lastState.last_run_at=new Date().toISOString();}catch(e){lastState.state='ERROR';lastState.last_error=String(e&&e.stack||e);}finally{lastState.running=false;pumping=false;}}
function ensureStarted(pool){if(pool)poolRef=pool;if(timer||!poolRef)return;timer=setInterval(()=>pump().catch(()=>{}),60000);if(timer.unref)timer.unref();setTimeout(()=>pump().catch(()=>{}),2000);}
function status(){return Object.assign({},lastState);}
module.exports={LANGS,ensureDefaults,config,status,ensureStarted,runPending,publishBase,publishDelta,publishUi,categoryMeta,paths:{CATEGORY_ROOT,UI_ROOT}};
