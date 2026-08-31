const { VERSION } = require('./config');
function dbFrom(req) {
  return req.app.locals.db || req.app.locals.pool;
}
function ok(res, data) {
  res.json({ ok:true, version:VERSION, ...data });
}
function fail(res, status, error, extra={}) {
  res.status(status).json({ ok:false, version:VERSION, error, ...extra });
}
function qIdent(s) {
  return '"' + String(s).replace(/"/g, '""') + '"';
}

module.exports = { dbFrom, ok, fail, qIdent };
