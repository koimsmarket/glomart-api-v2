'use strict';

/*
 * GM_AUTO_ORDER_PAYMENT_CONFIRM_SERVICE_V001
 *
 * Temporary manual payment confirmation flow.
 * Later the bank API / deposit system can call the same service.
 *
 * Order-level rule:
 * - A Glomart order is paid once.
 * - All WAIT_PAYMENT auto-order works belonging to that order become READY.
 * - RUNNING / COMPLETED / FAILED work is never rolled back.
 * - gm_order is updated when the relevant columns exist.
 */

function clean(v){ return String(v == null ? '' : v).trim(); }

async function columns(pool, table){
  const r = await pool.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name=$1
  `,[table]);
  return new Set((r.rows||[]).map(x=>x.column_name));
}

async function confirmOrderPayment(pool,input){
  input=input||{};
  const orderNo=clean(input.order_no);
  const adminId=clean(input.admin_id)||'MANUAL';
  const memo=clean(input.memo);

  if(!orderNo) throw new Error('order_no required');

  const client=await pool.connect();
  try{
    await client.query('BEGIN');

    const orderCols = await columns(client,'gm_order');

    const orderLock = await client.query(
      `SELECT * FROM gm_order WHERE order_no=$1 FOR UPDATE`,
      [orderNo]
    );
    if(!orderLock.rows.length) throw new Error('gm_order not found: '+orderNo);

    const order = orderLock.rows[0];
    const beforePayment = clean(order.payment_status).toUpperCase();
    const alreadyPaid = ['PAID','PAYMENT_COMPLETE','PAYMENT_COMPLETED','COMPLETED','COMPLETE','DONE','SUCCESS','SETTLED'].includes(beforePayment);

    // Update source order safely using only columns that actually exist.
    const sets=[];
    const params=[orderNo];
    let p=1;

    if(orderCols.has('payment_status')){
      p+=1; params.push('PAID'); sets.push(`payment_status=$${p}`);
    }
    if(orderCols.has('payment_completed_at')){
      sets.push(`payment_completed_at=COALESCE(payment_completed_at,now())`);
    }
    if(orderCols.has('updated_at')){
      sets.push(`updated_at=now()`);
    }
    if(sets.length){
      await client.query(
        `UPDATE gm_order SET ${sets.join(', ')} WHERE order_no=$1`,
        params
      );
    }

    const ao = await client.query(`
      UPDATE gm_auto_order
      SET
        payment_completed_at=COALESCE(payment_completed_at,now()),
        process_status=CASE
          WHEN upper(COALESCE(process_status,'')) IN ('RUNNING','COMPLETED','FAILED','ORDERED')
            THEN process_status
          ELSE 'READY'
        END,
        updated_at=now()
      WHERE order_no=$1
      RETURNING auto_order_no,mall_code,process_status,payment_completed_at
    `,[orderNo]);

    const work = await client.query(`
      UPDATE gm_auto_order_work w
      SET
        work_status='READY',
        updated_at=now()
      FROM gm_auto_order a
      WHERE a.auto_order_no=w.auto_order_no
        AND a.order_no=$1
        AND w.work_type='ORDER'
        AND upper(COALESCE(w.work_status,'')) IN ('WAIT_PAYMENT','PENDING')
      RETURNING w.work_id,w.auto_order_no,w.work_status
    `,[orderNo]);

    // Log one entry per control-tower order destination.
    for(const row of ao.rows||[]){
      await client.query(`
        INSERT INTO gm_auto_order_log(
          auto_order_no,work_id,action_type,status_before,status_after,
          admin_id,message,detail_json,created_at
        )
        SELECT
          $1,
          w.work_id,
          'PAYMENT_CONFIRM',
          'WAIT_PAYMENT',
          w.work_status,
          $2,
          $3,
          $4::jsonb,
          now()
        FROM gm_auto_order_work w
        WHERE w.auto_order_no=$1 AND w.work_type='ORDER'
        ORDER BY w.work_id DESC
        LIMIT 1
      `,[
        row.auto_order_no,
        adminId,
        'manual payment confirmed',
        JSON.stringify({
          source:'MANUAL_CONTROL_TOWER',
          order_no:orderNo,
          memo:memo,
          previous_payment_status:beforePayment
        })
      ]).catch(()=>{});
    }

    await client.query('COMMIT');

    return {
      order_no:orderNo,
      previous_payment_status:beforePayment,
      payment_status:'PAID',
      already_paid:alreadyPaid,
      auto_orders:(ao.rows||[]).length,
      works_ready:(work.rows||[]).length,
      auto_order_rows:ao.rows||[],
      work_rows:work.rows||[]
    };
  }catch(e){
    await client.query('ROLLBACK').catch(()=>{});
    throw e;
  }finally{
    client.release();
  }
}

module.exports={
  VERSION:'GM_AUTO_ORDER_PAYMENT_CONFIRM_SERVICE_V001',
  confirmOrderPayment
};
