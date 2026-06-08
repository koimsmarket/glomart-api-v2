const express = require('express');
const router = express.Router();

function db(req){ return req.app.locals.db || req.app.locals.pool; }
function ok(res, data){ res.json({ ok:true, ...data }); }
function fail(res, status, message, extra={}){ res.status(status).json({ ok:false, error:message, ...extra }); }
function qIdent(s){ return '"' + String(s).replace(/"/g, '""') + '"'; }
function n(v){ const x = Number(v); return Number.isFinite(x) ? x : 0; }
function clampLimit(v, def=20, max=100){ const x = parseInt(v,10); return Math.min(max, Math.max(1, Number.isFinite(x) ? x : def)); }

async function tableExists(pool, table){
  const r = await pool.query(`SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1 LIMIT 1`, [table]);
  return r.rowCount > 0;
}
async function columnExists(pool, table, column){
  const r = await pool.query(`SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name=$2 LIMIT 1`, [table, column]);
  return r.rowCount > 0;
}
async function countTable(pool, table){
  if(!(await tableExists(pool, table))) return null;
  const r = await pool.query(`SELECT COUNT(*)::int AS count FROM ${qIdent(table)}`);
  return r.rows[0].count;
}
async function safeQuery(pool, sql, vals=[], fallback=[]){
  try{ const r = await pool.query(sql, vals); return r.rows; }
  catch(e){ return fallback; }
}

const COUNT_TABLES = [
  'gm_product','gm_product_archive','gm_search_log','gm_search_keyword_stat','gm_category_search_stat',
  'gm_category','gm_category_keyword','gm_product_upsert_queue','gm_basket','gm_order','gm_order_item',
  'gm_supplier','gm_cs','gm_cs_message','gm_dashboard_snapshot'
];

router.get('/api/gm/dashboard/ops', async (req,res)=>{
  const pool = db(req);
  if(!pool) return fail(res, 500, 'DB pool is not attached');
  const limit = clampLimit(req.query.limit, 20, 100);
  const started = Date.now();
  try{
    const counts = {};
    for(const t of COUNT_TABLES){ counts[t] = await countTable(pool, t); }

    const queueStatus = await safeQuery(pool, `
      SELECT status, COUNT(*)::int AS count
      FROM gm_product_upsert_queue
      GROUP BY status
      ORDER BY status
    `);
    const queueRecent = await safeQuery(pool, `
      SELECT queue_id, request_id, mall_code, keyword, item_count, status, retry_count, error_message, result_json, created_at, processed_at
      FROM gm_product_upsert_queue
      ORDER BY created_at DESC
      LIMIT $1
    `, [limit]);

    const topKeywords = await safeQuery(pool, `
      SELECT keyword_normalized, country_code, lang_code, mall_code, category_no,
             COALESCE(search_count,0)::int AS search_count,
             COALESCE(result_count_sum,0)::int AS result_count_sum,
             COALESCE(queue_send_count_sum,0)::int AS queue_send_count_sum,
             last_search_at
      FROM gm_search_keyword_stat
      ORDER BY COALESCE(search_count,0) DESC, last_search_at DESC NULLS LAST
      LIMIT $1
    `, [limit]);

    const recentSearches = await safeQuery(pool, `
      SELECT search_id, keyword_original, keyword_normalized, ui_lang_code, keyword_lang_code, country_code, mall_code,
             cache_used, result_count, db_insert_count, queue_send_count, search_at, created_at
      FROM gm_search_log
      ORDER BY search_at DESC NULLS LAST, created_at DESC NULLS LAST
      LIMIT $1
    `, [limit]);

    const recentProducts = await safeQuery(pool, `
      SELECT product_uid, mall_code, category_keyword, product_name, mall_sale_price, final_supply_price,
             hit_count, view_count, search_count, thumb_origin_url, product_url, created_at, updated_at, last_seen_at
      FROM gm_product
      ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
      LIMIT $1
    `, [limit]);

    const newProductsToday = await safeQuery(pool, `
      SELECT COUNT(*)::int AS count
      FROM gm_product
      WHERE created_at >= date_trunc('day', now())
    `).then(r => r[0]?.count ?? null);
    const updatedProductsToday = await safeQuery(pool, `
      SELECT COUNT(*)::int AS count
      FROM gm_product
      WHERE updated_at >= date_trunc('day', now())
    `).then(r => r[0]?.count ?? null);
    const searchesToday = await safeQuery(pool, `
      SELECT COUNT(*)::int AS count
      FROM gm_search_log
      WHERE COALESCE(search_at, created_at) >= date_trunc('day', now())
    `).then(r => r[0]?.count ?? null);

    const topProducts = await safeQuery(pool, `
      SELECT product_uid, mall_code, category_keyword, product_name, mall_sale_price,
             COALESCE(hit_count,0)::int AS hit_count,
             COALESCE(view_count,0)::int AS view_count,
             COALESCE(search_count,0)::int AS search_count,
             updated_at
      FROM gm_product
      ORDER BY COALESCE(hit_count,0) DESC, COALESCE(view_count,0) DESC, updated_at DESC NULLS LAST
      LIMIT $1
    `, [limit]);

    const categoryKeyword = await safeQuery(pool, `
      SELECT category_keyword, COUNT(*)::int AS product_count,
             SUM(COALESCE(hit_count,0))::int AS hit_count,
             MAX(updated_at) AS last_updated_at
      FROM gm_product
      WHERE COALESCE(category_keyword,'') <> ''
      GROUP BY category_keyword
      ORDER BY product_count DESC, last_updated_at DESC NULLS LAST
      LIMIT $1
    `, [limit]);

    const dbSize = await safeQuery(pool, `
      SELECT pg_database_size(current_database())::bigint AS bytes,
             ROUND(pg_database_size(current_database()) / 1024.0 / 1024.0, 2) AS mb
    `).then(r => r[0] || null);

    const queueSummary = queueStatus.reduce((a,r)=>{ a[r.status] = n(r.count); return a; }, {});
    queueSummary.total = Object.values(queueSummary).reduce((a,b)=>a+n(b),0);

    ok(res, {
      action:'dashboard.ops',
      generated_at:new Date().toISOString(),
      api_response_ms:Date.now()-started,
      counts,
      today:{ products_new:newProductsToday, products_updated:updatedProductsToday, searches:searchesToday },
      queue:{ status:queueStatus, summary:queueSummary, recent:queueRecent },
      search:{ top_keywords:topKeywords, recent:recentSearches },
      product:{ recent:recentProducts, top:topProducts, category_keyword:categoryKeyword },
      db_size:dbSize
    });
  }catch(e){
    fail(res, 500, 'dashboard ops failed', { detail:String(e && e.message || e) });
  }
});

module.exports = router;
