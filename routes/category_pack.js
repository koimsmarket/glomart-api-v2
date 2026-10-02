'use strict';
// GM_CATEGORY_PACK_USER_V001
const express=require('express');
const fs=require('fs');
const path=require('path');
const router=express.Router();
const mgr=require('../services/asset_pack_manager');
function normLang(v){let s=String(v||'').trim().toLowerCase().replace('_','-');if(s==='ko')s='kr';if(s==='jp')s='ja';if(s==='cn')s='zh';if(s==='vn')s='vi';if(s==='zh-tw')s='tw';if(s.includes('-')){const b=s.split('-')[0];if(mgr.LANGS.includes(b))s=b;}return mgr.LANGS.includes(s)?s:'kr';}
function sendJsonFile(res,file){if(!fs.existsSync(file))return res.status(404).json({ok:false,error:'PACK_NOT_READY'});res.set('Cache-Control','public, max-age=60, must-revalidate');res.type('application/json; charset=utf-8');res.sendFile(file);}
router.get('/api/gm/category-pack/meta',(req,res)=>sendJsonFile(res,path.join(mgr.paths.CATEGORY_ROOT,'meta.json')));
router.get('/api/gm/category-pack/base/:version/:lang', (req,res)=>{const v=String(req.params.version||'').replace(/[^0-9]/g,''),lang=normLang(req.params.lang);sendJsonFile(res,path.join(mgr.paths.CATEGORY_ROOT,'base','v'+v,lang+'.json'));});
router.get('/api/gm/category-pack/delta/:version/:lang',(req,res)=>{const v=String(req.params.version||'').replace(/[^0-9]/g,''),lang=normLang(req.params.lang);sendJsonFile(res,path.join(mgr.paths.CATEGORY_ROOT,'delta','v'+v,lang+'.json'));});
router.get('/api/gm/ui-dictionary/meta',(req,res)=>sendJsonFile(res,path.join(mgr.paths.UI_ROOT,'meta.json')));
router.get('/api/gm/ui-dictionary/ko/:version',(req,res)=>{const v=String(req.params.version||'').replace(/[^0-9]/g,'');sendJsonFile(res,path.join(mgr.paths.UI_ROOT,'ko','v'+v+'.json'));});
module.exports=router;
