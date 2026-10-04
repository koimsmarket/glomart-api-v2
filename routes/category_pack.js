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
function sendJsonFile(res,file){if(!fs.existsSync(file))return res.status(404).json({ok:false,error:'PACK_NOT_READY'});res.set('Cache-Control','public, max-age=60, must-revalidate');res.type('application/json; charset=utf-8');res.sendFile(file);}
router.get('/api/gm/category-pack/meta',(req,res)=>sendJsonFile(res,path.join(mgr.paths.CATEGORY_ROOT,'meta.json')));
router.get('/api/gm/category-pack/base/:version/:lang',(req,res)=>{const raw=String(req.params.version||''),lang=normLang(req.params.lang),t=safeToken(raw);const dir=t?t:('v'+safeLegacy(raw));if(!dir||dir==='v')return res.status(400).json({ok:false,error:'INVALID_VERSION'});sendJsonFile(res,path.join(mgr.paths.CATEGORY_ROOT,'base',dir,lang+'.json'));});
router.get('/api/gm/category-pack/delta/:version/:lang',(req,res)=>{const raw=String(req.params.version||''),lang=normLang(req.params.lang),t=safeToken(raw);const dir=t?t:('v'+safeLegacy(raw));if(!dir||dir==='v')return res.status(400).json({ok:false,error:'INVALID_VERSION'});sendJsonFile(res,path.join(mgr.paths.CATEGORY_ROOT,'delta',dir,lang+'.json'));});
router.get('/api/gm/category-pack/hnsw/:version',(req,res)=>{const raw=String(req.params.version||''),t=safeToken(raw);const dir=t?t:('v'+safeLegacy(raw));if(!dir||dir==='v')return res.status(400).json({ok:false,error:'INVALID_VERSION'});sendJsonFile(res,path.join(mgr.paths.CATEGORY_ROOT,'hnsw',dir,'index.json'));});
router.get('/api/gm/ui-dictionary/meta',(req,res)=>sendJsonFile(res,path.join(mgr.paths.UI_ROOT,'meta.json')));
router.get('/api/gm/ui-dictionary/ko/:version',(req,res)=>{const v=safeLegacy(req.params.version);sendJsonFile(res,path.join(mgr.paths.UI_ROOT,'ko','v'+v+'.json'));});
module.exports=router;
