/* services/GM_ORDER_REFUND_DEPOSIT.js
 * GM_ORDER_REFUND_DEPOSIT_V002_DEDICATED_BALANCE_LEDGER
 *
 * DEPOSIT refund rule:
 * - No bank withdrawal occurs.
 * - gm_deposit_balance is the dedicated current balance table.
 * - gm_deposit_transaction is the dedicated member-by-member history.
 * - ORDER_REFUND links the refund to gm_order.order_no.
 * - Both balance + history are updated in the SAME DB transaction.
 * - gm_member.deposit_balance/usable_balance are synchronized only for
 *   backward compatibility with existing code until all reads move to
 *   gm_deposit_balance. They are not a third new ledger.
 */
'use strict';

const VERSION='GM_ORDER_REFUND_DEPOSIT_V002_DEDICATED_BALANCE_LEDGER';
function clean(v){ return String(v==null?'':v).trim(); }

async function apply(client,input){
  const memberId=clean(input&&input.member_id);
  const orderNo=clean(input&&input.order_no);
  const amount=Math.max(0,Math.trunc(Number(input&&input.amount)||0));
  if(!memberId) throw new Error('member_id_required');
  if(!orderNo) throw new Error('order_no_required');
  if(amount<=0) throw new Error('refund_amount_required');

  const member=(await client.query(
    `SELECT member_id,deposit_balance,usable_balance
       FROM gm_member
      WHERE member_id=$1
      FOR UPDATE`,
    [memberId]
  )).rows[0];
  if(!member) throw new Error('member_not_found');

  // Migration seeds gm_deposit_balance, but make this robust for members
  // created after the migration as well.
  await client.query(
    `INSERT INTO gm_deposit_balance(member_id,balance_amount,updated_at)
     VALUES($1,GREATEST(0,COALESCE($2,0)::BIGINT),NOW())
     ON CONFLICT(member_id) DO NOTHING`,
    [memberId,Number(member.deposit_balance||0)]
  );

  const bal=(await client.query(
    `SELECT member_id,balance_amount
       FROM gm_deposit_balance
      WHERE member_id=$1
      FOR UPDATE`,
    [memberId]
  )).rows[0];
  if(!bal) throw new Error('deposit_balance_not_found');

  const duplicate=(await client.query(
    `SELECT transaction_id
       FROM gm_deposit_transaction
      WHERE order_no=$1 AND transaction_type='ORDER_REFUND'
      LIMIT 1`,
    [orderNo]
  )).rows[0];
  if(duplicate) throw new Error('deposit_refund_already_applied');

  const before=Number(bal.balance_amount||0);
  const after=before+amount;

  await client.query(
    `UPDATE gm_deposit_balance
        SET balance_amount=$2,updated_at=NOW()
      WHERE member_id=$1`,
    [memberId,after]
  );

  const tx=(await client.query(
    `INSERT INTO gm_deposit_transaction(
       member_id,bank_transaction_id,order_no,transaction_at,transaction_type,
       deposit_amount,withdraw_amount,balance_after,description,created_at
     ) VALUES($1,NULL,$2,NOW(),'ORDER_REFUND',$3,0,$4,$5,NOW())
     RETURNING transaction_id`,
    [memberId,orderNo,amount,after,'주문취소 환불금 예치금 적립']
  )).rows[0];

  // Compatibility sync with existing code that still reads gm_member.
  await client.query(
    `UPDATE gm_member
        SET deposit_balance=$2,
            usable_balance=GREATEST(0,COALESCE(usable_balance,0)::BIGINT + $3),
            updated_at=NOW()
      WHERE member_id=$1`,
    [memberId,after,amount]
  );

  await client.query(
    `UPDATE gm_order
        SET refund_method='DEPOSIT',
            refund_status='COMPLETED',
            refund_amount=$3,
            refund_completed_at=NOW(),
            updated_at=NOW()
      WHERE member_id=$1 AND order_no=$2`,
    [memberId,orderNo,amount]
  );

  return {
    version:VERSION,method:'DEPOSIT',status:'COMPLETED',amount,
    deposit_transaction_id:tx&&tx.transaction_id,
    balance_after:after
  };
}

module.exports={VERSION,apply};
