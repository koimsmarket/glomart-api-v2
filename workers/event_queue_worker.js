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


async function processSmartfitMessageSend(client, payload){
  const templateId=Number(payload.template_id||0); const serialNo=Number(payload.serial_no||0);
  if(!templateId||!serialNo) throw new Error('smartfit_message_payload_invalid');
  const template=(await client.query(`SELECT template_id,template_title_source,template_title_ko FROM gm_smartfit_template WHERE template_id=$1 LIMIT 1`,[templateId])).rows[0];
  if(!template) throw new Error(`smartfit_template_not_found:${templateId}`);
  const rows=await client.query(`SELECT * FROM gm_smartfit_message_receiver
    WHERE template_id=$1 AND serial_no=$2 AND send_status IN ('QUEUED','QUEUED_NIGHT')
    ORDER BY message_no LIMIT 100 FOR UPDATE SKIP LOCKED`,[templateId,serialNo]);
  let sent=0;
  for(const row of rows.rows){
    await client.query(`UPDATE gm_smartfit_message_receiver SET send_status='PROCESSING',failed_reason=NULL WHERE message_no=$1`,[row.message_no]);
    const personalNo=`SFM${templateId}_${row.message_no}`.slice(0,32);
    await client.query(`INSERT INTO gm_message_personal(message_no,member_id,message_type,title,message,move_type,move_value,priority,is_read,created_at)
      VALUES($1,$2,'SMARTFIT_TEMPLATE',$3,$4,'SMARTFIT_TEMPLATE',$5,'NORMAL','N',CURRENT_TIMESTAMP)
      ON CONFLICT(message_no) DO NOTHING`,[personalNo,row.receiver_member_id,String(template.template_title_source||template.template_title_ko||'SmartFit'),row.message,String(templateId)]);
    await client.query(`UPDATE gm_smartfit_message_receiver SET send_status='SENT',sent_at=CURRENT_TIMESTAMP,failed_reason=NULL WHERE message_no=$1`,[row.message_no]);
    sent++;
  }
  const remain=Number((await client.query(`SELECT COUNT(*)::int AS n FROM gm_smartfit_message_receiver WHERE template_id=$1 AND serial_no=$2 AND send_status IN ('QUEUED','QUEUED_NIGHT')`,[templateId,serialNo])).rows[0].n||0);
  if(remain>0){
    const batch=Number(payload.batch_no||1)+1;
    await client.query(`INSERT INTO gm_event_queue(event_type,event_key,payload,status,next_retry_at,created_at,updated_at)
      VALUES('SMARTFIT_MESSAGE_SEND',$1,$2::jsonb,'PENDING',CURRENT_TIMESTAMP+INTERVAL '2 seconds',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
      ON CONFLICT(event_key) DO NOTHING`,[`SMARTFIT_MESSAGE_SEND:${templateId}:${serialNo}:${batch}`,JSON.stringify({...payload,batch_no:batch})]);
  }
  return {template_id:templateId,serial_no:serialNo,sent,remain};
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
    }else if(type === 'MEMBER_JOIN'){
      result = await eventService.applyMemberJoin(client, payload);
    }else if(type === 'ORDER_COMPLETED' || type === 'ORDER_CREATE'){
      const loaded = await loadOrder(client, clean(payload.order_no));
      const orderStatus = clean(loaded.order.order_status).toLowerCase();
      const cancelStatus = clean(loaded.order.cancel_status).toLowerCase();
      if(orderStatus === 'cancelled' || cancelStatus === 'completed'){
        result = { skipped:true, reason:'order_cancelled_before_aggregate', order_no:clean(payload.order_no) };
      }else{
        result = await eventService.applyOrderCreate(client, loaded.order, loaded.items);
      }
    }else if(type === 'SMARTFIT_MESSAGE_SEND'){
      result = await processSmartfitMessageSend(client, payload);
    }else if(type === 'SMARTFIT_SUBSCRIBE' || type === 'SMARTFIT_UNSUBSCRIBE'){
      const memberId = clean(payload.member_id || payload.memberId);
      const creatorMemberId = clean(payload.creator_member_id || payload.creatorMemberId);
      if(!memberId || !creatorMemberId) throw new Error('smartfit_subscription_member_required');
      if(memberId === creatorMemberId){
        result = { skipped:true, reason:'self_subscription' };
      }else if(type === 'SMARTFIT_SUBSCRIBE'){
        const q = await client.query(`INSERT INTO gm_smartfit_subscribe(member_id,creator_member_id,message_accept_yn)
          VALUES($1,$2,'Y')
          ON CONFLICT(member_id,creator_member_id) DO UPDATE SET message_accept_yn='Y'
          RETURNING member_id,creator_member_id,message_accept_yn`,[memberId,creatorMemberId]);
        result = { subscribed:true, item:q.rows[0] || null };
      }else{
        const q = await client.query(`DELETE FROM gm_smartfit_subscribe
          WHERE member_id=$1 AND creator_member_id=$2`,[memberId,creatorMemberId]);
        result = { unsubscribed:q.rowCount > 0, deleted:q.rowCount };
      }
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
