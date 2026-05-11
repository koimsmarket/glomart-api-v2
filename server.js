/* GLOMART Cloudtype Server V121
 * 1차 구축: 상품+옵션 통합 / 이미지 별도 / 검색·조회 집계
 */
const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'glomart.sqlite');
const SCHEMA_PATH = process.env.SCHEMA_PATH || path.join(__dirname, 'schema.sql');
const VERSION = 'V121_CLOUDTYPE_SERVER_FINAL_20260511';

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

app.use(cors({ origin: true, credentials: false }));
app.use(express.json({ limit: process.env.JSON_LIMIT || '8mb' }));

const db = new sqlite3.Database(DB_PATH);

function exec(sql) {
  return new Promise((resolve, reject) => db.exec(sql, (err) => err ? reject(err) : resolve()));
}
function run(sql, params = []) {
  return new Promise((resolve, reject) => db.run(sql, params, function(err) {
    err ? reject(err) : resolve(this);
  }));
}
function all(sql, params = []) {
  return new Promise((resolve, reject) => db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows)));
}
function get(sql, params = []) {
  return new Promise((resolve, reject) => db.get(sql, params, (err, row) => err ? reject(err) : resolve(row)));
}
function clean(v) {
  return String(v ?? '').replace(/[\u00A0\u200B-\u200D\uFEFF]/g, ' ').replace(/\s+/g, ' ').trim();
}
function num(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v) : 0;
  return Number(String(v ?? '').replace(/[^\d.-]/g, '')) || 0;
}
function calcDisplayPrice(realPrice) {
  const n = num(realPrice);
  return n ? Math.round((n * 1.2) / 10) * 10 : 0;
}
function today() {
  return new Date().toISOString().slice(0, 10);
}

async function initDb() {
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
  await exec(schema);
  console.log('[GLOMART DB READY]', DB_PATH);
}

function normalizeProductRow(r = {}, inherited = {}) {
  const productId = clean(r.productId || r.product_id || inherited.productId || inherited.product_id);
  const vendorItemId = clean(r.vendorItemId || r.vendor_item_id || inherited.vendorItemId || inherited.vendor_item_id);
  const real = num(r.realPrice || r.real_price || r.price || r.priceText || r.price_text);
  const display = num(r.displayPrice || r.display_price) || calcDisplayPrice(real);
  return {
    productId,
    vendorItemId,
    itemId: clean(r.itemId || r.item_id || inherited.itemId || inherited.item_id),
    cpKey: clean(r.cpKey || r.cp_key || inherited.cpKey || inherited.cp_key),
    coupangUrl: clean(r.coupangUrl || r.coupang_url || inherited.coupangUrl || inherited.coupang_url),
    glomartCategoryNo: clean(r.glomartCategoryNo || r.glomart_category_no || inherited.glomartCategoryNo || inherited.glomart_category_no),
    cafe24CategoryNo: clean(r.cafe24CategoryNo || r.cafe24_category_no || r.categoryNo || r.category_no || inherited.cafe24CategoryNo || inherited.cafe24_category_no || inherited.categoryNo || inherited.category_no),
    cafe24ProductNo: clean(r.cafe24ProductNo || r.cafe24_product_no || r.productNo || r.product_no || inherited.cafe24ProductNo || inherited.cafe24_product_no),
    productName: clean(r.productName || r.product_name || r.title || inherited.productName || inherited.product_name),
    optionGroup: clean(r.optionGroup || r.option_group),
    optionName: clean(r.optionName || r.option_name || r.option),
    optionLabel: clean(r.optionLabel || r.option_label),
    realPrice: real,
    displayPrice: display,
    priceText: clean(r.priceText || r.price_text),
    unitPriceText: clean(r.unitPriceText || r.unit_price_text),
    shippingText: clean(r.shippingText || r.shipping_text || r.deliveryText || r.delivery_text),
    deliveryType: clean(r.deliveryType || r.delivery_type),
    stockStatus: clean(r.stockStatus || r.stock_status),
    warningText: clean(r.warningText || r.warning_text),
    lang: clean(r.lang || inherited.lang),
    country: clean(r.country || inherited.country),
    source: clean(r.source || inherited.source),
    collectVersion: clean(r.collectVersion || r.collect_version || inherited.collectVersion || inherited.collect_version || VERSION)
  };
}

async function upsertProductOption(raw, inherited = {}) {
  const r = normalizeProductRow(raw, inherited);
  if (!r.productId || !r.vendorItemId) return { skipped: true, reason: 'missing productId/vendorItemId' };
  await run(`
    INSERT INTO product_options (
      product_id, vendor_item_id, item_id, cp_key, coupang_url,
      glomart_category_no, cafe24_category_no, cafe24_product_no,
      product_name, option_group, option_name, option_label,
      real_price, display_price, price_text, unit_price_text,
      shipping_text, delivery_type, stock_status, warning_text,
      lang, country, source, collect_version, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(product_id, vendor_item_id) DO UPDATE SET
      item_id=COALESCE(NULLIF(excluded.item_id,''), product_options.item_id),
      cp_key=COALESCE(NULLIF(excluded.cp_key,''), product_options.cp_key),
      coupang_url=COALESCE(NULLIF(excluded.coupang_url,''), product_options.coupang_url),
      glomart_category_no=COALESCE(NULLIF(excluded.glomart_category_no,''), product_options.glomart_category_no),
      cafe24_category_no=COALESCE(NULLIF(excluded.cafe24_category_no,''), product_options.cafe24_category_no),
      cafe24_product_no=COALESCE(NULLIF(excluded.cafe24_product_no,''), product_options.cafe24_product_no),
      product_name=COALESCE(NULLIF(excluded.product_name,''), product_options.product_name),
      option_group=COALESCE(NULLIF(excluded.option_group,''), product_options.option_group),
      option_name=COALESCE(NULLIF(excluded.option_name,''), product_options.option_name),
      option_label=COALESCE(NULLIF(excluded.option_label,''), product_options.option_label),
      real_price=CASE WHEN excluded.real_price>0 THEN excluded.real_price ELSE product_options.real_price END,
      display_price=CASE WHEN excluded.display_price>0 THEN excluded.display_price ELSE product_options.display_price END,
      price_text=COALESCE(NULLIF(excluded.price_text,''), product_options.price_text),
      unit_price_text=COALESCE(NULLIF(excluded.unit_price_text,''), product_options.unit_price_text),
      shipping_text=COALESCE(NULLIF(excluded.shipping_text,''), product_options.shipping_text),
      delivery_type=COALESCE(NULLIF(excluded.delivery_type,''), product_options.delivery_type),
      stock_status=COALESCE(NULLIF(excluded.stock_status,''), product_options.stock_status),
      warning_text=COALESCE(NULLIF(excluded.warning_text,''), product_options.warning_text),
      lang=COALESCE(NULLIF(excluded.lang,''), product_options.lang),
      country=COALESCE(NULLIF(excluded.country,''), product_options.country),
      source=COALESCE(NULLIF(excluded.source,''), product_options.source),
      collect_version=excluded.collect_version,
      updated_at=CURRENT_TIMESTAMP
  `, [
    r.productId, r.vendorItemId, r.itemId, r.cpKey, r.coupangUrl,
    r.glomartCategoryNo, r.cafe24CategoryNo, r.cafe24ProductNo,
    r.productName, r.optionGroup, r.optionName, r.optionLabel,
    r.realPrice, r.displayPrice, r.priceText, r.unitPriceText,
    r.shippingText, r.deliveryType, r.stockStatus, r.warningText,
    r.lang, r.country, r.source, r.collectVersion
  ]);
  return { ok: true, productId: r.productId, vendorItemId: r.vendorItemId };
}

function normalizeImageRow(r = {}, inherited = {}) {
  return {
    glomartCategoryNo: clean(r.glomartCategoryNo || r.glomart_category_no || inherited.glomartCategoryNo || inherited.glomart_category_no),
    cafe24CategoryNo: clean(r.cafe24CategoryNo || r.cafe24_category_no || r.categoryNo || r.category_no || inherited.cafe24CategoryNo || inherited.cafe24_category_no || inherited.categoryNo || inherited.category_no),
    productId: clean(r.productId || r.product_id || inherited.productId || inherited.product_id),
    imageType: clean(r.imageType || r.image_type || r.type || 'sub'),
    imageUrl: clean(r.imageUrl || r.image_url || r.url || r.src),
    sortOrder: num(r.sortOrder || r.sort_order),
    width: num(r.width),
    height: num(r.height),
    source: clean(r.source || inherited.source),
    collectVersion: clean(r.collectVersion || r.collect_version || inherited.collectVersion || inherited.collect_version || VERSION)
  };
}

async function upsertImage(raw, inherited = {}) {
  const r = normalizeImageRow(raw, inherited);
  if (!r.productId || !r.imageUrl || !['main', 'sub', 'detail'].includes(r.imageType)) {
    return { skipped: true, reason: 'invalid image row' };
  }
  await run(`
    INSERT INTO product_images (
      glomart_category_no, cafe24_category_no, product_id, image_type, image_url,
      sort_order, width, height, source, collect_version, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(product_id, image_type, image_url) DO UPDATE SET
      glomart_category_no=COALESCE(NULLIF(excluded.glomart_category_no,''), product_images.glomart_category_no),
      cafe24_category_no=COALESCE(NULLIF(excluded.cafe24_category_no,''), product_images.cafe24_category_no),
      sort_order=excluded.sort_order,
      width=excluded.width,
      height=excluded.height,
      source=COALESCE(NULLIF(excluded.source,''), product_images.source),
      collect_version=excluded.collect_version,
      updated_at=CURRENT_TIMESTAMP
  `, [
    r.glomartCategoryNo, r.cafe24CategoryNo, r.productId, r.imageType, r.imageUrl,
    r.sortOrder, r.width, r.height, r.source, r.collectVersion
  ]);
  return { ok: true, productId: r.productId, imageType: r.imageType };
}

async function addCategoryStat({ glomartCategoryNo, cafe24CategoryNo, lang, search = 0, view = 0, click = 0 }) {
  await run(`
    INSERT INTO category_daily_stats
      (stat_date, glomart_category_no, cafe24_category_no, lang, search_count, view_count, click_count, updated_at)
    VALUES (?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(stat_date, glomart_category_no, cafe24_category_no, lang) DO UPDATE SET
      search_count=search_count+excluded.search_count,
      view_count=view_count+excluded.view_count,
      click_count=click_count+excluded.click_count,
      updated_at=CURRENT_TIMESTAMP
  `, [today(), clean(glomartCategoryNo), clean(cafe24CategoryNo), clean(lang), num(search), num(view), num(click)]);
}

app.get(['/health', '/module/scrap/api/health'], async (req, res) => {
  const counts = {};
  for (const table of ['product_options', 'product_images', 'search_logs', 'product_views', 'category_daily_stats']) {
    const row = await get(`SELECT COUNT(*) AS cnt FROM ${table}`);
    counts[table] = row.cnt;
  }
  res.json({ ok: true, version: VERSION, dbPath: DB_PATH, counts });
});

app.post(['/scrap/collect', '/module/scrap/api/collect'], async (req, res) => {
  try {
    const body = req.body || {};
    const inherited = {
      glomartCategoryNo: body.glomartCategoryNo || body.glomart_category_no,
      cafe24CategoryNo: body.cafe24CategoryNo || body.cafe24_category_no || body.categoryNo || body.category_no,
      productId: body.productId || body.product_id,
      lang: body.lang,
      country: body.country,
      source: body.source,
      collectVersion: body.collectVersion || body.collect_version || VERSION
    };
    const productRows = body.productOptions || body.products || body.items || [];
    const imageRows = body.images || [];
    let productSaved = 0, imageSaved = 0, productSkipped = 0, imageSkipped = 0;
    for (const r of productRows) {
      const ret = await upsertProductOption(r, inherited);
      ret.ok ? productSaved++ : productSkipped++;
    }
    for (const r of imageRows) {
      const ret = await upsertImage(r, inherited);
      ret.ok ? imageSaved++ : imageSkipped++;
    }
    if (body.rawKeyword || body.keyword) {
      await run(`INSERT INTO search_logs
        (raw_keyword, normalized_keyword, matched_keyword, glomart_category_no, cafe24_category_no, lang, country, page_url, result_count, source)
        VALUES (?,?,?,?,?,?,?,?,?,?)`, [
        clean(body.rawKeyword || body.keyword), clean(body.normalizedKeyword), clean(body.matchedKeyword),
        clean(inherited.glomartCategoryNo), clean(inherited.cafe24CategoryNo), clean(body.lang), clean(body.country),
        clean(body.pageUrl), num(body.resultCount || productRows.length), clean(body.source)
      ]);
      await addCategoryStat({ glomartCategoryNo: inherited.glomartCategoryNo, cafe24CategoryNo: inherited.cafe24CategoryNo, lang: body.lang, search: 1 });
    }
    res.json({ ok: true, version: VERSION, productSaved, productSkipped, imageSaved, imageSkipped });
  } catch (err) {
    console.error('[collect error]', err);
    res.status(500).json({ ok: false, error: String(err.message || err) });
  }
});

app.post(['/scrap/images', '/module/scrap/api/images'], async (req, res) => {
  try {
    const body = req.body || {};
    const rows = body.images || [];
    let saved = 0, skipped = 0;
    for (const r of rows) {
      const ret = await upsertImage(r, body);
      ret.ok ? saved++ : skipped++;
    }
    res.json({ ok: true, saved, skipped });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err.message || err) });
  }
});

app.post(['/stats/search', '/module/scrap/api/stats/search'], async (req, res) => {
  try {
    const b = req.body || {};
    await run(`INSERT INTO search_logs
      (raw_keyword, normalized_keyword, matched_keyword, glomart_category_no, cafe24_category_no, lang, country, page_url, result_count, source)
      VALUES (?,?,?,?,?,?,?,?,?,?)`, [
      clean(b.rawKeyword || b.keyword), clean(b.normalizedKeyword), clean(b.matchedKeyword), clean(b.glomartCategoryNo),
      clean(b.cafe24CategoryNo || b.categoryNo), clean(b.lang), clean(b.country), clean(b.pageUrl), num(b.resultCount), clean(b.source)
    ]);
    await addCategoryStat({ glomartCategoryNo: b.glomartCategoryNo, cafe24CategoryNo: b.cafe24CategoryNo || b.categoryNo, lang: b.lang, search: 1 });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err.message || err) });
  }
});

app.post(['/stats/view', '/scrap/view', '/module/scrap/api/view'], async (req, res) => {
  try {
    const b = req.body || {};
    await run(`INSERT INTO product_views
      (product_id, vendor_item_id, cp_key, glomart_category_no, cafe24_category_no, lang, country, source, page_url)
      VALUES (?,?,?,?,?,?,?,?,?)`, [
      clean(b.productId), clean(b.vendorItemId), clean(b.cpKey), clean(b.glomartCategoryNo), clean(b.cafe24CategoryNo || b.categoryNo),
      clean(b.lang), clean(b.country), clean(b.source), clean(b.pageUrl)
    ]);
    await addCategoryStat({ glomartCategoryNo: b.glomartCategoryNo, cafe24CategoryNo: b.cafe24CategoryNo || b.categoryNo, lang: b.lang, view: 1 });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err.message || err) });
  }
});

app.post(['/stats/click', '/module/scrap/api/stats/click'], async (req, res) => {
  try {
    const b = req.body || {};
    await addCategoryStat({ glomartCategoryNo: b.glomartCategoryNo, cafe24CategoryNo: b.cafe24CategoryNo || b.categoryNo, lang: b.lang, click: 1 });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err.message || err) });
  }
});

app.get(['/scrap/product/:productId', '/module/scrap/api/product/:productId'], async (req, res) => {
  try {
    const productId = clean(req.params.productId);
    const options = await all(`SELECT * FROM product_options WHERE product_id=? ORDER BY display_price ASC, vendor_item_id ASC`, [productId]);
    const images = await all(`SELECT * FROM product_images WHERE product_id=? ORDER BY CASE image_type WHEN 'main' THEN 0 WHEN 'sub' THEN 1 ELSE 2 END, sort_order ASC, id ASC`, [productId]);
    res.json({ ok: true, productId, options, images });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err.message || err) });
  }
});

app.get(['/scrap/vendor/:vendorItemId', '/module/scrap/api/vendor/:vendorItemId'], async (req, res) => {
  try {
    const vendorItemId = clean(req.params.vendorItemId);
    const option = await get(`SELECT * FROM product_options WHERE vendor_item_id=?`, [vendorItemId]);
    const images = option ? await all(`SELECT * FROM product_images WHERE product_id=? ORDER BY CASE image_type WHEN 'main' THEN 0 WHEN 'sub' THEN 1 ELSE 2 END, sort_order ASC`, [option.product_id]) : [];
    res.json({ ok: true, vendorItemId, option, images });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err.message || err) });
  }
});

app.get(['/stats/categories', '/module/scrap/api/stats/categories'], async (req, res) => {
  try {
    const limit = Math.min(num(req.query.limit) || 200, 1000);
    const rows = await all(`SELECT * FROM category_daily_stats ORDER BY stat_date DESC, search_count DESC, view_count DESC, click_count DESC LIMIT ?`, [limit]);
    res.json({ ok: true, rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err.message || err) });
  }
});

app.get(['/stats/searches', '/module/scrap/api/stats/searches'], async (req, res) => {
  try {
    const rows = await all(`
      SELECT raw_keyword, normalized_keyword, matched_keyword, glomart_category_no, cafe24_category_no, lang, country,
             COUNT(*) AS search_count, SUM(result_count) AS total_result_count, MAX(created_at) AS last_at
      FROM search_logs
      GROUP BY raw_keyword, normalized_keyword, matched_keyword, glomart_category_no, cafe24_category_no, lang, country
      ORDER BY search_count DESC, last_at DESC
      LIMIT 500
    `);
    res.json({ ok: true, rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err.message || err) });
  }
});

app.use((req, res) => res.status(404).json({ ok: false, error: 'not found', path: req.path }));

initDb().then(() => {
  app.listen(PORT, () => console.log(`[GLOMART ${VERSION}] listening on ${PORT}`));
}).catch((err) => {
  console.error('[GLOMART INIT ERROR]', err);
  process.exit(1);
});
