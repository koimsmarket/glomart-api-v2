'use strict';
// GM_VECTOR_CATEGORY_GROUP_UPLOAD_V002
// Dedicated UPDATE-ONLY importer for the small file:
//   product_uid,category_group
// It never inserts vectors and never touches vector_image/candidate_vector/class_id.
const express = require('express');
const router = express.Router();
const { dbFrom, parseCsv } = require('./core');

function clean(v){ return String(v == null ? '' : v).trim(); }

router.post('/api/gm/builder/image-vector/category-group/import',
  express.text({type:['text/*','application/csv'], limit:'15mb'}), async (req,res)=>{
    const db=dbFrom(req);
    const started=Date.now();
    const batch=String(req.query.batch||''); const batches=String(req.query.batches||'');
    console.log('[GM_VECTOR_CATEGORY_GROUP_UPLOAD_V002 REQUEST]', JSON.stringify({apply:req.query.apply||'',batch,batches,content_length:req.headers['content-length']||null}));
    const apply=String(req.query.apply||'').toUpperCase()==='YES';
    let rows;
    try{ rows=parseCsv(req.body); }
    catch(e){ return res.status(400).json({ok:false,error:'CSV_PARSE_FAILED',detail:String(e&&e.message||e)}); }
    if(!rows.length)return res.status(400).json({ok:false,error:'NO_ROWS'});
    if(rows.length>200000)return res.status(400).json({ok:false,error:'TOO_MANY_ROWS',limit:200000});

    const seen=new Set(), valid=[], issues=[];
    for(const row of rows){
      const uid=clean(row.product_uid);
      const group=clean(row.category_group).toUpperCase();
      if(!uid){ issues.push({row_no:row.__row_no||'',reason:'MISSING_PRODUCT_UID'}); continue; }
      if(!/^[A-Z]{2}$/.test(group)){ issues.push({row_no:row.__row_no||'',product_uid:uid,reason:'INVALID_CATEGORY_GROUP'}); continue; }
      if(seen.has(uid)){ issues.push({row_no:row.__row_no||'',product_uid:uid,reason:'DUPLICATE_PRODUCT_UID'}); continue; }
      seen.add(uid); valid.push([uid,group]);
    }
    if(!valid.length)return res.status(400).json({ok:false,error:'NO_VALID_ROWS',invalid:issues.length,issues:issues.slice(0,100)});

    const client=await db.connect();
    try{
      await client.query('BEGIN');
      const uids=valid.map(x=>x[0]), groups=valid.map(x=>x[1]);
      const found=await client.query(`
        SELECT COUNT(*)::int n
          FROM gm_product_image_vector v
          JOIN UNNEST($1::text[]) AS x(product_uid) ON x.product_uid=v.product_uid
      `,[uids]);
      const matched=Number(found.rows[0].n||0), not_found=valid.length-matched;
      let updated=0;
      if(apply){
        const r=await client.query(`
          UPDATE gm_product_image_vector v
             SET category_group=x.category_group
            FROM UNNEST($1::text[],$2::text[]) AS x(product_uid,category_group)
           WHERE v.product_uid=x.product_uid
             AND v.category_group IS DISTINCT FROM x.category_group::char(2)
        `,[uids,groups]);
        updated=r.rowCount||0;
      }
      await client.query(apply?'COMMIT':'ROLLBACK');
      const payload={ok:true,apply,input_rows:rows.length,valid:valid.length,invalid:issues.length,matched,not_found,updated,issues:issues.slice(0,100)};
      console.log('[GM_VECTOR_CATEGORY_GROUP_UPLOAD_V002 COMPLETE]', JSON.stringify({batch,batches,ms:Date.now()-started,...payload,issues:undefined}));
      return res.json(payload);
    }catch(e){
      await client.query('ROLLBACK').catch(()=>{});
      console.error('[GM_VECTOR_CATEGORY_GROUP_UPLOAD_V002 ERROR]', JSON.stringify({batch,batches,ms:Date.now()-started,error:String(e&&e.message||e)}));
      return res.status(500).json({ok:false,error:'VECTOR_CATEGORY_GROUP_IMPORT_FAILED',detail:String(e&&e.message||e)});
    }finally{client.release();}
  });

module.exports=router;
