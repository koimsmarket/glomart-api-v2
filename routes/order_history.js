/* routes/order_history.js
 * GM_ORDER_HISTORY_ROUTE_V003
 * 주문조회 전용 읽기 API. 주문 생성/결제/완료 라우트와 분리한다.
 */
'use strict';
const express = require('express');
const router = express.Router();
const service = require('../services/order_history_service');
const VERSION = 'GM_ORDER_HISTORY_ROUTE_V003';
function clean(v){ return String(v == null ? '' : v).trim(); }
function db(req){ return req.app.locals.db || req.app.locals.pool; }

router.get('/api/gm/order-history/list', async (req, res) => {
  const memberId = clean(req.query.member_id || req.query.memberId);
  if(!memberId) return res.status(400).json({ ok:false, version:VERSION, error:'member_id_required' });
  try{
    const result = await service.list(db(req), {
      member_id: memberId,
      page: req.query.page,
      limit: req.query.limit,
      start_date: req.query.start_date,
      end_date: req.query.end_date
    });
    console.log('[GM_ORDER_HISTORY_LIST_OK]', JSON.stringify({ member_id:memberId, page:result.page, total:result.total }));
    return res.json({ ok:true, version:VERSION, ...result });
  }catch(error){
    console.error('[GM_ORDER_HISTORY_LIST_FAIL]', String(error && error.message || error));
    return res.status(500).json({ ok:false, version:VERSION, error:String(error && error.message || error) });
  }
});

console.log('[' + VERSION + '] routes/order_history registered');
module.exports = router;
