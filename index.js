const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const VERSION = 'GLOMART_API_DB_READY_V006_RESET_TEMP';
const app = express();

app.use(cors({ origin: true, credentials: false }));
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));
app.use(express.static('public'));
app.use('/public', express.static(path.join(__dirname, 'public')));

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || '/tmp/glomart-data';
const CACHE_FILE = path.join(DATA_DIR, 'coupang_cache.json');
const ORDER_FILE = path.join(DATA_DIR, 'orders.json');
fs.mkdirSync(DATA_DIR, { recursive: true });

function nowIso(){ return new Date().toISOString(); }
function cleanText(v){ return String(v || '').replace(/[\u00A0\u200B-\u200D\uFEFF]/g, ' ').replace(/\s+/g, ' ').trim(); }
function readJson(file, fallback){ try{ if(!fs.existsSync(file)) return fallback; return JSON.parse(fs.readFileSync(file,'utf8')); }catch(e){ return fallback; } }
function writeJson(file, data){ fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8'); }
function ok(res, data){ res.json({ ok:true, version:VERSION, ...data }); }
function fail(res, status, message, extra={}){ res.status(status).json({ ok:false, version:VERSION, error:message, ...extra }); }
function toInt(v, def=0){ const n = Number(v); return Number.isFinite(n) ? Math.round(n) : def; }
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
    list = list.filter(it => [
      it.title,it.optionText,it.priceText,it.deliveryText,it.productId,it.itemId,it.vendorItemId,it.url
    ].join(' ').toLowerCase().includes(keyword));
  }
  list.sort((a,b) => String(b.collectedAt || '').localeCompare(String(a.collectedAt || '')));
  const total = list.length;
  const start = (page - 1) * pageSize;
  const items = list.slice(start, start + pageSize).map((it, idx) => ({ ...it, rank:start + idx + 1 }));
  return { total, page, pageSize, nextPage:start + pageSize < total ? page + 1 : null, prevPage:page > 1 ? page - 1 : null, items };
}

function makePool(){
  const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.PG_URL || '';
  if(connectionString){
    return new Pool({ connectionString, ssl: process.env.PGSSL === '1' ? { rejectUnauthorized:false } : false });
  }
  return new Pool({
    host: process.env.PGHOST || process.env.POSTGRES_HOST || 'postgresql',
    port: Number(process.env.PGPORT || process.env.POSTGRES_PORT || 5432),
    user: process.env.PGUSER || process.env.POSTGRES_USER || 'root',
    password: process.env.PGPASSWORD || process.env.POSTGRES_PASSWORD || process.env.POSTGRESQL_PASSWORD || '',
    database: process.env.PGDATABASE || process.env.POSTGRES_DB || 'postgres'
  });
}

const pool = makePool();
let dbReady = false;
let dbError = '';

async function initGmDb({ reset=false } = {}){
  // V006: migrations/*.sql 순차 적용. 기존 DB에는 10번 이후 ALTER가 적용되고,
  // 신규 DB에는 00~10 전체가 순서대로 적용된다.
  if (reset) {
    throw new Error('DB reset is disabled. Use migrations manually if reset is required.');
  }

  const dir = path.join(__dirname, 'migrations');
  if (!fs.existsSync(dir)) {
    throw new Error('migration directory not found: ' + dir);
  }

  const files = fs.readdirSync(dir)
    .filter(name => /^\d+_.*\.sql$/i.test(name))
    .sort((a,b) => a.localeCompare(b, undefined, { numeric:true }));

  if (!files.length) throw new Error('no migration files found');

  const applied = [];
  for (const name of files) {
    const file = path.join(dir, name);
    const sql = fs.readFileSync(file, 'utf8');
    if (sql.trim()) {
      await pool.query(sql);
      applied.push('migrations/' + name);
    }
  }
  dbReady = true;
  dbError = '';
  return { files:applied };
}

if(process.env.GM_DB_AUTOINIT !== '0'){
  initGmDb({ reset:false }).then(() => {
    console.log('[GM DB READY] migrations/*.sql applied');
  }).catch(err => {
    dbReady = false;
    dbError = String(err && err.message || err);
    console.error('[GM DB INIT SKIPPED]', dbError);
  });
}

async function dbQuery(sql, vals=[]){
  return pool.query(sql, vals);
}

function owner(b){
  const memberId = cleanText(b.member_id);
  const guestKey = cleanText(b.guest_key);
  if(memberId) return { col:'member_id', val:memberId };
  if(guestKey) return { col:'guest_key', val:guestKey };
  throw new Error('member_id or guest_key required');
}

app.locals.pool = pool;

// gm_* route modules are registered before legacy inline endpoints.
// This prevents old inline handlers from intercepting /api/gm/* paths.
app.use(require('./routes/health'));
app.use(require('./routes/product'));
app.use(require('./routes/basket'));
app.use(require('./routes/interest'));
app.use(require('./routes/order'));
app.use(require('./routes/cs'));
app.use(require('./routes/builder'));

try{
  require('./workers/product_queue_worker').startProductQueueWorker(pool);
}catch(e){
  console.error('[GM_PRODUCT_QUEUE_WORKER] start skipped:', String(e && e.message || e));
}

app.get('/', (req,res)=>ok(res, {
  service:'glomart-api',
  mode:'json-cache-plus-postgresql',
  dbReady,
  dbError,
  routes:[
    'GET /health',
    'GET /api/gm/health',
    'POST /api/gm/db/init',
    'POST /api/gm/db/reset',
    'POST /api/gm/product/upsert',
    'POST /api/gm/product/queue',
    'GET /api/gm/product/queue/status',
    'POST /api/gm/product/event',
    'GET /api/gm/db/columns?table=gm_product',
    'POST /api/gm/basket/add',
    'GET /api/gm/basket/list',
    'POST /api/gm/interest/visit',
    'POST /api/gm/interest/wish',
    'GET /api/gm/interest/recent',
    'DELETE /api/gm/basket/item',
    'POST /api/gm/order/create',
    'GET /module/scrap/api/cache/search?q=keyword&page=1'
  ]
}));

app.get('/health', (req,res)=>ok(res,{status:'running', dbReady, dbError}));

app.get('/api/gm/health', async (req,res)=>{
  try{
    const r = await dbQuery('select now() as now');
    ok(res, { status:'running', db:true, db_time:r.rows[0].now });
  }catch(e){
    fail(res, 500, 'db connection failed', { detail:String(e && e.message || e) });
  }
});

app.post('/api/gm/db/init', async (req,res)=>{
  try{ const r = await initGmDb({ reset:false }); ok(res, { action:'db.init', ...r }); }
  catch(e){ fail(res, 500, 'db init failed', { detail:String(e && e.message || e) }); }
});

app.post('/api/gm/db/reset', async (req,res)=>{
  try{
    const targets = [
      'gm_product_upsert_queue',
      'gm_basket',
      'gm_order',
      'gm_supplier',
      'gm_cs_message',
      'gm_product'
    ];
    const existing = await dbQuery(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema='public' AND table_name = ANY($1::text[])
      ORDER BY table_name
    `, [targets]);
    const tables = existing.rows.map(r => r.table_name);
    if(!tables.length){
      return ok(res, { action:'db.reset', truncated:[], detail:'no target gm_* tables found' });
    }
    const quoted = tables.map(t => '"' + String(t).replace(/"/g, '""') + '"').join(', ');
    await dbQuery('TRUNCATE TABLE ' + quoted + ' RESTART IDENTITY CASCADE');
    ok(res, { action:'db.reset', truncated:tables });
  }catch(e){
    fail(res, 500, 'db reset failed', { detail:String(e && e.message || e) });
  }
});

app.get('/api/gm/db/status', async (req,res)=>{
  try{
    const r = await dbQuery(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema='public' AND table_name LIKE 'gm_%'
      ORDER BY table_name
    `);
    ok(res, { dbReady, tables:r.rows.map(x=>x.table_name) });
  }catch(e){ fail(res, 500, 'db status failed', { detail:String(e && e.message || e) }); }
});

app.get('/api/gm/db/columns', async (req,res)=>{
  try{
    const table = cleanText(req.query.table || 'gm_product');
    if(!/^gm_[a-z0-9_]+$/i.test(table)) return fail(res, 400, 'invalid table name');
    const r = await dbQuery(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema='public' AND table_name=$1
      ORDER BY ordinal_position
    `, [table]);
    ok(res, { table, columns:r.rows });
  }catch(e){ fail(res, 500, 'db columns failed', { detail:String(e && e.message || e) }); }
});

app.post('/api/gm/supplier/upsert', async (req,res)=>{
  try{
    const s = req.body || {};
    const gmSupplierId = cleanText(s.gm_supplier_id || s.supplier_id || s.supplier_code || ('GMSP_' + Date.now()));
    const mallCode = cleanText(s.mall_code);
    const mallSellerId = cleanText(s.mall_seller_id || s.seller_id || s.seller_key);
    const sellerName = cleanText(s.seller_name || s.supplier_name || s.company_name);
    if(!mallCode || !mallSellerId || !sellerName) return fail(res, 400, 'mall_code/mall_seller_id/seller_name required');
    const sellerKey = cleanText(s.seller_key || `${mallCode}_${mallSellerId}`);
    const supplierCode = cleanText(s.supplier_code || `${mallCode}_SP_${mallSellerId}`);

    const r = await dbQuery(`
      INSERT INTO gm_supplier (
        gm_supplier_id, mall_code, mall_seller_id, supplier_code, seller_key,
        seller_name, company_name, ceo_name, business_number, online_sales_number,
        main_phone, main_email, business_zipcode, business_address1, business_address2,
        manager_name, manager_department, manager_phone, manager_mobile, manager_email,
        status, created_at, updated_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,now(),now()
      )
      ON CONFLICT (gm_supplier_id) DO UPDATE SET
        mall_code=EXCLUDED.mall_code,
        mall_seller_id=EXCLUDED.mall_seller_id,
        supplier_code=EXCLUDED.supplier_code,
        seller_key=EXCLUDED.seller_key,
        seller_name=EXCLUDED.seller_name,
        company_name=EXCLUDED.company_name,
        ceo_name=EXCLUDED.ceo_name,
        business_number=EXCLUDED.business_number,
        online_sales_number=EXCLUDED.online_sales_number,
        main_phone=EXCLUDED.main_phone,
        main_email=EXCLUDED.main_email,
        business_zipcode=EXCLUDED.business_zipcode,
        business_address1=EXCLUDED.business_address1,
        business_address2=EXCLUDED.business_address2,
        manager_name=EXCLUDED.manager_name,
        manager_department=EXCLUDED.manager_department,
        manager_phone=EXCLUDED.manager_phone,
        manager_mobile=EXCLUDED.manager_mobile,
        manager_email=EXCLUDED.manager_email,
        status=EXCLUDED.status,
        updated_at=now()
      RETURNING *
    `, [
      gmSupplierId, mallCode, mallSellerId, supplierCode, sellerKey,
      sellerName, cleanText(s.company_name), cleanText(s.ceo_name),
      cleanText(s.business_number), cleanText(s.online_sales_number),
      cleanText(s.main_phone), cleanText(s.main_email),
      cleanText(s.business_zipcode), cleanText(s.business_address1), cleanText(s.business_address2),
      cleanText(s.manager_name), cleanText(s.manager_department), cleanText(s.manager_phone),
      cleanText(s.manager_mobile), cleanText(s.manager_email), cleanText(s.status || 'active')
    ]);
    ok(res, { item:r.rows[0] });
  }catch(e){ fail(res, 500, 'supplier upsert failed', { detail:String(e && e.message || e) }); }
});

app.post('/api/gm/product/upsert', async (req,res)=>{
  try{
    const p = req.body || {};
    const productId = cleanText(p.product_id || p.productId);
    const itemId = cleanText(p.item_id || p.itemId);
    const vendorItemId = cleanText(p.vendor_item_id || p.vendorItemId || p.venderItemId);
    const mallCode = cleanText(p.mall_code || p.mallCode || 'CPKR');
    const pi = cleanText(p.pi_ii_vi || [productId,itemId,vendorItemId].filter(Boolean).join('_'));
    const uid = cleanText(p.product_uid || `${mallCode}_${pi}`);
    const productName = cleanText(p.product_name || p.productName || p.title);
    if(!uid || !pi || !mallCode || !productName) return fail(res, 400, 'product_uid/pi_ii_vi/mall_code/product_name required');

    const r = await dbQuery(`
      INSERT INTO gm_product (
        product_uid, glomart_code, gm_category, category_keyword, mall_code, mall_category,
        product_id, item_id, vendor_item_id, pi_ii_vi, internal_product_code,
        product_name, mall_product_name, option_count, option_name, option_value,
        origin_country, mall_sale_price, final_supply_price, normal_price, discount_price,
        delivery_fee, delivery_eta_text, delivery_type, tax_type, overseas_direct_yn,
        supplier_id, supplier_name_snapshot, product_url, thumb_origin_url, thumb_file_name,
        soldout_yn, sale_status, last_seen_at, created_at, updated_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,now(),now(),now()
      )
      ON CONFLICT (product_uid) DO UPDATE SET
        product_name=EXCLUDED.product_name,
        mall_product_name=EXCLUDED.mall_product_name,
        option_count=EXCLUDED.option_count,
        option_name=EXCLUDED.option_name,
        option_value=EXCLUDED.option_value,
        mall_sale_price=EXCLUDED.mall_sale_price,
        final_supply_price=EXCLUDED.final_supply_price,
        normal_price=EXCLUDED.normal_price,
        discount_price=EXCLUDED.discount_price,
        delivery_fee=EXCLUDED.delivery_fee,
        delivery_eta_text=EXCLUDED.delivery_eta_text,
        delivery_type=EXCLUDED.delivery_type,
        supplier_id=EXCLUDED.supplier_id,
        supplier_name_snapshot=EXCLUDED.supplier_name_snapshot,
        product_url=EXCLUDED.product_url,
        thumb_origin_url=EXCLUDED.thumb_origin_url,
        thumb_file_name=EXCLUDED.thumb_file_name,
        soldout_yn=EXCLUDED.soldout_yn,
        sale_status=EXCLUDED.sale_status,
        last_seen_at=now(),
        updated_at=now()
      RETURNING product_uid, pi_ii_vi
    `, [
      uid, cleanText(p.glomart_code || p.glomartCode), cleanText(p.gm_category || p.gmCategory),
      cleanText(p.category_keyword || p.categoryKeyword), mallCode, cleanText(p.mall_category || p.mallCategory),
      productId, itemId, vendorItemId, pi, cleanText(p.internal_product_code),
      productName, cleanText(p.mall_product_name || p.mallProductName), toInt(p.option_count, 0),
      cleanText(p.option_name || p.optionName), cleanText(p.option_value || p.optionValue),
      cleanText(p.origin_country || p.originCountry), toInt(p.mall_sale_price || p.price || p.real_price, 0),
      p.final_supply_price == null ? null : toInt(p.final_supply_price, 0),
      p.normal_price == null ? null : toInt(p.normal_price, 0),
      p.discount_price == null ? null : toInt(p.discount_price, 0),
      toInt(p.delivery_fee, 0), cleanText(p.delivery_eta_text || p.deliveryText),
      cleanText(p.delivery_type || p.deliveryType), cleanText(p.tax_type || p.taxType),
      cleanText(p.overseas_direct_yn || 'N'), cleanText(p.supplier_id || p.supplierId),
      cleanText(p.supplier_name_snapshot || p.supplierName), normalizeUrl(p.product_url || p.url),
      normalizeUrl(p.thumb_origin_url || p.image || p.imageUrl), cleanText(p.thumb_file_name),
      cleanText(p.soldout_yn || 'N'), cleanText(p.sale_status || 'active')
    ]);
    ok(res, { item:r.rows[0] });
  }catch(e){ fail(res, 500, 'product upsert failed', { detail:String(e && e.message || e) }); }
});

app.post('/api/gm/basket/add', async (req,res)=>{
  try{
    const b = req.body || {};
    const own = owner(b);
    const pi = cleanText(b.pi_ii_vi);
    const productName = cleanText(b.product_name || b.productName);
    if(!pi || !productName) return fail(res, 400, 'pi_ii_vi/product_name required');

    const conflict = own.col === 'member_id'
      ? "ON CONFLICT (member_id, pi_ii_vi) WHERE member_id IS NOT NULL AND member_id <> ''"
      : "ON CONFLICT (guest_key, pi_ii_vi) WHERE guest_key IS NOT NULL AND guest_key <> ''";

    const r = await dbQuery(`
      INSERT INTO gm_basket (
        member_id, guest_key, pi_ii_vi, product_name, option_name, option_value,
        quantity, amount, amount_type, delivery_type, delivery_fee, added_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now(),now())
      ${conflict}
      DO UPDATE SET
        quantity = gm_basket.quantity + EXCLUDED.quantity,
        product_name=EXCLUDED.product_name,
        option_name=EXCLUDED.option_name,
        option_value=EXCLUDED.option_value,
        amount=EXCLUDED.amount,
        amount_type=EXCLUDED.amount_type,
        delivery_type=EXCLUDED.delivery_type,
        delivery_fee=EXCLUDED.delivery_fee,
        updated_at=now()
      RETURNING *
    `, [
      cleanText(b.member_id) || null, cleanText(b.guest_key) || null, pi, productName,
      cleanText(b.option_name || b.optionName), cleanText(b.option_value || b.optionValue),
      Math.max(1, toInt(b.quantity, 1)), toInt(b.amount, 0),
      cleanText(b.amount_type || 'unit'), cleanText(b.delivery_type || b.deliveryType), toInt(b.delivery_fee, 0)
    ]);
    ok(res, { item:r.rows[0] });
  }catch(e){ fail(res, 500, 'basket add failed', { detail:String(e && e.message || e) }); }
});

app.get('/api/gm/basket/list', async (req,res)=>{
  try{
    const memberId = cleanText(req.query.member_id);
    const guestKey = cleanText(req.query.guest_key);
    if(!memberId && !guestKey) return fail(res, 400, 'member_id or guest_key required');
    const r = memberId
      ? await dbQuery('SELECT * FROM gm_basket WHERE member_id=$1 ORDER BY added_at DESC', [memberId])
      : await dbQuery('SELECT * FROM gm_basket WHERE guest_key=$1 ORDER BY added_at DESC', [guestKey]);
    ok(res, { items:r.rows });
  }catch(e){ fail(res, 500, 'basket list failed', { detail:String(e && e.message || e) }); }
});

app.delete('/api/gm/basket/item', async (req,res)=>{
  try{
    const b = req.body || {};
    const own = owner(b);
    const pi = cleanText(b.pi_ii_vi);
    if(!pi) return fail(res, 400, 'pi_ii_vi required');
    await dbQuery(`DELETE FROM gm_basket WHERE ${own.col}=$1 AND pi_ii_vi=$2`, [own.val, pi]);
    ok(res, { deleted:true });
  }catch(e){ fail(res, 500, 'basket delete failed', { detail:String(e && e.message || e) }); }
});

app.post('/api/gm/order/create', async (req,res)=>{
  const o = req.body || {};
  const items = Array.isArray(o.items) ? o.items : [];
  if(!cleanText(o.order_no) || !items.length) return fail(res, 400, 'order_no/items required');

  const client = await pool.connect();
  try{
    await client.query('BEGIN');
    await client.query(`
      INSERT INTO gm_order (
        order_no, member_id, guest_key, orderer_name, orderer_phone, orderer_mobile, orderer_email,
        receiver_name, receiver_phone, receiver_mobile, receiver_safe_phone,
        receiver_zipcode, receiver_address1, receiver_address2, delivery_memo,
        customs_required_yn, customs_clearance_code, customs_name, customs_mobile,
        payment_method, payment_method_display, payment_bank_name, payment_account_number,
        depositor_name, depositor_phone, expected_payment_amount, total_product_price,
        total_delivery_fee, extra_area_delivery_fee, estimated_customs_fee, estimated_import_vat,
        total_payment_price, order_status, payment_status, shipping_status, cs_status,
        ordered_at, created_at, updated_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,now(),now(),now()
      )
      ON CONFLICT (order_no) DO NOTHING
    `, [
      cleanText(o.order_no), cleanText(o.member_id) || null, cleanText(o.guest_key) || null,
      cleanText(o.orderer_name), cleanText(o.orderer_phone), cleanText(o.orderer_mobile), cleanText(o.orderer_email),
      cleanText(o.receiver_name), cleanText(o.receiver_phone), cleanText(o.receiver_mobile), cleanText(o.receiver_safe_phone),
      cleanText(o.receiver_zipcode), cleanText(o.receiver_address1), cleanText(o.receiver_address2), cleanText(o.delivery_memo),
      cleanText(o.customs_required_yn || 'N'), cleanText(o.customs_clearance_code), cleanText(o.customs_name), cleanText(o.customs_mobile),
      cleanText(o.payment_method || 'pending'), cleanText(o.payment_method_display || '미정'),
      cleanText(o.payment_bank_name), cleanText(o.payment_account_number),
      cleanText(o.depositor_name), cleanText(o.depositor_phone), toInt(o.expected_payment_amount, 0),
      toInt(o.total_product_price, 0), toInt(o.total_delivery_fee, 0), toInt(o.extra_area_delivery_fee, 0),
      toInt(o.estimated_customs_fee, 0), toInt(o.estimated_import_vat, 0), toInt(o.total_payment_price, 0),
      cleanText(o.order_status || 'ordered'), cleanText(o.payment_status || 'pending'),
      cleanText(o.shipping_status || 'pending'), cleanText(o.cs_status || 'none')
    ]);

    for(const it of items){
      await client.query(`
        INSERT INTO gm_order_items (
          order_no, pi_ii_vi, product_name, option_name, option_value, quantity,
          mall_sale_price, customer_order_price, final_supply_price, product_amount,
          delivery_type, delivery_fee, extra_area_delivery_fee, mall_code, supplier_id, supplier_name,
          product_url, thumb_file_name, hs_code, origin_country, carrier_name, tracking_number,
          item_order_status, item_shipping_status, created_at, updated_at
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,now(),now()
        )
        ON CONFLICT (order_no, pi_ii_vi) DO UPDATE SET
          quantity=EXCLUDED.quantity,
          product_amount=EXCLUDED.product_amount,
          updated_at=now()
      `, [
        cleanText(o.order_no), cleanText(it.pi_ii_vi), cleanText(it.product_name),
        cleanText(it.option_name), cleanText(it.option_value), Math.max(1, toInt(it.quantity, 1)),
        toInt(it.mall_sale_price, 0), toInt(it.customer_order_price, 0),
        it.final_supply_price == null ? null : toInt(it.final_supply_price, 0),
        toInt(it.product_amount, 0), cleanText(it.delivery_type), toInt(it.delivery_fee, 0),
        toInt(it.extra_area_delivery_fee, 0), cleanText(it.mall_code), cleanText(it.supplier_id),
        cleanText(it.supplier_name), normalizeUrl(it.product_url), cleanText(it.thumb_file_name),
        cleanText(it.hs_code), cleanText(it.origin_country), cleanText(it.carrier_name),
        cleanText(it.tracking_number), cleanText(it.item_order_status || 'ordered'),
        cleanText(it.item_shipping_status || 'pending')
      ]);
    }

    await client.query('COMMIT');
    ok(res, { order_no:cleanText(o.order_no), item_count:items.length });
  }catch(e){
    await client.query('ROLLBACK').catch(()=>{});
    fail(res, 500, 'order create failed', { detail:String(e && e.message || e) });
  }finally{
    client.release();
  }
});

/* Existing JSON cache endpoints retained */
app.post('/module/scrap/api/collect', (req,res)=>{
  try{
    const result = savePayload(req.body || {});
    ok(res, { action:'collect', savedCount:result.saved.length, skippedCount:result.skipped.length, items:result.saved, skipped:result.skipped });
  }catch(e){ fail(res, 500, 'collect failed', { detail:String(e && e.message || e) }); }
});

app.post('/module/scrap/api/collect-form', (req,res)=>{
  try{
    let payload = {};
    if(req.body && req.body.payload) payload = JSON.parse(req.body.payload);
    else payload = req.body || {};
    const result = savePayload(payload);
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.end(`Glomart 수집 완료\n\n저장: ${result.saved.length}개 / 스킵: ${result.skipped.length}개`);
  }catch(e){
    res.status(500).setHeader('Content-Type','text/html; charset=utf-8');
    res.end('수집 실패\n' + String(e && e.message || e));
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
    ok(res, { action:'cache.all', source:'cache', cached:true, updatedAt:cache.updatedAt || null, total:items.length, items });
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
        key:item.key, title:item.title, image:item.image, priceText:item.priceText,
        deliveryText:item.deliveryText, url:item.url, productId:item.productId,
        itemId:item.itemId, vendorItemId:item.vendorItemId, optionText:item.optionText
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

/* Compatibility aliases from older sqlite version */
app.get('/db/status', (req,res)=>res.redirect('/api/gm/db/status'));
app.post('/scrap/save', (req,res)=>res.redirect(307, '/api/gm/product/upsert'));
app.post('/scrap/save-batch', async (req,res)=>{
  try{
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if(!items.length) return fail(res, 400, 'items required');
    const results = [];
    for(const it of items){
      const fakeReq = { body: it };
      results.push({ ok:true, item: it.pi_ii_vi || it.vendorItemId || it.product_id || '' });
    }
    ok(res, { received:items.length, note:'Use /api/gm/product/upsert for DB save', results });
  }catch(e){ fail(res, 500, 'batch failed', { detail:String(e && e.message || e) }); }
});

app.listen(PORT, ()=>console.log(`[${VERSION}] listening on ${PORT}`));


