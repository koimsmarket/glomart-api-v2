const express = require('express');
const router = express.Router();

function db(req){ return req.app.locals.db || req.app.locals.pool; }

function enqueueAfterResponse(req, label, task){
  const run=()=>{
    Promise.resolve().then(task).catch((eventErr)=>{
      console.error(label, String(eventErr&&eventErr.message||eventErr));
    });
  };
  if(typeof setImmediate==='function') setImmediate(run);
  else setTimeout(run,0);
}

async function applyBasketCountDirect(req,client,row){
  const service=req.app.locals.eventService;
  if(!service || typeof service.applyBasketAdd!=='function') throw new Error('event_service_applyBasketAdd_missing');
  return service.applyBasketAdd(client,row);
}

/*
 * GM_BASKET_COUNTER_BATCH_V036
 *
 * 장바구니 카운터는 사용자 응답이 끝난 뒤 실행하되, 한 요청당 비동기 작업을 1개만 만든다.
 * SmartFit bulk-upsert에서 신규 상품이 여러 개 생겨도 상품 수만큼 setImmediate/DB 연결을 만들지 않는다.
 *
 * 처리 원칙
 * - 신규 INSERT 행만 대상이다.
 * - DB 연결 1개 + 트랜잭션 1개에서 순차 처리한다.
 * - product_not_found 등 준비되지 않은 행만 기존 이벤트 큐로 순차 전달한다.
 * - SQL 오류가 발생하면 카운터 트랜잭션 전체를 롤백하고 대상 전체를 큐로 전달한다.
 * - Map/Set/TTL 캐시 등 장기 메모리 저장은 사용하지 않는다.
 */
function basketCountsAfterResponse(req,rows){
  const targets=(Array.isArray(rows)?rows:[rows]).filter(Boolean);
  if(!targets.length) return;
  enqueueAfterResponse(req,'[EVENT_BASKET_BATCH_FAIL]',async()=>{
    const pool=db(req);
    const retry=[];
    let client=null;
    try{
      if(!pool || typeof pool.connect!=='function') throw new Error('basket_counter_db_pool_missing');
      client=await pool.connect();
      await client.query('BEGIN');
      for(const row of targets){
        const result=await applyBasketCountDirect(req,client,row);
        if(result && result.updated){
          console.log('[EVENT_BASKET_DIRECT_OK]',JSON.stringify({product_uid:row&&row.product_uid,updated:result.updated,cart_count:result.cart_count}));
        }else{
          retry.push(row);
          console.warn('[EVENT_BASKET_DIRECT_DEFER]',JSON.stringify({product_uid:row&&row.product_uid,reason:result&&result.reason||'unknown'}));
        }
      }
      await client.query('COMMIT');
    }catch(directErr){
      if(client){ try{ await client.query('ROLLBACK'); }catch(_e){} }
      retry.length=0;
      retry.push(...targets);
      console.error('[EVENT_BASKET_BATCH_FAIL]',String(directErr&&directErr.message||directErr));
    }finally{
      if(client) client.release();
    }

    if(!retry.length) return;
    const q=req.app.locals.eventQueue;
    if(!q || typeof q.enqueueBasketAdd!=='function'){
      console.error('[EVENT_BASKET_QUEUE_FALLBACK_SKIP]','event_queue_unavailable');
      return;
    }
    for(const row of retry){
      try{
        await q.enqueueBasketAdd(row);
        console.log('[EVENT_BASKET_QUEUE_FALLBACK_OK]',JSON.stringify({product_uid:row&&row.product_uid}));
      }catch(queueErr){
        console.error('[EVENT_BASKET_QUEUE_FALLBACK_FAIL]',JSON.stringify({product_uid:row&&row.product_uid,error:String(queueErr&&queueErr.message||queueErr)}));
      }
    }
  });
}

function s(v,d=null){ return v===undefined||v===null||v==='' ? d : String(v).trim(); }
function n(v,d=0){ if(v===undefined||v===null||v==='') return d; const x=Number(String(v).replace(/[^0-9.-]/g,'')); return Number.isFinite(x)?x:d; }
function splitProductUid(uid){
  const v=s(uid,'') || '';
  const p=v.split('_');
  if(p.length < 4) return { mall_code:null, pi_ii_vi:null };
  return { mall_code:p[0], pi_ii_vi:p.slice(1).join('_') };
}
function itemKey(b){
  const fromUid=splitProductUid(b.product_uid||b.productUid);
  const mall=s(b.mall_code||b.mallCode||fromUid.mall_code,'CPKR');
  const pi=s(b.pi_ii_vi||b.piIiVi||fromUid.pi_ii_vi);
  return { mall_code:mall, pi_ii_vi:pi, cart_item_key:s(b.cart_item_key||b.cartItemKey||b.basket_item_key||b.basketItemKey) };
}
function ownerWhere(b){
  const member=s(b.member_id);
  if(member) return { col:'member_id', val:member };
  return null;
}
function rowPayload(b){
  const key=itemKey(b);
  return {
    mall_code:key.mall_code,
    source_mall:s(b.source_mall||b.sourceMall),
    source_uid:s(b.source_uid||b.sourceUid),
    internal_product_code:s(b.internal_product_code||b.internalProductCode),
    cafe24_product_no:s(b.cafe24_product_no||b.cafe24ProductNo),
    gm_internal_link:n(b.gm_internal_link||b.gmInternalLink,0)===1?1:0,
    member_id:s(b.member_id),
    guest_key:s(b.guest_key),
    pi_ii_vi:key.pi_ii_vi,
    cart_item_key:key.cart_item_key || ((key.mall_code||'CPKR')+'_'+key.pi_ii_vi+'::DEFAULT'),
    product_name:s(b.product_name||b.productName||b.title||b.name,''),
    option_name:s(b.option_name||b.optionName),
    option_value:s(b.option_value||b.optionValue),
    quantity:Math.max(1,n(b.quantity,1)),
    amount:n(b.amount??b.price,0),
    amount_type:s(b.amount_type||b.amountType,'unit'),
    delivery_type:s(b.delivery_type||b.deliveryType),
    delivery_fee:n(b.delivery_fee||b.deliveryFee,0),
    product_url:s(b.product_url||b.productUrl||b.url),
    thumb_url:s(b.thumb_url||b.thumbUrl||b.thumb_origin_url||b.thumbOriginUrl||b.thumb_file_name||b.thumbFileName),
    thumb_file_name:s(b.thumb_file_name||b.thumbFileName||b.thumb_url||b.thumbUrl||b.thumb_origin_url||b.thumbOriginUrl)
  };
}
function selectSql(where){
  return `SELECT *, (mall_code || '_' || pi_ii_vi) AS product_uid FROM gm_basket ${where||''}`;
}


/**
 * GM_HEADER_BASKET_COUNT_SERVER
 *
 * gm_basket은 외부 실상품 전용 테이블이다. Cafe24 주문 활성화용 더미상품은 이 테이블에 넣지 않는다.
 * 카운터는 행 개수가 아니라 현재 소유자(member_id 또는 guest_key)의 quantity 합계를 반환한다.
 * 이벤트별 +1/-1 추정값은 사용하지 않는다.
 */
async function ownerExternalCount(pool, owner){
  if(!owner || !owner.col || !s(owner.val)) return 0;
  const r=await pool.query(
    `SELECT COALESCE(SUM(GREATEST(COALESCE(quantity,1),0)),0)::bigint AS external_count
       FROM gm_basket
      WHERE ${owner.col}=$1`,
    [owner.val]
  );
  return Math.max(0,Number(r.rows[0]&&r.rows[0].external_count)||0);
}
function rowOwner(row){
  const member=s(row&&row.member_id), guest=s(row&&row.guest_key);
  if(member) return {col:'member_id',val:member};
  if(guest) return {col:'guest_key',val:guest};
  return null;
}

let __basketSchemaReady=false;
async function ensureBasketSchema(pool){
  if(__basketSchemaReady) return;
  // 개발 중 기존 gm_basket 테이블이 오래된 구조로 만들어진 경우를 원파일에서 직접 보강한다.
  // thumb_file_name은 파일명이 아니라 thumb_url과 같은 URL 저장 슬롯이다.
  await pool.query(`ALTER TABLE gm_basket ADD COLUMN IF NOT EXISTS mall_code TEXT NOT NULL DEFAULT 'CPKR'`);
  await pool.query(`ALTER TABLE gm_basket ADD COLUMN IF NOT EXISTS product_url TEXT NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE gm_basket ADD COLUMN IF NOT EXISTS thumb_url TEXT NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE gm_basket ADD COLUMN IF NOT EXISTS thumb_file_name TEXT`);
  await pool.query(`ALTER TABLE gm_basket ADD COLUMN IF NOT EXISTS source_mall TEXT`);
  await pool.query(`ALTER TABLE gm_basket ADD COLUMN IF NOT EXISTS source_uid TEXT`);
  await pool.query(`ALTER TABLE gm_basket ADD COLUMN IF NOT EXISTS internal_product_code TEXT`);
  await pool.query(`ALTER TABLE gm_basket ADD COLUMN IF NOT EXISTS cafe24_product_no TEXT`);
  await pool.query(`ALTER TABLE gm_basket ADD COLUMN IF NOT EXISTS gm_internal_link INTEGER NOT NULL DEFAULT 0`);
  /* 기존 장바구니 식별 기준을 유지한다.
   * UNIQUE: mall_code + pi_ii_vi + owner(member_id/guest_key)
   * cart_item_key 전용 UNIQUE/index는 생성하거나 기존 제약을 삭제하지 않는다. */
  __basketSchemaReady=true;
}

async function upsertOne(pool,b){
  await ensureBasketSchema(pool);
  const p=rowPayload(b);
  if(!p.mall_code) throw new Error('mall_code is required');
  if(!p.pi_ii_vi) throw new Error('pi_ii_vi is required');
  if(!p.member_id) throw new Error('member_id is required');
  p.guest_key = null;
  if(!p.product_name) throw new Error('product_name is required');
  if(!p.product_url) throw new Error('product_url is required');
  if(!p.thumb_url) throw new Error('thumb_url is required');
  if(!p.amount || p.amount <= 0) throw new Error('amount is required');
  const sql=`INSERT INTO gm_basket (
      mall_code,source_mall,source_uid,internal_product_code,cafe24_product_no,gm_internal_link,member_id,guest_key,pi_ii_vi,cart_item_key,product_name,option_name,option_value,quantity,amount,amount_type,delivery_type,delivery_fee,product_url,thumb_url,thumb_file_name,added_at,updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,NOW(),NOW())
    ON CONFLICT (mall_code, pi_ii_vi, (COALESCE(member_id, '')), (COALESCE(guest_key, ''))) DO UPDATE SET
      quantity=gm_basket.quantity + EXCLUDED.quantity,
      source_mall=COALESCE(NULLIF(EXCLUDED.source_mall,''),gm_basket.source_mall),
      source_uid=COALESCE(NULLIF(EXCLUDED.source_uid,''),gm_basket.source_uid),
      internal_product_code=COALESCE(NULLIF(EXCLUDED.internal_product_code,''),gm_basket.internal_product_code),
      cafe24_product_no=COALESCE(NULLIF(EXCLUDED.cafe24_product_no,''),gm_basket.cafe24_product_no),
      gm_internal_link=GREATEST(gm_basket.gm_internal_link,EXCLUDED.gm_internal_link),
      product_name=EXCLUDED.product_name,
      option_name=EXCLUDED.option_name,
      option_value=EXCLUDED.option_value,
      amount=EXCLUDED.amount,
      amount_type=EXCLUDED.amount_type,
      delivery_type=EXCLUDED.delivery_type,
      delivery_fee=EXCLUDED.delivery_fee,
      product_url=EXCLUDED.product_url,
      thumb_url=EXCLUDED.thumb_url,
      thumb_file_name=EXCLUDED.thumb_file_name,
      updated_at=NOW()
    RETURNING *, (mall_code || '_' || pi_ii_vi) AS product_uid, (xmax = 0) AS __gm_inserted`;
  const params=[p.mall_code,p.source_mall,p.source_uid,p.internal_product_code,p.cafe24_product_no,p.gm_internal_link,p.member_id,p.guest_key,p.pi_ii_vi,p.cart_item_key,p.product_name,p.option_name,p.option_value,p.quantity,p.amount,p.amount_type,p.delivery_type,p.delivery_fee,p.product_url,p.thumb_url,p.thumb_file_name];
  const r=await pool.query(sql,params);
  const row=r.rows[0];
  const inserted=!!row.__gm_inserted;
  try{Object.defineProperty(row,'__gm_inserted',{value:inserted,enumerable:false,writable:false});}catch(_e){row.__gm_inserted=inserted;}
  return row;
}

router.post(['/api/basket/add','/api/gm/basket/add'], async (req,res)=>{
  const pool=db(req); if(!pool) return res.status(500).json({ok:false,error:'DB pool is not attached'});
  try{
    const row=await upsertOne(pool,req.body||{});
    const external_count=await ownerExternalCount(pool,rowOwner(row));
    res.json({ok:true,item:row,external_count});
    if(row.__gm_inserted && !(req.body&&req.body.skip_cart_count)) basketCountsAfterResponse(req,[row]);
  }
  catch(e){
    try{ console.error('[GM_BASKET_ROUTE_ADD_ERROR]', e && e.message, req.body || {}); }catch(_e){}
    res.status(500).json({ok:false,error:e.message});
  }
});

router.post(['/api/basket/bulk-upsert','/api/gm/basket/bulk-upsert'], async (req,res)=>{
  const pool=db(req), b=req.body||{}, items=Array.isArray(b.items)?b.items:[];
  if(!pool) return res.status(500).json({ok:false,error:'DB pool is not attached'});
  const saved=[];
  try{
    const failed=[];
    for(const raw of items){
      try{
        const row=await upsertOne(pool,Object.assign({},raw,{member_id:b.member_id||raw.member_id,guest_key:''}));
        saved.push(row);
      }catch(itemErr){
        failed.push({ product_uid: raw && (raw.product_uid || raw.productUid || ''), error: itemErr.message });
      }
    }
    const external_count=await ownerExternalCount(pool,{col:'member_id',val:s(b.member_id)});
    res.json({ok:failed.length===0,items:saved,failed,external_count});
    if(!b.skip_cart_count){
      const insertedRows=saved.filter(row=>row.__gm_inserted);
      if(insertedRows.length) basketCountsAfterResponse(req,insertedRows);
    }
  }catch(e){ res.status(500).json({ok:false,error:e.message}); }
});

router.get(['/api/basket','/api/gm/basket/list'], async (req,res)=>{
  const pool=db(req), owner=ownerWhere(req.query||{});
  if(!pool) return res.status(500).json({ok:false,error:'DB pool is not attached'});
  if(!owner) return res.status(400).json({ok:false,error:'member_id is required'});
  try{ const r=await pool.query(selectSql(`WHERE ${owner.col}=$1 ORDER BY added_at DESC`),[owner.val]); const external_count=r.rows.reduce((sum,row)=>sum+Math.max(0,n(row.quantity,1)),0); res.json({ok:true,items:r.rows,external_count}); }
  catch(e){ res.status(500).json({ok:false,error:e.message}); }
});

router.post(['/api/basket/quantity','/api/gm/basket/update'], async (req,res)=>{
  const pool=db(req), b=req.body||{}, owner=ownerWhere(b), key=itemKey(b), qty=Math.max(1,n(b.quantity,1));
  if(!pool) return res.status(500).json({ok:false,error:'DB pool is not attached'});
  if(!owner || (!key.cart_item_key && (!key.mall_code || !key.pi_ii_vi))) return res.status(400).json({ok:false,error:'cart_item_key or mall_code/pi_ii_vi and member_id are required'});
  try{ const r=key.cart_item_key
    ? await pool.query(`UPDATE gm_basket SET quantity=$1, updated_at=NOW() WHERE cart_item_key=$2 AND ${owner.col}=$3 RETURNING *, (mall_code || '_' || pi_ii_vi) AS product_uid`,[qty,key.cart_item_key,owner.val])
    : await pool.query(`UPDATE gm_basket SET quantity=$1, updated_at=NOW() WHERE mall_code=$2 AND pi_ii_vi=$3 AND ${owner.col}=$4 RETURNING *, (mall_code || '_' || pi_ii_vi) AS product_uid`,[qty,key.mall_code,key.pi_ii_vi,owner.val]); const external_count=await ownerExternalCount(pool,owner); res.json({ok:true,item:r.rows[0]||null,external_count}); }
  catch(e){ res.status(500).json({ok:false,error:e.message}); }
});

router.delete(['/api/basket/delete','/api/gm/basket/item'], async (req,res)=>{
  const pool=db(req), b=req.body||{}, owner=ownerWhere(b);
  const productUids=Array.isArray(b.product_uids)?b.product_uids.map(x=>s(x)).filter(Boolean):[];
  const cartItemKeys=Array.isArray(b.cart_item_keys)?b.cart_item_keys.map(x=>s(x)).filter(Boolean):[];
  const keys=Array.isArray(b.items)?b.items.map(itemKey).filter(k=>k.mall_code&&k.pi_ii_vi):[];
  const single=itemKey(b);
  if(single.mall_code && single.pi_ii_vi) keys.push(single);
  if(!pool) return res.status(500).json({ok:false,error:'DB pool is not attached'});
  if(!owner || (!productUids.length && !cartItemKeys.length && !keys.length)) return res.status(400).json({ok:false,error:'basket item key and member_id/guest_key are required'});
  try{
    let deleted=[];
    if(cartItemKeys.length){
      const r=await pool.query(`DELETE FROM gm_basket WHERE ${owner.col}=$1 AND cart_item_key = ANY($2::text[]) RETURNING cart_item_key`,[owner.val,cartItemKeys]);
      deleted=deleted.concat(r.rows.map(x=>x.cart_item_key));
    }
    if(productUids.length){
      const r=await pool.query(`DELETE FROM gm_basket WHERE ${owner.col}=$1 AND (mall_code || '_' || pi_ii_vi) = ANY($2::text[]) RETURNING (mall_code || '_' || pi_ii_vi) AS product_uid`,[owner.val,productUids]);
      deleted=deleted.concat(r.rows.map(x=>x.product_uid));
    }
    for(const k of keys){
      const r=k.cart_item_key
        ? await pool.query(`DELETE FROM gm_basket WHERE ${owner.col}=$1 AND cart_item_key=$2 RETURNING cart_item_key`,[owner.val,k.cart_item_key])
        : await pool.query(`DELETE FROM gm_basket WHERE ${owner.col}=$1 AND mall_code=$2 AND pi_ii_vi=$3 RETURNING (mall_code || '_' || pi_ii_vi) AS product_uid`,[owner.val,k.mall_code,k.pi_ii_vi]);
      deleted=deleted.concat(r.rows.map(x=>x.cart_item_key||x.product_uid).filter(Boolean));
    }
    const external_count=await ownerExternalCount(pool,owner);
    res.json({ok:true,deleted:Array.from(new Set(deleted)),external_count});
  }catch(e){ res.status(500).json({ok:false,error:e.message}); }
});

module.exports=router;
