'use strict';
// GM_RUNTIME_CONFIG_V007_SEARCH_CONTROL
const express=require('express');
const router=express.Router();
const {dbFrom,ok,fail}=require('./core');

const KEY_RE=/^[a-zA-Z0-9_.-]{1,120}$/;
const MODE_RE=/^[A-Z0-9_.-]{1,20}$/;
const TYPES=new Set(['STRING','NUMBER','BOOLEAN','VERSION','JSON']);
// These keys participate in representative-map locking / atomic publish invariants.
// They may be read through the generic config UI, but writes must go through the
// dedicated image-vector Builder endpoints (or internal services for LIVE/build state).

const SPECIAL_DEFAULT_APPLY_YM='2026-08';
const SPECIAL_DEFAULT_ORDER=[
  {no:1,prefix:'FD',name:'식품'},
  {no:2,prefix:'HS',name:'생활용품'},
  {no:3,prefix:'KW',name:'주방용품'},
  {no:4,prefix:'BP',name:'뷰티'},
  {no:5,prefix:'FA',name:'패션의류/잡화'}
];
let specialCategoryDefaultsEnsured=false;
function cleanSpecialOrder(v){
  let a=v;
  if(typeof a==='string'){try{a=JSON.parse(a);}catch(_e){a=[];}}
  if(!Array.isArray(a))a=[];
  const seenPrefix=new Set(),seenNo=new Set(),out=[];
  for(const x of a){
    const prefix=String(x&&x.prefix||x&&x.code||'').trim().toUpperCase().replace(/[^A-Z0-9]/g,'');
    const no=Number(x&&x.no!=null?x.no:x&&x.order);
    const name=String(x&&x.name||'').trim();
    if(!prefix||!Number.isInteger(no)||no<1||seenPrefix.has(prefix)||seenNo.has(no))continue;
    seenPrefix.add(prefix);seenNo.add(no);out.push({no,prefix,name});
  }
  return out.sort((a,b)=>a.no-b.no||a.prefix.localeCompare(b.prefix));
}
async function ensureSpecialCategoryDefaults(db){
  if(specialCategoryDefaultsEnsured)return;
  const rows=[
    ['special_category_apply_ym',SPECIAL_DEFAULT_APPLY_YM,'STRING','SPECIAL','AUTO','SPECIAL 카테고리 대상 기준 연월(UTC, YYYY-MM)'],
    ['special_category_order',JSON.stringify(SPECIAL_DEFAULT_ORDER),'JSON','SPECIAL','AUTO','SPECIAL 대분류 처리 번호순'],
    ['external_search_interval_hours','24','NUMBER','SEARCH','AUTO','동일 정규화 검색어 외부검색 재실행 간격(시간, CPKR/ALKR 공통)'],
    ['product_queue_concurrency_min','2','NUMBER','SEARCH','AUTO','상품 업서트 큐 최소 동시 처리수'],
    ['product_queue_concurrency_max','0','NUMBER','SEARCH','AUTO','상품 업서트 큐 최대 동시 처리수(0=CPU/DB pool 기준 자동)']
  ];
  for(const x of rows){
    await db.query(`INSERT INTO gm_runtime_config(config_key,config_value,value_type,category,mode,enabled,description,updated_at)
      VALUES($1,$2,$3,$4,$5,TRUE,$6,now()) ON CONFLICT(config_key) DO NOTHING`,x);
  }
  specialCategoryDefaultsEnsured=true;
}
const IMAGE_VECTOR_PROTECTED_KEYS=new Set([
  'image_vector_representative_run',
  'image_vector_representative_similarity',
  'image_vector_representative_live_run',
  'image_vector_representative_live_similarity',
  'image_vector_representative_live_epoch',
  'image_vector_representative_run0_epoch',
  'image_vector_representative_building'
]);
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
    await ensureSpecialCategoryDefaults(db);
    const r=await db.query(`SELECT config_key,config_value,value_type,category,mode,enabled,description,updated_at FROM gm_runtime_config WHERE enabled=TRUE ORDER BY category,config_key`);
    const config={};for(const row of r.rows)config[row.config_key]=typedValue(row);
    res.set('Cache-Control','no-store, no-cache, must-revalidate');
    res.json({ok:true,config,items:r.rows});
  }catch(e){fail(res,500,'runtime config read failed',{detail:String(e&&e.message||e)});}
});
router.get('/api/gm/builder/config',async(req,res)=>{
  const db=dbFrom(req);
  try{await ensureSpecialCategoryDefaults(db);const r=await db.query(`SELECT config_key,config_value,value_type,category,mode,enabled,description,updated_at FROM gm_runtime_config ORDER BY category,config_key`);ok(res,{items:r.rows});}
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
  if(IMAGE_VECTOR_PROTECTED_KEYS.has(key))return fail(res,409,'IMAGE_VECTOR_CONFIG_PROTECTED',{detail:'Use the dedicated image-vector representative settings/build flow. LIVE/build/epoch keys are internal state.'});
  try{
    const r=await db.query(`INSERT INTO gm_runtime_config(config_key,config_value,value_type,category,mode,enabled,description,updated_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,now()) ON CONFLICT(config_key) DO UPDATE SET
      config_value=EXCLUDED.config_value,value_type=EXCLUDED.value_type,category=EXCLUDED.category,
      mode=EXCLUDED.mode,enabled=EXCLUDED.enabled,description=EXCLUDED.description,updated_at=now() RETURNING *`,
      [key,value,type,category,mode,enabled,description]);
    ok(res,{item:r.rows[0]});
  }catch(e){fail(res,500,'builder config save failed',{detail:String(e&&e.message||e)});}
});
router.get('/api/gm/builder/config/special-category-plan',async(req,res)=>{
  const db=dbFrom(req);
  try{
    await ensureSpecialCategoryDefaults(db);
    const c=await db.query(`SELECT config_key,config_value FROM gm_runtime_config WHERE config_key IN ('special_category_apply_ym','special_category_order')`);
    const map={};for(const x of c.rows)map[x.config_key]=x.config_value;
    const applyYm=/^\d{4}-\d{2}$/.test(String(map.special_category_apply_ym||''))?String(map.special_category_apply_ym):SPECIAL_DEFAULT_APPLY_YM;
    const order=cleanSpecialOrder(map.special_category_order);const finalOrder=order.length?order:SPECIAL_DEFAULT_ORDER.slice();
    const byPrefix=new Map(finalOrder.map(x=>[x.prefix,x]));
    const roots=await db.query(`SELECT split_part(gm_code,'-',1) prefix,name_ko,sort_order,category_id FROM gm_category WHERE COALESCE(depth,0)=0 AND COALESCE(gm_code,'')<>'' ORDER BY sort_order ASC,category_id ASC`);
    ok(res,{apply_ym:applyYm,categories:roots.rows.map(x=>{const prefix=String(x.prefix||'').toUpperCase();const o=byPrefix.get(prefix);return {prefix,name_ko:x.name_ko||'',sort_order:x.sort_order,category_id:x.category_id,no:o?o.no:null};})});
  }catch(e){fail(res,500,'special category plan read failed',{detail:String(e&&e.message||e)});}
});
router.post('/api/gm/builder/config/special-category-plan',async(req,res)=>{
  const db=dbFrom(req),b=req.body||{};
  const applyYm=String(b.apply_ym||'').trim();const order=cleanSpecialOrder(b.categories||b.order||[]);
  if(!/^\d{4}-\d{2}$/.test(applyYm))return fail(res,400,'invalid apply_ym');
  if(!order.length)return fail(res,400,'at least one numbered category is required');
  try{
    await ensureSpecialCategoryDefaults(db);
    const nameMap=new Map();
    const roots=await db.query(`SELECT split_part(gm_code,'-',1) prefix,name_ko FROM gm_category WHERE COALESCE(depth,0)=0 AND COALESCE(gm_code,'')<>''`);
    for(const x of roots.rows)nameMap.set(String(x.prefix||'').toUpperCase(),String(x.name_ko||''));
    const finalOrder=order.map(x=>({no:x.no,prefix:x.prefix,name:nameMap.get(x.prefix)||x.name||''}));
    const client=await db.connect();
    try{
      await client.query('BEGIN');
      await client.query(`UPDATE gm_runtime_config SET config_value=$1,value_type='STRING',category='SPECIAL',mode='AUTO',enabled=TRUE,description='SPECIAL 카테고리 대상 기준 연월(UTC, YYYY-MM)',updated_at=now() WHERE config_key='special_category_apply_ym'`,[applyYm]);
      await client.query(`UPDATE gm_runtime_config SET config_value=$1,value_type='JSON',category='SPECIAL',mode='AUTO',enabled=TRUE,description='SPECIAL 대분류 처리 번호순',updated_at=now() WHERE config_key='special_category_order'`,[JSON.stringify(finalOrder)]);
      await client.query('COMMIT');
    }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}
    ok(res,{apply_ym:applyYm,order:finalOrder});
  }catch(e){fail(res,500,'special category plan save failed',{detail:String(e&&e.message||e)});}
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
