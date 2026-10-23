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
// No POST refresh endpoint yet: cannot bypass existing authenticated derzon-session policy.
module.exports=router;
