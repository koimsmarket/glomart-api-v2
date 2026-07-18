'use strict';

function clean(v){ return v == null ? '' : String(v).trim(); }
function safeJson(v){
  try { return JSON.parse(JSON.stringify(v == null ? {} : v)); }
  catch (_e) { return {}; }
}

module.exports = function createEventQueue(pool){
  async function enqueue(eventType, eventKey, payload){
    const type = clean(eventType).toUpperCase();
    const key = clean(eventKey);
    if(!type || !key) return { queued:false, reason:'event_type_or_key_missing' };
    const r = await pool.query(
      `INSERT INTO gm_event_queue (event_type,event_key,payload,status,next_retry_at,created_at,updated_at)
       VALUES ($1,$2,$3::jsonb,'PENDING',NOW(),NOW(),NOW())
       ON CONFLICT (event_key) DO NOTHING
       RETURNING id,event_type,event_key,status`,
      [type,key,JSON.stringify(safeJson(payload))]
    );
    if(!r.rowCount) return { queued:false, duplicate:true, event_key:key };
    return { queued:true, item:r.rows[0] };
  }

  function basketEventKey(row){
    const owner = clean(row && (row.member_id || row.guest_key || 'guest'));
    const uid = clean(row && (row.product_uid || ((row.mall_code && row.pi_ii_vi) ? `${row.mall_code}_${row.pi_ii_vi}` : '')));
    const stamp = row && row.updated_at ? new Date(row.updated_at).getTime() : Date.now();
    return `BASKET_ADD:${owner}:${uid}:${stamp}`;
  }

  async function enqueueBasketAdd(row){
    return enqueue('BASKET_ADD', basketEventKey(row), { row:safeJson(row) });
  }

  async function enqueueOrderCreate(orderNo){
    const no = clean(orderNo);
    if(!no) return { queued:false, reason:'order_no_missing' };
    return enqueue('ORDER_CREATE', `ORDER_CREATE:${no}`, { order_no:no });
  }

  return { enqueue, enqueueBasketAdd, enqueueOrderCreate };
};
