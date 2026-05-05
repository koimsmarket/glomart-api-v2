const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const VERSION = 'DETAIL VIEWER V1.0';
const DATA_FILE = path.join(__dirname, 'product_data.json');

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': type,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  if (type.includes('application/json')) return res.end(JSON.stringify(body, null, 2));
  return res.end(body);
}

function readProducts() {
  try {
    if (!fs.existsSync(DATA_FILE)) return {};
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {
    return {};
  }
}

function parseKey(key) {
  const parts = String(key || '').trim().split('_');
  if (parts.length < 3) return null;
  return { productId: parts[0], itemId: parts[1], vendorItemId: parts[2], key: parts.slice(0, 3).join('_') };
}

function coupangUrlFromKey(key) {
  const p = parseKey(key);
  if (!p) return null;
  return `https://www.coupang.com/vp/products/${p.productId}?itemId=${p.itemId}&vendorItemId=${p.vendorItemId}`;
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') return send(res, 200, { ok: true });

  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  if (pathname === '/') {
    return send(res, 200, `Glomart API running ${VERSION}`, 'text/plain; charset=utf-8');
  }

  if (pathname === '/check') {
    return send(res, 200, `NEW CODE OK ${VERSION}`, 'text/plain; charset=utf-8');
  }

  if (pathname === '/coupang-json') {
    const key = parsedUrl.query.key;
    const p = parseKey(key);
    if (!p) return send(res, 400, { ok: false, message: 'key 형식 오류: productId_itemId_vendorItemId 필요' });
    return send(res, 200, { ok: true, ...p, coupangUrl: coupangUrlFromKey(key) });
  }

  if (pathname === '/coupang') {
    const coupangUrl = coupangUrlFromKey(parsedUrl.query.key);
    if (!coupangUrl) return send(res, 400, { ok: false, message: 'key 형식 오류' });
    res.writeHead(302, { Location: coupangUrl });
    return res.end();
  }

  if (pathname === '/product-detail') {
    const keyInfo = parseKey(parsedUrl.query.key);
    if (!keyInfo) return send(res, 400, { ok: false, message: 'key 형식 오류: productId_itemId_vendorItemId 필요' });

    const products = readProducts();
    const item = products[keyInfo.key] || null;

    return send(res, 200, {
      ok: true,
      version: VERSION,
      found: !!item,
      key: keyInfo.key,
      productId: keyInfo.productId,
      itemId: keyInfo.itemId,
      vendorItemId: keyInfo.vendorItemId,
      coupangUrl: coupangUrlFromKey(keyInfo.key),
      product: item || {
        title: '',
        price: null,
        soldOut: null,
        options: [],
        productImages: [],
        detailImages: [],
        note: '등록된 상세 데이터 없음'
      }
    });
  }

  if (pathname === '/glomart_detail_viewer_v1_0.js') {
    const jsPath = path.join(__dirname, 'glomart_detail_viewer_v1_0.js');
    if (!fs.existsSync(jsPath)) return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
    return send(res, 200, fs.readFileSync(jsPath, 'utf8'), 'application/javascript; charset=utf-8');
  }

  return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Glomart API ${VERSION} running on ${PORT}`);
});

