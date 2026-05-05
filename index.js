const http = require('http');
const url = require('url');

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // 기본 확인
  if (pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Glomart API running');
  }

  // 배포 반영 확인
  if (pathname === '/check') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('NEW CODE OK');
  }

  // 테스트 API
  if (pathname === '/test') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({
      status: 'ok',
      message: 'API works'
    }));
  }

  // 쿠팡 URL 생성 API
  if (pathname === '/coupang') {
    const key = String(parsedUrl.query.key || '').trim();
    const parts = key.split('_');

    if (parts.length < 3 || !parts[0] || !parts[1] || !parts[2]) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({
        ok: false,
        message: 'key 형식 오류: productId_itemId_vendorItemId 필요',
        example: '/coupang?key=123_456_789'
      }));
    }

    const [productId, itemId, vendorItemId] = parts;

    const coupangUrl =
      `https://www.coupang.com/vp/products/${encodeURIComponent(productId)}` +
      `?itemId=${encodeURIComponent(itemId)}` +
      `&vendorItemId=${encodeURIComponent(vendorItemId)}`;

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({
      ok: true,
      productId,
      itemId,
      vendorItemId,
      coupangUrl
    }));
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  return res.end('Not found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on ${PORT}`);
});

