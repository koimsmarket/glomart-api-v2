const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  fs.accessSync(dir, fs.constants.W_OK);
  return dir;
}

function resolveDbDir() {
  const candidates = [];
  if (process.env.GLOMART_DB_DIR) candidates.push(process.env.GLOMART_DB_DIR);
  if (process.env.DB_DIR) candidates.push(process.env.DB_DIR);
  // Cloudtype persistent disk should be mounted here if configured.
  candidates.push('/data');
  // Safe fallback. This works without disk, but data can reset on redeploy/restart.
  candidates.push('/tmp/glomart-data');

  for (const dir of candidates) {
    try { return ensureDir(dir); } catch (e) {}
  }
  throw new Error('No writable DB directory found. Set GLOMART_DB_DIR to a writable path.');
}

const DB_DIR = resolveDbDir();
const DB_PATH = process.env.GLOMART_DB_PATH || process.env.DB_PATH || path.join(DB_DIR, 'glomart.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

const db = new sqlite3.Database(DB_PATH);
const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
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

app.get('/health', (req, res) => {
  res.json({ ok: true, version: 'V122', db_path: DB_PATH });
});

app.get('/db/status', (req, res) => {
  db.all("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name", [], (err, rows) => {
    if (err) return res.status(500).json({ ok: false, error: err.message });
    res.json({ ok: true, db_path: DB_PATH, tables: rows.map(r => r.name) });
  });
});

app.post('/scrap/save', (req, res) => {
  const p = req.body || {};
  const real = Number(p.real_price ?? p.realPrice ?? p.price ?? 0) || null;
  const disp = Number(p.display_price ?? p.displayPrice ?? displayPrice(real)) || null;
  const productId = String(p.product_id ?? p.productId ?? '');
  const vendorItemId = String(p.vendor_item_id ?? p.vendorItemId ?? '');
  if (!productId && !vendorItemId) return res.status(400).json({ ok:false, error:'product_id or vendor_item_id required' });

  const stmt = `INSERT INTO products_options (
    product_id, vendor_item_id, item_id, cp_key, coupang_url, glomart_category_no, cafe24_category_no,
    product_name, option_name, option_group, real_price, display_price, shipping_text, stock_status,
    warning_text, lang, extra_json, raw_json, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  ON CONFLICT(product_id, vendor_item_id) DO UPDATE SET
    item_id=excluded.item_id, cp_key=excluded.cp_key, coupang_url=excluded.coupang_url,
    glomart_category_no=excluded.glomart_category_no, cafe24_category_no=excluded.cafe24_category_no,
    product_name=excluded.product_name, option_name=excluded.option_name, option_group=excluded.option_group,
    real_price=excluded.real_price, display_price=excluded.display_price, shipping_text=excluded.shipping_text,
    stock_status=excluded.stock_status, warning_text=excluded.warning_text, lang=excluded.lang,
    extra_json=excluded.extra_json, raw_json=excluded.raw_json, updated_at=CURRENT_TIMESTAMP`;

  db.run(stmt, [
    productId, vendorItemId, p.item_id ?? p.itemId ?? '', p.cp_key ?? p.cpKey ?? '', p.coupang_url ?? p.coupangUrl ?? '',
    p.glomart_category_no ?? p.glomartCategoryNo ?? '', p.cafe24_category_no ?? p.category_no ?? '',
    p.product_name ?? p.productName ?? p.title ?? '', p.option_name ?? p.optionName ?? '', p.option_group ?? p.optionGroup ?? '',
    real, disp, p.shipping_text ?? p.shippingText ?? '', p.stock_status ?? p.stockStatus ?? '',
    p.warning_text ?? p.warningText ?? '', p.lang ?? '', JSON.stringify(p.extra_json ?? p.extra ?? {}), JSON.stringify(p)
  ], function(err) {
    if (err) return res.status(500).json({ ok:false, error:err.message });
    res.json({ ok:true, id:this.lastID, product_id:productId, vendor_item_id:vendorItemId, display_price:disp });
  });
});

app.post('/images/save', (req, res) => {
  const body = req.body || {};
  const productId = String(body.product_id ?? body.productId ?? '');
  const cat = body.glomart_category_no ?? body.glomartCategoryNo ?? '';
  const images = Array.isArray(body.images) ? body.images : [];
  if (!productId) return res.status(400).json({ ok:false, error:'product_id required' });
  const stmt = db.prepare(`INSERT OR IGNORE INTO product_images
    (glomart_category_no, product_id, image_type, image_url, sort_order, width, height)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);
  let saved = 0;
  db.serialize(() => {
    for (const img of images) {
      const url = img.image_url ?? img.url ?? '';
      if (!url) continue;
      stmt.run([cat, productId, img.image_type ?? img.type ?? 'sub', url, img.sort_order ?? img.order ?? 0, img.width ?? null, img.height ?? null], (err) => {
        if (!err) saved++;
      });
    }
    stmt.finalize((err) => {
      if (err) return res.status(500).json({ ok:false, error:err.message });
      res.json({ ok:true, product_id:productId, received:images.length, saved });
    });
  });
});

app.post('/stats/log', (req, res) => {
  const p = req.body || {};
  const stmt = `INSERT INTO search_stats
    (raw_keyword, matched_keyword, glomart_category_no, cafe24_category_no, lang, country, action_type, result_count, count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  db.run(stmt, [
    p.raw_keyword ?? p.rawKeyword ?? '', p.matched_keyword ?? p.matchedKeyword ?? '',
    p.glomart_category_no ?? p.glomartCategoryNo ?? '', p.cafe24_category_no ?? p.category_no ?? '',
    p.lang ?? '', p.country ?? '', p.action_type ?? p.actionType ?? 'search', Number(p.result_count ?? p.resultCount ?? 0), Number(p.count ?? 1)
  ], function(err) {
    if (err) return res.status(500).json({ ok:false, error:err.message });
    res.json({ ok:true, id:this.lastID });
  });
});

app.get('/export/products.json', (req, res) => {
  db.all('SELECT * FROM products_options ORDER BY updated_at DESC LIMIT 5000', [], (err, rows) => {
    if (err) return res.status(500).json({ ok:false, error:err.message });
    res.json({ ok:true, rows });
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`[GLOMART API V122] listening on ${PORT}, DB=${DB_PATH}`));
