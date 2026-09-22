'use strict';
const express = require('express');
const router = express.Router();
const VERSION = 'GM_SEARCH_LOCAL_V002_EXACT_FIRST';
function db(req){ return req.app.locals.db || req.app.locals.pool; }
function C(v){ return String(v == null ? '' : v).replace(/[\u00A0\u200B-\u200D\uFEFF]/g,' ').replace(/\s+/g,' ').trim(); }
function toInt(v,d){ const n=Number(v); return Number.isFinite(n)?Math.trunc(n):d; }
function won(v){ const n=Number(v||0); return n>0 ? Math.round(n).toLocaleString('ko-KR')+'원' : ''; }
function ms(t){ return Date.now()-t; }

const PRODUCT_COLS=`
  product_uid,mall_code,product_id,item_id,vendor_item_id,pi_ii_vi,
  product_name,mall_product_name,keyword,category_keyword,
  mall_sale_price,final_supply_price,normal_price,discount_price,
  delivery_fee,delivery_eta_text,delivery_type,review_count,mall_sales_count,
  product_grade,product_url,thumb_origin_url,soldout_yn,sale_status,
  hit_count,last_seen_at,updated_at
`;
const ACTIVE_WHERE=`
  mall_code IN ('CPKR','ALKR')
  AND COALESCE(sale_status,'active')='active'
  AND COALESCE(soldout_yn,'N')<>'Y'
`;

async function exactStage(pool,column,keyword,limit){
  return pool.query(`
    WITH ranked AS (
      SELECT ${PRODUCT_COLS},
             ROW_NUMBER() OVER (
               PARTITION BY mall_code
               ORDER BY COALESCE(hit_count,0) DESC,
                        COALESCE(updated_at,last_seen_at) DESC NULLS LAST
             ) AS rn
      FROM gm_product
      WHERE ${ACTIVE_WHERE}
        AND ${column} = $1
    )
    SELECT * FROM ranked WHERE rn <= $2
    ORDER BY mall_code, rn
  `,[keyword,limit]);
}

async function fallbackStage(pool,keyword,limit,malls){
  if(!malls.length) return {rows:[]};
  return pool.query(`
    WITH ranked AS (
      SELECT ${PRODUCT_COLS},
             ROW_NUMBER() OVER (
               PARTITION BY mall_code
               ORDER BY
                 CASE WHEN COALESCE(product_name,'') ILIKE $1 || '%' THEN 0 ELSE 1 END,
                 COALESCE(hit_count,0) DESC,
                 COALESCE(updated_at,last_seen_at) DESC NULLS LAST
             ) AS rn
      FROM gm_product
      WHERE ${ACTIVE_WHERE}
        AND mall_code = ANY($3::text[])
        AND (
          COALESCE(product_name,'') ILIKE '%' || $1 || '%' OR
          COALESCE(mall_product_name,'') ILIKE '%' || $1 || '%'
        )
    )
    SELECT * FROM ranked WHERE rn <= $2
    ORDER BY mall_code, rn
  `,[keyword,limit,malls]);
}

router.get('/api/gm/search/local', async (req,res)=>{
  const pool=db(req); if(!pool) return res.status(500).json({ok:false,version:VERSION,error:'DB pool is not attached'});
  const keyword=C(req.query.keyword||req.query.q||'');
  const limit=Math.max(1,Math.min(200,toInt(req.query.limit,150)||150));
  if(!keyword) return res.json({ok:true,version:VERSION,keyword:'',count:0,items:[],groups:{CPKR:0,ALKR:0}});

  const totalStarted=Date.now();
  const byMall={CPKR:[],ALKR:[]};
  const seen=new Set();
  function merge(rows){
    for(const row of rows||[]){
      const mall=C(row.mall_code).toUpperCase();
      if(!byMall[mall] || byMall[mall].length>=limit) continue;
      const uid=C(row.product_uid);
      if(!uid || seen.has(uid)) continue;
      seen.add(uid);
      byMall[mall].push(row);
    }
  }
  function needMalls(){
    return ['CPKR','ALKR'].filter(m=>byMall[m].length<limit);
  }

  try{
    let t=Date.now();
    const exactKeyword=await exactStage(pool,'keyword',keyword,limit);
    merge(exactKeyword.rows);
    const keywordMs=ms(t);

    let categoryMs=0;
    if(needMalls().length){
      t=Date.now();
      const exactCategory=await exactStage(pool,'category_keyword',keyword,limit);
      merge(exactCategory.rows);
      categoryMs=ms(t);
    }

    let fallbackMs=0;
    const fallbackMalls=needMalls();
    if(fallbackMalls.length){
      t=Date.now();
      const fallback=await fallbackStage(pool,keyword,limit,fallbackMalls);
      merge(fallback.rows);
      fallbackMs=ms(t);
    }

    const rows=[...byMall.CPKR,...byMall.ALKR];
    const items=rows.map(x=>({
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
    const groups={CPKR:byMall.CPKR.length,ALKR:byMall.ALKR.length};
    console.log('[GM_SEARCH_LOCAL]',{
      version:VERSION,keyword,count:items.length,groups,
      timing_ms:{exact_keyword:keywordMs,exact_category:categoryMs,fallback_ilike:fallbackMs,total:ms(totalStarted)},
      fallback_malls:fallbackMalls
    });
    res.json({ok:true,version:VERSION,keyword,count:items.length,groups,items});
  }catch(e){
    console.error('[GM_SEARCH_LOCAL_ERROR]',{version:VERSION,keyword,elapsed_ms:ms(totalStarted),error:String(e&&e.stack||e)});
    res.status(500).json({ok:false,version:VERSION,error:'local search failed'});
  }
});
module.exports=router;
