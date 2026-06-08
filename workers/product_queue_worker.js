'use strict';

const productRouter = require('../routes/product');

let started = false;
let running = false;
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

async function processRow(pool, row){
  const raw = row.items_json;
  const items = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.items) ? raw.items : []);
  const parent = { mall_code: row.mall_code, keyword: row.keyword, requestId: row.request_id };
  let saved = 0;
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  const skip_reason_count = {};
  const samples = [];
  const errors = [];
  for(const item of items){
    try{
      const r = await productRouter.upsertProduct(pool, item, parent);
      if(r && r.ok){
        saved += 1;
        if(r.action === 'inserted') inserted += 1;
        else updated += 1;
        if(samples.length < 5){
          samples.push({ action:r.action || 'saved', uid:r.item && r.item.product_uid, hit_count:r.item && r.item.hit_count });
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
  const result = { received: items.length, saved, inserted, updated, skipped, skip_reason_count, samples, errors: errors.slice(0, 5) };
  console.log('[GM_PRODUCT_QUEUE_WORKER_RESULT]', { queue_id:row.queue_id, request_id:row.request_id, mall_code:row.mall_code, keyword:row.keyword, ...result });
  if(items.length && saved === 0){
    const e = new Error('queue processed but no gm_product rows saved: ' + (Object.keys(skip_reason_count).join(' | ') || 'unknown mapping error'));
    e.result = result;
    throw e;
  }
  return result;
}

async function tick(pool, opts){
  if(running) return;
  running = true;
  try{
    const rows = await fetchQueueRows(pool, opts.batchRows);
    for(const row of rows){
      try{
        const result = await processRow(pool, row);
        await markDone(pool, row, result);
      }catch(e){
        await markFailed(pool, row, e, opts.maxRetry);
      }
    }
  }catch(e){
    console.error('[GM_PRODUCT_QUEUE_WORKER] tick failed:', String(e && e.message || e));
  }finally{
    running = false;
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
