const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const VERSION = 'GLOMART_API_MEMBER_ROUTE_V024';
const app = express();

app.use(cors({ origin: true, credentials: false }));
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));
app.use(express.static('public'));
app.use('/public', express.static(path.join(__dirname, 'public')));

/* GM_HEALTH_V002_DIRECT
 * Cloudtype / UptimeRobot keep-alive endpoint.
 * Must be registered directly in the entry file before route modules.
 * No DB query: always returns 200 if the Node process is alive.
 */
app.get(['/health', '/api/health', '/api/gm/health'], (req, res) => {
  res.status(200).json({
    ok: true,
    service: 'glomart-api-v2',
    health_version: 'GM_HEALTH_V002_DIRECT',
    version: VERSION,
    route: req.path,
    time: new Date().toISOString()
  });
});


const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || '/tmp/glomart-data';
const CACHE_FILE = path.join(DATA_DIR, 'coupang_cache.json');
const ORDER_FILE = path.join(DATA_DIR, 'orders.json');
fs.mkdirSync(DATA_DIR, { recursive: true });

function nowIso(){ return new Date().toISOString(); }
function cleanText(v){ return String(v || '').replace(/[\u00A0\u200B-\u200D\uFEFF]/g, ' ').replace(/\s+/g, ' ').trim(); }
function readJson(file, fallback){ try{ if(!fs.existsSync(file)) return fallback; return JSON.parse(fs.readFileSync(file,'utf8')); }catch(e){ return fallback; } }
function writeJson(file, data){ fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8'); }
function ok(res, data){ res.json({ ok:true, version:VERSION, ...data }); }
function fail(res, status, message, extra={}){ res.status(status).json({ ok:false, version:VERSION, error:message, ...extra }); }
function toInt(v, def=0){ const n = Number(v); return Number.isFinite(n) ? Math.round(n) : def; }
function normalizeUrl(url){ url = cleanText(url); if(url.startsWith('//')) return 'https:' + url; return url; }
function idsFromUrl(url){
  const s = String(url || '');
  const out = { productId:'', itemId:'', vendorItemId:'' };
  let m = s.match(/\/vp\/products\/(\d+)/); if(m) out.productId = m[1];
  m = s.match(/[?&]itemId=(\d+)/); if(m) out.itemId = m[1];
  m = s.match(/[?&]vendorItemId=(\d+)/); if(m) out.vendorItemId = m[1];
  return out;
}
function makeKey(item){
  return cleanText(item.vendorItemId) ||
    [cleanText(item.productId), cleanText(item.itemId)].filter(Boolean).join('_') ||
    cleanText(item.url) ||
    cleanText(item.title);
}

function normalizeItem(raw){
  raw = raw || {};
  const url = normalizeUrl(raw.url || raw.href || raw.productUrl || '');
  const ids = idsFromUrl(url);
  const item = {
    key:'',
    source: cleanText(raw.source || 'coupang'),
    collectedAt: nowIso(),
    pageUrl: normalizeUrl(raw.pageUrl || ''),
    title: cleanText(raw.title || raw.name || raw.productName),
    image: normalizeUrl(raw.image || raw.imageUrl || raw.thumbnail || ''),
    priceText: cleanText(raw.priceText || raw.price || ''),
    deliveryText: cleanText(raw.deliveryText || raw.delivery || ''),
    url,
    productId: cleanText(raw.productId || ids.productId),
    itemId: cleanText(raw.itemId || ids.itemId),
    vendorItemId: cleanText(raw.vendorItemId || raw.venderItemId || ids.vendorItemId),
    optionText: cleanText(raw.optionText || raw.option || ''),
    stockText: cleanText(raw.stockText || raw.stock || ''),
    raw: raw.raw || null
  };
  item.key = makeKey(item);
  return item;
}

function savePayload(payload){
  const body = payload || {};
  const arr = Array.isArray(body.items) ? body.items : [body.item || body];
  const cache = readJson(CACHE_FILE, { items:{}, updatedAt:null });
  cache.items = cache.items || {};
  const saved = [], skipped = [];

  for(const raw0 of arr){
    const raw = { ...(raw0 || {}), pageUrl: body.pageUrl || raw0.pageUrl || '' };
    const item = normalizeItem(raw);
    if(!item.key){ skipped.push({ reason:'missing key', raw }); continue; }
    cache.items[item.key] = { ...(cache.items[item.key] || {}), ...item, collectedAt:nowIso() };
    saved.push(cache.items[item.key]);
  }

  cache.updatedAt = nowIso();
  writeJson(CACHE_FILE, cache);
  return { saved, skipped };
}

function searchCache(keyword, page=1, pageSize=40){
  keyword = cleanText(keyword).toLowerCase();
  const cache = readJson(CACHE_FILE, { items:{}, updatedAt:null });
  let list = Object.values(cache.items || {});
  if(keyword){
    list = list.filter(it => [
      it.title,it.optionText,it.priceText,it.deliveryText,it.productId,it.itemId,it.vendorItemId,it.url
    ].join(' ').toLowerCase().includes(keyword));
  }
  list.sort((a,b) => String(b.collectedAt || '').localeCompare(String(a.collectedAt || '')));
  const total = list.length;
  const start = (page - 1) * pageSize;
  const items = list.slice(start, start + pageSize).map((it, idx) => ({ ...it, rank:start + idx + 1 }));
  return { total, page, pageSize, nextPage:start + pageSize < total ? page + 1 : null, prevPage:page > 1 ? page - 1 : null, items };
}

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

const pool = makePool();
let dbReady = false;
let dbError = '';

async function initGmDb({ reset=false } = {}){
  // V006: migrations/*.sql 순차 적용. 기존 DB에는 10번 이후 ALTER가 적용되고,
  // 신규 DB에는 00~10 전체가 순서대로 적용된다.
  if (reset) {
    throw new Error('DB reset is disabled. Use migrations manually if reset is required.');
  }

  const dir = path.join(__dirname, 'migrations');
  if (!fs.existsSync(dir)) {
    throw new Error('migration directory not found: ' + dir);
  }

  const files = fs.readdirSync(dir)
    .filter(name => /^\d+_.*\.sql$/i.test(name))
    .sort((a,b) => a.localeCompare(b, undefined, { numeric:true }));

  if (!files.length) throw new Error('no migration files found');

  const applied = [];
  for (const name of files) {
    const file = path.join(dir, name);
    const sql = fs.readFileSync(file, 'utf8');
    if (sql.trim()) {
      await pool.query(sql);
      applied.push('migrations/' + name);
    }
  }
  dbReady = true;
  dbError = '';
  return { files:applied };
}

if(process.env.GM_DB_AUTOINIT !== '0'){
  initGmDb({ reset:false }).then(() => {
    console.log('[GM DB READY] migrations/*.sql applied');
  }).catch(err => {
    dbReady = false;
    dbError = String(err && err.message || err);
    console.error('[GM DB INIT SKIPPED]', dbError);
  });
}

async function dbQuery(sql, vals=[]){
  return pool.query(sql, vals);
}

// V024: register member routes immediately after DB query helper so /api/gm/member/me is active before any later routes.
app.locals.pool = pool;
try {
  app.use(require('./routes/member'));
  console.log('[GM_MEMBER_ROUTE_V024] routes/member registered early');
} catch (e) {
  console.error('[GM_MEMBER_ROUTE_V024] routes/member register failed:', String(e && e.message || e));
}

async function tableCounts(tableNames){
  const targets = Array.from(new Set((tableNames || []).map(String)));
  if(!targets.length) return {};
  const existing = await dbQuery(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema='public' AND table_name = ANY($1::text[])
    ORDER BY table_name
  `, [targets]);
  const out = {};
  for(const row of existing.rows){
    const table = row.table_name;
    const quoted = '"' + String(table).replace(/"/g, '""') + '"';
    const c = await dbQuery('SELECT COUNT(*)::int AS count FROM ' + quoted);
    out[table] = c.rows[0].count;
  }
  for(const table of targets){
    if(!Object.prototype.hasOwnProperty.call(out, table)) out[table] = null;
  }
  return out;
}

const GM_RESET_TARGETS = [
  'gm_product_upsert_queue',
  'gm_dashboard_snapshot',
  'gm_search_log',
  'gm_search_keyword_stat',
  'gm_category_search_stat',
  'gm_category_search_monthly',
  'gm_category_search_yearly',
  'gm_product_sales_monthly',
  'gm_product_sales_yearly',
  'gm_product_country_sales_monthly',
  'gm_product_country_sales_yearly',
  'gm_category_sales_monthly',
  'gm_category_sales_yearly',
  'gm_category_country_sales_monthly',
  'gm_category_country_sales_yearly',
  'gm_sales_aggregate_event',
  'gm_category_keyword',
  'gm_category',
  'gm_product_archive',
  'gm_basket',
  'gm_order',
  'gm_order_item',
  'gm_supplier',
  'gm_cs',
  'gm_cs_message',
  'gm_product',
  // legacy plural tables are included only for one-time cleanup after table-name unification
  'gm_products',
  'gm_orders',
  'gm_order_items',
  'gm_suppliers',
  'gm_cs_messages'
];


function owner(b){
  const memberId = cleanText(b.member_id);
  const guestKey = cleanText(b.guest_key);
  if(memberId) return { col:'member_id', val:memberId };
  if(guestKey) return { col:'guest_key', val:guestKey };
  throw new Error('member_id or guest_key required');
}

app.locals.pool = pool;

// gm_* route modules are registered before legacy inline endpoints.
// This prevents old inline handlers from intercepting /api/gm/* paths.
app.use(require('./routes/health'));
app.use(require('./routes/product'));
app.use(require('./routes/basket'));
app.use(require('./routes/interest'));
app.use(require('./routes/account'));
app.use(require('./routes/order'));
app.use(require('./routes/cs'));
app.use(require('./routes/dashboard'));
app.use(require('./routes/builder'));

try{
  require('./workers/product_queue_worker').startProductQueueWorker(pool);
}catch(e){
  console.error('[GM_PRODUCT_QUEUE_WORKER] start skipped:', String(e && e.message || e));
}

app.get('/', (req,res)=>ok(res, {
  service:'glomart-api',
  mode:'json-cache-plus-postgresql',
  dbReady,
  dbError,
  routes:[
    'GET /health',
    'GET /api/gm/health',
    'POST /api/gm/db/init',
    'POST /api/gm/db/reset',
    'GET /api/gm/db/table-counts',
    'GET /api/gm/dashboard/realtime',
    'POST /api/gm/dashboard/snapshot',
    'POST /api/gm/search/log',
    'POST /api/gm/product/archive',
    'GET /api/gm/search/summary',
    'GET /api/gm/search/monthly',
    'GET /api/gm/sales/summary',
    'POST /api/gm/product/upsert',
    'POST /api/gm/product/queue',
    'GET /api/gm/product/queue/status',
    'POST /api/gm/product/event',
    'GET /api/gm/db/columns?table=gm_product',
    'POST /api/gm/basket/add',
    'GET /api/gm/basket/list',
    'POST /api/gm/interest/visit',
    'POST /api/gm/interest/wish',
    'GET /api/gm/interest/recent',
    'DELETE /api/gm/basket/item',
    'POST /api/gm/order/create',
    'POST /api/gm/member/upsert',
    'GET /api/gm/member/me',
    'GET /api/gm/member/address/list',
    'POST /api/gm/member/address/upsert',
    'GET /api/gm/account/summary',
    'GET /api/gm/account/ledger',
    'GET /module/scrap/api/cache/search?q=keyword&page=1'
  ]
}));

app.get('/health', (req,res)=>ok(res,{status:'running', dbReady, dbError}));

app.get('/api/gm/health', async (req,res)=>{
  try{
    const r = await dbQuery('select now() as now');
    ok(res, { status:'running', db:true, db_time:r.rows[0].now });
  }catch(e){
    fail(res, 500, 'db connection failed', { detail:String(e && e.message || e) });
  }
});

app.post('/api/gm/db/init', async (req,res)=>{
  try{ const r = await initGmDb({ reset:false }); ok(res, { action:'db.init', ...r }); }
  catch(e){ fail(res, 500, 'db init failed', { detail:String(e && e.message || e) }); }
});

app.post('/api/gm/db/reset', async (req,res)=>{
  try{
    const before = await tableCounts(GM_RESET_TARGETS);
    const existing = await dbQuery(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema='public' AND table_name = ANY($1::text[])
      ORDER BY table_name
    `, [GM_RESET_TARGETS]);
    const tables = existing.rows.map(r => r.table_name);
    if(!tables.length){
      return ok(res, { action:'db.reset', truncated:[], before, after:{}, detail:'no target gm_* tables found' });
    }
    const quoted = tables.map(t => '"' + String(t).replace(/"/g, '""') + '"').join(', ');
    await dbQuery('TRUNCATE TABLE ' + quoted + ' RESTART IDENTITY CASCADE');
    const after = await tableCounts(GM_RESET_TARGETS);
    ok(res, { action:'db.reset', truncated:tables, before, after });
  }catch(e){
    fail(res, 500, 'db reset failed', { detail:String(e && e.message || e) });
  }
});

app.get('/api/gm/db/table-counts', async (req,res)=>{
  try{
    const q = String(req.query.tables || '').trim();
    const targets = q ? q.split(',').map(x=>x.trim()).filter(Boolean) : GM_RESET_TARGETS;
    const counts = await tableCounts(targets);
    ok(res, { action:'db.table-counts', counts });
  }catch(e){
    fail(res, 500, 'db table-counts failed', { detail:String(e && e.message || e) });
  }
});


const GM_DASHBOARD_SNAPSHOT_MINUTES = Math.max(1, Number(process.env.GM_DASHBOARD_SNAPSHOT_MINUTES || 30));
const GM_DASHBOARD_TABLES = [
  'gm_product',
  'gm_product_archive',
  'gm_category',
  'gm_category_keyword',
  'gm_search_keyword_stat',
  'gm_category_search_stat',
  'gm_category_search_monthly',
  'gm_category_search_yearly',
  'gm_product_sales_monthly',
  'gm_product_sales_yearly',
  'gm_product_country_sales_monthly',
  'gm_product_country_sales_yearly',
  'gm_category_sales_monthly',
  'gm_category_sales_yearly',
  'gm_category_country_sales_monthly',
  'gm_category_country_sales_yearly',
  'gm_sales_aggregate_event',
  'gm_basket',
  'gm_order',
  'gm_order_item',
  'gm_supplier',
  'gm_cs',
  'gm_cs_message',
  'gm_product_upsert_queue',
  'gm_search_log',
  'gm_dashboard_snapshot'
];

function nz(v){ const n = Number(v); return Number.isFinite(n) ? n : 0; }
async function tableExists(table){
  const r = await dbQuery(`
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema='public' AND table_name=$1
    LIMIT 1
  `, [table]);
  return r.rows.length > 0;
}
async function getQueueStatusCounts(){
  const out = { pending:0, processing:0, done:0, failed:0, total:0, last_created_at:null, last_processed_at:null };
  if(!(await tableExists('gm_product_upsert_queue'))) return out;
  const r = await dbQuery(`
    SELECT lower(COALESCE(status,'')) AS status, COUNT(*)::int AS count
    FROM gm_product_upsert_queue
    GROUP BY lower(COALESCE(status,''))
  `);
  for(const row of r.rows){
    const st = row.status || 'unknown';
    out[st] = nz(row.count);
    out.total += nz(row.count);
  }
  const t = await dbQuery(`
    SELECT MAX(created_at) AS last_created_at, MAX(processed_at) AS last_processed_at
    FROM gm_product_upsert_queue
  `);
  if(t.rows[0]){
    out.last_created_at = t.rows[0].last_created_at || null;
    out.last_processed_at = t.rows[0].last_processed_at || null;
  }
  return out;
}
async function getDbSizeInfo(){
  const limitMb = Math.max(1, Number(process.env.GM_DB_SIZE_LIMIT_MB || 1024));
  try{
    const r = await dbQuery(`SELECT pg_database_size(current_database())::bigint AS bytes`);
    const bytes = Number(r.rows[0] && r.rows[0].bytes || 0);
    const mb = Math.round((bytes / 1024 / 1024) * 100) / 100;
    const percent = Math.round((mb / limitMb) * 10000) / 100;
    let level = 'normal';
    if(percent >= 85) level = 'danger';
    else if(percent >= 70) level = 'warning';
    else if(percent >= 50) level = 'prepare';
    return { bytes, mb, limit_mb:limitMb, percent, level };
  }catch(e){
    return { bytes:null, mb:null, limit_mb:limitMb, percent:null, level:'unknown', error:String(e && e.message || e) };
  }
}
async function getPreviousDashboardSnapshot(){
  if(!(await tableExists('gm_dashboard_snapshot'))) return null;
  const r = await dbQuery(`
    SELECT *
    FROM gm_dashboard_snapshot
    ORDER BY snapshot_at DESC, snapshot_id DESC
    LIMIT 1
  `);
  return r.rows[0] || null;
}
async function getRecentDashboardSnapshot(minutes){
  if(!(await tableExists('gm_dashboard_snapshot'))) return null;
  const m = Math.max(1, Number(minutes || GM_DASHBOARD_SNAPSHOT_MINUTES || 30));
  const r = await dbQuery(`
    SELECT *
    FROM gm_dashboard_snapshot
    WHERE snapshot_at >= now() - ($1::int * interval '1 minute')
    ORDER BY snapshot_at DESC, snapshot_id DESC
    LIMIT 1
  `, [m]);
  return r.rows[0] || null;
}
function diffCounts(current, previous){
  const out = {};
  if(!previous) return out;
  const map = {
    gm_product:'gm_product_count', gm_product_archive:'gm_product_archive_count', gm_category:'gm_category_count', gm_category_keyword:'gm_category_keyword_count', gm_search_keyword_stat:'gm_search_keyword_stat_count', gm_category_search_stat:'gm_category_search_stat_count', gm_category_search_monthly:'gm_category_search_monthly_count', gm_category_search_yearly:'gm_category_search_yearly_count', gm_product_sales_monthly:'gm_product_sales_monthly_count', gm_product_sales_yearly:'gm_product_sales_yearly_count', gm_product_country_sales_monthly:'gm_product_country_sales_monthly_count', gm_product_country_sales_yearly:'gm_product_country_sales_yearly_count', gm_category_sales_monthly:'gm_category_sales_monthly_count', gm_category_sales_yearly:'gm_category_sales_yearly_count', gm_category_country_sales_monthly:'gm_category_country_sales_monthly_count', gm_category_country_sales_yearly:'gm_category_country_sales_yearly_count', gm_basket:'gm_basket_count', gm_order:'gm_order_count',
    gm_order_item:'gm_order_item_count', gm_supplier:'gm_supplier_count', gm_cs:'gm_cs_count',
    gm_cs_message:'gm_cs_message_count', gm_search_log:'gm_search_log_count'
  };
  for(const [table,col] of Object.entries(map)){
    if(current.counts && current.counts[table] != null && previous[col] != null){
      out[table] = nz(current.counts[table]) - nz(previous[col]);
    }
  }
  return out;
}
async function buildDashboardRealtime(startedAt){
  const counts = await tableCounts(GM_DASHBOARD_TABLES);
  const queue = await getQueueStatusCounts();
  const dbSize = await getDbSizeInfo();
  const previous = await getPreviousDashboardSnapshot();
  const apiMs = Date.now() - startedAt;
  const current = {
    snapshot_at: nowIso(),
    counts,
    queue,
    db_size: dbSize,
    api_response_ms: apiMs,
    server_time: nowIso(),
    warning: {
      db: dbSize.level,
      queue: queue.pending >= 5000 ? 'danger' : (queue.pending >= 1000 ? 'warning' : 'normal'),
      worker: queue.pending > 0 && !queue.last_processed_at ? 'warning' : 'normal'
    }
  };
  current.diff_from_previous = diffCounts(current, previous);
  return { current, previous };
}
async function saveDashboardSnapshot(current){
  if(!(await tableExists('gm_dashboard_snapshot'))) return { saved:false, skipped:true, reason:'table_missing' };
  const c = current.counts || {}, q = current.queue || {}, d = current.db_size || {};
  await dbQuery(`
    INSERT INTO gm_dashboard_snapshot (
      snapshot_at,
      gm_product_count, gm_product_archive_count, gm_category_count, gm_category_keyword_count,
      gm_search_keyword_stat_count, gm_category_search_stat_count, gm_category_search_monthly_count, gm_category_search_yearly_count,
      gm_product_sales_monthly_count, gm_product_sales_yearly_count, gm_product_country_sales_monthly_count, gm_product_country_sales_yearly_count,
      gm_category_sales_monthly_count, gm_category_sales_yearly_count, gm_category_country_sales_monthly_count, gm_category_country_sales_yearly_count,
      gm_basket_count, gm_order_count, gm_order_item_count,
      gm_supplier_count, gm_cs_count, gm_cs_message_count, gm_search_log_count,
      queue_pending_count, queue_processing_count, queue_done_count, queue_failed_count, queue_total_count,
      db_size_bytes, db_size_mb, db_size_percent, db_size_limit_mb, api_response_ms,
      created_at
    ) VALUES (
      now(), $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33, now()
    )
  `, [
    nz(c.gm_product), nz(c.gm_product_archive), nz(c.gm_category), nz(c.gm_category_keyword),
    nz(c.gm_search_keyword_stat), nz(c.gm_category_search_stat), nz(c.gm_category_search_monthly), nz(c.gm_category_search_yearly),
    nz(c.gm_product_sales_monthly), nz(c.gm_product_sales_yearly), nz(c.gm_product_country_sales_monthly), nz(c.gm_product_country_sales_yearly),
    nz(c.gm_category_sales_monthly), nz(c.gm_category_sales_yearly), nz(c.gm_category_country_sales_monthly), nz(c.gm_category_country_sales_yearly),
    nz(c.gm_basket), nz(c.gm_order), nz(c.gm_order_item),
    nz(c.gm_supplier), nz(c.gm_cs), nz(c.gm_cs_message), nz(c.gm_search_log),
    nz(q.pending), nz(q.processing), nz(q.done), nz(q.failed), nz(q.total),
    d.bytes == null ? null : d.bytes, d.mb == null ? null : d.mb, d.percent == null ? null : d.percent,
    d.limit_mb == null ? null : d.limit_mb, nz(current.api_response_ms)
  ]);
  return { saved:true, skipped:false, reason:'inserted' };
}
async function saveDashboardSnapshotIfDue(current, opts){
  opts = opts || {};
  const force = !!opts.force;
  const minutes = Math.max(1, Number(opts.minutes || GM_DASHBOARD_SNAPSHOT_MINUTES || 30));
  if(!force){
    const recent = await getRecentDashboardSnapshot(minutes);
    if(recent){
      return { saved:false, skipped:true, reason:'recent_exists', interval_minutes:minutes, recent_snapshot_at:recent.snapshot_at };
    }
  }
  const r = await saveDashboardSnapshot(current);
  r.interval_minutes = minutes;
  return r;
}


app.get('/api/gm/dashboard/realtime', async (req,res)=>{
  const startedAt = Date.now();
  try{
    const data = await buildDashboardRealtime(startedAt);
    let snapshot = { saved:false, skipped:true, reason:'realtime_no_save' };
    if(String(req.query.save || '0') === '1'){
      snapshot = await saveDashboardSnapshotIfDue(data.current, { force:false, minutes:req.query.minutes });
    }
    ok(res, { action:'dashboard.realtime', saved:!!snapshot.saved, snapshot, ...data });
  }catch(e){
    fail(res, 500, 'dashboard realtime failed', { detail:String(e && e.message || e) });
  }
});

app.post('/api/gm/dashboard/snapshot', async (req,res)=>{
  const startedAt = Date.now();
  try{
    const data = await buildDashboardRealtime(startedAt);
    const force = String((req.body&&req.body.force)||req.query.force||'0') === '1';
    const snapshot = await saveDashboardSnapshotIfDue(data.current, { force, minutes:(req.body&&req.body.minutes)||req.query.minutes });
    ok(res, { action:'dashboard.snapshot', saved:!!snapshot.saved, snapshot, ...data });
  }catch(e){
    fail(res, 500, 'dashboard snapshot failed', { detail:String(e && e.message || e) });
  }
});


function normalizeKeywordForStat(v){
  return cleanText(v || '').toLowerCase().replace(/\s+/g, '');
}
function currentYyyymm(){
  const d = new Date();
  const m = String(d.getMonth()+1).padStart(2,'0');
  return String(d.getFullYear()) + m;
}
async function findCategoryKeywordMatch(keywordNormalized, langCode){
  if(!(await tableExists('gm_category_keyword'))) return null;
  const kw = normalizeKeywordForStat(keywordNormalized);
  if(!kw) return null;
  const r = await dbQuery(`
    SELECT *
    FROM gm_category_keyword
    WHERE keyword_normalized = $1
      AND status IN ('active','confirmed','auto')
      AND ($2 = '' OR lang_code = '' OR lang_code IS NULL OR lang_code = $2)
    ORDER BY
      CASE WHEN lang_code = $2 THEN 0 ELSE 1 END,
      confidence_score DESC NULLS LAST,
      updated_at DESC NULLS LAST
    LIMIT 1
  `, [kw, cleanText(langCode || '')]);
  return r.rows[0] || null;
}

const GM_LANG_COUNT_COLUMNS = ['ko', 'en', 'zh', 'vi', 'ja', 'tw', 'th', 'uz', 'ne', 'km', 'id', 'tl', 'mn', 'my', 'kk', 'si', 'ru', 'bn', 'ur', 'lo', 'hi', 'tr', 'fa', 'es', 'fr'];
function gmCountColumnFromLang(v){
  const s = cleanText(v || '').toLowerCase();
  if(GM_LANG_COUNT_COLUMNS.includes(s)) return s + '_count';
  return 'total_count';
}
function currentYyyy(){ return new Date().getFullYear().toString(); }
async function incrementCategoryPeriodCounter(table, periodCol, periodVal, row, client){
  if(!row.category_no) return;
  const q = client || { query: dbQuery };
  if(!(await tableExists(table))) return;
  const countCol = gmCountColumnFromLang(row.lang_code || row.ui_lang_code || row.country_code);
  const categoryNo = cleanText(row.category_no);
  const mallCode = cleanText(row.mall_code || '');
  const params = [periodVal, categoryNo, cleanText(row.category_code), cleanText(row.category_name), mallCode];
  const updateSql = `UPDATE ${table} SET category_code=$3, category_name=$4, mall_code=$5, total_count=COALESCE(total_count,0)+1, ${countCol}=COALESCE(${countCol},0)+1, last_search_at=now(), updated_at=now() WHERE ${periodCol}=$1 AND category_no=$2 AND COALESCE(mall_code,'')=COALESCE($5,'')`;
  const r = await q.query(updateSql, params);
  if(!r.rowCount){
    const insertSql = `INSERT INTO ${table} (${periodCol}, category_no, category_code, category_name, mall_code, total_count, ${countCol}, first_search_at, last_search_at, updated_at) VALUES ($1,$2,$3,$4,$5,1,1,now(),now(),now())`;
    await q.query(insertSql, params);
  }
}
async function upsertSalesAggregate(client, order, item){
  const q = client;
  const now = new Date();
  const yyyymm = String(now.getFullYear()) + String(now.getMonth()+1).padStart(2,'0');
  const yyyy = String(now.getFullYear());
  const qty = Math.max(1, toInt(item.quantity, 1));
  const saleUnit = toInt(item.customer_order_price ?? item.mall_sale_price, 0);
  const salesAmount = toInt(item.product_amount, saleUnit * qty);
  const purchaseUnit = toInt(item.final_supply_price ?? item.purchase_price ?? item.purchase_unit_price, 0);
  const purchaseAmount = toInt(item.purchase_amount, purchaseUnit * qty);
  const productUid = cleanText(item.product_uid || (cleanText(item.mall_code||'') && cleanText(item.pi_ii_vi||'') ? cleanText(item.mall_code)+'_'+cleanText(item.pi_ii_vi) : cleanText(item.pi_ii_vi||'')));
  if(!productUid) return;
  const pi = cleanText(item.pi_ii_vi || '');
  const itemKey = pi || productUid;
  const orderNo = cleanText(order.order_no || '');
  if(orderNo && itemKey && await tableExists('gm_sales_aggregate_event')){
    const ev = await q.query(`INSERT INTO gm_sales_aggregate_event (
        order_no, item_key, pi_ii_vi, product_uid, sales_qty, sales_amount, purchase_amount, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,now())
      ON CONFLICT (order_no, item_key) DO NOTHING
      RETURNING id`, [orderNo, itemKey, pi, productUid, qty, salesAmount, purchaseAmount]);
    if(!ev.rowCount) return;
  }
  const mall = cleanText(item.mall_code || '');
  const pname = cleanText(item.product_name || '');
  const catNo = cleanText(item.category_no || order.category_no || '');
  const catCode = cleanText(item.category_code || order.category_code || '');
  const catName = cleanText(item.category_name || order.category_name || '');
  const country = cleanText(order.country_code || order.member_country_code || order.receiver_country_code || order.lang_code || order.ui_lang_code || '');
  async function upProduct(table, periodCol, periodVal){
    if(!(await tableExists(table))) return;
    await q.query(`INSERT INTO ${table} (${periodCol}, product_uid, pi_ii_vi, mall_code, product_name, category_no, category_code, sales_qty, sales_amount, purchase_amount, gross_profit, margin_rate, first_order_at, last_order_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$9-$10, CASE WHEN $9>0 THEN ROUND((($9-$10)/$9)*100,4) ELSE 0 END, now(), now(), now())
      ON CONFLICT (${periodCol}, product_uid) DO UPDATE SET
        product_name=EXCLUDED.product_name, category_no=EXCLUDED.category_no, category_code=EXCLUDED.category_code,
        sales_qty=${table}.sales_qty+EXCLUDED.sales_qty, sales_amount=${table}.sales_amount+EXCLUDED.sales_amount, purchase_amount=${table}.purchase_amount+EXCLUDED.purchase_amount,
        gross_profit=(${table}.sales_amount+EXCLUDED.sales_amount)-(${table}.purchase_amount+EXCLUDED.purchase_amount),
        margin_rate=CASE WHEN (${table}.sales_amount+EXCLUDED.sales_amount)>0 THEN ROUND((((${table}.sales_amount+EXCLUDED.sales_amount)-(${table}.purchase_amount+EXCLUDED.purchase_amount))/(${table}.sales_amount+EXCLUDED.sales_amount))*100,4) ELSE 0 END,
        last_order_at=now(), updated_at=now()`, [periodVal, productUid, pi, mall, pname, catNo, catCode, qty, salesAmount, purchaseAmount]);
  }
  async function upProductCountry(table, periodCol, periodVal){
    if(!country || !(await tableExists(table))) return;
    await q.query(`INSERT INTO ${table} (${periodCol}, product_uid, country_code, mall_code, sales_qty, sales_amount, purchase_amount, first_order_at, last_order_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,now(),now(),now())
      ON CONFLICT (${periodCol}, product_uid, country_code) DO UPDATE SET
        sales_qty=${table}.sales_qty+EXCLUDED.sales_qty, sales_amount=${table}.sales_amount+EXCLUDED.sales_amount, purchase_amount=${table}.purchase_amount+EXCLUDED.purchase_amount,
        last_order_at=now(), updated_at=now()`, [periodVal, productUid, country, mall, qty, salesAmount, purchaseAmount]);
  }
  async function upCategory(table, periodCol, periodVal){
    if(!catNo || !(await tableExists(table))) return;
    await q.query(`INSERT INTO ${table} (${periodCol}, category_no, category_code, category_name, sales_qty, sales_amount, purchase_amount, gross_profit, margin_rate, first_order_at, last_order_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$6-$7, CASE WHEN $6>0 THEN ROUND((($6-$7)/$6)*100,4) ELSE 0 END, now(), now(), now())
      ON CONFLICT (${periodCol}, category_no) DO UPDATE SET
        category_code=EXCLUDED.category_code, category_name=EXCLUDED.category_name,
        sales_qty=${table}.sales_qty+EXCLUDED.sales_qty, sales_amount=${table}.sales_amount+EXCLUDED.sales_amount, purchase_amount=${table}.purchase_amount+EXCLUDED.purchase_amount,
        gross_profit=(${table}.sales_amount+EXCLUDED.sales_amount)-(${table}.purchase_amount+EXCLUDED.purchase_amount),
        margin_rate=CASE WHEN (${table}.sales_amount+EXCLUDED.sales_amount)>0 THEN ROUND((((${table}.sales_amount+EXCLUDED.sales_amount)-(${table}.purchase_amount+EXCLUDED.purchase_amount))/(${table}.sales_amount+EXCLUDED.sales_amount))*100,4) ELSE 0 END,
        last_order_at=now(), updated_at=now()`, [periodVal, catNo, catCode, catName, qty, salesAmount, purchaseAmount]);
  }
  async function upCategoryCountry(table, periodCol, periodVal){
    if(!catNo || !country || !(await tableExists(table))) return;
    await q.query(`INSERT INTO ${table} (${periodCol}, category_no, country_code, sales_qty, sales_amount, purchase_amount, first_order_at, last_order_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,now(),now(),now())
      ON CONFLICT (${periodCol}, category_no, country_code) DO UPDATE SET
        sales_qty=${table}.sales_qty+EXCLUDED.sales_qty, sales_amount=${table}.sales_amount+EXCLUDED.sales_amount, purchase_amount=${table}.purchase_amount+EXCLUDED.purchase_amount,
        last_order_at=now(), updated_at=now()`, [periodVal, catNo, country, qty, salesAmount, purchaseAmount]);
  }
  await upProduct('gm_product_sales_monthly','yyyymm',yyyymm); await upProduct('gm_product_sales_yearly','yyyy',yyyy);
  await upProductCountry('gm_product_country_sales_monthly','yyyymm',yyyymm); await upProductCountry('gm_product_country_sales_yearly','yyyy',yyyy);
  await upCategory('gm_category_sales_monthly','yyyymm',yyyymm); await upCategory('gm_category_sales_yearly','yyyy',yyyy);
  await upCategoryCountry('gm_category_country_sales_monthly','yyyymm',yyyymm); await upCategoryCountry('gm_category_country_sales_yearly','yyyy',yyyy);
}

async function upsertSearchStats(row){
  if(await tableExists('gm_search_keyword_stat')){
    await dbQuery(`
      INSERT INTO gm_search_keyword_stat (
        keyword_original, keyword_normalized, keyword_canonical,
        country_code, lang_code, member_country_code,
        category_no, category_code, category_name,
        mall_code, search_count, cache_used_count, cache_miss_count,
        result_count_sum, db_insert_count_sum, queue_send_count_sum,
        first_search_at, last_search_at, updated_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13,$14,$15,now(),now(),now()
      )
      ON CONFLICT (keyword_normalized, country_code, lang_code, category_no, mall_code) DO UPDATE SET
        keyword_original=EXCLUDED.keyword_original,
        keyword_canonical=EXCLUDED.keyword_canonical,
        member_country_code=EXCLUDED.member_country_code,
        category_code=EXCLUDED.category_code,
        category_name=EXCLUDED.category_name,
        search_count=gm_search_keyword_stat.search_count+1,
        cache_used_count=gm_search_keyword_stat.cache_used_count+EXCLUDED.cache_used_count,
        cache_miss_count=gm_search_keyword_stat.cache_miss_count+EXCLUDED.cache_miss_count,
        result_count_sum=gm_search_keyword_stat.result_count_sum+EXCLUDED.result_count_sum,
        db_insert_count_sum=gm_search_keyword_stat.db_insert_count_sum+EXCLUDED.db_insert_count_sum,
        queue_send_count_sum=gm_search_keyword_stat.queue_send_count_sum+EXCLUDED.queue_send_count_sum,
        last_search_at=now(),
        updated_at=now()
    `, [
      row.keyword_original, row.keyword_normalized, row.keyword_canonical,
      row.country_code, row.lang_code, row.member_country_code,
      row.category_no, row.category_code, row.category_name,
      row.mall_code, row.cache_used ? 1 : 0, row.cache_used ? 0 : 1,
      row.result_count, row.db_insert_count, row.queue_send_count
    ]);
  }
  if(row.category_no && await tableExists('gm_category_search_stat')){
    await dbQuery(`
      INSERT INTO gm_category_search_stat (
        category_no, category_code, category_name,
        country_code, lang_code, member_country_code, mall_code,
        search_count, cache_used_count, cache_miss_count,
        result_count_sum, db_insert_count_sum, queue_send_count_sum,
        first_search_at, last_search_at, updated_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,1,$8,$9,$10,$11,$12,now(),now(),now()
      )
      ON CONFLICT (category_no, country_code, lang_code, mall_code) DO UPDATE SET
        category_code=EXCLUDED.category_code,
        category_name=EXCLUDED.category_name,
        member_country_code=EXCLUDED.member_country_code,
        search_count=gm_category_search_stat.search_count+1,
        cache_used_count=gm_category_search_stat.cache_used_count+EXCLUDED.cache_used_count,
        cache_miss_count=gm_category_search_stat.cache_miss_count+EXCLUDED.cache_miss_count,
        result_count_sum=gm_category_search_stat.result_count_sum+EXCLUDED.result_count_sum,
        db_insert_count_sum=gm_category_search_stat.db_insert_count_sum+EXCLUDED.db_insert_count_sum,
        queue_send_count_sum=gm_category_search_stat.queue_send_count_sum+EXCLUDED.queue_send_count_sum,
        last_search_at=now(),
        updated_at=now()
    `, [
      row.category_no, row.category_code, row.category_name,
      row.country_code, row.lang_code, row.member_country_code, row.mall_code,
      row.cache_used ? 1 : 0, row.cache_used ? 0 : 1,
      row.result_count, row.db_insert_count, row.queue_send_count
    ]);
  }

  if(row.category_no){
    const yyyymm = cleanText(row.yyyymm || currentYyyymm());
    await incrementCategoryPeriodCounter('gm_category_search_monthly','yyyymm',yyyymm,row);
    await incrementCategoryPeriodCounter('gm_category_search_yearly','yyyy',cleanText(row.yyyy || currentYyyy()),row);
  }
}

app.post('/api/gm/search/log', async (req,res)=>{
  try{
    if(!(await tableExists('gm_search_log'))) return fail(res, 500, 'gm_search_log table not found');
    const b = req.body || {};
    const keywordOriginal = cleanText(b.keyword_original || b.keyword || b.origin || '');
    const keywordNormalized = normalizeKeywordForStat(b.keyword_normalized || keywordOriginal);
    const uiLangCode = cleanText(b.ui_lang_code || b.uiLangCode || b.gm_lang || b.gmLang || b.lang_code || b.langCode || '');
    const keywordLangCode = cleanText(b.keyword_lang_code || b.keywordLangCode || uiLangCode);
    const langCode = uiLangCode;
    let keywordCanonical = cleanText(b.keyword_canonical || b.keywordCanonical || '');
    let categoryNo = cleanText(b.category_no || b.categoryNo || '');
    let categoryCode = cleanText(b.category_code || b.categoryCode || '');
    let categoryName = cleanText(b.category_name || b.categoryName || '');
    const match = await findCategoryKeywordMatch(keywordNormalized, langCode);
    if(match){
      if(!keywordCanonical) keywordCanonical = cleanText(match.keyword_canonical || match.keyword_normalized || keywordNormalized);
      if(!categoryNo) categoryNo = cleanText(match.category_no || '');
      if(!categoryCode) categoryCode = cleanText(match.category_code || '');
      if(!categoryName) categoryName = cleanText(match.category_name || '');
    }
    if(!keywordCanonical) keywordCanonical = keywordNormalized;
    const row = {
      keyword_original: keywordOriginal,
      keyword_normalized: keywordNormalized,
      keyword_canonical: keywordCanonical,
      lang_code: langCode,
      country_code: cleanText(b.country_code || b.countryCode || ''),
      member_country_code: cleanText(b.member_country_code || b.memberCountryCode || ''),
      category_code: categoryCode,
      category_no: categoryNo,
      category_name: categoryName,
      mall_code: cleanText(b.mall_code || b.mallCode || ''),
      result_count: toInt(b.result_count || b.resultCount, 0),
      db_insert_count: toInt(b.db_insert_count || b.dbInsertCount, 0),
      queue_send_count: toInt(b.queue_send_count || b.queueSendCount, 0),
      cache_used: !!(b.cache_used || b.cacheUsed),
      yyyymm: cleanText(b.yyyymm || b.year_month || b.yearMonth || '')
    };
    await dbQuery(`
      INSERT INTO gm_search_log (
        search_at, keyword_original, keyword_normalized, keyword_canonical,
        lang_code, ui_lang_code, keyword_lang_code, country_code, member_country_code,
        category_code, category_no, category_name,
        mall_code, result_count, db_insert_count, queue_send_count,
        cache_used, cache_key, search_source,
        member_id, guest_key, device_type, request_id, raw_json, created_at
      ) VALUES (
        now(), $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23::jsonb,now()
      )
    `, [
      row.keyword_original, row.keyword_normalized, row.keyword_canonical,
      row.lang_code, uiLangCode, keywordLangCode, row.country_code, row.member_country_code,
      row.category_code, row.category_no, row.category_name,
      row.mall_code, row.result_count, row.db_insert_count, row.queue_send_count,
      row.cache_used, cleanText(b.cache_key || b.cacheKey || ''), cleanText(b.search_source || b.searchSource || ''),
      cleanText(b.member_id || b.memberId || ''), cleanText(b.guest_key || b.guestKey || ''), cleanText(b.device_type || b.deviceType || ''), cleanText(b.request_id || b.requestId || ''),
      JSON.stringify({ ...b, ui_lang_code:uiLangCode, keyword_lang_code:keywordLangCode, matched_category_keyword: match || null })
    ]);
    await upsertSearchStats(row);
    ok(res, { action:'search.log', inserted:true, matched:!!match, keyword_normalized:row.keyword_normalized, keyword_canonical:row.keyword_canonical, category_no:row.category_no, category_code:row.category_code });
  }catch(e){
    fail(res, 500, 'search log failed', { detail:String(e && e.message || e) });
  }
});

app.get('/api/gm/search/summary', async (req,res)=>{
  try{
    const limit = Math.max(1, Math.min(100, toInt(req.query.limit, 20)));
    const out = {};
    if(await tableExists('gm_search_keyword_stat')){
      const r = await dbQuery(`
        SELECT keyword_canonical, keyword_normalized, country_code, lang_code, category_no, category_code, mall_code, search_count, last_search_at
        FROM gm_search_keyword_stat
        ORDER BY search_count DESC, last_search_at DESC
        LIMIT $1
      `, [limit]);
      out.top_keywords = r.rows;
    }
    if(await tableExists('gm_category_search_stat')){
      const r = await dbQuery(`
        SELECT category_no, category_code, category_name, country_code, lang_code, mall_code, search_count, last_search_at
        FROM gm_category_search_stat
        ORDER BY search_count DESC, last_search_at DESC
        LIMIT $1
      `, [limit]);
      out.top_categories = r.rows;
    }
    if(await tableExists('gm_category_search_monthly')){
      const ym = cleanText(req.query.yyyymm || req.query.month || '');
      const r = await dbQuery(`
        SELECT yyyymm, category_no, category_code, category_name, country_code, lang_code, mall_code, search_count, last_search_at
        FROM gm_category_search_monthly
        WHERE ($2 = '' OR yyyymm = $2)
        ORDER BY yyyymm DESC, search_count DESC, last_search_at DESC
        LIMIT $1
      `, [limit, ym]);
      out.monthly_categories = r.rows;
    }
    ok(res, { action:'search.summary', ...out });
  }catch(e){
    fail(res, 500, 'search summary failed', { detail:String(e && e.message || e) });
  }
});

app.get('/api/gm/search/monthly', async (req,res)=>{
  try{
    if(!(await tableExists('gm_category_search_monthly'))) return fail(res, 500, 'gm_category_search_monthly table not found');
    const limit = Math.max(1, Math.min(500, toInt(req.query.limit, 100)));
    const yyyymm = cleanText(req.query.yyyymm || req.query.month || '');
    const country = cleanText(req.query.country_code || req.query.countryCode || '');
    const lang = cleanText(req.query.lang_code || req.query.langCode || '');
    const r = await dbQuery(`
      SELECT yyyymm, category_no, category_code, category_name, country_code, lang_code, mall_code,
             search_count, cache_used_count, cache_miss_count, result_count_sum, db_insert_count_sum, queue_send_count_sum,
             first_search_at, last_search_at
      FROM gm_category_search_monthly
      WHERE ($2 = '' OR yyyymm = $2)
        AND ($3 = '' OR country_code = $3)
        AND ($4 = '' OR lang_code = $4)
      ORDER BY yyyymm DESC, search_count DESC, last_search_at DESC
      LIMIT $1
    `, [limit, yyyymm, country, lang]);
    ok(res, { action:'search.monthly', rows:r.rows });
  }catch(e){
    fail(res, 500, 'search monthly failed', { detail:String(e && e.message || e) });
  }
});

app.get('/api/gm/sales/summary', async (req,res)=>{
  try{
    const yyyymm = cleanText(req.query.yyyymm || currentYyyymm());
    const yyyy = cleanText(req.query.yyyy || currentYyyy());
    const out = { yyyymm, yyyy };
    if(await tableExists('gm_product_sales_monthly')){
      const r = await dbQuery(`SELECT product_uid, product_name, sales_qty, sales_amount, purchase_amount, gross_profit, margin_rate FROM gm_product_sales_monthly WHERE yyyymm=$1 ORDER BY sales_amount DESC, sales_qty DESC LIMIT 50`, [yyyymm]);
      out.product_monthly_top = r.rows;
    }
    if(await tableExists('gm_category_sales_monthly')){
      const r = await dbQuery(`SELECT category_no, category_code, category_name, sales_qty, sales_amount, purchase_amount, gross_profit, margin_rate FROM gm_category_sales_monthly WHERE yyyymm=$1 ORDER BY sales_amount DESC, sales_qty DESC LIMIT 50`, [yyyymm]);
      out.category_monthly_top = r.rows;
    }
    if(await tableExists('gm_product_sales_yearly')){
      const r = await dbQuery(`SELECT product_uid, product_name, sales_qty, sales_amount, purchase_amount, gross_profit, margin_rate FROM gm_product_sales_yearly WHERE yyyy=$1 ORDER BY sales_amount DESC, sales_qty DESC LIMIT 50`, [yyyy]);
      out.product_yearly_top = r.rows;
    }
    if(await tableExists('gm_category_sales_yearly')){
      const r = await dbQuery(`SELECT category_no, category_code, category_name, sales_qty, sales_amount, purchase_amount, gross_profit, margin_rate FROM gm_category_sales_yearly WHERE yyyy=$1 ORDER BY sales_amount DESC, sales_qty DESC LIMIT 50`, [yyyy]);
      out.category_yearly_top = r.rows;
    }
    ok(res, { action:'sales.summary', ...out });
  }catch(e){ fail(res,500,'sales summary failed',{detail:String(e && e.message || e)}); }
});


async function tableColumnNames(table){
  const r = await dbQuery(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name=$1
    ORDER BY ordinal_position
  `, [table]);
  return r.rows.map(x=>x.column_name);
}
async function archiveProducts(productUids, meta){
  productUids = (Array.isArray(productUids) ? productUids : [productUids]).map(cleanText).filter(Boolean);
  if(!productUids.length) return { moved:0, product_uids:[] };
  if(!(await tableExists('gm_product'))) throw new Error('gm_product table not found');
  if(!(await tableExists('gm_product_archive'))) throw new Error('gm_product_archive table not found');
  const productCols = await tableColumnNames('gm_product');
  const archiveCols = await tableColumnNames('gm_product_archive');
  const common = productCols.filter(c => archiveCols.includes(c));
  const extraCols = ['archive_reason','archive_source','expire_date','archive_note','archived_by'].filter(c => archiveCols.includes(c));
  const insertCols = common.concat(extraCols);
  const selectCols = common.map(c => 'p."' + c.replace(/"/g,'""') + '"').concat(extraCols.map(c => {
    if(c === 'archive_reason') return '$2::text';
    if(c === 'archive_source') return '$3::text';
    if(c === 'expire_date') return '$4::timestamp';
    if(c === 'archive_note') return '$5::text';
    if(c === 'archived_by') return '$6::text';
    return 'NULL';
  }));
  const conflict = archiveCols.includes('product_uid') ? ' ON CONFLICT (product_uid) DO UPDATE SET ' + insertCols.filter(c=>c!=='product_uid').map(c => '"' + c + '"=EXCLUDED."' + c + '"').join(', ') : '';
  const sql = `
    INSERT INTO gm_product_archive (${insertCols.map(c=>'"'+c.replace(/"/g,'""')+'"').join(', ')})
    SELECT ${selectCols.join(', ')}
    FROM gm_product p
    WHERE p.product_uid = ANY($1::text[])
    ${conflict}
    RETURNING product_uid
  `;
  const r = await dbQuery(sql, [
    productUids,
    cleanText(meta.archive_reason || 'EXPIRE'),
    cleanText(meta.archive_source || 'SYSTEM'),
    cleanText(meta.expire_date || new Date().toISOString()),
    cleanText(meta.archive_note || ''),
    cleanText(meta.archived_by || '')
  ]);
  const moved = r.rows.map(x=>x.product_uid);
  if(moved.length){
    await dbQuery(`DELETE FROM gm_product WHERE product_uid = ANY($1::text[])`, [moved]);
  }
  return { moved:moved.length, product_uids:moved };
}

app.post('/api/gm/product/archive', async (req,res)=>{
  try{
    const b = req.body || {};
    const productUids = b.product_uids || b.productUids || b.product_uid || b.productUid || [];
    const result = await archiveProducts(productUids, {
      archive_reason: b.archive_reason || b.archiveReason || b.reason || 'EXPIRE',
      archive_source: b.archive_source || b.archiveSource || 'MANUAL',
      expire_date: b.expire_date || b.expireDate || new Date().toISOString(),
      archive_note: b.archive_note || b.archiveNote || '',
      archived_by: b.archived_by || b.archivedBy || ''
    });
    ok(res, { action:'product.archive', ...result });
  }catch(e){
    fail(res, 500, 'product archive failed', { detail:String(e && e.message || e) });
  }
});

app.get('/api/gm/db/status', async (req,res)=>{
  try{
    const r = await dbQuery(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema='public' AND table_name LIKE 'gm_%'
      ORDER BY table_name
    `);
    ok(res, { dbReady, tables:r.rows.map(x=>x.table_name) });
  }catch(e){ fail(res, 500, 'db status failed', { detail:String(e && e.message || e) }); }
});

app.get('/api/gm/db/columns', async (req,res)=>{
  try{
    const table = cleanText(req.query.table || 'gm_product');
    if(!/^gm_[a-z0-9_]+$/i.test(table)) return fail(res, 400, 'invalid table name');
    const r = await dbQuery(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema='public' AND table_name=$1
      ORDER BY ordinal_position
    `, [table]);
    ok(res, { table, columns:r.rows });
  }catch(e){ fail(res, 500, 'db columns failed', { detail:String(e && e.message || e) }); }
});

app.post('/api/gm/supplier/upsert', async (req,res)=>{
  try{
    const s = req.body || {};
    const gmSupplierId = cleanText(s.gm_supplier_id || s.supplier_id || s.supplier_code || ('GMSP_' + Date.now()));
    const mallCode = cleanText(s.mall_code);
    const mallSellerId = cleanText(s.mall_seller_id || s.seller_id || s.seller_key);
    const sellerName = cleanText(s.seller_name || s.supplier_name || s.company_name);
    if(!mallCode || !mallSellerId || !sellerName) return fail(res, 400, 'mall_code/mall_seller_id/seller_name required');
    const sellerKey = cleanText(s.seller_key || `${mallCode}_${mallSellerId}`);
    const supplierCode = cleanText(s.supplier_code || `${mallCode}_SP_${mallSellerId}`);

    const r = await dbQuery(`
      INSERT INTO gm_supplier (
        gm_supplier_id, mall_code, mall_seller_id, supplier_code, seller_key,
        seller_name, company_name, ceo_name, business_number, online_sales_number,
        main_phone, main_email, business_zipcode, business_address1, business_address2,
        manager_name, manager_department, manager_phone, manager_mobile, manager_email,
        status, created_at, updated_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,now(),now()
      )
      ON CONFLICT (gm_supplier_id) DO UPDATE SET
        mall_code=EXCLUDED.mall_code,
        mall_seller_id=EXCLUDED.mall_seller_id,
        supplier_code=EXCLUDED.supplier_code,
        seller_key=EXCLUDED.seller_key,
        seller_name=EXCLUDED.seller_name,
        company_name=EXCLUDED.company_name,
        ceo_name=EXCLUDED.ceo_name,
        business_number=EXCLUDED.business_number,
        online_sales_number=EXCLUDED.online_sales_number,
        main_phone=EXCLUDED.main_phone,
        main_email=EXCLUDED.main_email,
        business_zipcode=EXCLUDED.business_zipcode,
        business_address1=EXCLUDED.business_address1,
        business_address2=EXCLUDED.business_address2,
        manager_name=EXCLUDED.manager_name,
        manager_department=EXCLUDED.manager_department,
        manager_phone=EXCLUDED.manager_phone,
        manager_mobile=EXCLUDED.manager_mobile,
        manager_email=EXCLUDED.manager_email,
        status=EXCLUDED.status,
        updated_at=now()
      RETURNING *
    `, [
      gmSupplierId, mallCode, mallSellerId, supplierCode, sellerKey,
      sellerName, cleanText(s.company_name), cleanText(s.ceo_name),
      cleanText(s.business_number), cleanText(s.online_sales_number),
      cleanText(s.main_phone), cleanText(s.main_email),
      cleanText(s.business_zipcode), cleanText(s.business_address1), cleanText(s.business_address2),
      cleanText(s.manager_name), cleanText(s.manager_department), cleanText(s.manager_phone),
      cleanText(s.manager_mobile), cleanText(s.manager_email), cleanText(s.status || 'active')
    ]);
    ok(res, { item:r.rows[0] });
  }catch(e){ fail(res, 500, 'supplier upsert failed', { detail:String(e && e.message || e) }); }
});

app.post('/api/gm/product/upsert', async (req,res)=>{
  try{
    const p = req.body || {};
    const productId = cleanText(p.product_id || p.productId);
    const itemId = cleanText(p.item_id || p.itemId);
    const vendorItemId = cleanText(p.vendor_item_id || p.vendorItemId || p.venderItemId);
    const mallCode = cleanText(p.mall_code || p.mallCode || 'CPKR');
    const pi = cleanText(p.pi_ii_vi || [productId,itemId,vendorItemId].filter(Boolean).join('_'));
    const uid = cleanText(p.product_uid || `${mallCode}_${pi}`);
    const productName = cleanText(p.product_name || p.productName || p.title);
    if(!uid || !pi || !mallCode || !productName) return fail(res, 400, 'product_uid/pi_ii_vi/mall_code/product_name required');

    const r = await dbQuery(`
      INSERT INTO gm_product (
        product_uid, glomart_code, gm_category, category_keyword, mall_code, mall_category,
        product_id, item_id, vendor_item_id, pi_ii_vi, internal_product_code,
        product_name, mall_product_name, option_count, option_name, option_value,
        origin_country, mall_sale_price, final_supply_price, normal_price, discount_price,
        delivery_fee, delivery_eta_text, delivery_type, tax_type, overseas_direct_yn,
        supplier_id, supplier_name_snapshot, product_url, thumb_origin_url, thumb_file_name,
        return_available_yn, exchange_available_yn, return_policy_text, exchange_policy_text,
        return_shipping_fee, exchange_shipping_fee, return_period_days, exchange_period_days,
        return_address, exchange_address, return_contact, exchange_contact,
        soldout_yn, sale_status, last_seen_at, created_at, updated_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42,$43,$44,$45,now(),now(),now()
      )
      ON CONFLICT (product_uid) DO UPDATE SET
        product_name=EXCLUDED.product_name,
        mall_product_name=EXCLUDED.mall_product_name,
        option_count=EXCLUDED.option_count,
        option_name=EXCLUDED.option_name,
        option_value=EXCLUDED.option_value,
        mall_sale_price=EXCLUDED.mall_sale_price,
        final_supply_price=EXCLUDED.final_supply_price,
        normal_price=EXCLUDED.normal_price,
        discount_price=EXCLUDED.discount_price,
        delivery_fee=EXCLUDED.delivery_fee,
        delivery_eta_text=EXCLUDED.delivery_eta_text,
        delivery_type=EXCLUDED.delivery_type,
        supplier_id=EXCLUDED.supplier_id,
        supplier_name_snapshot=EXCLUDED.supplier_name_snapshot,
        product_url=EXCLUDED.product_url,
        thumb_origin_url=EXCLUDED.thumb_origin_url,
        thumb_file_name=EXCLUDED.thumb_file_name,
        return_available_yn=EXCLUDED.return_available_yn,
        exchange_available_yn=EXCLUDED.exchange_available_yn,
        return_policy_text=EXCLUDED.return_policy_text,
        exchange_policy_text=EXCLUDED.exchange_policy_text,
        return_shipping_fee=EXCLUDED.return_shipping_fee,
        exchange_shipping_fee=EXCLUDED.exchange_shipping_fee,
        return_period_days=EXCLUDED.return_period_days,
        exchange_period_days=EXCLUDED.exchange_period_days,
        return_address=EXCLUDED.return_address,
        exchange_address=EXCLUDED.exchange_address,
        return_contact=EXCLUDED.return_contact,
        exchange_contact=EXCLUDED.exchange_contact,
        soldout_yn=EXCLUDED.soldout_yn,
        sale_status=EXCLUDED.sale_status,
        last_seen_at=now(),
        updated_at=now()
      RETURNING product_uid, pi_ii_vi
    `, [
      uid, cleanText(p.glomart_code || p.glomartCode), cleanText(p.gm_category || p.gmCategory),
      cleanText(p.category_keyword || p.categoryKeyword), mallCode, cleanText(p.mall_category || p.mallCategory),
      productId, itemId, vendorItemId, pi, cleanText(p.internal_product_code),
      productName, cleanText(p.mall_product_name || p.mallProductName), toInt(p.option_count, 0),
      cleanText(p.option_name || p.optionName), cleanText(p.option_value || p.optionValue),
      cleanText(p.origin_country || p.originCountry), toInt(p.mall_sale_price || p.price || p.real_price, 0),
      p.final_supply_price == null ? null : toInt(p.final_supply_price, 0),
      p.normal_price == null ? null : toInt(p.normal_price, 0),
      p.discount_price == null ? null : toInt(p.discount_price, 0),
      toInt(p.delivery_fee, 0), cleanText(p.delivery_eta_text || p.deliveryText),
      cleanText(p.delivery_type || p.deliveryType), cleanText(p.tax_type || p.taxType),
      cleanText(p.overseas_direct_yn || 'N'), cleanText(p.supplier_id || p.supplierId),
      cleanText(p.supplier_name_snapshot || p.supplierName), normalizeUrl(p.product_url || p.url),
      normalizeUrl(p.thumb_origin_url || p.image || p.imageUrl), cleanText(p.thumb_file_name),
      cleanText(p.return_available_yn || p.returnAvailableYn || 'Y'), cleanText(p.exchange_available_yn || p.exchangeAvailableYn || 'Y'),
      cleanText(p.return_policy_text || p.returnPolicyText || p.return_policy || p.returnPolicy || ''),
      cleanText(p.exchange_policy_text || p.exchangePolicyText || p.exchange_policy || p.exchangePolicy || ''),
      toInt(p.return_shipping_fee || p.returnShippingFee, 0), toInt(p.exchange_shipping_fee || p.exchangeShippingFee, 0),
      p.return_period_days == null && p.returnPeriodDays == null ? null : toInt(p.return_period_days || p.returnPeriodDays, 0),
      p.exchange_period_days == null && p.exchangePeriodDays == null ? null : toInt(p.exchange_period_days || p.exchangePeriodDays, 0),
      cleanText(p.return_address || p.returnAddress || ''), cleanText(p.exchange_address || p.exchangeAddress || ''),
      cleanText(p.return_contact || p.returnContact || ''), cleanText(p.exchange_contact || p.exchangeContact || ''),
      cleanText(p.soldout_yn || 'N'), cleanText(p.sale_status || 'active')
    ]);
    ok(res, { item:r.rows[0] });
  }catch(e){ fail(res, 500, 'product upsert failed', { detail:String(e && e.message || e) }); }
});

app.post('/api/gm/basket/add', async (req,res)=>{
  try{
    const b = req.body || {};
    const own = owner(b);
    const pi = cleanText(b.pi_ii_vi);
    const productName = cleanText(b.product_name || b.productName);
    if(!pi || !productName) return fail(res, 400, 'pi_ii_vi/product_name required');

    const conflict = own.col === 'member_id'
      ? "ON CONFLICT (member_id, pi_ii_vi) WHERE member_id IS NOT NULL AND member_id <> ''"
      : "ON CONFLICT (guest_key, pi_ii_vi) WHERE guest_key IS NOT NULL AND guest_key <> ''";

    const r = await dbQuery(`
      INSERT INTO gm_basket (
        member_id, guest_key, pi_ii_vi, product_name, option_name, option_value,
        quantity, amount, amount_type, delivery_type, delivery_fee, added_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now(),now())
      ${conflict}
      DO UPDATE SET
        quantity = gm_basket.quantity + EXCLUDED.quantity,
        product_name=EXCLUDED.product_name,
        option_name=EXCLUDED.option_name,
        option_value=EXCLUDED.option_value,
        amount=EXCLUDED.amount,
        amount_type=EXCLUDED.amount_type,
        delivery_type=EXCLUDED.delivery_type,
        delivery_fee=EXCLUDED.delivery_fee,
        updated_at=now()
      RETURNING *
    `, [
      cleanText(b.member_id) || null, cleanText(b.guest_key) || null, pi, productName,
      cleanText(b.option_name || b.optionName), cleanText(b.option_value || b.optionValue),
      Math.max(1, toInt(b.quantity, 1)), toInt(b.amount, 0),
      cleanText(b.amount_type || 'unit'), cleanText(b.delivery_type || b.deliveryType), toInt(b.delivery_fee, 0)
    ]);
    ok(res, { item:r.rows[0] });
  }catch(e){ fail(res, 500, 'basket add failed', { detail:String(e && e.message || e) }); }
});

app.get('/api/gm/basket/list', async (req,res)=>{
  try{
    const memberId = cleanText(req.query.member_id);
    const guestKey = cleanText(req.query.guest_key);
    if(!memberId && !guestKey) return fail(res, 400, 'member_id or guest_key required');
    const r = memberId
      ? await dbQuery('SELECT * FROM gm_basket WHERE member_id=$1 ORDER BY added_at DESC', [memberId])
      : await dbQuery('SELECT * FROM gm_basket WHERE guest_key=$1 ORDER BY added_at DESC', [guestKey]);
    ok(res, { items:r.rows });
  }catch(e){ fail(res, 500, 'basket list failed', { detail:String(e && e.message || e) }); }
});

app.delete('/api/gm/basket/item', async (req,res)=>{
  try{
    const b = req.body || {};
    const own = owner(b);
    const pi = cleanText(b.pi_ii_vi);
    if(!pi) return fail(res, 400, 'pi_ii_vi required');
    await dbQuery(`DELETE FROM gm_basket WHERE ${own.col}=$1 AND pi_ii_vi=$2`, [own.val, pi]);
    ok(res, { deleted:true });
  }catch(e){ fail(res, 500, 'basket delete failed', { detail:String(e && e.message || e) }); }
});

app.post('/api/gm/order/create', async (req,res)=>{
  const o = req.body || {};
  const items = Array.isArray(o.items) ? o.items : [];
  if(!cleanText(o.order_no) || !items.length) return fail(res, 400, 'order_no/items required');

  const client = await pool.connect();
  try{
    await client.query('BEGIN');
    await client.query(`
      INSERT INTO gm_order (
        order_no, member_id, guest_key, orderer_name, orderer_phone, orderer_mobile, orderer_email,
        receiver_name, receiver_phone, receiver_mobile, receiver_safe_phone,
        receiver_zipcode, receiver_address1, receiver_address2, delivery_memo,
        customs_required_yn, customs_clearance_code, customs_name, customs_mobile,
        payment_method, payment_method_display, payment_bank_name, payment_account_number,
        depositor_name, depositor_phone, expected_payment_amount, total_product_price,
        total_delivery_fee, extra_area_delivery_fee, estimated_customs_fee, estimated_import_vat,
        total_payment_price, order_status, payment_status, shipping_status, cs_status,
        ordered_at, created_at, updated_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,now(),now(),now()
      )
      ON CONFLICT (order_no) DO NOTHING
    `, [
      cleanText(o.order_no), cleanText(o.member_id) || null, cleanText(o.guest_key) || null,
      cleanText(o.orderer_name), cleanText(o.orderer_phone), cleanText(o.orderer_mobile), cleanText(o.orderer_email),
      cleanText(o.receiver_name), cleanText(o.receiver_phone), cleanText(o.receiver_mobile), cleanText(o.receiver_safe_phone),
      cleanText(o.receiver_zipcode), cleanText(o.receiver_address1), cleanText(o.receiver_address2), cleanText(o.delivery_memo),
      cleanText(o.customs_required_yn || 'N'), cleanText(o.customs_clearance_code), cleanText(o.customs_name), cleanText(o.customs_mobile),
      cleanText(o.payment_method || 'pending'), cleanText(o.payment_method_display || '미정'),
      cleanText(o.payment_bank_name), cleanText(o.payment_account_number),
      cleanText(o.depositor_name), cleanText(o.depositor_phone), toInt(o.expected_payment_amount, 0),
      toInt(o.total_product_price, 0), toInt(o.total_delivery_fee, 0), toInt(o.extra_area_delivery_fee, 0),
      toInt(o.estimated_customs_fee, 0), toInt(o.estimated_import_vat, 0), toInt(o.total_payment_price, 0),
      cleanText(o.order_status || 'ordered'), cleanText(o.payment_status || 'pending'),
      cleanText(o.shipping_status || 'pending'), cleanText(o.cs_status || 'none')
    ]);

    for(const it of items){
      await client.query(`
        INSERT INTO gm_order_item (
          order_no, pi_ii_vi, product_name, option_name, option_value, quantity,
          mall_sale_price, customer_order_price, final_supply_price, product_amount,
          delivery_type, delivery_fee, extra_area_delivery_fee, mall_code, supplier_id, supplier_name,
          product_url, thumb_file_name, hs_code, origin_country, carrier_name, tracking_number,
          item_order_status, item_shipping_status, created_at, updated_at
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,now(),now()
        )
        ON CONFLICT (order_no, pi_ii_vi) DO UPDATE SET
          quantity=EXCLUDED.quantity,
          product_amount=EXCLUDED.product_amount,
          updated_at=now()
      `, [
        cleanText(o.order_no), cleanText(it.pi_ii_vi), cleanText(it.product_name),
        cleanText(it.option_name), cleanText(it.option_value), Math.max(1, toInt(it.quantity, 1)),
        toInt(it.mall_sale_price, 0), toInt(it.customer_order_price, 0),
        it.final_supply_price == null ? null : toInt(it.final_supply_price, 0),
        toInt(it.product_amount, 0), cleanText(it.delivery_type), toInt(it.delivery_fee, 0),
        toInt(it.extra_area_delivery_fee, 0), cleanText(it.mall_code), cleanText(it.supplier_id),
        cleanText(it.supplier_name), normalizeUrl(it.product_url), cleanText(it.thumb_file_name),
        cleanText(it.hs_code), cleanText(it.origin_country), cleanText(it.carrier_name),
        cleanText(it.tracking_number), cleanText(it.item_order_status || 'ordered'),
        cleanText(it.item_shipping_status || 'pending')
      ]);
      try{ await upsertSalesAggregate(client, o, it); }catch(_agg){ try{ console.warn('[GM SALES AGG SKIP]', String(_agg && _agg.message || _agg)); }catch(_w){} }
    }

    await client.query('COMMIT');
    ok(res, { order_no:cleanText(o.order_no), item_count:items.length });
  }catch(e){
    await client.query('ROLLBACK').catch(()=>{});
    fail(res, 500, 'order create failed', { detail:String(e && e.message || e) });
  }finally{
    client.release();
  }
});

/* Existing JSON cache endpoints retained */
app.post('/module/scrap/api/collect', (req,res)=>{
  try{
    const result = savePayload(req.body || {});
    ok(res, { action:'collect', savedCount:result.saved.length, skippedCount:result.skipped.length, items:result.saved, skipped:result.skipped });
  }catch(e){ fail(res, 500, 'collect failed', { detail:String(e && e.message || e) }); }
});

app.post('/module/scrap/api/collect-form', (req,res)=>{
  try{
    let payload = {};
    if(req.body && req.body.payload) payload = JSON.parse(req.body.payload);
    else payload = req.body || {};
    const result = savePayload(payload);
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.end(`Glomart 수집 완료\n\n저장: ${result.saved.length}개 / 스킵: ${result.skipped.length}개`);
  }catch(e){
    res.status(500).setHeader('Content-Type','text/html; charset=utf-8');
    res.end('수집 실패\n' + String(e && e.message || e));
  }
});

app.get('/module/scrap/api/cache/search', (req,res)=>{
  try{
    const q = cleanText(req.query.q || req.query.keyword || '');
    const page = Math.max(1, parseInt(req.query.page || '1', 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize || '40', 10) || 40));
    ok(res, { action:'cache.search', source:'cache', keyword:q, cached:true, ...searchCache(q, page, pageSize) });
  }catch(e){ fail(res, 500, 'cache search failed', { detail:String(e && e.message || e) }); }
});

app.get('/module/scrap/api/cache/all', (req,res)=>{
  try{
    const cache = readJson(CACHE_FILE, { items:{}, updatedAt:null });
    const items = Object.values(cache.items || {})
      .sort((a,b) => String(b.collectedAt || '').localeCompare(String(a.collectedAt || '')))
      .map((it, idx) => ({ ...it, rank:idx + 1 }));
    ok(res, { action:'cache.all', source:'cache', cached:true, updatedAt:cache.updatedAt || null, total:items.length, items });
  }catch(e){ fail(res, 500, 'cache all failed', { detail:String(e && e.message || e) }); }
});

app.get('/module/scrap/api/search', (req,res)=>{
  try{
    const q = cleanText(req.query.q || req.query.keyword || '');
    const page = Math.max(1, parseInt(req.query.page || '1', 10) || 1);
    const result = searchCache(q, page, 40);
    ok(res, { action:'search', type:'search', source:'cache', keyword:q, cached:true, ...result, message:result.items.length ? 'OK_CACHE' : 'NO_CACHE_ITEMS' });
  }catch(e){ fail(res, 500, 'search failed', { detail:String(e && e.message || e) }); }
});

app.post('/module/scrap/api/order/create', (req,res)=>{
  try{
    const body = req.body || {};
    const key = cleanText(body.key || body.vendorItemId || body.venderItemId || '');
    const qty = Math.max(1, parseInt(body.qty || '1', 10) || 1);
    const cache = readJson(CACHE_FILE, { items:{} });
    let item = cache.items[key] || Object.values(cache.items || {}).find(x => x.vendorItemId === key || x.key === key);
    if(!item) return fail(res, 404, 'product not found in cache', { key });
    const orders = readJson(ORDER_FILE, { orders:[], updatedAt:null });
    const order = {
      orderId:'GM' + Date.now(),
      createdAt:nowIso(),
      status:'created',
      qty,
      product:{
        key:item.key, title:item.title, image:item.image, priceText:item.priceText,
        deliveryText:item.deliveryText, url:item.url, productId:item.productId,
        itemId:item.itemId, vendorItemId:item.vendorItemId, optionText:item.optionText
      },
      receiver: body.receiver || {},
      buyer: body.buyer || {},
      note: cleanText(body.note || '')
    };
    orders.orders.unshift(order);
    orders.updatedAt = nowIso();
    writeJson(ORDER_FILE, orders);
    ok(res, { action:'order.create', order });
  }catch(e){ fail(res, 500, 'order create failed', { detail:String(e && e.message || e) }); }
});

app.get('/module/scrap/api/order/list', (req,res)=>{
  const orders = readJson(ORDER_FILE, { orders:[] });
  ok(res, { action:'order.list', total:orders.orders.length, orders:orders.orders });
});

/* Compatibility aliases from older sqlite version */
app.get('/db/status', (req,res)=>res.redirect('/api/gm/db/status'));
app.post('/scrap/save', (req,res)=>res.redirect(307, '/api/gm/product/upsert'));
app.post('/scrap/save-batch', async (req,res)=>{
  try{
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if(!items.length) return fail(res, 400, 'items required');
    const results = [];
    for(const it of items){
      const fakeReq = { body: it };
      results.push({ ok:true, item: it.pi_ii_vi || it.vendorItemId || it.product_id || '' });
    }
    ok(res, { received:items.length, note:'Use /api/gm/product/upsert for DB save', results });
  }catch(e){ fail(res, 500, 'batch failed', { detail:String(e && e.message || e) }); }
});

app.listen(PORT, ()=>console.log(`[${VERSION}] listening on ${PORT}`));


