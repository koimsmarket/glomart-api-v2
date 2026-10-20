'use strict';
// GM_GPAY_V064 — pure settlement contract. Does NOT debit, issue, or mark an order paid.
// Point policy: 20% of product subtotal, 10 KRW increments; reward 3% after purchase confirmation.
const RATE_USE = 20;
const RATE_REWARD = 3;
function integer(v,name){if(typeof v==='boolean'||v===null||v===undefined||String(v).trim()==='')throw Error(name+'_required');const n=Number(v);if(!Number.isSafeInteger(n)||n<0)throw Error(name+'_invalid');return n;}
function floor10(n){return Math.floor(n/10)*10;}
function quote({product_amount_krw,shipping_amount_krw=0,point_use_krw=0,available_point_krw=0}){
 const product=integer(product_amount_krw,'product_amount_krw');
 const shipping=integer(shipping_amount_krw,'shipping_amount_krw');
 const requested=integer(point_use_krw,'point_use_krw');
 const available=integer(available_point_krw,'available_point_krw');
 if(product===0)throw Error('product_amount_zero');
 const cap=floor10(Math.floor(product*RATE_USE/100));
 if(requested%10!==0)throw Error('point_use_not_multiple_of_10');
 if(requested>cap)throw Error('point_use_exceeds_cap');
 if(requested>available)throw Error('point_balance_insufficient');
 const due=product+shipping-requested;
 if(!Number.isSafeInteger(due)||due<=0)throw Error('pay_amount_invalid');
 const rewardBase=product-requested;
 return Object.freeze({product_amount_krw:product,shipping_amount_krw:shipping,order_amount_krw:product+shipping,point_used_amount_krw:requested,point_max_usable_krw:Math.min(cap,floor10(available)),pay_amount_g:due,expected_purchase_confirmation_reward_krw:floor10(Math.floor(rewardBase*RATE_REWARD/100)),reward_base_krw:rewardBase,reward_stage:'PURCHASE_CONFIRM_ONLY'});
}
module.exports={quote};
