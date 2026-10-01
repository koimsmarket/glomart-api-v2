'use strict';
// GM_PRODUCT_SPLIT_V003_DETAIL
const {cleanText,parseMoney,pickBuyableQty,safeJsonString,isStandardCoupangSupplier,pickSupplierId,pickSupplierName,pickAny,pickMinOrderQty,pickMaxOrderQty,normalizeUrl,collectPayloadContainers,parseMaybeJsonAny}=require('./shared');
const {pickCpSelectedCode,pickCpFixCode}=require('../category');
const {normalizeMallCategoryJson,pickMallCategoryLeaf}=require('./search_category');
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
      updated_at = now()
    WHERE product_uid = $1 OR (mall_code=$27 AND pi_ii_vi=$28)
    RETURNING product_uid, option_count, jsonb_typeof(thumb_json) AS thumb_type,
      CASE WHEN jsonb_typeof(thumb_json)='array' THEN jsonb_array_length(thumb_json) ELSE 0 END AS thumb_count,
      COALESCE(NULLIF(detail_json->>'image_count','')::int,0) AS detail_image_count,
      COALESCE(NULLIF(detail_json->>'block_count','')::int,0) AS detail_block_count,
      supplier_name, cp_fix_code, cp_match, buyable_qty, return_shipping_fee
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
    cleanText(id.mallCode || ''), cleanText(id.pi || '')
  ];
  const r = await pool.query(q, vals);
  return { applied:r.rowCount > 0, row:r.rows[0] || null, stats, match:{ product_uid:id.uid, mall_code:id.mallCode, pi_ii_vi:id.pi } };
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

module.exports={detailSignalStats,applyDetailPatch,normalizeThumbJson,normalizeDetailJson};
