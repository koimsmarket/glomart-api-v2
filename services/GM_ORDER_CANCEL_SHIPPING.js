/* GM_ORDER_CANCEL_SHIPPING_V001 - Quote only; never cancels or refunds. */
'use strict';
const num=v=>{const n=Number(v);return Number.isFinite(n)?Math.max(0,Math.trunc(n)):0;};
const str=v=>String(v==null?'':v).trim();
const upper=v=>str(v).toUpperCase();
const sellerFault=new Set(['B','J','F','K']); // delay, wrong delivery, description mismatch, defect
function quote(order,items,reasonCode){
  const buyerPays=!sellerFault.has(upper(reasonCode));
  const shipped=['SHIPPING','SHIPPED','IN_TRANSIT','DELIVERED','COMPLETE','COMPLETED'].includes(upper(order.seller_status)) ||
    ['SHIPPING','SHIPPED','IN_TRANSIT','DELIVERED','COMPLETE','COMPLETED'].includes(upper(order.shipping_status)) || Boolean(order.delivered_at);
  const groups=new Map();
  for(const [index,item] of (items||[]).entries()){
    const t=upper(item.delivery_type||item.shipping_type||'');
    const type=t.includes('FRESH')?'FRESH':t.includes('BUNDLE')?'BUNDLE':t.includes('FREE')?'FREE':'SELLER';
    // Seller delivery: each product kind, not seller account and not ordered quantity.
    const key=type==='SELLER'?'SELLER_ITEM|'+str(item.pi_ii_vi||item.product_uid||item.source_uid||'ROW_'+index):type;
    const base=num(item.delivery_fee),remote=num(item.extra_area_delivery_fee);
    const prev=groups.get(key);
    if(prev){prev.base=Math.max(prev.base,base);prev.remote=Math.max(prev.remote,remote);prev.count+=1;}
    else groups.set(key,{key,type,name:type==='SELLER'?str(item.product_name||'판매자배송 상품'):type==='BUNDLE'?'묶음배송':type==='FRESH'?'신선배송':'무료배송',base,remote,count:1});
  }
  const rows=Array.from(groups.values()).map(g=>{
    const appliedBase=g.base>0?g.base:3000;
    const shippingFee=buyerPays&&shipped?2*(appliedBase+g.remote):0;
    return {key:g.key,type:g.type,name:g.name,base_delivery_fee:appliedBase,extra_area_delivery_fee:g.remote,customer_shipping_fee:shippingFee,items_in_group:g.count};
  });
  const amount=rows.reduce((s,g)=>s+g.customer_shipping_fee,0);
  return {reason_code:upper(reasonCode),buyer_fault:buyerPays,shipped,groups:rows,customer_shipping_fee:amount,policy:'(배송비+도서산간배송비)*2 / 기본 배송비 없으면 3000원 / 출고 전 0원',quote_only:true};
}
module.exports={quote};
