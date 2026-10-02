'use strict';
// GM_ASSET_PACK_BUILDER_V002_NEW_BASE_NOW
const express=require('express');
const router=express.Router();
const {dbFrom,ok,fail}=require('./core');
const mgr=require('../../services/asset_pack_manager');
async function state(db){
  const c=await mgr.config(db);return {config:c,generator:mgr.status(),category_meta:mgr.categoryMeta()};
}
router.get('/api/gm/builder/asset-pack',async(req,res)=>{const db=dbFrom(req);try{mgr.ensureStarted(db);ok(res,await state(db));}catch(e){fail(res,500,'asset pack read failed',{detail:String(e&&e.message||e)});}});
router.post('/api/gm/builder/asset-pack/schedule',async(req,res)=>{const db=dbFrom(req),b=req.body||{};try{await mgr.ensureDefaults(db);const mode=String(b.mode||'AUTO').toUpperCase();if(!['OFF','AUTO','ON'].includes(mode))return fail(res,400,'invalid mode');const hhmm=x=>/^([01]\d|2[0-3]):[0-5]\d$/.test(String(x||''));if(!hhmm(b.start)||!hhmm(b.end))return fail(res,400,'invalid time');for(const [k,v] of [['asset_pack_background_mode',mode],['asset_pack_auto_start',b.start],['asset_pack_auto_end',b.end]])await db.query(`UPDATE gm_runtime_config SET config_value=$2,updated_at=now() WHERE config_key=$1`,[k,String(v)]);ok(res,await state(db));}catch(e){fail(res,500,'schedule save failed',{detail:String(e&&e.message||e)});}});
router.post('/api/gm/builder/asset-pack/version/:kind/next',async(req,res)=>{const db=dbFrom(req),kind=String(req.params.kind||'');const map={base:'category_pack_base_target',delta:'category_pack_delta_target',ui:'ui_dictionary_target'};const key=map[kind];if(!key)return fail(res,400,'invalid kind');try{await mgr.ensureDefaults(db);const r=await db.query(`UPDATE gm_runtime_config SET config_value=(COALESCE(NULLIF(config_value,''),'0')::bigint+1)::text,updated_at=now() WHERE config_key=$1 RETURNING config_value`,[key]);ok(res,{kind,target:Number(r.rows[0].config_value),state:await state(db)});}catch(e){fail(res,500,'version update failed',{detail:String(e&&e.message||e)});}});
router.post('/api/gm/builder/asset-pack/base/new-now',async(req,res)=>{
  const db=dbFrom(req);
  try{
    await mgr.ensureDefaults(db);
    const c=await mgr.config(db);
    const target=Number(c.category_pack_base_target||0);
    const published=Number(c.category_pack_base_published||0);
    let version=target;
    // If there is no pending base request, create the next version.
    // If target > published, preserve that already-requested version and publish it now.
    if(!(target>published)){
      const r=await db.query(`UPDATE gm_runtime_config SET config_value=(COALESCE(NULLIF(config_value,''),'0')::bigint+1)::text,updated_at=now() WHERE config_key='category_pack_base_target' RETURNING config_value`);
      version=Number(r.rows[0].config_value);
    }
    mgr.ensureStarted(db);
    const result=await mgr.publishBase(db,version);
    ok(res,{result,state:await state(db)});
  }catch(e){
    fail(res,500,'new base publish failed',{detail:String(e&&e.stack||e)});
  }
});
router.post('/api/gm/builder/asset-pack/publish-now',async(req,res)=>{const db=dbFrom(req);try{mgr.ensureStarted(db);const result=await mgr.runPending(db,true);ok(res,{result,state:await state(db)});}catch(e){fail(res,500,'publish failed',{detail:String(e&&e.stack||e)});}});
module.exports=router;
