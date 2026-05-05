const http = require('http');
const url = require('url');

const PORT = process.env.PORT || 3000;
const VERSION = 'IMAGE PLAYWRIGHT V4.1';

function sendText(res, status, text) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  return res.end(text);
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  return res.end(JSON.stringify(data, null, 2));
}

function parseKey(key) {
  const raw = String(key || '').trim();
  const parts = raw.split('_').map(v => v.trim()).filter(Boolean);
  if (parts.length < 3) return null;
  return { productId: parts[0], itemId: parts[1], vendorItemId: parts[2] };
}

function buildCoupangUrl(ids) {
  return `https://www.coupang.com/vp/products/${ids.productId}?itemId=${ids.itemId}&vendorItemId=${ids.vendorItemId}`;
}

function normalizeImageUrl(src) {
  if (!src) return '';
  let s = String(src).trim();
  if (!s) return '';
  if (s.startsWith('//')) s = 'https:' + s;
  if (s.startsWith('http://')) s = s.replace('http://', 'https://');
  return s;
}

function uniq(arr) {
  return Array.from(new Set(arr.filter(Boolean)));
}

function classifyImages(all) {
  const imageUrls = uniq(all.map(normalizeImageUrl))
    .filter(u => /^https:\/\//i.test(u))
    .filter(u => /coupang|coupangcdn|image\d*\.coupangcdn|thumbnail/i.test(u))
    .filter(u => /\.(jpg|jpeg|png|webp)(\?|$)/i.test(u));

  const detailImages = imageUrls.filter(u =>
    /vendor_inventory|vendor|product-detail|contents|details|image\/retail|content/i.test(u)
  );

  const productImages = imageUrls.filter(u => !detailImages.includes(u));

  return {
    total: imageUrls.length,
    mainImage: productImages[0] || imageUrls[0] || null,
    productImages,
    detailImages,
    allImages: imageUrls
  };
}

async function collectImagesWithPlaywright(coupangUrl) {
  const { chromium } = require('playwright-chromium');
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 900 },
    locale: 'ko-KR',
    extraHTTPHeaders: {
      'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7'
    }
  });

  const page = await context.newPage();
  page.setDefaultTimeout(15000);

  try {
    await page.goto(coupangUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(2500);

    // 상세 이미지 lazy-load 후보 확보용으로 조금만 스크롤
    for (let i = 0; i < 4; i++) {
      await page.mouse.wheel(0, 900);
      await page.waitForTimeout(700);
    }

    const title = await page.title().catch(() => '');
    const bodyText = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
    const html = await page.content().catch(() => '');

    const blocked = /Access Denied|captcha|로봇|자동입력|비정상|잠시 후 다시|현재 접속하신/i.test(title + '\n' + bodyText + '\n' + html);

    const data = await page.evaluate(() => {
      const urls = [];
      const push = v => {
        if (!v) return;
        String(v).split(',').forEach(part => {
          const first = part.trim().split(/\s+/)[0];
          if (first) urls.push(first);
        });
      };

      document.querySelectorAll('img').forEach(img => {
        push(img.currentSrc);
        push(img.src);
        push(img.getAttribute('data-src'));
        push(img.getAttribute('data-lazy-src'));
        push(img.getAttribute('data-original'));
        push(img.getAttribute('srcset'));
      });

      document.querySelectorAll('*').forEach(el => {
        const bg = getComputedStyle(el).backgroundImage;
        if (bg && bg !== 'none') {
          const matches = bg.match(/url\(["']?([^"')]+)["']?\)/g) || [];
          matches.forEach(m => {
            const mm = m.match(/url\(["']?([^"')]+)["']?\)/);
            if (mm && mm[1]) urls.push(mm[1]);
          });
        }
      });

      return {
        title: document.title || '',
        bodyText: (document.body && document.body.innerText || '').slice(0, 1000),
        urls
      };
    });

    const regexUrls = [];
    const re = /https?:\\?\/\\?\/[^"'\\\s<>]+?(?:jpg|jpeg|png|webp)(?:\?[^"'\\\s<>]*)?/gi;
    let m;
    while ((m = re.exec(html))) {
      regexUrls.push(m[0].replace(/\\\//g, '/'));
    }

    await browser.close();

    return {
      blocked,
      title: data.title || title,
      bodySample: data.bodyText || bodyText.slice(0, 1000),
      rawUrls: uniq([...(data.urls || []), ...regexUrls])
    };
  } catch (err) {
    await browser.close().catch(() => {});
    throw err;
  }
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  if (req.method === 'OPTIONS') return sendJson(res, 200, { ok: true });

  if (pathname === '/') return sendText(res, 200, `Glomart API running ${VERSION}`);
  if (pathname === '/check') return sendText(res, 200, `NEW CODE OK ${VERSION}`);

  const ids = parseKey(parsedUrl.query.key);

  if (pathname === '/coupang' || pathname === '/coupang-json' || pathname === '/coupang-images') {
    if (!ids) {
      return sendJson(res, 400, {
        ok: false,
        version: VERSION,
        message: 'key 형식 오류: productId_itemId_vendorItemId 필요'
      });
    }
  }

  if (pathname === '/coupang') {
    const coupangUrl = buildCoupangUrl(ids);
    res.writeHead(302, { Location: coupangUrl });
    return res.end();
  }

  if (pathname === '/coupang-json') {
    const coupangUrl = buildCoupangUrl(ids);
    return sendJson(res, 200, { ok: true, version: VERSION, ...ids, coupangUrl });
  }

  if (pathname === '/coupang-images') {
    const coupangUrl = buildCoupangUrl(ids);
    try {
      const live = await collectImagesWithPlaywright(coupangUrl);
      const images = classifyImages(live.rawUrls || []);

      if (live.blocked || images.total === 0) {
        return sendJson(res, 200, {
          ok: false,
          version: VERSION,
          fallback: true,
          reason: live.blocked ? 'BLOCKED_OR_CAPTCHA' : 'NO_IMAGE_FOUND',
          ...ids,
          coupangUrl,
          pageTitle: live.title,
          images
        });
      }

      return sendJson(res, 200, {
        ok: true,
        version: VERSION,
        fallback: false,
        ...ids,
        coupangUrl,
        pageTitle: live.title,
        images
      });
    } catch (err) {
      return sendJson(res, 200, {
        ok: false,
        version: VERSION,
        fallback: true,
        reason: 'PLAYWRIGHT_ERROR',
        error: String(err && err.message || err),
        ...ids,
        coupangUrl,
        images: { total: 0, mainImage: null, productImages: [], detailImages: [], allImages: [] }
      });
    }
  }

  return sendText(res, 404, 'Not found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Glomart API ${VERSION} running on ${PORT}`);
});

