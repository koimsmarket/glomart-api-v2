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


  async function enqueueDetailView(payload){
    const row = safeJson(payload || {});
    const uid = clean(row.product_uid || row.productUid || row.uid || row.key || row.gm_key || '');
    const requestId = clean(row.search_event_id || row.searchEventId || row.request_id || row.requestId || '');
    const token = requestId || clean(row.event_key || row.eventKey || row.ts || Date.now());
    if(!uid) return { queued:false, reason:'product_key_missing' };
    return enqueue('DETAIL_VIEW', `DETAIL_VIEW:${token}:${uid}`, row);
  }

  async function enqueueMemberJoin(memberId, recommenderId){
    const member = clean(memberId);
    const recommender = clean(recommenderId);
    if(!member) return { queued:false, reason:'member_id_missing' };
    return enqueue('MEMBER_JOIN', `MEMBER_JOIN:${member}`, {
      member_id:member,
      recommender_id:recommender
    });
  }

  async function enqueueOrderCreate(orderNo){
    const no = clean(orderNo);
    if(!no) return { queued:false, reason:'order_no_missing' };
    return enqueue('ORDER_CREATE', `ORDER_CREATE:${no}`, { order_no:no });
  }

  return { enqueue, enqueueBasketAdd, enqueueDetailView, enqueueMemberJoin, enqueueOrderCreate };
};
