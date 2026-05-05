const http = require('http');
const url = require('url');

const PORT = process.env.PORT || 3000;
const VERSION = 'LIVE V3.0';

function sendText(res, status, text) {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Access-Control-Allow-Origin': '*'
  });
  return res.end(text);
}

function sendJson(res, status, obj) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*'
  });
  return res.end(JSON.stringify(obj, null, 2));
}

function parseKey(key) {
  const cleanKey = String(key || '').trim();
  const parts = cleanKey.split('_').map(v => String(v || '').trim()).filter(Boolean);

  if (parts.length < 3) {
    return {
      ok: false,
      message: 'key 형식 오류: productId_itemId_vendorItemId 필요',
      key: cleanKey
    };
  }

  const [productId, itemId, vendorItemId] = parts;
  const coupangUrl =
    `https://www.coupang.com/vp/products/${encodeURIComponent(productId)}` +
    `?itemId=${encodeURIComponent(itemId)}` +
    `&vendorItemId=${encodeURIComponent(vendorItemId)}`;

  return {
    ok: true,
    key: cleanKey,
    productId,
    itemId,
    vendorItemId,
    coupangUrl
  };
}

function uniq(arr) {
  return Array.from(new Set((arr || []).filter(Boolean).map(v => String(v).trim()).filter(Boolean)));
}

async function collectCoupangLive(coupangUrl) {
  let chromium;
  try {
    chromium = require('playwright').chromium;
  } catch (err) {
    return {
      ok: false,
      errorCode: 'PLAYWRIGHT_NOT_INSTALLED',
      message: 'playwright가 설치되지 않았습니다. package.json 포함 ZIP으로 재배포해야 합니다.',
      detail: String(err && err.message ? err.message : err)
    };
  }

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu'
      ]
    });

    const page = await browser.newPage({
      viewport: { width: 1365, height: 900 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      locale: 'ko-KR'
    });

    await page.setExtraHTTPHeaders({
      'accept-language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7'
    });

    const response = await page.goto(coupangUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    await page.waitForTimeout(2500);

    // 상세 이미지 lazy-load 대응용 짧은 스크롤
    for (let i = 0; i < 4; i++) {
      await page.mouse.wheel(0, 900);
      await page.waitForTimeout(700);
    }

    const data = await page.evaluate(() => {
      const text = (el) => (el && (el.innerText || el.textContent) || '').replace(/\s+/g, ' ').trim();
      const attr = (el, name) => el && el.getAttribute && el.getAttribute(name);
      const abs = (src) => {
        if (!src) return '';
        src = String(src).trim();
        if (!src) return '';
        if (src.startsWith('//')) return location.protocol + src;
        try { return new URL(src, location.href).href; } catch (e) { return src; }
      };
      const uniqLocal = (arr) => Array.from(new Set((arr || []).filter(Boolean).map(v => String(v).trim()).filter(Boolean)));

      const bodyText = document.body ? text(document.body) : '';

      const priceSelectors = [
        '.total-price strong',
        '.total-price',
        '.prod-price .total-price',
        '.prod-price .price-value',
        '.sale-price',
        '.price-value',
        '[class*="price"] strong',
        '[class*="Price"] strong',
        '[class*="price"]'
      ];

      const priceCandidates = [];
      for (const sel of priceSelectors) {
        document.querySelectorAll(sel).forEach(el => {
          const t = text(el);
          if (t && /[0-9][0-9,]*\s*원/.test(t)) priceCandidates.push(t);
        });
      }

      const allWonTexts = Array.from(document.querySelectorAll('body *'))
        .map(el => text(el))
        .filter(t => t && t.length < 80 && /[0-9][0-9,]*\s*원/.test(t));

      const pricePool = uniqLocal(priceCandidates.concat(allWonTexts));
      const priceNumbers = pricePool.map(t => {
        const m = t.match(/([0-9][0-9,]*)\s*원/);
        return m ? Number(m[1].replace(/,/g, '')) : 0;
      }).filter(n => n > 0);

      const currentPrice = priceNumbers.length ? Math.max(...priceNumbers) : null;

      const soldOutWords = ['품절', '일시품절', '판매중지', '구매불가', '재고 없음', '현재 구매할 수 없는 상품'];
      const soldOutByText = soldOutWords.some(w => bodyText.includes(w));
      const disabledBuyButton = Array.from(document.querySelectorAll('button, a'))
        .some(el => /구매|장바구니|바로구매/.test(text(el)) && (el.disabled || el.getAttribute('aria-disabled') === 'true'));

      const imageUrls = [];
      document.querySelectorAll('img').forEach(img => {
        imageUrls.push(abs(attr(img, 'src')));
        imageUrls.push(abs(attr(img, 'data-src')));
        imageUrls.push(abs(attr(img, 'data-original')));
        imageUrls.push(abs(attr(img, 'data-lazy-src')));
        imageUrls.push(abs(attr(img, 'data-url')));
      });

      document.querySelectorAll('*').forEach(el => {
        const bg = getComputedStyle(el).backgroundImage || '';
        const m = bg.match(/url\(["']?(.*?)["']?\)/);
        if (m && m[1]) imageUrls.push(abs(m[1]));
      });

      const coupangImages = uniqLocal(imageUrls)
        .filter(src => /coupang|coupangcdn|thumbnail|image/i.test(src));

      const detailImages = uniqLocal(Array.from(document.querySelectorAll(
        '#productDetail img, .product-detail img, .prod-description img, .detail-content img, [class*="detail"] img, [id*="detail"] img'
      )).flatMap(img => [
        abs(attr(img, 'src')),
        abs(attr(img, 'data-src')),
        abs(attr(img, 'data-original')),
        abs(attr(img, 'data-lazy-src'))
      ])).filter(src => /coupang|coupangcdn|thumbnail|image/i.test(src));

      const optionTexts = [];
      const optionSelectors = [
        '[class*="option"] button',
        '[class*="Option"] button',
        '[class*="option"] li',
        '[class*="Option"] li',
        '.prod-option button',
        '.prod-option li',
        'select option'
      ];
      for (const sel of optionSelectors) {
        document.querySelectorAll(sel).forEach(el => {
          const t = text(el);
          if (t && t.length <= 120 && !/^선택/.test(t)) optionTexts.push(t);
        });
      }

      return {
        title: text(document.querySelector('h1')) || text(document.querySelector('[class*="title"]')),
        currentPrice,
        priceCandidates: pricePool.slice(0, 30),
        soldOut: Boolean(soldOutByText || disabledBuyButton),
        soldOutDetectedByText: soldOutByText,
        disabledBuyButton,
        options: uniqLocal(optionTexts).slice(0, 100),
        images: coupangImages.slice(0, 80),
        detailImages: detailImages.slice(0, 80),
        pageTextSample: bodyText.slice(0, 500)
      };
    });

    return {
      ok: true,
      status: response ? response.status() : null,
      finalUrl: page.url(),
      ...data
    };
  } catch (err) {
    return {
      ok: false,
      errorCode: 'LIVE_COLLECT_FAILED',
      message: '쿠팡 실시간 조회 실패',
      detail: String(err && err.message ? err.message : err)
    };
  } finally {
    if (browser) {
      try { await browser.close(); } catch (e) {}
    }
  }
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    return res.end();
  }

  if (pathname === '/') {
    return sendText(res, 200, `Glomart API running ${VERSION}`);
  }

  if (pathname === '/check') {
    return sendText(res, 200, `NEW CODE OK ${VERSION}`);
  }

  if (pathname === '/test') {
    return sendJson(res, 200, {
      ok: true,
      version: VERSION,
      message: 'API works'
    });
  }

  if (pathname === '/coupang-json') {
    const parsed = parseKey(parsedUrl.query.key);
    return sendJson(res, parsed.ok ? 200 : 400, parsed);
  }

  if (pathname === '/coupang') {
    const parsed = parseKey(parsedUrl.query.key);
    if (!parsed.ok) return sendJson(res, 400, parsed);

    res.writeHead(302, {
      Location: parsed.coupangUrl,
      'Access-Control-Allow-Origin': '*'
    });
    return res.end();
  }

  if (pathname === '/coupang-live') {
    const parsed = parseKey(parsedUrl.query.key);
    if (!parsed.ok) return sendJson(res, 400, parsed);

    const live = await collectCoupangLive(parsed.coupangUrl);
    return sendJson(res, live.ok ? 200 : 500, {
      ...parsed,
      live
    });
  }

  return sendText(res, 404, 'Not found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Glomart API ${VERSION} running on ${PORT}`);
});

