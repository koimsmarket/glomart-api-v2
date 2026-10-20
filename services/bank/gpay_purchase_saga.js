'use strict';
// GM_GPAY_V067. Transaction journaling only; no money movement without verified service handlers.
// Never roll back an already issued G-PAY request merely because purchase was cancelled.
const STATUSES=new Set(['ORDER_PENDING','POINT_RESERVED','GPAY_UNKNOWN','GPAY_PAID','ORDER_PAID','DELIVERED','PURCHASE_CONFIRMED','RECONCILE_REQUIRED','CANCELLED','COMPENSATED']);
const NEXT={
 ORDER_PENDING:new Set(['POINT_RESERVED','GPAY_UNKNOWN','CANCELLED','RECONCILE_REQUIRED']),
 POINT_RESERVED:new Set(['GPAY_UNKNOWN','GPAY_PAID','CANCELLED','RECONCILE_REQUIRED']),
 GPAY_UNKNOWN:new Set(['GPAY_PAID','RECONCILE_REQUIRED']),
 GPAY_PAID:new Set(['ORDER_PAID','RECONCILE_REQUIRED']),
 ORDER_PAID:new Set(['DELIVERED','CANCELLED','RECONCILE_REQUIRED']),
 DELIVERED:new Set(['PURCHASE_CONFIRMED','RECONCILE_REQUIRED']),
 PURCHASE_CONFIRMED:new Set([]),
 RECONCILE_REQUIRED:new Set(['GPAY_PAID','ORDER_PAID','DELIVERED','COMPENSATED']),
 CANCELLED:new Set(['COMPENSATED']),
 COMPENSATED:new Set([])
};
function positiveInt(v,name){if(!Number.isSafeInteger(v)||v<0)throw new Error(name+'_invalid');return v;}
function validate(input){
 const a={tx_id:String(input.tx_id||'').trim(),order_no:String(input.order_no||'').trim(),member_id:String(input.member_id||'').trim(),gpay_request_no:input.gpay_request_no?String(input.gpay_request_no).trim():null,
 product_amount_krw:positiveInt(input.product_amount_krw,'product_amount'),shipping_amount_krw:positiveInt(input.shipping_amount_krw,'shipping_amount'),point_used_krw:positiveInt(input.point_used_krw,'point_used'),gpay_amount:positiveInt(input.gpay_amount,'gpay_amount')};
 if(!a.tx_id||!a.order_no||!a.member_id)throw new Error('transaction_identity_required');
 if(a.point_used_krw>Math.floor(a.product_amount_krw*0.2/10)*10||a.point_used_krw%10!==0)throw new Error('point_amount_invalid');
 if(a.gpay_amount!==a.product_amount_krw+a.shipping_amount_krw-a.point_used_krw)throw new Error('settlement_amount_mismatch');
 return a;
}
async function createIntent(pool,input){
 const v=validate(input),client=await pool.connect();
 try{await client.query('BEGIN');
 const ins=await client.query(`INSERT INTO gm_purchase_saga(tx_id,order_no,member_id,gpay_request_no,product_amount_krw,shipping_amount_krw,point_used_krw,gpay_amount)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(tx_id) DO NOTHING RETURNING *`,[v.tx_id,v.order_no,v.member_id,v.gpay_request_no,v.product_amount_krw,v.shipping_amount_krw,v.point_used_krw,v.gpay_amount]);
 const row=ins.rows[0]||(await client.query('SELECT * FROM gm_purchase_saga WHERE tx_id=$1 FOR UPDATE',[v.tx_id])).rows[0];
 if(!row||['order_no','member_id','gpay_request_no','product_amount_krw','shipping_amount_krw','point_used_krw','gpay_amount'].some(k=>String(row[k]??'')!==String(v[k]??'')))throw new Error('idempotent_payload_mismatch');
 await client.query('COMMIT');return row;
 }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}
}
async function advance(pool,{tx_id,expected,to,event_key,remote_ref=null,error_code=null}){
 if(!STATUSES.has(expected)||!STATUSES.has(to)||!NEXT[expected]?.has(to))throw new Error('illegal_transition');
 if(!tx_id||!event_key)throw new Error('transaction_or_event_key_missing');
 const client=await pool.connect();try{await client.query('BEGIN');
 const got=await client.query('SELECT * FROM gm_purchase_saga WHERE tx_id=$1 FOR UPDATE',[tx_id]);
 if(!got.rows.length)throw new Error('purchase_transaction_not_found');
 const prior=await client.query('SELECT * FROM gm_purchase_saga_event WHERE tx_id=$1 AND event_key=$2',[tx_id,event_key]);
 if(prior.rows.length){if(prior.rows[0].step!==to)throw new Error('event_key_mismatch');await client.query('COMMIT');return {idempotent:true,status:got.rows[0].status};}
 if(got.rows[0].status!==expected)throw new Error('state_mismatch_requires_reconcile');
 // These are journaling transitions only: caller must have independently verified the remote result.
 await client.query('UPDATE gm_purchase_saga SET status=$2,gpay_payment_ref=COALESCE($3,gpay_payment_ref),last_error_code=$4,version=version+1,updated_at=NOW() WHERE tx_id=$1',[tx_id,to,remote_ref,error_code]);
 await client.query(`INSERT INTO gm_purchase_saga_event(tx_id,event_key,step,result,remote_ref,error_code) VALUES($1,$2,$3,'RECORDED',$4,$5)`,[tx_id,event_key,to,remote_ref,error_code]);
 await client.query('COMMIT');return {idempotent:false,status:to};
 }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}
}
async function getStatus(pool,tx_id){const q=await pool.query('SELECT * FROM gm_purchase_saga WHERE tx_id=$1',[tx_id]);return q.rows[0]||null;}
module.exports={validate,createIntent,advance,getStatus,NEXT};
