const http = require('http');
const url = require('url');

const PORT = process.env.PORT || 3000;
const VERSION = 'REDIRECT V2.4';

function sendText(res, status, text) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  return res.end(text);
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  return res.end(JSON.stringify(data));
}

function buildCoupangUrl(key) {
  const cleanKey = String(key || '').trim();
  const parts = cleanKey.split('_');

  if (parts.length < 3) {
    return {
      ok: false,
      error: 'key 형식 오류: productId_itemId_vendorItemId 필요',
      example: '/coupang?key=123_456_789'
    };
  }

  const [productId, itemId, vendorItemId] = parts;
  const coupangUrl =
    `https://www.coupang.com/vp/products/${encodeURIComponent(productId)}` +
    `?itemId=${encodeURIComponent(itemId)}` +
    `&vendorItemId=${encodeURIComponent(vendorItemId)}`;

  return {
    ok: true,
    productId,
    itemId,
    vendorItemId,
    coupangUrl
  };
}

const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  if (pathname === '/') {
    return sendText(res, 200, `Glomart API running ${VERSION}`);
  }

  if (pathname === '/check') {
    return sendText(res, 200, `NEW CODE OK ${VERSION}`);
  }

  if (pathname === '/test') {
    return sendJson(res, 200, {
      status: 'ok',
      message: 'API works',
      version: VERSION
    });
  }

  // JSON 확인용: 쿠팡 주소를 JSON으로 보여줌
  if (pathname === '/coupang-json') {
    const result = buildCoupangUrl(parsedUrl.query.key);
    if (!result.ok) return sendJson(res, 400, result);
    return sendJson(res, 200, result);
  }

  // 실사용용: 쿠팡으로 바로 이동
  if (pathname === '/coupang') {
    const result = buildCoupangUrl(parsedUrl.query.key);
    if (!result.ok) return sendJson(res, 400, result);

    res.writeHead(302, {
      Location: result.coupangUrl,
      'Cache-Control': 'no-store'
    });
    return res.end();
  }

  return sendText(res, 404, 'Not found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Glomart API ${VERSION} running on ${PORT}`);
});

