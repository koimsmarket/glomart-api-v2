const express = require('express');
const router = express.Router();

function db(req){ return req.app.locals.db || req.app.locals.pool; }
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
  return { mall_code:mall, pi_ii_vi:pi };
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
    member_id:s(b.member_id),
    guest_key:s(b.guest_key),
    pi_ii_vi:key.pi_ii_vi,
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

let __basketSchemaReady=false;
async function ensureBasketSchema(pool){
  if(__basketSchemaReady) return;
  // 개발 중 기존 gm_basket 테이블이 오래된 구조로 만들어진 경우를 원파일에서 직접 보강한다.
  // thumb_file_name은 파일명이 아니라 thumb_url과 같은 URL 저장 슬롯이다.
  await pool.query(`ALTER TABLE gm_basket ADD COLUMN IF NOT EXISTS mall_code TEXT NOT NULL DEFAULT 'CPKR'`);
  await pool.query(`ALTER TABLE gm_basket ADD COLUMN IF NOT EXISTS product_url TEXT NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE gm_basket ADD COLUMN IF NOT EXISTS thumb_url TEXT NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE gm_basket ADD COLUMN IF NOT EXISTS thumb_file_name TEXT`);
  __basketSchemaReady=true;
}

async function touchProductCart(pool, row){
  if(!row || !row.mall_code || !row.pi_ii_vi) return;
  await pool.query(`
    UPDATE gm_product
    SET cart_count=COALESCE(cart_count,0)+1,
        last_cart_at=NOW(),
        expire_at=GREATEST(COALESCE(expire_at, NOW()), NOW() + INTERVAL '180 days'),
        updated_at=NOW()
    WHERE mall_code=$1 AND pi_ii_vi=$2
  `, [row.mall_code, row.pi_ii_vi]).catch(()=>{});
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
      mall_code,member_id,guest_key,pi_ii_vi,product_name,option_name,option_value,quantity,amount,amount_type,delivery_type,delivery_fee,product_url,thumb_url,thumb_file_name,added_at,updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW(),NOW())
    ON CONFLICT (mall_code, pi_ii_vi, (COALESCE(member_id, '')), (COALESCE(guest_key, ''))) DO UPDATE SET
      quantity=gm_basket.quantity + EXCLUDED.quantity,
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
    RETURNING *, (mall_code || '_' || pi_ii_vi) AS product_uid`;
  const params=[p.mall_code,p.member_id,p.guest_key,p.pi_ii_vi,p.product_name,p.option_name,p.option_value,p.quantity,p.amount,p.amount_type,p.delivery_type,p.delivery_fee,p.product_url,p.thumb_url,p.thumb_file_name];
  const r=await pool.query(sql,params);
  return r.rows[0];
}

router.post(['/api/basket/add','/api/gm/basket/add'], async (req,res)=>{
  const pool=db(req); if(!pool) return res.status(500).json({ok:false,error:'DB pool is not attached'});
  try{ const row=await upsertOne(pool,req.body||{}); await touchProductCart(pool,row); res.json({ok:true,item:row}); }
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
        if(!b.skip_cart_count) await touchProductCart(pool,row);
        saved.push(row);
      }catch(itemErr){
        failed.push({ product_uid: raw && (raw.product_uid || raw.productUid || ''), error: itemErr.message });
      }
    }
    res.json({ok:failed.length===0,items:saved,failed});
  }catch(e){ res.status(500).json({ok:false,error:e.message}); }
});

router.get(['/api/basket','/api/gm/basket/list'], async (req,res)=>{
  const pool=db(req), owner=ownerWhere(req.query||{});
  if(!pool) return res.status(500).json({ok:false,error:'DB pool is not attached'});
  if(!owner) return res.status(400).json({ok:false,error:'member_id is required'});
  try{ const r=await pool.query(selectSql(`WHERE ${owner.col}=$1 ORDER BY added_at DESC`),[owner.val]); res.json({ok:true,items:r.rows}); }
  catch(e){ res.status(500).json({ok:false,error:e.message}); }
});

router.post(['/api/basket/quantity','/api/gm/basket/update'], async (req,res)=>{
  const pool=db(req), b=req.body||{}, owner=ownerWhere(b), key=itemKey(b), qty=Math.max(1,n(b.quantity,1));
  if(!pool) return res.status(500).json({ok:false,error:'DB pool is not attached'});
  if(!owner || !key.mall_code || !key.pi_ii_vi) return res.status(400).json({ok:false,error:'mall_code/pi_ii_vi and member_id/guest_key are required'});
  try{ const r=await pool.query(`UPDATE gm_basket SET quantity=$1, updated_at=NOW() WHERE mall_code=$2 AND pi_ii_vi=$3 AND ${owner.col}=$4 RETURNING *, (mall_code || '_' || pi_ii_vi) AS product_uid`,[qty,key.mall_code,key.pi_ii_vi,owner.val]); res.json({ok:true,item:r.rows[0]||null}); }
  catch(e){ res.status(500).json({ok:false,error:e.message}); }
});

router.delete(['/api/basket/delete','/api/gm/basket/item'], async (req,res)=>{
  const pool=db(req), b=req.body||{}, owner=ownerWhere(b);
  const productUids=Array.isArray(b.product_uids)?b.product_uids.map(x=>s(x)).filter(Boolean):[];
  const keys=Array.isArray(b.items)?b.items.map(itemKey).filter(k=>k.mall_code&&k.pi_ii_vi):[];
  const single=itemKey(b);
  if(single.mall_code && single.pi_ii_vi) keys.push(single);
  if(!pool) return res.status(500).json({ok:false,error:'DB pool is not attached'});
  if(!owner || (!productUids.length && !keys.length)) return res.status(400).json({ok:false,error:'basket item key and member_id/guest_key are required'});
  try{
    let deleted=[];
    if(productUids.length){
      const r=await pool.query(`DELETE FROM gm_basket WHERE ${owner.col}=$1 AND (mall_code || '_' || pi_ii_vi) = ANY($2::text[]) RETURNING (mall_code || '_' || pi_ii_vi) AS product_uid`,[owner.val,productUids]);
      deleted=deleted.concat(r.rows.map(x=>x.product_uid));
    }
    for(const k of keys){
      const r=await pool.query(`DELETE FROM gm_basket WHERE ${owner.col}=$1 AND mall_code=$2 AND pi_ii_vi=$3 RETURNING (mall_code || '_' || pi_ii_vi) AS product_uid`,[owner.val,k.mall_code,k.pi_ii_vi]);
      deleted=deleted.concat(r.rows.map(x=>x.product_uid));
    }
    res.json({ok:true,deleted:Array.from(new Set(deleted))});
  }catch(e){ res.status(500).json({ok:false,error:e.message}); }
});

module.exports=router;
