'use strict';

/*
 * GM_NETWORK_INCENTIVE_ENGINE
 * Final policy for Glomart network business incentive.
 * - Seller settlement is excluded. Cafe24 seller flow remains separate.
 * - Base relation: gm_member.member_id + gm_member.recommender_id only.
 * - Order/return daily performance is monthly summary table, not transaction ledger.
 * - Summary rows are created only after transaction occurs.
 * - For a first transaction for an owner in a period, step 1~5 rows are created.
 * - Current/next month and current/next year tables are always ensured from KST date.
 */

function pad2(n){ return String(n).padStart(2, '0'); }
function n0(v){ const n = Number(v); return Number.isFinite(n) ? Math.round(n) : 0; }
function s(v){ return v === undefined || v === null ? '' : String(v).trim(); }
function assertYm(ym){ if(!/^\d{4}_\d{2}$/.test(ym)) throw new Error('invalid ym: ' + ym); return ym; }
function assertY(y){ if(!/^\d{4}$/.test(y)) throw new Error('invalid year: ' + y); return y; }
function qident(name){ return '"' + String(name).replace(/"/g, '""') + '"'; }

function kstParts(baseDate = new Date()){
  const dt = new Date(baseDate.getTime() + 9 * 60 * 60 * 1000);
  const y = dt.getUTCFullYear();
  const m = dt.getUTCMonth() + 1;
  const d = dt.getUTCDate();
  return { y, m, d, ym:`${y}_${pad2(m)}`, year:String(y) };
}
function addMonths(y, m, add){
  const z = new Date(Date.UTC(y, m - 1 + add, 1));
  return { y:z.getUTCFullYear(), m:z.getUTCMonth() + 1, ym:`${z.getUTCFullYear()}_${pad2(z.getUTCMonth() + 1)}` };
}
function addYears(y, add){ return String(Number(y) + Number(add)); }
function periodNames(baseDate = new Date()){
  const k = kstParts(baseDate);
  const nextMonth = addMonths(k.y, k.m, 1);
  const nextYear = addYears(k.y, 1);
  return {
    currentYm:k.ym,
    nextYm:nextMonth.ym,
    currentYear:String(k.y),
    nextYear,
    day:pad2(k.d),
    month:pad2(k.m)
  };
}

function monthlyOrderTable(ym){ return 'gm_network_order_' + assertYm(ym); }
function monthlyReturnTable(ym){ return 'gm_network_return_' + assertYm(ym); }
function monthlyNetworkTable(ym){ return 'gm_network_' + assertYm(ym); }
function yearlyOrderTable(year){ return 'gm_network_order_' + assertY(year); }
function yearlyReturnTable(year){ return 'gm_network_return_' + assertY(year); }
function yearlyNetworkTable(year){ return 'gm_network_' + assertY(year); }

function dayAmountColumns(prefix){
  return Array.from({length:31}, (_,i)=>`${prefix}_${pad2(i+1)} NUMERIC(14,0) NOT NULL DEFAULT 0`).join(',\n        ');
}
function monthAmountColumns(prefix){
  return Array.from({length:12}, (_,i)=>`${prefix}_${pad2(i+1)} NUMERIC(14,0) NOT NULL DEFAULT 0`).join(',\n        ');
}

async function createMonthlyOrderTable(client, tableName){
  await client.query(`CREATE TABLE IF NOT EXISTS ${qident(tableName)} (
    member_id VARCHAR(80) NOT NULL,
    step_no INTEGER NOT NULL,
    ${dayAmountColumns('order')},
    order_total NUMERIC(14,0) NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (member_id, step_no)
  )`);
}
async function createMonthlyReturnTable(client, tableName){
  await client.query(`CREATE TABLE IF NOT EXISTS ${qident(tableName)} (
    member_id VARCHAR(80) NOT NULL,
    step_no INTEGER NOT NULL,
    ${dayAmountColumns('return')},
    return_total NUMERIC(14,0) NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (member_id, step_no)
  )`);
}
async function createMonthlyNetworkTable(client, tableName){
  await client.query(`CREATE TABLE IF NOT EXISTS ${qident(tableName)} (
    member_id VARCHAR(80) NOT NULL,
    self_purchase_amount NUMERIC(14,0) NOT NULL DEFAULT 0,
    step1_member_count INTEGER NOT NULL DEFAULT 0,
    step1_sales_amount NUMERIC(14,0) NOT NULL DEFAULT 0,
    step1_rate NUMERIC(7,4) NOT NULL DEFAULT 0,
    step1_incentive_amount NUMERIC(14,0) NOT NULL DEFAULT 0,
    step2_member_count INTEGER NOT NULL DEFAULT 0,
    step2_sales_amount NUMERIC(14,0) NOT NULL DEFAULT 0,
    step2_rate NUMERIC(7,4) NOT NULL DEFAULT 0,
    step2_incentive_amount NUMERIC(14,0) NOT NULL DEFAULT 0,
    step3_member_count INTEGER NOT NULL DEFAULT 0,
    step3_sales_amount NUMERIC(14,0) NOT NULL DEFAULT 0,
    step3_rate NUMERIC(7,4) NOT NULL DEFAULT 0,
    step3_incentive_amount NUMERIC(14,0) NOT NULL DEFAULT 0,
    step4_member_count INTEGER NOT NULL DEFAULT 0,
    step4_sales_amount NUMERIC(14,0) NOT NULL DEFAULT 0,
    step4_rate NUMERIC(7,4) NOT NULL DEFAULT 0,
    step4_incentive_amount NUMERIC(14,0) NOT NULL DEFAULT 0,
    step5_member_count INTEGER NOT NULL DEFAULT 0,
    step5_sales_amount NUMERIC(14,0) NOT NULL DEFAULT 0,
    step5_rate NUMERIC(7,4) NOT NULL DEFAULT 0,
    step5_incentive_amount NUMERIC(14,0) NOT NULL DEFAULT 0,
    total_member_count INTEGER NOT NULL DEFAULT 0,
    total_sales_amount NUMERIC(14,0) NOT NULL DEFAULT 0,
    gross_incentive_amount NUMERIC(14,0) NOT NULL DEFAULT 0,
    qualification_target_amount NUMERIC(14,0) NOT NULL DEFAULT 0,
    qualification_rate NUMERIC(7,4) NOT NULL DEFAULT 0,
    qualified_incentive_amount NUMERIC(14,0) NOT NULL DEFAULT 0,
    cash_ratio NUMERIC(7,3) NOT NULL DEFAULT 80,
    cash_amount NUMERIC(14,0) NOT NULL DEFAULT 0,
    point_ratio NUMERIC(7,3) NOT NULL DEFAULT 20,
    point_amount NUMERIC(14,0) NOT NULL DEFAULT 0,
    tax_rate NUMERIC(7,3) NOT NULL DEFAULT 0,
    tax_amount NUMERIC(14,0) NOT NULL DEFAULT 0,
    net_cash_amount NUMERIC(14,0) NOT NULL DEFAULT 0,
    unpaid_amount NUMERIC(14,0) NOT NULL DEFAULT 0,
    carry_forward_amount NUMERIC(14,0) NOT NULL DEFAULT 0,
    lifetime_unpaid_amount NUMERIC(14,0) NOT NULL DEFAULT 0,
    hold_reason TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (member_id)
  )`);
}
async function createYearlyOrderTable(client, tableName){
  await client.query(`CREATE TABLE IF NOT EXISTS ${qident(tableName)} (
    member_id VARCHAR(80) NOT NULL,
    step_no INTEGER NOT NULL,
    ${monthAmountColumns('order')},
    order_total NUMERIC(14,0) NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (member_id, step_no)
  )`);
}
async function createYearlyReturnTable(client, tableName){
  await client.query(`CREATE TABLE IF NOT EXISTS ${qident(tableName)} (
    member_id VARCHAR(80) NOT NULL,
    step_no INTEGER NOT NULL,
    ${monthAmountColumns('return')},
    return_total NUMERIC(14,0) NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (member_id, step_no)
  )`);
}
async function createYearlyNetworkTable(client, tableName){
  await client.query(`CREATE TABLE IF NOT EXISTS ${qident(tableName)} (
    member_id VARCHAR(80) NOT NULL,
    ${monthAmountColumns('sales')},
    sales_total NUMERIC(14,0) NOT NULL DEFAULT 0,
    ${monthAmountColumns('incentive')},
    incentive_total NUMERIC(14,0) NOT NULL DEFAULT 0,
    cash_total NUMERIC(14,0) NOT NULL DEFAULT 0,
    point_total NUMERIC(14,0) NOT NULL DEFAULT 0,
    unpaid_total NUMERIC(14,0) NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (member_id)
  )`);
}

async function ensureNetworkTables(poolOrClient, baseDate = new Date()){
  const p = periodNames(baseDate);
  const client = poolOrClient.connect ? await poolOrClient.connect() : poolOrClient;
  const release = !!poolOrClient.connect;
  try{
    await createMonthlyOrderTable(client, monthlyOrderTable(p.currentYm));
    await createMonthlyOrderTable(client, monthlyOrderTable(p.nextYm));
    await createMonthlyReturnTable(client, monthlyReturnTable(p.currentYm));
    await createMonthlyReturnTable(client, monthlyReturnTable(p.nextYm));
    await createMonthlyNetworkTable(client, monthlyNetworkTable(p.currentYm));
    await createMonthlyNetworkTable(client, monthlyNetworkTable(p.nextYm));
    await createYearlyOrderTable(client, yearlyOrderTable(p.currentYear));
    await createYearlyOrderTable(client, yearlyOrderTable(p.nextYear));
    await createYearlyReturnTable(client, yearlyReturnTable(p.currentYear));
    await createYearlyReturnTable(client, yearlyReturnTable(p.nextYear));
    await createYearlyNetworkTable(client, yearlyNetworkTable(p.currentYear));
    await createYearlyNetworkTable(client, yearlyNetworkTable(p.nextYear));
    return {
      ok:true,
      currentYm:p.currentYm,
      nextYm:p.nextYm,
      currentYear:p.currentYear,
      nextYear:p.nextYear,
      created_or_verified:[
        monthlyOrderTable(p.currentYm), monthlyOrderTable(p.nextYm),
        monthlyReturnTable(p.currentYm), monthlyReturnTable(p.nextYm),
        monthlyNetworkTable(p.currentYm), monthlyNetworkTable(p.nextYm),
        yearlyOrderTable(p.currentYear), yearlyOrderTable(p.nextYear),
        yearlyReturnTable(p.currentYear), yearlyReturnTable(p.nextYear),
        yearlyNetworkTable(p.currentYear), yearlyNetworkTable(p.nextYear)
      ]
    };
  } finally { if(release) client.release(); }
}

async function ensureFiveStepRows(client, tableName, memberId){
  for(let step = 1; step <= 5; step++){
    await client.query(`INSERT INTO ${qident(tableName)} (member_id, step_no) VALUES ($1,$2) ON CONFLICT (member_id, step_no) DO NOTHING`, [memberId, step]);
  }
}

async function addMonthlyAmount(client, {tableName, prefix, memberId, stepNo, day, amount}){
  const dd = pad2(day);
  if(!/^\d{2}$/.test(dd) || Number(dd) < 1 || Number(dd) > 31) throw new Error('invalid day: ' + day);
  if(prefix !== 'order' && prefix !== 'return') throw new Error('invalid prefix: ' + prefix);
  await ensureFiveStepRows(client, tableName, memberId);
  await client.query(`UPDATE ${qident(tableName)} SET ${prefix}_${dd} = ${prefix}_${dd} + $1, ${prefix}_total = ${prefix}_total + $1, updated_at=NOW() WHERE member_id=$2 AND step_no=$3`, [n0(amount), memberId, Number(stepNo)]);
}

async function addYearlyAmount(client, {tableName, prefix, memberId, stepNo, month, amount}){
  const mm = pad2(month);
  if(!/^\d{2}$/.test(mm) || Number(mm) < 1 || Number(mm) > 12) throw new Error('invalid month: ' + month);
  if(prefix !== 'order' && prefix !== 'return') throw new Error('invalid prefix: ' + prefix);
  await ensureFiveStepRows(client, tableName, memberId);
  await client.query(`UPDATE ${qident(tableName)} SET ${prefix}_${mm} = ${prefix}_${mm} + $1, ${prefix}_total = ${prefix}_total + $1, updated_at=NOW() WHERE member_id=$2 AND step_no=$3`, [n0(amount), memberId, Number(stepNo)]);
}

async function loadParentMap(client){
  const r = await client.query(`SELECT member_id,recommender_id FROM gm_member WHERE COALESCE(member_id,'') <> ''`);
  const parent = new Map();
  for(const row of r.rows){
    const memberId = s(row.member_id);
    if(memberId) parent.set(memberId, s(row.recommender_id));
  }
  return parent;
}

function upstream(parentMap, buyerId, maxStep = 5){
  const out = [];
  let current = s(buyerId);
  const seen = new Set([current]);
  for(let step = 1; step <= maxStep; step++){
    const parent = s(parentMap.get(current));
    if(!parent || seen.has(parent)) break;
    out.push({member_id:parent, step_no:step});
    seen.add(parent);
    current = parent;
  }
  return out;
}

module.exports = {
  periodNames,
  ensureNetworkTables,
  monthlyOrderTable,
  monthlyReturnTable,
  monthlyNetworkTable,
  yearlyOrderTable,
  yearlyReturnTable,
  yearlyNetworkTable,
  addMonthlyAmount,
  addYearlyAmount,
  loadParentMap,
  upstream
};
