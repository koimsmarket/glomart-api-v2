const express = require('express');
const router = express.Router();

const HEALTH_VERSION = 'GM_HEALTH_V002_ROUTE';

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
 * GM_HEALTH_V002_ROUTE
 * - UptimeRobot / Cloudtype sleep 방지용
 * - 기본은 DB 조회 없이 200 OK
 */
router.get(['/health', '/api/health', '/api/gm/health'], async (req, res) => {
  const wantsDb = String(req.query.db || '') === '1';

  if(!wantsDb){
    return res.status(200).json(payload(req, { db_checked: false }));
  }

  const pool = db(req);
  if(!pool){
    return res.status(200).json(payload(req, {
      db_checked: true,
      db: false,
      db_error: 'DB pool is not attached'
    }));
  }

  try{
    const r = await pool.query('SELECT NOW() AS now');
    return res.status(200).json(payload(req, {
      db_checked: true,
      db: true,
      db_now: r.rows[0].now
    }));
  }catch(e){
    return res.status(200).json(payload(req, {
      db_checked: true,
      db: false,
      db_error: String(e && e.message || e)
    }));
  }
});

module.exports = router;
