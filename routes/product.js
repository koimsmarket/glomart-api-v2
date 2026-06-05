const express = require('express');
const router = express.Router();
function db(req){ return req.app.locals.db || req.app.locals.pool; }
function cleanText(v){ return String(v || '').replace(/[\u00A0\u200B-\u200D\uFEFF]/g, ' ').replace(/\s+/g, ' ').trim(); }
function toInt(v, def=0){ const n = Number(String(v ?? '').replace(/[^0-9.-]/g,'')); return Number.isFinite(n) ? Math.round(n) : def; }
function normalizeUrl(url){ url = cleanText(url); if(url.startsWith('//')) return 'https:' + url; return url; }
function fail(res, status, message, extra={}){ res.status(status).json({ ok:false, error:message, ...extra }); }
function ok(res, data){ res.json({ ok:true, ...data }); }
function ids(b){
  const productId = cleanText(b.product_id || b.productId);
  const itemId = cleanText(b.item_id || b.itemId);
  const vendorItemId = cleanText(b.vendor_item_id || b.vendorItemId || b.venderItemId);
  const mallCode = cleanText(b.mall_code || b.mallCode || 'CPKR').toUpperCase();
  const pi = cleanText(b.pi_ii_vi || [productId,itemId,vendorItemId].filter(Boolean).join('_'));
  const uid = cleanText(b.product_uid || (mallCode && pi ? `${mallCode}_${pi}` : ''));
  return { productId, itemId, vendorItemId, mallCode, pi, uid };
}

router.post(['/api/gm/product/upsert','/api/product/upsert'], async (req,res)=>{
  const pool=db(req), p=req.body||{};
  if(!pool) return fail(res, 500, 'DB pool is not attached');
  const id = ids(p);
  const productName = cleanText(p.product_name || p.productName || p.title);
  if(!id.uid || !id.pi || !id.mallCode || !productName) return fail(res, 400, 'product_uid/pi_ii_vi/mall_code/product_name required');
  const sql=`
    INSERT INTO gm_product (
      product_uid, glomart_code, gm_category, category_keyword, mall_code, mall_category,
      product_id, item_id, vendor_item_id, pi_ii_vi, internal_product_code,
      product_name, mall_product_name, option_count, option_name, option_value,
      origin_country, mall_sale_price, final_supply_price, normal_price, discount_price,
      delivery_fee, delivery_eta_text, delivery_type, tax_type, overseas_direct_yn,
      supplier_id, supplier_name_snapshot, product_url, thumb_origin_url, thumb_file_name,
      soldout_yn, hit_count, detail_view_count, cart_count, wish_count, order_count, order_qty_total,
      sale_status, last_seen_at, expire_at, created_at, updated_at
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,
      1,0,0,0,0,0,$33,now(),now() + INTERVAL '30 days',now(),now()
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
      hit_count=COALESCE(gm_product.hit_count,0)+1,
      last_seen_at=now(),
      expire_at=now() + INTERVAL '30 days',
      updated_at=now()
    RETURNING product_uid, pi_ii_vi, hit_count
  `;
  const vals=[
    id.uid, cleanText(p.glomart_code || p.glomartCode), cleanText(p.gm_category || p.gmCategory),
    cleanText(p.category_keyword || p.categoryKeyword), id.mallCode, cleanText(p.mall_category || p.mallCategory),
    id.productId, id.itemId, id.vendorItemId, id.pi, cleanText(p.internal_product_code),
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
  ];
  try{ const r=await pool.query(sql, vals); ok(res,{item:r.rows[0]}); }
  catch(e){ fail(res,500,'product upsert failed',{detail:String(e && e.message || e)}); }
});

router.post(['/api/gm/product/event','/api/gm/product/wish','/api/gm/product/order'], async (req,res)=>{
  const pool=db(req), p=req.body||{};
  if(!pool) return fail(res, 500, 'DB pool is not attached');
  const id = ids(p);
  let type = cleanText(p.type || p.event_type || p.eventType).toLowerCase();
  if(!type && req.path.endsWith('/wish')) type = 'wish';
  if(!type && req.path.endsWith('/order')) type = 'order';
  const qty = Math.max(1, toInt(p.quantity || p.qty, 1));
  if(!id.uid && (!id.mallCode || !id.pi)) return fail(res, 400, 'product_uid or mall_code+pi_ii_vi required');
  const where = id.uid ? 'product_uid=$1' : 'mall_code=$1 AND pi_ii_vi=$2';
  const vals = id.uid ? [id.uid] : [id.mallCode, id.pi];
  let setSql = '';
  if(type === 'detail') setSql = "detail_view_count=COALESCE(detail_view_count,0)+1, expire_at=GREATEST(COALESCE(expire_at, now()), now() + INTERVAL '90 days')";
  else if(type === 'cart') setSql = "cart_count=COALESCE(cart_count,0)+1, last_cart_at=now(), expire_at=GREATEST(COALESCE(expire_at, now()), now() + INTERVAL '180 days')";
  else if(type === 'wish') setSql = "wish_count=COALESCE(wish_count,0)+1, last_wish_at=now(), expire_at=GREATEST(COALESCE(expire_at, now()), now() + INTERVAL '180 days')";
  else if(type === 'order') setSql = "order_count=COALESCE(order_count,0)+1, order_qty_total=COALESCE(order_qty_total,0)+" + qty + ", last_order_at=now(), expire_at=GREATEST(COALESCE(expire_at, now()), now() + INTERVAL '730 days')";
  else return fail(res, 400, 'event type must be detail/cart/wish/order');
  try{
    const r=await pool.query(`UPDATE gm_product SET ${setSql}, updated_at=now() WHERE ${where} RETURNING product_uid, pi_ii_vi`, vals);
    ok(res,{action:'product.event', type, updated:r.rowCount, item:r.rows[0] || null});
  }catch(e){ fail(res,500,'product event failed',{detail:String(e && e.message || e)}); }
});

module.exports=router;
