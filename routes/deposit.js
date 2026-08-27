/* routes/deposit.js
 * GM_DEPOSIT_V007_READ_API
 * Glomart 전용 예치금 조회 API.
 * Source of truth: gm_deposit_balance + gm_deposit_transaction
 */
'use strict';

const express=require('express');
const router=express.Router();

function clean(v){return v==null?'':String(v).trim();}
function num(v){const n=Number(v);return Number.isFinite(n)?Math.round(n):0;}
function lim(v,def,max){const n=Number(v);return Number.isFinite(n)?Math.min(max,Math.max(1,Math.trunc(n))):def;}
function pool(req){return req.app.locals.pool;}

async function resolveMember(client,id){
  const r=await client.query(
    'SELECT member_id FROM gm_member WHERE member_id=$1 OR cafe24_member_id=$1 LIMIT 1',
    [id]
  );
  return r.rows[0]||null;
}

router.get('/api/gm/deposit/summary',async(req,res)=>{
  const requested=clean(req.query.member_id||req.query.cafe24_member_id||req.query.id);
  if(!requested)return res.status(400).json({ok:false,error:'member_id required'});
  const p=pool(req); if(!p)return res.status(500).json({ok:false,error:'DB pool is not attached'});
  const client=await p.connect();
  try{
    const member=await resolveMember(client,requested);
    if(!member)return res.json({ok:true,found:false,member_id:requested,deposit:{all_deposit:0,used_deposit:0,available_deposit:0}});
    const memberId=clean(member.member_id);
    const b=await client.query('SELECT balance_amount FROM gm_deposit_balance WHERE member_id=$1 LIMIT 1',[memberId]);
    const balance=b.rows[0]?num(b.rows[0].balance_amount):0;
    const t=await client.query(`
      SELECT COALESCE(SUM(deposit_amount),0)::bigint AS deposit_total,
             COALESCE(SUM(withdraw_amount),0)::bigint AS withdraw_total,
             COALESCE(SUM(CASE WHEN transaction_type='ORDER_REFUND' THEN deposit_amount ELSE 0 END),0)::bigint AS refunded_total,
             COUNT(*)::int AS transaction_count
        FROM gm_deposit_transaction
       WHERE member_id=$1`,[memberId]);
    const depositTotal=num(t.rows[0]&&t.rows[0].deposit_total);
    const withdrawTotal=num(t.rows[0]&&t.rows[0].withdraw_total);
    // migration 시점의 기존 잔액은 가짜 거래행을 만들지 않았으므로
    // 누적액은 현재잔액+누적차감보다 작아지지 않게 계산한다.
    const allDeposit=Math.max(depositTotal,balance+withdrawTotal);
    res.json({ok:true,found:true,member_id:memberId,deposit:{
      all_deposit:allDeposit,
      used_deposit:withdrawTotal,
      refunded_deposit:num(t.rows[0]&&t.rows[0].refunded_total),
      available_deposit:balance,
      transaction_count:num(t.rows[0]&&t.rows[0].transaction_count)
    }});
  }catch(e){
    res.status(500).json({ok:false,error:String(e&&e.message||e)});
  }finally{client.release();}
});

router.get('/api/gm/deposit/transactions',async(req,res)=>{
  const requested=clean(req.query.member_id||req.query.cafe24_member_id||req.query.id);
  const page=lim(req.query.page,1,1000000),limit=lim(req.query.limit,10,100),offset=(page-1)*limit;
  const filter=clean(req.query.filter||'all').toLowerCase();
  if(!requested)return res.status(400).json({ok:false,error:'member_id required'});
  const p=pool(req); if(!p)return res.status(500).json({ok:false,error:'DB pool is not attached'});
  const client=await p.connect();
  try{
    const member=await resolveMember(client,requested);
    if(!member)return res.json({ok:true,found:false,member_id:requested,page,limit,total:0,items:[]});
    const memberId=clean(member.member_id);
    let where='member_id=$1',params=[memberId];
    if(filter==='used') where += ' AND withdraw_amount > 0';
    else if(filter==='refund') where += " AND transaction_type='ORDER_REFUND'";
    const c=await client.query('SELECT COUNT(*)::int AS total FROM gm_deposit_transaction WHERE '+where,params);
    const r=await client.query(`
      SELECT transaction_id,member_id,bank_transaction_id,order_no,transaction_at,transaction_type,
             deposit_amount,withdraw_amount,balance_after,description,created_at
        FROM gm_deposit_transaction
       WHERE ${where}
       ORDER BY transaction_at DESC,transaction_id DESC
       LIMIT $2 OFFSET $3`,[memberId,limit,offset]);
    res.json({ok:true,found:true,member_id:memberId,page,limit,total:num(c.rows[0]&&c.rows[0].total),items:r.rows});
  }catch(e){
    res.status(500).json({ok:false,error:String(e&&e.message||e)});
  }finally{client.release();}
});

module.exports=router;
