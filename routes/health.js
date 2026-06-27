const express = require('express');
const router = express.Router();

const HEALTH_VERSION = 'GM_HEALTH_V003_ROUTE_ALL_METHODS';

function payload(req, extra){
  return Object.assign({
    ok: true,
    service: 'glomart-api-v2',
    health_version: HEALTH_VERSION,
    route: req.path,
    time: new Date().toISOString()
  }, extra || {});
}

function db(req){
  return req.app.locals.db || req.app.locals.pool;
}

/*
 * GM_HEALTH_V003_ROUTE_ALL_METHODS
 * - UptimeRobot / Cloudtype sleep 방지용
 * - 기본은 DB 조회 없이 200 OK
 * - HEAD/GET/OPTIONS 등 모든 method를 200으로 허용
 */
router.all(['/health', '/api/health', '/api/gm/health'], async (req, res) => {
  if (req.method === 'HEAD') return res.status(200).end();
  if (req.method === 'OPTIONS') return res.status(200).end();

  const wantsDb = String(req.query.db || '') === '1';

  if(!wantsDb){
    return res.status(200).json(payload(req, { db_checked: false, method: req.method }));
  }

  const pool = db(req);
  if(!pool){
    return res.status(200).json(payload(req, {
      db_checked: true,
      db: false,
      db_error: 'DB pool is not attached',
      method: req.method
    }));
  }

  try{
    const r = await pool.query('SELECT NOW() AS now');
    return res.status(200).json(payload(req, {
      db_checked: true,
      db: true,
      db_now: r.rows[0].now,
      method: req.method
    }));
  }catch(e){
    return res.status(200).json(payload(req, {
      db_checked: true,
      db: false,
      db_error: String(e && e.message || e),
      method: req.method
    }));
  }
});

module.exports = router;
