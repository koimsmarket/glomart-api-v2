'use strict';
// GM_RUNTIME_CONFIG_V003
const express=require('express');
const router=express.Router();
const {dbFrom,ok,fail}=require('./core');

const KEY_RE=/^[a-zA-Z0-9_.-]{1,120}$/;
const MODE_RE=/^[A-Z0-9_.-]{1,20}$/;
const TYPES=new Set(['STRING','NUMBER','BOOLEAN','VERSION','JSON']);
function typedValue(row){
  const raw=String(row.config_value==null?'':row.config_value);
  switch(String(row.value_type||'').toUpperCase()){
    case 'NUMBER':{const n=Number(raw);return Number.isFinite(n)?n:raw;}
    case 'BOOLEAN':return /^(1|true|yes|on)$/i.test(raw);
    case 'JSON':try{return JSON.parse(raw);}catch(_e){return raw;}
    default:return raw;
  }
}
router.get('/api/gm/config',async(req,res)=>{
  const db=dbFrom(req);
  try{
    const r=await db.query(`SELECT config_key,config_value,value_type,category,mode,enabled,description,updated_at FROM gm_runtime_config WHERE enabled=TRUE ORDER BY category,config_key`);
    const config={};for(const row of r.rows)config[row.config_key]=typedValue(row);
    res.set('Cache-Control','no-store, no-cache, must-revalidate');
    res.json({ok:true,config,items:r.rows});
  }catch(e){fail(res,500,'runtime config read failed',{detail:String(e&&e.message||e)});}
});
router.get('/api/gm/builder/config',async(req,res)=>{
  const db=dbFrom(req);
  try{const r=await db.query(`SELECT config_key,config_value,value_type,category,mode,enabled,description,updated_at FROM gm_runtime_config ORDER BY category,config_key`);ok(res,{items:r.rows});}
  catch(e){fail(res,500,'builder config read failed',{detail:String(e&&e.message||e)});}
});
router.post('/api/gm/builder/config',async(req,res)=>{
  const db=dbFrom(req),b=req.body||{};
  const key=String(b.config_key||'').trim();
  const value=String(b.config_value==null?'':b.config_value).trim();
  const type=String(b.value_type||'STRING').trim().toUpperCase();
  const category=String(b.category||'SYSTEM').trim().toUpperCase().slice(0,40)||'SYSTEM';
  const mode=String(b.mode||'FIXED').trim().toUpperCase();
  const enabled=b.enabled!==false && String(b.enabled).toLowerCase()!=='false' && String(b.enabled)!=='0';
  const description=String(b.description||'').trim();
  if(!KEY_RE.test(key))return fail(res,400,'invalid config_key');
  if(!TYPES.has(type))return fail(res,400,'invalid value_type');
  if(!MODE_RE.test(mode))return fail(res,400,'invalid mode');
  if(key==='gm_v1')return fail(res,400,'gm_v1 is protected: AUTO_1MIN');
  if(key==='gm_v2')return fail(res,400,'gm_v2 is protected: use gm-v2/next');
  try{
    const r=await db.query(`INSERT INTO gm_runtime_config(config_key,config_value,value_type,category,mode,enabled,description,updated_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,now()) ON CONFLICT(config_key) DO UPDATE SET
      config_value=EXCLUDED.config_value,value_type=EXCLUDED.value_type,category=EXCLUDED.category,
      mode=EXCLUDED.mode,enabled=EXCLUDED.enabled,description=EXCLUDED.description,updated_at=now() RETURNING *`,
      [key,value,type,category,mode,enabled,description]);
    ok(res,{item:r.rows[0]});
  }catch(e){fail(res,500,'builder config save failed',{detail:String(e&&e.message||e)});}
});
router.post('/api/gm/builder/config/gm-v2/next',async(req,res)=>{
  const db=dbFrom(req);
  try{
    const r=await db.query(`UPDATE gm_runtime_config SET config_value=(GREATEST(CASE WHEN config_value ~ '^[0-9]+$' THEN config_value::int ELSE 0 END,0)+1)::text,updated_at=now() WHERE config_key='gm_v2' RETURNING *`);
    if(!r.rows.length)return fail(res,404,'gm_v2 not found');
    ok(res,{item:r.rows[0]});
  }catch(e){fail(res,500,'gm_v2 increment failed',{detail:String(e&&e.message||e)});}
});
module.exports=router;
