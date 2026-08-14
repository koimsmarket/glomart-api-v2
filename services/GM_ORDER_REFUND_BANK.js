/* services/GM_ORDER_REFUND_BANK.js
 * GM_ORDER_REFUND_BANK_V001
 *
 * BANK refund rule:
 * - Refund destination is ALWAYS gm_member.refund_*.
 * - Refund account is never copied into gm_order.
 * - Selecting BANK does NOT fabricate a bank withdrawal row.
 * - gm_order stores only refund_method/refund_status/refund_amount summary.
 * - The actual bank OUT evidence must later exist in the existing
 *   gm_bank_transaction company-wide bank ledger.
 */
'use strict';

const VERSION='GM_ORDER_REFUND_BANK_V001';
function clean(v){ return String(v==null?'':v).trim(); }

async function memberRefundAccount(client, memberId){
  const r=await client.query(
    `SELECT member_id,refund_bank_name,refund_account_no,refund_account_holder
       FROM gm_member
      WHERE member_id=$1
      LIMIT 1`,
    [clean(memberId)]
  );
  if(!r.rows.length) throw new Error('member_not_found');
  const m=r.rows[0];
  const out={
    member_id:clean(m.member_id),
    bank_name:clean(m.refund_bank_name),
    account_no:clean(m.refund_account_no),
    account_holder:clean(m.refund_account_holder)
  };
  if(!out.bank_name || !out.account_no || !out.account_holder){
    throw new Error('refund_account_not_registered');
  }
  return out;
}

async function prepare(client, input){
  const memberId=clean(input&&input.member_id);
  const orderNo=clean(input&&input.order_no);
  const amount=Math.max(0,Math.trunc(Number(input&&input.amount)||0));
  if(!memberId) throw new Error('member_id_required');
  if(!orderNo) throw new Error('order_no_required');
  if(amount<=0) throw new Error('refund_amount_required');

  const account=await memberRefundAccount(client,memberId);
  await client.query(
    `UPDATE gm_order
        SET refund_method='BANK',
            refund_status='PENDING',
            refund_amount=$3,
            refund_completed_at=NULL,
            updated_at=NOW()
      WHERE member_id=$1 AND order_no=$2`,
    [memberId,orderNo,amount]
  );
  return {version:VERSION,method:'BANK',status:'PENDING',amount,account};
}

module.exports={VERSION,memberRefundAccount,prepare};
