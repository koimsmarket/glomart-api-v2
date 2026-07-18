'use strict';

let started = false;

function clean(v){ return v == null ? '' : String(v).trim(); }

async function claimOne(pool){
  const client = await pool.connect();
  try{
    await client.query('BEGIN');
    const r = await client.query(
      `SELECT * FROM gm_event_queue
       WHERE (
         (status='PENDING' AND next_retry_at<=NOW()) OR
         (status='PROCESSING' AND locked_at < NOW() - INTERVAL '5 minutes')
       )
       ORDER BY id
       FOR UPDATE SKIP LOCKED
       LIMIT 1`
    );
    if(!r.rowCount){ await client.query('ROLLBACK'); return null; }
    const row = r.rows[0];
    const u = await client.query(
      `UPDATE gm_event_queue
       SET status='PROCESSING', attempts=attempts+1, locked_at=NOW(), updated_at=NOW()
       WHERE id=$1
       RETURNING *`, [row.id]
    );
    await client.query('COMMIT');
    return u.rows[0];
  }catch(e){
    try{ await client.query('ROLLBACK'); }catch(_e){}
    throw e;
  }finally{ client.release(); }
}

async function loadOrder(client, orderNo){
  const o = await client.query(`SELECT * FROM gm_order WHERE order_no=$1 LIMIT 1`, [orderNo]);
  if(!o.rowCount) throw new Error(`order_not_found:${orderNo}`);
  const i = await client.query(`SELECT * FROM gm_order_item WHERE order_no=$1 ORDER BY id`, [orderNo]);
  return { order:o.rows[0], items:i.rows };
}

async function processOne(pool, eventService, job){
  const client = await pool.connect();
  try{
    await client.query('BEGIN');
    const type = clean(job.event_type).toUpperCase();
    const payload = job.payload || {};
    let result;
    if(type === 'BASKET_ADD'){
      result = await eventService.applyBasketAdd(client, payload.row || payload);
    }else if(type === 'DETAIL_VIEW'){
      result = await eventService.applyDetail(payload);
      if(!result || !result.updated) throw new Error(`detail_not_ready:${result && result.reason || 'unknown'}`);
    }else if(type === 'ORDER_CREATE'){
      const loaded = await loadOrder(client, clean(payload.order_no));
      result = await eventService.applyOrderCreate(client, loaded.order, loaded.items);
    }else{
      throw new Error(`unsupported_event_type:${type}`);
    }
    await client.query(
      `UPDATE gm_event_queue
       SET status='DONE', processed_at=NOW(), locked_at=NULL, last_error=NULL, updated_at=NOW()
       WHERE id=$1`, [job.id]
    );
    await client.query('COMMIT');
    console.log('[EVENT_QUEUE_DONE]', JSON.stringify({ id:job.id, event_type:type, event_key:job.event_key, result }));
  }catch(e){
    try{ await client.query('ROLLBACK'); }catch(_e){}
    const attempts = Number(job.attempts || 1);
    const finalFail = attempts >= Number(job.max_attempts || 10);
    const delaySeconds = Math.min(3600, Math.pow(2, Math.min(attempts, 10)) * 5);
    await pool.query(
      `UPDATE gm_event_queue
       SET status=$2, next_retry_at=CASE WHEN $2='FAILED' THEN next_retry_at ELSE NOW()+($3 || ' seconds')::interval END,
           locked_at=NULL, last_error=$4, updated_at=NOW()
       WHERE id=$1`,
      [job.id, finalFail ? 'FAILED' : 'PENDING', String(delaySeconds), String(e && e.message || e).slice(0,4000)]
    ).catch(updateErr=>console.error('[EVENT_QUEUE_FAIL_UPDATE]', String(updateErr && updateErr.message || updateErr)));
    console.error('[EVENT_QUEUE_FAIL]', JSON.stringify({ id:job.id, event_type:job.event_type, event_key:job.event_key, attempts, finalFail, error:String(e && e.message || e) }));
  }finally{ client.release(); }
}

function startEventQueueWorker(pool, eventService, options={}){
  if(started) return;
  started = true;
  const intervalMs = Math.max(1000, Number(options.intervalMs || 2000));
  let running = false;
  const tick = async ()=>{
    if(running) return;
    running = true;
    try{
      for(let i=0;i<20;i++){
        const job = await claimOne(pool);
        if(!job) break;
        await processOne(pool,eventService,job);
      }
    }catch(e){
      // Missing migration or temporary DB errors must not stop the server.
      console.error('[EVENT_QUEUE_WORKER_SKIP]', String(e && e.message || e));
    }finally{ running = false; }
  };
  const timer = setInterval(tick, intervalMs);
  if(timer.unref) timer.unref();
  setTimeout(tick, 1000);
  console.log('[EVENT_QUEUE_WORKER] started', JSON.stringify({ intervalMs }));
}

module.exports = { startEventQueueWorker };
