'use strict';

const express = require('express');
const router = express.Router();
const { periodNames, monthlyNetworkTable } = require('../services/GM_NETWORK_INCENTIVE_ENGINE');

function pool(req){ return req.app.locals.pool; }
function s(v){ return v === undefined || v === null ? '' : String(v).trim(); }
function n0(v){ const n = Number(v); return Number.isFinite(n) ? Math.round(n) : 0; }
function limitNum(v, def, max){ const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(1, Math.round(n))) : def; }

async function tableExists(client, tableName){
  const r = await client.query('SELECT to_regclass($1) AS name', [tableName]);
  return !!(r.rows[0] && r.rows[0].name);
}

function redactMember(row){
  if(!row) return null;
  const out = { ...row };
  delete out.password_hash;
  delete out.cafe24_raw_json;
  return out;
}

function networkStepsFromMonthlyRow(row){
  if(!row) return [];
  const rows = [];
  for(let step = 1; step <= 5; step++){
    rows.push({
      step_no: step,
      member_count: n0(row[`step${step}_member_count`]),
      order_amount: n0(row[`step${step}_sales_amount`]),
      confirmed_order_amount: n0(row[`step${step}_sales_amount`]),
      incentive_rate: Number(row[`step${step}_rate`] || 0),
      incentive_amount: n0(row[`step${step}_incentive_amount`]),
      final_incentive_amount: n0(row[`step${step}_incentive_amount`])
    });
  }
  return rows;
}

function monthlySummaryFromRow(ym, row){
  if(!row) return [];
  return [{
    period: ym,
    step_no: 'TOTAL',
    confirmed_order_amount: n0(row.total_sales_amount),
    final_incentive_amount: n0(row.gross_incentive_amount),
    qualified_incentive_amount: n0(row.qualified_incentive_amount),
    cash_amount: n0(row.cash_amount),
    point_amount: n0(row.point_amount),
    unpaid_amount: n0(row.unpaid_amount),
    carry_forward_amount: n0(row.carry_forward_amount)
  }];
}

router.get('/api/gm/account/summary', async (req, res) => {
  const memberId = s(req.query.member_id || req.query.cafe24_member_id || req.query.id);
  if(!memberId) return res.status(400).json({ ok:false, error:'member_id required' });
  const p = pool(req);
  if(!p) return res.status(500).json({ ok:false, error:'DB pool is not attached' });

  const client = await p.connect();
  try{
    const memberResult = await client.query('SELECT * FROM gm_member WHERE member_id=$1 OR cafe24_member_id=$1 LIMIT 1', [memberId]);
    const member = memberResult.rows[0] || null;
    if(!member){
      return res.json({ ok:true, found:false, member_id:memberId, member:null, balances:{}, network_steps:[], monthly_summary:[], ledger_recent:[] });
    }

    const actualMemberId = s(member.member_id || memberId);
    const ledgerResult = await client.query(`
      SELECT * FROM gm_member_ledger
      WHERE member_id=$1
      ORDER BY created_at DESC
      LIMIT 10
    `, [actualMemberId]).catch(() => ({ rows: [] }));

    const period = periodNames();
    const netTable = monthlyNetworkTable(period.currentYm);
    let networkRow = null;
    if(await tableExists(client, netTable)){
      const nr = await client.query(`SELECT * FROM "${netTable}" WHERE member_id=$1 LIMIT 1`, [actualMemberId]).catch(() => ({ rows: [] }));
      networkRow = nr.rows[0] || null;
    }

    res.json({
      ok:true,
      found:true,
      member: redactMember(member),
      balances:{
        deposit_balance:n0(member.deposit_balance),
        bonus_balance:n0(member.bonus_balance),
        usable_balance:n0(member.usable_balance),
        refund_balance:n0(member.refund_balance),
        point_balance:n0(member.point_balance)
      },
      period,
      network_steps: networkStepsFromMonthlyRow(networkRow),
      monthly_summary: monthlySummaryFromRow(period.currentYm, networkRow),
      ledger_recent: ledgerResult.rows
    });
  }catch(e){
    res.status(500).json({ ok:false, error:String(e && e.message || e) });
  }finally{
    client.release();
  }
});

router.get('/api/gm/account/ledger', async (req, res) => {
  const memberId = s(req.query.member_id || req.query.cafe24_member_id || req.query.id);
  const limit = limitNum(req.query.limit, 80, 200);
  if(!memberId) return res.status(400).json({ ok:false, error:'member_id required' });
  const p = pool(req);
  if(!p) return res.status(500).json({ ok:false, error:'DB pool is not attached' });

  try{
    const r = await p.query(`
      SELECT * FROM gm_member_ledger
      WHERE member_id=$1
      ORDER BY created_at DESC
      LIMIT $2
    `, [memberId, limit]);
    res.json({ ok:true, member_id:memberId, items:r.rows });
  }catch(e){
    res.status(500).json({ ok:false, error:String(e && e.message || e) });
  }
});

module.exports = router;
