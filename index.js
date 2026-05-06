/*
 * GLOMART Cloudtype Scrap Switch Server V4.0 Docker
 * 목적:
 * - Cloudtype 일반 Node 실행에서 부족한 Chromium OS 라이브러리 문제 해결
 * - Dockerfile로 Playwright/Chromium 의존성 포함
 * - Cafe24 요청 없음
 * - 서버는 JSON만 반환
 */

const express = require('express');
const cors = require('cors');
const { chromium } = require('playwright');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const VERSION = 'GLOMART_CLOUDTYPE_SCRAP_SWITCH_V4_DOCKER_PLAYWRIGHT_20260506';

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cors({ origin: true, credentials: false }));

let browserPromise = null;

function cleanText(v) {
  return String(v || '')
    .replace(/[\u00A0\u200B-\u200D\uFEFF]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeKeyword(q) {
  q = cleanText(q);
  q = q.replace(/[，、؛;|]+/g, ' ');
  q = q.replace(/\s+/g, ' ').trim();
  q = q.replace(/^[-–—]+\s*/, '').trim();
  if ((q.startsWith('(') && q.endsWith(')')) || (q.startsWith('[') && q.endsWith(']'))) {
    q = q.slice(1, -1).trim();
  }
  return q;
}

function intParam(v, fallback) {
  const n = parseInt(String(v || ''), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function ok(res, data) {
  res.json({ ok: true, version: VERSION, ...data });
}

function fail(res, status, message, extra = {}) {
  res.status(status).json({ ok: false, version: VERSION, error: message, ...extra });
}

function analyzeInput(q) {
  return { mode: 'keyword', keyword: normalizeKeyword(q) };
}

function selectTarget(input) {
  return { target: 'coupang', mode: input.mode, keyword: input.keyword };
}

function buildSearchUrl(keyword, page) {
  return `https://www.coupang.com/np/search?q=${encodeURIComponent(keyword)}&channel=user&page=${intParam(page, 1)}`;
}

function uniqueByKey(items) {
  const seen = new Set();
  const out = [];
  for (const item of items || []) {
    const key = item.key || item.vendorItemId || item.productId || item.url || item.title;
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
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu'
      ]
    });
  }
  return await browserPromise;
}

async function coupangSearch(ctx) {
  const keyword = ctx.keyword;
  const pageNo = ctx.page || 1;

  if (!keyword) {
    return {
      type: 'search',
      source: 'coupang',
      keyword,
      page: pageNo,
      total: 0,
      items: [],
      message: 'empty keyword'
    };
  }

  const sourceUrl = buildSearchUrl(keyword, pageNo);
  const browser = await getBrowser();

  const context = await browser.newContext({
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    viewport: { width: 1365, height: 900 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });

  const page = await context.newPage();

  try {
    const response = await page.goto(sourceUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    const status = response ? response.status() : 0;
    await page.waitForTimeout(3000);

    const items = await page.evaluate(() => {
      function txt(el) {
        return (el && (el.innerText || el.textContent) || '').replace(/\s+/g, ' ').trim();
      }
      function attr(el, name) {
        return el ? (el.getAttribute(name) || '') : '';
      }
      function abs(u) {
        if (!u) return '';
        if (u.indexOf('//') === 0) return 'https:' + u;
        if (u.indexOf('/') === 0) return 'https://www.coupang.com' + u;
        return u;
      }
      function ids(url) {
        var out = { productId: '', itemId: '', vendorItemId: '' };
        var m = String(url || '').match(/\/vp\/products\/(\d+)/);
        if (m) out.productId = m[1];
        m = String(url || '').match(/[?&]itemId=(\d+)/);
        if (m) out.itemId = m[1];
        m = String(url || '').match(/[?&]vendorItemId=(\d+)/);
        if (m) out.vendorItemId = m[1];
        return out;
      }

      var cards = Array.from(document.querySelectorAll(
        'li.search-product, li[class*="search-product"], [data-product-id], a[href*="/vp/products/"]'
      )).map(function(el) {
        return el.closest('li.search-product') || el.closest('li[class*="search-product"]') || el;
      });

      var seenNode = new Set();
      cards = cards.filter(function(el) {
        if (!el || seenNode.has(el)) return false;
        seenNode.add(el);
        return true;
      });

      return cards.slice(0, 80).map(function(card, idx) {
        var a = card.querySelector('a[href*="/vp/products/"]') ||
          (card.matches && card.matches('a[href*="/vp/products/"]') ? card : null);

        var url = abs(attr(a, 'href'));
        var id = ids(url);

        var img = card.querySelector('img');
        var image = abs(attr(img, 'data-img-src') || attr(img, 'data-src') || attr(img, 'src'));

        var titleEl =
          card.querySelector('.name') ||
          card.querySelector('[class*="name"]') ||
          card.querySelector('[class*="title"]') ||
          card.querySelector('img[alt]');

        var title = txt(titleEl);
        if (!title && img) title = attr(img, 'alt');

        var priceEl =
          card.querySelector('.price-value') ||
          card.querySelector('[class*="price-value"]') ||
          card.querySelector('[class*="sale-price"]') ||
          card.querySelector('[class*="price"]');

        var priceText = txt(priceEl);
        if (priceText && priceText.indexOf('원') < 0) priceText += '원';

        var deliveryEl =
          card.querySelector('[class*="delivery"]') ||
          card.querySelector('[class*="arrival"]') ||
          card.querySelector('[class*="rocket"]') ||
          card.querySelector('[class*="badge"]');

        var deliveryText = txt(deliveryEl);

        var key = [id.productId, id.itemId, id.vendorItemId].filter(Boolean).join('_') || url || title;

        return {
          key: key,
          rank: idx + 1,
          title: title,
          image: image,
          priceText: priceText,
          deliveryText: deliveryText,
          url: url,
          productId: id.productId,
          itemId: id.itemId,
          vendorItemId: id.vendorItemId
        };
      }).filter(function(it) {
        return it && (it.url || it.title || it.image);
      });
    });

    const normalized = uniqueByKey(items).slice(0, 60);

    return {
      type: 'search',
      source: 'coupang',
      keyword,
      page: pageNo,
      total: normalized.length,
      cached: false,
      nextPage: normalized.length ? pageNo + 1 : null,
      prevPage: pageNo > 1 ? pageNo - 1 : null,
      items: normalized,
      status,
      sourceUrl,
      finalUrl: page.url(),
      message: normalized.length ? 'OK' : 'NO_ITEMS_EXTRACTED'
    };
  } finally {
    try { await context.close(); } catch (_) {}
  }
}

async function coupangDetail(ctx) {
  const productId = cleanText(ctx.productId);
  const itemId = cleanText(ctx.itemId);
  const vendorItemId = cleanText(ctx.vendorItemId);

  let url = '';
  if (productId) {
    url = `https://www.coupang.com/vp/products/${encodeURIComponent(productId)}`;
    const qs = [];
    if (itemId) qs.push(`itemId=${encodeURIComponent(itemId)}`);
    if (vendorItemId) qs.push(`vendorItemId=${encodeURIComponent(vendorItemId)}`);
    if (qs.length) url += '?' + qs.join('&');
  }

  return {
    type: 'detail',
    source: 'coupang',
    productId,
    itemId,
    vendorItemId,
    product: null,
    url,
    message: 'COUPANG_DETAIL_ADAPTER_NOT_CONNECTED_YET'
  };
}

async function runAction(action, ctx) {
  if (action === 'detail') return await coupangDetail(ctx);
  return await coupangSearch(ctx);
}

app.get('/', (req, res) => {
  ok(res, {
    service: 'glomart-cloudtype-scrap-switch',
    routes: [
      'GET /health',
      'GET /module/scrap/api/search?q=keyword&page=1',
      'GET /module/scrap/api/switch?q=keyword&action=search&page=1',
      'GET /module/scrap/api/detail?productId=&itemId=&vendorItemId='
    ]
  });
});

app.get('/health', (req, res) => ok(res, { status: 'running' }));

app.get('/module/scrap/api/search', async (req, res) => {
  try {
    const pageNo = intParam(req.query.page, 1);
    const input = analyzeInput(req.query.q || req.query.keyword || '');
    const target = selectTarget(input);
    const result = await runAction('search', { ...target, page: pageNo });
    ok(res, { action: 'search', input, target: target.target, ...result });
  } catch (e) {
    fail(res, 500, 'search failed', { detail: String(e && e.message || e) });
  }
});

app.get('/module/scrap/api/switch', async (req, res) => {
  try {
    const action = cleanText(req.query.action || 'search').toLowerCase();
    const pageNo = intParam(req.query.page, 1);
    const input = analyzeInput(req.query.q || req.query.keyword || '');
    const target = selectTarget(input);
    const result = await runAction(action, {
      ...target,
      page: pageNo,
      productId: req.query.productId,
      itemId: req.query.itemId,
      vendorItemId: req.query.vendorItemId || req.query.venderItemId
    });
    ok(res, { action, input, target: target.target, ...result });
  } catch (e) {
    fail(res, 500, 'switch failed', { detail: String(e && e.message || e) });
  }
});

app.get('/module/scrap/api/detail', async (req, res) => {
  try {
    const result = await runAction('detail', {
      target: 'coupang',
      productId: req.query.productId,
      itemId: req.query.itemId,
      vendorItemId: req.query.vendorItemId || req.query.venderItemId
    });
    ok(res, { action: 'detail', target: 'coupang', ...result });
  } catch (e) {
    fail(res, 500, 'detail failed', { detail: String(e && e.message || e) });
  }
});

process.on('SIGTERM', async () => {
  try {
    if (browserPromise) {
      const browser = await browserPromise;
      await browser.close();
    }
  } catch (_) {}
  process.exit(0);
});

app.listen(PORT, () => console.log(`[${VERSION}] listening on ${PORT}`));
