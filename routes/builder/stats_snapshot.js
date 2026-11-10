'use strict';
// GM_BUILDER_STATS_V007: read-only cached snapshots. Never trigger table scans on page load.
const express = require('express');
const router = express.Router();
router.get('/api/gm/builder/stats/snapshot', async (req,res)=>{
  res.set('Cache-Control','no-store');
  const db = req.app.locals.pool || req.app.locals.db;
  if (!db) return res.status(503).json({ok:false,code:'STATS_DB_UNAVAILABLE'});
  try {
    const result=await db.query(`SELECT service_code,major_category,sub_category,table_name,row_count,data_bytes,index_bytes,count_type,calculated_at
      FROM gm_builder_table_stats ORDER BY service_code,major_category,table_name`);
    if(result.rows.length) return res.json({ok:true,items:result.rows,read_only:true,refreshed:false});
    // Legacy snapshots supply prior values even before the new table has data.
    const legacy=await db.query(`SELECT * FROM gm_dashboard_snapshot ORDER BY snapshot_at DESC, snapshot_id DESC LIMIT 1`);
    const row=legacy.rows[0];
    const items=row?Object.keys(row).filter(k=>/^gm_[a-z0-9_]+_count$/.test(k)).map(k=>({
      service_code:'GLOMART', major_category:'LEGACY', table_name:k.slice(0,-6),
      row_count:row[k], calculated_at:row.snapshot_at, count_type:'SNAPSHOT'
    })):[];
    res.json({ok:true,items,read_only:true,refreshed:false,legacy:!!row});
  } catch(e) {
    if (e.code==='42P01') {
      try {
        const legacy=await db.query(`SELECT * FROM gm_dashboard_snapshot ORDER BY snapshot_at DESC, snapshot_id DESC LIMIT 1`);
        const row=legacy.rows[0];
        const items=row?Object.keys(row).filter(k=>/^gm_[a-z0-9_]+_count$/.test(k)).map(k=>({
          service_code:'GLOMART',major_category:'LEGACY',table_name:k.slice(0,-6),
          row_count:row[k],calculated_at:row.snapshot_at,count_type:'SNAPSHOT'
        })):[];
        return res.json({ok:true,items,setup_required:true,read_only:true,legacy:true});
      } catch(_) {return res.json({ok:true,items:[],setup_required:true,read_only:true});}
    }
    console.warn('[GM_BUILDER_STATS_V007]',e.code||'query_failed');
    res.status(503).json({ok:false,code:'STATS_SNAPSHOT_UNAVAILABLE'});
  }
});
// GM_BUILDER_STATS_V008: manual, catalog-estimate-only snapshot. Never scan rows or run periodically.
// This endpoint passes the existing admin session gate and per-operation derzon hash reauthentication.
router.post('/api/gm/builder/stats/refresh', async (req,res)=>{
  res.set('Cache-Control','no-store');
  const pool=req.app.locals.pool;
  if(!pool || typeof pool.connect!=='function')return res.status(503).json({ok:false,code:'STATS_DB_UNAVAILABLE'});
  let client;
  try {
    client=await pool.connect();
    await client.query('BEGIN');
    await client.query("SET LOCAL statement_timeout = '15000ms'");
    // pg_class.reltuples is a row ESTIMATE; size functions read relation metadata.
    // No SELECT COUNT(*), ANALYZE, pg_stat_scan, or background job.
    const result=await client.query(`
      INSERT INTO gm_builder_table_stats
        (service_code,major_category,sub_category,table_name,row_count,data_bytes,index_bytes,count_type,calculated_at)
      SELECT 'GLOMART','DATABASE','public',c.relname,
             CASE WHEN c.reltuples >= 0 THEN ROUND(c.reltuples)::bigint ELSE NULL END,
             pg_table_size(c.oid)::bigint,
             pg_indexes_size(c.oid)::bigint,
             'ESTIMATE',NOW()
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind IN ('r','p')
        AND c.relname <> 'gm_builder_table_stats'
      ON CONFLICT (service_code,table_name) DO UPDATE SET
        major_category=EXCLUDED.major_category,
        sub_category=EXCLUDED.sub_category,
        row_count=EXCLUDED.row_count,
        data_bytes=EXCLUDED.data_bytes,
        index_bytes=EXCLUDED.index_bytes,
        count_type=EXCLUDED.count_type,
        calculated_at=EXCLUDED.calculated_at
      RETURNING table_name`);
    // Drop stale snapshot names only for this service after a successful full catalog listing.
    await client.query(`DELETE FROM gm_builder_table_stats s
      WHERE s.service_code='GLOMART' AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relkind IN ('r','p')
          AND c.relname=s.table_name AND c.relname <> 'gm_builder_table_stats')`);
    await client.query('COMMIT');
    return res.json({ok:true,refreshed:true,count:result.rowCount,method:'CATALOG_ESTIMATE'});
  }catch(e){
    if(client)try{await client.query('ROLLBACK');}catch(_){}
    if(e.code==='42P01')return res.status(409).json({ok:false,code:'STATS_MIGRATION_REQUIRED'});
    if(e.code==='42501')return res.status(403).json({ok:false,code:'STATS_DB_PERMISSION_DENIED'});
    console.warn('[GM_BUILDER_STATS_V008] REFRESH_FAIL',e.code||'query_failed');
    return res.status(503).json({ok:false,code:'STATS_REFRESH_UNAVAILABLE'});
  }finally{if(client)client.release();}
});
module.exports=router;
