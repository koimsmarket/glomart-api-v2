// GM_BUILDER_IMAGE_VECTOR_SYNC_PRODUCTS_V006_ALI_OPTION_IDENTITY
// Manual Builder operation only.
// Reconciles vector rows against current gm_product using the vector UID's stable PID/mall identity.
// Option-level vector UIDs (PID_IID_VID) are NOT treated as orphans merely because gm_product.product_uid differs.
// Every actual vector DELETE is delegated to services/image_vector_write.js so representative state
// and the vector row change commit together under the same short mutation lock used by UPSERT.
const express = require('express');
const router = express.Router();
const { dbFrom, ok, fail } = require('../core');
const {deleteImageVectorsOnClient,MUTATION_LOCK_KEY}=require('../../../services/image_vector_write');

const ORPHAN_SQL=`NOT EXISTS (
  SELECT 1 FROM gm_product p
   WHERE p.product_uid=v.product_uid
      OR (
        (CASE WHEN v.product_uid ~* '^(CPKR_|ALKR_)[0-9]+_[0-9]+(_[0-9]+)?$' THEN regexp_replace(v.product_uid,'^(CPKR_|ALKR_)','','i')
              WHEN v.product_uid ~ '^[0-9]+_[0-9]+_[0-9]+$' THEN v.product_uid ELSE '' END)<>''
        AND p.mall_code=(CASE WHEN v.product_uid ~* '^ALKR_' THEN 'ALKR' ELSE 'CPKR' END)
        AND p.pi_ii_vi=(CASE WHEN v.product_uid ~* '^(CPKR_|ALKR_)[0-9]+_[0-9]+(_[0-9]+)?$' THEN regexp_replace(v.product_uid,'^(CPKR_|ALKR_)','','i') ELSE v.product_uid END)
      )
      OR (
        NOT (v.product_uid ~* '^(CPKR_|ALKR_)[0-9]+_[0-9]+(_[0-9]+)?$' OR v.product_uid ~ '^[0-9]+_[0-9]+_[0-9]+$')
        AND p.product_id=(CASE WHEN v.product_uid ~* '^(CPKR_|ALKR_)?[0-9]+' THEN (regexp_match(v.product_uid,'^(?:CPKR_|ALKR_)?([0-9]+)','i'))[1] ELSE v.product_uid END)
        AND (
          (CASE WHEN v.product_uid ~* '^CPKR_' THEN 'CPKR' WHEN v.product_uid ~* '^ALKR_' THEN 'ALKR' ELSE '' END)=''
          OR p.mall_code=(CASE WHEN v.product_uid ~* '^CPKR_' THEN 'CPKR' WHEN v.product_uid ~* '^ALKR_' THEN 'ALKR' ELSE '' END)
        )
      )
)`;

router.post('/api/gm/builder/image-vector/sync-products', async (req,res)=>{
  const db=dbFrom(req);if(!db)return fail(res,500,'DB_NOT_READY');
  const client=typeof db.connect==='function' ? await db.connect() : db;
  const release=client!==db && typeof client.release==='function';
  try{
    await client.query('BEGIN');
    // Lock BEFORE detecting orphans. This closes the race where an UPSERT and sync-delete
    // could otherwise cross each other between orphan selection and DELETE.
    await client.query('SELECT pg_advisory_xact_lock($1)',[MUTATION_LOCK_KEY]);
    const build=await client.query(`SELECT config_value FROM gm_runtime_config WHERE config_key='image_vector_representative_building'`);
    const buildId=String(build.rows&&build.rows[0]&&build.rows[0].config_value||'').trim();
    if(buildId){
      await client.query('ROLLBACK');
      return fail(res,409,'REPRESENTATIVE_REBUILD_RUNNING',{build_id:buildId,detail:'벡터 삭제 동기화는 대표망 전체 재생성 완료 후 실행해야 합니다.'});
    }
    const before=await client.query(`SELECT
      (SELECT COUNT(*)::int FROM gm_product) AS product_count,
      (SELECT COUNT(*)::int FROM gm_product_image_vector) AS vector_before,
      (SELECT COUNT(*)::int FROM gm_product_image_vector v WHERE ${ORPHAN_SQL}) AS orphan_before`);
    const orphan=await client.query(`SELECT v.product_uid FROM gm_product_image_vector v WHERE ${ORPHAN_SQL} ORDER BY v.product_uid`);
    const orphanIds=(orphan.rows||[]).map(r=>String(r.product_uid||'').trim()).filter(Boolean);
    const del=await deleteImageVectorsOnClient(client,orphanIds,{rejectDuringBuild:true});
    const after=await client.query('SELECT COUNT(*)::int AS vector_after FROM gm_product_image_vector');
    await client.query('COMMIT');
    const b=before.rows[0]||{};
    ok(res,{action:'image-vector.sync-products',identity_policy:'exact product_uid -> option pi_ii_vi+mall -> PID+mall for non-option UID',mutation_policy:'CENTRAL_DELETE',product_count:Number(b.product_count||0),vector_before:Number(b.vector_before||0),orphan_before:Number(b.orphan_before||0),deleted:del.deleted,representative_children_moved_run0:del.representative_children_moved_run0,representative_children_reassigned:del.representative_children_reassigned,representative_map_deleted:del.representative_map_deleted,representative_stat_deleted:del.representative_stat_deleted,vector_after:Number(after.rows[0]&&after.rows[0].vector_after||0)});
  }catch(e){
    try{ await client.query('ROLLBACK'); }catch(_){}
    if(e&&e.code==='REPRESENTATIVE_REBUILD_RUNNING')return fail(res,409,'REPRESENTATIVE_REBUILD_RUNNING',{build_id:e.build_id||'',detail:'벡터 삭제 동기화는 대표망 전체 재생성 완료 후 실행해야 합니다.'});
    fail(res,500,'IMAGE_VECTOR_PRODUCT_SYNC_FAILED',{detail:String(e&&e.message||e)});
  }finally{if(release)client.release();}
});
module.exports=router;
