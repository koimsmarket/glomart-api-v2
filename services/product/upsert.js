'use strict';
// GM_PRODUCT_SPLIT_V003_UPSERT
const {classifyProduct}=require('../glomart_code');
const {recalcProductUnitByUid}=require('../unit_price');
const {pickCpSelectedCode,pickCpFixCode,parseCategoryTreeFromPayload,findCpSelectedCodeForKeyword,findCpSelectedCodeForKeywordAndTree,ensureDynamicCategoriesFromDetail,decideCpMatch,applyCpFixLearning}=require('../category');
const shared=require('./shared');
const keyword=require('./keyword');
const {normalizeMallCategoryJson,pickMallCategoryLeaf}=require('./search_category');
const {normalizeOptionJson,makeProductOptionLinkJson,upsertProductOptions}=require('./option');
const {normalizeThumbJson,normalizeDetailJson,detailSignalStats,applyDetailPatch}=require('./detail');
const {cleanText,toInt,resolveUnitPriceSource,normalizeProductPayload,pickPrice,pickNormalPrice,pickFinalSupplyPrice,pickDiscountPrice,pickDeliveryFee,pickDeliveryText,pickDeliveryType,pickReviewCount,pickMallSalesCount,pickRatingScore,cleanDupMallProductName,pickProductUrl,buildProductUrlFromId,pickThumbUrl,pickSupplierName,pickSupplierId,isStandardCoupangSupplier,pickAny,sourceMallFrom,sourceUidFrom,safeJsonString,compactError,pickTaxType,ensureProductLightJsonColumns,pickBuyableQty,pickMinOrderQty,pickMaxOrderQty,pickReturnShippingFee,normalizeUrl}=shared;
const {pickSearchKeyword,pickCategoryKeyword,pickRelatedKeywords,pickKeywordMeta,uniqClean,ensureKeywordRelationSchema,saveKeywordTranslatePayload,saveProductKeywordMeta,updateSearchLogCategoryByKeyword}=keyword;
async function upsertProduct(pool, raw, parent={}){
  const sourceUnitPrice = resolveUnitPriceSource(raw,parent);
  const n = normalizeProductPayload(raw, parent);
  const p = n.p, id = n.id, productName = n.productName;
  const sourceUnitPriceText = sourceUnitPrice.text;
  const sourceUnitPriceSeen = sourceUnitPrice.seen;
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
  const categoryKeyword = pickCategoryKeyword(p, parent, searchKeyword);
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
  await ensureProductLightJsonColumns(pool);
  const optionJson = normalizeOptionJson(p, id);
  const thumbJson = normalizeThumbJson(p);
  const detailJsonRaw = normalizeDetailJson(p);
  const detailJsonHasData = !!(detailJsonRaw && ((detailJsonRaw.image_count||0) + (detailJsonRaw.block_count||0) + (detailJsonRaw.text_count||0) > 0));
  const detailJson = detailJsonHasData ? detailJsonRaw : null;
  const optionCount = optionJson.option_count || toInt(p.option_count || p.optionCount, 0);
  const taxType = pickTaxType(p) || cleanText(p.tax_type || p.taxType || '');
  const returnFee = pickReturnShippingFee(p, mallSalePrice);

  const mallCategoryStored = /^\d+$/.test(cleanText(cpSelectedCode)) ? cleanText(cpSelectedCode) : '';

  let serverGlomartMatch={gm_code:'',match_by:'NO_MATCH'};
  try{
    serverGlomartMatch=await classifyProduct(pool,{
      mall_category:mallCategoryStored,
      cp_fix_code:cpFixCode,
      cp_selected_code:cpSelectedCode,
      category_code:cleanText(p.category_code || p.categoryCode || ''),
      category_keyword:categoryKeyword,
      keyword:searchKeyword
    });
  }catch(e){
    console.warn('[GM_GLOMART_CODE_MATCH_WARN]', {uid:id.uid, error:String(e&&e.message||e)});
  }
  // glomart_code is decided on the server. Client-provided glomart_code is not used as a classification source.
  const resolvedGlomartCode=cleanText(serverGlomartMatch.gm_code);

  const productColumns = [
    'product_uid','glomart_code','gm_category','category_keyword','keyword','mall_code','source_mall','source_uid',
    'mall_category','mall_category_json','cp_selected_code','cp_fix_code','cp_match','product_id','item_id','vendor_item_id','pi_ii_vi','internal_product_code',
    'product_name','mall_product_name','option_count','option_json','thumb_json','detail_json','seasonal_text',
    'mall_sale_price','final_supply_price','normal_price','discount_price','delivery_fee','delivery_eta_text','delivery_type','tax_type','overseas_direct_yn',
    'review_count','mall_sales_count','certification_no_1','certification_no_2',
    'supplier_id','supplier_name','business_number','online_sales_number','ceo_name','supplier_mobile','supplier_phone','supplier_email','supplier_address',
    'product_url','thumb_origin_url','soldout_yn','hit_count','sale_status','product_grade',
    'buyable_qty','min_order_qty','max_order_qty',
    'return_available_yn','exchange_available_yn','return_policy_text','exchange_policy_text','return_shipping_fee','exchange_shipping_fee','return_period_days','exchange_period_days',
    'last_seen_at','created_at','updated_at'
  ];
  // V021: productColumns와 placeholder 순서를 1:1로 고정한다.
  // V020 오류: soldout_yn 자리에 literal 1이 들어가고, soldout 값이 hit_count에 들어가 insert가 전부 실패했다.
  const valuesSql = [
    '$1','$2','$3','$4','$5','$6','$7','$8',
    '$9','$10::jsonb','$11','$12','$13','$14','$15','$16',
    '$17','$18','$19','$20','$21','$22::jsonb','$23::jsonb','$24::jsonb',
    '$25','$26','$27','$28','$29','$30','$31','$32',
    '$33','$34','$35','$36','$37','$38','$39','$40',
    '$41','$42','$43','$44','$45','$46','$47','$48',
    '$49','$50','1','$51','$52','$53','$54','$55',
    '$56','$57','$58','$59','$60','$61','$62','$63',
    'now()','now()','now()'
  ];
  const sql = `
    INSERT INTO gm_product (${productColumns.join(', ')}) VALUES (${valuesSql.join(', ')})
    ON CONFLICT (product_uid) DO UPDATE SET
      source_mall=COALESCE(NULLIF(EXCLUDED.source_mall,''), gm_product.source_mall),
      source_uid=EXCLUDED.source_uid,
      glomart_code=CASE
        WHEN NULLIF(EXCLUDED.glomart_code,'') IS NULL THEN gm_product.glomart_code
        WHEN NULLIF(gm_product.glomart_code,'') IS NULL THEN EXCLUDED.glomart_code
        ELSE (
          SELECT string_agg(code,'|' ORDER BY first_ord)
            FROM (
              SELECT code, MIN(ord) AS first_ord
                FROM (
                  SELECT btrim(x) AS code, ord::bigint AS ord
                    FROM unnest(string_to_array(gm_product.glomart_code,'|')) WITH ORDINALITY AS t(x,ord)
                   WHERE btrim(x)<>''
                  UNION ALL
                  SELECT btrim(x) AS code, (1000000 + ord)::bigint AS ord
                    FROM unnest(string_to_array(EXCLUDED.glomart_code,'|')) WITH ORDINALITY AS t(x,ord)
                   WHERE btrim(x)<>''
                ) merged
               GROUP BY code
            ) q
        )
      END,
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
    id.uid, resolvedGlomartCode, cleanText(p.gm_category || p.gmCategory),
    categoryKeyword, searchKeyword,
    id.mallCode, sourceMallStored, sourceUid, mallCategoryStored, safeJsonString(mallCategoryJson), cpSelectedCode, cpFixCode, cpMatch,
    id.productId, id.itemId, id.vendorItemId, '', cleanText(p.internal_product_code || p.internalProductCode),
    productName, cleanDupMallProductName(productName, p.mall_product_name || p.mallProductName || ''), optionCount,
    productOptionLinkJson ? safeJsonString(productOptionLinkJson) : null, safeJsonString(thumbJson), detailJson ? safeJsonString(detailJson) : null, cleanText(p.seasonal_text || p.seasonalText || p.seasonal || ''),
    mallSalePrice, finalSupplyPrice, normalPrice, pickDiscountPrice(p),
    pickDeliveryFee(p), pickDeliveryText(p), pickDeliveryType(p), taxType,
    cleanText(p.overseas_direct_yn || p.overseasDirectYn || 'N'), pickReviewCount(p), pickMallSalesCount(p),
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
    p.exchange_period_days == null && p.exchangePeriodDays == null ? null : toInt(p.exchange_period_days || p.exchangePeriodDays, 0)
  ];
  let r;
  try{
    r = await pool.query(sql, vals);
  }catch(e){
    console.error('[GM_PRODUCT_UPSERT_SQL_ERROR]', Object.assign({ uid:id.uid, mall_code:id.mallCode, pi:id.pi, product_name:productName, vals_len:vals.length, columns:productColumns.length }, compactError(e)));
    throw e;
  }
  if(sourceUnitPriceSeen){
    try{
      // A source field was actually present in this response. Non-empty refreshes it; explicit blank clears stale source text.
      await pool.query(`UPDATE gm_product SET unit_price_text=$2, updated_at=NOW() WHERE product_uid=$1`,[id.uid,sourceUnitPriceText||null]);
    }catch(e){
      try{ console.warn('[GM_PRODUCT_UNIT_SOURCE_TEXT_WARN]', Object.assign({uid:id.uid, action:sourceUnitPriceText?'refresh':'clear', unit_price_text:sourceUnitPriceText||''}, compactError(e))); }catch(_log){}
    }
  }
  let cp_learning = null;
  try{
    cp_learning = await applyCpFixLearning(pool, { mall_code:id.mallCode, keyword:searchKeyword, cp_selected_code:cpSelectedCode, cp_fix_code:cpFixCode, cp_match:cpMatch, product_uid:id.uid });
    if(cpFixCode && searchKeyword){
      try{ await updateSearchLogCategoryByKeyword(pool, { keyword:searchKeyword, cp_selected_code:cpSelectedCode, cp_fix_code:cpFixCode }); }
      catch(_sl){ try{ console.warn('[GM_SEARCH_LOG_CATEGORY_UPDATE_FAIL]', Object.assign({ keyword:searchKeyword, cp_fix_code:cpFixCode }, compactError(_sl))); }catch(_l){} }
    }
  }catch(e){ cp_learning={ applied:false, error:compactError(e) }; }
  let option_result = { received:0, inserted:0, updated:0, skipped:0, nonactive:0, balance_ok:true, samples:[], errors:[] };
  try{
    option_result = await upsertProductOptions(pool, id, optionJson, p, parent);
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
  await saveProductKeywordMeta(pool, id.uid, id.mallCode, searchKeyword, relatedKeywords, Object.assign({}, parent || {}, p || {}));
  let unit_result = null;
  try{
    // V036: product + all options share the category comparison-unit rule.
    // Unit calculation is post-upsert only; it must never block the existing product/option save flow.
    unit_result = await recalcProductUnitByUid(pool, id.uid);
  }catch(e){
    unit_result = { ok:false, error:compactError(e) };
    try{ console.warn('[GM_PRODUCT_UNIT_V036_WARN]', Object.assign({ uid:id.uid, category_keyword:categoryKeyword }, compactError(e))); }catch(_log){}
  }
  const detail_stats = detailSignalStats(optionJson, thumbJson, detailJson || {}, p);
  return {
    ok:true,
    action:(r.rows[0] && r.rows[0].inserted) ? 'inserted' : 'updated',
    item:Object.assign({}, r.rows[0] || {}, { cp_match:cpMatch, category_dynamic, cp_learning, option_count:optionCount, option_result, detail_patch, detail_stats, unit_result })
  };
}






module.exports={upsertProduct};
