'use strict';

const crypto = require('crypto');

const DEFAULT_MODE = String(process.env.GM_AUTO_ORDER_MODE || 'SEMI_AUTO').toUpperCase();
const LOCK_SECONDS = Math.max(30, Number(process.env.GM_AUTO_ORDER_LOCK_SECONDS || 90));

const ACTIVE = new Set([
  'AUTO_ORDER_PENDING','WAITING_CLIENT','RUNNING',
  'STOPPED_BEFORE_PAYMENT','PAYMENT_WAITING'
]);

const TERMINAL = new Set(['COMPLETED','FAILED','CANCELLED']);

function clean(v){ return String(v == null ? '' : v).trim(); }
function mall(v){ return clean(v).toUpperCase(); }

function sourceMallFromItem(item){
  item = item || {};
  const direct = mall(item.source_mall || item.source_code || item.mall_code);
  if(['CPKR','ALKR'].includes(direct)) return direct;

  const uid = mall(item.source_uid || item.product_uid);
  if(uid.startsWith('CPKR_')) return 'CPKR';
  if(uid.startsWith('ALKR_')) return 'ALKR';

  const url = clean(item.product_url || item.source_url || item.url).toLowerCase();
  if(url.includes('coupang.com') || url.includes('link.coupang.com')) return 'CPKR';
  if(url.includes('aliexpress.com')) return 'ALKR';
  return '';
}

function receiverFromOrder(o){
  o = o || {};
  return {
    name: clean(o.receiver_name || o.recipient_name || o.shipping_name),
    phone: clean(o.receiver_mobile || o.receiver_phone || o.recipient_phone || o.shipping_phone),
    zipcode: clean(o.receiver_zipcode || o.zipcode || o.shipping_zipcode),
    road_address: clean(o.receiver_address1 || o.address1 || o.shipping_address1),
    jibun_address: clean(o.receiver_jibun_address || o.jibun_address),
    detail_address: clean(o.receiver_address2 || o.address2 || o.shipping_address2),
    memo: clean(o.delivery_memo || o.shipping_memo || o.order_memo)
  };
}

function itemPayload(row, sourceMall){
  const out = Object.assign({}, row || {});
  out.source_mall = sourceMall;
  out.source_key = clean(
    out.source_key || out.source_uid || out.product_uid ||
    out.pi_ii_vi || out.vendor_item_id || out.vendorItemId
  );
  return out;
}

async function event(client, jobId, eventType, status, clientId, detail){
  await client.query(`
    INSERT INTO gm_auto_order_job_event
      (job_id,event_type,status,client_id,detail,created_at)
    VALUES ($1,$2,$3,$4,$5::jsonb,now())
  `, [
    jobId, clean(eventType), clean(status), clean(clientId),
    JSON.stringify(detail || {})
  ]);
}

async function createPendingForOrder(pool, orderNo, meta){
  orderNo = clean(orderNo);
  if(!orderNo) throw new Error('order_no is required');

  const client = await pool.connect();
  try{
    const orderR = await client.query(
      'SELECT * FROM gm_order WHERE order_no=$1 LIMIT 1',
      [orderNo]
    );
    if(!orderR.rows.length) return { created:0, jobs:[], reason:'order_not_found' };

    const itemsR = await client.query(
      'SELECT * FROM gm_order_item WHERE order_no=$1 ORDER BY created_at ASC NULLS LAST, id ASC NULLS LAST',
      [orderNo]
    ).catch(async ()=>{
      return client.query(
        'SELECT * FROM gm_order_item WHERE order_no=$1',
        [orderNo]
      );
    });

    const order = orderR.rows[0];
    const groups = {};
    for(const row of itemsR.rows){
      const sm = sourceMallFromItem(row);
      if(!['CPKR','ALKR'].includes(sm)) continue;
      (groups[sm] ||= []).push(itemPayload(row, sm));
    }

    const created = [];
    await client.query('BEGIN');

    for(const [sourceMall, items] of Object.entries(groups)){
      const payload = {
        source_mall: sourceMall,
        order_id: orderNo,
        order_no: orderNo,
        auto_start: true,
        mode: DEFAULT_MODE,
        stop_before_payment: DEFAULT_MODE !== 'FULL_AUTO',
        receiver: receiverFromOrder(order),
        order,
        items,
        meta: meta || {}
      };

      const r = await client.query(`
        INSERT INTO gm_auto_order_job (
          order_no,source_mall,mode,status,priority,payload,
          attempt_count,created_at,updated_at
        ) VALUES ($1,$2,$3,'AUTO_ORDER_PENDING',100,$4::jsonb,0,now(),now())
        ON CONFLICT (order_no,source_mall) DO UPDATE SET
          payload=EXCLUDED.payload,
          mode=EXCLUDED.mode,
          updated_at=now(),
          status=CASE
            WHEN gm_auto_order_job.status IN ('COMPLETED','CANCELLED')
              THEN gm_auto_order_job.status
            ELSE 'AUTO_ORDER_PENDING'
          END,
          assigned_client_id=CASE
            WHEN gm_auto_order_job.status IN ('COMPLETED','CANCELLED')
              THEN gm_auto_order_job.assigned_client_id
            ELSE NULL
          END,
          lock_token=CASE
            WHEN gm_auto_order_job.status IN ('COMPLETED','CANCELLED')
              THEN gm_auto_order_job.lock_token
            ELSE NULL
          END,
          lock_expires_at=CASE
            WHEN gm_auto_order_job.status IN ('COMPLETED','CANCELLED')
              THEN gm_auto_order_job.lock_expires_at
            ELSE NULL
          END
        RETURNING *
      `, [orderNo, sourceMall, DEFAULT_MODE, JSON.stringify(payload)]);

      const job = r.rows[0];
      if(job && job.status === 'AUTO_ORDER_PENDING'){
        await event(client, job.job_id, 'JOB_QUEUED', job.status, '', { source:meta && meta.source });
      }
      created.push(job);
    }

    await client.query('COMMIT');
    return { created:created.length, jobs:created };
  }catch(e){
    await client.query('ROLLBACK').catch(()=>{});
    throw e;
  }finally{
    client.release();
  }
}

async function recoverExpiredLocks(client){
  const r = await client.query(`
    UPDATE gm_auto_order_job
    SET status='WAITING_CLIENT',
        assigned_client_id=NULL,
        lock_token=NULL,
        lock_expires_at=NULL,
        updated_at=now()
    WHERE status='RUNNING'
      AND lock_expires_at IS NOT NULL
      AND lock_expires_at < now()
    RETURNING job_id
  `);
  for(const row of r.rows){
    await event(client,row.job_id,'LOCK_EXPIRED','WAITING_CLIENT','',{});
  }
  await client.query(`
    UPDATE gm_auto_order_client c
    SET current_job_id=NULL, updated_at=now()
    WHERE current_job_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM gm_auto_order_job j
        WHERE j.job_id=c.current_job_id
          AND j.status='RUNNING'
          AND j.lock_expires_at >= now()
      )
  `);
}

async function claim(pool, clientInfo){
  const clientId = clean(clientInfo && (clientInfo.client_id || clientInfo.clientId));
  if(!clientId) throw new Error('client_id is required');

  const db = await pool.connect();
  try{
    await db.query('BEGIN');
    await recoverExpiredLocks(db);

    const cr = await db.query(`
      SELECT *
      FROM gm_auto_order_client
      WHERE client_id=$1
        AND enabled=TRUE
        AND last_seen_at >= now() - interval '90 second'
      FOR UPDATE
    `,[clientId]);
    if(!cr.rows.length){
      await db.query('ROLLBACK');
      return { job:null, reason:'client_offline_or_disabled' };
    }
    const c = cr.rows[0];
    if(c.current_job_id){
      const current = await db.query(`
        SELECT * FROM gm_auto_order_job
        WHERE job_id=$1 AND status='RUNNING'
        LIMIT 1
      `,[c.current_job_id]);
      if(current.rows.length){
        await db.query('COMMIT');
        return { job:current.rows[0], reason:'current_job' };
      }
    }

    const readyMalls = [];
    if(c.cpkr_ready) readyMalls.push('CPKR');
    if(c.alkr_ready) readyMalls.push('ALKR');
    if(!readyMalls.length){
      await db.query('COMMIT');
      return { job:null, reason:'client_not_ready' };
    }

    const pick = await db.query(`
      SELECT *
      FROM gm_auto_order_job
      WHERE status IN ('AUTO_ORDER_PENDING','WAITING_CLIENT')
        AND source_mall = ANY($1::text[])
      ORDER BY priority DESC, created_at ASC, job_id ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `,[readyMalls]);

    if(!pick.rows.length){
      await db.query('COMMIT');
      return { job:null, reason:'queue_empty' };
    }

    const token = crypto.randomUUID();
    const j = pick.rows[0];
    const updated = await db.query(`
      UPDATE gm_auto_order_job
      SET status='RUNNING',
          assigned_client_id=$2,
          lock_token=$3,
          lock_expires_at=now()+($4::int * interval '1 second'),
          started_at=COALESCE(started_at,now()),
          attempt_count=attempt_count+1,
          updated_at=now()
      WHERE job_id=$1
      RETURNING *
    `,[j.job_id,clientId,token,LOCK_SECONDS]);

    await db.query(`
      UPDATE gm_auto_order_client
      SET current_job_id=$2,last_seen_at=now(),updated_at=now()
      WHERE client_id=$1
    `,[clientId,j.job_id]);

    await event(db,j.job_id,'JOB_CLAIMED','RUNNING',clientId,{ lock_seconds:LOCK_SECONDS });
    await db.query('COMMIT');
    return { job:updated.rows[0] };
  }catch(e){
    await db.query('ROLLBACK').catch(()=>{});
    throw e;
  }finally{
    db.release();
  }
}

async function heartbeat(pool, jobId, clientId, lockToken){
  const r = await pool.query(`
    UPDATE gm_auto_order_job
    SET lock_expires_at=now()+($4::int * interval '1 second'),
        updated_at=now()
    WHERE job_id=$1
      AND assigned_client_id=$2
      AND lock_token=$3
      AND status='RUNNING'
    RETURNING *
  `,[Number(jobId),clean(clientId),clean(lockToken),LOCK_SECONDS]);
  if(!r.rows.length) throw new Error('job_lock_invalid_or_expired');
  return r.rows[0];
}

async function updateState(pool, jobId, clientId, lockToken, nextStatus, detail){
  nextStatus = clean(nextStatus).toUpperCase();
  const allowed = new Set([
    'RUNNING','WAITING_CLIENT','STOPPED_BEFORE_PAYMENT','PAYMENT_WAITING',
    'LOGIN_REQUIRED','MFA_REQUIRED','PRICE_CHANGED','OUT_OF_STOCK',
    'OPTION_ERROR','FAILED','COMPLETED','CANCELLED'
  ]);
  if(!allowed.has(nextStatus)) throw new Error('unsupported_status:' + nextStatus);

  const db = await pool.connect();
  try{
    await db.query('BEGIN');
    const r = await db.query(`
      UPDATE gm_auto_order_job
      SET status=$4,
          payment_waiting_at=CASE WHEN $4 IN ('STOPPED_BEFORE_PAYMENT','PAYMENT_WAITING')
                                  THEN COALESCE(payment_waiting_at,now()) ELSE payment_waiting_at END,
          completed_at=CASE WHEN $4='COMPLETED' THEN now() ELSE completed_at END,
          failed_at=CASE WHEN $4='FAILED' THEN now() ELSE failed_at END,
          last_error_code=CASE WHEN $4 IN ('FAILED','LOGIN_REQUIRED','MFA_REQUIRED','PRICE_CHANGED','OUT_OF_STOCK','OPTION_ERROR')
                               THEN COALESCE($5::jsonb->>'error_code',$4) ELSE last_error_code END,
          last_error_message=CASE WHEN $4 IN ('FAILED','LOGIN_REQUIRED','MFA_REQUIRED','PRICE_CHANGED','OUT_OF_STOCK','OPTION_ERROR')
                                  THEN COALESCE($5::jsonb->>'message','') ELSE last_error_message END,
          result=CASE WHEN $4 IN ('COMPLETED','STOPPED_BEFORE_PAYMENT','PAYMENT_WAITING')
                      THEN COALESCE($5::jsonb,result) ELSE result END,
          lock_expires_at=CASE WHEN $4='RUNNING'
                               THEN now()+($6::int * interval '1 second')
                               ELSE NULL END,
          lock_token=CASE WHEN $4='RUNNING' THEN lock_token ELSE NULL END,
          assigned_client_id=CASE WHEN $4='RUNNING' THEN assigned_client_id ELSE assigned_client_id END,
          updated_at=now()
      WHERE job_id=$1
        AND assigned_client_id=$2
        AND lock_token=$3
      RETURNING *
    `,[Number(jobId),clean(clientId),clean(lockToken),nextStatus,JSON.stringify(detail||{}),LOCK_SECONDS]);

    if(!r.rows.length) throw new Error('job_lock_invalid_or_expired');

    if(nextStatus !== 'RUNNING'){
      await db.query(`
        UPDATE gm_auto_order_client
        SET current_job_id=NULL,updated_at=now()
        WHERE client_id=$1 AND current_job_id=$2
      `,[clean(clientId),Number(jobId)]);
    }

    await event(db,Number(jobId),'STATE_CHANGED',nextStatus,clientId,detail||{});
    await db.query('COMMIT');
    return r.rows[0];
  }catch(e){
    await db.query('ROLLBACK').catch(()=>{});
    throw e;
  }finally{
    db.release();
  }
}

async function list(pool, query){
  query = query || {};
  const vals = [];
  const where = [];
  if(clean(query.status)){
    vals.push(clean(query.status).toUpperCase());
    where.push(`status=$${vals.length}`);
  }
  if(clean(query.source_mall || query.sourceMall)){
    vals.push(mall(query.source_mall || query.sourceMall));
    where.push(`source_mall=$${vals.length}`);
  }
  if(clean(query.order_no || query.orderNo)){
    vals.push(clean(query.order_no || query.orderNo));
    where.push(`order_no=$${vals.length}`);
  }
  const limit = Math.min(Math.max(Number(query.limit || 100),1),500);
  vals.push(limit);
  const sql = `
    SELECT *
    FROM gm_auto_order_job
    ${where.length ? 'WHERE '+where.join(' AND ') : ''}
    ORDER BY created_at DESC,job_id DESC
    LIMIT $${vals.length}
  `;
  return (await pool.query(sql,vals)).rows;
}

async function get(pool, jobId){
  const r = await pool.query('SELECT * FROM gm_auto_order_job WHERE job_id=$1 LIMIT 1',[Number(jobId)]);
  return r.rows[0] || null;
}

module.exports = {
  DEFAULT_MODE, LOCK_SECONDS, ACTIVE, TERMINAL,
  createPendingForOrder, claim, heartbeat, updateState, list, get
};
