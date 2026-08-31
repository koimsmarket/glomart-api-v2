const express = require('express');
const router = express.Router();
const { TABLES, dbFrom, ok, fail, keySets } = require('./core');

router.get('/api/gm/builder/tables', (req,res)=>{
  ok(res, { tables:Object.keys(TABLES).map(k=>({ key:k, table:TABLES[k].table, keys:keySets(TABLES[k]) })) });
});

// GM_BUILDER_REFUND_REQUEST_LIST_V002_PAID_ONLY
// 1차 환불 운영: 실제 송금/마감 처리는 하지 않는다.
// 주문취소 후 BANK + REQUESTED 상태만 조회하고, 환불계좌는 주문에 복사하지 않고
// gm_member의 현재 환불계좌를 JOIN하여 Builder에 표시한다.


router.get('/api/gm/builder/refund-requests', async (req,res)=>{
  const db = dbFrom(req);
  const limit = Math.min(Math.max(Number(req.query.limit || 500), 1), 5000);
  try{
    const r = await db.query(`
      SELECT
        o.order_no,
        o.member_id,
        COALESCE(m.member_name,'') AS member_name,
        COALESCE(o.refund_amount,0)::bigint AS refund_amount,
        COALESCE(o.refund_method,'') AS refund_method,
        COALESCE(o.refund_status,'') AS refund_status,
        COALESCE(m.refund_bank_name,'') AS refund_bank_name,
        COALESCE(m.refund_account_no,'') AS refund_account_no,
        COALESCE(m.refund_account_holder,'') AS refund_account_holder,
        o.cancel_completed_at,
        o.updated_at
      FROM gm_order o
      LEFT JOIN gm_member m ON m.member_id=o.member_id
      WHERE UPPER(COALESCE(o.refund_method,''))='BANK'
        AND UPPER(COALESCE(o.refund_status,'')) IN ('REQUESTED','PENDING')
        /* 환불목록은 반드시 결제 완료된 주문만 표시한다. 부분입금/미결제는 취소만 하고 제외한다. */
        AND UPPER(COALESCE(o.payment_status,'')) IN (
          'PAID','OVERPAID','PAYMENT_COMPLETE','PAYMENT_COMPLETED',
          'COMPLETED','COMPLETE','DONE','SUCCESS','SETTLED'
        )
      ORDER BY COALESCE(o.cancel_completed_at,o.updated_at,o.ordered_at) ASC, o.order_no ASC
      LIMIT $1
    `,[limit]);
    ok(res,{count:r.rows.length,items:r.rows});
  }catch(e){
    fail(res,500,'refund request list failed',{detail:String(e&&e.message||e)});
  }
});

module.exports = router;
