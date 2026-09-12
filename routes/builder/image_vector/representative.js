'use strict';
// GM_BUILDER_IMAGE_VECTOR_REPRESENTATIVE_V023_ALI_OPTION_IDENTITY
// Lightweight representative status/statistics only. No category/vector bulk scan here.

const express=require('express');
const router=express.Router();
const {dbFrom,ok,fail}=require('../core');
const DIM=512;
function S(v){return String(v==null?'':v).trim();}
function N(v,d=0){const n=Number(v);return Number.isFinite(n)?n:d;}
async function config(db,key,def){const r=await db.query('SELECT config_value FROM gm_runtime_config WHERE config_key=$1',[key]);return r.rows.length?r.rows[0].config_value:def;}
async function settings(db){const run=Math.max(1,Math.trunc(N(await config(db,'image_vector_representative_run','1'),1)));const threshold=N(await config(db,'image_vector_representative_similarity','0.95'),0.95);if(!(threshold>0&&threshold<=1))throw new Error('대표이미지 유사율은 0 초과 1 이하여야 합니다.');return {run_no:run,threshold};}
async function liveSettings(db,target){
  target=target||await settings(db);
  const run=Math.max(1,Math.trunc(N(await config(db,'image_vector_representative_live_run',target.run_no),target.run_no)));
  const threshold=N(await config(db,'image_vector_representative_live_similarity',target.threshold),target.threshold);
  const epoch=Math.max(0,Math.trunc(N(await config(db,'image_vector_representative_live_epoch','0'),0)));
  return {run_no:run,threshold,epoch};
}
async function status(db){
  const target=await settings(db),live=await liveSettings(db,target);
  const [vq,mq]=await Promise.all([
    db.query(`WITH vv AS (
        SELECT v.product_uid AS puid,v.vector_image,
               CASE WHEN v.product_uid ~* '^(CPKR_|ALKR_)?[0-9]+' THEN (regexp_match(v.product_uid,'^(?:CPKR_|ALKR_)?([0-9]+)','i'))[1] ELSE v.product_uid END AS pid,
               CASE WHEN v.product_uid ~* '^CPKR_' OR v.product_uid ~ '^[0-9]+_[0-9]+_[0-9]+$' THEN 'CPKR'
                    WHEN v.product_uid ~* '^ALKR_' THEN 'ALKR' ELSE '' END AS mall,
               CASE WHEN v.product_uid ~* '^(CPKR_|ALKR_)[0-9]+_[0-9]+(_[0-9]+)?$' THEN regexp_replace(v.product_uid,'^(CPKR_|ALKR_)','','i')
                    WHEN v.product_uid ~ '^[0-9]+_[0-9]+_[0-9]+$' THEN v.product_uid ELSE '' END AS pi
          FROM gm_product_image_vector v
      )
      SELECT COUNT(*) FILTER (WHERE vv.vector_image IS NOT NULL AND array_length(vv.vector_image,1)=$1)::int AS total_vector,
             COUNT(*) FILTER (WHERE vv.vector_image IS NOT NULL AND array_length(vv.vector_image,1)=$1 AND p.found=1 AND COALESCE(NULLIF(BTRIM(p.category_keyword),''),NULLIF(BTRIM(p.keyword),'')) IS NOT NULL)::int AS candidate_vector
        FROM vv
        LEFT JOIN LATERAL (
          SELECT 1 AS found,p.category_keyword,p.keyword
            FROM gm_product p
           WHERE p.product_uid=vv.puid
              OR (vv.pi<>'' AND p.pi_ii_vi=vv.pi AND (vv.mall='' OR p.mall_code=vv.mall))
              OR (vv.pi='' AND p.product_id=vv.pid AND (vv.mall='' OR p.mall_code=vv.mall))
           ORDER BY CASE WHEN p.product_uid=vv.puid THEN 0 WHEN vv.pi<>'' AND p.pi_ii_vi=vv.pi THEN 1 ELSE 2 END,
                    COALESCE(p.updated_at,p.last_seen_at) DESC NULLS LAST
           LIMIT 1
        ) p ON TRUE`,[DIM]),
    db.query(`SELECT
      COUNT(*) FILTER (WHERE run_no=$1)::int AS current_done,
      COUNT(*) FILTER (WHERE run_no=0)::int AS excluded_run0,
      COUNT(*) FILTER (WHERE run_no=$1 AND representative_puid=puid)::int AS representatives,
      COALESCE(MAX(representative_no) FILTER (WHERE run_no=$1),0)::bigint AS max_representative_no
      FROM gm_image_vector_representative_map`,[live.run_no])
  ]);
  const v=vq.rows[0]||{},m=mq.rows[0]||{};const total=N(v.total_vector),current=N(m.current_done),run0=N(m.excluded_run0);
  return {run_no:target.run_no,threshold:target.threshold,target_run_no:target.run_no,target_threshold:target.threshold,live_run_no:live.run_no,live_threshold:live.threshold,live_epoch:live.epoch,total_vector:total,candidate_vector:N(v.candidate_vector),current_done:current,excluded_run0:run0,unprocessed:Math.max(0,total-current-run0),representatives:N(m.representatives),max_representative_no:N(m.max_representative_no)};
}
router.get('/api/gm/builder/image-vector/representative/status',async(req,res)=>{const db=dbFrom(req);try{ok(res,await status(db));}catch(e){fail(res,500,'representative status failed',{detail:S(e&&e.message||e)});}});
router.get('/api/gm/builder/image-vector/representative/stats',async(req,res)=>{const db=dbFrom(req);try{const target=await settings(db),live=await liveSettings(db,target);const r=await db.query(`SELECT representative_no,representative_puid,run_no,member_count,avg_similarity,min_similarity,max_similarity,updated_at FROM gm_image_vector_representative_stat WHERE run_no=$1 ORDER BY member_count DESC,representative_no LIMIT 500`,[live.run_no]);ok(res,{run_no:live.run_no,live_run_no:live.run_no,live_epoch:live.epoch,target_run_no:target.run_no,items:r.rows});}catch(e){fail(res,500,'representative stats failed',{detail:S(e&&e.message||e)});}});
module.exports=router;
