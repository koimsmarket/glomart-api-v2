/*
 * GLOMART Cloudtype Client Collect + Order Server V6
 *
 * 목적:
 * - 서버가 쿠팡을 직접 긁지 않음
 * - 사용자/관리자 기기에서 수집된 상품 정보를 POST /module/scrap/api/collect 로 받음
 * - 서버 JSON 캐시에 저장
 * - 검색/상세는 캐시에서 제공
 * - 주문은 서버 내부 주문서로 생성
 */

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const VERSION = 'GLOMART_CLIENT_COLLECT_ORDER_V6_20260506';

const DATA_DIR = path.join(__dirname, 'data');
const CACHE_FILE = path.join(DATA_DIR, 'coupang_cache.json');
const ORDER_FILE = path.join(DATA_DIR, 'orders.json');

fs.mkdirSync(DATA_DIR, { recursive: true });

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));
app.use(cors({ origin: true, credentials: false }));
app.use('/public', express.static(path.join(__dirname, 'public')));

function nowIso() {
  return new Date().toISOString();
}

function cleanText(v) {
  return String(v || '')
    .replace(/[\u00A0\u200B-\u200D\uFEFF]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function ok(res, data) {
  res.json({ ok: true, version: VERSION, ...data });
}

function fail(res, status, message, extra = {}) {
  res.status(status).json({ ok: false, version: VERSION, error: message, ...extra });
}

function normalizeUrl(url) {
  url = cleanText(url);
  if (url.startsWith('//')) return 'https:' + url;
  return url;
}

function idsFromUrl(url) {
  const s = String(url || '');
  const out = { productId: '', itemId: '', vendorItemId: '' };
  let m = s.match(/\/vp\/products\/(\d+)/);
  if (m) out.productId = m[1];
  m = s.match(/[?&]itemId=(\d+)/);
  if (m) out.itemId = m[1];
  m = s.match(/[?&]vendorItemId=(\d+)/);
  if (m) out.vendorItemId = m[1];
  return out;
}

function makeKey(item) {
  return cleanText(item.vendorItemId) ||
    [cleanText(item.productId), cleanText(item.itemId)].filter(Boolean).join('_') ||
    cleanText(item.url) ||
    cleanText(item.title);
}

function normalizeItem(raw) {
  const url = normalizeUrl(raw.url || raw.href || raw.productUrl || '');
  const ids = idsFromUrl(url);
  const productId = cleanText(raw.productId || ids.productId);
  const itemId = cleanText(raw.itemId || ids.itemId);
  const vendorItemId = cleanText(raw.vendorItemId || raw.venderItemId || ids.vendorItemId);

  const item = {
    key: '',
    source: cleanText(raw.source || 'coupang'),
    collectedAt: nowIso(),
    title: cleanText(raw.title || raw.name || raw.productName),
    image: normalizeUrl(raw.image || raw.imageUrl || raw.thumbnail || ''),
    priceText: cleanText(raw.priceText || raw.price || ''),
    deliveryText: cleanText(raw.deliveryText || raw.delivery || ''),
    url,
    productId,
    itemId,
    vendorItemId,
    optionText: cleanText(raw.optionText || raw.option || ''),
    stockText: cleanText(raw.stockText || raw.stock || ''),
    raw: raw.raw || null
  };

  item.key = makeKey(item);
  return item;
}

function searchCache(keyword, page = 1, pageSize = 40) {
  keyword = cleanText(keyword).toLowerCase();
  const cache = readJson(CACHE_FILE, { items: {}, updatedAt: null });
  let list = Object.values(cache.items || {});

  if (keyword) {
    list = list.filter(it => {
      const hay = [
        it.title,
        it.optionText,
        it.priceText,
        it.deliveryText,
        it.productId,
        it.itemId,
        it.vendorItemId,
        it.url
      ].join(' ').toLowerCase();
      return hay.includes(keyword);
    });
  }

  list.sort((a, b) => String(b.collectedAt || '').localeCompare(String(a.collectedAt || '')));

  const total = list.length;
  const start = (page - 1) * pageSize;
  const items = list.slice(start, start + pageSize).map((it, idx) => ({
    ...it,
    rank: start + idx + 1
  }));

  return {
    total,
    page,
    pageSize,
    nextPage: start + pageSize < total ? page + 1 : null,
    prevPage: page > 1 ? page - 1 : null,
    items
  };
}

/* -------------------------
 * Routes
 * ------------------------- */

app.get('/', (req, res) => {
  ok(res, {
    service: 'glomart-client-collect-order',
    routes: [
      'GET /health',
      'POST /module/scrap/api/collect',
      'GET /module/scrap/api/cache/search?q=keyword&page=1',
      'GET /module/scrap/api/cache/detail?vendorItemId=',
      'POST /module/scrap/api/order/create',
      'GET /module/scrap/api/order/list',
      'GET /public/collector_bookmarklet.html',
      'GET /public/gm_coupang_user_collector.js'
    ]
  });
});

app.get('/health', (req, res) => {
  ok(res, { status: 'running' });
});

/*
 * 사용자 기기 수집 정보 저장
 * body:
 * {
 *   items:[{title,image,priceText,deliveryText,url,productId,itemId,vendorItemId}]
 * }
 */
app.post('/module/scrap/api/collect', (req, res) => {
  try {
    const body = req.body || {};
    const inputItems = Array.isArray(body.items) ? body.items : [body.item || body];

    const cache = readJson(CACHE_FILE, { items: {}, updatedAt: null });
    cache.items = cache.items || {};

    const saved = [];
    const skipped = [];

    for (const raw of inputItems) {
      const item = normalizeItem(raw);
      if (!item.key) {
        skipped.push({ reason: 'missing key', raw });
        continue;
      }
      cache.items[item.key] = {
        ...(cache.items[item.key] || {}),
        ...item,
        collectedAt: nowIso()
      };
      saved.push(cache.items[item.key]);
    }

    cache.updatedAt = nowIso();
    writeJson(CACHE_FILE, cache);

    ok(res, {
      savedCount: saved.length,
      skippedCount: skipped.length,
      items: saved,
      skipped
    });
  } catch (e) {
    fail(res, 500, 'collect failed', { detail: String(e && e.message || e) });
  }
});

/*
 * 캐시 검색
 */
app.get('/module/scrap/api/cache/search', (req, res) => {
  try {
    const q = cleanText(req.query.q || req.query.keyword || '');
    const page = Math.max(1, parseInt(req.query.page || '1', 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize || '40', 10) || 40));

    const result = searchCache(q, page, pageSize);
    ok(res, {
      action: 'cache.search',
      source: 'cache',
      keyword: q,
      ...result
    });
  } catch (e) {
    fail(res, 500, 'cache search failed', { detail: String(e && e.message || e) });
  }
});

/*
 * 기존 search 호환 경로도 캐시 검색으로 연결
 */
app.get('/module/scrap/api/search', (req, res) => {
  try {
    const q = cleanText(req.query.q || req.query.keyword || '');
    const page = Math.max(1, parseInt(req.query.page || '1', 10) || 1);
    const result = searchCache(q, page, 40);

    ok(res, {
      action: 'search',
      type: 'search',
      source: 'cache',
      keyword: q,
      cached: true,
      ...result,
      message: result.items.length ? 'OK_CACHE' : 'NO_CACHE_ITEMS'
    });
  } catch (e) {
    fail(res, 500, 'search failed', { detail: String(e && e.message || e) });
  }
});

/*
 * 캐시 상세
 */
app.get('/module/scrap/api/cache/detail', (req, res) => {
  try {
    const vendorItemId = cleanText(req.query.vendorItemId || req.query.venderItemId || '');
    const productId = cleanText(req.query.productId || '');
    const itemId = cleanText(req.query.itemId || '');
    const key = vendorItemId || [productId, itemId].filter(Boolean).join('_') || cleanText(req.query.key || '');

    const cache = readJson(CACHE_FILE, { items: {} });
    let item = cache.items[key];

    if (!item && vendorItemId) {
      item = Object.values(cache.items || {}).find(x => x.vendorItemId === vendorItemId);
    }

    if (!item) return fail(res, 404, 'not found', { key });

    ok(res, {
      action: 'cache.detail',
      product: item
    });
  } catch (e) {
    fail(res, 500, 'cache detail failed', { detail: String(e && e.message || e) });
  }
});

/*
 * 내부 주문서 생성
 * 쿠팡 자동 주문 아님.
 */
app.post('/module/scrap/api/order/create', (req, res) => {
  try {
    const body = req.body || {};
    const key = cleanText(body.key || body.vendorItemId || body.venderItemId || '');
    const qty = Math.max(1, parseInt(body.qty || '1', 10) || 1);

    const cache = readJson(CACHE_FILE, { items: {} });
    let item = cache.items[key];

    if (!item && key) {
      item = Object.values(cache.items || {}).find(x => x.vendorItemId === key || x.key === key);
    }

    if (!item) {
      return fail(res, 404, 'product not found in cache', { key });
    }

    const orders = readJson(ORDER_FILE, { orders: [], updatedAt: null });

    const order = {
      orderId: 'GM' + Date.now(),
      createdAt: nowIso(),
      status: 'created',
      qty,
      product: {
        key: item.key,
        title: item.title,
        image: item.image,
        priceText: item.priceText,
        deliveryText: item.deliveryText,
        url: item.url,
        productId: item.productId,
        itemId: item.itemId,
        vendorItemId: item.vendorItemId,
        optionText: item.optionText
      },
      receiver: {
        name: cleanText(body.receiver && body.receiver.name),
        phone: cleanText(body.receiver && body.receiver.phone),
        address1: cleanText(body.receiver && body.receiver.address1),
        address2: cleanText(body.receiver && body.receiver.address2),
        memo: cleanText(body.receiver && body.receiver.memo)
      },
      buyer: {
        name: cleanText(body.buyer && body.buyer.name),
        phone: cleanText(body.buyer && body.buyer.phone),
        email: cleanText(body.buyer && body.buyer.email)
      },
      note: cleanText(body.note || '')
    };

    orders.orders.unshift(order);
    orders.updatedAt = nowIso();
    writeJson(ORDER_FILE, orders);

    ok(res, {
      action: 'order.create',
      order
    });
  } catch (e) {
    fail(res, 500, 'order create failed', { detail: String(e && e.message || e) });
  }
});

app.get('/module/scrap/api/order/list', (req, res) => {
  const orders = readJson(ORDER_FILE, { orders: [] });
  ok(res, {
    action: 'order.list',
    total: orders.orders.length,
    orders: orders.orders
  });
});

app.listen(PORT, () => console.log(`[${VERSION}] listening on ${PORT}`));
