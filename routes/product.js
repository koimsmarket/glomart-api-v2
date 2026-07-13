const express = require('express');
const router = express.Router();
function db(req){ return req.app.locals.db || req.app.locals.pool; }
function cleanText(v){ return String(v || '').replace(/[\u00A0\u200B-\u200D\uFEFF]/g, ' ').replace(/\s+/g, ' ').trim(); }
function toInt(v, def=0){
  const raw = String(v ?? '').replace(/,/g,'').trim();
  const m = raw.match(/-?\d+(?:\.\d+)?/);
  const n = m ? Number(m[0]) : Number(raw);
  return Number.isFinite(n) ? Math.round(n) : def;
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

function normalizeKeywordValue(v){
  return cleanText(v).toLowerCase().replace(/\s+/g, '');
}
function pickSearchKeyword(p, parent){
  return cleanText(
    p.keyword || p.q || p.search_keyword || p.searchKeyword || p.keyword_original || p.keywordOriginal ||
    (parent && (parent.keyword || parent.q || parent.search_keyword || parent.searchKeyword)) || ''
  );
}
function pickRelatedKeywords(p, parent){
  const raw = p.related_keywords || p.relatedKeywords || p.suggest_keywords || p.suggestKeywords ||
    p.recommend_keywords || p.recommendKeywords || p.coupang_related_keywords || p.coupangRelatedKeywords ||
    (parent && (parent.related_keywords || parent.relatedKeywords || parent.suggest_keywords || parent.suggestKeywords));
  let arr = [];
  if(Array.isArray(raw)) arr = raw;
  else if(typeof raw === 'string') arr = raw.split(/[|,\n\t]+/g);
  return arr.map(cleanText).filter(Boolean).filter((v,i,a)=>a.indexOf(v)===i).slice(0,50);
}



// GM_DETAIL_UPSERT_MAP_V019
// 상세 Collector payload는 {item:{...}}, {product:{...}}, {data:{...}} 또는 payload 루트에 섞여 들어올 수 있다.
// 검색 저장은 정상인데 상세 옵션/썸네일/공급자/카테고리 값이 반영되지 않던 원인은
// 서버 upsert가 루트 필드만 보고 중첩 item/detail aliases를 충분히 펼치지 않았기 때문이다.
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

// Keyword normalization/relation/translation logic moved to routes/search_keyword.js + services/keyword_relation.js.

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
function detailSignalStats(optionJson, thumbJson, detailJson, p){
  optionJson = optionJson || {}; detailJson = detailJson || {}; p = p || {};
  const thumbCount = Array.isArray(thumbJson) ? thumbJson.length : 0;
  const detailCount = (Array.isArray(detailJson.images) ? detailJson.images.length : 0) +
    (Array.isArray(detailJson.blocks) ? detailJson.blocks.length : 0) +
    (Array.isArray(detailJson.texts) ? detailJson.texts.length : 0);
  return {
    option_count: optionJson.option_count || (Array.isArray(optionJson.rows) ? optionJson.rows.length : 0),
    thumb_count: thumbCount,
    detail_count: detailCount,
    detail_image_count: Array.isArray(detailJson.images) ? detailJson.images.length : 0,
    detail_block_count: Array.isArray(detailJson.blocks) ? detailJson.blocks.length : 0,
    detail_text_count: Array.isArray(detailJson.texts) ? detailJson.texts.length : 0,
    supplier_name: cleanText(p.supplier_name || p.supplierName || ''),
    cp_fix_code: cleanText(p.cp_fix_code || p.cpFixCode || p.cp_code || p.cpCode || ''),
    return_shipping_fee: parseMoney(p.return_shipping_fee || p.returnShippingFee || p.returnFee || '', 0),
    buyable_qty: pickBuyableQty(p)
  };
}
async function applyDetailPatch(pool, id, p, optionJson, thumbJson, detailJson, returnFee){
  const stats = detailSignalStats(optionJson, thumbJson, detailJson, p);
  const remoteDelivery = normalizeRemoteDeliveryPolicy(p);
  const hasDetail = stats.option_count > 0 || stats.thumb_count > 1 || stats.detail_count > 0 || cleanText(p.supplier_name || p.supplierName) || cleanText(p.cp_fix_code || p.cpFixCode || p.cp_code || p.cpCode) || returnFee > 0 || pickBuyableQty(p) !== null;
  if(!hasDetail || !id || !id.uid) return { applied:false, reason:'no detail signal', stats, id };
  const q = `
    UPDATE gm_product SET
      option_count = CASE WHEN $2::int > 0 THEN $2::int ELSE option_count END,
      option_json = CASE WHEN $3::jsonb IS NOT NULL THEN option_json ELSE option_json END,
      thumb_json = CASE
        WHEN $4::int > 0 AND $4::int >= CASE WHEN jsonb_typeof(thumb_json)='array' THEN jsonb_array_length(thumb_json) ELSE 0 END
        THEN $5::jsonb ELSE thumb_json END,
      detail_json = CASE WHEN $6::int > 0 THEN $7::jsonb ELSE detail_json END,
      cp_selected_code = CASE
        WHEN COALESCE(cp_selected_code,'')='' AND NULLIF($8,'') IS NOT NULL THEN $8
        ELSE cp_selected_code END,
      cp_fix_code = CASE
        WHEN NULLIF($9,'') IS NULL THEN cp_fix_code
        WHEN COALESCE(cp_match,'')='T' AND COALESCE(cp_fix_code,'')<>'' AND COALESCE(cp_fix_code,'')<>$9 THEN cp_fix_code
        ELSE $9 END,
      cp_match = CASE
        WHEN NULLIF($9,'') IS NOT NULL AND COALESCE(cp_match,'')<>'T' THEN 'F'
        ELSE cp_match END,
      mall_category = COALESCE(NULLIF($10,''), mall_category),
      mall_category_json = CASE WHEN $11::jsonb <> '[]'::jsonb THEN $11::jsonb ELSE mall_category_json END,
      supplier_id = COALESCE(NULLIF($12,''), supplier_id),
      supplier_name = COALESCE(NULLIF($13,''), supplier_name),
      business_number = COALESCE(NULLIF($14,''), business_number),
      online_sales_number = COALESCE(NULLIF($15,''), online_sales_number),
      ceo_name = COALESCE(NULLIF($16,''), ceo_name),
      supplier_mobile = COALESCE(NULLIF($17,''), supplier_mobile),
      supplier_phone = COALESCE(NULLIF($18,''), supplier_phone),
      supplier_email = COALESCE(NULLIF($19,''), supplier_email),
      supplier_address = COALESCE(NULLIF($20,''), supplier_address),
      buyable_qty = COALESCE($21::int, buyable_qty),
      min_order_qty = COALESCE($22::int, min_order_qty),
      max_order_qty = COALESCE($23::int, max_order_qty),
      return_policy_text = COALESCE(NULLIF($24,''), return_policy_text),
      exchange_policy_text = COALESCE(NULLIF($25,''), exchange_policy_text),
      return_shipping_fee = CASE WHEN $26::int > 0 THEN $26::int ELSE return_shipping_fee END,
      jeju_delivery_yn = CASE WHEN $27::boolean THEN $28 ELSE jeju_delivery_yn END,
      jeju_extra_delivery_fee = CASE WHEN $27::boolean THEN $29::int ELSE jeju_extra_delivery_fee END,
      island_delivery_yn = CASE WHEN $30::boolean THEN $31 ELSE island_delivery_yn END,
      island_extra_delivery_fee = CASE WHEN $30::boolean THEN $32::int ELSE island_extra_delivery_fee END,
      updated_at = now()
    WHERE product_uid = $1 OR (mall_code=$33 AND pi_ii_vi=$34)
    RETURNING product_uid, option_count, jsonb_typeof(thumb_json) AS thumb_type,
      CASE WHEN jsonb_typeof(thumb_json)='array' THEN jsonb_array_length(thumb_json) ELSE 0 END AS thumb_count,
      COALESCE(NULLIF(detail_json->>'image_count','')::int,0) AS detail_image_count,
      COALESCE(NULLIF(detail_json->>'block_count','')::int,0) AS detail_block_count,
      supplier_name, cp_fix_code, cp_match, buyable_qty, return_shipping_fee,
      jeju_delivery_yn, jeju_extra_delivery_fee, island_delivery_yn, island_extra_delivery_fee
  `;
  const standardCoupangSupplier = isStandardCoupangSupplier(p, id);
  const vals = [
    id.uid,
    stats.option_count || 0, safeJsonString(optionJson || {headers:[],rows:[],option_count:0}),
    stats.thumb_count || 0, safeJsonString(thumbJson || []),
    stats.detail_count || 0, safeJsonString(detailJson || {}),
    pickCpSelectedCode(p), pickCpFixCode(p), pickMallCategoryLeaf(p, normalizeMallCategoryJson(p)), safeJsonString(normalizeMallCategoryJson(p)),
    standardCoupangSupplier ? '' : pickSupplierId(p), standardCoupangSupplier ? '' : pickSupplierName(p),
    standardCoupangSupplier ? '' : pickAny(p,['business_number','businessNumber','seller_business_number','sellerBusinessNumber','supplierBizNo']),
    standardCoupangSupplier ? '' : pickAny(p,['online_sales_number','onlineSalesNumber','mail_order_number','mailOrderNumber','supplierMailOrderNo']),
    standardCoupangSupplier ? '' : pickAny(p,['ceo_name','ceoName','representative_name','representativeName','supplierRepresentative']),
    standardCoupangSupplier ? '' : pickAny(p,['supplier_mobile','supplierMobile','seller_mobile','sellerMobile','phone','sellerPhone','supplierPhone']),
    standardCoupangSupplier ? '' : pickAny(p,['supplier_phone','supplierPhone','seller_phone','sellerPhone','tel','telephone','landline','sellerTel','supplierTel']),
    standardCoupangSupplier ? '' : pickAny(p,['supplier_email','supplierEmail','seller_email','sellerEmail']),
    standardCoupangSupplier ? '' : pickAny(p,['supplier_address','supplierAddress','seller_address','sellerAddress']),
    pickBuyableQty(p), pickMinOrderQty(p), pickMaxOrderQty(p),
    cleanText(p.return_policy_text || p.returnPolicyText || p.return_policy || p.returnPolicy || ''),
    cleanText(p.exchange_policy_text || p.exchangePolicyText || p.exchange_policy || p.exchangePolicy || ''),
    returnFee || 0,
    remoteDelivery.jeju_provided, remoteDelivery.jeju_delivery_yn, remoteDelivery.jeju_extra_delivery_fee,
    remoteDelivery.island_provided, remoteDelivery.island_delivery_yn, remoteDelivery.island_extra_delivery_fee,
    cleanText(id.mallCode || ''), cleanText(id.pi || '')
  ];
  const r = await pool.query(q, vals);
  return { applied:r.rowCount > 0, row:r.rows[0] || null, stats, match:{ product_uid:id.uid, mall_code:id.mallCode, pi_ii_vi:id.pi } };
}
function pickOptPrice(row, names){
  row=row||{};
  for(const n of names){
    if(row[n] !== undefined && row[n] !== null && cleanText(row[n]) !== '') return parseMoney(row[n], 0);
  }
  return 0;
}

function normalizeMallCategoryJson(p){
  p=p||{};
  let src = p.mall_category_json || p.mallCategoryJson || p.mall_category_path_json || p.mallCategoryPathJson ||
            p.cp_category_tree_json || p.cpCategoryTreeJson || p.category_tree_json || p.categoryTreeJson ||
            p.categoryTree || p.category_tree || p.cpCategoryTree || p.cp_category_tree ||
            p.breadcrumbs || p.breadcrumb || p.categoryPathItems || p.category_path_items || [];
  if(typeof src === 'string'){
    const parsed = parseMaybeJsonAny(src);
    if(parsed) src = parsed;
  }
  if(src && !Array.isArray(src) && Array.isArray(src.path)) src = src.path;
  if(src && !Array.isArray(src) && Array.isArray(src.nodes)) src = src.nodes;
  if(src && !Array.isArray(src) && Array.isArray(src.tree)) src = src.tree;
  if(!Array.isArray(src)) src = [];
  const out=[]; const seen=new Set();
  src.forEach((r)=>{
    let id='', name='', href='', depth=out.length;
    if(r && typeof r === 'object'){
      id = cleanText(r.cp_code || r.cpCode || r.id || r.category_id || r.categoryId || r.cate_no || r.cateNo || r.code || '');
      name = cleanText(r.name_ko || r.nameKo || r.name || r.category_name || r.categoryName || r.title || r.label || '');
      href = cleanText(r.href || r.url || '');
      depth = (r.depth !== undefined || r.level !== undefined) ? toInt(r.depth !== undefined ? r.depth : r.level, depth) : depth;
    }else{
      name = cleanText(r);
    }
    if(!id && !name) return;
    const sig=(id||'')+'|'+name;
    if(seen.has(sig)) return; seen.add(sig);
    // DB에는 카테고리 경로 복원에 필요한 최소값만 저장한다.
    out.push({ depth: depth, id, name });
  });
  return out;
}
function pickMallCategoryLeaf(p, mallCategoryJson){
  p=p||{};
  const arr = Array.isArray(mallCategoryJson) ? mallCategoryJson : normalizeMallCategoryJson(p);
  const leaf = arr.length ? arr[arr.length-1] : null;
  const leafId = cleanText((leaf && leaf.id) || p.mall_category_id || p.mallCategoryId || '');
  if(leafId) return leafId;
  const direct = cleanText(p.mall_category || p.mallCategory || '');
  if(/^\d+$/.test(direct)) return direct;
  const m = direct.match(/\((\d{3,})\)\s*$/) || direct.match(/(\d{3,})\s*$/);
  if(m) return m[1];
  return direct;
}

function normalizeThumbJson(p){
  p=p||{};
  if(p.thumb_json && typeof p.thumb_json === 'object' && !Array.isArray(p.thumb_json)){
    if(Array.isArray(p.thumb_json.images) && !Array.isArray(p.thumbnailImages)) p.thumbnailImages = p.thumb_json.images;
    if(Array.isArray(p.thumb_json.rows) && !Array.isArray(p.thumbnailImages)) p.thumbnailImages = p.thumb_json.rows;
    if(Array.isArray(p.thumb_json.urls) && !Array.isArray(p.thumbnailImages)) p.thumbnailImages = p.thumb_json.urls;
  }
  if(p.thumbJson && typeof p.thumbJson === 'object' && !Array.isArray(p.thumbJson)){
    if(Array.isArray(p.thumbJson.images) && !Array.isArray(p.thumbnailImages)) p.thumbnailImages = p.thumbJson.images;
    if(Array.isArray(p.thumbJson.rows) && !Array.isArray(p.thumbnailImages)) p.thumbnailImages = p.thumbJson.rows;
    if(Array.isArray(p.thumbJson.urls) && !Array.isArray(p.thumbnailImages)) p.thumbnailImages = p.thumbJson.urls;
  }
  const out=[]; const seen=new Set();
  function add(v, source){
    if(v && typeof v === 'object') v = v.url || v.src || v.image || v.thumb || '';
    v = normalizeUrl(v);
    if(!v || seen.has(v)) return;
    seen.add(v);
    out.push(v);
  }
  [p.thumb_json,p.thumbJson,p.thumbnailImages,p.images,p.galleryImages,p.thumbnails,p.mainThumbnailImages,p.skuThumbnailImages,p.topImages,p.mainImages,p.thumbs].forEach((a)=>{
    if(Array.isArray(a)) a.forEach(x=>add(x,'array'));
  });
  add(p.thumb_origin_url || p.thumbOriginUrl || p.thumb_url || p.thumbUrl || p.thumbnail || p.image || p.mainImage, 'main');
  return out;
}

function normalizeDetailJson(p){
  p=p||{};
  if(p.detail_json && typeof p.detail_json === 'object' && !Array.isArray(p.detail_json)){
    if(Array.isArray(p.detail_json.images) && !Array.isArray(p.detailImages)) p.detailImages = p.detail_json.images;
    if(Array.isArray(p.detail_json.blocks) && !Array.isArray(p.detailBlocks)) p.detailBlocks = p.detail_json.blocks;
    if(Array.isArray(p.detail_json.texts) && !Array.isArray(p.detailTexts)) p.detailTexts = p.detail_json.texts;
  }
  if(p.detailJson && typeof p.detailJson === 'object' && !Array.isArray(p.detailJson)){
    if(Array.isArray(p.detailJson.images) && !Array.isArray(p.detailImages)) p.detailImages = p.detailJson.images;
    if(Array.isArray(p.detailJson.blocks) && !Array.isArray(p.detailBlocks)) p.detailBlocks = p.detailJson.blocks;
    if(Array.isArray(p.detailJson.texts) && !Array.isArray(p.detailTexts)) p.detailTexts = p.detailJson.texts;
  }
  const images=[]; const blocks=[]; const texts=[]; const seenImg=new Set();
  function addImage(v, source){
    if(v && typeof v === 'object') v = v.url || v.src || v.image || v.img || '';
    v = normalizeUrl(v);
    if(!v || seenImg.has(v)) return;
    seenImg.add(v);
    images.push({ url:v, source:source || 'detail', index:images.length });
  }
  function addText(v, source){
    v = cleanText(v);
    if(!v) return;
    if(texts.indexOf(v) >= 0) return;
    texts.push(v);
    blocks.push({ type:'text', text:v, source:source || 'detail', index:blocks.length });
  }
  function addBlock(b, source){
    if(!b) return;
    if(typeof b === 'string'){
      const u = normalizeUrl(b);
      if(u) { addImage(u, source || 'detailBlock'); return; }
      addText(b, source || 'detailBlock');
      return;
    }
    if(typeof b !== 'object') return;
    const type = cleanText(b.type || b.kind || '').toLowerCase();
    const img = b.url || b.src || b.image || b.img || b.imageUrl || b.image_url || b.detailImageUrl || b.detail_image_url || b.originUrl || b.origin_url || '';
    const txt = b.text || b.content || b.value || b.htmlText || b.html_text || b.html || b.desc || b.description || '';
    if(img || type === 'image'){
      const before = images.length;
      addImage(img, source || 'detailBlock');
      if(images.length > before) blocks.push({ type:'image', url:images[images.length-1].url, source:source || 'detailBlock', index:blocks.length });
      return;
    }
    if(txt || type === 'text') addText(txt, source || 'detailBlock');
  }
  const imageKeys=['detailImages','detail_images','detailImageUrls','detail_image_urls','descriptionImages','description_images','contentImages','content_images','productDetailImages','product_detail_images'];
  const blockKeys=['detailBlocks','detail_blocks','blocks','contentBlocks','content_blocks','descriptionBlocks','description_blocks','productDetailBlocks','product_detail_blocks'];
  const textKeys=['detailTexts','detail_texts','descriptionTexts','description_texts','productDetailText','product_detail_text'];
  imageKeys.forEach(k=>{ const a=p[k]; if(Array.isArray(a)) a.forEach(x=>addImage(x,k)); });
  blockKeys.forEach(k=>{ const a=p[k]; if(Array.isArray(a)) a.forEach(x=>addBlock(x,k)); });
  textKeys.forEach(k=>{ const a=p[k]; if(Array.isArray(a)) a.forEach(x=>addText(x,k)); else if(a) addText(a,k); });
  // 상세 payload가 detail/result/payload 하위에 숨어 오거나 JSON 문자열로 오는 경우까지 한 번 더 deep scan한다.
  collectPayloadContainers(p, 5).forEach(o=>{
    imageKeys.forEach(k=>{ const a=o[k]; if(Array.isArray(a)) a.forEach(x=>addImage(x,k)); });
    blockKeys.forEach(k=>{ const a=o[k]; if(Array.isArray(a)) a.forEach(x=>addBlock(x,k)); });
    textKeys.forEach(k=>{ const a=o[k]; if(Array.isArray(a)) a.forEach(x=>addText(x,k)); else if(a) addText(a,k); });
    const dj=parseMaybeJsonAny(o.detail_json || o.detailJson);
    if(dj && typeof dj==='object'){
      if(Array.isArray(dj.images)) dj.images.forEach(x=>addImage(x,'detail_json.images'));
      if(Array.isArray(dj.blocks)) dj.blocks.forEach(x=>addBlock(x,'detail_json.blocks'));
      if(Array.isArray(dj.texts)) dj.texts.forEach(x=>addText(x,'detail_json.texts'));
    }
  });
  const out={ images, blocks, texts, image_count:images.length, block_count:blocks.length, text_count:texts.length, updated_at:new Date().toISOString() };
  try{ console.log('[GM_DETAIL_JSON_NORMALIZE]', { image_count:out.image_count, block_count:out.block_count, text_count:out.text_count, keys:Object.keys(p||{}).slice(0,80) }); }catch(_e){}
  return out;
}
function parseMaybeJsonObject(v){
  if(!v) return null;
  if(typeof v === 'object') return v;
  if(typeof v === 'string'){
    try{
      const o = JSON.parse(v);
      return o && typeof o === 'object' ? o : null;
    }catch(_e){ return null; }
  }
  return null;
}
function normalizeOptionJson(p, id){
  p=p||{}; id=id||{};
  const arrays=[];
  const optionKeys = ['optionCombos','aliOptionCombos','flatOptionRows','optionRows','option_rows','detailOptionRows','optionsRows','visibleOptions','options','vendorItemOptions','itemOptions','selectedOptions','optionList','skuOptions','skuList','variants'];
  const addArray = (a)=>{
    if(typeof a === 'string'){
      const parsed = parseMaybeJsonAny(a);
      if(Array.isArray(parsed)) a = parsed;
      else if(parsed && typeof parsed === 'object'){
        optionKeys.forEach(k=>{ if(Array.isArray(parsed[k]) && parsed[k].length) arrays.push(parsed[k]); });
        if(Array.isArray(parsed.rows) && parsed.rows.length) arrays.push(parsed.rows);
        return;
      }
    }
    if(Array.isArray(a) && a.length) arrays.push(a);
  };
  const addJsonRows = (v)=>{
    const o = parseMaybeJsonAny(v);
    if(!o) return;
    if(Array.isArray(o)) addArray(o);
    if(o && Array.isArray(o.rows)) addArray(o.rows);
    optionKeys.forEach(k=>{ if(o && Array.isArray(o[k])) addArray(o[k]); });
  };
  addJsonRows(p.option_json);
  addJsonRows(p.optionJson);
  addJsonRows(p.detail_json);
  addJsonRows(p.detailJson);
  optionKeys.forEach(k=>addArray(p[k]));
  collectPayloadContainers(p, 4).forEach(o=>{
    optionKeys.forEach(k=>addArray(o[k]));
    addJsonRows(o.option_json); addJsonRows(o.optionJson); addJsonRows(o.detail_json); addJsonRows(o.detailJson);
  });

  const headers=['uid','product_id','item_id','vendor_item_id','option_name','mall_price','normal_price','delivery_badge','delivery_fee','delivery_eta_text','option_image_url','soldout_yn','source'];
  const rows=[]; const seen=new Set();
  const pushRow = (row)=>{
    const sig = cleanText(row[0]) || (cleanText(row[4]) + '|' + cleanText(row[3]) + '|' + cleanText(row[2]));
    if(!sig || seen.has(sig)) return;
    seen.add(sig); rows.push(row);
  };
  arrays.forEach(arr=>arr.forEach((r)=>{
    if(Array.isArray(r)){
      const uid0=cleanText(r[0] || '');
      const productId0=cleanText(r[1] || id.productId || p.productId || p.product_id || '');
      const itemId0=cleanText(r[2] || id.itemId || p.itemId || p.item_id || '');
      const vendorItemId0=cleanText(r[3] || id.vendorItemId || p.vendorItemId || p.vendor_item_id || itemId0 || productId0 || '');
      const pi0=[productId0,itemId0,vendorItemId0].filter(Boolean).join('_') || cleanText(uid0.replace(/^\w+_/,''));
      const uid=uid0 || (id.mallCode && pi0 ? id.mallCode + '_' + pi0 : pi0);
      const name0=cleanText(r[4] || r[5] || p.optionName || p.product_name || p.productName || '기본옵션');
      if(!uid && !name0) return;
      pushRow([uid,productId0,itemId0,vendorItemId0,name0,parseMoney(r[5],0),parseMoney(r[6],0),cleanText(r[7]||''),parseMoney(r[8],0),cleanText(r[9]||''),normalizeUrl(r[10]||''),!!r[11],cleanText(r[12]||'')]);
      return;
    }
    if(!r || typeof r !== 'object') return;
    const productId = cleanText(r.productId || r.product_id || r.pid || id.productId || p.productId || p.product_id || '');
    const itemId = cleanText(r.itemId || r.item_id || r.itemID || r.skuIdStr || r.sku_id_str || r.skuId || r.sku_id || r.aliSkuId || r.ali_sku_id || r.optionId || r.option_id || (id.mallCode==='ALKR' ? (r.aliSkuId || r.optionId || '') : '') || id.itemId || '');
    const vendorItemId = cleanText(r.vendorItemId || r.venderItemId || r.vendor_item_id || r.vendorItemID || r.vid || r.skuId || r.sku_id || r.aliSkuId || r.ali_sku_id || r.optionId || r.option_id || itemId || id.vendorItemId || productId || '');
    const pi = [productId, itemId, vendorItemId].filter(Boolean).join('_') || cleanText(r.key || r.uid || r.option_uid || r.pi_ii_vi || r.piIiVi || '');
    const uid = cleanText(r.uid || r.option_uid || (id.mallCode && pi ? id.mallCode + '_' + pi : pi));
    const name = cleanText(r.fullOptionName || r.displayOptionName || r.selectedOptionText || r.optionText || r.optionName || r.option_name || r.name || r.value || r.title || r.label || '');
    if(!uid && !name) return;
    const mallPrice = pickOptPrice(r, ['mall_sale_price','mallSalePrice','mall_price','mallPrice','raw_price','rawPrice','rawCoupangOptionPrice','rawOptionPrice','rawOptionPriceText','coupangPrice','aliRawPrice','aliRawPriceText','basePrice','basePriceText','salePrice','sale_price']);
    const normalPrice = pickOptPrice(r, ['normal_price','normalPrice','final_supply_price','finalSupplyPrice','sell_price','sellPrice','calculatedPrice','gm_price','gmPrice','optionPrice','optionPriceText','price','priceText','finalPriceText']);
    const feeText = cleanText(r.delivery_fee_text || r.deliveryFeeText || r.optionShippingFeeText || r.shippingFeeText || r.baseShippingFeeText || r.deliveryFee || p.deliveryFeeText || p.shippingFeeText || '');
    const fee = r.delivery_fee !== undefined ? parseMoney(r.delivery_fee, 0) : parseMoney(feeText, 0);
    const badgeText = cleanText(r.delivery_badge_text || r.deliveryBadgeText || r.optionShippingBadge || r.shippingBadge || r.deliveryBadge || r.deliveryType || r.delivery_type || r.shipType || p.shippingLabel || p.deliveryType || p.delivery_type || '');
    const img = normalizeUrl(r.option_image_url || r.optionImageUrl || r.optionImage || r.colorImage || r.image || r.thumbnail || r.thumb || '');
    const sold = !!(r.soldout_yn === true || r.soldoutYn === true || r.soldout === true || /품절|sold\s*out/i.test(cleanText(r.soldout_yn || r.soldoutYn || r.status || r.sale_status || '')));
    pushRow([uid,productId,itemId,vendorItemId,name,mallPrice,normalPrice,badgeText,fee,cleanText(r.delivery_eta_text || r.deliveryEtaText || r.deliveryDateText || r.arrivalText || r.etaText || p.deliveryDateText || p.arrivalText || ''),img,sold,cleanText(r.source || '')]);
  }));

  // 검색결과 payload에는 옵션배열이 없지만 현재 리스트 행 자체가 대표 판매옵션이다.
  // 따라서 검색 upsert에서도 gm_product_option 기본 1행을 만든다.
  if(!rows.length && id.productId && id.pi){
    const name = cleanText(p.optionName || p.option_name || p.selectedOptionName || p.selected_option_name || p.product_name || p.productName || p.title || '기본옵션');
    const uid = cleanText(id.mallCode && id.pi ? id.mallCode + '_' + id.pi : id.pi);
    rows.push([
      uid, id.productId, id.itemId || '', id.vendorItemId || id.productId, name,
      pickPrice(p), pickNormalPrice(p) || 0, pickDeliveryType(p), pickDeliveryFee(p), pickDeliveryText(p),
      normalizeUrl(p.option_image_url || p.optionImageUrl || p.thumb_origin_url || p.thumbOriginUrl || p.thumbnail || p.image || ''),
      /품절|sold\s*out/i.test(cleanText(p.soldout_yn || p.soldoutYn || p.soldout || p.sale_status || '')),
      'search-row'
    ]);
  }

  const selectedUid = cleanText(p.default_uid || p.defaultUid || p.selectedOptionUid || p.selected_option_uid || id.uid || '');
  const defaultUid = rows.some(r=>r[0]===selectedUid) ? selectedUid : (rows[0] && rows[0][0] || selectedUid);
  return { headers, rows, default_uid:defaultUid, option_count:rows.length, updated_at:new Date().toISOString() };
}

// GM_PRODUCT_OPTION_TABLE_V001
// 옵션은 상품 JSON에 중복 저장하지 않고 gm_product_option에만 운영 컬럼으로 저장한다.
function makeEmptyOptionJson(){
  return { iid_vid:'' };
}
function makeProductOptionLinkJson(optionJson, id){
  optionJson = optionJson || {}; id = id || {};
  const vals = [];
  const seen = new Set();
  function add(iid, vid){
    iid = cleanText(iid); vid = cleanText(vid);
    if(!iid || !vid) return;
    const v = iid + '_' + vid;
    if(seen.has(v)) return;
    seen.add(v); vals.push(v);
  }
  if(Array.isArray(optionJson.rows)){
    optionJson.rows.forEach(r=>{
      if(Array.isArray(r)) add(r[2], r[3]);
      else if(r && typeof r === 'object') add(r.item_id || r.itemId, r.vendor_item_id || r.vendorItemId);
    });
  }
  // 상품 대표 IID/VID는 gm_product 자체 컬럼에 있으므로 option_json에 중복 저장하지 않는다.
  if(!vals.length) return null;
  return { iid_vid: vals.join('|') };

}
function normalizeSoldoutYn(v){
  const s = cleanText(v);
  if(v === true) return 'Y';
  if(/^(y|yes|true|1|soldout|sold_out)$/i.test(s) || /품절|일시품절|sold\s*out/i.test(s)) return 'Y';
  return 'N';
}
function optionRowsFromOptionJson(optionJson, id, p){
  optionJson = optionJson || {}; id = id || {}; p = p || {};
  const rows = Array.isArray(optionJson.rows) ? optionJson.rows : [];
  const out = [];
  rows.forEach((r, idx)=>{
    if(!Array.isArray(r)) return;
    const productId = cleanText(r[1] || id.productId || p.productId || p.product_id || '');
    const itemId = cleanText(r[2] || id.itemId || p.itemId || p.item_id || '');
    const vendorItemId = cleanText(r[3] || id.vendorItemId || p.vendorItemId || p.vendor_item_id || productId || '');
    const pi = [productId, itemId, vendorItemId].filter(Boolean).join('_') || cleanText(r[0] || id.pi || '');
    if(!productId || !pi) return;
    const name = cleanText(r[4] || p.option_name || p.optionName || p.product_name || p.productName || '기본옵션');
    const soldoutYn = normalizeSoldoutYn(r[11]);
    out.push({
      mall_code: cleanText(id.mallCode || p.mall_code || p.mallCode || '').toUpperCase(),
      product_id: productId,
      item_id: itemId,
      vendor_item_id: vendorItemId,
      pi_ii_vi: pi,
      option_name: name,
      option_image_url: normalizeUrl(r[10] || ''),
      option_sort_no: idx + 1,
      mall_sale_price: parseMoney(r[5], 0),
      final_supply_price: null,
      normal_price: parseMoney(r[6], 0),
      discount_price: 0,
      delivery_fee: parseMoney(r[8], 0),
      delivery_eta_text: cleanText(r[9] || ''),
      delivery_type: cleanText(r[7] || ''),
      soldout_yn: soldoutYn,
      sale_status: soldoutYn === 'Y' ? 'soldout' : 'active',
      active_yn: 'Y',
      buyable_qty: pickBuyableQty(p),
      min_order_qty: pickMinOrderQty(p),
      max_order_qty: pickMaxOrderQty(p)
    });
  });
  return out;
}

async function ensureProductOptionTable(pool){
  await pool.query(`
    CREATE TABLE IF NOT EXISTS gm_product_option (
      mall_code TEXT NOT NULL,
      product_id TEXT NOT NULL,
      item_id TEXT,
      vendor_item_id TEXT,
      pi_ii_vi TEXT NOT NULL,
      option_name TEXT,
      option_image_url TEXT,
      option_sort_no INTEGER NOT NULL DEFAULT 0,
      mall_sale_price INTEGER NOT NULL DEFAULT 0,
      final_supply_price INTEGER,
      normal_price INTEGER,
      discount_price INTEGER NOT NULL DEFAULT 0,
      delivery_fee INTEGER NOT NULL DEFAULT 0,
      delivery_eta_text TEXT,
      delivery_type TEXT,
      soldout_yn TEXT NOT NULL DEFAULT 'N',
      sale_status TEXT NOT NULL DEFAULT 'active',
      active_yn TEXT NOT NULL DEFAULT 'Y',
      buyable_qty INTEGER,
      min_order_qty INTEGER,
      max_order_qty INTEGER,
      sales_qty INTEGER NOT NULL DEFAULT 0,
      last_seen_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT now(),
      updated_at TIMESTAMP,
      PRIMARY KEY (mall_code, pi_ii_vi)
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_gm_product_option_product ON gm_product_option(mall_code, product_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_gm_product_option_active ON gm_product_option(mall_code, product_id, active_yn)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_gm_product_option_vendor ON gm_product_option(vendor_item_id)`);
}

async function upsertProductOptions(pool, id, optionJson, p, parent){
  const result = { received:0, inserted:0, updated:0, skipped:0, nonactive:0, balance_ok:true, samples:[], errors:[] };
  const optionRows = optionRowsFromOptionJson(optionJson, id, p);
  result.received = optionRows.length;
  if(!optionRows.length) return result;
  await ensureProductOptionTable(pool);
  const seen = new Set();
  for(const opt of optionRows){
    try{
      if(!opt.mall_code || !opt.product_id || !opt.pi_ii_vi){
        result.skipped += 1;
        if(result.samples.length < 5) result.samples.push({ action:'skip', reason:'required option field missing', opt });
        continue;
      }
      const sig = opt.mall_code + '|' + opt.pi_ii_vi;
      if(seen.has(sig)){
        result.skipped += 1;
        if(result.samples.length < 5) result.samples.push({ action:'skip', reason:'duplicate option in payload', pi_ii_vi:opt.pi_ii_vi });
        continue;
      }
      seen.add(sig);
      const r = await pool.query(`
        INSERT INTO gm_product_option (
          mall_code, product_id, item_id, vendor_item_id, pi_ii_vi,
          option_name, option_image_url, option_sort_no,
          mall_sale_price, final_supply_price, normal_price, discount_price,
          delivery_fee, delivery_eta_text, delivery_type,
          soldout_yn, sale_status, active_yn,
          buyable_qty, min_order_qty, max_order_qty,
          sales_qty, last_seen_at, created_at, updated_at
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,0,now(),now(),now()
        )
        ON CONFLICT (mall_code, pi_ii_vi) DO UPDATE SET
          product_id=EXCLUDED.product_id,
          item_id=EXCLUDED.item_id,
          vendor_item_id=EXCLUDED.vendor_item_id,
          option_name=EXCLUDED.option_name,
          option_image_url=COALESCE(NULLIF(EXCLUDED.option_image_url,''), gm_product_option.option_image_url),
          option_sort_no=EXCLUDED.option_sort_no,
          mall_sale_price=EXCLUDED.mall_sale_price,
          final_supply_price=COALESCE(EXCLUDED.final_supply_price, gm_product_option.final_supply_price),
          normal_price=COALESCE(EXCLUDED.normal_price, gm_product_option.normal_price),
          discount_price=EXCLUDED.discount_price,
          delivery_fee=EXCLUDED.delivery_fee,
          delivery_eta_text=EXCLUDED.delivery_eta_text,
          delivery_type=EXCLUDED.delivery_type,
          soldout_yn=EXCLUDED.soldout_yn,
          sale_status=EXCLUDED.sale_status,
          active_yn='Y',
          buyable_qty=COALESCE(EXCLUDED.buyable_qty, gm_product_option.buyable_qty),
          min_order_qty=COALESCE(EXCLUDED.min_order_qty, gm_product_option.min_order_qty),
          max_order_qty=COALESCE(EXCLUDED.max_order_qty, gm_product_option.max_order_qty),
          last_seen_at=now(),
          updated_at=now()
        RETURNING (xmax = 0) AS inserted
      `, [
        opt.mall_code, opt.product_id, opt.item_id, opt.vendor_item_id, opt.pi_ii_vi,
        opt.option_name, opt.option_image_url, opt.option_sort_no,
        opt.mall_sale_price, opt.final_supply_price, opt.normal_price, opt.discount_price,
        opt.delivery_fee, opt.delivery_eta_text, opt.delivery_type,
        opt.soldout_yn, opt.sale_status, opt.active_yn,
        opt.buyable_qty, opt.min_order_qty, opt.max_order_qty
      ]);
      if(r.rows[0] && r.rows[0].inserted) result.inserted += 1;
      else result.updated += 1;
      if(result.samples.length < 5) result.samples.push({ action:(r.rows[0] && r.rows[0].inserted) ? 'inserted' : 'updated', pi_ii_vi:opt.pi_ii_vi, name:opt.option_name });
    }catch(e){
      result.skipped += 1;
      result.errors.push(compactError(e));
      if(result.samples.length < 5) result.samples.push({ action:'error', pi_ii_vi:opt.pi_ii_vi, error:String(e && e.message || e) });
      if(e && e.code === '42P01') break;
    }
  }
  // 수집 payload가 2개 이상 옵션을 갖고 있을 때만 전체 옵션리스트로 보고 누락 옵션을 NonActive 처리한다.
  // 검색결과의 대표 옵션 1개 저장이 기존 옵션 전체를 죽이는 것을 방지한다.
  if(seen.size > 1){
    try{
      const livePi = Array.from(seen).map(x=>x.split('|').slice(1).join('|'));
      const nr = await pool.query(`
        UPDATE gm_product_option
        SET active_yn='N', sale_status='inactive', updated_at=now()
        WHERE mall_code=$1 AND product_id=$2 AND NOT (pi_ii_vi = ANY($3::text[])) AND active_yn <> 'N'
      `, [cleanText(id.mallCode).toUpperCase(), cleanText(id.productId), livePi]);
      result.nonactive = nr.rowCount || 0;
    }catch(e){ result.errors.push(compactError(e)); }
  }
  result.balance_ok = result.received === (result.inserted + result.updated + result.skipped);
  return result;
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


const {
  pickCpSelectedCode,
  pickCpFixCode,
  normalizeCpMatch,
  ensureProductCpColumns,
  parseCategoryTreeFromPayload,
  findCpSelectedCodeForKeyword,
  findCpSelectedCodeForKeywordAndTree,
  ensureDynamicCategoriesFromDetail,
  decideCpMatch,
  applyCpFixLearning
} = require('../services/category');


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


function normalizeRemoteDeliveryPolicy(p){
  p = p || {};
  // 서버가 지역배송 상태의 유효성만 검증한다.
  // 필드 미제공은 기존 DB 값 유지, 명시적 null은 NULL 저장이다.
  const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
  const pickProvided = (snake, camel) => {
    if(own(p, snake)) return { provided:true, value:p[snake] };
    if(own(p, camel)) return { provided:true, value:p[camel] };
    return { provided:false, value:undefined };
  };
  const normalizeMode = (v) => {
    if(v === null || v === undefined || cleanText(v) === '') return null;
    const m = cleanText(v).toUpperCase();
    return (m === 'Y' || m === 'N' || m === 'F') ? m : null;
  };
  const normalizeOne = (statusSnake, statusCamel, feeSnake, feeCamel) => {
    const statusRaw = pickProvided(statusSnake, statusCamel);
    const feeRaw = pickProvided(feeSnake, feeCamel);
    let status = statusRaw.provided ? normalizeMode(statusRaw.value) : null;
    let fee = feeRaw.provided && feeRaw.value !== null && feeRaw.value !== ''
      ? Math.max(0, parseMoney(feeRaw.value, 0))
      : null;

    // 상태 없이 금액만 명시된 구형 payload를 안전하게 해석한다.
    if(!statusRaw.provided && feeRaw.provided){
      status = fee === null ? null : (fee > 0 ? 'Y' : 'F');
    }
    if(status === 'N') fee = null;
    else if(status === 'F') fee = 0;
    else if(status === 'Y' && fee === null) fee = 0;
    else if(status === null && statusRaw.provided) fee = null;

    return {
      provided: statusRaw.provided || feeRaw.provided,
      status_provided: statusRaw.provided,
      fee_provided: feeRaw.provided,
      status,
      fee
    };
  };
  const jeju = normalizeOne('jeju_delivery_yn','jejuDeliveryYn','jeju_extra_delivery_fee','jejuExtraDeliveryFee');
  const island = normalizeOne('island_delivery_yn','islandDeliveryYn','island_extra_delivery_fee','islandExtraDeliveryFee');
  return {
    jeju_provided: jeju.provided,
    jeju_delivery_yn: jeju.status,
    jeju_extra_delivery_fee: jeju.fee,
    island_provided: island.provided,
    island_delivery_yn: island.status,
    island_extra_delivery_fee: island.fee
  };
}

async function upsertProduct(pool, raw, parent={}){
  const n = normalizeProductPayload(raw, parent);
  const p = n.p, id = n.id, productName = n.productName;
  const missing = [];
  if(!id.uid) missing.push('product_uid');
  if(!id.pi) missing.push('pi_ii_vi');
  if(!id.mallCode) missing.push('mall_code');
  if(!productName) missing.push('product_name');
  if(missing.length){
    return { ok:false, skipped:true, reason:'required field missing: ' + missing.join(','), missing, uid:id.uid||'', pi_ii_vi:id.pi||'', mall_code:id.mallCode||'', product_id:id.productId||'', source_url:pickProductUrl(p), title_sample:cleanText(p.title||p.name||p.productName||p.product_name).slice(0,120) };
  }

  // product_url 저장 중단: 필요 시 아래 줄을 부활한다.
  // const productUrl = normalizeUrl(buildProductUrlFromId(id) || pickProductUrl(p));
  const productUrl = '';
  const thumbUrl = pickThumbUrl(p);
  const sourceMall = sourceMallFrom(p, p.source_uid || p.sourceUid, productUrl, id.mallCode);
  const sourceMallStored = cleanText(sourceMall).toUpperCase() === cleanText(id.mallCode).toUpperCase() ? '' : sourceMall;
  const sourceUid = sourceUidFrom(p, sourceMall);
  const searchKeyword = pickSearchKeyword(p, parent);
  const relatedKeywords = pickRelatedKeywords(p, parent);
  const mallSalePrice = pickPrice(p);
  const normalPrice = pickNormalPrice(p);
  const finalSupplyPrice = pickFinalSupplyPrice(p, mallSalePrice);
  const mallCategoryJson = normalizeMallCategoryJson(p);
  const mallCategoryLeaf = pickMallCategoryLeaf(p, mallCategoryJson);
  const categoryTreeForMatch = parseCategoryTreeFromPayload(p);
  const categoryTreeForSave = (Array.isArray(categoryTreeForMatch) && categoryTreeForMatch.length) ? categoryTreeForMatch : mallCategoryJson;
  let cpSelectedCode = pickCpSelectedCode(p);
  const cpFixCode = pickCpFixCode(p);
  try{ console.log('[GM_CATEGORY_TREE_SOURCE_PROBE]', { uid:id.uid, keyword:searchKeyword, cp_fix_code:cpFixCode, mall_category_leaf:mallCategoryLeaf, mall_category_json_count:Array.isArray(mallCategoryJson)?mallCategoryJson.length:0, category_tree_count:Array.isArray(categoryTreeForMatch)?categoryTreeForMatch.length:0, save_tree_count:Array.isArray(categoryTreeForSave)?categoryTreeForSave.length:0, raw_alias_counts:{ categoryTree:Array.isArray(p.categoryTree)?p.categoryTree.length:0, category_tree:Array.isArray(p.category_tree)?p.category_tree.length:0, categoryTreeJson:Array.isArray(p.categoryTreeJson)?p.categoryTreeJson.length:(cleanText(p.categoryTreeJson)?'text':0), cpCategoryTree:Array.isArray(p.cpCategoryTree)?p.cpCategoryTree.length:0, mall_category_json:Array.isArray(p.mall_category_json)?p.mall_category_json.length:(cleanText(p.mall_category_json)?'text':0) }, categoryInfo_keys:p.categoryInfo && typeof p.categoryInfo==='object'?Object.keys(p.categoryInfo).slice(0,20):[], sample:(Array.isArray(categoryTreeForSave)?categoryTreeForSave:[]).slice(0,10).map(x=>({depth:x.depth, cp_code:x.cp_code, name_ko:x.name_ko})) }); }catch(_probe){}

  // CATEGORY_TREE 기반 신규 카테고리는 selected 매칭보다 먼저 처리한다.
  // 그래야 path에 새로 들어온 cp_code도 즉시 gm_category 후보가 되어 selected/fix 비교가 가능하다.
  let category_dynamic = null;
  try{
    if(cpFixCode || (Array.isArray(categoryTreeForSave) && categoryTreeForSave.length)){
      category_dynamic = await ensureDynamicCategoriesFromDetail(pool, Object.assign({}, p, { mall_category_json: categoryTreeForSave, mall_category: mallCategoryLeaf, cp_fix_code: cpFixCode }), { mall_code:id.mallCode, keyword:searchKeyword, product_id:id.productId, item_id:id.itemId, vendor_item_id:id.vendorItemId });
    }
  }catch(e){ category_dynamic={ applied:false, error:compactError(e) }; }
  if(!cpSelectedCode){
    if((cpFixCode || (Array.isArray(categoryTreeForMatch) && categoryTreeForMatch.length)) && searchKeyword){
      cpSelectedCode = await findCpSelectedCodeForKeywordAndTree(pool, searchKeyword, categoryTreeForMatch);
    }
    if(!cpSelectedCode) cpSelectedCode = await findCpSelectedCodeForKeyword(pool, searchKeyword);
    // 검색어로 카테고리 후보가 잡히지 않으면 상품이 미아가 되지 않도록 검색어를 임시 selected로 보관한다.
    if(!cpSelectedCode && searchKeyword) cpSelectedCode = searchKeyword;
  }
  const cpMatch = decideCpMatch(p, id.mallCode, cpFixCode, cpSelectedCode);
  // cp_selected_code는 검색어 기준 후보 코드다. 상세 leaf(cp_fix_code)가 확인되어도 selected를 leaf로 덮어쓰지 않는다.
  // 예: 푸룬 검색은 selected=432516(건자두/푸룬), fix=445867(셀러가 올린 실제 leaf)로 함께 보관한다.
  await ensureProductCpColumns(pool);
  await ensureProductLightJsonColumns(pool);
  const optionJson = normalizeOptionJson(p, id);
  const thumbJson = normalizeThumbJson(p);
  const detailJsonRaw = normalizeDetailJson(p);
  const detailJsonHasData = !!(detailJsonRaw && ((detailJsonRaw.image_count||0) + (detailJsonRaw.block_count||0) + (detailJsonRaw.text_count||0) > 0));
  const detailJson = detailJsonHasData ? detailJsonRaw : null;
  const optionCount = optionJson.option_count || toInt(p.option_count || p.optionCount, 0);
  const taxType = pickTaxType(p) || cleanText(p.tax_type || p.taxType || '');
  const returnFee = pickReturnShippingFee(p, mallSalePrice);
  const remoteDelivery = normalizeRemoteDeliveryPolicy(p);

  const mallCategoryStored = /^\d+$/.test(cleanText(cpSelectedCode)) ? cleanText(cpSelectedCode) : '';
  try{ console.log('[GM_PRODUCT_CATEGORY_DECIDE]', { uid:id.uid, keyword:searchKeyword, mall_category_leaf:mallCategoryLeaf, mall_category_stored:mallCategoryStored, cp_selected_code:cpSelectedCode, cp_fix_code:cpFixCode, cp_match:cpMatch, category_tree_count:Array.isArray(categoryTreeForSave)?categoryTreeForSave.length:0, category_dynamic }); }catch(_l){}

  const productColumns = [
    'product_uid','glomart_code','gm_category','category_keyword','keyword','mall_code','source_mall','source_uid',
    'mall_category','mall_category_json','cp_selected_code','cp_fix_code','cp_match','product_id','item_id','vendor_item_id','pi_ii_vi','internal_product_code',
    'product_name','mall_product_name','option_count','option_json','thumb_json','detail_json','seasonal_text',
    'mall_sale_price','final_supply_price','normal_price','discount_price','delivery_fee','delivery_eta_text','delivery_type',
    'jeju_delivery_yn','jeju_extra_delivery_fee','island_delivery_yn','island_extra_delivery_fee','tax_type','overseas_direct_yn',
    'review_count','mall_sales_count','certification_no_1','certification_no_2',
    'supplier_id','supplier_name','business_number','online_sales_number','ceo_name','supplier_mobile','supplier_phone','supplier_email','supplier_address',
    'product_url','thumb_origin_url','soldout_yn','hit_count','sale_status','product_grade',
    'buyable_qty','min_order_qty','max_order_qty',
    'return_available_yn','exchange_available_yn','return_policy_text','exchange_policy_text','return_shipping_fee','exchange_shipping_fee','return_period_days','exchange_period_days',
    'last_seen_at','created_at','updated_at'
  ];
  // V022: productColumns와 placeholder 순서를 1:1로 고정한다.
  // soldout_yn=$54, hit_count=1, sale_status=$55 순서가 반드시 유지되어야 한다.
  const valuesSql = [
    '$1','$2','$3','$4','$5','$6','$7','$8',
    '$9','$10::jsonb','$11','$12','$13','$14','$15','$16',
    '$17','$18','$19','$20','$21','$22::jsonb','$23::jsonb','$24::jsonb',
    '$25','$26','$27','$28','$29','$30','$31','$32',
    '$33','$34','$35','$36','$37','$38','$39','$40',
    '$41','$42','$43','$44','$45','$46','$47','$48',
    '$49','$50','$51','$52','$53','$54','1','$55',
    '$56','$57','$58','$59','$60','$61','$62','$63',
    '$64','$65','$66','$67',
    'now()','now()','now()'
  ];
  const sql = `
    INSERT INTO gm_product (${productColumns.join(', ')}) VALUES (${valuesSql.join(', ')})
    ON CONFLICT (product_uid) DO UPDATE SET
      source_mall=COALESCE(NULLIF(EXCLUDED.source_mall,''), gm_product.source_mall),
      source_uid=EXCLUDED.source_uid,
      keyword=COALESCE(NULLIF(EXCLUDED.keyword,''), gm_product.keyword),
      mall_category=COALESCE(NULLIF(EXCLUDED.mall_category,''), gm_product.mall_category),
      mall_category_json=CASE WHEN EXCLUDED.mall_category_json <> '[]'::jsonb THEN EXCLUDED.mall_category_json ELSE gm_product.mall_category_json END,
      cp_selected_code=CASE
        WHEN NULLIF(EXCLUDED.cp_selected_code,'') IS NOT NULL THEN EXCLUDED.cp_selected_code
        ELSE gm_product.cp_selected_code END,
      cp_fix_code=CASE
        WHEN NULLIF(EXCLUDED.cp_fix_code,'') IS NULL THEN gm_product.cp_fix_code
        WHEN COALESCE(gm_product.cp_match,'')='T' AND COALESCE(gm_product.cp_fix_code,'')<>'' AND COALESCE(gm_product.cp_fix_code,'')<>EXCLUDED.cp_fix_code THEN gm_product.cp_fix_code
        ELSE EXCLUDED.cp_fix_code END,
      cp_match=CASE
        WHEN COALESCE(EXCLUDED.cp_match,'')='T' THEN 'T'
        WHEN COALESCE(gm_product.cp_match,'')='T' THEN 'T'
        WHEN NULLIF(EXCLUDED.cp_fix_code,'') IS NOT NULL THEN COALESCE(NULLIF(EXCLUDED.cp_match,''),'F')
        ELSE COALESCE(gm_product.cp_match,'F') END,
      product_name=EXCLUDED.product_name,
      mall_product_name=EXCLUDED.mall_product_name,
      option_count=CASE WHEN COALESCE(EXCLUDED.option_count,0) > 0 THEN EXCLUDED.option_count ELSE gm_product.option_count END,
      option_json=CASE WHEN COALESCE(EXCLUDED.option_count,0) >= 2 THEN EXCLUDED.option_json WHEN COALESCE(EXCLUDED.option_count,0)=1 THEN NULL ELSE gm_product.option_json END,
      thumb_json=CASE
        WHEN jsonb_typeof(EXCLUDED.thumb_json)='array'
         AND jsonb_array_length(EXCLUDED.thumb_json) > COALESCE(CASE WHEN jsonb_typeof(gm_product.thumb_json)='array' THEN jsonb_array_length(gm_product.thumb_json) ELSE 0 END,0)
        THEN EXCLUDED.thumb_json ELSE gm_product.thumb_json END,
      detail_json=CASE
        WHEN jsonb_typeof(EXCLUDED.detail_json)='object'
         AND (
          COALESCE(NULLIF(EXCLUDED.detail_json->>'block_count','')::int,0)
        + COALESCE(NULLIF(EXCLUDED.detail_json->>'image_count','')::int,0)
        + COALESCE(NULLIF(EXCLUDED.detail_json->>'text_count','')::int,0)
        + CASE WHEN jsonb_typeof(EXCLUDED.detail_json->'blocks')='array' THEN jsonb_array_length(EXCLUDED.detail_json->'blocks') ELSE 0 END
        + CASE WHEN jsonb_typeof(EXCLUDED.detail_json->'images')='array' THEN jsonb_array_length(EXCLUDED.detail_json->'images') ELSE 0 END
        + CASE WHEN jsonb_typeof(EXCLUDED.detail_json->'texts')='array' THEN jsonb_array_length(EXCLUDED.detail_json->'texts') ELSE 0 END
        ) > 0
        THEN EXCLUDED.detail_json
        WHEN EXCLUDED.detail_json IS NULL THEN gm_product.detail_json
        ELSE gm_product.detail_json END,
      seasonal_text=COALESCE(NULLIF(EXCLUDED.seasonal_text,''), gm_product.seasonal_text),
      mall_sale_price=EXCLUDED.mall_sale_price,
      final_supply_price=COALESCE(EXCLUDED.final_supply_price, gm_product.final_supply_price),
      normal_price=COALESCE(EXCLUDED.normal_price, gm_product.normal_price),
      discount_price=EXCLUDED.discount_price,
      delivery_fee=EXCLUDED.delivery_fee,
      delivery_eta_text=EXCLUDED.delivery_eta_text,
      delivery_type=EXCLUDED.delivery_type,
      jeju_delivery_yn=CASE WHEN $68::boolean THEN EXCLUDED.jeju_delivery_yn ELSE gm_product.jeju_delivery_yn END,
      jeju_extra_delivery_fee=CASE WHEN $68::boolean THEN EXCLUDED.jeju_extra_delivery_fee ELSE gm_product.jeju_extra_delivery_fee END,
      island_delivery_yn=CASE WHEN $69::boolean THEN EXCLUDED.island_delivery_yn ELSE gm_product.island_delivery_yn END,
      island_extra_delivery_fee=CASE WHEN $69::boolean THEN EXCLUDED.island_extra_delivery_fee ELSE gm_product.island_extra_delivery_fee END,
      tax_type=COALESCE(NULLIF(EXCLUDED.tax_type,''), gm_product.tax_type),
      review_count=EXCLUDED.review_count,
      mall_sales_count=EXCLUDED.mall_sales_count,
      certification_no_1=COALESCE(NULLIF(EXCLUDED.certification_no_1,''), gm_product.certification_no_1),
      certification_no_2=COALESCE(NULLIF(EXCLUDED.certification_no_2,''), gm_product.certification_no_2),
      supplier_id=COALESCE(NULLIF(EXCLUDED.supplier_id,''), gm_product.supplier_id),
      supplier_name=COALESCE(NULLIF(EXCLUDED.supplier_name,''), gm_product.supplier_name),
      business_number=COALESCE(NULLIF(EXCLUDED.business_number,''), gm_product.business_number),
      online_sales_number=COALESCE(NULLIF(EXCLUDED.online_sales_number,''), gm_product.online_sales_number),
      ceo_name=COALESCE(NULLIF(EXCLUDED.ceo_name,''), gm_product.ceo_name),
      supplier_mobile=COALESCE(NULLIF(EXCLUDED.supplier_mobile,''), gm_product.supplier_mobile),
      supplier_phone=COALESCE(NULLIF(EXCLUDED.supplier_phone,''), gm_product.supplier_phone),
      supplier_email=COALESCE(NULLIF(EXCLUDED.supplier_email,''), gm_product.supplier_email),
      supplier_address=COALESCE(NULLIF(EXCLUDED.supplier_address,''), gm_product.supplier_address),
      -- product_url 저장 중단: 필요 시 위 insert 값과 함께 부활
      product_url=gm_product.product_url,
      thumb_origin_url=COALESCE(NULLIF(EXCLUDED.thumb_origin_url,''), gm_product.thumb_origin_url),
      soldout_yn=EXCLUDED.soldout_yn,
      sale_status=EXCLUDED.sale_status,
      product_grade=EXCLUDED.product_grade,
      buyable_qty=COALESCE(EXCLUDED.buyable_qty, gm_product.buyable_qty),
      min_order_qty=COALESCE(EXCLUDED.min_order_qty, gm_product.min_order_qty),
      max_order_qty=COALESCE(EXCLUDED.max_order_qty, gm_product.max_order_qty),
      return_available_yn=EXCLUDED.return_available_yn,
      exchange_available_yn=EXCLUDED.exchange_available_yn,
      return_policy_text=EXCLUDED.return_policy_text,
      exchange_policy_text=EXCLUDED.exchange_policy_text,
      return_shipping_fee=EXCLUDED.return_shipping_fee,
      exchange_shipping_fee=EXCLUDED.exchange_shipping_fee,
      return_period_days=EXCLUDED.return_period_days,
      exchange_period_days=EXCLUDED.exchange_period_days,
      hit_count=COALESCE(gm_product.hit_count,0)+1,
      last_seen_at=now(),
      updated_at=now()
    RETURNING product_uid, pi_ii_vi, mall_code, cp_selected_code, cp_fix_code, cp_match, hit_count, option_count, (xmax = 0) AS inserted
  `;

  const productOptionLinkJson = optionCount >= 2 ? makeProductOptionLinkJson(optionJson, id) : null;
  const standardCoupangSupplier = isStandardCoupangSupplier(p, id);
  const vals = [
    id.uid, cleanText(p.glomart_code || p.glomartCode), cleanText(p.gm_category || p.gmCategory),
    cleanText(p.category_keyword || p.categoryKeyword || p.keyword), searchKeyword,
    id.mallCode, sourceMallStored, sourceUid, mallCategoryStored, safeJsonString(mallCategoryJson), cpSelectedCode, cpFixCode, cpMatch,
    id.productId, id.itemId, id.vendorItemId, '', cleanText(p.internal_product_code || p.internalProductCode),
    productName, cleanDupMallProductName(productName, p.mall_product_name || p.mallProductName || ''), optionCount,
    productOptionLinkJson ? safeJsonString(productOptionLinkJson) : null, safeJsonString(thumbJson), detailJson ? safeJsonString(detailJson) : null, cleanText(p.seasonal_text || p.seasonalText || p.seasonal || ''),
    mallSalePrice, finalSupplyPrice, normalPrice, pickDiscountPrice(p),
    pickDeliveryFee(p), pickDeliveryText(p), pickDeliveryType(p),
    remoteDelivery.jeju_delivery_yn, remoteDelivery.jeju_extra_delivery_fee,
    remoteDelivery.island_delivery_yn, remoteDelivery.island_extra_delivery_fee,
    taxType, cleanText(p.overseas_direct_yn || p.overseasDirectYn || 'N'), pickReviewCount(p), pickMallSalesCount(p),
    cleanText(p.certification_no_1 || p.certificationNo1 || ''), cleanText(p.certification_no_2 || p.certificationNo2 || ''),
    standardCoupangSupplier ? '' : pickSupplierId(p), standardCoupangSupplier ? '' : pickSupplierName(p),
    standardCoupangSupplier ? '' : pickAny(p,['business_number','businessNumber','seller_business_number','sellerBusinessNumber','supplierBizNo']),
    standardCoupangSupplier ? '' : pickAny(p,['online_sales_number','onlineSalesNumber','mail_order_number','mailOrderNumber','supplierMailOrderNo']),
    standardCoupangSupplier ? '' : pickAny(p,['ceo_name','ceoName','representative_name','representativeName','supplierRepresentative']),
    standardCoupangSupplier ? '' : pickAny(p,['supplier_mobile','supplierMobile','seller_mobile','sellerMobile','phone','sellerPhone','supplierPhone']),
    standardCoupangSupplier ? '' : pickAny(p,['supplier_phone','supplierPhone','seller_phone','sellerPhone','tel','telephone','landline','sellerTel','supplierTel']),
    standardCoupangSupplier ? '' : pickAny(p,['supplier_email','supplierEmail','seller_email','sellerEmail']),
    standardCoupangSupplier ? '' : pickAny(p,['supplier_address','supplierAddress','seller_address','sellerAddress']),
    productUrl, thumbUrl,
    cleanText(p.soldout_yn || p.soldoutYn || p.soldout || 'N'), cleanText(p.sale_status || p.saleStatus || 'active'), pickRatingScore(p),
    pickBuyableQty(p), pickMinOrderQty(p), pickMaxOrderQty(p),
    cleanText(p.return_available_yn || p.returnAvailableYn || 'Y'), cleanText(p.exchange_available_yn || p.exchangeAvailableYn || 'Y'),
    cleanText(p.return_policy_text || p.returnPolicyText || p.return_policy || p.returnPolicy || ''),
    cleanText(p.exchange_policy_text || p.exchangePolicyText || p.exchange_policy || p.exchangePolicy || ''),
    returnFee, toInt(p.exchange_shipping_fee || p.exchangeShippingFee, 0),
    p.return_period_days == null && p.returnPeriodDays == null ? null : toInt(p.return_period_days || p.returnPeriodDays, 0),
    p.exchange_period_days == null && p.exchangePeriodDays == null ? null : toInt(p.exchange_period_days || p.exchangePeriodDays, 0),
    remoteDelivery.jeju_provided,
    remoteDelivery.island_provided
  ];

  try{ console.log('[GM_PRODUCT_UPSERT_TRACE_IN]', { uid:id.uid, mall_code:id.mallCode, product_id:id.productId, item_id:id.itemId, vendor_item_id:id.vendorItemId, product_url_saved:false, option_iid_vid:(productOptionLinkJson||{}).iid_vid||'', detail_image_count:detailJsonRaw.image_count||0, detail_block_count:detailJsonRaw.block_count||0, detail_text_count:detailJsonRaw.text_count||0, cp_selected_code:cpSelectedCode, cp_fix_code:cpFixCode, cp_match:cpMatch }); }catch(_trace){}
  let r;
  try{
    r = await pool.query(sql, vals);
  }catch(e){
    console.error('[GM_PRODUCT_UPSERT_SQL_ERROR]', Object.assign({ uid:id.uid, mall_code:id.mallCode, pi:id.pi, product_name:productName, vals_len:vals.length, columns:productColumns.length }, compactError(e)));
    throw e;
  }
  try{ console.log('[GM_PRODUCT_UPSERT_TRACE_OUT]', { uid:id.uid, row:(r.rows&&r.rows[0])||null }); }catch(_trace){}
  try{ console.log('[GM_PRODUCT_REMOTE_DELIVERY_SAVE]', {
    product_uid:id.uid,
    jeju_delivery_yn:remoteDelivery.jeju_delivery_yn,
    jeju_extra_delivery_fee:remoteDelivery.jeju_extra_delivery_fee,
    island_delivery_yn:remoteDelivery.island_delivery_yn,
    island_extra_delivery_fee:remoteDelivery.island_extra_delivery_fee,
    return_shipping_fee:returnFee
  }); }catch(_trace){}
  let cp_learning = null;
  try{
    cp_learning = await applyCpFixLearning(pool, { mall_code:id.mallCode, keyword:searchKeyword, cp_selected_code:cpSelectedCode, cp_fix_code:cpFixCode, cp_match:cpMatch, product_uid:id.uid });
    try{ console.log('[GM_CP_FIX_LEARNING_RESULT]', { uid:id.uid, mall_code:id.mallCode, keyword:searchKeyword, cp_selected_code:cpSelectedCode, cp_fix_code:cpFixCode, cp_match:cpMatch, result:cp_learning }); }catch(_log){}
    if(cpFixCode && searchKeyword){
      try{ await updateSearchLogCategoryByKeyword(pool, { keyword:searchKeyword, cp_selected_code:cpSelectedCode, cp_fix_code:cpFixCode }); }
      catch(_sl){ try{ console.warn('[GM_SEARCH_LOG_CATEGORY_UPDATE_FAIL]', Object.assign({ keyword:searchKeyword, cp_fix_code:cpFixCode }, compactError(_sl))); }catch(_l){} }
    }
  }catch(e){ cp_learning={ applied:false, error:compactError(e) }; }
  let option_result = { received:0, inserted:0, updated:0, skipped:0, nonactive:0, balance_ok:true, samples:[], errors:[] };
  try{
    option_result = await upsertProductOptions(pool, id, optionJson, p, parent);
    try{ console.log('[GM_PRODUCT_OPTION_UPSERT_RESULT]', { uid:id.uid, mall_code:id.mallCode, product_id:id.productId, option_count:optionJson && optionJson.option_count, result:option_result }); }catch(_log){}
  }catch(e){
    option_result = { received:optionCount, inserted:0, updated:0, skipped:optionCount, nonactive:0, balance_ok:false, error:compactError(e) };
    console.error('[GM_PRODUCT_OPTION_UPSERT_ERROR]', Object.assign({ uid:id.uid, mall_code:id.mallCode, product_id:id.productId, option_count:optionCount }, compactError(e)));
  }

  let detail_patch = null;
  try{
    detail_patch = await applyDetailPatch(pool, id, p, optionJson, thumbJson, detailJson || {}, returnFee);
  }catch(e){
    detail_patch = { applied:false, error:compactError(e) };
    console.error('[GM_PRODUCT_DETAIL_PATCH_ERROR]', Object.assign({ uid:id.uid, mall_code:id.mallCode }, compactError(e)));
  }
  const detail_stats = detailSignalStats(optionJson, thumbJson, detailJson || {}, p);
  return {
    ok:true,
    action:(r.rows[0] && r.rows[0].inserted) ? 'inserted' : 'updated',
    item:Object.assign({}, r.rows[0] || {}, { cp_match:cpMatch, category_dynamic, cp_learning, option_count:optionCount, option_result, detail_patch, detail_stats })
  };
}





// Search log and keyword-relation routes are owned by server.js/routes/search_keyword.js.
router.post('/api/gm/product/queue', async (req,res)=>{
  const pool=db(req), p=parseIncomingPayloadBody(req.body||{});
  if(!pool) return fail(res, 500, 'DB pool is not attached');
  const items = normalizeQueueItems(p);
  if(!items.length){
    console.warn('[GM_PRODUCT_QUEUE] rejected: items required', { keys:Object.keys(p || {}) });
    return fail(res, 400, 'items required');
  }
  const maxItems = Number(process.env.GM_PRODUCT_QUEUE_MAX_ITEMS || 300);
  if(items.length > maxItems) return fail(res, 413, 'too many items', { received:items.length, max:maxItems });
  const requestId = makeRequestId(p, items);
  const mallCode = cleanText(p.mall_code || p.mallCode || p.source || (items[0] && (items[0].mall_code || items[0].mallCode)) || '').toUpperCase();
  const keyword = cleanText(p.keyword || p.q || p.search_keyword || p.searchKeyword || '');
  try{
    console.log('[GM_PRODUCT_QUEUE] insert request', { item_count:items.length, mall_code:mallCode, keyword, request_id:requestId, search_run_id:cleanText(p.search_run_id||p.searchRunId||''), chunk_index:toInt(p.chunk_index||p.chunkIndex,0), chunk_total:toInt(p.chunk_total||p.chunkTotal,0) });
    const r = await pool.query(`
      INSERT INTO gm_product_upsert_queue (
        request_id, mall_code, keyword, items_json, item_count, status, retry_count, created_at
      ) VALUES ($1,$2,$3,$4::jsonb,$5,'pending',0,now())
      ON CONFLICT (request_id) DO UPDATE SET
        mall_code=EXCLUDED.mall_code,
        keyword=EXCLUDED.keyword,
        items_json=EXCLUDED.items_json,
        item_count=EXCLUDED.item_count,
        status=CASE WHEN gm_product_upsert_queue.status IN ('done','processing') THEN gm_product_upsert_queue.status ELSE 'pending' END,
        error_message=NULL
      RETURNING queue_id, request_id, status, item_count
    `, [requestId, mallCode, keyword, JSON.stringify(items), items.length]);
    console.log('[GM_PRODUCT_QUEUE] inserted', {
      queue_id:r.rows[0] && r.rows[0].queue_id,
      request_id:r.rows[0] && r.rows[0].request_id,
      status:r.rows[0] && r.rows[0].status,
      item_count:r.rows[0] && r.rows[0].item_count,
      chunk_index:toInt(p.chunk_index||p.chunkIndex,0),
      chunk_total:toInt(p.chunk_total||p.chunkTotal,0)
    });

    // GM_QUEUE_INLINE_UPSERT_V016
    // Cloudtype에서 queue row는 정상 생성되는데 worker가 실행되지 않거나
    // 스키마 변경 후 worker가 조용히 실패하면 gm_product가 계속 비는 문제가 있었다.
    // 검색 chunk는 보통 10개 단위이므로 queue 수신 즉시 같은 프로세스에서 upsert까지 수행한다.
    // 기존 queue 테이블은 진단/재처리용으로 유지한다.
    const uidSeen = new Set();
    const duplicateUidSamples = [];
    const inlineResults = [];
    for(const item of items){
      try{
        const probe = normalizeProductPayload(item, p);
        if(probe && probe.id && probe.id.uid){
          if(uidSeen.has(probe.id.uid)) duplicateUidSamples.push(probe.id.uid);
          else uidSeen.add(probe.id.uid);
        }
      }catch(_dupProbe){}
      try{
        inlineResults.push(await upsertProduct(pool, item, p));
      }catch(e){
        inlineResults.push({ ok:false, error:String(e && e.message || e), error_detail:compactError(e), uid:cleanText(item && (item.product_uid || item.productUid || item.pi_ii_vi || item.piIiVi || '')), title_sample:cleanText(item && (item.title || item.name || item.productName || item.product_name || '')).slice(0,120) });
      }
    }
    const inlineSaved = inlineResults.filter(x=>x && x.ok).length;
    const inlineSkipped = inlineResults.length - inlineSaved;
    const inlineInserted = inlineResults.filter(x=>x && x.ok && x.action === 'inserted').length;
    const inlineUpdated = inlineResults.filter(x=>x && x.ok && x.action !== 'inserted').length;
    const optionAudit = inlineResults.reduce((a,x)=>{
      const o = x && x.item && x.item.option_result || {};
      a.received += Number(o.received || 0);
      a.inserted += Number(o.inserted || 0);
      a.updated += Number(o.updated || 0);
      a.skipped += Number(o.skipped || 0);
      a.nonactive += Number(o.nonactive || 0);
      if(o.balance_ok === false) a.balance_ok = false;
      return a;
    }, { received:0, inserted:0, updated:0, skipped:0, nonactive:0, balance_ok:true });
    optionAudit.balance_ok = optionAudit.balance_ok && optionAudit.received === (optionAudit.inserted + optionAudit.updated + optionAudit.skipped);
    const saveAudit = {
      search_result_count:items.length,
      product_inserted:inlineInserted,
      product_updated:inlineUpdated,
      product_skipped:inlineSkipped,
      product_balance_ok:items.length === (inlineInserted + inlineUpdated + inlineSkipped),
      option_received:optionAudit.received,
      option_inserted:optionAudit.inserted,
      option_updated:optionAudit.updated,
      option_skipped:optionAudit.skipped,
      option_nonactive:optionAudit.nonactive,
      option_balance_ok:optionAudit.balance_ok
    };
    const inlineStatus = inlineSaved > 0 ? 'done' : 'failed';
    const inlineError = inlineSaved > 0 ? null : (inlineResults.find(x=>x && (x.error || x.reason)) || {}).error || (inlineResults.find(x=>x && x.reason) || {}).reason || 'inline upsert saved 0 rows';
    try{
      await pool.query(`
        UPDATE gm_product_upsert_queue
        SET status=$2,
            processed_at=now(),
            error_message=$3,
            result_json=$4::jsonb
        WHERE queue_id=$1
      `, [r.rows[0] && r.rows[0].queue_id, inlineStatus, inlineError, JSON.stringify({ saved:inlineSaved, skipped:inlineSkipped, audit:saveAudit, option_audit:optionAudit, sample:inlineResults.slice(0,10), errors:inlineResults.filter(x=>x && !x.ok).slice(0,30) })]);
    }catch(_qe){
      console.warn('[GM_PRODUCT_QUEUE] inline result update failed', String(_qe && _qe.message || _qe));
    }
    console.log('[GM_PRODUCT_QUEUE_SAVE_AUDIT]', Object.assign({ queue_id:r.rows[0] && r.rows[0].queue_id, request_id:r.rows[0] && r.rows[0].request_id, mall_code:mallCode, keyword }, saveAudit));
    console.log('[GM_PRODUCT_QUEUE] inline upsert done', { saved:inlineSaved, skipped:inlineSkipped, status:inlineStatus, queue_id:r.rows[0] && r.rows[0].queue_id, audit:saveAudit, sample:inlineResults.slice(0,3) });

    ok(res,{
      action:'product.queue',
      queued:true,
      queue:r.rows[0],
      queue_id:r.rows[0] && r.rows[0].queue_id,
      request_id:r.rows[0] && r.rows[0].request_id,
      item_count:r.rows[0] && r.rows[0].item_count,
      received:items.length,
      saved:inlineSaved,
      skipped:inlineSkipped,
      inline_upsert:true,
      inline_status:inlineStatus,
      audit:saveAudit,
      option_audit:optionAudit,
      inline_sample:inlineResults.slice(0,10),
      inline_errors:inlineResults.filter(x=>x && !x.ok).slice(0,30),
      unique_uid_count:uidSeen.size,
      duplicate_uid_count:duplicateUidSamples.length,
      duplicate_uid_sample:duplicateUidSamples.slice(0,30),
      chunk_index:toInt(p.chunk_index||p.chunkIndex,0),
      chunk_total:toInt(p.chunk_total||p.chunkTotal,0)
    });
  }catch(e){
    console.error('[GM_PRODUCT_QUEUE] insert failed', String(e && e.message || e));
    fail(res,500,'product queue failed',{detail:String(e && e.message || e)});
  }
});

router.get('/api/gm/product/queue/status', async (req,res)=>{
  const pool=db(req);
  if(!pool) return fail(res, 500, 'DB pool is not attached');
  try{
    const r = await pool.query(`
      SELECT status, COUNT(*)::int AS count
      FROM gm_product_upsert_queue
      GROUP BY status
      ORDER BY status
    `);
    ok(res,{ action:'product.queue.status', rows:r.rows });
  }catch(e){ fail(res,500,'product queue status failed',{detail:String(e && e.message || e)}); }
});

router.get('/api/gm/product/queue/recent', async (req,res)=>{
  const pool=db(req);
  if(!pool) return fail(res, 500, 'DB pool is not attached');
  try{
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '20', 10) || 20));
    const r = await pool.query(`
      SELECT queue_id, request_id, mall_code, keyword, item_count, status, retry_count, error_message, result_json, created_at, locked_at, processed_at
      FROM gm_product_upsert_queue
      ORDER BY created_at DESC
      LIMIT $1
    `, [limit]);
    ok(res,{ action:'product.queue.recent', rows:r.rows });
  }catch(e){ fail(res,500,'product queue recent failed',{detail:String(e && e.message || e)}); }
});

router.post(['/api/gm/product/upsert','/api/product/upsert'], async (req,res)=>{
  const pool=db(req), p=parseIncomingPayloadBody(req.body||{});
  if(!pool) return fail(res, 500, 'DB pool is not attached');
  try{
    const id0 = ids(p);
    const oj0 = parseMaybeJsonObject(p.option_json || p.optionJson);
    console.log('[GM_PRODUCT_UPSERT_ROUTE_IN]', {
      mall_code: cleanText(p.mall_code || p.mallCode || id0.mallCode),
      product_id: cleanText(p.product_id || p.productId || id0.productId),
      pi_ii_vi: cleanText(p.pi_ii_vi || p.piIiVi || id0.pi),
      optionRows: Array.isArray(p.optionRows) ? p.optionRows.length : 0,
      optionCombos: Array.isArray(p.optionCombos) ? p.optionCombos.length : 0,
      aliOptionCombos: Array.isArray(p.aliOptionCombos) ? p.aliOptionCombos.length : 0,
      option_json_rows: oj0 && Array.isArray(oj0.rows) ? oj0.rows.length : 0,
      deep_option_arrays: collectPayloadContainers(p,4).reduce((n,o)=>n + (Array.isArray(o.optionRows)?o.optionRows.length:0) + (Array.isArray(o.optionCombos)?o.optionCombos.length:0) + (Array.isArray(o.aliOptionCombos)?o.aliOptionCombos.length:0),0),
      has_detail_json: !!(p.detail_json || p.detailJson),
      category_alias_counts: {
        categoryTree: Array.isArray(p.categoryTree) ? p.categoryTree.length : 0,
        category_tree: Array.isArray(p.category_tree) ? p.category_tree.length : 0,
        categoryTreeJson: Array.isArray(p.categoryTreeJson) ? p.categoryTreeJson.length : (cleanText(p.categoryTreeJson) ? 'text' : 0),
        cpCategoryTree: Array.isArray(p.cpCategoryTree) ? p.cpCategoryTree.length : 0,
        mall_category_json: Array.isArray(p.mall_category_json) ? p.mall_category_json.length : (cleanText(p.mall_category_json) ? 'text' : 0),
        categoryInfo: p.categoryInfo && typeof p.categoryInfo === 'object' ? Object.keys(p.categoryInfo).length : 0
      },
      keys: Object.keys(p).slice(0,60)
    });
  }catch(_log){}
  const items = Array.isArray(p.items) ? p.items : (Array.isArray(p.products) ? p.products : (p.payload && Array.isArray(p.payload.items) ? p.payload.items : (p.payload && Array.isArray(p.payload.products) ? p.payload.products : null)));
  try{
    if(items){
      const results=[];
      for(const item of items){
        try{ results.push(await upsertProduct(pool, item, p)); }
        catch(e){ results.push({ ok:false, error:String(e && e.message || e), error_detail:compactError(e) }); }
      }
      const saved = results.filter(x=>x && x.ok).length;
      const skipped = results.length - saved;
      const inserted = results.filter(x=>x && x.ok && x.action === 'inserted').length;
      const updated = results.filter(x=>x && x.ok && x.action !== 'inserted').length;
      const optionAudit = results.reduce((a,x)=>{ const o=x&&x.item&&x.item.option_result||{}; a.received+=Number(o.received||0); a.inserted+=Number(o.inserted||0); a.updated+=Number(o.updated||0); a.skipped+=Number(o.skipped||0); a.nonactive+=Number(o.nonactive||0); if(o.balance_ok===false)a.balance_ok=false; return a; }, {received:0,inserted:0,updated:0,skipped:0,nonactive:0,balance_ok:true});
      optionAudit.balance_ok = optionAudit.balance_ok && optionAudit.received === (optionAudit.inserted + optionAudit.updated + optionAudit.skipped);
      const audit = { search_result_count:items.length, product_inserted:inserted, product_updated:updated, product_skipped:skipped, product_balance_ok:items.length === (inserted+updated+skipped), option_received:optionAudit.received, option_inserted:optionAudit.inserted, option_updated:optionAudit.updated, option_skipped:optionAudit.skipped, option_nonactive:optionAudit.nonactive, option_balance_ok:optionAudit.balance_ok };
      console.log('[GM_PRODUCT_UPSERT_BATCH_AUDIT]', audit);
      return ok(res,{ mode:'batch', received:items.length, saved, skipped, audit, option_audit:optionAudit, results:results.slice(0,20), errors:results.filter(x=>x && !x.ok).slice(0,30) });
    }
    const result = await upsertProduct(pool, p, p);
    try{ console.log('[GM_PRODUCT_UPSERT_SINGLE_RESULT]', { ok:result && result.ok, action:result && result.action, uid:result && result.item && result.item.product_uid, category_dynamic:result && result.item && result.item.category_dynamic, option_count:result && result.item && result.item.option_count, option_result:result && result.item && result.item.option_result, mode:'single' }); }catch(_log){}
    if(!result.ok) return fail(res, 400, result.reason || 'product upsert validation failed', result);
    return ok(res,{ mode:'single', item:result.item, option_result:result.item && result.item.option_result, detail_patch:result.item && result.item.detail_patch, detail_stats:result.item && result.item.detail_stats });
  }catch(e){ console.error('[GM_PRODUCT_UPSERT_ROUTE_ERROR]', compactError(e)); fail(res,500,'product upsert failed',{detail:String(e && e.message || e), error_detail:compactError(e)}); }
});

router.post('/api/gm/product/event', async (req,res)=>{
  const pool=db(req), p=req.body||{};
  if(!pool) return fail(res, 500, 'DB pool is not attached');
  const id = ids(p);
  const type = cleanText(p.type || p.event_type || p.eventType).toLowerCase();
  const qty = Math.max(1, toInt(p.quantity || p.qty, 1));
  if(!id.uid && (!id.mallCode || !id.pi)) return fail(res, 400, 'product_uid or mall_code+pi_ii_vi required');
  const where = id.uid ? 'product_uid=$1' : 'mall_code=$1 AND pi_ii_vi=$2';
  const vals = id.uid ? [id.uid] : [id.mallCode, id.pi];
  let setSql = '';
  if(type === 'detail' || type === 'view') setSql = "detail_view_count=COALESCE(detail_view_count,0)+1";
  else if(type === 'cart') setSql = "cart_count=COALESCE(cart_count,0)+1, last_cart_at=now()";
  else if(type === 'wish') setSql = "wish_count=COALESCE(wish_count,0)+1, last_wish_at=now()";
  else if(type === 'order') setSql = "order_count=COALESCE(order_count,0)+1, order_qty_total=COALESCE(order_qty_total,0)+" + qty + ", last_order_at=now()";
  else if(type === 'return') setSql = "return_count=COALESCE(return_count,0)+1, last_return_at=now()";
  else if(type === 'exchange') setSql = "exchange_count=COALESCE(exchange_count,0)+1, last_exchange_at=now()";
  else if(type === 'ad_view') setSql = "ad_view_count=COALESCE(ad_view_count,0)+1, last_ad_view_at=now()";
  else if(type === 'ad_sale') setSql = "ad_order_count=COALESCE(ad_order_count,0)+1, ad_sales_qty=COALESCE(ad_sales_qty,0)+" + qty + ", last_ad_order_at=now()";
  else return fail(res, 400, 'event type must be detail/view/cart/wish/order/return/exchange/ad_view/ad_sale');
  try{
    const r=await pool.query(`UPDATE gm_product SET ${setSql}, updated_at=now() WHERE ${where} RETURNING product_uid, mall_code, product_id, pi_ii_vi`, vals);
    let option_updated = 0;
    if(type === 'order'){
      const mall = cleanText(id.mallCode || (r.rows[0] && r.rows[0].mall_code) || '').toUpperCase();
      const pi = cleanText(id.pi || (r.rows[0] && r.rows[0].pi_ii_vi) || '');
      if(mall && pi){
        try{
          const or = await pool.query(`
            UPDATE gm_product_option
            SET sales_qty=COALESCE(sales_qty,0)+$3, updated_at=now()
            WHERE mall_code=$1 AND pi_ii_vi=$2
          `, [mall, pi, qty]);
          option_updated = or.rowCount || 0;
        }catch(oe){ console.warn('[GM_PRODUCT_OPTION_EVENT_ORDER_WARN]', Object.assign({ mall_code:mall, pi_ii_vi:pi, qty }, compactError(oe))); }
      }
    }
    ok(res,{action:'product.event', type, updated:r.rowCount, option_updated, item:r.rows[0] || null});
  }catch(e){ fail(res,500,'product event failed',{detail:String(e && e.message || e)}); }
});

router.upsertProduct = upsertProduct;
module.exports=router;
