const http = require('http');

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  if (req.url === "/") {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Glomart API running');
  }

  else if (req.url === "/test") {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: "ok",
      message: "API works"
    }));
  }

  else {
    res.writeHead(404);
    res.end("Not found");
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(Server running on ${PORT});
});

app.get("/coupang", (req, res) => {
  const key = String(req.query.key || "").trim();

  const parts = key.split("_");
  if (parts.length < 3) {
    return res.status(400).json({
      ok: false,
      message: "key 형식 오류: productId_itemId_vendorItemId 필요"
    });
  }

  const [productId, itemId, vendorItemId] = parts;

  const coupangUrl =
    `https://www.coupang.com/vp/products/${productId}` +
    `?itemId=${itemId}&vendorItemId=${vendorItemId}`;

  res.json({
    ok: true,
    productId,
    itemId,
    vendorItemId,
    coupangUrl
  });
});
