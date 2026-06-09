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
  const chunkTotal = toInt(p.chunk_total || p.chunkTotal, 0);
  const searchRunId = cleanText(p.search_run_id || p.searchRunId || p.base_request_id || p.baseRequestId || '');

  // Queue 작업 식별자는 상품 UID와 절대 섞지 않는다.
  // 같은 검색을 10개 단위 chunk로 보내면 request_id가 동일할 수 있으므로,
  // 서버에서 chunk_index를 붙여 queue row 단위로 유일하게 보정한다.
  // 예: REQ123 + chunk_index 2 => REQ123_C002
  const withChunk = function(base){
    base = cleanText(base);
    if(!base) return '';
    if(chunkIndex > 0){
      return /_C\d{1,4}$/i.test(base) ? base : base + '_C' + String(chunkIndex).padStart(3,'0');
    }
    return base;
  };

  const fromRaw = withChunk(raw);
  if(fromRaw) return fromRaw;

  const fromRun = withChunk(searchRunId);
  if(fromRun) return fromRun;

  const mall = cleanText(p.mall_code || p.mallCode || p.source || 'UNKNOWN').toUpperCase();
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
function ids(b){
  const mallCode = cleanText(b.mall_code || b.mallCode || b.source || b.mall || 'CPKR').toUpperCase();
  const isAliMall = mallCode === 'ALI' || mallCode === 'ALKR' || /^AL/.test(mallCode);

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

  let productId = cleanText(
    b.product_id || b.productId || b.productID || b.ali_product_id || b.aliProductId || b.aliProductID ||
    b.itemId || b.item_id || b.item_id_ali || b.ali_item_id || b.aliItemId || aliUrlId
  );
  let itemId = cleanText(b.item_id || b.itemId || b.sku_id || b.skuId || b.ali_sku_id || b.aliSkuId);
  let vendorItemId = cleanText(b.vendor_item_id || b.vendorItemId || b.venderItemId || b.offer_id || b.offerId || b.ali_offer_id || b.aliOfferId);

  let pi = cleanText(b.pi_ii_vi || b.piIiVi || b.ali_key || b.aliKey || b.product_key || b.productKey);
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
  if(!vendorItemId && productId && !itemId) vendorItemId = productId;

  const uid = cleanText(b.product_uid || b.productUid || (mallCode && pi ? `${mallCode}_${pi}` : ''));
  return { productId, itemId, vendorItemId, mallCode, pi, uid, source_url:urlText };
}
function pickProductName(p){
  return cleanText(
    p.product_name || p.productName || p.mall_product_name || p.mallProductName ||
    p.title || p.name || p.subject || p.item_title || p.itemTitle || p.product_title || p.productTitle
  );
}
function pickPrice(p){
  return toInt(
    p.mall_sale_price || p.mallSalePrice || p.price || p.real_price || p.realPrice ||
    p.sale_price || p.salePrice || p.final_price || p.finalPrice || p.ali_price || p.aliPrice || p.min_price || p.minPrice,
    0
  );
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
  return cleanText(
    p.delivery_eta_text || p.deliveryEtaText || p.deliveryText || p.delivery_text ||
    p.shipping_text || p.shippingText || p.shipping_message || p.shippingMessage ||
    p.arrival_text || p.arrivalText || p.eta_text || p.etaText || ''
  );
}
function pickDeliveryType(p){
  return cleanText(
    p.delivery_type || p.deliveryType || p.shipping_type || p.shippingType ||
    p.delivery_badge || p.deliveryBadge || p.shipping_badge || p.shippingBadge || ''
  );
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
function safeJsonString(v){
  try{return JSON.stringify(v == null ? {} : v);}catch(_e){return '{}';}
}
function buildOptionJson(p, id){
  return safeJsonString({
    option_name:pickOptionName(p), option_value:pickOptionValue(p),
    option_count:toInt(p.option_count || p.optionCount, 0),
    product_id:id.productId || '', item_id:id.itemId || '', vendor_item_id:id.vendorItemId || '',
    raw_option:p.option || p.options || p.option_info || p.optionInfo || p.sku || p.sku_info || p.skuInfo || null
  });
}
function buildShippingJson(p){
  return safeJsonString({
    delivery_type:pickDeliveryType(p), delivery_text:pickDeliveryText(p),
    delivery_fee:toInt(p.delivery_fee || p.deliveryFee || p.shipping_fee || p.shippingFee, 0),
    delivery_days_range:cleanText(p.delivery_days_range || p.deliveryDaysRange || ''),
    raw_shipping:p.shipping || p.delivery || p.delivery_info || p.deliveryInfo || p.shipping_info || p.shippingInfo || null
  });
}
function buildSupplierJson(p){
  return safeJsonString({
    supplier_id:pickSupplierId(p), seller_name:pickSupplierName(p),
    business_number:pickAny(p,['business_number_snapshot','businessNumberSnapshot','business_number','businessNumber','seller_business_number','sellerBusinessNumber']),
    online_sales_number:pickAny(p,['online_sales_number_snapshot','onlineSalesNumberSnapshot','online_sales_number','onlineSalesNumber','mail_order_number','mailOrderNumber']),
    ceo_name:pickAny(p,['ceo_name_snapshot','ceoNameSnapshot','ceo_name','ceoName','representative_name','representativeName']),
    mobile:pickAny(p,['supplier_mobile_snapshot','supplierMobileSnapshot','supplier_mobile','supplierMobile','seller_mobile','sellerMobile']),
    phone:pickAny(p,['supplier_phone_snapshot','supplierPhoneSnapshot','supplier_phone','supplierPhone','seller_phone','sellerPhone']),
    email:pickAny(p,['supplier_email_snapshot','supplierEmailSnapshot','supplier_email','supplierEmail','seller_email','sellerEmail']),
    address:pickAny(p,['supplier_address_snapshot','supplierAddressSnapshot','supplier_address','supplierAddress','seller_address','sellerAddress']),
    raw_supplier:p.supplier || p.seller || p.vendor || p.store || p.shop || p.supplier_info || p.supplierInfo || p.seller_info || p.sellerInfo || null
  });
}
function normalizeProductPayload(raw, parent={}){
  const p = { ...(raw || {}) };
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
      product_uid, glomart_code, gm_category, category_keyword, mall_code, mall_category,
      product_id, item_id, vendor_item_id, pi_ii_vi, internal_product_code,
      product_name, mall_product_name, option_count, option_name, option_value,
      origin_country, mall_sale_price, final_supply_price, normal_price, discount_price,
      delivery_fee, delivery_eta_text, delivery_type, tax_type, overseas_direct_yn,
      supplier_id, supplier_name_snapshot, business_number_snapshot, online_sales_number_snapshot,
      ceo_name_snapshot, supplier_mobile_snapshot, supplier_phone_snapshot, supplier_email_snapshot, supplier_address_snapshot,
      product_url, thumb_origin_url, thumb_file_name,
      option_json, shipping_json, supplier_json, product_raw_json,
      return_available_yn, exchange_available_yn, return_policy_text, exchange_policy_text,
      return_shipping_fee, exchange_shipping_fee, return_period_days, exchange_period_days,
      return_address, exchange_address, return_contact, exchange_contact,
      soldout_yn, hit_count, detail_view_count, cart_count, wish_count, order_count, order_qty_total,
      sale_status, last_seen_at, expire_at, created_at, updated_at
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,
      $27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39::jsonb,$40::jsonb,$41::jsonb,$42::jsonb,
      $43,$44,$45,$46,$47,$48,$49,$50,$51,$52,$53,$54,$55,
      1,0,0,0,0,0,$56,now(),now() + INTERVAL '30 days',now(),now()
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
      option_json=EXCLUDED.option_json,
      shipping_json=EXCLUDED.shipping_json,
      supplier_json=EXCLUDED.supplier_json,
      product_raw_json=EXCLUDED.product_raw_json,
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
  const vals=[
    id.uid, cleanText(p.glomart_code || p.glomartCode), cleanText(p.gm_category || p.gmCategory),
    cleanText(p.category_keyword || p.categoryKeyword || p.keyword), id.mallCode, cleanText(p.mall_category || p.mallCategory),
    id.productId, id.itemId, id.vendorItemId, id.pi, cleanText(p.internal_product_code || p.internalProductCode),
    productName, cleanText(p.mall_product_name || p.mallProductName || productName), toInt(p.option_count || p.optionCount, optionName || optionValue ? 1 : 0),
    optionName, optionValue,
    cleanText(p.origin_country || p.originCountry), pickPrice(p),
    p.final_supply_price == null && p.finalSupplyPrice == null ? null : toInt(p.final_supply_price || p.finalSupplyPrice, 0),
    p.normal_price == null && p.normalPrice == null ? null : toInt(p.normal_price || p.normalPrice, 0),
    p.discount_price == null && p.discountPrice == null ? null : toInt(p.discount_price || p.discountPrice, 0),
    toInt(p.delivery_fee || p.deliveryFee || p.shipping_fee || p.shippingFee, 0), deliveryText,
    deliveryType, cleanText(p.tax_type || p.taxType),
    cleanText(p.overseas_direct_yn || p.overseasDirectYn || 'N'), supplierId, supplierName,
    pickAny(p,['business_number_snapshot','businessNumberSnapshot','business_number','businessNumber','seller_business_number','sellerBusinessNumber']),
    pickAny(p,['online_sales_number_snapshot','onlineSalesNumberSnapshot','online_sales_number','onlineSalesNumber','mail_order_number','mailOrderNumber']),
    pickAny(p,['ceo_name_snapshot','ceoNameSnapshot','ceo_name','ceoName','representative_name','representativeName']),
    pickAny(p,['supplier_mobile_snapshot','supplierMobileSnapshot','supplier_mobile','supplierMobile','seller_mobile','sellerMobile']),
    pickAny(p,['supplier_phone_snapshot','supplierPhoneSnapshot','supplier_phone','supplierPhone','seller_phone','sellerPhone']),
    pickAny(p,['supplier_email_snapshot','supplierEmailSnapshot','supplier_email','supplierEmail','seller_email','sellerEmail']),
    pickAny(p,['supplier_address_snapshot','supplierAddressSnapshot','supplier_address','supplierAddress','seller_address','sellerAddress']),
    productUrl, thumbUrl, cleanText(p.thumb_file_name || p.thumbFileName || ''),
    buildOptionJson(p, id), buildShippingJson(p), buildSupplierJson(p), safeJsonString(p),
    cleanText(p.return_available_yn || p.returnAvailableYn || 'Y'), cleanText(p.exchange_available_yn || p.exchangeAvailableYn || 'Y'),
    cleanText(p.return_policy_text || p.returnPolicyText || p.return_policy || p.returnPolicy || ''),
    cleanText(p.exchange_policy_text || p.exchangePolicyText || p.exchange_policy || p.exchangePolicy || ''),
    toInt(p.return_shipping_fee || p.returnShippingFee, 0), toInt(p.exchange_shipping_fee || p.exchangeShippingFee, 0),
    p.return_period_days == null && p.returnPeriodDays == null ? null : toInt(p.return_period_days || p.returnPeriodDays, 0),
    p.exchange_period_days == null && p.exchangePeriodDays == null ? null : toInt(p.exchange_period_days || p.exchangePeriodDays, 0),
    cleanText(p.return_address || p.returnAddress || ''), cleanText(p.exchange_address || p.exchangeAddress || ''),
    cleanText(p.return_contact || p.returnContact || ''), cleanText(p.exchange_contact || p.exchangeContact || ''),
    cleanText(p.soldout_yn || p.soldoutYn || p.soldout || 'N'), cleanText(p.sale_status || p.saleStatus || 'active')
  ];  const r=await pool.query(sql, vals);
  return { ok:true, action:(r.rows[0] && r.rows[0].inserted) ? 'inserted' : 'updated', item:r.rows[0] };
}


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
