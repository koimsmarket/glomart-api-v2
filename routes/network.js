'use strict';

const express = require('express');
const router = express.Router();
const {
  ensureNetworkTables,
  periodNames,
  monthlyOrderTable,
  monthlyReturnTable,
  monthlyNetworkTable,
  yearlyOrderTable,
  yearlyReturnTable,
  yearlyNetworkTable
} = require('../services/GM_NETWORK_INCENTIVE_ENGINE');

function pool(req){ return req.app.locals.pool; }
function s(v){ return v === undefined || v === null ? '' : String(v).trim(); }
function validYm(v){ return /^\d{4}_\d{2}$/.test(String(v || '')); }
function validY(v){ return /^\d{4}$/.test(String(v || '')); }

router.post('/api/gm/network/ensure-tables', async (req, res) => {
  try{
    const result = await ensureNetworkTables(pool(req));
    res.json({ ok:true, ...result });
  }catch(e){ res.status(500).json({ ok:false, error:String(e && e.message || e) }); }
});

router.get('/api/gm/network/periods', (req, res) => {
  const p = periodNames();
  res.json({ ok:true, ...p, tables:{
    monthly_order_current: monthlyOrderTable(p.currentYm),
    monthly_order_next: monthlyOrderTable(p.nextYm),
    monthly_return_current: monthlyReturnTable(p.currentYm),
    monthly_return_next: monthlyReturnTable(p.nextYm),
    monthly_network_current: monthlyNetworkTable(p.currentYm),
    monthly_network_next: monthlyNetworkTable(p.nextYm),
    yearly_order_current: yearlyOrderTable(p.currentYear),
    yearly_order_next: yearlyOrderTable(p.nextYear),
    yearly_return_current: yearlyReturnTable(p.currentYear),
    yearly_return_next: yearlyReturnTable(p.nextYear),
    yearly_network_current: yearlyNetworkTable(p.currentYear),
    yearly_network_next: yearlyNetworkTable(p.nextYear)
  }});
});

router.get('/api/gm/network/monthly/:ym/:member_id', async (req, res) => {
  try{
    const ym = s(req.params.ym);
    const memberId = s(req.params.member_id);
    if(!validYm(ym)) return res.status(400).json({ ok:false, error:'invalid ym. Use YYYY_MM' });
    const orderTable = monthlyOrderTable(ym);
    const returnTable = monthlyReturnTable(ym);
    const networkTable = monthlyNetworkTable(ym);
    const client = await pool(req).connect();
    try{
      const [o, r, n] = await Promise.all([
        client.query(`SELECT * FROM "${orderTable}" WHERE member_id=$1 ORDER BY step_no`, [memberId]),
        client.query(`SELECT * FROM "${returnTable}" WHERE member_id=$1 ORDER BY step_no`, [memberId]),
        client.query(`SELECT * FROM "${networkTable}" WHERE member_id=$1`, [memberId])
      ]);
      res.json({ ok:true, ym, member_id:memberId, order:o.rows, return:r.rows, network:n.rows[0] || null });
    } finally { client.release(); }
  }catch(e){ res.status(500).json({ ok:false, error:String(e && e.message || e) }); }
});

router.get('/api/gm/network/yearly/:year/:member_id', async (req, res) => {
  try{
    const year = s(req.params.year);
    const memberId = s(req.params.member_id);
    if(!validY(year)) return res.status(400).json({ ok:false, error:'invalid year. Use YYYY' });
    const orderTable = yearlyOrderTable(year);
    const returnTable = yearlyReturnTable(year);
    const networkTable = yearlyNetworkTable(year);
    const client = await pool(req).connect();
    try{
      const [o, r, n] = await Promise.all([
        client.query(`SELECT * FROM "${orderTable}" WHERE member_id=$1 ORDER BY step_no`, [memberId]),
        client.query(`SELECT * FROM "${returnTable}" WHERE member_id=$1 ORDER BY step_no`, [memberId]),
        client.query(`SELECT * FROM "${networkTable}" WHERE member_id=$1`, [memberId])
      ]);
      res.json({ ok:true, year, member_id:memberId, order:o.rows, return:r.rows, network:n.rows[0] || null });
    } finally { client.release(); }
  }catch(e){ res.status(500).json({ ok:false, error:String(e && e.message || e) }); }
});

module.exports = router;
