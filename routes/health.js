const express = require('express');
const router = express.Router();

const HEALTH_VERSION = 'GM_HEALTH_V004_ROUTE_DB_RUNTIME';

function fmtMb(bytes){
  const n = Number(bytes || 0) / 1024 / 1024;
  return Math.round(n * 10) / 10 + 'MB';
}

function routeCount(req){
  try{
    const app = req.app;
    const stack = (app && app._router && Array.isArray(app._router.stack)) ? app._router.stack : [];
    let count = 0;
    for(const layer of stack){
      if(layer && layer.route && layer.route.path) count += 1;
    }
    return count;
  }catch(e){ return null; }
}

function poolOf(req){
  return req.app.locals.pool || req.app.locals.db;
}

async function buildPayload(req){
  const started = Date.now();
  const mem = process.memoryUsage();
  const body = {
    ok: true,
    service: 'glomart-api-v2',
    health_version: HEALTH_VERSION,
    route: req.path,
    method: req.method,
    node: process.version,
    uptime_sec: Math.round(process.uptime()),
    memory: {
      rss: fmtMb(mem.rss),
      heapUsed: fmtMb(mem.heapUsed),
      heapTotal: fmtMb(mem.heapTotal),
      external: fmtMb(mem.external)
    },
    routes: routeCount(req),
    db: { ok: false, latency_ms: null },
    time: new Date().toISOString()
  };

  const pool = poolOf(req);
  if(!pool){
    body.ok = false;
    body.db = { ok: false, latency_ms: null, error: 'DB pool is not attached' };
    body.latency_ms = Date.now() - started;
    return body;
  }

  try{
    const dbStarted = Date.now();
    const r = await pool.query('SELECT 1 AS ok, NOW() AS now');
    body.db = {
      ok: true,
      latency_ms: Date.now() - dbStarted,
      now: r && r.rows && r.rows[0] ? r.rows[0].now : null
    };
  }catch(e){
    body.ok = false;
    body.db = { ok: false, latency_ms: null, error: String(e && e.message || e) };
  }

  body.latency_ms = Date.now() - started;
  return body;
}

/* GM_HEALTH_V004_ROUTE_DB_RUNTIME
 * 운영용 health route.
 * server.js direct route가 먼저 등록되어 일반적으로는 direct route가 응답한다.
 * module route로 들어오는 경우에도 동일하게 DB/메모리/uptime을 반환한다.
 */
router.all(['/health', '/api/health', '/api/gm/health'], async (req, res) => {
  console.log('[GM_HEALTH_ROUTE_HIT_V004]', JSON.stringify({ method: req.method, url: req.originalUrl || req.url, ua: req.headers['user-agent'] || '', time: new Date().toISOString() }));
  if (req.method === 'HEAD') return res.status(200).end();
  if (req.method === 'OPTIONS') return res.status(204).end();

  const body = await buildPayload(req);
  return res.status(body.ok ? 200 : 503).json(body);
});

module.exports = router;
