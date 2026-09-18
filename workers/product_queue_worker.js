'use strict';
// GM_PRODUCT_QUEUE_WORKER_V019_UNCLASSIFIED_CATEGORY_KEYWORD_BATCH

const productRouter = require('../routes/product');
const searchController = require('../services/search_controller');

let started = false;
let scheduling = false;
let active = 0;
let timer = null;

function toInt(v, def){
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(1, Math.round(n)) : def;
}

async function fetchQueueRows(pool, limit){
  const client = await pool.connect();
  try{
    await client.query('BEGIN');
    const r = await client.query(`
      SELECT queue_id, request_id, mall_code, keyword, items_json, retry_count
      FROM gm_product_upsert_queue
      WHERE status = 'pending'
      ORDER BY created_at ASC
      LIMIT $1
      FOR UPDATE SKIP LOCKED
    `, [limit]);
    const ids = r.rows.map(x => x.queue_id);
    if(ids.length){
      await client.query(`
        UPDATE gm_product_upsert_queue
        SET status='processing', locked_at=now()
        WHERE queue_id = ANY($1::bigint[])
      `, [ids]);
    }
    await client.query('COMMIT');
    return r.rows;
  }catch(e){
    try{ await client.query('ROLLBACK'); }catch(_){}
    throw e;
  }finally{
    client.release();
  }
}

async function markDone(pool, row, result){
  await pool.query(`
    UPDATE gm_product_upsert_queue
    SET status='done', processed_at=now(), error_message=NULL, result_json=$2::jsonb
    WHERE queue_id=$1
  `, [row.queue_id, JSON.stringify(result || {})]);
}

async function markFailed(pool, row, err, maxRetry){
  const nextRetry = Number(row.retry_count || 0) + 1;
  const nextStatus = nextRetry >= maxRetry ? 'failed' : 'pending';
  await pool.query(`
    UPDATE gm_product_upsert_queue
    SET status=$2, retry_count=$3, error_message=$4, locked_at=NULL,
        processed_at=CASE WHEN $2='failed' THEN now() ELSE processed_at END
    WHERE queue_id=$1
  `, [row.queue_id, nextStatus, nextRetry, String(err && err.message || err).slice(0, 2000)]);
}


async function applyUnclassifiedCategoryKeywordBatch(pool, productUids, incomingKeyword){
  const uids = Array.from(new Set((productUids || []).map(v => String(v || '').trim()).filter(Boolean)));
  const newKeyword = String(incomingKeyword || '').trim();
  if(!uids.length || !newKeyword) return { applied:false, reason:'empty_uid_or_keyword', updated:0 };

  const r = await pool.query(`
    WITH target AS (
      SELECT p.product_uid, p.category_keyword, $2::text AS new_keyword
      FROM gm_product p
      WHERE p.product_uid = ANY($1::text[])
        AND COALESCE(BTRIM(p.glomart_code),'') = ''
        AND EXISTS (
          SELECT 1
          FROM gm_keyword_translate kt
          WHERE BTRIM(COALESCE(kt.main_keyword_ko,'')) = BTRIM($2::text)
        )
    ), merged AS (
      SELECT t.product_uid,
             (
               SELECT string_agg(v.keyword, '|' ORDER BY v.keyword)
               FROM (
                 SELECT DISTINCT BTRIM(t.new_keyword) AS keyword
                 UNION
                 SELECT DISTINCT BTRIM(x) AS keyword
                 FROM unnest(string_to_array(COALESCE(t.category_keyword,''), '|')) AS x
                 WHERE BTRIM(x) <> ''
                   AND EXISTS (
                     SELECT 1
                     FROM gm_keyword_translate kt2
                     WHERE BTRIM(COALESCE(kt2.main_keyword_ko,'')) = BTRIM(x)
                   )
               ) v
               WHERE v.keyword <> ''
             ) AS category_keyword
      FROM target t
    )
    UPDATE gm_product p
       SET category_keyword = m.category_keyword,
           updated_at = now()
      FROM merged m
     WHERE p.product_uid = m.product_uid
       AND COALESCE(m.category_keyword,'') <> ''
       AND COALESCE(p.category_keyword,'') IS DISTINCT FROM COALESCE(m.category_keyword,'')
    RETURNING p.product_uid, p.category_keyword
  `, [uids, newKeyword]);

  return { applied:true, checked:uids.length, updated:r.rowCount || 0, keyword:newKeyword };
}

async function processRow(pool, row){
  const raw = row.items_json;
  const items = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.items) ? raw.items : []);
  const parent = { mall_code: row.mall_code, keyword: row.keyword, requestId: row.request_id };
  let saved = 0;
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let option_received = 0;
  let option_inserted = 0;
  let option_updated = 0;
  let option_skipped = 0;
  let option_nonactive = 0;
  let option_balance_ok = true;
  const skip_reason_count = {};
  const samples = [];
  const errors = [];
  const savedProductUids = [];
  for(const item of items){
    try{
      const r = await productRouter.upsertProduct(pool, item, parent);
      if(r && r.ok){
        saved += 1;
        if(r.item && r.item.product_uid) savedProductUids.push(r.item.product_uid);
        if(r.action === 'inserted') inserted += 1;
        else updated += 1;
        const opt = r.item && r.item.option_result || {};
        option_received += Number(opt.received || 0);
        option_inserted += Number(opt.inserted || 0);
        option_updated += Number(opt.updated || 0);
        option_skipped += Number(opt.skipped || 0);
        option_nonactive += Number(opt.nonactive || 0);
        if(opt.balance_ok === false) option_balance_ok = false;
        if(samples.length < 5){
          samples.push({ action:r.action || 'saved', uid:r.item && r.item.product_uid, hit_count:r.item && r.item.hit_count, option_result:opt });
        }
      }else{
        skipped += 1;
        const reason = (r && r.reason) || 'unknown_skip';
        skip_reason_count[reason] = (skip_reason_count[reason] || 0) + 1;
        if(samples.length < 8){
          samples.push({ action:'skip', reason, missing:r && r.missing, uid:r && r.uid, pi_ii_vi:r && r.pi_ii_vi, product_id:r && r.product_id, url:r && r.source_url, title:r && r.title_sample });
        }
      }
    }catch(e){
      skipped += 1;
      const reason = String(e && e.message || e);
      errors.push(reason);
      skip_reason_count[reason] = (skip_reason_count[reason] || 0) + 1;
      if(samples.length < 8) samples.push({ action:'error', reason });
    }
  }
  option_balance_ok = option_balance_ok && option_received === (option_inserted + option_updated + option_skipped);
  let category_keyword_batch = { applied:false, reason:'not_run', updated:0 };
  try{
    category_keyword_batch = await applyUnclassifiedCategoryKeywordBatch(pool, savedProductUids, row.keyword);
  }catch(e){
    category_keyword_batch = { applied:false, reason:'error', updated:0, error:String(e && e.message || e) };
    console.warn('[GM_PRODUCT_QUEUE_CATEGORY_KEYWORD_BATCH_WARN]', { queue_id:row.queue_id, request_id:row.request_id, keyword:row.keyword, error:category_keyword_batch.error });
  }
  const audit = {
    search_result_count:items.length,
    product_inserted:inserted,
    product_updated:updated,
    product_skipped:skipped,
    product_balance_ok:items.length === (inserted + updated + skipped),
    option_received,
    option_inserted,
    option_updated,
    option_skipped,
    option_nonactive,
    option_balance_ok
  };
  const result = { received: items.length, saved, inserted, updated, skipped, audit, category_keyword_batch, skip_reason_count, samples, errors: errors.slice(0, 5) };
  console.log('[GM_PRODUCT_QUEUE_WORKER_SAVE_AUDIT]', { queue_id:row.queue_id, request_id:row.request_id, mall_code:row.mall_code, keyword:row.keyword, ...audit });
  console.log('[GM_PRODUCT_QUEUE_WORKER_RESULT]', { queue_id:row.queue_id, request_id:row.request_id, mall_code:row.mall_code, keyword:row.keyword, ...result });
  if(items.length && saved === 0){
    // V017: worker가 0건 저장일 때 route/DB 상태 확인을 위해 failed 재시도 루프만 만들지 않고
    // done_with_zero로 남긴다. 실제 원인은 result_json.skip_reason_count / samples에서 확인한다.
    result.zero_saved = true;
    result.warning = 'queue processed but no gm_product rows saved: ' + (Object.keys(skip_reason_count).join(' | ') || 'unknown mapping error');
  }
  return result;
}

async function runClaimed(pool, row, opts){
  active += 1;
  try{
    const result = await processRow(pool, row);
    await markDone(pool, row, result);
  }catch(e){
    await markFailed(pool, row, e, opts.maxRetry);
  }finally{
    active = Math.max(0, active - 1);
    setImmediate(function(){ tick(pool, opts); });
  }
}

async function tick(pool, opts){
  if(scheduling) return;
  scheduling = true;
  try{
    const allowedConcurrency = await searchController.allowedConcurrency(pool, active);
    const available = Math.max(0, allowedConcurrency - active);
    if(available <= 0) return;
    const rows = await fetchQueueRows(pool, Math.min(opts.batchRows, available));
    for(const row of rows){
      // Claim is already committed as status=processing. Each claimed queue_id gets one runner.
      void runClaimed(pool, row, opts);
    }
  }catch(e){
    console.error('[GM_PRODUCT_QUEUE_WORKER] tick failed:', String(e && e.message || e));
  }finally{
    scheduling = false;
  }
}

function startProductQueueWorker(pool, options){
  if(started) return { started:false, reason:'already_started' };
  if(!pool || typeof pool.query !== 'function') return { started:false, reason:'invalid_pool' };
  const opts = Object.assign({
    intervalMs: toInt(process.env.GM_PRODUCT_QUEUE_INTERVAL_MS, 5000),
    batchRows: toInt(process.env.GM_PRODUCT_QUEUE_BATCH_ROWS, 10),
    maxRetry: toInt(process.env.GM_PRODUCT_QUEUE_MAX_RETRY, 3)
  }, options || {});
  started = true;
  timer = setInterval(function(){ tick(pool, opts); }, opts.intervalMs);
  if(timer && timer.unref) timer.unref();
  setTimeout(function(){ tick(pool, opts); }, 1000);
  console.log('[GM_PRODUCT_QUEUE_WORKER] started', opts);
  return { started:true, opts };
}

module.exports = { startProductQueueWorker };
