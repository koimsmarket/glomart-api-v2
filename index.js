
const express = require('express');
const cors = require('cors');
const { chromium } = require('playwright');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const VERSION = 'GLOMART_CLOUDTYPE_SCRAP_SWITCH_V5_DOM_DEBUG_20260506';

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cors({ origin: true, credentials: false }));

let browserPromise = null;

function cleanText(v) {
  return String(v || '').replace(/[\u00A0\u200B-\u200D\uFEFF]/g, ' ').replace(/\s+/g, ' ').trim();
}
function normalizeKeyword(q) {
  q = cleanText(q).replace(/[，、؛;|]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^[-–—]+\s*/, '').trim();
  if ((q.startsWith('(') && q.endsWith(')')) || (q.startsWith('[') && q.endsWith(']'))) q = q.slice(1, -1).trim();
  return q;
}
function intParam(v, fallback) {
  const n = parseInt(String(v || ''), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
function ok(res, data) { res.json({ ok: true, version: VERSION, ...data }); }
function fail(res, status, message, extra = {}) { res.status(status).json({ ok: false, version: VERSION, error: message, ...extra }); }
function analyzeInput(q) { return { mode: 'keyword', keyword: normalizeKeyword(q) }; }
function selectTarget(input) { return { target: 'coupang', mode: input.mode, keyword: input.keyword }; }
function buildSearchUrl(keyword, page) {
  return `https://www.coupang.com/np/search?q=${encodeURIComponent(keyword)}&channel=user&page=${intParam(page, 1)}`;
}
function uniqueByKey(items) {
  const seen = new Set();
  const out = [];
  for (const item of items || []) {
    const key = item.key || item.vendorItemId || item.productId || item.url || item.title || item.image;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}
async function getBrowser() {
  if (!browserPromise) {
    browserPromise = chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    });
  }
  return await browserPromise;
}
async function newPageContext() {
  const browser = await getBrowser();
  const context = await browser.newContext({
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    viewport: { width: 1365, height: 1400 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();
  return { context, page };
}
async function loadCoupangSearch(keyword, pageNo) {
  const sourceUrl = buildSearchUrl(keyword, pageNo);
  const { context, page } = await newPageContext();
  try {
    const response = await page.goto(sourceUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const status = response ? response.status() : 0;
    try { await page.waitForLoadState('networkidle', { timeout: 8000 }); } catch (_) {}
    await page.waitForTimeout(2500);
    return { context, page, status, sourceUrl };
  } catch (e) {
    try { await context.close(); } catch (_) {}
    throw e;
  }
}
async function extractItemsFromPage(page) {
  return await page.evaluate(() => {
    function txt(el) { return (el && (el.innerText || el.textContent) || '').replace(/\s+/g, ' ').trim(); }
    function attr(el, name) { return el ? (el.getAttribute(name) || '') : ''; }
    function abs(u) { if (!u) return ''; if (u.indexOf('//') === 0) return 'https:' + u; if (u.indexOf('/') === 0) return 'https://www.coupang.com' + u; return u; }
    function ids(url) {
      var out = { productId: '', itemId: '', vendorItemId: '' }, m;
      m = String(url || '').match(/\/vp\/products\/(\d+)/); if (m) out.productId = m[1];
      m = String(url || '').match(/[?&]itemId=(\d+)/); if (m) out.itemId = m[1];
      m = String(url || '').match(/[?&]vendorItemId=(\d+)/); if (m) out.vendorItemId = m[1];
      return out;
    }
    function findCard(a) {
      var cur = a;
      for (var i = 0; i < 8 && cur; i++) {
        var t = txt(cur);
        var hasImg = !!cur.querySelector('img');
        var hasPrice = /[0-9,]+\s*원/.test(t);
        if (hasImg && (hasPrice || t.length > 30)) return cur;
        cur = cur.parentElement;
      }
      return a.parentElement || a;
    }
    function pickImage(card) {
      var imgs = Array.from(card.querySelectorAll('img'));
      for (var i = 0; i < imgs.length; i++) {
        var img = imgs[i];
        var u = attr(img, 'data-img-src') || attr(img, 'data-src') || attr(img, 'src') || attr(img, 'srcset');
        if (!u || u.indexOf('blank') >= 0 || u.indexOf('data:image') === 0) continue;
        if (u.indexOf(' ') > -1 && u.indexOf(',') > -1) u = u.split(',')[0].trim().split(' ')[0];
        return abs(u);
      }
      return '';
    }
    function pickTitle(card) {
      var selectors = ['.name','[class*="name"]','[class*="title"]','[class*="product"]','strong','em'];
      for (var i = 0; i < selectors.length; i++) {
        var el = card.querySelector(selectors[i]);
        var s = txt(el);
        if (s && s.length >= 2 && !/[0-9,]+\s*원/.test(s)) return s.slice(0, 220);
      }
      var imgEl = card.querySelector('img[alt]');
      var alt = attr(imgEl, 'alt');
      if (alt) return alt.slice(0, 220);
      return txt(card).replace(/[0-9,]+\s*원/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 220);
    }
    function pickPrice(card) {
      var t = txt(card);
      var m = t.match(/[0-9][0-9,]*\s*원/);
      return m ? m[0].replace(/\s+/g, '') : '';
    }
    function pickDelivery(card) {
      var t = txt(card);
      var c = ['로켓배송', '로켓프레시', '무료배송', '내일', '오늘', '도착', '새벽배송', '판매자로켓'];
      return c.filter(x => t.indexOf(x) >= 0).slice(0, 3).join(' ');
    }

    var anchors = Array.from(document.querySelectorAll('a[href*="/vp/products/"]'));
    var seen = new Set();
    var items = [];
    anchors.forEach(function(a) {
      var url = abs(attr(a, 'href'));
      if (!url || seen.has(url)) return;
      seen.add(url);
      var card = findCard(a);
      var id = ids(url);
      var image = pickImage(card);
      var title = pickTitle(card);
      var priceText = pickPrice(card);
      var deliveryText = pickDelivery(card);
      var key = [id.productId, id.itemId, id.vendorItemId].filter(Boolean).join('_') || url;
      items.push({ key, rank: items.length + 1, title, image, priceText, deliveryText, url, productId: id.productId, itemId: id.itemId, vendorItemId: id.vendorItemId });
    });
    return items;
  });
}
async function collectDebug(page, status, sourceUrl) {
  return await page.evaluate((arg) => {
    function count(sel) { try { return document.querySelectorAll(sel).length; } catch (_) { return -1; } }
    function sample(sel, n) {
      try {
        return Array.from(document.querySelectorAll(sel)).slice(0, n || 5).map(function(el) {
          return {
            tag: el.tagName,
            cls: String(el.className || '').slice(0, 200),
            href: el.getAttribute && el.getAttribute('href') || '',
            text: (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 300)
          };
        });
      } catch (_) { return []; }
    }
    return {
      pageTitle: document.title || '',
      locationHref: location.href,
      bodyTextHead: (document.body && document.body.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 1000),
      htmlLength: document.documentElement ? document.documentElement.outerHTML.length : 0,
      counts: {
        aProducts: count('a[href*="/vp/products/"]'),
        liSearchProduct: count('li.search-product'),
        classSearchProduct: count('[class*="search-product"]'),
        dataProductId: count('[data-product-id]'),
        img: count('img'),
        script: count('script')
      },
      samples: {
        aProducts: sample('a[href*="/vp/products/"]', 10),
        productClass: sample('[class*="product"]', 10),
        images: sample('img', 10)
      },
      status: arg.status,
      sourceUrl: arg.sourceUrl
    };
  }, { status, sourceUrl });
}
async function coupangSearch(ctx, includeDebug) {
  const keyword = ctx.keyword;
  const pageNo = ctx.page || 1;
  if (!keyword) return { type: 'search', source: 'coupang', keyword, page: pageNo, total: 0, items: [], message: 'empty keyword' };
  const { context, page, status, sourceUrl } = await loadCoupangSearch(keyword, pageNo);
  try {
    const rawItems = await extractItemsFromPage(page);
    const normalized = uniqueByKey(rawItems).slice(0, 60);
    const result = {
      type: 'search', source: 'coupang', keyword, page: pageNo, total: normalized.length,
      cached: false, nextPage: normalized.length ? pageNo + 1 : null, prevPage: pageNo > 1 ? pageNo - 1 : null,
      items: normalized, status, sourceUrl, finalUrl: page.url(), message: normalized.length ? 'OK' : 'NO_ITEMS_EXTRACTED'
    };
    if (includeDebug || !normalized.length) result.debug = await collectDebug(page, status, sourceUrl);
    return result;
  } finally {
    try { await context.close(); } catch (_) {}
  }
}
async function coupangDetail(ctx) {
  const productId = cleanText(ctx.productId), itemId = cleanText(ctx.itemId), vendorItemId = cleanText(ctx.vendorItemId);
  let url = '';
  if (productId) {
    url = `https://www.coupang.com/vp/products/${encodeURIComponent(productId)}`;
    const qs = [];
    if (itemId) qs.push(`itemId=${encodeURIComponent(itemId)}`);
    if (vendorItemId) qs.push(`vendorItemId=${encodeURIComponent(vendorItemId)}`);
    if (qs.length) url += '?' + qs.join('&');
  }
  return { type: 'detail', source: 'coupang', productId, itemId, vendorItemId, product: null, url, message: 'COUPANG_DETAIL_ADAPTER_NOT_CONNECTED_YET' };
}
async function runAction(action, ctx, includeDebug) {
  if (action === 'detail') return await coupangDetail(ctx);
  return await coupangSearch(ctx, includeDebug);
}
app.get('/', (req, res) => ok(res, { service: 'glomart-cloudtype-scrap-switch', routes: ['GET /health','GET /module/scrap/api/search?q=keyword&page=1','GET /module/scrap/api/debug?q=keyword&page=1','GET /module/scrap/api/switch?q=keyword&action=search&page=1','GET /module/scrap/api/detail?productId=&itemId=&vendorItemId='] }));
app.get('/health', (req, res) => ok(res, { status: 'running' }));
app.get('/module/scrap/api/search', async (req, res) => {
  try {
    const pageNo = intParam(req.query.page, 1);
    const input = analyzeInput(req.query.q || req.query.keyword || '');
    const target = selectTarget(input);
    const result = await runAction('search', { ...target, page: pageNo }, false);
    ok(res, { action: 'search', input, target: target.target, ...result });
  } catch (e) { fail(res, 500, 'search failed', { detail: String(e && e.message || e) }); }
});
app.get('/module/scrap/api/debug', async (req, res) => {
  try {
    const pageNo = intParam(req.query.page, 1);
    const input = analyzeInput(req.query.q || req.query.keyword || '');
    const target = selectTarget(input);
    const result = await runAction('search', { ...target, page: pageNo }, true);
    ok(res, { action: 'debug', input, target: target.target, ...result });
  } catch (e) { fail(res, 500, 'debug failed', { detail: String(e && e.message || e) }); }
});
app.get('/module/scrap/api/switch', async (req, res) => {
  try {
    const action = cleanText(req.query.action || 'search').toLowerCase();
    const pageNo = intParam(req.query.page, 1);
    const input = analyzeInput(req.query.q || req.query.keyword || '');
    const target = selectTarget(input);
    const result = await runAction(action, { ...target, page: pageNo, productId: req.query.productId, itemId: req.query.itemId, vendorItemId: req.query.vendorItemId || req.query.venderItemId }, false);
    ok(res, { action, input, target: target.target, ...result });
  } catch (e) { fail(res, 500, 'switch failed', { detail: String(e && e.message || e) }); }
});
app.get('/module/scrap/api/detail', async (req, res) => {
  try {
    const result = await runAction('detail', { target: 'coupang', productId: req.query.productId, itemId: req.query.itemId, vendorItemId: req.query.vendorItemId || req.query.venderItemId }, false);
    ok(res, { action: 'detail', target: 'coupang', ...result });
  } catch (e) { fail(res, 500, 'detail failed', { detail: String(e && e.message || e) }); }
});
process.on('SIGTERM', async () => {
  try { if (browserPromise) { const browser = await browserPromise; await browser.close(); } } catch (_) {}
  process.exit(0);
});
app.listen(PORT, () => console.log(`[${VERSION}] listening on ${PORT}`));
