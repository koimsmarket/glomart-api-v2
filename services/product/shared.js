'use strict';
// GM_PRODUCT_SPLIT_V003_SHARED - extracted from 2026-10-01 09:21 baseline
function db(req){ return req.app.locals.db || req.app.locals.pool; }
function cleanText(v){ return String(v || '').replace(/[\u00A0\u200B-\u200D\uFEFF]/g, ' ').replace(/\s+/g, ' ').trim(); }
function toInt(v, def=0){
  const raw = String(v ?? '').replace(/,/g,'').trim();
  const m = raw.match(/-?\d+(?:\.\d+)?/);
  const n = m ? Number(m[0]) : Number(raw);
  return Number.isFinite(n) ? Math.round(n) : def;
}

function pickUnitPriceText(obj){
  obj = obj || {};
  const direct = firstNonEmpty(obj, [
    'unit_price_text','unitPriceText','unit_price_display','unitPriceDisplay',
    'price_per_unit_text','pricePerUnitText','per_unit_price_text','perUnitPriceText',
    'unit_price_label','unitPriceLabel','unit_price_desc','unitPriceDesc'
  ]);
  if(direct) return direct;
  const loose = firstNonEmpty(obj,['unit_price','unitPrice']);
  if(loose && (/[당]/.test(loose) || /[₩￦]?\s*[0-9][0-9,]*(?:\.[0-9]+)?\s*원?\s*\/\s*[0-9]/i.test(loose))) return loose;
  const qty = firstNonEmpty(obj,['unit_price_qty','unitPriceQty','per_unit_qty','perUnitQty']);
  const unit = firstNonEmpty(obj,['unit_price_unit','unitPriceUnit','per_unit_unit','perUnitUnit']);
  const value = firstNonEmpty(obj,['unit_price_value_text','unitPriceValueText','per_unit_price','perUnitPrice']);
  if(qty && unit && value) return cleanText(`${qty}${unit}당 ${value}원`);
  return '';
}

const UNIT_PRICE_DIRECT_FIELDS = [
  'unit_price_text','unitPriceText','unit_price_display','unitPriceDisplay',
  'price_per_unit_text','pricePerUnitText','per_unit_price_text','perUnitPriceText',
  'unit_price_label','unitPriceLabel','unit_price_desc','unitPriceDesc'
];
const UNIT_PRICE_STRUCTURED_FIELDS = [
  'unit_price_qty','unitPriceQty','per_unit_qty','perUnitQty',
  'unit_price_unit','unitPriceUnit','per_unit_unit','perUnitUnit',
  'unit_price_value_text','unitPriceValueText','per_unit_price','perUnitPrice'
];
function hasOwnAny(obj,names){
  obj=obj||{};
  return names.some(name=>Object.prototype.hasOwnProperty.call(obj,name));
}
function hasUnitPriceSignal(obj){
  obj=obj||{};
  if(hasOwnAny(obj,UNIT_PRICE_DIRECT_FIELDS))return true;
  const hasQty=hasOwnAny(obj,['unit_price_qty','unitPriceQty','per_unit_qty','perUnitQty']);
  const hasUnit=hasOwnAny(obj,['unit_price_unit','unitPriceUnit','per_unit_unit','perUnitUnit']);
  const hasValue=hasOwnAny(obj,['unit_price_value_text','unitPriceValueText','per_unit_price','perUnitPrice']);
  // Structured payload is authoritative only when all three components are represented.
  // A partial structured field in a partial response must not clear a previously valid source unit price.
  if(hasQty&&hasUnit&&hasValue)return true;
  for(const name of ['unit_price','unitPrice']){
    if(!Object.prototype.hasOwnProperty.call(obj,name))continue;
    const loose=cleanText(obj[name]);
    // Explicit blank means the source field was present and the old source unit-price text must be cleared.
    if(!loose)return true;
    // Non-empty loose values are trusted only when they actually look like a unit-price expression.
    if(/[당]/.test(loose)||/[₩￦]?\s*[0-9][0-9,]*(?:\.[0-9]+)?\s*원?\s*\/\s*[0-9]/i.test(loose))return true;
  }
  return false;
}

// GM_SEARCH_UNIT_V010: unit-price source fields must preserve explicit blanks from the product payload.
// Generic payload flattening treats blank strings as missing and may fill them from parent metadata,
// which is correct for ordinary fields but wrong for stale unit-price clearing.
function resolveUnitPriceSource(raw,parent={}){
  const scan=(src,maxDepth)=>{
    src=parseIncomingPayloadBody(src||{});
    const containers=collectPayloadContainers(src,maxDepth);
    for(const obj of containers){
      if(!hasUnitPriceSignal(obj)) continue;
      return {seen:true,text:pickUnitPriceText(obj)}; // text may intentionally be blank
    }
    return {seen:false,text:''};
  };
  const own=scan(raw,4);
  if(own.seen)return own; // raw product response always wins, including explicit blank
  return scan(parent,2);
}

function firstNonEmpty(obj, names){
  obj = obj || {};
  for(const name of names){
    if(Object.prototype.hasOwnProperty.call(obj, name) && obj[name] !== undefined && obj[name] !== null){
      const v = cleanText(obj[name]);
      if(v) return v;
    }
  }
  return '';
}
function parseMoney(v, def=0){
  if(v === null || v === undefined) return def;
  if(typeof v === 'number') return Number.isFinite(v) ? Math.round(v) : def;
  let s = cleanText(v);
  if(!s) return def;
  s = s.replace(/₩|￦|원|KRW/gi, '').replace(/,/g, '').trim();
  const nums = s.match(/\d+(?:\.\d+)?/g);
  if(!nums || !nums.length) return def;
  return Math.round(Number(nums[0])) || def;
}
function parseCount(v){
  if(v === null || v === undefined) return null;
  if(typeof v === 'number') return Number.isFinite(v) ? Math.round(v) : null;
  let s = cleanText(v);
  if(!s) return null;
  let mult = 1;
  if(/만/.test(s)) mult = 10000;
  else if(/[kK]/.test(s)) mult = 1000;
  s = s.replace(/리뷰|상품평|댓글|평가|개|건|판매|명|\+/g,'').replace(/,/g,'').trim();
  const m = s.match(/\d+(?:\.\d+)?/);
  if(!m) return null;
  return Math.round(Number(m[0]) * mult);
}
function parseRating(v){
  const s = cleanText(v);
  if(!s) return '';
  const m = s.match(/(?:평점|별점|rating)?\s*([0-5](?:\.\d+)?)/i);
  return m ? m[1] : s;
}
function isBadProductNameCandidate(v){
  const s = cleanText(v);
  if(!s) return true;
  if(s.length < 2) return true;
  if(/^https?:\/\//i.test(s)) return true;
  if(/[₩￦]/.test(s) && /(가격인하|무료 배송|판매|리뷰|도착|배송)/.test(s)) return true;
  if((s.match(/[₩￦]/g)||[]).length >= 2) return true;
  if(s.length > 180 && /(가격인하|무료 배송|판매|리뷰|도착|배송|장바구니|할인)/.test(s)) return true;
  return false;
}
function cleanProductNameCandidate(v){
  let s = cleanText(v);
  if(!s) return '';
  s = s.replace(/\s+(?:₩|￦)\s*\d[\d,]*(?:\.\d+)?[\s\S]*$/,'').trim();
  s = s.replace(/\s+\d+\s*판매[\s\S]*$/,'').trim();
  s = s.replace(/\s+(?:무료\s*)?배송[\s\S]*$/,'').trim();
  s = s.replace(/\s+가격인하[\s\S]*$/,'').trim();
  return cleanText(s);
}
function bestProductName(p){
  const names = [
    'searchProductName','search_product_name','cleanProductName','clean_product_name',
    'productName','product_name','gm_title','gmTitle','mallProductName','mall_product_name',
    'name','itemName','item_name','productTitle','product_title','itemTitle','item_title',
    'title','subject'
  ];
  const candidates=[];
  for(const n of names){
    if(p && p[n] !== undefined && p[n] !== null){
      const c = cleanProductNameCandidate(p[n]);
      if(c) candidates.push(c);
    }
  }
  candidates.sort((a,b)=>{
    const ab=isBadProductNameCandidate(a)?1:0, bb=isBadProductNameCandidate(b)?1:0;
    if(ab!==bb) return ab-bb;
    return a.length-b.length;
  });
  return candidates[0] || '';
}


function normalizeUrl(url){
  url = cleanText(url);
  if(!url) return '';
  if(url.startsWith('//')) url = 'https:' + url;
  // GM_PRODUCT_URL_CANONICAL_V024
  // 검색 URL은 광고/추적 파라미터가 길게 붙어서 저장되면 ALI 차단과 CPKR 중복판정 흔들림을 만든다.
  // 저장 전에는 반드시 구매 식별에 필요한 최소 URL만 남긴다.
  try{
    const u = new URL(url);
    const host = String(u.hostname || '').toLowerCase();
    if(host === 'coupang.com' || host === 'www.coupang.com' || /\.coupang\.com$/i.test(host)){
      const m = u.pathname.match(/\/vp\/products\/(\d+)/i);
      if(m){
        const qs = [];
        const itemId = u.searchParams.get('itemId') || u.searchParams.get('itemid');
        const vendorItemId = u.searchParams.get('vendorItemId') || u.searchParams.get('vendoritemid');
        if(itemId) qs.push('itemId=' + encodeURIComponent(itemId));
        if(vendorItemId) qs.push('vendorItemId=' + encodeURIComponent(vendorItemId));
        return 'https://www.coupang.com/vp/products/' + m[1] + (qs.length ? '?' + qs.join('&') : '');
      }
    }
    if(/aliexpress\.com$/i.test(u.hostname) || /\.aliexpress\.com$/i.test(u.hostname)){
      const m = u.pathname.match(/\/item\/(\d+)\.html/i);
      if(m) return 'https://ko.aliexpress.com/item/' + m[1] + '.html';
    }
  }catch(e){}
  url = url.replace(/_\.avif$/i, '').replace(/\.avif(?:\?.*)?$/i, '');
  return url;
}
function fail(res, status, message, extra={}){ res.status(status).json({ ok:false, error:message, ...extra }); }
function ok(res, data){ res.json({ ok:true, ...data }); }

function normalizeQueueItems(p){
  const items = Array.isArray(p.items) ? p.items : (Array.isArray(p.products) ? p.products : []);
  return items.filter(Boolean);
}
function makeRequestId(p, items){
  const raw = cleanText(p.request_id || p.requestId || p.search_request_id || p.searchRequestId);
  const chunkIndex = toInt(p.chunk_index || p.chunkIndex, 0);
  const searchRunId = cleanText(p.search_run_id || p.searchRunId || p.base_request_id || p.baseRequestId || '');
  const mall = cleanText(p.mall_code || p.mallCode || p.source || (items && items[0] && (items[0].mall_code || items[0].mallCode)) || 'UNKNOWN').toUpperCase() || 'UNKNOWN';

  // Queue row의 request_id는 같은 검색 내에서도 mall별/chunk별로 반드시 달라야 한다.
  // 기존: REQ123_C001  -> CPKR/ALKR가 같은 key로 충돌하여 ALKR queue가 덮이거나 스킵될 수 있음.
  // 변경: REQ123_CPKR_C001 / REQ123_ALKR_C001
  const withMallChunk = function(base){
    base = cleanText(base);
    if(!base) return '';
    let out = base;
    if(!new RegExp('_(?:' + mall + ')_', 'i').test(out) && !new RegExp('_(?:' + mall + ')$', 'i').test(out)){
      out += '_' + mall;
    }
    if(chunkIndex > 0 && !/_C\d{1,4}$/i.test(out)){
      out += '_C' + String(chunkIndex).padStart(3,'0');
    }
    return out;
  };

  const fromRaw = withMallChunk(raw);
  if(fromRaw) return fromRaw;

  const fromRun = withMallChunk(searchRunId);
  if(fromRun) return fromRun;

  const keyword = cleanText(p.keyword || p.q || '');
  const keyText = items.map(function(it){
    return cleanText(it.product_uid || it.productUid || it.pi_ii_vi || it.vendor_item_id || it.vendorItemId || it.url || it.product_url || it.productName || it.product_name);
  }).join('|');
  let h = 0;
  const s = mall + '|' + keyword + '|' + keyText;
  for(let i=0;i<s.length;i++){ h = ((h << 5) - h + s.charCodeAt(i)) | 0; }

  // request_id가 없는 구형 Runtime도 chunk끼리 덮지 않도록 item hash + timestamp로 생성한다.
  const base = 'GMQ_' + mall + '_' + Date.now() + '_' + Math.abs(h);
  return chunkIndex > 0 ? base + '_C' + String(chunkIndex).padStart(3,'0') : base;
}

function isPlainObject(v){ return !!v && typeof v === 'object' && !Array.isArray(v); }
function copyMissing(dst, src){
  dst = dst || {}; src = src || {};
  if(!isPlainObject(src)) return dst;
  Object.keys(src).forEach(k => {
    if(dst[k] === undefined || dst[k] === null || cleanText(dst[k]) === '') dst[k] = src[k];
  });
  return dst;
}
function firstPlainObject(){
  for(let i=0;i<arguments.length;i++) if(isPlainObject(arguments[i])) return arguments[i];
  return {};
}

// GM_PRODUCT_DETAIL_PAYLOAD_DEEP_V023
// 상세/검색 payload가 fetch JSON, sendBeacon text, {payload:{...}}, {item:{...}} 등으로 섞여 와도
// 서버에서 한 번 더 풀어 옵션/이미지/공급자 필드를 찾는다.
function parseIncomingPayloadBody(body){
  if(body == null) return {};
  if(Buffer.isBuffer && Buffer.isBuffer(body)) body = body.toString('utf8');
  if(typeof body === 'string'){
    const t = body.trim();
    if(!t) return {};
    try{ return JSON.parse(t); }catch(_e){ return { raw_body:t }; }
  }
  return body;
}
function parseMaybeJsonAny(v){
  if(v == null || v === '') return null;
  if(typeof v === 'object') return v;
  if(typeof v === 'string'){
    const t = v.trim();
    if(!t) return null;
    try{ return JSON.parse(t); }catch(_e){ return null; }
  }
  return null;
}
function addIfMissingField(dst, key, val){
  if(val === undefined || val === null) return;
  const empty = dst[key] === undefined || dst[key] === null || (typeof dst[key] === 'string' && cleanText(dst[key]) === '') || (Array.isArray(dst[key]) && dst[key].length === 0);
  if(empty) dst[key] = val;
}
function collectPayloadContainers(raw, maxDepth=4){
  const out=[]; const seen=new Set();
  const visit=(v, depth)=>{
    if(!v || depth > maxDepth) return;
    const parsed = typeof v === 'string' ? parseMaybeJsonAny(v) : v;
    if(!parsed || typeof parsed !== 'object') return;
    if(seen.has(parsed)) return; seen.add(parsed);
    if(!Array.isArray(parsed)) out.push(parsed);
    if(Array.isArray(parsed)) return;
    ['item','product','data','payload','detail','result','detailResult','gm_detail','gmDetail','raw_json','rawJson','detail_json','detailJson','GM_LAST_DETAIL_RESULT','detailPayload'].forEach(k=>{
      if(parsed[k] !== undefined) visit(parsed[k], depth + 1);
    });
  };
  visit(raw, 0);
  return out;
}
function flattenDetailPayload(raw, parent={}){
  raw = parseIncomingPayloadBody(raw || {}); parent = parseIncomingPayloadBody(parent || {});
  const containers = collectPayloadContainers(raw).concat(collectPayloadContainers(parent, 2));
  const p = {};
  // 먼저 넓게 펼치고, 루트값은 마지막에 우선한다. 빈 값은 덮어쓰지 않는다.
  containers.reverse().forEach(o => copyMissing(p, o));
  copyMissing(p, raw);

  // payload wrapper 값 보존
  ['key','gm_key','product_uid','pi_ii_vi','mall_code','mallCode','keyword','q','requestId','request_id'].forEach(k=>{
    if((p[k] === undefined || p[k] === null || cleanText(p[k]) === '') && raw[k] !== undefined) p[k] = raw[k];
  });

  // 자주 들어오는 배열 alias는 깊은 container에서 찾아 올린다.
  const arrayAliases = ['optionRows','option_rows','optionCombos','aliOptionCombos','flatOptionRows','detailOptionRows','optionsRows','visibleOptions','vendorItemOptions','itemOptions','selectedOptions','options','thumbnailImages','thumbs','topImages','mainImages','images','detailImages','detailBlocks','blocks','categoryTree','category_tree','categoryTreeJson','category_tree_json','cpCategoryTree','cp_category_tree','cpCategoryTreeJson','cp_category_tree_json','breadcrumbs','breadcrumb','categoryPathItems','category_path_items'];
  arrayAliases.forEach(k=>{
    if(Array.isArray(p[k]) && p[k].length) return;
    for(const o of containers){
      if(Array.isArray(o[k]) && o[k].length){ p[k] = o[k]; break; }
    }
  });

  const supplier = firstPlainObject(p.supplierInfo, p.__gmSupplierInfo, p.supplier, p.sellerInfo, p.vendorInfo, p.storeInfo, p.seller, p.sellerData, p.vendor);
  if(Object.keys(supplier).length){
    const map = {
      supplier_name:['supplierName','supplier_name','seller','sellerName','seller_name','vendorName','vendor_name','storeName','store_name','shopName','shop_name','name','companyName','company_name'],
      business_number:['businessNumber','business_number','bizNo','biz_no','biz','sellerBizNo','supplierBizNo','businessRegistrationNumber'],
      online_sales_number:['onlineSalesNumber','online_sales_number','mailOrderNo','mail_order_no','mailO','mailOrderNumber','supplierMailOrderNo'],
      ceo_name:['ceoName','ceo_name','rep','representative','representativeName','supplierRepresentative'],
      supplier_mobile:['mobile','supplierMobile','supplier_mobile','sellerMobile','seller_mobile'],
      supplier_phone:['phone','supplierPhone','supplier_phone','sellerPhone','seller_phone','tel','telephone'],
      supplier_email:['email','supplierEmail','supplier_email','sellerEmail','seller_email'],
      supplier_address:['address','supplierAddress','supplier_address','sellerAddress','seller_address','addr']
    };
    Object.keys(map).forEach(dst=>{
      if(cleanText(p[dst])) return;
      for(const src of map[dst]){ if(cleanText(supplier[src])){ p[dst]=supplier[src]; break; } }
    });
  }
  // supplierInfo 객체가 아니라 루트 텍스트로 온 경우
  if(!cleanText(p.supplier_name)) p.supplier_name = cleanText(p.seller || p.sellerName || p.vendorName || p.storeName || p.shopName || p.companyName || '');
  if(!cleanText(p.supplier_phone)) p.supplier_phone = cleanText(p.phone || p.sellerPhone || p.supplierPhone || '');
  if(!cleanText(p.supplier_email)) p.supplier_email = cleanText(p.email || p.sellerEmail || p.supplierEmail || '');

  const cat = firstPlainObject(p.categoryInfo, p.category_info, p.cpCategoryInfo, p.coupangCategoryInfo, p.category);
  if(Object.keys(cat).length){
    if(!cleanText(p.cp_fix_code)) p.cp_fix_code = cat.leaf || cat.leafCategoryId || cat.categoryNo || cat.category_no || cat.code || cat.id || '';
    if(!cleanText(p.cp_code)) p.cp_code = p.cp_fix_code; // legacy alias only; DB column is cp_fix_code
    if(!cleanText(p.mall_category)) p.mall_category = cat.leaf || cat.leafCategoryId || cat.categoryNo || cat.category_no || cat.code || cat.id || '';
    if(!p.mall_category_json && (Array.isArray(cat.path) || Array.isArray(cat.path_json) || Array.isArray(cat.tree) || Array.isArray(cat.nodes) || cleanText(cat.pathText || cat.path_text || cat.path_ko))){
      const arr = Array.isArray(cat.path) ? cat.path : (Array.isArray(cat.path_json) ? cat.path_json : (Array.isArray(cat.tree) ? cat.tree : (Array.isArray(cat.nodes) ? cat.nodes : cleanText(cat.pathText || cat.path_text || cat.path_ko).split(/\s*>\s*/))));
      p.mall_category_json = arr.map((x,i)=> isPlainObject(x) ? x : ({ depth:i+1, name:cleanText(x) })).filter(x=>cleanText(x.name || x.name_ko || x.id || x.code || x.cp_code || x.categoryId));
    }
  }

  // CATEGORY_TREE payload aliases: collector/runtime may send categoryTree directly, not under categoryInfo.
  if(!p.mall_category_json){
    for(const k of ['categoryTree','category_tree','categoryTreeJson','category_tree_json','cpCategoryTree','cp_category_tree','cpCategoryTreeJson','cp_category_tree_json','breadcrumbs','breadcrumb','categoryPathItems','category_path_items']){
      const v = p[k];
      if(Array.isArray(v) && v.length){ p.mall_category_json = v; break; }
      if(typeof v === 'string'){
        const parsed = parseMaybeJsonAny(v);
        if(Array.isArray(parsed) && parsed.length){ p.mall_category_json = parsed; break; }
      }
    }
  }

  if(!Array.isArray(p.thumbnailImages) && Array.isArray(p.thumbs)) p.thumbnailImages = p.thumbs;
  if(!Array.isArray(p.thumbnailImages) && Array.isArray(p.topImages)) p.thumbnailImages = p.topImages;
  if(!Array.isArray(p.thumbnailImages) && Array.isArray(p.mainImages)) p.thumbnailImages = p.mainImages;
  if(!Array.isArray(p.optionRows) && Array.isArray(p.optionsRows)) p.optionRows = p.optionsRows;
  if(!Array.isArray(p.optionRows) && Array.isArray(p.detailOptionRows)) p.optionRows = p.detailOptionRows;
  if(!Array.isArray(p.optionRows) && Array.isArray(p.selectedOptions)) p.optionRows = p.selectedOptions;

  if(!cleanText(p.return_shipping_fee) && cleanText(p.returnFee)) p.return_shipping_fee = p.returnFee;
  if(!cleanText(p.return_policy_text) && cleanText(p.returnFeeText)) p.return_policy_text = p.returnFeeText;
  if(!cleanText(p.return_policy_text) && cleanText(p.returnPolicy)) p.return_policy_text = p.returnPolicy;
  if(!cleanText(p.product_name) && cleanText(p.gm_title)) p.product_name = p.gm_title;
  if(!cleanText(p.productName) && cleanText(p.gmTitle)) p.productName = p.gmTitle;
  return p;
}
function ids(b){
  const mallCode = cleanText(b.mall_code || b.mallCode || b.source || b.mall || 'CPKR').toUpperCase();
  const isAliMall = mallCode === 'ALI' || mallCode === 'ALKR' || /^AL/.test(mallCode);
  const isCoupangMall = mallCode === 'CPKR' || mallCode === 'COUPANG' || /^CP/.test(mallCode);

  // ALI/ALKR often arrives with product_url only. Parse /item/1005....html before giving up.
  const urlText = normalizeUrl(
    b.product_url || b.productUrl || b.url || b.link || b.href || b.detail_url || b.detailUrl || b.ali_url || b.aliUrl || ''
  );
  let aliUrlId = '';
  let m = String(urlText || '').match(/\/item\/(\d+)(?:\.html)?/i);
  if(m) aliUrlId = m[1];
  if(!aliUrlId){
    m = String(urlText || '').match(/[?&](?:productId|itemId|goodsId|item_id)=(\d+)/i);
    if(m) aliUrlId = m[1];
  }

  // GM_ID_SPLIT_FIX_V006
  // CPKR의 product_id는 itemId로 대체하면 안 된다.
  // product_id / item_id / vendor_item_id는 pi_ii_vi(productId_itemId_vendorItemId)를 최우선 기준으로 복원한다.
  let productId = cleanText(
    b.product_id || b.productId || b.productID || b.ali_product_id || b.aliProductId || b.aliProductID ||
    (isAliMall ? (b.item_id_ali || b.ali_item_id || b.aliItemId || aliUrlId) : '')
  );
  let itemId = cleanText(b.item_id || b.itemId || b.sku_id || b.skuId || b.ali_sku_id || b.aliSkuId);
  let vendorItemId = cleanText(b.vendor_item_id || b.vendorItemId || b.venderItemId || b.offer_id || b.offerId || b.ali_offer_id || b.aliOfferId);

  let pi = cleanText(
    b.pi_ii_vi || b.piIiVi || b.coupang_key || b.coupangKey || b.coupang_product_key || b.coupangProductKey ||
    b.key || b.gm_key || b.gmKey || b.detail_key || b.detailKey || b.product_key || b.productKey ||
    b.ali_key || b.aliKey
  );

  // GM_DETAIL_KEY_FIX_V024
  // 상세 Collector는 key=productId_itemId_vendorItemId 형태로 보내는 경우가 많다.
  // 기존 ids()가 key/gm_key를 보지 않아 /api/gm/product/upsert 상세값이 다른 uid 또는 빈 uid로 빠질 수 있었다.
  const rawUid = cleanText(b.product_uid || b.productUid || '');
  if(!pi && rawUid){
    const prefix = mallCode + '_';
    pi = rawUid.indexOf(prefix) === 0 ? rawUid.slice(prefix.length) : rawUid;
  }

  if(isCoupangMall && pi){
    const parts = String(pi).split('_').map(cleanText).filter(Boolean);
    if(parts.length >= 3){
      productId = parts[0];
      itemId = parts[1];
      vendorItemId = parts[2];
      pi = [productId, itemId, vendorItemId].join('_');
    }
  }

  if(!pi){
    if(isAliMall) pi = productId || [productId, itemId, vendorItemId].filter(Boolean).join('_');
    else pi = [productId, itemId, vendorItemId].filter(Boolean).join('_');
  }

  // For ALI/ALKR search rows, productId alone is the stable key.
  if(!productId && pi){ productId = String(pi).split('_')[0] || ''; }
  if(isAliMall && productId){
    if(!vendorItemId) vendorItemId = productId;
    if(!pi) pi = productId;
  }
  if(!isCoupangMall && !vendorItemId && productId && !itemId) vendorItemId = productId;

  // GM_PRODUCT_UID_PID_ONLY_V021
  // gm_product는 상품 대표 1행이므로 product_uid는 옵션키(PID_IID_VID)가 아니라 PID 기준이다.
  // 옵션별 실제 구매키는 gm_product_option.pi_ii_vi에서 관리한다.
  const productUidKey = productId || pi;
  const uid = cleanText(mallCode && productUidKey ? `${mallCode}_${productUidKey}` : rawUid);
  return { productId, itemId, vendorItemId, mallCode, pi, uid, source_url:urlText };
}

function pickFinalSupplyPrice(p, mallSalePrice){
  const v = firstNonEmpty(p, ['final_supply_price','finalSupplyPrice','supply_price','supplyPrice','purchase_price','purchasePrice','cost_price','costPrice']);
  return v ? parseMoney(v, 0) : null;
}

function pickProductName(p){
  return bestProductName(p);
}
function pickPrice(p){
  // mall_sale_price는 몰 원가/원판매가만 저장한다.
  // collector가 화면 표시용으로 price/priceText/gm_price에 우리 판매가를 넣기 때문에
  // raw/mall 계열을 먼저 보고, 없을 때만 과거 payload 호환 필드를 사용한다.
  return parseMoney(firstNonEmpty(p, [
    'mall_sale_price','mallSalePrice','mall_sale_price_text','mallSalePriceText',
    'raw_price','rawPrice','raw_price_text','rawPriceText',
    'basePrice','base_price','basePriceText','base_price_text',
    'rawCoupangPrice','rawCoupangOptionPrice','rawOptionPrice','coupangPrice',
    'aliRawPriceText','aliBaseRawPriceText','aliBaseRawPrice',
    'priceMain','displayPrice','display_price','sale_price','salePrice',
    'final_price','finalPrice','ali_price','aliPrice','min_price','minPrice','price_text','priceText','price'
  ]), 0);
}
function pickNormalPrice(p){
  // normal_price는 collector가 계산해서 보낸 우리 판매가만 저장한다.
  // 서버에서는 절대 재계산하지 않고, 숫자/텍스트 payload를 그대로 money parse만 한다.
  const v = firstNonEmpty(p, [
    'normal_price','normalPrice','normal_price_text','normalPriceText',
    'glomart_price','glomartPrice','glomart_price_text','glomartPriceText',
    'our_price','ourPrice','our_price_text','ourPriceText',
    'gm_normal_price','gmNormalPrice','gm_normal_price_text','gmNormalPriceText',
    'gm_sale_price','gmSalePrice','gm_sale_price_text','gmSalePriceText',
    'customer_sale_price','customerSalePrice','customer_sale_price_text','customerSalePriceText',
    'sell_price','sellPrice','sell_price_text','sellPriceText',
    'calculatedPrice','calculated_price','calculatedPriceText','calculated_price_text',
    'gm_price','gmPrice','gm_price_text','gmPriceText',
    'displayPriceText','finalDisplayPriceText','finalPriceText','searchDisplayPrice','searchPrice','priceText','price'
  ]);
  return v ? parseMoney(v, 0) : null;
}
function pickDiscountPrice(p){
  const v = firstNonEmpty(p, ['discount_price','discountPrice','coupon_price','couponPrice','instant_discount','instantDiscount']);
  return v ? parseMoney(v, 0) : null;
}
function pickDeliveryFee(p){
  const v = firstNonEmpty(p, ['delivery_fee','deliveryFee','shipping_fee','shippingFee','gm_shipping_fee','gmShippingFee','deliveryFeeText','shippingFeeText','searchShippingFeeText','searchDeliveryFeeText','delivery_fee_text','shipping_fee_text']);
  if(/무료/.test(v)) return 0;
  return parseMoney(v, 0);
}
function pickReviewCount(p){
  const v = firstNonEmpty(p, ['review_count','reviewCount','searchReviewCount','comment_count','commentCount','rating_count','ratingCount','review_text','reviewText','review','reviews','commentText']);
  return v ? parseCount(v) : null;
}
function pickMallSalesCount(p){
  return cleanText(firstNonEmpty(p, ['mall_sales_count','mallSalesCount','salesCountText','sales_count_text','searchSalesCountText','onlineSaleText','saleCountText','sales_count','salesCount','sold_count_text','soldCountText']));
}
function pickRatingScore(p){
  const v = firstNonEmpty(p, ['rating_score','ratingScore','rating','searchRating','star_score','starScore','product_grade','productGrade','grade','score']);
  return parseRating(v);
}
function cleanDupMallProductName(productName, mallProductName){
  productName = cleanText(productName); mallProductName = cleanText(mallProductName);
  return productName && mallProductName && productName === mallProductName ? '' : mallProductName;
}
function pickProductUrl(p){
  return normalizeUrl(p.product_url || p.productUrl || p.url || p.link || p.href || p.detail_url || p.detailUrl || p.ali_url || p.aliUrl);
}
function buildProductUrlFromId(id){
  id = id || {};
  const mall = cleanText(id.mallCode || '').toUpperCase();
  const productId = cleanText(id.productId || '');
  const itemId = cleanText(id.itemId || '');
  const vendorItemId = cleanText(id.vendorItemId || '');
  if(!productId) return '';
  if(mall === 'CPKR' || /^CP/.test(mall)){
    let url = 'https://www.coupang.com/vp/products/' + productId;
    const qs = [];
    if(itemId) qs.push('itemId=' + encodeURIComponent(itemId));
    if(vendorItemId) qs.push('vendorItemId=' + encodeURIComponent(vendorItemId));
    return url + (qs.length ? '?' + qs.join('&') : '');
  }
  if(mall === 'ALKR' || mall === 'ALI' || /^AL/.test(mall)){
    return 'https://ko.aliexpress.com/item/' + productId + '.html';
  }
  return '';
}
function pickThumbUrl(p){
  return normalizeUrl(
    p.thumb_origin_url || p.thumbOriginUrl || p.thumb_url || p.thumbUrl ||
    p.thumbnail || p.thumbnail_url || p.thumbnailUrl || p.image || p.image_url || p.imageUrl || p.img || p.img_url || p.imgUrl
  );
}

function pickOptionName(p){
  return cleanText(
    p.option_name || p.optionName || p.display_option_name || p.displayOptionName ||
    p.selected_option_name || p.selectedOptionName || p.sku_name || p.skuName ||
    p.variant_name || p.variantName || p.optionTitle || p.option_title || ''
  );
}
function pickOptionValue(p){
  return cleanText(
    p.option_value || p.optionValue || p.display_option_value || p.displayOptionValue ||
    p.selected_option_value || p.selectedOptionValue || p.sku_value || p.skuValue ||
    p.variant_value || p.variantValue || p.optionText || p.option_text || ''
  );
}
function pickDeliveryText(p){
  return firstNonEmpty(p, ['delivery_eta_text','deliveryEtaText','arrival','arrivalText','arrival_text','deliveryText','delivery_text','searchShippingText','exactDeliveryText','shipping_text','shippingText','shipping_message','shippingMessage','eta_text','etaText']);
}
function pickDeliveryType(p){
  return cleanText(firstNonEmpty(p, ['delivery_type','deliveryType','searchDeliveryType','shipping_type','shippingType','shipLabel','shippingLabel','delivery_badge','deliveryBadge','shipping_badge','shippingBadge']));
}
function pickSupplierName(p){
  return cleanText(
    p.supplier_name_snapshot || p.supplierNameSnapshot || p.supplier_name || p.supplierName ||
    p.seller || p.seller_name || p.sellerName || p.vendor_name || p.vendorName ||
    p.store_name || p.storeName || p.shop_name || p.shopName || ''
  );
}
function pickSupplierId(p){
  return cleanText(p.supplier_id || p.supplierId || p.seller_id || p.sellerId || p.vendor_id || p.vendorId || p.store_id || p.storeId || '');
}
function isStandardCoupangSupplier(p, id){
  p=p||{}; id=id||{};
  const mall = cleanText(id.mallCode || p.mall_code || p.mallCode || '').toUpperCase();
  if(mall !== 'CPKR') return false;
  const text = [
    p.supplier_name, p.supplierName, p.seller, p.sellerName, p.vendorName, p.storeName, p.shopName,
    p.business_number, p.businessNumber, p.bizNo, p.supplierBizNo,
    p.online_sales_number, p.onlineSalesNumber, p.mailOrderNo,
    p.supplier_phone, p.supplierPhone, p.supplier_mobile, p.supplierMobile, p.phone, p.sellerPhone,
    p.supplier_email, p.supplierEmail, p.email
  ].map(cleanText).join(' ');
  return /쿠팡|coupang/i.test(text) || /1577[- ]?7011/.test(text) || /120[- ]?88[- ]?00767/.test(text);
}
function pickAny(p, names){
  for(const n of names){
    if(p && p[n] !== undefined && p[n] !== null && cleanText(p[n]) !== '') return cleanText(p[n]);
  }
  return '';
}
function sourceMallFrom(p, uid, url, mallCode){
  const direct = cleanText(p.source_mall || p.sourceMall || p.source_code || p.sourceCode || '').toUpperCase();
  if(direct) return direct;
  const u = cleanText(uid || p.source_uid || p.sourceUid || '').toUpperCase();
  if(u.indexOf('_') > 0) return u.split('_')[0];
  const x = String(url || '').toLowerCase();
  if(x.includes('coupang.com') || x.includes('link.coupang.com')) return 'CPKR';
  if(x.includes('aliexpress.com')) return 'ALKR';
  if(x.includes('temu.com')) return 'TEMU';
  if(x.includes('shopping.naver.com') || x.includes('smartstore.naver.com')) return 'NPKR';
  const m = cleanText(mallCode || '').toUpperCase();
  return (m === 'CAFE24' || m === 'INTERNAL') ? '' : m;
}
function sourceUidFrom(p, sourceMall){
  const direct = cleanText(p.source_uid || p.sourceUid || '');
  if(direct) return direct;
  const key = cleanText(p.source_key || p.sourceKey || p.source_id || p.sourceId || '');
  const sm = cleanText(sourceMall || '').toUpperCase();
  if(key && sm && key.indexOf(sm + '_') !== 0) return sm + '_' + key;
  return key;
}
function normalizeProductPayload(raw, parent={}){
  const p = flattenDetailPayload(raw, parent);
  if(!p.mall_code && !p.mallCode) p.mall_code = parent.mall_code || parent.mallCode || parent.source || parent.mall || 'CPKR';
  if(!p.keyword && parent.keyword) p.keyword = parent.keyword;
  if(!p.requestId && parent.requestId) p.requestId = parent.requestId;

  const id0 = ids(p);
  let pi = id0.pi;
  let productId = id0.productId;
  let itemId = id0.itemId;
  let vendorItemId = id0.vendorItemId;
  if(!pi && id0.uid){
    const prefix = id0.mallCode + '_';
    pi = id0.uid.indexOf(prefix) === 0 ? id0.uid.slice(prefix.length) : id0.uid;
  }
  if(pi && (!productId || !vendorItemId)){
    const parts = String(pi).split('_');
    if(!productId) productId = cleanText(parts[0]);
    if(!itemId && parts.length > 2) itemId = cleanText(parts[1]);
    if(!vendorItemId) vendorItemId = cleanText(parts[parts.length - 1]);
  }
  if(!pi && productId) pi = [productId, itemId, vendorItemId].filter(Boolean).join('_') || productId;
  if(!vendorItemId && productId) vendorItemId = productId;
  const mallCode = cleanText(id0.mallCode || 'CPKR').toUpperCase();
  const uid = cleanText(id0.uid || (mallCode && pi ? `${mallCode}_${pi}` : ''));
  let productName = pickProductName(p);
  if(!productName && productId){
    // 검색 queue payload 변동 시 product_name이 누락되어도 상품 저장이 전체 중단되지 않게 최소 식별명을 부여한다.
    productName = cleanText(p.titleText || p.title_text || p.searchTitle || p.search_title || p.displayName || p.display_name || '') || (mallCode + ' 상품 ' + productId);
  }
  return { p, id:{ productId, itemId, vendorItemId, mallCode, pi, uid }, productName };
}

function jsonCleanText(v){ return cleanText(v); }
function safeJsonString(v){
  try{
    if(v === undefined || v === null || v === '') return '[]';
    if(typeof v === 'string'){
      const t=v.trim();
      if(!t) return '[]';
      try{ JSON.parse(t); return t; }catch(_e){ return JSON.stringify(t); }
    }
    return JSON.stringify(v);
  }catch(e){
    return '[]';
  }
}

function jsonArrayLengthSafe(v){
  if(Array.isArray(v)) return v.length;
  if(!v) return 0;
  if(typeof v === 'string'){
    try{ return jsonArrayLengthSafe(JSON.parse(v)); }catch(_e){ return 0; }
  }
  if(typeof v === 'object'){
    if(Array.isArray(v.rows)) return v.rows.length;
    if(Array.isArray(v.images)) return v.images.length;
    if(Array.isArray(v.blocks)) return v.blocks.length;
    if(Array.isArray(v.texts)) return v.texts.length;
  }
  return 0;
}
function compactError(e){
  return {
    message:String(e && e.message || e || ''),
    code:e && e.code || undefined,
    detail:e && e.detail || undefined,
    column:e && e.column || undefined,
    constraint:e && e.constraint || undefined,
    table:e && e.table || undefined,
    position:e && e.position || undefined
  };
}
function pickTaxType(p){
  p=p||{};
  const direct=cleanText(p.tax_type || p.taxType || p.vat_type || p.vatType || '');
  if(direct) return direct;
  const blob=cleanText([p.vatText,p.vat_text,p.taxText,p.tax_text,p.productName,p.title].join(' '));
  if(/면세/.test(blob)) return 'EXEMPT';
  if(/과세|부가세\s*포함|VAT\s*included/i.test(blob)) return 'TAXABLE';
  if(/영세/.test(blob)) return 'ZERO';
  return '';
}
let __gmLightJsonColumnsEnsured = false;
async function ensureProductLightJsonColumns(pool){
  if(__gmLightJsonColumnsEnsured) return;
  __gmLightJsonColumnsEnsured = true;
  // 빈 option_json/detail_json을 SQL NULL로 저장하기 위한 안전 보정.
  // migration 파일은 건드리지 않고, 서버 실행 시 필요한 컬럼만 NOT NULL/DEFAULT를 해제한다.
  const stmts = [
    `ALTER TABLE gm_product ALTER COLUMN option_json DROP NOT NULL`,
    `ALTER TABLE gm_product ALTER COLUMN option_json DROP DEFAULT`,
    `ALTER TABLE gm_product ALTER COLUMN detail_json DROP NOT NULL`,
    `ALTER TABLE gm_product ALTER COLUMN detail_json DROP DEFAULT`
  ];
  for(const sql of stmts){
    try{ await pool.query(sql); }
    catch(e){ try{ console.warn('[GM_PRODUCT_LIGHT_JSON_DDL_SKIP]', { sql, message:e && e.message, code:e && e.code }); }catch(_l){} }
  }
}

function pickBuyableQty(p){
  const v = firstNonEmpty(p, ['buyable_qty','buyableQty','buyableQuantity','availableQuantity','available_qty']);
  return v ? toInt(v, null) : null;
}
function pickMinOrderQty(p){
  const v = firstNonEmpty(p, ['min_order_qty','minOrderQty','minimumBuyForPerson','minPurchaseQuantity','minimumPurchaseQuantity']);
  return v ? toInt(v, null) : null;
}
function pickMaxOrderQty(p){
  const v = firstNonEmpty(p, ['max_order_qty','maxOrderQty','maximumBuyForPerson','maximumBuyCount','maxBuyCount','maxPurchaseQuantity','maximumPurchaseQuantity']);
  return v ? toInt(v, null) : null;
}
function pickReturnShippingFee(p, mallSalePrice){
  p = p || {};
  const deliveryType = cleanText(p.delivery_type || p.deliveryType || p.delivery_badge || p.deliveryBadge || p.shippingLabel || p.shippingBadge || '').toLowerCase();
  const isRocket = /rocket|fresh|로켓|프레시/.test(deliveryType);
  const directRaw = p.return_shipping_fee !== undefined ? p.return_shipping_fee : (p.returnShippingFee !== undefined ? p.returnShippingFee : p.returnFee);
  const directText = cleanText(directRaw);

  // 숫자만 직접 온 경우만 그대로 채택한다. 긴 반품 안내문이 이 필드에 들어오면 19,800원을 반품비로 오인하지 않는다.
  if(directText && /^\s*[0-9,]+\s*(?:원)?\s*$/.test(directText)) return parseMoney(directText, 0);

  const text = cleanText([
    directText,
    firstNonEmpty(p, ['return_fee_text','returnFeeText','returnFee','exchangeReturnFeeText','exchange_return_fee_text','return_policy_text','returnPolicyText','returnPolicy'])
  ].filter(Boolean).join(' '));

  if(text){
    // 로켓배송/로켓프레시의 표준 반품 안내문은 실제 반품비 5,000원만 저장한다.
    if(isRocket && /19,?800\s*원/.test(text) && /반품비\s*5,?000\s*원/.test(text)) return 5000;

    const under = text.match(/19,?800\s*원\s*미만[\s\S]{0,120}?반품비\s*([0-9,]+)\s*원/i);
    const over = text.match(/19,?800\s*원\s*이상[\s\S]{0,120}?반품비\s*([0-9,]+)\s*원/i);
    if(under && Number(mallSalePrice||0) < 19800) return parseMoney(under[1], 0);
    if(over && Number(mallSalePrice||0) >= 19800) return parseMoney(over[1], 0);
    const first = text.match(/반품비\s*([0-9,]+)\s*원/i);
    if(first) return parseMoney(first[1], 0);
  }
  return 0;
}


module.exports={cleanText,toInt,pickUnitPriceText,resolveUnitPriceSource,firstNonEmpty,parseMoney,parseCount,parseRating,bestProductName,normalizeUrl,normalizeQueueItems,makeRequestId,isPlainObject,parseIncomingPayloadBody,parseMaybeJsonAny,collectPayloadContainers,flattenDetailPayload,ids,pickFinalSupplyPrice,pickProductName,pickPrice,pickNormalPrice,pickDiscountPrice,pickDeliveryFee,pickReviewCount,pickMallSalesCount,pickRatingScore,cleanDupMallProductName,pickProductUrl,buildProductUrlFromId,pickThumbUrl,pickOptionName,pickOptionValue,pickDeliveryText,pickDeliveryType,pickSupplierName,pickSupplierId,isStandardCoupangSupplier,pickAny,sourceMallFrom,sourceUidFrom,normalizeProductPayload,jsonCleanText,safeJsonString,jsonArrayLengthSafe,compactError,pickTaxType,ensureProductLightJsonColumns,pickBuyableQty,pickMinOrderQty,pickMaxOrderQty,pickReturnShippingFee};
