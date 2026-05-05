const http = require("http");
const url = require("url");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, "data");
const ORDERS_FILE = path.join(DATA_DIR, "orders.json");
const PRODUCTS_FILE = path.join(DATA_DIR, "products.json");

function ensureDataFiles() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(ORDERS_FILE)) fs.writeFileSync(ORDERS_FILE, "[]", "utf8");
  if (!fs.existsSync(PRODUCTS_FILE)) fs.writeFileSync(PRODUCTS_FILE, "[]", "utf8");
}

function readJson(file, fallback) {
  ensureDataFiles();
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (e) { return fallback; }
}

function writeJson(file, data) {
  ensureDataFiles();
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  res.end(JSON.stringify(data, null, 2));
}

function sendText(res, statusCode, text) {
  res.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    "Access-Control-Allow-Origin": "*"
  });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk.toString();
      if (body.length > 2 * 1024 * 1024) {
        req.destroy();
        reject(new Error("BODY_TOO_LARGE"));
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function makeOrderId() {
  const d = new Date();
  const pad = n => String(n).padStart(2, "0");
  const stamp = d.getFullYear() + pad(d.getMonth()+1) + pad(d.getDate()) + "_" + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
  const rnd = Math.random().toString(36).slice(2, 8).toUpperCase();
  return "GM_ORDER_" + stamp + "_" + rnd;
}

function normalizeKey(v) {
  return String(v || "").trim();
}

function findRegisteredProduct(payload) {
  const products = readJson(PRODUCTS_FILE, []);
  const productNo = normalizeKey(payload.productNo || payload.productId);
  const itemId = normalizeKey(payload.itemId);
  const vendorItemId = normalizeKey(payload.vendorItemId);
  const cafe24ProductNo = normalizeKey(payload.cafe24ProductNo);
  const cafe24VariantCode = normalizeKey(payload.cafe24VariantCode);

  return products.find(p => {
    const sameCoupang = productNo && itemId && vendorItemId &&
      normalizeKey(p.productNo || p.productId) === productNo &&
      normalizeKey(p.itemId) === itemId &&
      normalizeKey(p.vendorItemId) === vendorItemId;

    const sameCafe24 = cafe24ProductNo && cafe24VariantCode &&
      normalizeKey(p.cafe24ProductNo) === cafe24ProductNo &&
      normalizeKey(p.cafe24VariantCode) === cafe24VariantCode;

    return sameCoupang || sameCafe24;
  }) || null;
}

function decideOrderRoute(payload) {
  const matched = findRegisteredProduct(payload);
  if (matched && matched.cafe24ProductNo && matched.cafe24VariantCode) {
    return { route: "CAFE24_READY", matchedProduct: matched, message: "등록상품/옵션 일치: 카페24 주문 연동 가능" };
  }
  return {
    route: "SERVER_DB",
    matchedProduct: matched,
    message: matched ? "상품은 매칭되었지만 카페24 옵션코드가 부족하여 서버 DB 저장" : "미등록상품 또는 옵션 불일치: 서버 DB 저장"
  };
}

function buildCoupangUrlFromPayload(payload) {
  const productId = normalizeKey(payload.productId || payload.productNo);
  const itemId = normalizeKey(payload.itemId);
  const vendorItemId = normalizeKey(payload.vendorItemId);
  if (!productId || !itemId || !vendorItemId) return "";
  return "https://www.coupang.com/vp/products/" + productId + "?itemId=" + itemId + "&vendorItemId=" + vendorItemId;
}

async function handleOrder(req, res) {
  let bodyText = "";
  try { bodyText = await readBody(req); }
  catch (e) { return sendJson(res, 413, { ok: false, error: "BODY_TOO_LARGE" }); }

  let payload;
  try { payload = bodyText ? JSON.parse(bodyText) : {}; }
  catch (e) { return sendJson(res, 400, { ok: false, error: "INVALID_JSON" }); }

  const customerName = normalizeKey(payload.customerName);
  const phone = normalizeKey(payload.phone);
  const productName = normalizeKey(payload.productName);
  const qty = Number(payload.qty || payload.quantity || 1);

  if (!customerName || !phone || !productName) {
    return sendJson(res, 400, { ok: false, error: "REQUIRED_FIELD_MISSING", required: ["customerName", "phone", "productName"] });
  }

  const routeInfo = decideOrderRoute(payload);
  const now = new Date().toISOString();

  const order = {
    orderId: makeOrderId(),
    createdAt: now,
    updatedAt: now,
    status: "입금대기",
    route: routeInfo.route,
    routeMessage: routeInfo.message,
    customer: {
      name: customerName,
      phone: phone,
      email: normalizeKey(payload.email),
      address1: normalizeKey(payload.address1),
      address2: normalizeKey(payload.address2),
      postcode: normalizeKey(payload.postcode),
      memo: normalizeKey(payload.memo)
    },
    product: {
      source: normalizeKey(payload.source || "glomart"),
      productName: productName,
      optionName: normalizeKey(payload.optionName),
      qty: Number.isFinite(qty) && qty > 0 ? qty : 1,
      price: Number(payload.price || 0),
      productId: normalizeKey(payload.productId || payload.productNo),
      itemId: normalizeKey(payload.itemId),
      vendorItemId: normalizeKey(payload.vendorItemId),
      coupangUrl: normalizeKey(payload.coupangUrl) || buildCoupangUrlFromPayload(payload),
      image: normalizeKey(payload.image),
      cafe24ProductNo: normalizeKey(payload.cafe24ProductNo),
      cafe24VariantCode: normalizeKey(payload.cafe24VariantCode)
    },
    matchedProduct: routeInfo.matchedProduct || null,
    raw: payload
  };

  const orders = readJson(ORDERS_FILE, []);
  orders.unshift(order);
  writeJson(ORDERS_FILE, orders);

  return sendJson(res, 200, { ok: true, orderId: order.orderId, status: order.status, route: order.route, routeMessage: order.routeMessage, order: order });
}

async function handleUpdateStatus(req, res) {
  let payload;
  try { payload = JSON.parse(await readBody(req)); }
  catch (e) { return sendJson(res, 400, { ok: false, error: "INVALID_JSON" }); }

  const orderId = normalizeKey(payload.orderId);
  const status = normalizeKey(payload.status);
  if (!orderId || !status) return sendJson(res, 400, { ok: false, error: "orderId/status required" });

  const orders = readJson(ORDERS_FILE, []);
  const idx = orders.findIndex(o => o.orderId === orderId);
  if (idx < 0) return sendJson(res, 404, { ok: false, error: "ORDER_NOT_FOUND" });

  orders[idx].status = status;
  orders[idx].updatedAt = new Date().toISOString();
  if (payload.adminMemo !== undefined) orders[idx].adminMemo = normalizeKey(payload.adminMemo);
  writeJson(ORDERS_FILE, orders);
  return sendJson(res, 200, { ok: true, order: orders[idx] });
}

function handleOrders(req, res, query) {
  const orders = readJson(ORDERS_FILE, []);
  const limit = Math.min(Number(query.limit || 50), 200);
  const status = normalizeKey(query.status);
  let list = orders;
  if (status) list = list.filter(o => o.status === status);
  return sendJson(res, 200, { ok: true, count: list.length, orders: list.slice(0, limit) });
}

function handleProductMatch(req, res, query) {
  const payload = {
    productId: query.productId || query.productNo,
    itemId: query.itemId,
    vendorItemId: query.vendorItemId,
    cafe24ProductNo: query.cafe24ProductNo,
    cafe24VariantCode: query.cafe24VariantCode
  };
  const routeInfo = decideOrderRoute(payload);
  return sendJson(res, 200, { ok: true, route: routeInfo.route, message: routeInfo.message, matchedProduct: routeInfo.matchedProduct });
}

function handleCoupangJson(req, res, query) {
  const key = normalizeKey(query.key);
  const parts = key.split("_");
  if (parts.length < 3) return sendJson(res, 400, { ok: false, message: "key 형식 오류: productId_itemId_vendorItemId 필요" });
  const productId = parts[0], itemId = parts[1], vendorItemId = parts[2];
  const coupangUrl = "https://www.coupang.com/vp/products/" + productId + "?itemId=" + itemId + "&vendorItemId=" + vendorItemId;
  return sendJson(res, 200, { ok: true, productId: productId, itemId: itemId, vendorItemId: vendorItemId, coupangUrl: coupangUrl });
}

function handleCoupangRedirect(req, res, query) {
  const key = normalizeKey(query.key);
  const parts = key.split("_");
  if (parts.length < 3) return sendText(res, 400, "key 형식 오류: productId_itemId_vendorItemId 필요");
  const productId = parts[0], itemId = parts[1], vendorItemId = parts[2];
  const coupangUrl = "https://www.coupang.com/vp/products/" + productId + "?itemId=" + itemId + "&vendorItemId=" + vendorItemId;
  res.writeHead(302, { Location: coupangUrl });
  return res.end();
}

ensureDataFiles();

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  const query = parsedUrl.query || {};

  if (req.method === "OPTIONS") return sendJson(res, 200, { ok: true });
  if (pathname === "/") return sendText(res, 200, "Glomart API running ORDER V1.0");
  if (pathname === "/check") return sendText(res, 200, "NEW CODE OK ORDER V1.0");

  if (pathname === "/coupang-json" && req.method === "GET") return handleCoupangJson(req, res, query);
  if (pathname === "/coupang" && req.method === "GET") return handleCoupangRedirect(req, res, query);
  if (pathname === "/product-match" && req.method === "GET") return handleProductMatch(req, res, query);
  if (pathname === "/order" && req.method === "POST") return handleOrder(req, res);
  if (pathname === "/orders" && req.method === "GET") return handleOrders(req, res, query);
  if (pathname === "/order-status" && req.method === "POST") return handleUpdateStatus(req, res);

  return sendJson(res, 404, { ok: false, error: "NOT_FOUND", pathname: pathname });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("Glomart order API V1.0 running on " + PORT);
});

