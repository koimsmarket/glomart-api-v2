'use strict';

/* GM_DETAIL_FAST_SERVER_V003_SPLIT
 * 2026-10-01
 * 목적:
 * - 기존 routes/product.js를 키우지 않고, 9/3 정상 동작했던 detail-fast를 독립 라우터로 복구한다.
 * - PID로 gm_product 대표 1행 + 같은 PID의 활성 gm_product_option 전체를 읽는다.
 * - 고객 노출 가격은 normal_price만 사용한다.
 * - CPKR은 요청 IID+VID가 모두 정확히 일치할 때만 selected=true로 표시한다.
 * - exact option이 없으면 임의 다른 옵션을 selected 처리하지 않는다.
 * 비담당:
 * - product UPSERT / queue / keyword / unit price 계산 / collector 수정 없음.
 */

const express = require('express');
const router = express.Router();
const VERSION = 'GM_DETAIL_FAST_SERVER_V004_TEMP_SOLDOUT_3D';

function db(req){ return req.app.locals.db || req.app.locals.pool; }
function C(v){ return String(v == null ? '' : v).replace(/[\u00A0\u200B-\u200D\uFEFF]/g,' ').replace(/\s+/g,' ').trim(); }
function U(v){
  let s=C(v);
  if(!s) return '';
  if(s.indexOf('//')===0) s='https:'+s;
  return s;
}
function thumbList(row){
  const out=[], seen=new Set();
  function push(v){
    if(v && typeof v==='object') v=v.url||v.src||v.image||v.imageUrl||'';
    v=U(v); if(!v||seen.has(v)) return;
    seen.add(v); out.push(v);
  }
  push(row&&row.thumb_origin_url);
  const raw=row&&row.thumb_json;
  if(Array.isArray(raw)) raw.forEach(push);
  else if(raw && typeof raw==='object') Object.values(raw).forEach(push);
  else if(C(raw)){
    let parsed=null;
    try{ parsed=JSON.parse(raw); }catch(_e){}
    if(Array.isArray(parsed)) parsed.forEach(push);
    else if(parsed && typeof parsed==='object') Object.values(parsed).forEach(push);
    else C(raw).split('|').forEach(push);
  }
  return out.slice(0,10);
}
function ok(res,payload){ return res.json(Object.assign({ok:true,version:VERSION},payload||{})); }
function fail(res,status,error,extra){ return res.status(status).json(Object.assign({ok:false,version:VERSION,error},extra||{})); }

router.get('/api/gm/product/detail-fast', async (req,res)=>{
  const pool=db(req);
  if(!pool) return fail(res,500,'DB pool is not attached');

  try{
    let mall=C(req.query.mall_code||req.query.mallCode||'').toUpperCase();
    const raw=C(req.query.pi_ii_vi||req.query.piIiVi||req.query.gm_key||req.query.key||req.query.product_uid||req.query.productUid||'');
    if(/^(ALI|ALIEXPRESS)$/.test(mall)) mall='ALKR';
    if(!mall) mall=/^ALKR_/i.test(raw)?'ALKR':'CPKR';

    const key=raw.replace(/^(CPKR|ALKR)_/i,'');
    const parts=key.split('_').filter(Boolean);
    const pid=C(req.query.product_id||req.query.productId||parts[0]||'');
    const iid=C(parts[1]||'');
    const vid=C(parts[2]||'');

    if(!pid){
      console.log('[GM_PRODUCT_DETAIL_FAST_MISS]',{version:VERSION,reason:'PID_EMPTY',mall_code:mall,key:raw});
      return ok(res,{found:false,item:null,reason:'PID_EMPTY'});
    }

    const pr=await pool.query(`
      SELECT product_uid,mall_code,product_id,item_id,vendor_item_id,pi_ii_vi,
             product_name,mall_product_name,normal_price,discount_price,
             delivery_fee,delivery_eta_text,delivery_type,
             jeju_delivery_yn,jeju_extra_delivery_fee,island_delivery_yn,island_extra_delivery_fee,
             thumb_origin_url,thumb_json,soldout_yn,sale_status,
             buyable_qty,min_order_qty,max_order_qty,updated_at
        FROM gm_product
       WHERE mall_code=$1 AND product_id=$2
       ORDER BY updated_at DESC NULLS LAST
       LIMIT 1`,[mall,pid]);

    if(!pr.rows.length){
      console.log('[GM_PRODUCT_DETAIL_FAST_MISS]',{version:VERSION,reason:'PID_NOT_FOUND',mall_code:mall,product_id:pid});
      return ok(res,{found:false,item:null,reason:'PID_NOT_FOUND'});
    }

    const p=pr.rows[0];
    /* 3일 임시 품절 만료: DB 이력값 Y는 보존하되 FAST 화면에는 더 이상 품절로 잠그지 않는다.
       이후 외부 상세가 정상 수집되면 기존 upsert가 soldout_yn='N'으로 실제 DB 상태도 복구한다. */
    const soldoutAgeMs=p.updated_at?Math.max(0,Date.now()-new Date(p.updated_at).getTime()):0;
    const storedSoldout=String(p.soldout_yn||'N').toUpperCase()==='Y';
    const tempSoldoutActive=storedSoldout && soldoutAgeMs < 3*24*60*60*1000;
    const storedSaleStatus=C(p.sale_status).toLowerCase();
    const effectiveSaleStatus=(!tempSoldoutActive && storedSoldout && /^(unavailable|soldout|stopped)$/.test(storedSaleStatus))?'active':(p.sale_status||'');
    const or=await pool.query(`
      SELECT product_id,item_id,vendor_item_id,pi_ii_vi,option_name,option_image_url,
             normal_price,discount_price,delivery_fee,delivery_eta_text,delivery_type,
             soldout_yn,sale_status,buyable_qty,min_order_qty,max_order_qty
        FROM gm_product_option
       WHERE mall_code=$1
         AND product_id=$2
         AND COALESCE(active_yn,'Y')='Y'
       ORDER BY option_sort_no ASC,pi_ii_vi ASC`,[p.mall_code,p.product_id]);

    const requireExact=(mall==='CPKR' && !!iid && !!vid);
    const options=(or.rows||[]).map(o=>{
      const exact=(!requireExact) ? false : (String(o.item_id||'')===iid && String(o.vendor_item_id||'')===vid);
      const sold=String(o.soldout_yn||'N').toUpperCase()==='Y';
      const saleStatus=C(o.sale_status).toLowerCase();
      return {
        name:o.option_name||'기본상품', optionName:o.option_name||'기본상품',
        productId:o.product_id, itemId:o.item_id, vendorItemId:o.vendor_item_id,
        key:o.pi_ii_vi, pi_ii_vi:o.pi_ii_vi,
        selected:exact,
        price:o.normal_price||0, priceText:o.normal_price||0,
        normal_price:o.normal_price||0, discount_price:o.discount_price||0,
        optionImage:o.option_image_url||'', option_image_url:o.option_image_url||'',
        shippingBadge:o.delivery_type||'', deliveryType:o.delivery_type||'', delivery_type:o.delivery_type||'',
        shippingFeeText:o.delivery_fee||0, deliveryFee:o.delivery_fee||0, delivery_fee:o.delivery_fee||0,
        delivery_eta_text:o.delivery_eta_text||'',
        soldout:sold, disabled:sold||saleStatus==='soldout',
        buyable_qty:o.buyable_qty, min_order_qty:o.min_order_qty, max_order_qty:o.max_order_qty
      };
    });

    const sel=options.find(o=>o.selected)||null;
    const images=thumbList(p);
    const requestKey=[pid,iid,vid].filter(Boolean).join('_')||pid;

    // exact option이 있을 때만 옵션별 가격/배송으로 덮는다.
    // exact miss에서는 대표행 가격으로 임의 옵션을 선택한 것처럼 만들지 않는다.
    const sale=sel ? Number(sel.normal_price||0) : Number(p.normal_price||0);
    const fee=sel ? Number(sel.delivery_fee||0) : Number(p.delivery_fee||0);
    const dtype=sel ? C(sel.delivery_type) : C(p.delivery_type);
    const eta=sel ? C(sel.delivery_eta_text) : C(p.delivery_eta_text);

    const item={
      __gmPayloadSource:'SERVER_FAST', __gmServerFast:true, __gmPartial:true, partial:true, phase:'SERVER_FAST',
      gm_key:requestKey, key:requestKey,
      product_uid:p.product_uid, mall_code:p.mall_code, mallCode:p.mall_code,
      productId:p.product_id, product_id:p.product_id,
      // 요청 identity는 유지하되 selected 여부는 gm_product_option exact match로만 결정한다.
      itemId:sel?sel.itemId:(iid||p.item_id||''), item_id:sel?sel.itemId:(iid||p.item_id||''),
      vendorItemId:sel?sel.vendorItemId:(vid||p.vendor_item_id||''), vendor_item_id:sel?sel.vendorItemId:(vid||p.vendor_item_id||''),
      pi_ii_vi:sel?sel.pi_ii_vi:requestKey,
      title:p.product_name||p.mall_product_name||'', productName:p.product_name||p.mall_product_name||'', mallProductName:p.mall_product_name||'',
      price:sale, priceText:sale, normal_price:sale,
      discount_price:sel?sel.discount_price:(p.discount_price||0),
      delivery_fee:fee, deliveryFee:fee, delivery_eta_text:eta, deliveryType:dtype, delivery_type:dtype,
      jeju_delivery_yn:p.jeju_delivery_yn, jeju_extra_delivery_fee:p.jeju_extra_delivery_fee||0,
      island_delivery_yn:p.island_delivery_yn, island_extra_delivery_fee:p.island_extra_delivery_fee||0,
      soldout_yn:tempSoldoutActive?'Y':'N', sale_status:effectiveSaleStatus, temporarySoldout:tempSoldoutActive,
      buyable_qty:sel?sel.buyable_qty:p.buyable_qty,
      min_order_qty:sel?sel.min_order_qty:p.min_order_qty,
      max_order_qty:sel?sel.max_order_qty:p.max_order_qty,
      mainImage:images[0]||'', image:images[0]||'', thumbnail:images[0]||'', thumb_url:images[0]||'',
      images, thumbnailImages:images,
      flatOptionRows:options, optionRows:options, options,
      selected_found:!!sel,
      selected_item_id:sel?sel.itemId:'', selected_vendor_item_id:sel?sel.vendorItemId:'',
      requested_item_id:iid, requested_vendor_item_id:vid,
      server_updated_at:p.updated_at||null
    };

    console.log('[GM_PRODUCT_DETAIL_FAST_OK]',{
      version:VERSION, mall_code:p.mall_code, product_id:p.product_id,
      requested_iid:iid||'', requested_vid:vid||'', selected_found:!!sel,
      images:images.length, options:options.length
    });
    return ok(res,{found:true,item});
  }catch(e){
    console.error('[GM_PRODUCT_DETAIL_FAST_ERROR]',{version:VERSION,error:String(e&&e.stack||e)});
    return fail(res,500,'detail fast lookup failed',{detail:String(e&&e.message||e)});
  }
});

module.exports=router;
