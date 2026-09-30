'use strict';
// GM_PURCHASE_CONFIRM_SERVICE_V001
const point=require('./member_point_service');
const DEFAULT_GPAY_BASE='https://port-0-guppy-pay-api-mss6kcqn688f1333.sel3.cloudtype.app';
function clean(v){return String(v==null?'':v).trim();}
function gpayBase(){return clean(process.env.GPAY_API_BASE||DEFAULT_GPAY_BASE).replace(/\/$/,'');}
async function assertCandidate(pool,orderNo){
  const q=await pool.query(`SELECT order_no,member_id,total_product_price,total_delivery_fee,extra_area_delivery_fee,point_used_amount,payment_status,shipping_status,seller_status,customer_status,delivered_at,purchase_confirmed_at
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
async function confirmOne(pool,orderNo){
  const o=await assertCandidate(pool,orderNo);
  if(o.purchase_confirmed_at||clean(o.customer_status).toUpperCase()==='PURCHASE_CONFIRMED'){
    const reward=await point.confirmPurchaseReward(pool,orderNo);
    const gpay=await confirmGpay(orderNo,o.purchase_confirmed_at||new Date().toISOString());
    return {ok:true,idempotent:true,order_no:orderNo,reward,gpay};
  }
  // Remote G-PAY confirmation is idempotent. Do it first so a remote failure does not consume the local purchase-confirm candidate.
  const confirmedAt=new Date().toISOString();
  const gpay=await confirmGpay(orderNo,confirmedAt);
  const reward=await point.confirmPurchaseReward(pool,orderNo);
  return {ok:true,order_no:orderNo,reward,gpay};
}
module.exports={gpayBase,assertCandidate,confirmOne};
