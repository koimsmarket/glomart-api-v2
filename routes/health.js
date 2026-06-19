const express = require('express');
const router = express.Router();

const HEALTH_VERSION = 'GM_HEALTH_V001';

function payload(extra){
  return Object.assign({
    ok: true,
    service: 'glomart-api-v2',
    health_version: HEALTH_VERSION,
    time: new Date().toISOString()
  }, extra || {});
}

function db(req){
  return req.app.locals.db || req.app.locals.pool;
}

/*
 * GM_HEALTH_V001
 * - UptimeRobot / Cloudtype sleep 방지용 lightweight endpoint
 * - DB 조회 없음: 서버 컨테이너가 떠 있는지만 200으로 확인
 */
router.get('/health', (req, res) => {
  res.status(200).json(payload({ route: '/health' }));
});

/*
 * 호환용 API health
 * - 기존 /api/health 는 DB 진단 역할이었지만, 모니터링용으로 200을 보장해야 함
 * - DB 상태가 필요하면 ?db=1 로 조회
 */
router.get(['/api/health', '/api/gm/health'], async (req, res) => {
  const wantsDb = String(req.query.db || '') === '1';
  if(!wantsDb){
    return res.status(200).json(payload({ route: req.path, db_checked: false }));
  }

  const pool = db(req);
  if(!pool){
    return res.status(200).json(payload({ route: req.path, db_checked: true, db: false, db_error: 'DB pool is not attached' }));
  }

  try{
    const r = await pool.query('SELECT NOW() AS now');
    return res.status(200).json(payload({ route: req.path, db_checked: true, db: true, db_now: r.rows[0].now }));
  }catch(e){
    return res.status(200).json(payload({ route: req.path, db_checked: true, db: false, db_error: String(e && e.message || e) }));
  }
});

module.exports = router;
