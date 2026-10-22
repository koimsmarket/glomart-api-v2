'use strict';
// GM_GPAY_V072: persistent, idempotent transaction record. No issuance rollback.
const clean=v=>String(v==null?'':v).trim();
async function event(c,tx,key,step,result,ref,err,details){
  await c.query(`INSERT INTO gm_purchase_saga_event(tx_id,event_key,step,result,remote_ref,error_code,details)
  VALUES($1,$2,$3,$4,$5,$6,$7::jsonb) ON CONFLICT(tx_id,event_key) DO NOTHING`,
  [tx,key,step,result,ref||null,err||null,JSON.stringify(details||{})]);
}
async function recordPaid(pool,data){
  // The prepare endpoint already reserved this order_no in gm_purchase_saga.
  // Never INSERT another saga row for a different payment transaction id.
  const order=clean(data.order_no),member=clean(data.member_id),key=clean(data.payment_key);
  if(!order||!member||!key)throw new Error('transaction_reference_required');
  const c=await pool.connect();
  try{
    await c.query('BEGIN');
    const q=await c.query('SELECT * FROM gm_purchase_saga WHERE order_no=$1 FOR UPDATE',[order]);
    const x=q.rows[0];
    if(!x)throw new Error('prepared_order_not_found');
    if(x.member_id!==member||Number(x.product_amount_krw)!==Number(data.product)||
       Number(x.shipping_amount_krw)!==Number(data.shipping)||
       Number(x.point_used_krw)!==Number(data.points)||Number(x.gpay_amount)!==Number(data.gpay))
      throw new Error('transaction_replay_contract_mismatch');
    if(x.gpay_payment_ref&&x.gpay_payment_ref!==key)throw new Error('payment_reference_conflict');
    if(!['ORDER_PENDING','GPAY_PAID','RECONCILE_REQUIRED','ORDER_PAID','PURCHASE_CONFIRMED'].includes(x.status))
      throw new Error('prepared_order_invalid_status');
    if(!x.gpay_payment_ref){
      await c.query(`UPDATE gm_purchase_saga SET gpay_payment_ref=$2,
        status=CASE WHEN status='ORDER_PENDING' THEN 'GPAY_PAID' ELSE status END,
        version=version+1,updated_at=NOW() WHERE tx_id=$1`,[x.tx_id,key]);
    }
    await event(c,x.tx_id,'GPAY_PAID','GPAY_DEBIT','COMMITTED',key,null,{verified_by:'gpay_ledger'});
    await c.query('COMMIT');
    return {tx_id:x.tx_id,order_no:order,status:x.status};
  }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}
}
async function completed(c,tx,order,points){
  await event(c,tx,'POINT_DEBITED','POINT_DEBIT','COMMITTED',order,null,{amount:points});
  await event(c,tx,'ORDER_CREATED','ORDER_CREATE','COMMITTED',order);
  await event(c,tx,'COMPLETED','PURCHASE_PAYMENT','COMMITTED',order);
  await c.query("UPDATE gm_purchase_saga SET status='ORDER_PAID',point_use_ref=$2,version=version+1,updated_at=NOW(),last_error_code=NULL WHERE tx_id=$1",[tx,order]);
}
async function reconcile(pool,tx,code){
  if(!tx)return;
  const c=await pool.connect();try{await c.query('BEGIN');
    await c.query("UPDATE gm_purchase_saga SET status='RECONCILE_REQUIRED',last_error_code=$2,version=version+1,updated_at=NOW() WHERE tx_id=$1 AND status NOT IN ('ORDER_PAID','PURCHASE_CONFIRMED')",[tx,clean(code).slice(0,100)]);
    await event(c,tx,'ORDER_FAILED:'+clean(code).slice(0,70),'ORDER_CREATE','FAILED',null,clean(code).slice(0,100));
    await c.query('COMMIT');
  }catch(e){await c.query('ROLLBACK').catch(()=>{});console.error('[GM_GPAY_V072] RECONCILE_RECORD_FAILED',{tx_id:tx,error:e.message});}finally{c.release();}
}
async function rewardRecorded(pool,order,ref){
  const c=await pool.connect();try{await c.query('BEGIN');
    const q=await c.query('SELECT tx_id FROM gm_purchase_saga WHERE order_no=$1 FOR UPDATE',[order]);
    if(q.rows.length){const tx=q.rows[0].tx_id;
      await event(c,tx,'REWARD_GRANTED','PURCHASE_CONFIRM','COMMITTED',String(ref||order));
      await c.query("UPDATE gm_purchase_saga SET status='PURCHASE_CONFIRMED',purchase_confirm_ref=$2,version=version+1,updated_at=NOW() WHERE tx_id=$1",[tx,String(ref||order)]);
    }await c.query('COMMIT');
  }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}
}
module.exports={recordPaid,completed,reconcile,rewardRecorded,event};
