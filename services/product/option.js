'use strict';
// GM_PRODUCT_SPLIT_V003_OPTION
const {cleanText,parseMoney,parseMaybeJsonAny,collectPayloadContainers,normalizeUrl,pickPrice,pickNormalPrice,pickDeliveryType,pickDeliveryFee,pickDeliveryText,pickBuyableQty,pickMinOrderQty,pickMaxOrderQty,compactError,toInt}=require('./shared');
function pickOptPrice(row, names){
  row=row||{};
  for(const n of names){
    if(row[n] !== undefined && row[n] !== null && cleanText(row[n]) !== '') return parseMoney(row[n], 0);
  }
  return 0;
}

function nullableQty(v){
  if(v === undefined || v === null || cleanText(v) === '') return null;
  const n = toInt(v, -1);
  return n >= 0 ? n : null;
}
function optionBuyableQty(row){
  row=row||{};
  const direct = nullableQty(row.buyable_qty !== undefined ? row.buyable_qty : (row.buyableQty !== undefined ? row.buyableQty : (row.stock_qty !== undefined ? row.stock_qty : row.stockQty)));
  if(direct !== null) return direct;
  const text = cleanText(row.stockText || row.stock_text || row.soldoutText || row.statusText || row.rawText || '');
  let m = text.match(/(\d[\d,]*)\s*개\s*(?:남음|남았|재고)/);
  if(!m) m = text.match(/(?:재고|수량)\s*[:：]?\s*(\d[\d,]*)/);
  return m ? nullableQty(String(m[1]).replace(/,/g,'')) : null;
}
function isDetailOptionPayload(p,parent){
  const src = cleanText((p&& (p.source || p.collector_source || p.collectorSource || p.context || p.from || p.origin)) || (parent&& (parent.source || parent.context || parent.from)) || '').toLowerCase();
  if(src.indexOf('detail') >= 0 || src.indexOf('collector') >= 0) return true;
  return !!(p && (p.detail_json || p.detailJson || p.detailBlocks || p.detailImages || p.__gmStrictOptionSource));
}
function optionPi(o){return [cleanText(o&&o.product_id),cleanText(o&&o.item_id),cleanText(o&&o.vendor_item_id)].filter(Boolean).join('_');}
function optionIsRepresentativeCandidate(o){
  if(!o) return false;
  if(cleanText(o.active_yn).toUpperCase()==='N') return false;
  if(cleanText(o.soldout_yn).toUpperCase()==='Y') return false;
  const sale=cleanText(o.sale_status).toLowerCase();
  if(sale==='inactive'||sale==='soldout') return false;
  if(o.buyable_qty !== null && o.buyable_qty !== undefined && Number(o.buyable_qty) <= 0) return false;
  return true;
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

  const headers=['uid','product_id','item_id','vendor_item_id','option_name','mall_price','normal_price','delivery_badge','delivery_fee','delivery_eta_text','option_image_url','soldout_yn','source','buyable_qty'];
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
      pushRow([uid,productId0,itemId0,vendorItemId0,name0,parseMoney(r[5],0),parseMoney(r[6],0),cleanText(r[7]||''),parseMoney(r[8],0),cleanText(r[9]||''),normalizeUrl(r[10]||''),!!r[11],cleanText(r[12]||''),nullableQty(r[13])]);
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
    pushRow([uid,productId,itemId,vendorItemId,name,mallPrice,normalPrice,badgeText,fee,cleanText(r.delivery_eta_text || r.deliveryEtaText || r.deliveryDateText || r.arrivalText || r.etaText || p.deliveryDateText || p.arrivalText || ''),img,sold,cleanText(r.source || ''),optionBuyableQty(r)]);
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
      'search-row', pickBuyableQty(p)
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
      buyable_qty: nullableQty(r[13]) !== null ? nullableQty(r[13]) : pickBuyableQty(p),
      min_order_qty: pickMinOrderQty(p),
      max_order_qty: pickMaxOrderQty(p)
    });
  });
  return out;
}

async function syncCoupangRepresentative(pool,id,optionRows,p,parent){
  const result={applied:false,changed:false,representative_pi:'',removed_duplicate:0,reason:''};
  const mall=cleanText(id&&id.mallCode).toUpperCase();
  if(mall!=='CPKR'){result.reason='not_coupang';return result;}
  if(!isDetailOptionPayload(p,parent)){result.reason='not_detail_payload';return result;}
  const rows=(Array.isArray(optionRows)?optionRows:[]).filter(o=>cleanText(o&&o.product_id)===cleanText(id&&id.productId));
  if(!rows.length){result.reason='no_option_rows';return result;}
  const qr=await pool.query(`SELECT product_uid,product_id,item_id,vendor_item_id FROM gm_product WHERE product_uid=$1 AND mall_code='CPKR' LIMIT 1`,[cleanText(id.uid)]);
  const current=qr.rows&&qr.rows[0];
  if(!current){result.reason='product_row_missing';return result;}
  const currentPi=[cleanText(current.product_id),cleanText(current.item_id),cleanText(current.vendor_item_id)].filter(Boolean).join('_');
  const openedPi=[cleanText(id.productId),cleanText(id.itemId),cleanText(id.vendorItemId)].filter(Boolean).join('_');
  const candidates=rows.filter(optionIsRepresentativeCandidate);
  let representative=candidates.find(o=>optionPi(o)===currentPi)||null;
  if(!representative){
    representative=candidates.find(o=>optionPi(o)===openedPi)||null;
    if(!representative){
      representative=candidates.slice().sort((a,b)=>{
        const aq=(a.buyable_qty===null||a.buyable_qty===undefined)?Number.POSITIVE_INFINITY:Number(a.buyable_qty);
        const bq=(b.buyable_qty===null||b.buyable_qty===undefined)?Number.POSITIVE_INFINITY:Number(b.buyable_qty);
        if(aq!==bq)return aq-bq;
        return Number(a.option_sort_no||0)-Number(b.option_sort_no||0);
      })[0]||null;
    }
  }
  if(!representative){result.reason='no_buyable_candidate';return result;}
  const repPi=optionPi(representative);
  const changed=repPi!==currentPi;
  await pool.query(`
    UPDATE gm_product SET
      product_id=$2,item_id=$3,vendor_item_id=$4,
      mall_sale_price=$5,
      final_supply_price=COALESCE($6,final_supply_price),
      normal_price=COALESCE($7,normal_price),
      discount_price=$8,
      delivery_fee=$9,
      delivery_eta_text=$10,
      delivery_type=$11,
      soldout_yn='N',sale_status='active',
      buyable_qty=COALESCE($12,buyable_qty),
      thumb_origin_url=COALESCE(NULLIF($13,''),thumb_origin_url),
      updated_at=now()
    WHERE product_uid=$1 AND mall_code='CPKR' AND product_id=$2
  `,[cleanText(id.uid),cleanText(representative.product_id),cleanText(representative.item_id),cleanText(representative.vendor_item_id),
      representative.mall_sale_price,representative.final_supply_price,representative.normal_price,representative.discount_price,
      representative.delivery_fee,cleanText(representative.delivery_eta_text),cleanText(representative.delivery_type),
      representative.buyable_qty,cleanText(representative.option_image_url)]);
  const dr=await pool.query(`DELETE FROM gm_product_option WHERE mall_code='CPKR' AND product_id=$1 AND pi_ii_vi=$2`,[cleanText(representative.product_id),repPi]);
  result.applied=true;result.changed=changed;result.representative_pi=repPi;result.removed_duplicate=dr.rowCount||0;
  result.reason=changed?'representative_replaced':'representative_kept';
  try{console.log('[GM_CPKR_REPRESENTATIVE_SYNC]',{product_uid:id.uid,old_pi:currentPi,new_pi:repPi,changed,removed_duplicate:result.removed_duplicate,buyable_qty:representative.buyable_qty});}catch(_e){}
  return result;
}

async function upsertProductOptions(pool, id, optionJson, p, parent){
  const result = { received:0, inserted:0, updated:0, skipped:0, nonactive:0, balance_ok:true, samples:[], errors:[], representative:null };
  const detailPayload=isDetailOptionPayload(p,parent);
  const optionRows = optionRowsFromOptionJson(optionJson, id, p);
  result.received = optionRows.length;
  if(!optionRows.length) return result;
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
  if(seen.size > 1 || (detailPayload && seen.size >= 1)){
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
  if(detailPayload && optionRows.length){
    try{result.representative=await syncCoupangRepresentative(pool,id,optionRows,p,parent);}
    catch(e){result.representative={applied:false,error:compactError(e)};result.errors.push(compactError(e));}
  }
  result.balance_ok = result.received === (result.inserted + result.updated + result.skipped);
  return result;
}


module.exports={parseMaybeJsonObject,normalizeOptionJson,makeEmptyOptionJson,makeProductOptionLinkJson,normalizeSoldoutYn,optionRowsFromOptionJson,syncCoupangRepresentative,upsertProductOptions};
