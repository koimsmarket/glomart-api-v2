const http = require('http');
const url = require('url');

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // ✅ 기본 확인
  if (pathname === "/") {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('Glomart API running');
  }

  // ✅ 테스트
  if (pathname === "/test") {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      status: "ok",
      message: "API works"
    }));
  }

  // ✅ 쿠팡 API (핵심)
  if (pathname === "/coupang") {
    const key = String(parsedUrl.query.key || "").trim();
    const parts = key.split("_");

    if (parts.length < 3) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        ok: false,
        message: "key 형식 오류: productId_itemId_vendorItemId 필요"
      }));
    }

    const [productId, itemId, vendorItemId] = parts;

    const coupangUrl =
      `https://www.coupang.com/vp/products/${productId}` +
      `?itemId=${itemId}&vendorItemId=${vendorItemId}`;

    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      ok: true,
      productId,
      itemId,
      vendorItemId,
      coupangUrl
    }));
  }

  // ❌ 나머지
  res.writeHead(404);
  res.end("Not found");
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on ${PORT}`);
});

if (pathname === "/check") {
  return res.end("NEW CODE OK");
}
