const http = require('http');
const url = require('url');

const PORT = process.env.PORT || 3000;

function sendText(res, statusCode, text) {
  res.writeHead(statusCode, { 'Content-Type': 'text/plain; charset=utf-8' });
  return res.end(text);
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  return res.end(JSON.stringify(data));
}

function buildCoupangData(query) {
  const key = String(query.key || '').trim();
  const parts = key.split('_');

  if (parts.length < 3 || !parts[0] || !parts[1] || !parts[2]) {
    return {
      ok: false,
      error: 'INVALID_KEY',
      message: 'key 형식 오류: productId_itemId_vendorItemId 필요',
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
    return sendText(res, 200, 'Glomart API running REDIRECT V2.2');
  }

  if (pathname === '/check') {
    return sendText(res, 200, 'NEW CODE OK REDIRECT V2.2');
  }

  if (pathname === '/test') {
    return sendJson(res, 200, {
      status: 'ok',
      message: 'API works',
      version: 'redirect-v2.2'
    });
  }

  // JSON 확인용: 쿠팡 주소를 JSON으로 보여줌
  if (pathname === '/coupang-json') {
    const data = buildCoupangData(parsedUrl.query);
    if (!data.ok) return sendJson(res, 400, data);
    return sendJson(res, 200, data);
  }

  // 실사용용: 바로 쿠팡으로 이동
  if (pathname === '/coupang') {
    const data = buildCoupangData(parsedUrl.query);
    if (!data.ok) return sendJson(res, 400, data);

    res.writeHead(302, {
      Location: data.coupangUrl,
      'Cache-Control': 'no-store'
    });
    return res.end();
  }

  return sendText(res, 404, 'Not found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Glomart API redirect-v2.2 running on ${PORT}`);
});

