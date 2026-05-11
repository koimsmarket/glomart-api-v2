const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const VERSION = 'V123';
const app = express();
app.use(cors());
app.use(express.json({ limit: '20mb' }));

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  fs.accessSync(dir, fs.constants.W_OK);
  return dir;
}

function resolveDbDir() {
  const candidates = [];
  if (process.env.GLOMART_DB_DIR) candidates.push(process.env.GLOMART_DB_DIR);
  if (process.env.DB_DIR) candidates.push(process.env.DB_DIR);
  candidates.push('/data');
  candidates.push('/tmp/glomart-data');
  for (const dir of candidates) {
    try { return ensureDir(dir); } catch (e) {}
  }
  throw new Error('No writable DB directory found. Set GLOMART_DB_DIR or DB_DIR.');
}

const DB_DIR = resolveDbDir();
const DB_PATH = process.env.GLOMART_DB_PATH || process.env.DB_PATH || path.join(DB_DIR, 'glomart.db');
const BACKUP_DIR = process.env.GLOMART_BACKUP_DIR || path.join(DB_DIR, 'backup');
ensureDir(BACKUP_DIR);

const db = new sqlite3.Database(DB_PATH);
const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema, (err) => {
  if (err) {
    console.error('[DB INIT ERROR]', err);
    process.exit(1);
  }
  console.log('[DB READY]', DB_PATH);
});

function displayPrice(realPrice) {
  const n = Number(realPrice || 0);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round((n * 1.2) / 10) * 10;
}
function asText(v) { return v == null ? '' : String(v); }
function asInt(v, def = null) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : def;
}
function safeJson(v) {
  try { return JSON.stringify(v ?? {}); } catch (e) { return '{}'; }
}
function csvEscape(v) {
  const s = v == null ? '' : String(v);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}
function timestamp() {
  const d = new Date();
  const pad = n => String(n).padStart(2,'0');
  return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function saveProductOption(p, cb) {
  const real = asInt(p.real_price ?? p.realPrice ?? p.price, null);
  const disp = asInt(p.display_price ?? p.displayPrice ?? displayPrice(real), null);
  const productId = asText(p.product_id ?? p.productId);
  const vendorItemId = asText(p.vendor_item_id ?? p.vendorItemId);
  if (!productId && !vendorItemId) return cb(new Error('product_id or vendor_item_id required'));

  const stmt = `INSERT INTO products_options (
    product_id, vendor_item_id, item_id, cp_key, coupang_url, glomart_category_no, cafe24_category_no,
    product_name, option_name, option_group, real_price, display_price, shipping_text, stock_status,
    warning_text, lang, extra_json, raw_json, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  ON CONFLICT(product_id, vendor_item_id) DO UPDATE SET
    item_id=excluded.item_id,
    cp_key=excluded.cp_key,
    coupang_url=excluded.coupang_url,
    glomart_category_no=excluded.glomart_category_no,
    cafe24_category_no=excluded.cafe24_category_no,
    product_name=excluded.product_name,
    option_name=excluded.option_name,
    option_group=excluded.option_group,
    real_price=excluded.real_price,
    display_price=excluded.display_price,
    shipping_text=excluded.shipping_text,
    stock_status=excluded.stock_status,
    warning_text=excluded.warning_text,
    lang=excluded.lang,
    extra_json=excluded.extra_json,
    raw_json=excluded.raw_json,
    updated_at=CURRENT_TIMESTAMP`;

  const vals = [
    productId,
    vendorItemId,
    asText(p.item_id ?? p.itemId),
    asText(p.cp_key ?? p.cpKey),
    asText(p.coupang_url ?? p.coupangUrl),
    asText(p.glomart_category_no ?? p.glomartCategoryNo),
    asText(p.cafe24_category_no ?? p.category_no ?? p.cafe24CategoryNo),
    asText(p.product_name ?? p.productName ?? p.title),
    asText(p.option_name ?? p.optionName),
    asText(p.option_group ?? p.optionGroup),
    real,
    disp,
    asText(p.shipping_text ?? p.shippingText),
    asText(p.stock_status ?? p.stockStatus),
    asText(p.warning_text ?? p.warningText),
    asText(p.lang),
    safeJson(p.extra_json ?? p.extra),
    safeJson(p)
  ];
  db.run(stmt, vals, function(err) {
    if (err) return cb(err);
    cb(null, { id: this.lastID, product_id: productId, vendor_item_id: vendorItemId, real_price: real, display_price: disp });
  });
}

function saveImages(body, cb) {
  const productId = asText(body.product_id ?? body.productId);
  if (!productId) return cb(new Error('product_id required'));
  const cat = asText(body.glomart_category_no ?? body.glomartCategoryNo);
  const images = Array.isArray(body.images) ? body.images : [];
  const stmt = db.prepare(`INSERT OR IGNORE INTO product_images
    (glomart_category_no, product_id, image_type, image_url, sort_order, width, height)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);
  let saved = 0;
  db.serialize(() => {
    for (const img of images) {
      const url = asText(img.image_url ?? img.url);
      if (!url) continue;
      stmt.run([
        asText(img.glomart_category_no ?? img.glomartCategoryNo ?? cat),
        productId,
        asText(img.image_type ?? img.type ?? 'sub'),
        url,
        asInt(img.sort_order ?? img.order, 0),
        asInt(img.width, null),
        asInt(img.height, null)
      ], (err) => { if (!err) saved++; });
    }
    stmt.finalize((err) => cb(err, { product_id: productId, received: images.length, saved }));
  });
}

app.get('/health', (req, res) => res.json({ ok: true, version: VERSION, db_path: DB_PATH, backup_dir: BACKUP_DIR }));

app.get('/db/status', (req, res) => {
  db.all("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name", [], (err, rows) => {
    if (err) return res.status(500).json({ ok: false, error: err.message });
    res.json({ ok: true, version: VERSION, db_path: DB_PATH, tables: rows.map(r => r.name) });
  });
});

app.post('/scrap/save', (req, res) => {
  saveProductOption(req.body || {}, (err, out) => {
    if (err) return res.status(400).json({ ok: false, error: err.message });
    res.json({ ok: true, ...out });
  });
});

app.post('/scrap/save-batch', (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!items.length) return res.status(400).json({ ok:false, error:'items required' });
  const results = [];
  let i = 0, failed = 0;
  function next() {
    if (i >= items.length) return res.json({ ok:true, received:items.length, saved:results.length, failed, results });
    saveProductOption(items[i++], (err, out) => {
      if (err) { failed++; results.push({ ok:false, error:err.message }); }
      else results.push({ ok:true, ...out });
      next();
    });
  }
  next();
});

app.post('/images/save', (req, res) => {
  saveImages(req.body || {}, (err, out) => {
    if (err) return res.status(400).json({ ok:false, error:err.message });
    res.json({ ok:true, ...out });
  });
});

app.post('/stats/log', (req, res) => {
  const p = req.body || {};
  const stmt = `INSERT INTO search_stats
    (raw_keyword, matched_keyword, glomart_category_no, cafe24_category_no, lang, country, action_type, result_count, count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  db.run(stmt, [
    asText(p.raw_keyword ?? p.rawKeyword),
    asText(p.matched_keyword ?? p.matchedKeyword),
    asText(p.glomart_category_no ?? p.glomartCategoryNo),
    asText(p.cafe24_category_no ?? p.category_no ?? p.cafe24CategoryNo),
    asText(p.lang),
    asText(p.country),
    asText(p.action_type ?? p.actionType ?? 'search'),
    asInt(p.result_count ?? p.resultCount, 0),
    asInt(p.count, 1)
  ], function(err) {
    if (err) return res.status(500).json({ ok:false, error:err.message });
    res.json({ ok:true, id:this.lastID });
  });
});

app.get('/products/list', (req, res) => {
  const limit = Math.min(asInt(req.query.limit, 100), 5000);
  const offset = Math.max(asInt(req.query.offset, 0), 0);
  const params = [];
  let where = 'WHERE 1=1';
  if (req.query.product_id) { where += ' AND product_id=?'; params.push(req.query.product_id); }
  if (req.query.vendor_item_id) { where += ' AND vendor_item_id=?'; params.push(req.query.vendor_item_id); }
  if (req.query.category_no) { where += ' AND (glomart_category_no=? OR cafe24_category_no=?)'; params.push(req.query.category_no, req.query.category_no); }
  const sql = `SELECT * FROM products_options ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);
  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ ok:false, error:err.message });
    res.json({ ok:true, rows, limit, offset });
  });
});

app.get('/images/list', (req, res) => {
  const productId = asText(req.query.product_id ?? req.query.productId);
  if (!productId) return res.status(400).json({ ok:false, error:'product_id required' });
  db.all('SELECT * FROM product_images WHERE product_id=? ORDER BY image_type, sort_order, id', [productId], (err, rows) => {
    if (err) return res.status(500).json({ ok:false, error:err.message });
    res.json({ ok:true, product_id:productId, rows });
  });
});

app.get('/stats/top', (req, res) => {
  const limit = Math.min(asInt(req.query.limit, 50), 500);
  const action = asText(req.query.action_type ?? req.query.actionType);
  const params = [];
  let where = 'WHERE 1=1';
  if (action) { where += ' AND action_type=?'; params.push(action); }
  const group = req.query.group === 'keyword' ? 'raw_keyword' : 'glomart_category_no';
  const sql = `SELECT ${group} AS key, action_type, lang, country, SUM(count) AS total_count, SUM(result_count) AS total_results
               FROM search_stats ${where}
               GROUP BY ${group}, action_type, lang, country
               ORDER BY total_count DESC LIMIT ?`;
  params.push(limit);
  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ ok:false, error:err.message });
    res.json({ ok:true, group, rows });
  });
});

app.get('/export/products.csv', (req, res) => {
  db.all('SELECT * FROM products_options ORDER BY updated_at DESC', [], (err, rows) => {
    if (err) return res.status(500).send(err.message);
    const headers = rows.length ? Object.keys(rows[0]) : ['id','product_id','vendor_item_id','product_name','option_name','real_price','display_price'];
    const csv = [headers.join(','), ...rows.map(r => headers.map(h => csvEscape(r[h])).join(','))].join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="glomart_products_options.csv"');
    res.send('\ufeff' + csv);
  });
});

app.get('/export/images.csv', (req, res) => {
  db.all('SELECT * FROM product_images ORDER BY product_id, image_type, sort_order', [], (err, rows) => {
    if (err) return res.status(500).send(err.message);
    const headers = rows.length ? Object.keys(rows[0]) : ['id','product_id','image_type','image_url'];
    const csv = [headers.join(','), ...rows.map(r => headers.map(h => csvEscape(r[h])).join(','))].join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="glomart_product_images.csv"');
    res.send('\ufeff' + csv);
  });
});

app.get('/export/stats.csv', (req, res) => {
  db.all('SELECT * FROM search_stats ORDER BY created_at DESC', [], (err, rows) => {
    if (err) return res.status(500).send(err.message);
    const headers = rows.length ? Object.keys(rows[0]) : ['id','raw_keyword','glomart_category_no','action_type','count'];
    const csv = [headers.join(','), ...rows.map(r => headers.map(h => csvEscape(r[h])).join(','))].join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="glomart_search_stats.csv"');
    res.send('\ufeff' + csv);
  });
});

app.post('/backup/create', (req, res) => {
  const name = `glomart_${timestamp()}.db`;
  const target = path.join(BACKUP_DIR, name);
  try {
    fs.copyFileSync(DB_PATH, target);
    res.json({ ok:true, file:name, path:target });
  } catch (e) {
    res.status(500).json({ ok:false, error:e.message });
  }
});

app.get('/backup/list', (req, res) => {
  try {
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.endsWith('.db'))
      .map(f => {
        const full = path.join(BACKUP_DIR, f);
        const st = fs.statSync(full);
        return { file:f, size:st.size, mtime:st.mtime };
      })
      .sort((a,b) => String(b.file).localeCompare(String(a.file)));
    res.json({ ok:true, backup_dir:BACKUP_DIR, files });
  } catch (e) {
    res.status(500).json({ ok:false, error:e.message });
  }
});

app.get('/backup/download/:file', (req, res) => {
  const file = path.basename(req.params.file || '');
  if (!file.endsWith('.db')) return res.status(400).send('invalid file');
  const full = path.join(BACKUP_DIR, file);
  if (!fs.existsSync(full)) return res.status(404).send('not found');
  res.download(full, file);
});

app.get('/backup/download-latest', (req, res) => {
  try {
    const files = fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith('.db')).sort().reverse();
    if (!files.length) return res.status(404).send('no backup');
    const file = files[0];
    res.download(path.join(BACKUP_DIR, file), file);
  } catch (e) {
    res.status(500).send(e.message);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`[GLOMART API ${VERSION}] listening on ${PORT}, DB=${DB_PATH}`));
