/*
 * GLOMART Cloudtype Scrap Switch Server V2.0
 * 1단계 keyword only / 2단계 coupang fixed / 3단계 search-pagination-detail
 * V2: fetch 기반 쿠팡 검색 어댑터 연결
 */

const express = require('express');
const cors = require('cors');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const VERSION = 'GLOMART_CLOUDTYPE_SCRAP_SWITCH_V2_FETCH_SEARCH_20260506';

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cors({ origin: true, credentials: false }));

function cleanText(v) {
  return String(v || '')
    .replace(/[\u00A0\u200B-\u200D\uFEFF]/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
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

function absUrl(url, base = 'https://www.coupang.com') {
  url = String(url || '').trim();
  if (!url) return '';
  if (url.startsWith('//')) return 'https:' + url;
  if (url.startsWith('/')) return base + url;
  return url;
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

function extractIdsFromUrl(url) {
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

function analyzeInput(q) {
  return { mode: 'keyword', keyword: normalizeKeyword(q) };
}

function selectTarget(input) {
  return { target: 'coupang', mode: input.mode, keyword: input.keyword };
}

async function runAction(action, ctx) {
  if (action === 'detail') return await coupangDetail(ctx);
  return await coupangSearch(ctx);
}

function buildCoupangSearchUrl(keyword, page) {
  return `https://www.coupang.com/np/search?q=${encodeURIComponent(keyword)}&channel=user&page=${intParam(page, 1)}`;
}

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'ko-KR,ko;q=0.9,en-US;q=0.6,en;q=0.5',
        'user-agent': 'Mozilla/5.0 (compatible; GlomartScrapSwitch/2.0; +https://glomart.kr)'
      }
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, finalUrl: res.url || url, text };
  } finally {
    clearTimeout(timer);
  }
}

function extractCoupangItemsFromHtml(html) {
  const items = [];
  const source = String(html || '');

  const liRegex = /<li\b[^>]*class=["'][^"']*search-product[^"']*["'][^>]*>[\s\S]*?<\/li>/gi;
  const blocks = source.match(liRegex) || [];

  blocks.forEach((block, idx) => {
    const aTagMatch = block.match(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/i);
    const href = aTagMatch ? aTagMatch[1] : '';
    const url = absUrl(href);
    const ids = extractIdsFromUrl(url);

    const imgMatch = block.match(/<img\b[^>]*(?:data-img-src|data-src|src)=["']([^"']+)["'][^>]*>/i);
    const image = absUrl(imgMatch ? imgMatch[1] : '');

    const nameMatch =
      block.match(/<div\b[^>]*class=["'][^"']*(?:name|descriptions-inner|product-title)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i) ||
      block.match(/<span\b[^>]*class=["'][^"']*(?:name|product-title)[^"']*["'][^>]*>([\s\S]*?)<\/span>/i);
    const title = cleanText(nameMatch ? nameMatch[1] : '');

    const priceMatch =
      block.match(/<strong\b[^>]*class=["'][^"']*price-value[^"']*["'][^>]*>([\s\S]*?)<\/strong>/i) ||
      block.match(/<em\b[^>]*class=["'][^"']*sale[^"']*["'][^>]*>([\s\S]*?)<\/em>/i) ||
      block.match(/<span\b[^>]*class=["'][^"']*price[^"']*["'][^>]*>([\s\S]*?)<\/span>/i);

    let priceText = cleanText(priceMatch ? priceMatch[1] : '');
    if (priceText && !/원$/.test(priceText)) priceText += '원';

    const deliveryMatch =
      block.match(/<span\b[^>]*class=["'][^"']*(?:delivery|arrival|badge|rocket)[^"']*["'][^>]*>([\s\S]*?)<\/span>/i) ||
      block.match(/<div\b[^>]*class=["'][^"']*(?:delivery|arrival|badge|rocket)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
    const deliveryText = cleanText(deliveryMatch ? deliveryMatch[1] : '');

    const key = [ids.productId, ids.itemId, ids.vendorItemId].filter(Boolean).join('_') || url;

    if (title || url) {
      items.push({
        key,
        rank: idx + 1,
        title,
        image,
        priceText,
        deliveryText,
        url,
        productId: ids.productId,
        itemId: ids.itemId,
        vendorItemId: ids.vendorItemId
      });
    }
  });

  if (!items.length) {
    const productUrlRegex = /\/vp\/products\/\d+[^"'\\<\s]*/g;
    const urls = source.match(productUrlRegex) || [];
    urls.slice(0, 40).forEach((u, idx) => {
      const url = absUrl(u.replace(/\\u0026/g, '&').replace(/\\/g, ''));
      const ids = extractIdsFromUrl(url);
      const key = [ids.productId, ids.itemId, ids.vendorItemId].filter(Boolean).join('_') || url;
      items.push({
        key,
        rank: idx + 1,
        title: '',
        image: '',
        priceText: '',
        deliveryText: '',
        url,
        productId: ids.productId,
        itemId: ids.itemId,
        vendorItemId: ids.vendorItemId
      });
    });
  }

  return uniqueByKey(items).slice(0, 60);
}

async function coupangSearch(ctx) {
  const keyword = ctx.keyword;
  const page = ctx.page || 1;

  if (!keyword) {
    return { type: 'search', source: 'coupang', keyword, page, total: 0, items: [], message: 'empty keyword' };
  }

  const sourceUrl = buildCoupangSearchUrl(keyword, page);
  const fetched = await fetchText(sourceUrl);

  if (!fetched.ok) {
    return {
      type: 'search',
      source: 'coupang',
      keyword,
      page,
      total: 0,
      cached: false,
      nextPage: null,
      prevPage: page > 1 ? page - 1 : null,
      items: [],
      status: fetched.status,
      sourceUrl,
      finalUrl: fetched.finalUrl,
      message: 'COUPANG_FETCH_FAILED'
    };
  }

  const items = extractCoupangItemsFromHtml(fetched.text);

  return {
    type: 'search',
    source: 'coupang',
    keyword,
    page,
    total: items.length,
    cached: false,
    nextPage: items.length ? page + 1 : null,
    prevPage: page > 1 ? page - 1 : null,
    items,
    status: fetched.status,
    sourceUrl,
    finalUrl: fetched.finalUrl,
    message: items.length ? 'OK' : 'NO_ITEMS_EXTRACTED'
  };
}

async function coupangDetail(ctx) {
  const productId = cleanText(ctx.productId);
  const itemId = cleanText(ctx.itemId);
  const vendorItemId = cleanText(ctx.vendorItemId);

  if (!productId && !vendorItemId) {
    return { type: 'detail', source: 'coupang', product: null, message: 'missing productId or vendorItemId' };
  }

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

app.get('/', (req, res) => {
  ok(res, {
    service: 'glomart-cloudtype-scrap-switch',
    routes: [
      'GET /health',
      'GET /module/scrap/api/switch?q=keyword&action=search&page=1',
      'GET /module/scrap/api/search?q=keyword&page=1',
      'GET /module/scrap/api/detail?productId=&itemId=&vendorItemId='
    ]
  });
});

app.get('/health', (req, res) => ok(res, { status: 'running' }));

app.get('/module/scrap/api/switch', async (req, res) => {
  try {
    const action = cleanText(req.query.action || 'search').toLowerCase();
    const page = intParam(req.query.page, 1);
    const input = analyzeInput(req.query.q || req.query.keyword || '');
    const target = selectTarget(input);
    const result = await runAction(action, {
      ...target,
      page,
      productId: req.query.productId,
      itemId: req.query.itemId,
      vendorItemId: req.query.vendorItemId || req.query.venderItemId
    });
    ok(res, { action, input, target: target.target, ...result });
  } catch (e) {
    fail(res, 500, 'switch failed', { detail: String(e && e.message || e) });
  }
});

app.get('/module/scrap/api/search', async (req, res) => {
  try {
    const page = intParam(req.query.page, 1);
    const input = analyzeInput(req.query.q || req.query.keyword || '');
    const target = selectTarget(input);
    const result = await runAction('search', { ...target, page });
    ok(res, { action: 'search', input, target: target.target, ...result });
  } catch (e) {
    fail(res, 500, 'search failed', { detail: String(e && e.message || e) });
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

app.listen(PORT, () => console.log(`[${VERSION}] listening on ${PORT}`));

