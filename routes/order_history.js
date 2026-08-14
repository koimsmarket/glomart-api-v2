/* routes/order_history.js
 * GM_ORDER_HISTORY_ROUTE_V005_REFUND_METHOD
 * GM 주문조회 + 외부주문 고객 CS 액션 API.
 */
'use strict';
const express = require('express');
const router = express.Router();
const service = require('../services/order_history_service');
const VERSION = 'GM_ORDER_HISTORY_ROUTE_V005_REFUND_METHOD';
function clean(v){ return String(v == null ? '' : v).trim(); }
function db(req){ return req.app.locals.db || req.app.locals.pool; }
function statusFor(error){
  const m = clean(error && error.message || error);
  if(['member_id_required','order_no_required','action_required','unsupported_action','refund_method_required','refund_amount_required'].includes(m)) return 400;
  if(m === 'order_not_found') return 404;
  if(['action_not_allowed_for_current_status','cafe24_action_must_use_cafe24_bridge','mixed_order_requires_item_selection','deposit_refund_already_applied'].includes(m)) return 409;
  if(['refund_account_not_registered','member_not_found','deposit_balance_not_found'].includes(m)) return 422;
  return 500;
}

router.get('/api/gm/order-history/list', async (req, res) => {
  const memberId = clean(req.query.member_id || req.query.memberId);
  if(!memberId) return res.status(400).json({ ok:false, version:VERSION, error:'member_id_required' });
  try{
    const result = await service.list(db(req), {
      member_id: memberId, page: req.query.page, limit: req.query.limit,
      start_date: req.query.start_date, end_date: req.query.end_date,
      order_status: req.query.order_status,
      cs_only: req.query.cs_only,
      mode: req.query.mode
    });
    console.log('[GM_ORDER_HISTORY_LIST_OK]', JSON.stringify({ member_id:memberId, page:result.page, total:result.total, cs_only:req.query.cs_only||'' }));
    return res.json({ ok:true, version:VERSION, ...result });
  }catch(error){
    console.error('[GM_ORDER_HISTORY_LIST_FAIL]', String(error && error.message || error));
    return res.status(statusFor(error)).json({ ok:false, version:VERSION, error:String(error && error.message || error) });
  }
});

router.get('/api/gm/order-history/detail', async (req, res) => {
  try{
    const order = await service.detail(db(req), { member_id:req.query.member_id || req.query.memberId, order_no:req.query.order_no || req.query.orderNo });
    console.log('[GM_ORDER_HISTORY_DETAIL_OK]', JSON.stringify({ member_id:clean(req.query.member_id||req.query.memberId), order_no:order.order_no, source_type:order.source_type }));
    return res.json({ ok:true, version:VERSION, order });
  }catch(error){
    console.error('[GM_ORDER_HISTORY_DETAIL_FAIL]', String(error && error.message || error));
    return res.status(statusFor(error)).json({ ok:false, version:VERSION, error:String(error && error.message || error) });
  }
});

router.post('/api/gm/order-cs/action', async (req, res) => {
  const body = req.body || {};
  try{
    const result = await service.action(db(req), {
      member_id:body.member_id || body.memberId,
      order_no:body.order_no || body.orderNo,
      action:body.action,
      reason_code:body.reason_code || body.reasonCode,
      reason_text:body.reason_text || body.reasonText,
      refund_method:body.refund_method || body.refundMethod
    });
    console.log('[GM_ORDER_CS_ACTION_OK]', JSON.stringify({ member_id:clean(body.member_id||body.memberId), order_no:clean(body.order_no||body.orderNo), action:clean(body.action) }));
    return res.json({ ok:true, version:VERSION, ...result });
  }catch(error){
    console.error('[GM_ORDER_CS_ACTION_FAIL]', JSON.stringify({ order_no:clean(body.order_no||body.orderNo), action:clean(body.action), error:String(error && error.message || error) }));
    return res.status(statusFor(error)).json({ ok:false, version:VERSION, error:String(error && error.message || error) });
  }
});

console.log('[' + VERSION + '] routes/order_history registered');
module.exports = router;
