'use strict';

const express = require('express');
const router = express.Router();
const { buildSummary, buildAttention } = require('../services/dashboard_service');

/*
 * GM_AUTO_ORDER_DASHBOARD_API_V015
 * API routing only. DB aggregation belongs to services/dashboard_service.js.
 * Never connects to Coupang/Ali.
 */

function poolFrom(req){
  return req && req.app && req.app.locals ? req.app.locals.pool : null;
}

router.get('/api/auto-order/dashboard/summary', async (req, res) => {
  const pool = poolFrom(req);
  if(!pool) return res.status(503).json({ ok:false, version:'GM_AUTO_ORDER_DASHBOARD_API_V015', error:'database pool not ready' });
  try {
    const data = await buildSummary(pool);
    return res.json({ ok:true, version:'GM_AUTO_ORDER_DASHBOARD_API_V015', data });
  } catch (e) {
    console.error('[GM_AUTO_ORDER_DASHBOARD_SUMMARY_V015]', String(e && e.stack || e));
    return res.status(500).json({ ok:false, version:'GM_AUTO_ORDER_DASHBOARD_API_V015', error:'dashboard summary failed', detail:String(e && e.message || e) });
  }
});

router.get('/api/auto-order/dashboard/clients', (req, res) => {
  // Client registry is intentionally not implemented in the dashboard layer yet.
  return res.json({ ok:true, version:'GM_AUTO_ORDER_DASHBOARD_API_V015', data:[] });
});

router.get('/api/auto-order/dashboard/attention', async (req, res) => {
  const pool = poolFrom(req);
  if(!pool) return res.status(503).json({ ok:false, version:'GM_AUTO_ORDER_DASHBOARD_API_V015', error:'database pool not ready' });
  try {
    const data = await buildAttention(pool);
    return res.json({ ok:true, version:'GM_AUTO_ORDER_DASHBOARD_API_V015', data });
  } catch (e) {
    console.error('[GM_AUTO_ORDER_DASHBOARD_ATTENTION_V015]', String(e && e.stack || e));
    return res.status(500).json({ ok:false, version:'GM_AUTO_ORDER_DASHBOARD_API_V015', error:'dashboard attention failed', detail:String(e && e.message || e) });
  }
});


// GM_AUTO_ORDER_LIST_API_V001
router.use(require('./auto_order_orders'));

module.exports = router;
