'use strict';
const express = require('express');
const router = express.Router();
const VERSION = 'GM_SEARCH_LOCAL_V004_PRIORITY_EXACT';
function db(req){ return req.app.locals.db || req.app.locals.pool; }
function C(v){ return String(v == null ? '' : v).replace(/[\u00A0\u200B-\u200D\uFEFF]/g,' ').replace(/\s+/g,' ').trim(); }
function toInt(v,d){ const n=Number(v); return Number.isFinite(n)?Math.trunc(n):d; }
function won(v){ const n=Number(v||0); return n>0 ? Math.round(n).toLocaleString('ko-KR')+'원' : ''; }
function ms(t){ return Date.now()-t; }

const PRODUCT_COLS=`
  product_uid,mall_code,product_id,item_id,vendor_item_id,pi_ii_vi,glomart_code,
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

function categoryScopePrefix(code){
  const parts=C(code).toUpperCase().split('-');
  if(parts.length!==5&&parts.length!==6) return '';
  let last=0;
  for(let i=1;i<parts.length;i++) if(!/^0+$/.test(parts[i])) last=i;
  return parts.slice(0,last+1).join('-');
}
async function categoryStage(pool,categoryCode,virtualKeyword,limit){
  categoryCode=C(categoryCode).toUpperCase(); virtualKeyword=C(virtualKeyword);
  const prefix=categoryScopePrefix(categoryCode);
  if(!categoryCode||!prefix) return {rows:[],scope_codes:[]};
  const cq=await pool.query(`SELECT gm_code FROM gm_category WHERE COALESCE(display_yn,'Y')='Y' AND (gm_code=$1 OR gm_code LIKE $2) ORDER BY depth,gm_code`,[categoryCode,prefix+'-%']);
  const scopeCodes=(cq.rows||[]).map(r=>C(r.gm_code).toUpperCase()).filter(Boolean);
  if(!scopeCodes.includes(categoryCode)) scopeCodes.unshift(categoryCode);
  const params=[scopeCodes,limit];
  let virtualSql='';
  if(virtualKeyword){params.push(virtualKeyword);virtualSql=` AND (keyword=$3 OR category_keyword=$3)`;}
  const q=await pool.query(`
    WITH ranked AS (
      SELECT ${PRODUCT_COLS},
             ROW_NUMBER() OVER (PARTITION BY mall_code ORDER BY COALESCE(hit_count,0) DESC,COALESCE(updated_at,last_seen_at) DESC NULLS LAST) AS rn
      FROM gm_product
      WHERE ${ACTIVE_WHERE}
        AND string_to_array(COALESCE(glomart_code,''),'|') && $1::text[]
        ${virtualSql}
    )
    SELECT * FROM ranked WHERE rn <= $2 ORDER BY mall_code,rn
  `,params);
  return {rows:q.rows||[],scope_codes:scopeCodes};
}


router.get('/api/gm/search/local', async (req,res)=>{
  const pool=db(req); if(!pool) return res.status(500).json({ok:false,version:VERSION,error:'DB pool is not attached'});
  const keyword=C(req.query.keyword||req.query.q||'');
  const categoryCode=C(req.query.category_code||req.query.gm_category_code||'').toUpperCase();
  const categoryVirtualKeyword=C(req.query.category_keyword||'');
  const categorySearch=C(req.query.category_search)==='1'&&!!categoryCode;
  const limit=Math.max(1,Math.min(200,toInt(req.query.limit,150)||150));
  if(!keyword&&!categorySearch) return res.json({ok:true,version:VERSION,keyword:'',count:0,items:[],groups:{CPKR:0,ALKR:0}});

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
    if(categorySearch){
      const t=Date.now();
      const categoryResult=await categoryStage(pool,categoryCode,categoryVirtualKeyword,limit);
      merge(categoryResult.rows);
      const categoryCodeMs=ms(t);
      const rows=[...byMall.CPKR,...byMall.ALKR];
      const items=rows.map(x=>({
        product_uid:x.product_uid,mall_code:x.mall_code,glomart_code:x.glomart_code,
        productId:x.product_id,itemId:x.item_id,vendorItemId:x.vendor_item_id,pi_ii_vi:x.pi_ii_vi,
        productName:x.product_name,title:x.product_name,mall_product_name:x.mall_product_name,keyword:x.keyword,category_keyword:x.category_keyword,
        mall_sale_price:x.mall_sale_price,final_supply_price:x.final_supply_price,normal_price:x.normal_price,discount_price:x.discount_price,
        priceText:won(x.mall_sale_price||x.final_supply_price||x.normal_price),delivery_fee:x.delivery_fee,shippingFeeText:(Number(x.delivery_fee||0)>0?won(x.delivery_fee):'무료배송'),
        deliveryEtaText:x.delivery_eta_text,deliveryType:x.delivery_type,reviewCount:x.review_count,mall_sales_count:x.mall_sales_count,rating:x.product_grade,
        product_url:x.product_url||'',image:x.thumb_origin_url||'',thumb_origin_url:x.thumb_origin_url||'',__gm_server_local:1,__gm_category_code_search:1
      }));
      const groups={CPKR:byMall.CPKR.length,ALKR:byMall.ALKR.length};
      console.log('[GM_SEARCH_LOCAL_CATEGORY_CODE]',{version:VERSION,category_code:categoryCode,virtual_keyword:categoryVirtualKeyword||'',scope_count:categoryResult.scope_codes.length,count:items.length,groups,timing_ms:{category_code:categoryCodeMs,total:ms(totalStarted)}});
      return res.json({ok:true,version:VERSION,keyword,category_search:true,category_code:categoryCode,category_keyword:categoryVirtualKeyword||'',scope_count:categoryResult.scope_codes.length,count:items.length,groups,items});
    }

    // PRIORITY EXACT: 두 인덱스 조회는 서로 독립이므로 병렬 실행한다.
    // 결과 병합 순서는 keyword -> category_keyword로 유지해 기존 우선순위를 보존한다.
    const exactStarted=Date.now();
    const [exactKeyword,exactCategory]=await Promise.all([
      exactStage(pool,'keyword',keyword,limit),
      exactStage(pool,'category_keyword',keyword,limit)
    ]);
    const exactParallelMs=ms(exactStarted);
    merge(exactKeyword.rows);
    merge(exactCategory.rows);

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
      timing_ms:{exact_parallel:exactParallelMs,total:ms(totalStarted)},
      exact_only:true,need_malls:needMalls()
    });
    res.json({ok:true,version:VERSION,keyword,count:items.length,groups,items});
  }catch(e){
    console.error('[GM_SEARCH_LOCAL_ERROR]',{version:VERSION,keyword,elapsed_ms:ms(totalStarted),error:String(e&&e.stack||e)});
    res.status(500).json({ok:false,version:VERSION,error:'local search failed'});
  }
});
module.exports=router;
