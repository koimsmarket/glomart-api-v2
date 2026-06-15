'use strict';

const { Pool } = require('pg');
const {
  ensureNetworkTables,
  periodNames
} = require('../services/GM_NETWORK_INCENTIVE_ENGINE');

function makePool(){
  const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.PG_URL || '';
  if(connectionString){
    return new Pool({ connectionString, ssl: process.env.PGSSL === '1' ? { rejectUnauthorized:false } : false });
  }
  return new Pool({
    host: process.env.PGHOST || process.env.POSTGRES_HOST || 'postgresql',
    port: Number(process.env.PGPORT || process.env.POSTGRES_PORT || 5432),
    user: process.env.PGUSER || process.env.POSTGRES_USER || 'root',
    password: process.env.PGPASSWORD || process.env.POSTGRES_PASSWORD || process.env.POSTGRESQL_PASSWORD || '',
    database: process.env.PGDATABASE || process.env.POSTGRES_DB || 'postgres'
  });
}

async function runDailyNetworkJob(pool, baseDate = new Date()){
  const p = periodNames(baseDate);
  const ensured = await ensureNetworkTables(pool, baseDate);
  // This first version intentionally performs table readiness only.
  // Actual order/return accumulation and confirmed monthly settlement are kept separate
  // until the final gm_order/gm_order_item status rules are confirmed.
  return {
    ok:true,
    job:'GM_NETWORK_INCENTIVE_DAILY_JOB',
    mode:'ensure_tables_only',
    period:p,
    ensured
  };
}

if(require.main === module){
  const pool = makePool();
  runDailyNetworkJob(pool).then(r => {
    console.log(JSON.stringify(r, null, 2));
    return pool.end();
  }).catch(async e => {
    console.error('[GM_NETWORK_INCENTIVE_DAILY_JOB_ERROR]', e && e.stack || e);
    try{ await pool.end(); }catch(_e){}
    process.exit(1);
  });
}

module.exports = { runDailyNetworkJob };
