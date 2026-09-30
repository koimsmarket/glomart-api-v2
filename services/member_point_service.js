'use strict';
// GM_MEMBER_POINT_SERVICE_V001
// Reward policy:
// - use: explicit user action only, max 20% of pure product amount, floor below 10 KRW
// - earn: purchase-confirm only, 3% of pure product amount actually paid after point use, floor below 10 KRW
// - shipping/remote shipping is excluded from both use-limit and earning base.

function clean(v){return String(v==null?'':v).trim();}
function money(v){const n=Number(v);return Number.isFinite(n)?Math.max(0,Math.round(n)):0;}
function floor10(v){return Math.floor(Math.max(0,Number(v)||0)/10)*10;}
const POINT_USE_RATE=0.20;
const REWARD_RATE=0.03;

async function resolveMember(client,id){
  const key=clean(id); if(!key)return null;
  const q=await client.query('SELECT member_id,point_balance FROM gm_member WHERE member_id=$1 OR cafe24_member_id=$1 LIMIT 1',[key]);
  return q.rows[0]||null;
}

async function ensureBalance(client,memberId,legacyBalance){
  await client.query(`INSERT INTO gm_point_balance(member_id,balance_amount,updated_at)
    VALUES($1,GREATEST(0,COALESCE($2,0)::BIGINT),NOW()) ON CONFLICT(member_id) DO NOTHING`,[memberId,money(legacyBalance)]);
  const q=await client.query('SELECT balance_amount FROM gm_point_balance WHERE member_id=$1 FOR UPDATE',[memberId]);
  return q.rows.length?money(q.rows[0].balance_amount):0;
}

function maxUseForProduct(productAmount){return floor10(money(productAmount)*POINT_USE_RATE);}
function rewardForPaidProduct(paidProductAmount){return floor10(money(paidProductAmount)*REWARD_RATE);}

async function getSummary(pool,requestedMember){
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const member=await resolveMember(client,requestedMember);
    if(!member){await client.query('ROLLBACK');return {ok:true,found:false,member_id:clean(requestedMember),point:{available_point:0}};}
    const balance=await ensureBalance(client,member.member_id,member.point_balance);
    await client.query('COMMIT');
    return {ok:true,found:true,member_id:member.member_id,point:{available_point:balance}};
  }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}
}

async function getTransactions(pool,requestedMember,page,limit){
  const client=await pool.connect();
  try{
    const member=await resolveMember(client,requestedMember);
    if(!member)return {ok:true,found:false,member_id:clean(requestedMember),page,limit,total:0,items:[]};
    const offset=(page-1)*limit;
    const c=await client.query('SELECT COUNT(*)::int AS total FROM gm_point_transaction WHERE member_id=$1',[member.member_id]);
    const q=await client.query(`SELECT transaction_id,member_id,order_no,transaction_at,transaction_type,grant_amount,use_amount,balance_after,description,created_at
      FROM gm_point_transaction WHERE member_id=$1 ORDER BY transaction_at DESC,transaction_id DESC LIMIT $2 OFFSET $3`,[member.member_id,limit,offset]);
    return {ok:true,found:true,member_id:member.member_id,page,limit,total:Number(c.rows[0]?.total||0),items:q.rows};
  }finally{client.release();}
}

async function applyOrderPoint(pool,input){
  input=input||{};
  const orderNo=clean(input.order_no||input.orderNo),requestedMember=clean(input.member_id||input.memberId);
  if(!orderNo)throw new Error('order_no_required');
  if(!requestedMember)throw new Error('member_id_required');
  if(input.use_point!==true && String(input.use_point||'').toUpperCase()!=='Y')return {ok:true,skipped:true,reason:'POINT_USE_NOT_REQUESTED',order_no:orderNo};
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',['POINT_ORDER_USE:'+orderNo]);
    const oq=await client.query('SELECT * FROM gm_order WHERE order_no=$1 FOR UPDATE',[orderNo]);
    if(!oq.rows.length)throw new Error('order_not_found');
    const order=oq.rows[0],memberId=clean(order.member_id);
    if(!memberId)throw new Error('member_order_required');
    if(memberId!==requestedMember)throw new Error('member_mismatch');
    const old=await client.query(`SELECT * FROM gm_point_transaction WHERE order_no=$1 AND member_id=$2 AND transaction_type='ORDER_USE' LIMIT 1`,[orderNo,memberId]);
    if(old.rows.length){await client.query('COMMIT');return {ok:true,idempotent:true,order_no:orderNo,member_id:memberId,point_used_amount:money(old.rows[0].use_amount),point_balance_after:money(old.rows[0].balance_after),max_point_use:maxUseForProduct(order.total_product_price)};}
    const mq=await client.query('SELECT member_id,point_balance FROM gm_member WHERE member_id=$1 FOR UPDATE',[memberId]);
    if(!mq.rows.length)throw new Error('member_not_found');
    const balance=await ensureBalance(client,memberId,mq.rows[0].point_balance);
    const productAmount=money(order.total_product_price);
    if(productAmount<=0)throw new Error('product_amount_required');
    const maxUse=maxUseForProduct(productAmount);
    const use=floor10(Math.min(balance,maxUse));
    const after=balance-use;
    if(use>0){
      await client.query('UPDATE gm_point_balance SET balance_amount=$2,updated_at=NOW() WHERE member_id=$1',[memberId,after]);
      await client.query(`INSERT INTO gm_point_transaction(member_id,order_no,transaction_at,transaction_type,grant_amount,use_amount,balance_after,description,created_at)
        VALUES($1,$2,NOW(),'ORDER_USE',0,$3,$4,$5,NOW())`,[memberId,orderNo,use,after,'주문 적립금 사용']);
      await client.query('UPDATE gm_member SET point_balance=$2,updated_at=NOW() WHERE member_id=$1',[memberId,after]);
    }
    await client.query('UPDATE gm_order SET point_used_amount=$2,updated_at=NOW() WHERE order_no=$1',[orderNo,use]);
    await client.query('COMMIT');
    return {ok:true,order_no:orderNo,member_id:memberId,point_used_amount:use,point_balance_after:after,max_point_use:maxUse,product_amount:productAmount,product_paid_amount:Math.max(0,productAmount-use)};
  }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}
}

async function confirmPurchaseReward(pool,orderNo){
  orderNo=clean(orderNo); if(!orderNo)throw new Error('order_no_required');
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',['POINT_PURCHASE_CONFIRM:'+orderNo]);
    const oq=await client.query('SELECT * FROM gm_order WHERE order_no=$1 FOR UPDATE',[orderNo]);
    if(!oq.rows.length)throw new Error('order_not_found');
    const order=oq.rows[0],memberId=clean(order.member_id);
    if(!memberId)throw new Error('member_order_required');
    const sellerStatus=clean(order.seller_status).toUpperCase(),shippingStatus=clean(order.shipping_status).toUpperCase();
    if(!(order.delivered_at || sellerStatus==='DELIVERED' || ['DELIVERED','COMPLETE','COMPLETED'].includes(shippingStatus)))throw new Error('order_not_delivered');
    if(['CANCELLED','CANCELED'].includes(sellerStatus) || /^CANCEL_/.test(clean(order.customer_status).toUpperCase()))throw new Error('order_cancelled');
    const old=await client.query(`SELECT * FROM gm_point_transaction WHERE order_no=$1 AND transaction_type='PURCHASE_CONFIRM_GRANT' LIMIT 1`,[orderNo]);
    if(old.rows.length){
      await client.query(`UPDATE gm_order SET customer_status='PURCHASE_CONFIRMED',purchase_confirmed_yn='Y',purchase_confirmed_at=COALESCE(purchase_confirmed_at,NOW()),point_granted_amount=$2,updated_at=NOW() WHERE order_no=$1`,[orderNo,money(old.rows[0].grant_amount)]);
      await client.query('COMMIT');
      return {ok:true,idempotent:true,order_no:orderNo,member_id:memberId,point_granted_amount:money(old.rows[0].grant_amount),point_balance_after:money(old.rows[0].balance_after)};
    }
    const mq=await client.query('SELECT member_id,point_balance FROM gm_member WHERE member_id=$1 FOR UPDATE',[memberId]);
    if(!mq.rows.length)throw new Error('member_not_found');
    const balance=await ensureBalance(client,memberId,mq.rows[0].point_balance);
    const product=money(order.total_product_price),used=money(order.point_used_amount);
    const paidProduct=Math.max(0,product-used);
    const grant=rewardForPaidProduct(paidProduct),after=balance+grant;
    if(grant>0){
      await client.query('UPDATE gm_point_balance SET balance_amount=$2,updated_at=NOW() WHERE member_id=$1',[memberId,after]);
      await client.query(`INSERT INTO gm_point_transaction(member_id,order_no,transaction_at,transaction_type,grant_amount,use_amount,balance_after,description,created_at)
        VALUES($1,$2,NOW(),'PURCHASE_CONFIRM_GRANT',$3,0,$4,$5,NOW())`,[memberId,orderNo,grant,after,'구매확정 3% 적립']);
      await client.query('UPDATE gm_member SET point_balance=$2,updated_at=NOW() WHERE member_id=$1',[memberId,after]);
    }
    await client.query(`UPDATE gm_order SET customer_status='PURCHASE_CONFIRMED',purchase_confirmed_yn='Y',purchase_confirmed_at=COALESCE(purchase_confirmed_at,NOW()),point_granted_amount=$2,updated_at=NOW() WHERE order_no=$1`,[orderNo,grant]);
    await client.query('COMMIT');
    return {ok:true,order_no:orderNo,member_id:memberId,product_amount:product,point_used_amount:used,product_paid_amount:paidProduct,reward_rate:REWARD_RATE,point_granted_amount:grant,point_balance_after:after};
  }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}
}

module.exports={POINT_USE_RATE,REWARD_RATE,floor10,maxUseForProduct,rewardForPaidProduct,getSummary,getTransactions,applyOrderPoint,confirmPurchaseReward};
