/* GM_ORDER_CANCEL_SHIPPING_V001 - Quote only; never cancels or refunds. */
'use strict';
const num=v=>{const n=Number(v);return Number.isFinite(n)?Math.max(0,Math.trunc(n)):0;};
const str=v=>String(v==null?'':v).trim();
const upper=v=>str(v).toUpperCase();
const sellerFault=new Set(['B','J','F','K']); // delay, wrong delivery, description mismatch, defect
function quote(order,items,reasonCode){
  const buyerPays=!sellerFault.has(upper(reasonCode));
  const shippedStatuses=new Set(['SHIPPING','SHIPPED','IN_TRANSIT','DELIVERED','COMPLETE','COMPLETED']);
  const preShipStatuses=new Set(['PENDING','PREPARING','READY','READY_TO_ORDER','ORDERED','NOT_SHIPPED']);
  const orderShipped=shippedStatuses.has(upper(order.seller_status)) || shippedStatuses.has(upper(order.shipping_status)) || Boolean(order.delivered_at);
  const orderPreShip=preShipStatuses.has(upper(order.seller_status)) && !orderShipped && !upper(order.shipping_status).match(/SHIPPING|SHIPPED|TRANSIT|DELIVERED|COMPLETE/);
  let uncertain=false;
  function itemShipped(item){
    const own=upper(item.item_shipping_status);
    if(shippedStatuses.has(own))return true;
    if(preShipStatuses.has(own))return false;
    if(own){uncertain=true;return false;}
    // Without a recorded per-item shipment state, never assert that all items shipped.
    // For single-item orders the order status is sufficient; multi-item orders require manual review.
    if(orderPreShip)return false; // Order-wide confirmed pre-shipment is sufficient even for multiple items.
    if((items||[]).length===1)return orderShipped;
    uncertain=true;return false;
  }
  const groups=new Map();
  for(const [index,item] of (items||[]).entries()){
    const t=upper(item.delivery_type||item.shipping_type||'');
    const type=t.includes('FRESH')?'FRESH':t.includes('BUNDLE')?'BUNDLE':t.includes('FREE')?'FREE':'SELLER';
    // Seller delivery: each product kind, not seller account and not ordered quantity.
    const key=type==='SELLER'?'SELLER_ITEM|'+str(item.source_mall||item.mall_code||'')+'|'+str(item.pi_ii_vi||item.product_uid||item.source_uid||'ROW_'+index):type;
    const base=num(item.delivery_fee),remote=num(item.extra_area_delivery_fee);
    const shipped=itemShipped(item);
    const prev=groups.get(key);
    if(prev){prev.base=Math.max(prev.base,base);prev.remote=Math.max(prev.remote,remote);prev.count+=1;prev.shipped=prev.shipped||shipped;}
    else groups.set(key,{key,type,name:type==='SELLER'?str(item.product_name||'판매자배송 상품'):type==='BUNDLE'?'묶음배송':type==='FRESH'?'신선배송':'무료배송',base,remote,count:1,shipped});
  }
  const rows=Array.from(groups.values()).map(g=>{
    const appliedBase=g.base>0?g.base:3000;
    const roundTripFee=g.shipped?2*(appliedBase+g.remote):0;
    const shippingFee=buyerPays?roundTripFee:0;
    const sellerShippingFee=buyerPays?0:roundTripFee;
    return {key:g.key,type:g.type,name:g.name,base_delivery_fee:appliedBase,extra_area_delivery_fee:g.remote,customer_shipping_fee:shippingFee,seller_shipping_fee:sellerShippingFee,round_trip_shipping_fee:roundTripFee,fee_payer:buyerPays?'CUSTOMER':'SELLER',items_in_group:g.count,shipped:g.shipped};
  });
  const amount=rows.reduce((s,g)=>s+g.customer_shipping_fee,0);
  const sellerAmount=rows.reduce((s,g)=>s+g.seller_shipping_fee,0);
  return {reason_code:upper(reasonCode),buyer_fault:buyerPays,fee_payer:buyerPays?'CUSTOMER':'SELLER',seller_shipping_fee:sellerAmount,shipped:rows.some(g=>g.shipped),manual_shipping_review:uncertain,groups:rows,customer_shipping_fee:amount,policy:'(배송비+도서산간배송비)*2 / 기본 배송비 없으면 3000원 / 출고 전 0원',quote_only:true};
}
// Informational only. This is NOT a payout approval, and does not alter existing refund modules.
function refundPreview(order,shippingFee,depositUsed){
  const method=upper(order.payment_method);
  const status=upper(order.payment_status);
  const paid=['PAID','OVERPAID','PAYMENT_COMPLETE','PAYMENT_COMPLETED','COMPLETED','COMPLETE','DONE','SUCCESS','SETTLED'].includes(status);
  let payment=0,source='';
  if(method==='GPAY'){
    // G-PAY order total is only a display estimate when server records payment complete.
    if(paid){payment=num(order.total_payment_price);source='GPAY_ORDER_TOTAL';}
  }else{
    payment=num(order.actual_payment_amount)+num(depositUsed);
    source='CASH_PLUS_DEPOSIT_USE';
    if(payment===0&&paid){payment=Math.max(num(order.expected_payment_amount),num(order.total_payment_price));source='LEGACY_PAID_FALLBACK';}
  }
  if(!paid && payment===0)return {available:false,paid_amount:0,customer_shipping_fee:shippingFee,estimated_refund_amount:null,remaining_shipping_fee:0,source:'PAYMENT_NOT_VERIFIED',manual_review:true};
  return {available:true,paid_amount:payment,customer_shipping_fee:shippingFee,estimated_refund_amount:Math.max(0,payment-shippingFee),remaining_shipping_fee:Math.max(0,shippingFee-payment),source,manual_review:true};
}
module.exports={quote,refundPreview};
