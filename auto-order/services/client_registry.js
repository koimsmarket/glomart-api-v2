'use strict';

const ONLINE_SECONDS = Math.max(30, Number(process.env.GM_AUTO_ORDER_CLIENT_ONLINE_SECONDS || 90));

function clean(v){ return String(v == null ? '' : v).trim(); }

async function register(pool, data){
  data = data || {};
  const clientId = clean(data.client_id || data.clientId);
  if(!clientId) throw new Error('client_id is required');

  const clientType = clean(data.client_type || data.clientType || 'PWA').toUpperCase();
  const adminId = clean(data.admin_id || data.adminId);
  const appVersion = clean(data.app_version || data.appVersion);
  const userAgent = clean(data.user_agent || data.userAgent);
  const cpkrReady = !!(data.cpkr_ready ?? data.cpkrReady);
  const alkrReady = !!(data.alkr_ready ?? data.alkrReady);

  const r = await pool.query(`
    INSERT INTO gm_auto_order_client (
      client_id, admin_id, client_type, enabled,
      cpkr_ready, alkr_ready, last_seen_at,
      app_version, user_agent, created_at, updated_at
    ) VALUES ($1,$2,$3,TRUE,$4,$5,now(),$6,$7,now(),now())
    ON CONFLICT (client_id) DO UPDATE SET
      admin_id=EXCLUDED.admin_id,
      client_type=EXCLUDED.client_type,
      cpkr_ready=EXCLUDED.cpkr_ready,
      alkr_ready=EXCLUDED.alkr_ready,
      last_seen_at=now(),
      app_version=EXCLUDED.app_version,
      user_agent=EXCLUDED.user_agent,
      updated_at=now()
    RETURNING *
  `, [clientId, adminId, clientType, cpkrReady, alkrReady, appVersion, userAgent]);

  return r.rows[0];
}

async function heartbeat(pool, data){
  data = data || {};
  const clientId = clean(data.client_id || data.clientId);
  if(!clientId) throw new Error('client_id is required');

  const cpkrReady = data.cpkr_ready ?? data.cpkrReady;
  const alkrReady = data.alkr_ready ?? data.alkrReady;
  const appVersion = clean(data.app_version || data.appVersion);

  const r = await pool.query(`
    UPDATE gm_auto_order_client SET
      last_seen_at=now(),
      cpkr_ready=CASE WHEN $2::boolean IS NULL THEN cpkr_ready ELSE $2::boolean END,
      alkr_ready=CASE WHEN $3::boolean IS NULL THEN alkr_ready ELSE $3::boolean END,
      app_version=CASE WHEN $4='' THEN app_version ELSE $4 END,
      updated_at=now()
    WHERE client_id=$1
    RETURNING *
  `, [
    clientId,
    cpkrReady === undefined ? null : Boolean(cpkrReady),
    alkrReady === undefined ? null : Boolean(alkrReady),
    appVersion
  ]);
  if(!r.rows.length) throw new Error('client_not_registered');
  return r.rows[0];
}

async function list(pool){
  const r = await pool.query(`
    SELECT *,
      (enabled=TRUE AND last_seen_at >= now() - ($1::int * interval '1 second')) AS online
    FROM gm_auto_order_client
    ORDER BY online DESC, last_seen_at DESC NULLS LAST, client_id ASC
  `, [ONLINE_SECONDS]);
  return r.rows;
}

async function get(pool, clientId){
  const r = await pool.query(`
    SELECT *,
      (enabled=TRUE AND last_seen_at >= now() - ($2::int * interval '1 second')) AS online
    FROM gm_auto_order_client
    WHERE client_id=$1
    LIMIT 1
  `, [clean(clientId), ONLINE_SECONDS]);
  return r.rows[0] || null;
}

module.exports = { ONLINE_SECONDS, register, heartbeat, list, get };
