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
    'productName','product_name','mallProductName','mall_product_name',
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

function normalizeUrl(url){ url = cleanText(url); if(url.startsWith('//')) return 'https:' + url; return url; }
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

const KEYWORD_LANGS = ['ko','en','zh','vi','ja','tw','th','uz','ne','km','id','tl','mn','my','kk','si','ru','bn','ur','lo','hi','tr','fa','es','fr'];
function uniqClean(arr){
  const seen = new Set();
  return (Array.isArray(arr) ? arr : (typeof arr === 'string' ? arr.split(/[|,\n\t]+/g) : []))
    .map(cleanText).filter(Boolean).filter(v => { const k=v.toLowerCase(); if(seen.has(k)) return false; seen.add(k); return true; });
}
function pickKeywordMeta(p){
  p = p || {};
  const meta = p.searchKeywordMeta || p.keywordMeta || p.keyword_meta || p.search_keyword_meta || {};
  const inputKeyword = cleanText(meta.inputKeyword || meta.input_keyword || p.inputKeyword || p.input_keyword || p.keyword || p.q || '');
  const correctedKeyword = cleanText(meta.correctedKeyword || meta.corrected_keyword || p.correctedKeyword || p.corrected_keyword || '');
  const mainKeyword = cleanText(meta.mainKeyword || meta.mainSearchKeyword || meta.main_search_keyword || meta.normalizedKeyword || meta.normalized_keyword || p.mainKeyword || p.mainSearchKeyword || p.normalized || p.normalizedKeyword || correctedKeyword || inputKeyword);
  const originalKeyword = cleanText(meta.originalKeyword || meta.original_keyword || p.originalKeyword || p.original_keyword || inputKeyword);
  const relatedKeywords = uniqClean(meta.relatedKeywords || meta.related_keywords || p.relatedKeywords || p.related_keywords || p.suggestKeywords || p.suggest_keywords);
  const categoryMainKeywordKo = cleanText(meta.categoryMainKeywordKo || meta.category_main_keyword_ko || p.categoryMainKeywordKo || p.category_main_keyword_ko || '');
  return { inputKeyword, correctedKeyword, originalKeyword, mainKeyword, relatedKeywords, categoryMainKeywordKo, raw:meta };
}
function pickTranslationValue(src, lang, baseKey){
  src = src || {};
  baseKey = baseKey || '';
  return cleanText(
    src[lang] || src[baseKey + '_' + lang] || src[baseKey + lang.toUpperCase()] ||
    (src[baseKey] && src[baseKey][lang]) || ''
  );
}
function pickKeywordTranslations(p, meta){
  p = p || {}; meta = meta || {};
  const root = p.keywordTranslations || p.keyword_translations || p.translations || p.translation ||
    (p.mainKeywordTranslations ? { mainKeywordTranslations:p.mainKeywordTranslations } : null) ||
    meta.keywordTranslations || meta.keyword_translations || meta.translations || {};
  const main = root.mainKeywordTranslations || root.main_keyword_translations || root.mainKeyword || root.main_keyword || root.keyword || root;
  const out = {};
  KEYWORD_LANGS.forEach(lang => {
    const v = lang === 'ko' ? (meta.mainKeyword || '') : pickTranslationValue(main, lang, 'keyword');
    if(v) out[lang] = v;
  });
  return out;
}
function pickRelatedTranslations(p, meta){
  p = p || {}; meta = meta || {};
  const root = p.relatedKeywordTranslations || p.related_keyword_translations ||
    p.relatedKeywordRows || p.related_keyword_rows ||
    (p.keywordTranslations && (p.keywordTranslations.relatedKeywordTranslations || p.keywordTranslations.relatedKeywordRows || p.keywordTranslations.related_keywords)) ||
    (meta.relatedKeywordTranslations || meta.related_keyword_translations || meta.relatedKeywordRows || meta.related_keyword_rows) || {};
  if(Array.isArray(root)){
    const out = {};
    root.forEach(row => {
      const ko = cleanText(row && (row.relatedKeywordKo || row.related_keyword_ko || row.ko || row.keyword));
      const tr = row && (row.translations || row.relatedKeywordTranslations || row.related_keyword_translations || row);
      if(ko) out[ko] = tr || {};
    });
    return out;
  }
  return root && typeof root === 'object' ? root : {};
}
function relatedTransFor(relatedTranslations, relatedKo){
  relatedTranslations = relatedTranslations || {};
  relatedKo = cleanText(relatedKo);
  const norm = normalizeKeywordValue(relatedKo);
  let direct = relatedTranslations[relatedKo] || relatedTranslations[norm] || {};
  if(!direct && Array.isArray(relatedTranslations)){
    direct = relatedTranslations.find(x => normalizeKeywordValue(x.related_keyword_ko || x.relatedKeywordKo || x.ko || x.keyword || '') === norm) || {};
  }
  if(direct && typeof direct === 'object'){
    // {ko:'숟가락', en:'spoon'} 또는 {relatedKeywordTranslations:{...}} 모두 허용
    direct = direct.translations || direct.relatedKeywordTranslations || direct.related_keyword_translations || direct;
  }
  return direct && typeof direct === 'object' ? direct : {};
}
function enrichTranslationKo(t, ko){
  t = Object.assign({}, t || {});
  if(!cleanText(t.ko)) t.ko = cleanText(ko);
  return t;
}

async function ensureKeywordTranslateTable(pool){
  await pool.query(`CREATE TABLE IF NOT EXISTS gm_keyword_translate (
    lang TEXT NOT NULL,
    input_keyword TEXT NOT NULL,
    main_keyword_ko TEXT NOT NULL,
    hit_count INTEGER NOT NULL DEFAULT 1,
    updated_at DATE NOT NULL DEFAULT CURRENT_DATE,
    PRIMARY KEY (lang, input_keyword)
  )`);
}
function pickLang(p){
  return cleanText(p.lang || p.gm_lang || p.ui_lang_code || p.lang_code || p.country_lang || (p.searchKeywordMeta && (p.searchKeywordMeta.lang || p.searchKeywordMeta.gm_lang)) || 'ko').toLowerCase() || 'ko';
}
async function upsertKeywordTranslate(pool, lang, inputKeyword, mainKeywordKo, inc=1){
  lang = cleanText(lang).toLowerCase(); inputKeyword = cleanText(inputKeyword); mainKeywordKo = cleanText(mainKeywordKo);
  if(!lang || !inputKeyword || !mainKeywordKo) return false;
  await pool.query(`INSERT INTO gm_keyword_translate (lang,input_keyword,main_keyword_ko,hit_count,updated_at)
    VALUES ($1,$2,$3,$4,CURRENT_DATE)
    ON CONFLICT (lang,input_keyword) DO UPDATE SET
      main_keyword_ko=EXCLUDED.main_keyword_ko,
      hit_count=gm_keyword_translate.hit_count + EXCLUDED.hit_count,
      updated_at=CURRENT_DATE`, [lang, inputKeyword, mainKeywordKo, Math.max(1, toInt(inc,1))]);
  return true;
}
async function saveKeywordTranslatePayload(pool, payload){
  payload = payload || {};
  await ensureKeywordTranslateTable(pool);
  const meta = pickKeywordMeta(payload);
  const mainKeywordKo = meta.mainKeyword;
  const inputKeyword = meta.inputKeyword || payload.inputKeyword || payload.input_keyword || '';
  const lang = pickLang(payload);
  const translations = pickKeywordTranslations(payload, Object.assign({}, meta.raw || {}, { mainKeyword:mainKeywordKo }));
  const relatedTranslations = pickRelatedTranslations(payload, meta.raw || {});
  let alias_saved = 0, relation_saved = 0, relation_skipped = 0;

  if(inputKeyword && mainKeywordKo){
    const inputLooksKo = /[가-힣]/.test(inputKeyword);
    const useLang = inputLooksKo ? 'ko' : lang;
    if(await upsertKeywordTranslate(pool, useLang, inputKeyword, mainKeywordKo, 1)) alias_saved++;
  }

  for(const l of KEYWORD_LANGS){
    if(l === 'ko') continue;
    const v = cleanText(translations[l] || '');
    if(v && mainKeywordKo){
      if(await upsertKeywordTranslate(pool, l, v, mainKeywordKo, 0)) alias_saved++;
    }
  }

  for(const rk of meta.relatedKeywords){
    const t = relatedTransFor(relatedTranslations, rk);
    try{
      const ok = await saveKeywordRelationRow(pool, mainKeywordKo, rk, { categoryMainKeywordKo:meta.categoryMainKeywordKo, translations:t });
      if(ok){ relation_saved++; await saveKeywordRelationStats(pool, mainKeywordKo, rk, meta.categoryMainKeywordKo); }
      else relation_skipped++;
    }catch(e){ relation_skipped++; }
  }

  return {
    mainKeyword: mainKeywordKo,
    inputKeyword,
    lang,
    alias_saved,
    relation_saved,
    relation_skipped,
    related_count: meta.relatedKeywords.length,
    mainKeywordTranslations: translations,
    relatedKeywordTranslations: relatedTranslations
  };
}
async function saveKeywordRelationRow(pool, keywordKo, relatedKo, options={}){
  keywordKo = cleanText(keywordKo);
  relatedKo = cleanText(relatedKo);
  if(!keywordKo || !relatedKo) return false;
  const categoryMainKeywordKo = cleanText(options.categoryMainKeywordKo || '');
  const trans = enrichTranslationKo(options.translations || {}, relatedKo);
  const cols = ['category_main_keyword_ko','keyword_ko','related_keyword_ko'];
  const vals = [categoryMainKeywordKo, keywordKo, relatedKo];
  KEYWORD_LANGS.filter(l => l !== 'ko').forEach(lang => {
    cols.push('related_keyword_' + lang);
    vals.push(cleanText(trans[lang] || ''));
  });
  const placeholders = vals.map((_,i)=>'$'+(i+1)).join(',');
  const updateCols = cols.filter(c => c !== 'keyword_ko' && c !== 'related_keyword_ko');
  const sql = `INSERT INTO gm_keyword_relation (${cols.join(',')}) VALUES (${placeholders})
    ON CONFLICT (keyword_ko, related_keyword_ko) DO UPDATE SET
      ${updateCols.map(c => `${c}=CASE WHEN EXCLUDED.${c} IS NULL OR EXCLUDED.${c}::text='' THEN gm_keyword_relation.${c} ELSE EXCLUDED.${c} END`).join(',')},
      updated_at=CURRENT_DATE`;
  await pool.query(sql, vals);
  return true;
}
async function saveKeywordRelationStats(pool, keywordKo, relatedKo, categoryMainKeywordKo){
  keywordKo = cleanText(keywordKo); relatedKo = cleanText(relatedKo);
  if(!keywordKo || !relatedKo) return;
  const d = new Date();
  const ym = String(d.getFullYear()) + String(d.getMonth()+1).padStart(2,'0');
  const yy = String(d.getFullYear());
  const dayCol = 'day_' + String(d.getDate()).padStart(2,'0');
  const monCol = 'month_' + String(d.getMonth()+1).padStart(2,'0');
  const category = cleanText(categoryMainKeywordKo || '');
  try{
    await pool.query(`INSERT INTO gm_keyword_relation_${ym} (category_main_keyword_ko,keyword_ko,related_keyword_ko,${dayCol},month_total)
      VALUES ($1,$2,$3,1,1)
      ON CONFLICT (keyword_ko, related_keyword_ko) DO UPDATE SET ${dayCol}=gm_keyword_relation_${ym}.${dayCol}+1, month_total=gm_keyword_relation_${ym}.month_total+1`, [category, keywordKo, relatedKo]);
  }catch(e){}
  try{
    await pool.query(`INSERT INTO gm_keyword_relation_${yy} (category_main_keyword_ko,keyword_ko,related_keyword_ko,${monCol},year_total)
      VALUES ($1,$2,$3,1,1)
      ON CONFLICT (keyword_ko, related_keyword_ko) DO UPDATE SET ${monCol}=gm_keyword_relation_${yy}.${monCol}+1, year_total=gm_keyword_relation_${yy}.year_total+1`, [category, keywordKo, relatedKo]);
  }catch(e){}
}
async function saveKeywordMetaPayload(pool, payload){
  const meta = pickKeywordMeta(payload || {});
  const keywordKo = meta.mainKeyword;
  const related = meta.relatedKeywords;
  const relatedTranslations = pickRelatedTranslations(payload || {}, meta.raw || {});
  let saved = 0, skipped = 0;
  if(!keywordKo) return { keyword_ko:'', saved, skipped, related_count:0 };
  for(const rk of related){
    const t = relatedTransFor(relatedTranslations, rk);
    try{
      const ok = await saveKeywordRelationRow(pool, keywordKo, rk, { categoryMainKeywordKo:meta.categoryMainKeywordKo, translations:t });
      if(ok){ saved++; await saveKeywordRelationStats(pool, keywordKo, rk, meta.categoryMainKeywordKo); }
      else skipped++;
    }catch(e){ skipped++; }
  }
  return { keyword_ko:keywordKo, input_keyword:meta.inputKeyword, original_keyword:meta.originalKeyword, corrected_keyword:meta.correctedKeyword, related_count:related.length, saved, skipped };
}
async function saveProductKeywordMeta(pool, productUid, mallCode, keyword, relatedKeywords, parentPayload){
  const payload = Object.assign({}, parentPayload || {});
  if(keyword && !payload.keyword) payload.keyword = keyword;
  if(relatedKeywords && !payload.relatedKeywords) payload.relatedKeywords = relatedKeywords;
  const meta = pickKeywordMeta(payload);
  const keywordKo = meta.mainKeyword || cleanText(keyword);
  if(productUid && keywordKo){
    try{ await pool.query('UPDATE gm_product SET keyword=$1, updated_at=now() WHERE product_uid=$2', [keywordKo, productUid]); }catch(e){}
  }
  return saveKeywordMetaPayload(pool, Object.assign({}, payload, { mainKeyword:keywordKo, relatedKeywords:meta.relatedKeywords }));
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
    b.ali_key || b.aliKey || b.product_key || b.productKey
  );

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

  const uid = cleanText(b.product_uid || b.productUid || (mallCode && pi ? `${mallCode}_${pi}` : ''));
  return { productId, itemId, vendorItemId, mallCode, pi, uid, source_url:urlText };
}
function pickProductName(p){
  return bestProductName(p);
}
function pickPrice(p){
  return parseMoney(firstNonEmpty(p, [
    'mall_sale_price','mallSalePrice','priceMain','displayPrice','display_price',
    'gm_price','gmPrice','searchPrice','search_price','searchPriceText',
    'price_text','priceText','rawPrice','raw_price','sale_price','salePrice',
    'final_price','finalPrice','ali_price','aliPrice','min_price','minPrice','price'
  ]), 0);
}
function pickNormalPrice(p){
  const v = firstNonEmpty(p, ['normal_price','normalPrice','original_price','originalPrice','list_price','listPrice','base_price','basePrice','rawOriginalPrice','raw_original_price']);
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
    p.seller_name || p.sellerName || p.vendor_name || p.vendorName ||
    p.store_name || p.storeName || p.shop_name || p.shopName || ''
  );
}
function pickSupplierId(p){
  return cleanText(p.supplier_id || p.supplierId || p.seller_id || p.sellerId || p.vendor_id || p.vendorId || p.store_id || p.storeId || '');
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
  const rawObj = (raw && typeof raw.raw_json === 'object' && !Array.isArray(raw.raw_json)) ? raw.raw_json : {};
  const p = { ...rawObj, ...(raw || {}) };
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
  const productName = pickProductName(p);
  return { p, id:{ productId, itemId, vendorItemId, mallCode, pi, uid }, productName };
}

function jsonCleanText(v){ return cleanText(v); }
function pickOptPrice(row, names){
  row=row||{};
  for(const n of names){
    if(row[n] !== undefined && row[n] !== null && cleanText(row[n]) !== '') return parseMoney(row[n], 0);
  }
  return 0;
}
function normalizeThumbJson(p){
  p=p||{};
  const out=[]; const seen=new Set();
  function add(v, source){
    if(v && typeof v === 'object') v = v.url || v.src || v.image || v.thumb || '';
    v = normalizeUrl(v);
    if(!v || seen.has(v)) return;
    seen.add(v);
    out.push({ url:v, source:source || 'payload', index:out.length });
  }
  [p.thumb_json,p.thumbJson,p.thumbnailImages,p.images,p.galleryImages,p.thumbnails,p.mainThumbnailImages,p.skuThumbnailImages].forEach((a)=>{
    if(Array.isArray(a)) a.forEach(x=>add(x,'array'));
  });
  add(p.thumb_origin_url || p.thumbOriginUrl || p.thumb_url || p.thumbUrl || p.thumbnail || p.image || p.mainImage, 'main');
  return out;
}
function normalizeOptionJson(p, id){
  p=p||{}; id=id||{};
  const arrays=[];
  ['optionCombos','aliOptionCombos','flatOptionRows','optionRows','visibleOptions','options','vendorItemOptions','itemOptions','selectedOptions'].forEach(k=>{
    if(Array.isArray(p[k])) arrays.push(p[k]);
  });
  const rows=[]; const seen=new Set();
  arrays.forEach(arr=>arr.forEach((r)=>{
    if(!r || typeof r !== 'object') return;
    const productId = cleanText(r.productId || r.product_id || id.productId || p.productId || p.product_id || '');
    const itemId = cleanText(r.itemId || r.item_id || r.skuId || r.sku_id || (id.mallCode==='ALKR' ? (r.skuIdStr || r.sku_id_str || '') : '') || '');
    const vendorItemId = cleanText(r.vendorItemId || r.venderItemId || r.vendor_item_id || r.skuId || r.sku_id || itemId || id.vendorItemId || '');
    const pi = [productId, itemId, vendorItemId].filter(Boolean).join('_') || cleanText(r.key || r.uid || r.option_uid || '');
    const uid = cleanText(r.uid || r.option_uid || (id.mallCode && pi ? id.mallCode + '_' + pi : pi));
    const name = cleanText(r.fullOptionName || r.displayOptionName || r.optionName || r.option_name || r.name || r.value || r.title || '');
    if(!uid && !name) return;
    const sig = uid || (name + '|' + vendorItemId + '|' + itemId);
    if(seen.has(sig)) return; seen.add(sig);
    const mallPrice = pickOptPrice(r, ['mall_price','mallPrice','raw_price','rawPrice','rawCoupangOptionPrice','rawOptionPrice','coupangPrice','basePrice','basePriceText']);
    const salePrice = pickOptPrice(r, ['sale_price','salePrice','sell_price','sellPrice','calculatedPrice','optionPrice','optionPriceText','price','priceText','finalPriceText']);
    const feeText = cleanText(r.delivery_fee_text || r.deliveryFeeText || r.optionShippingFeeText || r.shippingFeeText || r.baseShippingFeeText || r.deliveryFee || '');
    const fee = r.delivery_fee !== undefined ? parseMoney(r.delivery_fee, 0) : parseMoney(feeText, 0);
    const badgeText = cleanText(r.delivery_badge_text || r.deliveryBadgeText || r.optionShippingBadge || r.shippingBadge || r.deliveryBadge || r.deliveryType || r.shipType || '');
    rows.push({
      uid, item_id:itemId, vendor_item_id:vendorItemId, product_id:productId, option_name:name,
      mall_price:mallPrice, sale_price:salePrice,
      delivery_badge:cleanText(r.delivery_badge || r.deliveryBadge || r.shipType || r.optionShipType || ''),
      delivery_badge_text:badgeText,
      delivery_fee:fee,
      delivery_fee_text:feeText,
      delivery_free_yn: feeText ? (/무료/.test(feeText) || fee===0) : (fee===0),
      delivery_eta_text:cleanText(r.delivery_eta_text || r.deliveryEtaText || r.deliveryDateText || r.arrivalText || r.etaText || ''),
      option_image_url:normalizeUrl(r.option_image_url || r.optionImageUrl || r.optionImage || r.image || r.thumbnail || r.thumb || ''),
      soldout_yn: !!(r.soldout_yn === true || r.soldoutYn === true || r.soldout === true || /품절|sold\s*out/i.test(cleanText(r.soldout_yn || r.soldoutYn || r.status || ''))),
      source:cleanText(r.source || '')
    });
  }));
  const selectedUid = cleanText(p.default_uid || p.defaultUid || p.selectedOptionUid || p.selected_option_uid || id.uid || '');
  const defaultUid = rows.some(r=>r.uid===selectedUid) ? selectedUid : (rows[0] && rows[0].uid || selectedUid);
  return { default_uid:defaultUid, option_count:rows.length, updated_at:new Date().toISOString(), options:rows };
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

async function upsertProduct(pool, raw, parent={}){
  const n = normalizeProductPayload(raw, parent);
  const p = n.p, id = n.id, productName = n.productName;
  const missing = [];
  if(!id.uid) missing.push('product_uid');
  if(!id.pi) missing.push('pi_ii_vi');
  if(!id.mallCode) missing.push('mall_code');
  if(!productName) missing.push('product_name');
  if(missing.length){
    return {
      ok:false,
      skipped:true,
      reason:'required field missing: ' + missing.join(','),
      missing,
      uid:id.uid || '',
      pi_ii_vi:id.pi || '',
      mall_code:id.mallCode || '',
      product_id:id.productId || '',
      source_url:id.source_url || pickProductUrl(p),
      title_sample: cleanText(p.title || p.name || p.productName || p.product_name).slice(0, 120)
    };
  }
  const sql=`
    INSERT INTO gm_product (
      product_uid, glomart_code, gm_category, category_keyword, mall_code, source_mall, source_uid, mall_category,
      product_id, item_id, vendor_item_id, pi_ii_vi, internal_product_code,
      product_name, mall_product_name, option_count, option_name, option_value,
      origin_country, mall_sale_price, final_supply_price, normal_price, discount_price,
      delivery_fee, delivery_eta_text, delivery_type, tax_type, overseas_direct_yn, review_count, mall_sales_count,
      supplier_id, supplier_name_snapshot, business_number_snapshot, online_sales_number_snapshot,
      ceo_name_snapshot, supplier_mobile_snapshot, supplier_phone_snapshot, supplier_email_snapshot, supplier_address_snapshot,
      product_url, thumb_origin_url, thumb_file_name,
      return_available_yn, exchange_available_yn, return_policy_text, exchange_policy_text,
      return_shipping_fee, exchange_shipping_fee, return_period_days, exchange_period_days,
      return_address, exchange_address, return_contact, exchange_contact,
      soldout_yn, hit_count, detail_view_count, cart_count, wish_count, order_count, order_qty_total,
      sale_status, product_grade, sale_unit_text, unit_price_text, unit_price_value, unit_base_qty, unit_base_unit, unit_norm_qty, unit_norm_unit, unit_norm_price, unit_parse_status, unit_sortable_yn, last_seen_at, expire_at, created_at, updated_at
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,
      $29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,
      $42,$43,$44,$45,$46,$47,$48,$49,$50,$51,$52,$53,$54,
      $55,1,0,0,0,0,0,$56,$57,$58,$59,$60,$61,$62,$63,$64,$65,$66,$67,now(),now() + INTERVAL '30 days',now(),now()
    )
    ON CONFLICT (product_uid) DO UPDATE SET
      source_mall=EXCLUDED.source_mall,
      source_uid=EXCLUDED.source_uid,
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
      review_count=EXCLUDED.review_count,
      mall_sales_count=EXCLUDED.mall_sales_count,
      supplier_id=EXCLUDED.supplier_id,
      supplier_name_snapshot=EXCLUDED.supplier_name_snapshot,
      business_number_snapshot=EXCLUDED.business_number_snapshot,
      online_sales_number_snapshot=EXCLUDED.online_sales_number_snapshot,
      ceo_name_snapshot=EXCLUDED.ceo_name_snapshot,
      supplier_mobile_snapshot=EXCLUDED.supplier_mobile_snapshot,
      supplier_phone_snapshot=EXCLUDED.supplier_phone_snapshot,
      supplier_email_snapshot=EXCLUDED.supplier_email_snapshot,
      supplier_address_snapshot=EXCLUDED.supplier_address_snapshot,
      product_url=EXCLUDED.product_url,
      thumb_origin_url=EXCLUDED.thumb_origin_url,
      thumb_file_name=EXCLUDED.thumb_file_name,
      return_available_yn=EXCLUDED.return_available_yn,
      exchange_available_yn=EXCLUDED.exchange_available_yn,
      return_policy_text=EXCLUDED.return_policy_text,
      exchange_policy_text=EXCLUDED.exchange_policy_text,
      return_shipping_fee=EXCLUDED.return_shipping_fee,
      exchange_shipping_fee=EXCLUDED.exchange_shipping_fee,
      return_period_days=EXCLUDED.return_period_days,
      exchange_period_days=EXCLUDED.exchange_period_days,
      return_address=EXCLUDED.return_address,
      exchange_address=EXCLUDED.exchange_address,
      return_contact=EXCLUDED.return_contact,
      exchange_contact=EXCLUDED.exchange_contact,
      soldout_yn=EXCLUDED.soldout_yn,
      sale_status=EXCLUDED.sale_status,
      product_grade=EXCLUDED.product_grade,
      sale_unit_text=EXCLUDED.sale_unit_text,
      unit_price_text=EXCLUDED.unit_price_text,
      unit_price_value=EXCLUDED.unit_price_value,
      unit_base_qty=EXCLUDED.unit_base_qty,
      unit_base_unit=EXCLUDED.unit_base_unit,
      unit_norm_qty=EXCLUDED.unit_norm_qty,
      unit_norm_unit=EXCLUDED.unit_norm_unit,
      unit_norm_price=EXCLUDED.unit_norm_price,
      unit_parse_status=EXCLUDED.unit_parse_status,
      unit_sortable_yn=EXCLUDED.unit_sortable_yn,
      hit_count=COALESCE(gm_product.hit_count,0)+1,
      last_seen_at=now(),
      expire_at=now() + INTERVAL '30 days',
      updated_at=now()
    RETURNING product_uid, pi_ii_vi, mall_code, hit_count, (xmax = 0) AS inserted
  `;
  const thumbUrl = pickThumbUrl(p);
  const productUrl = pickProductUrl(p);
  const optionName = pickOptionName(p);
  const optionValue = pickOptionValue(p);
  const deliveryText = pickDeliveryText(p);
  const deliveryType = pickDeliveryType(p);
  const supplierId = pickSupplierId(p);
  const supplierName = pickSupplierName(p);
  const sourceMall = sourceMallFrom(p, p.source_uid || p.sourceUid, productUrl, id.mallCode);
  const sourceUid = sourceUidFrom(p, sourceMall);
  const searchKeyword = pickSearchKeyword(p, parent);
  const relatedKeywords = pickRelatedKeywords(p, parent);
  const vals=[
    id.uid, cleanText(p.glomart_code || p.glomartCode), cleanText(p.gm_category || p.gmCategory),
    cleanText(p.category_keyword || p.categoryKeyword || p.keyword), id.mallCode, sourceMall, sourceUid, cleanText(p.mall_category || p.mallCategory),
    id.productId, id.itemId, id.vendorItemId, id.pi, cleanText(p.internal_product_code || p.internalProductCode),
    productName, cleanDupMallProductName(productName, p.mall_product_name || p.mallProductName || ''), toInt(p.option_count || p.optionCount, optionName || optionValue ? 1 : 0),
    optionName, optionValue,
    cleanText(p.origin_country || p.originCountry), pickPrice(p),
    p.final_supply_price == null && p.finalSupplyPrice == null ? null : toInt(p.final_supply_price || p.finalSupplyPrice, 0),
    pickNormalPrice(p),
    pickDiscountPrice(p),
    pickDeliveryFee(p), deliveryText,
    deliveryType, cleanText(p.tax_type || p.taxType),
    cleanText(p.overseas_direct_yn || p.overseasDirectYn || 'N'), pickReviewCount(p), pickMallSalesCount(p), supplierId, supplierName,
    pickAny(p,['business_number_snapshot','businessNumberSnapshot','business_number','businessNumber','seller_business_number','sellerBusinessNumber']),
    pickAny(p,['online_sales_number_snapshot','onlineSalesNumberSnapshot','online_sales_number','onlineSalesNumber','mail_order_number','mailOrderNumber']),
    pickAny(p,['ceo_name_snapshot','ceoNameSnapshot','ceo_name','ceoName','representative_name','representativeName']),
    pickAny(p,['supplier_mobile_snapshot','supplierMobileSnapshot','supplier_mobile','supplierMobile','seller_mobile','sellerMobile']),
    pickAny(p,['supplier_phone_snapshot','supplierPhoneSnapshot','supplier_phone','supplierPhone','seller_phone','sellerPhone']),
    pickAny(p,['supplier_email_snapshot','supplierEmailSnapshot','supplier_email','supplierEmail','seller_email','sellerEmail']),
    pickAny(p,['supplier_address_snapshot','supplierAddressSnapshot','supplier_address','supplierAddress','seller_address','sellerAddress']),
    productUrl, thumbUrl, cleanText(p.thumb_file_name || p.thumbFileName || ''),
    cleanText(p.return_available_yn || p.returnAvailableYn || 'Y'), cleanText(p.exchange_available_yn || p.exchangeAvailableYn || 'Y'),
    cleanText(p.return_policy_text || p.returnPolicyText || p.return_policy || p.returnPolicy || ''),
    cleanText(p.exchange_policy_text || p.exchangePolicyText || p.exchange_policy || p.exchangePolicy || ''),
    toInt(p.return_shipping_fee || p.returnShippingFee, 0), toInt(p.exchange_shipping_fee || p.exchangeShippingFee, 0),
    p.return_period_days == null && p.returnPeriodDays == null ? null : toInt(p.return_period_days || p.returnPeriodDays, 0),
    p.exchange_period_days == null && p.exchangePeriodDays == null ? null : toInt(p.exchange_period_days || p.exchangePeriodDays, 0),
    cleanText(p.return_address || p.returnAddress || ''), cleanText(p.exchange_address || p.exchangeAddress || ''),
    cleanText(p.return_contact || p.returnContact || ''), cleanText(p.exchange_contact || p.exchangeContact || ''),
    cleanText(p.soldout_yn || p.soldoutYn || p.soldout || 'N'), cleanText(p.sale_status || p.saleStatus || 'active'), pickRatingScore(p),
    firstNonEmpty(p, ['sale_unit_text','saleUnitText','unitSaleText']),
    firstNonEmpty(p, ['unit_price_text','unitPriceText','searchUnitPriceText','unitPrice','unitPriceDisplay']),
    firstNonEmpty(p, ['unit_price_value','unitPriceValue']) ? Number(firstNonEmpty(p, ['unit_price_value','unitPriceValue'])) : null,
    firstNonEmpty(p, ['unit_base_qty','unitBaseQty']) ? Number(firstNonEmpty(p, ['unit_base_qty','unitBaseQty'])) : null,
    firstNonEmpty(p, ['unit_base_unit','unitBaseUnit']),
    firstNonEmpty(p, ['unit_norm_qty','unitNormQty']) ? Number(firstNonEmpty(p, ['unit_norm_qty','unitNormQty'])) : null,
    firstNonEmpty(p, ['unit_norm_unit','unitNormUnit']),
    firstNonEmpty(p, ['unit_norm_price','unitNormPrice']) ? Number(firstNonEmpty(p, ['unit_norm_price','unitNormPrice'])) : null,
    firstNonEmpty(p, ['unit_parse_status','unitParseStatus']),
    firstNonEmpty(p, ['unit_sortable_yn','unitSortableYn'])
  ];  const r=await pool.query(sql, vals);
  const optionJson = normalizeOptionJson(p, id);
  const thumbJson = normalizeThumbJson(p);
  const optionCount = optionJson.option_count || toInt(p.option_count || p.optionCount, 0);
  const taxType = pickTaxType(p) || cleanText(p.tax_type || p.taxType || '');
  try{
    await pool.query(`UPDATE gm_product SET option_json=$1, thumb_json=$2, option_count=$3, tax_type=COALESCE(NULLIF($4,''), tax_type), updated_at=now() WHERE product_uid=$5`, [optionJson, thumbJson, optionCount, taxType, id.uid]);
  }catch(e){
    console.error('[GM_PRODUCT_JSON_UPDATE_ERROR]', e && e.message || e);
  }
  await saveProductKeywordMeta(pool, id.uid, id.mallCode, searchKeyword, relatedKeywords, Object.assign({}, parent || {}, p || {}));
  return { ok:true, action:(r.rows[0] && r.rows[0].inserted) ? 'inserted' : 'updated', item:Object.assign({}, r.rows[0] || {}, { option_count:optionCount }) };
}



router.post('/api/gm/keyword/translate', async (req,res)=>{
  const pool=db(req), p=req.body||{};
  if(!pool) return fail(res, 500, 'DB pool is not attached');
  try{
    const result = await saveKeywordTranslatePayload(pool, p);
    return ok(res, result);
  }catch(e){
    console.error('[GM_KEYWORD_TRANSLATE_SAVE_ERROR]', e);
    return fail(res, 500, 'keyword translate save failed', { detail:String(e && e.message || e) });
  }
});

router.get('/api/gm/keyword/lookup', async (req,res)=>{
  const pool=db(req);
  if(!pool) return fail(res, 500, 'DB pool is not attached');
  try{
    await ensureKeywordTranslateTable(pool);
    const input=cleanText(req.query.input_keyword || req.query.keyword || req.query.q || '');
    const lang=cleanText(req.query.lang || req.query.gm_lang || '').toLowerCase();
    if(!input) return fail(res, 400, 'input_keyword required');
    let r;
    if(lang){
      r=await pool.query('SELECT lang,input_keyword,main_keyword_ko,hit_count,updated_at FROM gm_keyword_translate WHERE lang=$1 AND input_keyword=$2', [lang,input]);
      if(r.rows[0]) return ok(res, { found:true, item:r.rows[0] });
    }
    r=await pool.query('SELECT lang,input_keyword,main_keyword_ko,hit_count,updated_at FROM gm_keyword_translate WHERE input_keyword=$1 ORDER BY hit_count DESC, updated_at DESC LIMIT 1', [input]);
    return ok(res, { found:!!r.rows[0], item:r.rows[0]||null });
  }catch(e){
    return fail(res, 500, 'keyword lookup failed', { detail:String(e && e.message || e) });
  }
});

router.post('/api/gm/product/queue', async (req,res)=>{
  const pool=db(req), p=req.body||{};
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
    ok(res,{
      action:'product.queue',
      queued:true,
      queue:r.rows[0],
      queue_id:r.rows[0] && r.rows[0].queue_id,
      request_id:r.rows[0] && r.rows[0].request_id,
      item_count:r.rows[0] && r.rows[0].item_count,
      received:items.length,
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
  const pool=db(req), p=req.body||{};
  if(!pool) return fail(res, 500, 'DB pool is not attached');
  const items = Array.isArray(p.items) ? p.items : (Array.isArray(p.products) ? p.products : null);
  try{
    if(items){
      const results=[];
      for(const item of items){
        try{ results.push(await upsertProduct(pool, item, p)); }
        catch(e){ results.push({ ok:false, error:String(e && e.message || e) }); }
      }
      const saved = results.filter(x=>x && x.ok).length;
      const skipped = results.length - saved;
      return ok(res,{ mode:'batch', received:items.length, saved, skipped, results:results.slice(0,20) });
    }
    const result = await upsertProduct(pool, p, p);
    if(!result.ok) return fail(res, 400, result.reason || 'product upsert validation failed', result);
    return ok(res,{ mode:'single', item:result.item });
  }catch(e){ fail(res,500,'product upsert failed',{detail:String(e && e.message || e)}); }
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
  if(type === 'detail' || type === 'view') setSql = "detail_view_count=COALESCE(detail_view_count,0)+1, view_count=COALESCE(view_count,0)+1, last_view_at=now(), expire_at=GREATEST(COALESCE(expire_at, now()), now() + INTERVAL '90 days')";
  else if(type === 'cart') setSql = "cart_count=COALESCE(cart_count,0)+1, last_cart_at=now(), expire_at=GREATEST(COALESCE(expire_at, now()), now() + INTERVAL '180 days')";
  else if(type === 'wish') setSql = "wish_count=COALESCE(wish_count,0)+1, last_wish_at=now(), expire_at=GREATEST(COALESCE(expire_at, now()), now() + INTERVAL '180 days')";
  else if(type === 'order') setSql = "order_count=COALESCE(order_count,0)+1, order_qty_total=COALESCE(order_qty_total,0)+" + qty + ", last_order_at=now(), expire_at=GREATEST(COALESCE(expire_at, now()), now() + INTERVAL '730 days')";
  else if(type === 'return') setSql = "return_count=COALESCE(return_count,0)+1, last_return_at=now()";
  else if(type === 'exchange') setSql = "exchange_count=COALESCE(exchange_count,0)+1, last_exchange_at=now()";
  else if(type === 'ad_view') setSql = "ad_view_count=COALESCE(ad_view_count,0)+1, last_ad_view_at=now()";
  else if(type === 'ad_sale') setSql = "ad_order_count=COALESCE(ad_order_count,0)+1, ad_sales_qty=COALESCE(ad_sales_qty,0)+" + qty + ", last_ad_order_at=now()";
  else return fail(res, 400, 'event type must be detail/view/cart/wish/order/return/exchange/ad_view/ad_sale');
  try{
    const r=await pool.query(`UPDATE gm_product SET ${setSql}, updated_at=now() WHERE ${where} RETURNING product_uid, pi_ii_vi`, vals);
    ok(res,{action:'product.event', type, updated:r.rowCount, item:r.rows[0] || null});
  }catch(e){ fail(res,500,'product event failed',{detail:String(e && e.message || e)}); }
});

router.upsertProduct = upsertProduct;
module.exports=router;
