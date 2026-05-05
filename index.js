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

function buildCoupangUrlFromKey(key) {
  const cleanKey = String(key || '').trim();
  const parts = cleanKey.split('_');

  if (parts.length < 3) {
    return {
      ok: false,
      message: 'key 형식 오류: productId_itemId_vendorItemId 필요',
      example: '/coupang?key=123_456_789'
    };
  }

  const productId = parts[0];
  const itemId = parts[1];
  const vendorItemId = parts[2];

  if (!productId || !itemId || !vendorItemId) {
    return {
      ok: false,
      message: 'key 값 오류: productId, itemId, vendorItemId가 모두 필요합니다.',
      example: '/coupang?key=123_456_789'
    };
  }

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

  // 기본 확인
  if (pathname === '/') {
    return sendText(res, 200, 'Glomart API running V2.1');
  }

  // 새 코드 반영 확인
  if (pathname === '/check') {
    return sendText(res, 200, 'NEW CODE OK V2.1');
  }

  // 서버 테스트
  if (pathname === '/test') {
    return sendJson(res, 200, {
      status: 'ok',
      message: 'API works',
      version: 'V2.1'
    });
  }

  // 실사용: 쿠팡으로 바로 이동
  if (pathname === '/coupang') {
    const result = buildCoupangUrlFromKey(parsedUrl.query.key);

    if (!result.ok) {
      return sendJson(res, 400, result);
    }

    res.writeHead(302, {
      Location: result.coupangUrl,
      'Cache-Control': 'no-store'
    });
    return res.end();
  }

  // 확인용: JSON으로 쿠팡 URL 확인
  if (pathname === '/coupang-json') {
    const result = buildCoupangUrlFromKey(parsedUrl.query.key);
    return sendJson(res, result.ok ? 200 : 400, result);
  }

  return sendText(res, 404, 'Not found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Glomart API V2.1 running on ${PORT}`);
});

