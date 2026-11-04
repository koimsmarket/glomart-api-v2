'use strict';
// GM_CATEGORY_PACK_USER_V004_TEMP_HNSW_ROUTE
const express=require('express');
const fs=require('fs');
const path=require('path');
const router=express.Router();
const mgr=require('../services/asset_pack_manager');
function normLang(v){let s=String(v||'').trim().toLowerCase().replace('_','-');if(s==='ko')s='kr';if(s==='jp')s='ja';if(s==='cn')s='zh';if(s==='vn')s='vi';if(s==='zh-tw')s='tw';if(s.includes('-')){const b=s.split('-')[0];if(mgr.LANGS.includes(b))s=b;}return mgr.LANGS.includes(s)?s:'kr';}
function safeToken(v){v=String(v||'').trim();return /^\d{8}_\d{4}$/.test(v)?v:'';}
function safeLegacy(v){return String(v||'').replace(/[^0-9]/g,'');}
function sendJsonFile(res,file,category){
  if(!fs.existsSync(file)){
    if(category)console.error('[GM_CATEGORY_PACK_FILE_ERROR]',JSON.stringify({lang:category.lang,version:category.version,kind:category.kind,file,exists:false,reason:'JSON_FILE_MISSING'}));
    return res.status(404).json({ok:false,error:'PACK_NOT_READY'});
  }
  if(category){
    try{
      const st=fs.statSync(file);if(st.size===0)throw new Error('JSON_FILE_EMPTY');
      const pack=JSON.parse(fs.readFileSync(file,'utf8'));
      if(!pack||!Array.isArray(pack.items)||!Number.isInteger(Number(pack.count))||Number(pack.count)!==pack.items.length||(category.kind==='base'&&pack.items.length===0))throw new Error('CATEGORY_JSON_INVALID_OR_EMPTY');
      if(String(pack.lang||'')!==category.lang)throw new Error('CATEGORY_JSON_LANG_MISMATCH');
    }catch(e){
      console.error('[GM_CATEGORY_PACK_FILE_ERROR]',JSON.stringify({lang:category.lang,version:category.version,kind:category.kind,file,exists:true,reason:String(e&&e.message||e)}));
      return res.status(503).json({ok:false,error:'CATEGORY_JSON_INVALID'});
    }
  }
  res.set('Cache-Control','public, max-age=60, must-revalidate');res.type('application/json; charset=utf-8');res.sendFile(file);
}
router.get('/api/gm/category-pack/meta',async(req,res)=>{
  const file=path.join(mgr.paths.CATEGORY_ROOT,'meta.json');
  if(!fs.existsSync(file)){
    try{await mgr.ensureStarted(req.app.locals.pool);}catch(e){console.error('[GM_CATEGORY_PACK_META_RESTORE_ERROR]',String(e&&e.message||e));}
  }
  return sendJsonFile(res,file); // Unpublished pack remains PACK_NOT_READY.
});
router.get('/api/gm/category-pack/base/:version/:lang',(req,res)=>{const raw=String(req.params.version||''),lang=normLang(req.params.lang),t=safeToken(raw);const dir=t?t:('v'+safeLegacy(raw));if(!dir||dir==='v')return res.status(400).json({ok:false,error:'INVALID_VERSION'});sendJsonFile(res,path.join(mgr.paths.CATEGORY_ROOT,'base',dir,lang+'.json'),{kind:'base',version:raw,lang});});
router.get('/api/gm/category-pack/delta/:version/:lang',(req,res)=>{const raw=String(req.params.version||''),lang=normLang(req.params.lang),t=safeToken(raw);const dir=t?t:('v'+safeLegacy(raw));if(!dir||dir==='v')return res.status(400).json({ok:false,error:'INVALID_VERSION'});sendJsonFile(res,path.join(mgr.paths.CATEGORY_ROOT,'delta',dir,lang+'.json'),{kind:'delta',version:raw,lang});});
router.get('/api/gm/category-pack/hnsw/:version',(req,res)=>{const raw=String(req.params.version||''),t=safeToken(raw);const dir=t?t:('v'+safeLegacy(raw));if(!dir||dir==='v')return res.status(400).json({ok:false,error:'INVALID_VERSION'});sendJsonFile(res,path.join(mgr.paths.CATEGORY_ROOT,'hnsw',dir,'index.json'));});
router.get('/api/gm/ui-dictionary/meta',(req,res)=>sendJsonFile(res,path.join(mgr.paths.UI_ROOT,'meta.json')));
router.get('/api/gm/ui-dictionary/ko/:version',(req,res)=>{const v=safeLegacy(req.params.version);sendJsonFile(res,path.join(mgr.paths.UI_ROOT,'ko','v'+v+'.json'));});
module.exports=router;
