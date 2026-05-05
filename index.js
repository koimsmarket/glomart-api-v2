const http = require('http');
const url = require('url');

const PORT = process.env.PORT || 3000;
const VERSION = 'REDIRECT V2.3';

function sendText(res, statusCode, text) {
  res.writeHead(statusCode, { 'Content-Type': 'text/plain; charset=utf-8' });
  return res.end(text);
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  return res.end(JSON.stringify(data));
}

function makeCoupangUrl(key) {
  const cleanKey = String(key || '').trim();
  const parts = cleanKey.split('_');

  if (parts.length < 3 || !parts[0] || !parts[1] || !parts[2]) {
    return {
      ok: false,
      error: 'key ?뺤떇 ?ㅻ쪟: productId_itemId_vendorItemId ?꾩슂',
      example: '/coupang?key=123_456_789'
    };
  }

  const [productId, itemId, vendorItemId] = parts;
  const coupangUrl =
    `https://www.coupang.com/vp/products/${encodeURIComponent(productId)}` +
    `?itemId=${encodeURIComponent(itemId)}&vendorItemId=${encodeURIComponent(vendorItemId)}`;

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
      ok: true,
      status: 'ok',
      version: VERSION,
      message: 'API works'
    });
  }

  if (pathname === '/coupang-json') {
    const result = makeCoupangUrl(parsedUrl.query.key);
    return sendJson(res, result.ok ? 200 : 400, result);
  }

  if (pathname === '/coupang') {
    const result = makeCoupangUrl(parsedUrl.query.key);

    if (!result.ok) {
      return sendJson(res, 400, result);
    }

    res.writeHead(302, {
      Location: result.coupangUrl,
      'Content-Type': 'text/plain; charset=utf-8'
    });
    return res.end(`Redirecting to ${result.coupangUrl}`);
  }

  return sendText(res, 404, 'Not found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Glomart API running ${VERSION} on ${PORT}`);
});

