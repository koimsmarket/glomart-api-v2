const express = require('express');
const router = express.Router();
function db(req){ return req.app.locals.db || req.app.locals.pool; }
function s(v,d=null){ return v===undefined||v===null||v==='' ? d : String(v).trim(); }
function n(v,d=null){ if(v===undefined||v===null||v==='') return d; const x=Number(String(v).replace(/,/g,'')); return Number.isFinite(x)?x:d; }
function key(b){ return s(b.pi_ii_vi) || [s(b.product_id||b.productId,''),s(b.item_id||b.itemId,''),s(b.vendor_item_id||b.vendorItemId,'')].join('_'); }
router.post('/api/product/upsert', async (req,res)=>{
  const pool=db(req), b=req.body||{};
  if(!pool) return res.status(500).json({ok:false,error:'DB pool is not attached'});
  const pi=key(b), uid=s(b.product_uid) || `${s(b.mall_code,'CPKR').toUpperCase()}_${pi}`;
  if(!pi) return res.status(400).json({ok:false,error:'pi_ii_vi is required'});
  const sql=`INSERT INTO gm_product (
    product_uid, glomart_code, gm_category, category_keyword, mall_code, mall_category,
    product_id, item_id, vendor_item_id, pi_ii_vi, internal_product_code,
    product_name, brand_name, option_name, option_value, option_display_name,
    mall_sale_price, customer_sale_price, final_supply_price, currency,
    delivery_type, delivery_fee, estimated_arrival_text,
    supplier_id, supplier_name_snapshot, business_number_snapshot, online_sales_number_snapshot,
    ceo_name_snapshot, supplier_mobile_snapshot, supplier_phone_snapshot, supplier_email_snapshot, supplier_address_snapshot,
    product_url, thumbnail_url, sale_status, collect_status, collect_error,
    sale_unit_text, unit_price_text, unit_price_value, unit_base_qty, unit_base_unit,
    unit_norm_qty, unit_norm_unit, unit_norm_price, unit_parse_status, unit_sortable_yn,
    last_collected_at, created_at, updated_at
  ) VALUES (
    $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
    $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,
    $39,$40,$41,$42,$43,$44,$45,$46,$47,NOW(),NOW(),NOW()
  )
  ON CONFLICT (product_uid) DO UPDATE SET
    product_name=EXCLUDED.product_name, option_name=EXCLUDED.option_name, option_value=EXCLUDED.option_value,
    mall_sale_price=EXCLUDED.mall_sale_price, customer_sale_price=EXCLUDED.customer_sale_price,
    final_supply_price=EXCLUDED.final_supply_price, delivery_type=EXCLUDED.delivery_type, delivery_fee=EXCLUDED.delivery_fee,
    estimated_arrival_text=EXCLUDED.estimated_arrival_text, supplier_id=EXCLUDED.supplier_id,
    supplier_name_snapshot=EXCLUDED.supplier_name_snapshot, product_url=EXCLUDED.product_url, thumbnail_url=EXCLUDED.thumbnail_url,
    sale_status=EXCLUDED.sale_status, collect_status=EXCLUDED.collect_status, collect_error=EXCLUDED.collect_error,
    sale_unit_text=EXCLUDED.sale_unit_text, unit_price_text=EXCLUDED.unit_price_text, unit_price_value=EXCLUDED.unit_price_value,
    unit_base_qty=EXCLUDED.unit_base_qty, unit_base_unit=EXCLUDED.unit_base_unit, unit_norm_qty=EXCLUDED.unit_norm_qty,
    unit_norm_unit=EXCLUDED.unit_norm_unit, unit_norm_price=EXCLUDED.unit_norm_price,
    unit_parse_status=EXCLUDED.unit_parse_status, unit_sortable_yn=EXCLUDED.unit_sortable_yn,
    last_collected_at=NOW(), updated_at=NOW()
  RETURNING *`;
  const p=[
    uid,s(b.glomart_code),s(b.gm_category),s(b.category_keyword),s(b.mall_code,'CPKR').toUpperCase(),s(b.mall_category),
    s(b.product_id||b.productId),s(b.item_id||b.itemId),s(b.vendor_item_id||b.vendorItemId),pi,s(b.internal_product_code),
    s(b.product_name||b.title,''),s(b.brand_name),s(b.option_name),s(b.option_value),s(b.option_display_name),
    n(b.mall_sale_price??b.price,0),n(b.customer_sale_price??b.price,0),n(b.final_supply_price),s(b.currency,'KRW'),
    s(b.delivery_type),n(b.delivery_fee,0),s(b.estimated_arrival_text||b.arrival_text),
    s(b.supplier_id),s(b.supplier_name_snapshot||b.supplier_name),s(b.business_number_snapshot),s(b.online_sales_number_snapshot),
    s(b.ceo_name_snapshot),s(b.supplier_mobile_snapshot),s(b.supplier_phone_snapshot),s(b.supplier_email_snapshot),s(b.supplier_address_snapshot),
    s(b.product_url||b.url),s(b.thumbnail_url||b.image),s(b.sale_status,'active'),s(b.collect_status,'ok'),s(b.collect_error),
    s(b.sale_unit_text),s(b.unit_price_text),n(b.unit_price_value),n(b.unit_base_qty),s(b.unit_base_unit),
    n(b.unit_norm_qty),s(b.unit_norm_unit),n(b.unit_norm_price),s(b.unit_parse_status,'failed'),s(b.unit_sortable_yn,'N')
  ];
  try{ const r=await pool.query(sql,p); res.json({ok:true,product:r.rows[0]}); }
  catch(e){ res.status(500).json({ok:false,error:e.message}); }
});
module.exports=router;
