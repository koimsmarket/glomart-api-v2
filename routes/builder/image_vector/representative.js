'use strict';
// GM_BUILDER_IMAGE_VECTOR_REPRESENTATIVE_V005_FAST_STATUS
// Lightweight representative status/statistics only. No category/vector bulk scan here.

const express=require('express');
const router=express.Router();
const {dbFrom,ok,fail}=require('../core');
const DIM=512;
function S(v){return String(v==null?'':v).trim();}
function N(v,d=0){const n=Number(v);return Number.isFinite(n)?n:d;}
async function config(db,key,def){const r=await db.query('SELECT config_value FROM gm_runtime_config WHERE config_key=$1',[key]);return r.rows.length?r.rows[0].config_value:def;}
async function settings(db){const run=Math.max(1,Math.trunc(N(await config(db,'image_vector_representative_run','1'),1)));const threshold=N(await config(db,'image_vector_representative_similarity','0.95'),0.95);if(!(threshold>0&&threshold<=1))throw new Error('대표이미지 유사율은 0 초과 1 이하여야 합니다.');return {run_no:run,threshold};}
async function status(db){
  const s=await settings(db);
  const [vq,mq]=await Promise.all([
    db.query(`SELECT
      COUNT(*) FILTER (WHERE v.vector_image IS NOT NULL AND array_length(v.vector_image,1)=$1)::int AS total_vector,
      COUNT(*) FILTER (WHERE v.vector_image IS NOT NULL AND array_length(v.vector_image,1)=$1 AND p.product_uid IS NOT NULL AND COALESCE(NULLIF(BTRIM(p.category_keyword),''),NULLIF(BTRIM(p.keyword),'')) IS NOT NULL)::int AS candidate_vector
      FROM gm_product_image_vector v LEFT JOIN gm_product p ON p.product_uid=v.product_uid`,[DIM]),
    db.query(`SELECT
      COUNT(*) FILTER (WHERE run_no=$1)::int AS current_done,
      COUNT(*) FILTER (WHERE run_no>0 AND run_no<>$1)::int AS previous_run,
      COUNT(*) FILTER (WHERE run_no=0)::int AS excluded_run0,
      COUNT(*) FILTER (WHERE run_no=$1 AND representative_puid=puid)::int AS representatives,
      COALESCE(MAX(representative_no),0)::bigint AS max_representative_no
      FROM gm_image_vector_representative_map`,[s.run_no])
  ]);
  const v=vq.rows[0]||{},m=mq.rows[0]||{};const total=N(v.total_vector),current=N(m.current_done),run0=N(m.excluded_run0);
  return {...s,total_vector:total,candidate_vector:N(v.candidate_vector),current_done:current,previous_run:N(m.previous_run),excluded_run0:run0,unprocessed:Math.max(0,total-current-run0),representatives:N(m.representatives),max_representative_no:N(m.max_representative_no)};
}
router.get('/api/gm/builder/image-vector/representative/status',async(req,res)=>{const db=dbFrom(req);try{ok(res,await status(db));}catch(e){fail(res,500,'representative status failed',{detail:S(e&&e.message||e)});}});
router.get('/api/gm/builder/image-vector/representative/stats',async(req,res)=>{const db=dbFrom(req);try{const s=await settings(db);const r=await db.query(`SELECT representative_no,representative_puid,run_no,member_count,avg_similarity,min_similarity,max_similarity,updated_at FROM gm_image_vector_representative_stat WHERE run_no=$1 ORDER BY member_count DESC,representative_no LIMIT 500`,[s.run_no]);ok(res,{run_no:s.run_no,items:r.rows});}catch(e){fail(res,500,'representative stats failed',{detail:S(e&&e.message||e)});}});
module.exports=router;
