
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.static('public'));
const PORT = Number(process.env.PORT || 3000);
const VERSION = 'GLOMART_USER_DEVICE_COLLECT_TEST_V1_3_CACHE_ALL_20260507';

const DATA_DIR = process.env.DATA_DIR || '/tmp/glomart-data';
const CACHE_FILE = path.join(DATA_DIR, 'coupang_cache.json');
const ORDER_FILE = path.join(DATA_DIR, 'orders.json');

fs.mkdirSync(DATA_DIR, { recursive: true });

app.use(express.json({ limit: '12mb' }));
app.use(express.urlencoded({ extended: true, limit: '12mb' }));
app.use(cors({ origin: true, credentials: false }));
app.use('/public', express.static(path.join(__dirname, 'public')));

function nowIso(){ return new Date().toISOString(); }
function cleanText(v){ return String(v || '').replace(/[\u00A0\u200B-\u200D\uFEFF]/g, ' ').replace(/\s+/g, ' ').trim(); }
function readJson(file, fallback){ try{ if(!fs.existsSync(file)) return fallback; return JSON.parse(fs.readFileSync(file,'utf8')); }catch(e){ return fallback; } }
function writeJson(file, data){ fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8'); }
function ok(res, data){ res.json({ ok:true, version:VERSION, ...data }); }
function fail(res, status, message, extra={}){ res.status(status).json({ ok:false, version:VERSION, error:message, ...extra }); }
function normalizeUrl(url){ url = cleanText(url); if(url.startsWith('//')) return 'https:' + url; return url; }
function idsFromUrl(url){
  const s = String(url || '');
  const out = { productId:'', itemId:'', vendorItemId:'' };
  let m = s.match(/\/vp\/products\/(\d+)/); if(m) out.productId = m[1];
  m = s.match(/[?&]itemId=(\d+)/); if(m) out.itemId = m[1];
  m = s.match(/[?&]vendorItemId=(\d+)/); if(m) out.vendorItemId = m[1];
  return out;
}
function makeKey(item){
  return cleanText(item.vendorItemId) ||
    [cleanText(item.productId), cleanText(item.itemId)].filter(Boolean).join('_') ||
    cleanText(item.url) ||
    cleanText(item.title);
}
function normalizeItem(raw){
  raw = raw || {};
  const url = normalizeUrl(raw.url || raw.href || raw.productUrl || '');
  const ids = idsFromUrl(url);
  const item = {
    key:'',
    source: cleanText(raw.source || 'coupang'),
    collectedAt: nowIso(),
    pageUrl: normalizeUrl(raw.pageUrl || ''),
    title: cleanText(raw.title || raw.name || raw.productName),
    image: normalizeUrl(raw.image || raw.imageUrl || raw.thumbnail || ''),
    priceText: cleanText(raw.priceText || raw.price || ''),
    deliveryText: cleanText(raw.deliveryText || raw.delivery || ''),
    url,
    productId: cleanText(raw.productId || ids.productId),
    itemId: cleanText(raw.itemId || ids.itemId),
    vendorItemId: cleanText(raw.vendorItemId || raw.venderItemId || ids.vendorItemId),
    optionText: cleanText(raw.optionText || raw.option || ''),
    stockText: cleanText(raw.stockText || raw.stock || ''),
    raw: raw.raw || null
  };
  item.key = makeKey(item);
  return item;
}
function savePayload(payload){
  const body = payload || {};
  const arr = Array.isArray(body.items) ? body.items : [body.item || body];
  const cache = readJson(CACHE_FILE, { items:{}, updatedAt:null });
  cache.items = cache.items || {};
  const saved = [], skipped = [];
  for(const raw0 of arr){
    const raw = { ...(raw0 || {}), pageUrl: body.pageUrl || raw0.pageUrl || '' };
    const item = normalizeItem(raw);
    if(!item.key){ skipped.push({ reason:'missing key', raw }); continue; }
    cache.items[item.key] = { ...(cache.items[item.key] || {}), ...item, collectedAt:nowIso() };
    saved.push(cache.items[item.key]);
  }
  cache.updatedAt = nowIso();
  writeJson(CACHE_FILE, cache);
  return { saved, skipped };
}
function searchCache(keyword, page=1, pageSize=40){
  keyword = cleanText(keyword).toLowerCase();
  const cache = readJson(CACHE_FILE, { items:{}, updatedAt:null });
  let list = Object.values(cache.items || {});
  if(keyword){
    list = list.filter(it => [it.title,it.optionText,it.priceText,it.deliveryText,it.productId,it.itemId,it.vendorItemId,it.url].join(' ').toLowerCase().includes(keyword));
  }
  list.sort((a,b) => String(b.collectedAt || '').localeCompare(String(a.collectedAt || '')));
  const total = list.length;
  const start = (page - 1) * pageSize;
  const items = list.slice(start, start + pageSize).map((it, idx) => ({ ...it, rank:start + idx + 1 }));
  return { total, page, pageSize, nextPage:start + pageSize < total ? page + 1 : null, prevPage:page > 1 ? page - 1 : null, items };
}

app.get('/', (req,res)=>ok(res, {
  service:'glomart-user-device-collect-test',
  mode:'inline-bookmarklet-formpost',
  routes:[
    'GET /health',
    'GET /public/collector_bookmarklet.html',
    'POST /module/scrap/api/collect',
    'POST /module/scrap/api/collect-form',
    'GET /module/scrap/api/cache/search?q=keyword&page=1',
    'GET /module/scrap/api/cache/all',
    'GET /public/glomart_cache_order_form.html',
    'POST /module/scrap/api/order/create',
    'GET /module/scrap/api/order/list'
  ]
}));
app.get('/health', (req,res)=>ok(res,{status:'running'}));

app.post('/module/scrap/api/collect', (req,res)=>{
  try{
    const result = savePayload(req.body || {});
    ok(res, { action:'collect', savedCount:result.saved.length, skippedCount:result.skipped.length, items:result.saved, skipped:result.skipped });
  }catch(e){ fail(res, 500, 'collect failed', { detail:String(e && e.message || e) }); }
});

app.post('/module/scrap/api/collect-form', (req,res)=>{
  try{
    let payload = {};
    if(req.body && req.body.payload){
      payload = JSON.parse(req.body.payload);
    } else {
      payload = req.body || {};
    }
    const result = savePayload(payload);
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.end(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Glomart 수집 완료</title><style>body{font-family:Arial,"Noto Sans KR",sans-serif;padding:24px;line-height:1.7}a{display:inline-block;margin-top:14px;padding:10px 14px;background:#111;color:#fff;text-decoration:none;border-radius:8px}</style></head><body><h2>Glomart 수집 완료</h2><p>저장: ${result.saved.length}개 / 스킵: ${result.skipped.length}개</p><a href="/module/scrap/api/cache/search?q=&page=1" target="_blank">전체 캐시 보기</a><script>setTimeout(function(){try{window.close()}catch(e){}},1800);</script></body></html>`);
  }catch(e){
    res.status(500).setHeader('Content-Type','text/html; charset=utf-8');
    res.end('<h2>수집 실패</h2><pre>'+String(e && e.message || e)+'</pre>');
  }
});

app.get('/module/scrap/api/cache/search', (req,res)=>{
  try{
    const q = cleanText(req.query.q || req.query.keyword || '');
    const page = Math.max(1, parseInt(req.query.page || '1', 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize || '40', 10) || 40));
    ok(res, { action:'cache.search', source:'cache', keyword:q, cached:true, ...searchCache(q, page, pageSize) });
  }catch(e){ fail(res, 500, 'cache search failed', { detail:String(e && e.message || e) }); }
});

app.get('/module/scrap/api/cache/all', (req,res)=>{
  try{
    const cache = readJson(CACHE_FILE, { items:{}, updatedAt:null });
    const items = Object.values(cache.items || {})
      .sort((a,b) => String(b.collectedAt || '').localeCompare(String(a.collectedAt || '')))
      .map((it, idx) => ({ ...it, rank:idx + 1 }));
    ok(res, {
      action:'cache.all',
      source:'cache',
      cached:true,
      updatedAt:cache.updatedAt || null,
      total:items.length,
      items
    });
  }catch(e){ fail(res, 500, 'cache all failed', { detail:String(e && e.message || e) }); }
});

app.get('/module/scrap/api/search', (req,res)=>{
  try{
    const q = cleanText(req.query.q || req.query.keyword || '');
    const page = Math.max(1, parseInt(req.query.page || '1', 10) || 1);
    const result = searchCache(q, page, 40);
    ok(res, { action:'search', type:'search', source:'cache', keyword:q, cached:true, ...result, message:result.items.length ? 'OK_CACHE' : 'NO_CACHE_ITEMS' });
  }catch(e){ fail(res, 500, 'search failed', { detail:String(e && e.message || e) }); }
});

app.post('/module/scrap/api/order/create', (req,res)=>{
  try{
    const body = req.body || {};
    const key = cleanText(body.key || body.vendorItemId || body.venderItemId || '');
    const qty = Math.max(1, parseInt(body.qty || '1', 10) || 1);
    const cache = readJson(CACHE_FILE, { items:{} });
    let item = cache.items[key] || Object.values(cache.items || {}).find(x => x.vendorItemId === key || x.key === key);
    if(!item) return fail(res, 404, 'product not found in cache', { key });
    const orders = readJson(ORDER_FILE, { orders:[], updatedAt:null });
    const order = {
      orderId:'GM' + Date.now(),
      createdAt:nowIso(),
      status:'created',
      qty,
      product:{
        key:item.key, title:item.title, image:item.image, priceText:item.priceText, deliveryText:item.deliveryText,
        url:item.url, productId:item.productId, itemId:item.itemId, vendorItemId:item.vendorItemId, optionText:item.optionText
      },
      receiver: body.receiver || {},
      buyer: body.buyer || {},
      note: cleanText(body.note || '')
    };
    orders.orders.unshift(order);
    orders.updatedAt = nowIso();
    writeJson(ORDER_FILE, orders);
    ok(res, { action:'order.create', order });
  }catch(e){ fail(res, 500, 'order create failed', { detail:String(e && e.message || e) }); }
});
app.get('/module/scrap/api/order/list', (req,res)=>{
  const orders = readJson(ORDER_FILE, { orders:[] });
  ok(res, { action:'order.list', total:orders.orders.length, orders:orders.orders });
});

app.listen(PORT, ()=>console.log(`[${VERSION}] listening on ${PORT}`));

