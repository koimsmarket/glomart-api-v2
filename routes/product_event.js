const express = require('express');
const router = express.Router();

function db(req){ return req.app.locals.db || req.app.locals.pool; }
function s(v,d=''){ return v===undefined||v===null||v==='' ? d : String(v).trim(); }
function n(v,d=0){ if(v===undefined||v===null||v==='') return d; const x=Number(String(v).replace(/[^0-9.-]/g,'')); return Number.isFinite(x)?x:d; }
function parseUid(uid){
  uid=s(uid); const p=uid.split('_');
  if(p.length>=4) return { mall_code:p[0].toUpperCase(), pi_ii_vi:p.slice(1).join('_') };
  return { mall_code:'', pi_ii_vi:'' };
}
function payloadKey(p){
  const u=parseUid(p.product_uid || p.productUid || p.uid || '');
  const mall=s(p.mall_code || p.mallCode || u.mall_code).toUpperCase();
  const pi=s(p.pi_ii_vi || p.piIiVi || p.pi || u.pi_ii_vi);
  const uid=s(p.product_uid || p.productUid || (mall && pi ? mall+'_'+pi : ''));
  return { mall_code:mall, pi_ii_vi:pi, product_uid:uid };
}
function ok(res,o){ res.json(Object.assign({ok:true},o||{})); }
function fail(res,code,msg,extra){ res.status(code||400).json(Object.assign({ok:false,error:msg},extra||{})); }

const recent = new Map();
function seen(eventKey){
  eventKey=s(eventKey); if(!eventKey) return false;
  const now=Date.now();
  if(recent.size>3000){ for(const [k,t] of recent){ if(now-t>10*60*1000) recent.delete(k); } }
  const old=recent.get(eventKey);
  if(old && now-old<10*60*1000) return true;
  recent.set(eventKey, now);
  return false;
}

router.post(['/api/gm/product/event','/api/product/event'], async (req,res)=>{
  const pool=db(req), p=req.body||{};
  if(!pool) return fail(res,500,'DB pool is not attached');
  const type=s(p.event_type || p.eventType || p.type).toLowerCase();
  const key=payloadKey(p);
  const qty=Math.max(1,n(p.qty || p.quantity,1));
  const amount=n(p.amount || p.product_amount || p.productAmount || p.total_amount || p.totalAmount,0);
  if(!type) return fail(res,400,'event_type is required');
  if(!key.product_uid && (!key.mall_code || !key.pi_ii_vi)) return fail(res,400,'product_uid or mall_code+pi_ii_vi required');
  const eventKey=s(p.event_key || p.eventKey || [type,key.product_uid||key.mall_code+'_'+key.pi_ii_vi,s(p.order_no||p.orderNo||''),s(p.request_id||p.requestId||'')].join(':'));
  if(seen(eventKey)) return ok(res,{action:'product.event',type,duplicate:true,updated:0,event_key:eventKey});

  const where = key.product_uid ? 'product_uid=$1' : 'mall_code=$1 AND pi_ii_vi=$2';
  const vals = key.product_uid ? [key.product_uid] : [key.mall_code,key.pi_ii_vi];
  let setSql='';
  if(type==='detail' || type==='view'){
    setSql = "detail_view_count=COALESCE(detail_view_count,0)+1, view_count=COALESCE(view_count,0)+1, last_view_at=NOW(), expire_at=GREATEST(COALESCE(expire_at,NOW()), NOW()+INTERVAL '90 days')";
  }else if(type==='cart'){
    setSql = "cart_count=COALESCE(cart_count,0)+1, last_cart_at=NOW(), expire_at=GREATEST(COALESCE(expire_at,NOW()), NOW()+INTERVAL '180 days')";
  }else if(type==='wish'){
    setSql = "wish_count=COALESCE(wish_count,0)+1, last_wish_at=NOW(), expire_at=GREATEST(COALESCE(expire_at,NOW()), NOW()+INTERVAL '180 days')";
  }else if(type==='order'){
    setSql = "order_count=COALESCE(order_count,0)+1, order_qty_total=COALESCE(order_qty_total,0)+"+qty+", sales_qty=COALESCE(sales_qty,0)+"+qty+", sales_amount=COALESCE(sales_amount,0)+"+amount+", last_order_at=NOW(), expire_at=GREATEST(COALESCE(expire_at,NOW()), NOW()+INTERVAL '730 days')";
  }else if(type==='return'){
    setSql = "return_count=COALESCE(return_count,0)+1, last_return_at=NOW()";
  }else if(type==='exchange'){
    setSql = "exchange_count=COALESCE(exchange_count,0)+1, last_exchange_at=NOW()";
  }else{
    return fail(res,400,'event_type must be detail/cart/wish/order/return/exchange');
  }
  try{
    const r=await pool.query(`UPDATE gm_product SET ${setSql}, updated_at=NOW() WHERE ${where} RETURNING product_uid,mall_code,pi_ii_vi,detail_view_count,cart_count,wish_count,order_count,order_qty_total,sales_qty,sales_amount`, vals);
    ok(res,{action:'product.event',type,event_key:eventKey,updated:r.rowCount,item:r.rows[0]||null});
  }catch(e){ fail(res,500,'product event failed',{detail:String(e&&e.message||e)}); }
});

module.exports = router;
