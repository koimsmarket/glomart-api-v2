'use strict';
// GM_PURCHASE_CONFIRM_SERVICE_V001
const point=require('./member_point_service');
const gpayTransaction=require('./bank/gpay_transaction');
const DEFAULT_GPAY_BASE='https://port-0-guppy-pay-api-mss6kcqn688f1333.sel3.cloudtype.app';
function clean(v){return String(v==null?'':v).trim();}
function gpayBase(){return clean(process.env.GPAY_API_BASE||DEFAULT_GPAY_BASE).replace(/\/$/,'');}
async function assertCandidate(pool,orderNo){
  const q=await pool.query(`SELECT order_no,member_id,total_product_price,total_delivery_fee,extra_area_delivery_fee,point_used_amount,payment_status,shipping_status,seller_status,customer_status,delivered_at,purchase_confirmed_at,payment_method,purchase_confirmed_yn
    FROM gm_order WHERE order_no=$1 LIMIT 1`,[orderNo]);
  if(!q.rows.length)throw new Error('order_not_found');
  const o=q.rows[0],seller=clean(o.seller_status).toUpperCase(),shipping=clean(o.shipping_status).toUpperCase(),customer=clean(o.customer_status).toUpperCase();
  if(!(o.delivered_at||seller==='DELIVERED'||['DELIVERED','COMPLETE','COMPLETED'].includes(shipping)))throw new Error('order_not_delivered');
  if(['CANCELLED','CANCELED'].includes(seller)||/^CANCEL_/.test(customer))throw new Error('order_cancelled');
  return o;
}
async function confirmGpay(orderNo,confirmedAt){
  const r=await fetch(gpayBase()+'/api/gpay/ledger/purchase-confirm',{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify({order_no:orderNo,confirmed_at:confirmedAt||new Date().toISOString()})});
  const j=await r.json().catch(()=>({}));
  if(!r.ok||j.ok===false)throw new Error('gpay_purchase_confirm_failed:'+(j.error||('HTTP_'+r.status)));
  return j;
}
// V125: ordinary purchase confirmation must never call G-PAY ledger or point granting.
async function confirmOrdinary(pool,orderNo){
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const q=await client.query('SELECT payment_method,customer_status,purchase_confirmed_at,purchase_confirmed_yn FROM gm_order WHERE order_no=$1 FOR UPDATE',[orderNo]);
    if(!q.rows.length)throw new Error('order_not_found');
    if(clean(q.rows[0].payment_method).toUpperCase()==='GPAY')throw new Error('payment_method_changed');
    const already=!!q.rows[0].purchase_confirmed_at||clean(q.rows[0].purchase_confirmed_yn).toUpperCase()==='Y';
    await client.query(`UPDATE gm_order SET customer_status='PURCHASE_CONFIRMED',purchase_confirmed_yn='Y',purchase_confirmed_at=COALESCE(purchase_confirmed_at,NOW()),updated_at=NOW() WHERE order_no=$1`,[orderNo]);
    await client.query('COMMIT');
    console.info('[GM_PURCHASE_CONFIRM_V125] ORDINARY_NO_REWARD order_no='+orderNo);
    return {ok:true,order_no:orderNo,idempotent:already,reward:{ok:true,skipped:true,reason:'NON_GPAY_NO_REWARD'},gpay:{skipped:true}};
  }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}
  finally{client.release();}
}
async function confirmOne(pool,orderNo){
  const o=await assertCandidate(pool,orderNo);
  if(clean(o.payment_method).toUpperCase()!=='GPAY')return confirmOrdinary(pool,orderNo);
  if(o.purchase_confirmed_at||clean(o.customer_status).toUpperCase()==='PURCHASE_CONFIRMED'){
    const reward=await point.confirmPurchaseReward(pool,orderNo);
    const gpay=await confirmGpay(orderNo,o.purchase_confirmed_at||new Date().toISOString());
    await gpayTransaction.rewardRecorded(pool,orderNo,orderNo);
    return {ok:true,idempotent:true,order_no:orderNo,reward,gpay};
  }
  const confirmedAt=new Date().toISOString();
  const gpay=await confirmGpay(orderNo,confirmedAt);
  const reward=await point.confirmPurchaseReward(pool,orderNo);
  await gpayTransaction.rewardRecorded(pool,orderNo,orderNo);
  return {ok:true,order_no:orderNo,reward,gpay};
}
module.exports={gpayBase,assertCandidate,confirmOne};
