'use strict';
const express = require('express');
const router = express.Router();

function C(v){ return String(v == null ? '' : v).trim(); }

async function resolveDictionaryTable(pool){
  const preferred=['gm_ui_dictionary','ui_dictionary'];
  const q=await pool.query(`
    SELECT table_name,
           COUNT(*) FILTER (WHERE column_name='gm_code') AS has_gm_code,
           COUNT(*) FILTER (WHERE column_name='kr') AS has_kr,
           COUNT(*) FILTER (WHERE column_name='active_yn') AS has_active
    FROM information_schema.columns
    WHERE table_schema='public'
    GROUP BY table_name
    HAVING COUNT(*) FILTER (WHERE column_name='gm_code') > 0
       AND COUNT(*) FILTER (WHERE column_name='kr') > 0
    ORDER BY table_name
  `);
  const names=(q.rows||[]).map(r=>C(r.table_name));
  for(const name of preferred) if(names.includes(name)) return name;
  const fallback=names.find(n=>/ui.*dictionary|dictionary.*ui/i.test(n));
  if(fallback) return fallback;
  throw new Error('UI dictionary table not found');
}

function qi(name){ return '"'+String(name).replace(/"/g,'""')+'"'; }

router.get('/api/gm/ui-dictionary/admin/list', async (req,res)=>{
  const pool=req.app.locals.pool;
  if(!pool) return res.status(503).json({ok:false,error:'db unavailable'});
  try{
    const table=await resolveDictionaryTable(pool);
    const q=C(req.query.q);
    const limit=Math.min(500,Math.max(1,Number(req.query.limit||100)||100));
    const offset=Math.max(0,Number(req.query.offset||0)||0);
    const vals=[];
    let where='';
    if(q){
      vals.push('%'+q+'%');
      where=`WHERE gm_code ILIKE $1 OR kr ILIKE $1 OR COALESCE(page_name,'') ILIKE $1`;
    }
    vals.push(limit,offset);
    const li=vals.length-1, oi=vals.length;
    const sql=`SELECT gm_code,page_name,kr,active_yn,translation_status,updated_at,use_count,last_used_at
               FROM ${qi(table)} ${where}
               ORDER BY updated_at DESC NULLS LAST, gm_code
               LIMIT $${li} OFFSET $${oi}`;
    const rows=(await pool.query(sql,vals)).rows||[];
    res.json({ok:true,table,count:rows.length,rows});
  }catch(e){
    res.status(500).json({ok:false,error:String(e&&e.message||e)});
  }
});

router.delete('/api/gm/ui-dictionary/admin/items', async (req,res)=>{
  const pool=req.app.locals.pool;
  if(!pool) return res.status(503).json({ok:false,error:'db unavailable'});
  try{
    const codes=Array.from(new Set((Array.isArray(req.body&&req.body.gm_codes)?req.body.gm_codes:[]).map(C).filter(Boolean)));
    if(!codes.length) return res.status(400).json({ok:false,error:'gm_codes required'});
    if(codes.length>200) return res.status(400).json({ok:false,error:'max 200 rows per delete'});
    if(C(req.body&&req.body.confirm)!=='DELETE') return res.status(400).json({ok:false,error:'confirm=DELETE required'});
    const table=await resolveDictionaryTable(pool);
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      const before=await client.query(`SELECT gm_code,kr,page_name FROM ${qi(table)} WHERE gm_code = ANY($1::text[])`,[codes]);
      const del=await client.query(`DELETE FROM ${qi(table)} WHERE gm_code = ANY($1::text[]) RETURNING gm_code`,[codes]);
      await client.query('COMMIT');
      console.log('[GM_UI_DICTIONARY_ADMIN_DELETE]',JSON.stringify({requested:codes.length,deleted:del.rowCount,codes:(del.rows||[]).map(r=>r.gm_code)}));
      return res.json({ok:true,table,requested:codes.length,deleted:del.rowCount,deleted_codes:(del.rows||[]).map(r=>r.gm_code),deleted_rows:before.rows||[]});
    }catch(e){
      try{await client.query('ROLLBACK');}catch(_e){}
      throw e;
    }finally{client.release();}
  }catch(e){
    res.status(500).json({ok:false,error:String(e&&e.message||e)});
  }
});

module.exports=router;
