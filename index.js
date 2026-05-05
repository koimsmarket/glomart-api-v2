const http = require('http');
const https = require('https');
const url = require('url');

const PORT = process.env.PORT || 3000;
const VERSION = 'IMAGE V4.0';

function sendText(res, status, text) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  return res.end(text);
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  return res.end(JSON.stringify(data, null, 2));
}

function parseKey(key) {
  const cleanKey = String(key || '').trim();
  const parts = cleanKey.split('_').map(v => v.trim()).filter(Boolean);
  if (parts.length < 3) return null;
  return {
    productId: parts[0],
    itemId: parts[1],
    vendorItemId: parts[2]
  };
}

function makeCoupangUrl(productId, itemId, vendorItemId) {
  return `https://www.coupang.com/vp/products/${productId}?itemId=${itemId}&vendorItemId=${vendorItemId}`;
}

function fetchText(targetUrl, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(targetUrl);
    const options = {
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      timeout: timeoutMs,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Referer': 'https://www.coupang.com/'
      }
    };

    const req = https.request(options, (resp) => {
      let body = '';
      resp.setEncoding('utf8');
      resp.on('data', chunk => {
        body += chunk;
        if (body.length > 6_000_000) {
          req.destroy(new Error('HTML_TOO_LARGE'));
        }
      });
      resp.on('end', () => {
        resolve({ statusCode: resp.statusCode, headers: resp.headers, body });
      });
    });

    req.on('timeout', () => req.destroy(new Error('TIMEOUT')));
    req.on('error', reject);
    req.end();
  });
}

function normalizeImageUrl(raw) {
  if (!raw) return '';
  let s = String(raw).trim();
  s = s.replace(/\\u002F/g, '/').replace(/\\\//g, '/').replace(/&amp;/g, '&');
  s = s.replace(/^['\"]+|['\"]+$/g, '');
  if (s.startsWith('//')) s = 'https:' + s;
  if (s.startsWith('http://')) s = 'https://' + s.slice(7);
  return s;
}

function cleanImageUrl(u) {
  try {
    const x = new URL(u);
    x.search = '';
    return x.toString();
  } catch (e) {
    return u;
  }
}

function isCoupangImage(u) {
  return /^https:\/\//i.test(u) && /(?:coupangcdn\.com|coupang\.com)/i.test(u) && /\.(?:jpg|jpeg|png|webp)(?:$|\?)/i.test(u);
}

function scoreImage(u) {
  let score = 0;
  if (/thumbnail/i.test(u)) score += 10;
  if (/vendor_inventory|image\d*\.coupangcdn|thumbnail\d*\.coupangcdn/i.test(u)) score += 10;
  if (/492x492|500x500|600x600|700x700|800x800|1000x1000|1200x1200/i.test(u)) score += 20;
  if (/detail|contents|product_detail|product-detail|desc/i.test(u)) score += 35;
  if (/230x230|160x160|48x48|60x60|80x80|100x100/i.test(u)) score -= 20;
  return score;
}

function extractImagesFromHtml(html) {
  const found = new Map();

  const patterns = [
    /https?:\\?\/\\?\/[^\s'\"<>\\]+?\.(?:jpg|jpeg|png|webp)(?:\?[^\s'\"<>\\]*)?/gi,
    /\/\/[^\s'\"<>\\]+?\.(?:jpg|jpeg|png|webp)(?:\?[^\s'\"<>\\]*)?/gi,
    /(?:src|data-src|data-original|content)=["']([^"']+\.(?:jpg|jpeg|png|webp)(?:\?[^"']*)?)["']/gi,
    /"(?:image|imageUrl|originImage|detailImage|vendorItemImageUrl|thumbnailUrl|url)"\s*:\s*"([^"]+\.(?:jpg|jpeg|png|webp)(?:\?[^"]*)?)"/gi
  ];

  for (const re of patterns) {
    let m;
    while ((m = re.exec(html)) !== null) {
      const raw = m[1] || m[0];
      const normalized = cleanImageUrl(normalizeImageUrl(raw));
      if (!isCoupangImage(normalized)) continue;
      if (!found.has(normalized)) {
        found.set(normalized, {
          url: normalized,
          score: scoreImage(normalized)
        });
      }
    }
  }

  const all = Array.from(found.values())
    .sort((a, b) => b.score - a.score)
    .map(x => x.url);

  const detailImages = all.filter(u => /detail|contents|product_detail|product-detail|desc|vendor_inventory/i.test(u)).slice(0, 80);
  const productImages = all.filter(u => !detailImages.includes(u)).slice(0, 40);

  return {
    total: all.length,
    mainImage: productImages[0] || all[0] || null,
    productImages,
    detailImages,
    allImages: all.slice(0, 120)
  };
}

async function handleCoupangImages(req, res, query) {
  const keyInfo = parseKey(query.key);
  if (!keyInfo) {
    return sendJson(res, 400, {
      ok: false,
      version: VERSION,
      message: 'key 형식 오류: productId_itemId_vendorItemId 필요'
    });
  }

  const { productId, itemId, vendorItemId } = keyInfo;
  const coupangUrl = makeCoupangUrl(productId, itemId, vendorItemId);

  try {
    const fetched = await fetchText(coupangUrl, 12000);
    const blocked = /Access Denied|captcha|Robot Check|봇|자동화|abnormal/i.test(fetched.body || '');

    if (fetched.statusCode >= 400 || blocked) {
      return sendJson(res, 200, {
        ok: false,
        version: VERSION,
        fallback: true,
        reason: blocked ? 'BLOCKED_OR_CAPTCHA' : `HTTP_${fetched.statusCode}`,
        productId,
        itemId,
        vendorItemId,
        coupangUrl,
        images: {
          total: 0,
          mainImage: null,
          productImages: [],
          detailImages: [],
          allImages: []
        }
      });
    }

    const images = extractImagesFromHtml(fetched.body || '');

    return sendJson(res, 200, {
      ok: true,
      version: VERSION,
      productId,
      itemId,
      vendorItemId,
      coupangUrl,
      fetchedStatus: fetched.statusCode,
      images
    });
  } catch (err) {
    return sendJson(res, 200, {
      ok: false,
      version: VERSION,
      fallback: true,
      reason: err && err.message ? err.message : 'FETCH_FAILED',
      productId,
      itemId,
      vendorItemId,
      coupangUrl,
      images: {
        total: 0,
        mainImage: null,
        productImages: [],
        detailImages: [],
        allImages: []
      }
    });
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    return res.end();
  }

  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  const query = parsedUrl.query || {};

  if (pathname === '/') {
    return sendText(res, 200, `Glomart API running ${VERSION}`);
  }

  if (pathname === '/check') {
    return sendText(res, 200, `NEW CODE OK ${VERSION}`);
  }

  if (pathname === '/test') {
    return sendJson(res, 200, {
      status: 'ok',
      version: VERSION,
      message: 'API works'
    });
  }

  if (pathname === '/coupang-json') {
    const keyInfo = parseKey(query.key);
    if (!keyInfo) {
      return sendJson(res, 400, {
        ok: false,
        version: VERSION,
        message: 'key 형식 오류: productId_itemId_vendorItemId 필요'
      });
    }
    const { productId, itemId, vendorItemId } = keyInfo;
    return sendJson(res, 200, {
      ok: true,
      version: VERSION,
      productId,
      itemId,
      vendorItemId,
      coupangUrl: makeCoupangUrl(productId, itemId, vendorItemId)
    });
  }

  if (pathname === '/coupang') {
    const keyInfo = parseKey(query.key);
    if (!keyInfo) {
      return sendJson(res, 400, {
        ok: false,
        version: VERSION,
        message: 'key 형식 오류: productId_itemId_vendorItemId 필요'
      });
    }
    const { productId, itemId, vendorItemId } = keyInfo;
    const coupangUrl = makeCoupangUrl(productId, itemId, vendorItemId);
    res.writeHead(302, { Location: coupangUrl });
    return res.end();
  }

  if (pathname === '/coupang-images' || pathname === '/coupang-live') {
    return handleCoupangImages(req, res, query);
  }

  return sendJson(res, 404, {
    ok: false,
    version: VERSION,
    message: 'Not found'
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on ${PORT} / ${VERSION}`);
});

