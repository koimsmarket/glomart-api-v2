'use strict';
const express = require('express');
const router = express.Router();
const VERSION = 'GM_SEARCH_LOCAL_V001';
function db(req){ return req.app.locals.db || req.app.locals.pool; }
function C(v){ return String(v == null ? '' : v).replace(/[\u00A0\u200B-\u200D\uFEFF]/g,' ').replace(/\s+/g,' ').trim(); }
function toInt(v,d){ const n=Number(v); return Number.isFinite(n)?Math.trunc(n):d; }
function won(v){ const n=Number(v||0); return n>0 ? Math.round(n).toLocaleString('ko-KR')+'원' : ''; }
router.get('/api/gm/search/local', async (req,res)=>{
  const pool=db(req); if(!pool) return res.status(500).json({ok:false,version:VERSION,error:'DB pool is not attached'});
  const keyword=C(req.query.keyword||req.query.q||'');
  const limit=Math.max(1,Math.min(200,toInt(req.query.limit,150)||150));
  if(!keyword) return res.json({ok:true,version:VERSION,keyword:'',count:0,items:[],groups:{CPKR:0,ALKR:0}});
  try{
    const r=await pool.query(`
      WITH ranked AS (
        SELECT product_uid,mall_code,product_id,item_id,vendor_item_id,pi_ii_vi,
               product_name,mall_product_name,keyword,category_keyword,
               mall_sale_price,final_supply_price,normal_price,discount_price,
               delivery_fee,delivery_eta_text,delivery_type,review_count,mall_sales_count,
               product_grade,product_url,thumb_origin_url,soldout_yn,sale_status,
               hit_count,last_seen_at,updated_at,
               ROW_NUMBER() OVER (
                 PARTITION BY mall_code
                 ORDER BY
                   CASE WHEN BTRIM(COALESCE(keyword,''))=$1 THEN 0
                        WHEN BTRIM(COALESCE(category_keyword,''))=$1 THEN 1
                        WHEN COALESCE(product_name,'') ILIKE $1 || '%' THEN 2
                        ELSE 3 END,
                   COALESCE(hit_count,0) DESC,
                   COALESCE(updated_at,last_seen_at) DESC NULLS LAST
               ) AS rn
        FROM gm_product
        WHERE mall_code IN ('CPKR','ALKR')
          AND COALESCE(sale_status,'active')='active'
          AND COALESCE(soldout_yn,'N')<>'Y'
          AND (
            BTRIM(COALESCE(keyword,'')) = $1 OR
            BTRIM(COALESCE(category_keyword,'')) = $1 OR
            COALESCE(product_name,'') ILIKE '%' || $1 || '%' OR
            COALESCE(mall_product_name,'') ILIKE '%' || $1 || '%'
          )
      )
      SELECT * FROM ranked WHERE rn <= $2
      ORDER BY mall_code, rn
    `,[keyword,limit]);
    const items=(r.rows||[]).map(x=>({
      product_uid:x.product_uid,mall_code:x.mall_code,
      productId:x.product_id,itemId:x.item_id,vendorItemId:x.vendor_item_id,pi_ii_vi:x.pi_ii_vi,
      productName:x.product_name,title:x.product_name,mall_product_name:x.mall_product_name,
      keyword:x.keyword,category_keyword:x.category_keyword,
      mall_sale_price:x.mall_sale_price,final_supply_price:x.final_supply_price,normal_price:x.normal_price,discount_price:x.discount_price,
      priceText:won(x.mall_sale_price||x.final_supply_price||x.normal_price),
      delivery_fee:x.delivery_fee,shippingFeeText:(Number(x.delivery_fee||0)>0?won(x.delivery_fee):'무료배송'),
      deliveryEtaText:x.delivery_eta_text,deliveryType:x.delivery_type,
      reviewCount:x.review_count,mall_sales_count:x.mall_sales_count,rating:x.product_grade,
      product_url:x.product_url||'',image:x.thumb_origin_url||'',thumb_origin_url:x.thumb_origin_url||'',
      __gm_server_local:1
    }));
    const groups={CPKR:0,ALKR:0}; items.forEach(x=>{if(groups[x.mall_code]!=null)groups[x.mall_code]++;});
    console.log('[GM_SEARCH_LOCAL]',{keyword,count:items.length,groups});
    res.json({ok:true,version:VERSION,keyword,count:items.length,groups,items});
  }catch(e){
    console.error('[GM_SEARCH_LOCAL_ERROR]',{keyword,error:String(e&&e.stack||e)});
    res.status(500).json({ok:false,version:VERSION,error:'local search failed'});
  }
});
module.exports=router;
