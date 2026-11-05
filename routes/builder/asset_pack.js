'use strict';
// GM_ASSET_PACK_BUILDER_V005_ERROR_DETAIL_LOG
const express=require('express');
const router=express.Router();
const {dbFrom,ok,fail}=require('./core');
const mgr=require('../../services/asset_pack_manager');

async function state(db){
  const c=await mgr.config(db),version=await mgr.versionState(db),pending=await mgr.pendingRows(db,300),pending_count=await mgr.pendingCount(db);
  return {config:c,generator:mgr.status(),category_meta:mgr.categoryMeta(),category_files:mgr.categoryFileState(),version,pending_count,pending,languages:mgr.LANGS};
}
async function nextInternal(db,targetKey,publishedKey){
  const c=await mgr.config(db);
  return Math.max(Number(c[targetKey]||0),Number(c[publishedKey]||0))+1;
}
async function saveTarget(db,key,value){
  await db.query(`UPDATE gm_runtime_config SET config_value=$2,updated_at=now() WHERE config_key=$1`,[key,String(value)]);
}
function packError(res,e,label){
  const code=e&&e.code;
  const detail=String(e&&e.stack||e&&e.message||e);
  console.error('[GM_CATEGORY_PACK_GENERATE_FAIL]',JSON.stringify({label,code:code||'',detail}));
  if(code==='PREPARE_REQUIRED')return fail(res,409,'먼저 JSON 제작을 실행한 후 관리자 버전 갱신을 실행하세요.',{detail});
  if(code==='SAME_MINUTE')return fail(res,409,'같은 분 안에서는 같은 종류의 카테고리 JSON을 두 번 생성할 수 없습니다.',{detail});
  if(code==='BASE_NOT_READY')return fail(res,409,'원본(BASE) 25개국 JSON을 먼저 생성해야 합니다.',{detail});
  if(code==='PACK_VERIFY')return fail(res,500,label+' 25개국 파일 검증에 실패했습니다.',{detail});
  return fail(res,500,label+' 생성 실패',{detail});
}

router.get('/api/gm/builder/asset-pack',async(req,res)=>{
  const db=dbFrom(req);
  try{mgr.ensureStarted(db);ok(res,await state(db));}catch(e){const detail=String(e&&e.stack||e);console.error('[GM_ASSET_PACK_BUILDER_ERROR] status',detail);fail(res,500,'asset pack read failed',{detail});}
});
router.post('/api/gm/builder/asset-pack/schedule',async(req,res)=>{
  const db=dbFrom(req),b=req.body||{};
  try{
    await mgr.ensureDefaults(db);
    const mode=String(b.mode||'AUTO').toUpperCase();if(!['OFF','AUTO','ON'].includes(mode))return fail(res,400,'invalid mode');
    const hhmm=x=>/^([01]\d|2[0-3]):[0-5]\d$/.test(String(x||''));if(!hhmm(b.start)||!hhmm(b.end))return fail(res,400,'invalid time');
    for(const [k,v] of [['asset_pack_background_mode',mode],['asset_pack_auto_start',b.start],['asset_pack_auto_end',b.end]])await db.query(`UPDATE gm_runtime_config SET config_value=$2,updated_at=now() WHERE config_key=$1`,[k,String(v)]);
    ok(res,await state(db));
  }catch(e){const detail=String(e&&e.stack||e);console.error('[GM_ASSET_PACK_BUILDER_ERROR] schedule',detail);fail(res,500,'schedule save failed',{detail});}
});
router.post('/api/gm/builder/asset-pack/version/:kind/next',async(req,res)=>{
  const db=dbFrom(req),kind=String(req.params.kind||'');
  if(!['base','delta','ui'].includes(kind))return fail(res,400,'invalid kind');
  try{
    await mgr.ensureDefaults(db);
    if(kind==='ui')return fail(res,409,'UI 사전 버전은 UI 사전 빌더의 별도 관리자 승인 버튼으로만 갱신합니다.');
    await mgr.assertCategoryDraft(db,kind);
    const target='category_pack_'+kind+'_target',published='category_pack_'+kind+'_published';
    const version=await nextInternal(db,target,published);
    const result=kind==='base'?await mgr.publishBase(db,version):await mgr.publishDelta(db,version);
    if(result&&result.state!=='NO_CHANGES')await saveTarget(db,target,version);
    ok(res,{kind,result,state:await state(db)});
  }catch(e){packError(res,e,'관리자 버전 갱신');}
});

async function generateBase(req,res){
  const db=dbFrom(req);
  try{const result=await mgr.categoryDraft(db,'base');ok(res,{result,state:await state(db)});}
  catch(e){packError(res,e,'원본(BASE) JSON 준비');}
}
async function generateDelta(req,res){
  const db=dbFrom(req);
  try{const result=await mgr.categoryDraft(db,'delta');ok(res,{result,state:await state(db)});}
  catch(e){packError(res,e,'추가본(DELTA) JSON 준비');}
}

// Builder의 명시적 카테고리 JSON 생성 기능.
router.post('/api/gm/builder/asset-pack/category/base/generate',generateBase);
router.post('/api/gm/builder/asset-pack/category/delta/generate',generateDelta);
// 기존 호출 호환.
router.post('/api/gm/builder/asset-pack/base/new-now',generateBase);

// AUTO/기존 UI 사전 배포용 호환 엔드포인트. 카테고리 전용 버튼에서는 사용하지 않는다.
router.post('/api/gm/builder/asset-pack/publish-now',async(req,res)=>{
  const db=dbFrom(req);
  try{ok(res,{result:{state:'MANUAL_VERSION_ONLY'},state:await state(db)});}catch(e){packError(res,e,'대기 배포');}
});
module.exports=router;
