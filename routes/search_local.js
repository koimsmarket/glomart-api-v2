'use strict';
const express = require('express');
const router = express.Router();
const VERSION = 'GM_SEARCH_LOCAL_V009_PRIORITY_TEST_DIAG';
function db(req){ return req.app.locals.db || req.app.locals.pool; }
function C(v){ return String(v == null ? '' : v).replace(/[\u00A0\u200B-\u200D\uFEFF]/g,' ').replace(/\s+/g,' ').trim(); }
function toInt(v,d){ const n=Number(v); return Number.isFinite(n)?Math.trunc(n):d; }
function won(v){ const n=Number(v||0); return n>0 ? Math.round(n).toLocaleString('ko-KR')+'원' : ''; }
function ms(t){ return Date.now()-t; }
function publicUnitPriceText(value,qty,unit){ const v=Number(value||0),q=Number(qty||0),u=C(unit); if(!(v>0)||!(q>0)||!u)return ''; return (Number.isInteger(q)?String(q):String(q))+u+'당 '+won(v); }

// GM_SEARCH_PRIORITY_TEST_V001
// Search is the highest-priority DB workload. Queue routes/workers observe
// these in-memory flags and must yield before taking new DB work.
function priorityEnter(pool){
  if(!pool) return;
  pool.__gmSearchPriorityActive=Math.max(0,Number(pool.__gmSearchPriorityActive||0))+1;
  pool.__gmSearchPriorityQuietUntil=0;
  console.log('[GM_SEARCH_PRIORITY] state=ENTER active='+pool.__gmSearchPriorityActive+' pool_total='+Number(pool.totalCount||0)+' pool_idle='+Number(pool.idleCount||0)+' pool_waiting='+Number(pool.waitingCount||0));
}
function priorityLeave(pool){
  if(!pool) return;
  pool.__gmSearchPriorityActive=Math.max(0,Number(pool.__gmSearchPriorityActive||0)-1);
  const quietMs=Math.max(0,Number(process.env.GM_SEARCH_PRIORITY_QUIET_MS||750));
  if(pool.__gmSearchPriorityActive===0) pool.__gmSearchPriorityQuietUntil=Date.now()+quietMs;
  console.log('[GM_SEARCH_PRIORITY] state=LEAVE active='+pool.__gmSearchPriorityActive+' quiet_ms='+(pool.__gmSearchPriorityActive===0?quietMs:0)+' pool_total='+Number(pool.totalCount||0)+' pool_idle='+Number(pool.idleCount||0)+' pool_waiting='+Number(pool.waitingCount||0));
}

function poolState(pool){
  return {
    total:Number(pool&&pool.totalCount||0),
    idle:Number(pool&&pool.idleCount||0),
    waiting:Number(pool&&pool.waitingCount||0)
  };
}
async function timedPoolQuery(pool,sql,params,label){
  const started=Date.now();
  let client=null;
  let acquireMs=0, sqlMs=0;
  if(pool&&typeof pool.connect==='function'){
    const acquireStarted=Date.now();
    client=await pool.connect();
    acquireMs=Date.now()-acquireStarted;
    try{
      const sqlStarted=Date.now();
      const result=await client.query(sql,params);
      sqlMs=Date.now()-sqlStarted;
      return {result,acquire_ms:acquireMs,sql_ms:sqlMs,total_ms:Date.now()-started,label:label||''};
    }finally{
      try{client.release();}catch(_release){}
    }
  }
  const sqlStarted=Date.now();
  const result=await pool.query(sql,params);
  sqlMs=Date.now()-sqlStarted;
  return {result,acquire_ms:0,sql_ms:sqlMs,total_ms:Date.now()-started,label:label||''};
}

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
  return timedPoolQuery(pool,`
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
  `,[keyword,limit],column);
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
  const cqTimed=await timedPoolQuery(pool,`SELECT gm_code FROM gm_category WHERE COALESCE(display_yn,'Y')='Y' AND (gm_code=$1 OR gm_code LIKE $2) ORDER BY depth,gm_code`,[categoryCode,prefix+'-%'],'category_scope');
  const cq=cqTimed.result;
  const scopeCodes=(cq.rows||[]).map(r=>C(r.gm_code).toUpperCase()).filter(Boolean);
  if(!scopeCodes.includes(categoryCode)) scopeCodes.unshift(categoryCode);
  const params=[scopeCodes,limit];
  let virtualSql='';
  if(virtualKeyword){params.push(virtualKeyword);virtualSql=` AND (keyword=$3 OR category_keyword=$3)`;}
  const qTimed=await timedPoolQuery(pool,`
    WITH ranked AS (
      SELECT ${PRODUCT_COLS},
             ROW_NUMBER() OVER (PARTITION BY mall_code ORDER BY COALESCE(hit_count,0) DESC,COALESCE(updated_at,last_seen_at) DESC NULLS LAST) AS rn
      FROM gm_product
      WHERE ${ACTIVE_WHERE}
        AND string_to_array(COALESCE(glomart_code,''),'|') && $1::text[]
        ${virtualSql}
    )
    SELECT * FROM ranked WHERE rn <= $2 ORDER BY mall_code,rn
  `,params,'category_product');
  const q=qTimed.result;
  return {rows:q.rows||[],scope_codes:scopeCodes,scope_timing:cqTimed,product_timing:qTimed};
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

  priorityEnter(pool);
  const totalStarted=Date.now();
  try{const ps=poolState(pool);console.log('[GM_SEARCH_LOCAL_TIMING] phase=START source='+gmSource+' reason='+(gmReason||'-')+' keyword='+(keyword||categoryVirtualKeyword||categoryCode)+' category_search='+(categorySearch?'Y':'N')+' pool_total='+ps.total+' pool_idle='+ps.idle+' pool_waiting='+ps.waiting+' ts_ms='+totalStarted);}catch(_log){}
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
      const ps=poolState(pool);
      console.log('[GM_SEARCH_LOCAL_TIMING] phase=END source='+gmSource+' reason='+(gmReason||'-')+' keyword='+(keyword||categoryVirtualKeyword||categoryCode)+' category_search=Y count='+items.length+' category_ms='+categoryCodeMs+' scope_acquire_ms='+(categoryResult.scope_timing&&categoryResult.scope_timing.acquire_ms||0)+' scope_sql_ms='+(categoryResult.scope_timing&&categoryResult.scope_timing.sql_ms||0)+' product_acquire_ms='+(categoryResult.product_timing&&categoryResult.product_timing.acquire_ms||0)+' product_sql_ms='+(categoryResult.product_timing&&categoryResult.product_timing.sql_ms||0)+' pool_total='+ps.total+' pool_idle='+ps.idle+' pool_waiting='+ps.waiting+' total_ms='+(endedAt-totalStarted)+' ts_ms='+endedAt);
      return res.json({ok:true,version:VERSION,keyword,category_search:true,category_code:categoryCode,category_keyword:categoryVirtualKeyword||'',scope_count:categoryResult.scope_codes.length,count:items.length,groups,items});
    }

    // PRIORITY EXACT: 두 인덱스 조회는 서로 독립이므로 병렬 실행한다.
    // 결과 병합 순서는 keyword -> category_keyword로 유지해 기존 우선순위를 보존한다.
    const exactStarted=Date.now();
    const keywordPromise=exactStage(pool,'keyword',keyword,limit);
    const categoryKeywordPromise=exactStage(pool,'category_keyword',keyword,limit);
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
    const ps=poolState(pool);
    console.log('[GM_SEARCH_LOCAL_TIMING] phase=END source='+gmSource+' reason='+(gmReason||'-')+' keyword='+keyword+' category_search=N count='+items.length+' keyword_ms='+exactKeywordTimed.total_ms+' keyword_acquire_ms='+exactKeywordTimed.acquire_ms+' keyword_sql_ms='+exactKeywordTimed.sql_ms+' category_keyword_ms='+exactCategoryTimed.total_ms+' category_keyword_acquire_ms='+exactCategoryTimed.acquire_ms+' category_keyword_sql_ms='+exactCategoryTimed.sql_ms+' parallel_ms='+exactParallelMs+' pool_total='+ps.total+' pool_idle='+ps.idle+' pool_waiting='+ps.waiting+' total_ms='+(endedAt-totalStarted)+' ts_ms='+endedAt);
    res.json({ok:true,version:VERSION,keyword,count:items.length,groups,items});
  }catch(e){
    console.error('[GM_SEARCH_LOAD_ERROR] keyword='+keyword+' ms='+ms(totalStarted)+' error='+String(e&&e.message||e));
    res.status(500).json({ok:false,version:VERSION,error:'local search failed'});
  }finally{
    priorityLeave(pool);
  }
});
module.exports=router;
