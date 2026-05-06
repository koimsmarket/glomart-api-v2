/*
 * GLOMART Cloudtype Scrap Switch Server V1.0
 * 현재 범위:
 *   1단계: keyword only
 *   2단계: target = coupang fixed
 *   3단계: search / pagination / detail
 *
 * Front 기존 호출 유지:
 *   GET /module/scrap/api/search?q=검색어&page=1
 *
 * 중요:
 *   - Cafe24 요청 없음
 *   - 서버는 JSON만 반환
 *   - 프론트 렌더링은 GM_SCRAP_SEARCH_DISPLAY_ENGINE 담당
 */

const express = require('express');
const cors = require('cors');

const app = express();

const PORT = Number(process.env.PORT || 3000);
const VERSION = 'GLOMART_CLOUDTYPE_SCRAP_SWITCH_V1_20260506';

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cors({
  origin: true,
  credentials: false,
}));

/* -------------------------
 * Common helpers
 * ------------------------- */

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
  if (
    (q.startsWith('(') && q.endsWith(')')) ||
    (q.startsWith('[') && q.endsWith(']'))
  ) {
    q = q.slice(1, -1).trim();
  }
  return q;
}

function intParam(v, fallback) {
  const n = parseInt(String(v || ''), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function ok(res, data) {
  res.json({
    ok: true,
    version: VERSION,
    ...data,
  });
}

function fail(res, status, message, extra = {}) {
  res.status(status).json({
    ok: false,
    version: VERSION,
    error: message,
    ...extra,
  });
}

/* -------------------------
 * 1단계: INPUT ANALYZER
 * 현재는 keyword only
 * ------------------------- */

function analyzeInput(q) {
  const keyword = normalizeKeyword(q);
  return {
    mode: 'keyword',
    keyword,
  };
}

/* -------------------------
 * 2단계: TARGET SWITCHER
 * 현재는 coupang fixed
 * ------------------------- */

function selectTarget(input) {
  return {
    target: 'coupang',
    mode: input.mode,
    keyword: input.keyword,
  };
}

/* -------------------------
 * 3단계: ACTION SWITCHER
 * search / pagination / detail
 * ------------------------- */

async function runAction(action, ctx) {
  if (action === 'detail') return await coupangDetail(ctx);
  return await coupangSearch(ctx);
}

/* -------------------------
 * Coupang adapter
 * 현재 V1은 안전한 통합 포맷 우선.
 *
 * 실제 쿠팡 검색 수집부는 아래 coupangSearch() 내부만 교체하면 됨.
 * 프론트/라우터는 안 건드림.
 * ------------------------- */

async function coupangSearch(ctx) {
  const keyword = ctx.keyword;
  const page = ctx.page || 1;

  if (!keyword) {
    return {
      type: 'search',
      source: 'coupang',
      keyword,
      page,
      total: 0,
      items: [],
      message: 'empty keyword',
    };
  }

  /*
   * TODO:
   * 여기서 실제 쿠팡 검색 수집 또는 내부 캐시/DB 조회를 연결.
   *
   * 반드시 아래 items 형식으로만 반환:
   * {
   *   rank,
   *   title,
   *   image,
   *   priceText,
   *   deliveryText,
   *   url,
   *   productId,
   *   itemId,
   *   vendorItemId,
   *   key
   * }
   */

  return {
    type: 'search',
    source: 'coupang',
    keyword,
    page,
    total: 0,
    cached: false,
    nextPage: page + 1,
    prevPage: page > 1 ? page - 1 : null,
    items: [],
    message: 'COUPANG_SEARCH_ADAPTER_NOT_CONNECTED_YET',
  };
}

async function coupangDetail(ctx) {
  const productId = cleanText(ctx.productId);
  const itemId = cleanText(ctx.itemId);
  const vendorItemId = cleanText(ctx.vendorItemId);

  if (!productId && !vendorItemId) {
    return {
      type: 'detail',
      source: 'coupang',
      product: null,
      message: 'missing productId or vendorItemId',
    };
  }

  /*
   * TODO:
   * 여기서 실제 상세 수집 또는 캐시/DB 조회 연결.
   * 상세 결과는 product 한 객체로 통일.
   */

  return {
    type: 'detail',
    source: 'coupang',
    productId,
    itemId,
    vendorItemId,
    product: null,
    message: 'COUPANG_DETAIL_ADAPTER_NOT_CONNECTED_YET',
  };
}

/* -------------------------
 * Routes
 * ------------------------- */

app.get('/', (req, res) => {
  ok(res, {
    service: 'glomart-cloudtype-scrap-switch',
    routes: [
      'GET /health',
      'GET /module/scrap/api/switch?q=keyword&action=search&page=1',
      'GET /module/scrap/api/search?q=keyword&page=1',
      'GET /module/scrap/api/detail?productId=&itemId=&vendorItemId=',
    ],
  });
});

app.get('/health', (req, res) => {
  ok(res, {
    status: 'running',
  });
});

/*
 * 통합 스위치
 * action:
 *   - search 기본
 *   - detail
 */
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
      vendorItemId: req.query.vendorItemId || req.query.venderItemId,
    });

    ok(res, {
      action,
      input,
      target: target.target,
      ...result,
    });
  } catch (e) {
    fail(res, 500, 'switch failed', { detail: String(e && e.message || e) });
  }
});

/*
 * 기존 GM_SCRAP_SEARCH_DISPLAY_ENGINE 호환 경로
 */
app.get('/module/scrap/api/search', async (req, res) => {
  try {
    const page = intParam(req.query.page, 1);
    const input = analyzeInput(req.query.q || req.query.keyword || '');
    const target = selectTarget(input);

    const result = await runAction('search', {
      ...target,
      page,
    });

    ok(res, {
      action: 'search',
      input,
      target: target.target,
      ...result,
    });
  } catch (e) {
    fail(res, 500, 'search failed', { detail: String(e && e.message || e) });
  }
});

/*
 * 상세 경로
 */
app.get('/module/scrap/api/detail', async (req, res) => {
  try {
    const result = await runAction('detail', {
      target: 'coupang',
      productId: req.query.productId,
      itemId: req.query.itemId,
      vendorItemId: req.query.vendorItemId || req.query.venderItemId,
    });

    ok(res, {
      action: 'detail',
      target: 'coupang',
      ...result,
    });
  } catch (e) {
    fail(res, 500, 'detail failed', { detail: String(e && e.message || e) });
  }
});

/*
 * 다음/이전 페이지는 search 경로에 page만 바꿔서 사용.
 * 예:
 *   /module/scrap/api/search?q=떡볶이&page=2
 */

app.listen(PORT, () => {
  console.log(`[${VERSION}] listening on ${PORT}`);
});

