'use strict';

/*
 * GM_AUTO_ORDER_PAYMENT_CONFIRM_SERVICE_V002_DEPOSIT_PARTIAL
 *
 * 확정 규칙
 * - 부족액 = 주문금액 - 실제 입금 확인액
 * - 사용 예치금 = min(현재 예치금, 부족액)
 * - 예치금이 부족액보다 작아도 0원이 아니라 보유 예치금을 가능한 만큼 즉시 차감
 * - 잔액이 남으면 WAIT_PAYMENT/PARTIALLY_PAID 유지
 * - 이후 실제 입금 확인액 + 이미 사용한 예치금 >= 주문금액이면 PAID -> 기존 Control Tower READY
 * - 주문별 예치금 사용은 gm_deposit_transaction ORDER_USE 한 건으로 기록
 */

const controlTower=require('./control_tower_service');

function clean(v){return String(v==null?'':v).trim();}
function money(v){const n=Number(v);return Number.isFinite(n)?Math.max(0,Math.round(n)):0;}
function upper(v){return clean(v).toUpperCase();}

async function applyOrderDepositPayment(pool,input){
  input=input||{};
  const orderNo=clean(input.order_no||input.orderNo);
  const requestedMember=clean(input.member_id||input.memberId);
  if(!orderNo)throw new Error('order_no_required');
  if(!requestedMember)throw new Error('member_id_required');

  const client=await pool.connect();
  let result;
  try{
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',['DEPOSIT_ORDER_USE:'+orderNo]);

    const oq=await client.query(`SELECT * FROM gm_order WHERE order_no=$1 FOR UPDATE`,[orderNo]);
    if(!oq.rows.length)throw new Error('order_not_found');
    const order=oq.rows[0];
    const memberId=clean(order.member_id);
    if(!memberId)throw new Error('member_order_required');
    if(memberId!==requestedMember)throw new Error('member_mismatch');

    let actual=money(order.actual_payment_amount);
    if(input.confirmed_cash_amount!==undefined && input.confirmed_cash_amount!==null && clean(input.confirmed_cash_amount)!==''){
      const n=Number(String(input.confirmed_cash_amount).replace(/,/g,''));
      if(!Number.isFinite(n)||n<0)throw new Error('confirmed_cash_amount_invalid');
      actual=Math.round(n);
      await client.query(
        `UPDATE gm_order
            SET actual_payment_amount=$2,
                payment_difference_amount=GREATEST(0,COALESCE(NULLIF(total_payment_price,0),expected_payment_amount,0)::BIGINT-$2),
                updated_at=NOW()
          WHERE order_no=$1`,
        [orderNo,actual]
      );
    }

    const total=money(order.total_payment_price||order.expected_payment_amount);
    if(total<=0)throw new Error('order_total_required');

    const usedQ=await client.query(
      `SELECT transaction_id,withdraw_amount,balance_after
         FROM gm_deposit_transaction
        WHERE order_no=$1 AND member_id=$2 AND transaction_type='ORDER_USE'
        ORDER BY transaction_id ASC LIMIT 1`,
      [orderNo,memberId]
    );

    let used=0;
    let balanceAfter=0;
    let applied=false;

    if(usedQ.rows.length){
      used=money(usedQ.rows[0].withdraw_amount);
      balanceAfter=money(usedQ.rows[0].balance_after);
    }else{
      const mq=await client.query(
        `SELECT member_id,deposit_balance,usable_balance FROM gm_member WHERE member_id=$1 FOR UPDATE`,
        [memberId]
      );
      if(!mq.rows.length)throw new Error('member_not_found');
      const member=mq.rows[0];

      await client.query(
        `INSERT INTO gm_deposit_balance(member_id,balance_amount,updated_at)
         VALUES($1,GREATEST(0,COALESCE($2,0)::BIGINT),NOW())
         ON CONFLICT(member_id) DO NOTHING`,
        [memberId,money(member.deposit_balance)]
      );
      const bq=await client.query(
        `SELECT balance_amount FROM gm_deposit_balance WHERE member_id=$1 FOR UPDATE`,
        [memberId]
      );
      const balance=bq.rows.length?money(bq.rows[0].balance_amount):0;
      const shortfall=Math.max(0,total-actual);

      // 핵심: 예치금이 부족해도 0원 처리하지 않는다.
      used=Math.min(balance,shortfall);
      balanceAfter=balance-used;

      if(used>0){
        await client.query(
          `UPDATE gm_deposit_balance SET balance_amount=$2,updated_at=NOW() WHERE member_id=$1`,
          [memberId,balanceAfter]
        );
        await client.query(
          `INSERT INTO gm_deposit_transaction(
             member_id,bank_transaction_id,order_no,transaction_at,transaction_type,
             deposit_amount,withdraw_amount,balance_after,description,created_at
           ) VALUES($1,NULL,$2,NOW(),'ORDER_USE',0,$3,$4,$5,NOW())`,
          [memberId,orderNo,used,balanceAfter,'주문 결제 예치금 사용']
        );
        await client.query(
          `UPDATE gm_member
              SET deposit_balance=$2,
                  usable_balance=GREATEST(0,COALESCE(usable_balance,0)::BIGINT-$3),
                  updated_at=NOW()
            WHERE member_id=$1`,
          [memberId,balanceAfter,used]
        );
        applied=true;
      }else{
        balanceAfter=balance;
      }
    }

    const covered=actual+used;
    const remaining=Math.max(0,total-covered);
    const paid=remaining===0;
    const nextStatus=paid?'PAID':(covered>0?'PARTIALLY_PAID':'WAIT_PAYMENT');

    await client.query(
      `UPDATE gm_order
          SET payment_status=$2,
              payment_difference_amount=$3,
              payment_completed_at=CASE WHEN $2='PAID' THEN COALESCE(payment_completed_at,NOW()) ELSE payment_completed_at END,
              payment_confirmed_at=CASE WHEN $2='PAID' THEN COALESCE(payment_confirmed_at,NOW()) ELSE payment_confirmed_at END,
              updated_at=NOW()
        WHERE order_no=$1`,
      [orderNo,nextStatus,remaining]
    );

    await client.query('COMMIT');

    result={
      ok:true,order_no:orderNo,member_id:memberId,
      status:paid?'PAID':'WAIT_PAYMENT',
      stored_payment_status:nextStatus,
      applied,
      already_applied:usedQ.rows.length>0,
      order_amount:total,
      actual_payment_amount:actual,
      deposit_used_amount:used,
      deposit_balance_after:balanceAfter,
      remaining_amount:remaining
    };
  }catch(e){
    await client.query('ROLLBACK').catch(()=>{});
    throw e;
  }finally{
    client.release();
  }

  if(result.status==='PAID'){
    try{
      const sync=await controlTower.ingestOrder(pool,orderNo,{source:'DEPOSIT_ORDER_PAYMENT'});
      result.auto_order_sync={ok:true,result:sync};
    }catch(e){
      result.auto_order_sync={ok:false,error:String(e&&e.message||e)};
    }
  }
  return result;
}

async function confirmOrderPayment(pool,input){
  input=input||{};
  const orderNo=clean(input.order_no);
  if(!orderNo)throw new Error('order_no required');

  const q=await pool.query(`SELECT order_no,member_id,payment_status FROM gm_order WHERE order_no=$1 LIMIT 1`,[orderNo]);
  if(!q.rows.length)throw new Error('gm_order not found: '+orderNo);
  const order=q.rows[0];
  const memberId=clean(order.member_id);
  if(!memberId)throw new Error('member_order_required');

  const result=await applyOrderDepositPayment(pool,{
    order_no:orderNo,
    member_id:memberId,
    confirmed_cash_amount:input.actual_payment_amount
  });

  let readyCount=0;
  if(result.status==='PAID'){
    try{
      const rq=await pool.query(`
        SELECT COUNT(*)::int AS cnt
          FROM gm_auto_order_work w
          JOIN gm_auto_order a ON a.auto_order_no=w.auto_order_no
         WHERE a.order_no=$1 AND w.work_type='ORDER'
           AND upper(COALESCE(w.work_status,''))='READY'`,
        [orderNo]
      );
      readyCount=Number(rq.rows[0]&&rq.rows[0].cnt||0);
    }catch(_e){}
  }

  return {
    order_no:orderNo,
    previous_payment_status:upper(order.payment_status),
    payment_status:result.status,
    stored_payment_status:result.stored_payment_status,
    actual_payment_amount:Number(result.actual_payment_amount||0),
    deposit_used_amount:Number(result.deposit_used_amount||0),
    deposit_balance_after:Number(result.deposit_balance_after||0),
    remaining_amount:Number(result.remaining_amount||0),
    works_ready:readyCount,
    deposit_result:result
  };
}

module.exports={
  VERSION:'GM_AUTO_ORDER_PAYMENT_CONFIRM_SERVICE_V002_DEPOSIT_PARTIAL',
  applyOrderDepositPayment,
  confirmOrderPayment
};
