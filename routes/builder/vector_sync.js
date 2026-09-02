// GM_IMAGE_VECTOR_PRODUCT_SYNC_V001
// Manual Builder operation only.
// Deletes image vectors whose product_uid no longer exists in gm_product.
// Does not modify gm_product, pending queue, vector generation, or image URLs.

const express = require('express');
const router = express.Router();
const { dbFrom, ok, fail } = require('./core');

router.post('/api/gm/builder/image-vector/sync-products', async (req,res)=>{
  const db=dbFrom(req);
  if(!db)return fail(res,500,'DB_NOT_READY');

  const client=typeof db.connect==='function' ? await db.connect() : db;
  const release=client!==db && typeof client.release==='function';

  try{
    await client.query('BEGIN');

    const before=await client.query(`
      SELECT
        (SELECT COUNT(*)::int FROM gm_product) AS product_count,
        (SELECT COUNT(*)::int FROM gm_product_image_vector) AS vector_before,
        (
          SELECT COUNT(*)::int
          FROM gm_product_image_vector v
          WHERE NOT EXISTS (
            SELECT 1 FROM gm_product p WHERE p.product_uid=v.product_uid
          )
        ) AS orphan_before
    `);

    const del=await client.query(`
      DELETE FROM gm_product_image_vector v
      WHERE NOT EXISTS (
        SELECT 1
        FROM gm_product p
        WHERE p.product_uid=v.product_uid
      )
    `);

    const after=await client.query('SELECT COUNT(*)::int AS vector_after FROM gm_product_image_vector');

    await client.query('COMMIT');

    const b=before.rows[0]||{};
    ok(res,{
      action:'image-vector.sync-products',
      product_count:Number(b.product_count||0),
      vector_before:Number(b.vector_before||0),
      orphan_before:Number(b.orphan_before||0),
      deleted:Number(del.rowCount||0),
      vector_after:Number(after.rows[0]&&after.rows[0].vector_after||0)
    });
  }catch(e){
    try{ await client.query('ROLLBACK'); }catch(_){}
    fail(res,500,'IMAGE_VECTOR_PRODUCT_SYNC_FAILED',{detail:String(e&&e.message||e)});
  }finally{
    if(release)client.release();
  }
});

module.exports=router;
