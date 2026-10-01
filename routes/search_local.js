'use strict';
const express = require('express');
const router = express.Router();
const VERSION = 'GM_SEARCH_LOCAL_V007_NORMAL_PRICE_ONLY';
function db(req){ return req.app.locals.db || req.app.locals.pool; }
function C(v){ return String(v == null ? '' : v).replace(/[\u00A0\u200B-\u200D\uFEFF]/g,' ').replace(/\s+/g,' ').trim(); }
function toInt(v,d){ const n=Number(v); return Number.isFinite(n)?Math.trunc(n):d; }
function won(v){ const n=Number(v||0); return n>0 ? Math.round(n).toLocaleString('ko-KR')+'원' : ''; }
function ms(t){ return Date.now()-t; }
function publicUnitPriceText(value,qty,unit){ const v=Number(value||0),q=Number(qty||0),u=C(unit); if(!(v>0)||!(q>0)||!u)return ''; return (Number.isInteger(q)?String(q):String(q))+u+'당 '+won(v); }

const PRODUCT_COLS=`
  product_uid,mall_code,product_id,item_id,vendor_item_id,pi_ii_vi,glomart_code,
  product_name,mall_product_name,keyword,category_keyword,
  normal_price,
  unit_price_text,unit_price_value,unit_base_qty,unit_base_unit,
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
  const gmSource=String((req.query&&req.query.gm_source)||'UNKNOWN').trim().slice(0,80)||'UNKNOWN';
  const gmReason=String((req.query&&req.query.gm_reason)||'').trim().slice(0,120);
  const pool=db(req); if(!pool) return res.status(500).json({ok:false,version:VERSION,error:'DB pool is not attached'});
  const keyword=C(req.query.keyword||req.query.q||'');
  const categoryCode=C(req.query.category_code||req.query.gm_category_code||'').toUpperCase();
  const categoryVirtualKeyword=C(req.query.category_keyword||'');
  const categorySearch=C(req.query.category_search)==='1'&&!!categoryCode;
  const limit=Math.max(1,Math.min(200,toInt(req.query.limit,150)||150));
  if(!keyword&&!categorySearch) return res.json({ok:true,version:VERSION,keyword:'',count:0,items:[],groups:{CPKR:0,ALKR:0}});

  const totalStarted=Date.now();
  try{console.log('[GM_SEARCH_LOCAL_TIMING] phase=START source='+gmSource+' reason='+(gmReason||'-')+' keyword='+(keyword||categoryVirtualKeyword||categoryCode)+' category_search='+(categorySearch?'Y':'N')+' ts_ms='+totalStarted);}catch(_log){}
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
        unitPriceText:publicUnitPriceText(x.unit_price_value,x.unit_base_qty,x.unit_base_unit),unit_price_value:x.unit_price_value,unit_base_qty:x.unit_base_qty,unit_base_unit:x.unit_base_unit,
        priceText:won(x.normal_price),delivery_fee:x.delivery_fee,shippingFeeText:(Number(x.delivery_fee||0)>0?won(x.delivery_fee):'무료배송'),
        deliveryEtaText:x.delivery_eta_text,deliveryType:x.delivery_type,reviewCount:x.review_count,mall_sales_count:x.mall_sales_count,rating:x.product_grade,
        product_url:x.product_url||'',image:x.thumb_origin_url||'',thumb_origin_url:x.thumb_origin_url||'',__gm_server_local:1,__gm_category_code_search:1
      }));
      const groups={CPKR:byMall.CPKR.length,ALKR:byMall.ALKR.length};
      const endedAt=Date.now();
      console.log('[GM_SEARCH_LOAD] keyword='+(keyword||categoryVirtualKeyword||categoryCode)+' count='+items.length);
      console.log('[GM_SEARCH_LOCAL_TIMING] phase=END source='+gmSource+' reason='+(gmReason||'-')+' keyword='+(keyword||categoryVirtualKeyword||categoryCode)+' category_search=Y count='+items.length+' category_ms='+categoryCodeMs+' total_ms='+(endedAt-totalStarted)+' ts_ms='+endedAt);
      return res.json({ok:true,version:VERSION,keyword,category_search:true,category_code:categoryCode,category_keyword:categoryVirtualKeyword||'',scope_count:categoryResult.scope_codes.length,count:items.length,groups,items});
    }

    // PRIORITY EXACT: 두 인덱스 조회는 서로 독립이므로 병렬 실행한다.
    // 결과 병합 순서는 keyword -> category_keyword로 유지해 기존 우선순위를 보존한다.
    const exactStarted=Date.now();
    const keywordStarted=Date.now();
    const keywordPromise=exactStage(pool,'keyword',keyword,limit).then(result=>({result,elapsed_ms:ms(keywordStarted)}));
    const categoryKeywordStarted=Date.now();
    const categoryKeywordPromise=exactStage(pool,'category_keyword',keyword,limit).then(result=>({result,elapsed_ms:ms(categoryKeywordStarted)}));
    const [exactKeywordTimed,exactCategoryTimed]=await Promise.all([keywordPromise,categoryKeywordPromise]);
    const exactParallelMs=ms(exactStarted);
    const exactKeyword=exactKeywordTimed.result;
    const exactCategory=exactCategoryTimed.result;
    merge(exactKeyword.rows);
    merge(exactCategory.rows);

    const rows=[...byMall.CPKR,...byMall.ALKR];
    const items=rows.map(x=>({
      product_uid:x.product_uid,mall_code:x.mall_code,
      productId:x.product_id,itemId:x.item_id,vendorItemId:x.vendor_item_id,pi_ii_vi:x.pi_ii_vi,
      productName:x.product_name,title:x.product_name,mall_product_name:x.mall_product_name,
      keyword:x.keyword,category_keyword:x.category_keyword,
      unitPriceText:publicUnitPriceText(x.unit_price_value,x.unit_base_qty,x.unit_base_unit),unit_price_value:x.unit_price_value,unit_base_qty:x.unit_base_qty,unit_base_unit:x.unit_base_unit,
      priceText:won(x.normal_price),
      delivery_fee:x.delivery_fee,shippingFeeText:(Number(x.delivery_fee||0)>0?won(x.delivery_fee):'무료배송'),
      deliveryEtaText:x.delivery_eta_text,deliveryType:x.delivery_type,
      reviewCount:x.review_count,mall_sales_count:x.mall_sales_count,rating:x.product_grade,
      product_url:x.product_url||'',image:x.thumb_origin_url||'',thumb_origin_url:x.thumb_origin_url||'',
      __gm_server_local:1
    }));
    const groups={CPKR:byMall.CPKR.length,ALKR:byMall.ALKR.length};
    const endedAt=Date.now();
    console.log('[GM_SEARCH_LOAD] keyword='+keyword+' count='+items.length);
    console.log('[GM_SEARCH_LOCAL_TIMING] phase=END source='+gmSource+' reason='+(gmReason||'-')+' keyword='+keyword+' category_search=N count='+items.length+' keyword_ms='+exactKeywordTimed.elapsed_ms+' category_keyword_ms='+exactCategoryTimed.elapsed_ms+' parallel_ms='+exactParallelMs+' total_ms='+(endedAt-totalStarted)+' ts_ms='+endedAt);
    res.json({ok:true,version:VERSION,keyword,count:items.length,groups,items});
  }catch(e){
    console.error('[GM_SEARCH_LOAD_ERROR] keyword='+keyword+' ms='+ms(totalStarted)+' error='+String(e&&e.message||e));
    res.status(500).json({ok:false,version:VERSION,error:'local search failed'});
  }
});
module.exports=router;
