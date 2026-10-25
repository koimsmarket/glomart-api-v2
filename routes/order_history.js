/* routes/order_history.js
 * GM_ORDER_HISTORY_ROUTE_V005_REFUND_METHOD
 * GM 주문조회 + 외부주문 고객 CS 액션 API.
 */
'use strict';
const express = require('express');
const router = express.Router();
const service = require('../services/order_history_service');
const cancelShipping = require('../services/GM_ORDER_CANCEL_SHIPPING');
const r2 = require('../services/r2');
const VERSION = 'GM_ORDER_HISTORY_ROUTE_V005_REFUND_METHOD';
function clean(v){ return String(v == null ? '' : v).trim(); }
function db(req){ return req.app.locals.db || req.app.locals.pool; }
function statusFor(error){
  const m = clean(error && error.message || error);
  if(['member_id_required','order_no_required','action_required','unsupported_action','refund_method_required','refund_amount_required','shipping_fee_confirmation_required','shipping_quote_changed','cs_selection_required','cs_selection_invalid'].includes(m)) return 400;
  if(m === 'order_not_found') return 404;
  if(['action_not_allowed_for_current_status','cafe24_action_must_use_cafe24_bridge','mixed_order_requires_item_selection','deposit_refund_already_applied','purchase_already_confirmed','cs_request_deadline_passed'].includes(m)) return 409;
  if(['refund_account_not_registered','member_not_found','deposit_balance_not_found','fresh_cs_deadline_not_available','delivery_time_unverified'].includes(m)) return 422;
  return 500;
}

router.get('/api/gm/order-history/list', async (req, res) => {
  const memberId = clean(req.query.member_id || req.query.memberId);
  if(!memberId) return res.status(400).json({ ok:false, version:VERSION, error:'member_id_required' });
  try{
    const result = await service.list(db(req), {
      member_id: memberId, page: req.query.page, limit: req.query.limit,
      start_date: req.query.start_date, end_date: req.query.end_date,
      order_status: req.query.order_status,
      cs_only: req.query.cs_only,
      mode: req.query.mode
    });
    console.log('[GM_ORDER_HISTORY_LIST_OK]', JSON.stringify({ member_id:memberId, page:result.page, total:result.total, cs_only:req.query.cs_only||'' }));
    return res.json({ ok:true, version:VERSION, ...result });
  }catch(error){
    console.error('[GM_ORDER_HISTORY_LIST_FAIL]', String(error && error.message || error));
    return res.status(statusFor(error)).json({ ok:false, version:VERSION, error:String(error && error.message || error) });
  }
});

router.get('/api/gm/order-history/detail', async (req, res) => {
  try{
    const order = await service.detail(db(req), { member_id:req.query.member_id || req.query.memberId, order_no:req.query.order_no || req.query.orderNo });
    console.log('[GM_ORDER_HISTORY_DETAIL_OK]', JSON.stringify({ member_id:clean(req.query.member_id||req.query.memberId), order_no:order.order_no, source_type:order.source_type }));
    return res.json({ ok:true, version:VERSION, order });
  }catch(error){
    console.error('[GM_ORDER_HISTORY_DETAIL_FAIL]', String(error && error.message || error));
    return res.status(statusFor(error)).json({ ok:false, version:VERSION, error:String(error && error.message || error) });
  }
});

router.get('/api/gm/order-cs/shipping-quote', async(req,res)=>{
  const mid=clean(req.query.member_id||req.query.memberId),no=clean(req.query.order_no||req.query.orderNo);
  if(!mid||!no)return res.status(400).json({ok:false,error:'order_identity_required'});
  try{
    const pool=db(req);
    const oq=await pool.query('SELECT * FROM gm_order WHERE order_no=$1 AND member_id=$2',[no,mid]);
    if(!oq.rows.length)return res.status(404).json({ok:false,error:'order_not_found'});
    const iq=await pool.query('SELECT * FROM gm_order_item WHERE order_no=$1 ORDER BY created_at ASC, pi_ii_vi ASC',[no]);
    const csAction=clean(req.query.action);
    let quotedItems=iq.rows;
    if(['exchange_request','return_request'].includes(csAction)){
      const raw=JSON.parse(clean(req.query.selected_items)||'[]');
      quotedItems=service.selectCsItemsForQuote(oq.rows[0],iq.rows,raw);
    }
    const quote=cancelShipping.quote(oq.rows[0],quotedItems,req.query.reason_code);
    const deposit=await pool.query("SELECT COALESCE(withdraw_amount,0) AS used FROM gm_deposit_transaction WHERE order_no=$1 AND member_id=$2 AND transaction_type='ORDER_USE' ORDER BY transaction_id ASC LIMIT 1",[no,mid]);
    if(['exchange_request','return_request'].includes(csAction)){
      quote.confirmation_fingerprint=cancelShipping.quoteFingerprint(no,csAction,req.query.reason_code,JSON.parse(clean(req.query.selected_items)||'[]'),quote);
    }
    quote.refund_preview=cancelShipping.refundPreview(oq.rows[0],quote.customer_shipping_fee,deposit.rows[0]&&deposit.rows[0].used);
    console.log('[GM_CANCEL_SHIPPING_QUOTE]',JSON.stringify({order_no:no,reason_code:quote.reason_code,shipping_fee:quote.customer_shipping_fee,group_count:quote.groups.length}));
    return res.json({ok:true,order_no:no,quote});
  }catch(e){console.error('[GM_CANCEL_SHIPPING_QUOTE_ERROR]',String(e&&e.message||e));return res.status(500).json({ok:false,error:'shipping_quote_failed'});}
});

router.post('/api/gm/order-cs/action', async (req, res) => {
  const body = req.body || {};
  try{
    const result = await service.action(db(req), {
      member_id:body.member_id || body.memberId,
      order_no:body.order_no || body.orderNo,
      action:body.action,
      reason_code:body.reason_code || body.reasonCode,
      reason_text:body.reason_text || body.reasonText,
      refund_method:body.refund_method || body.refundMethod,
      shipping_fee_ack:body.shipping_fee_ack===true,
      shipping_fee_confirmed:body.shipping_fee_confirmed,
      selected_items:body.selected_items,
      quote_fingerprint:body.quote_fingerprint,
      seller_shipping_fee_confirmed:body.seller_shipping_fee_confirmed
    });
    console.log('[GM_ORDER_CS_ACTION_OK]', JSON.stringify({ member_id:clean(body.member_id||body.memberId), order_no:clean(body.order_no||body.orderNo), action:clean(body.action) }));
    return res.json({ ok:true, version:VERSION, ...result });
  }catch(error){
    console.error('[GM_ORDER_CS_ACTION_FAIL]', JSON.stringify({ order_no:clean(body.order_no||body.orderNo), action:clean(body.action), error:String(error && error.message || error) }));
    return res.status(statusFor(error)).json({ ok:false, version:VERSION, error:String(error && error.message || error) });
  }
});

// GM_CS_PHOTO_V001: each application has 10 reserved slots, max 6 images.
function photoKind(action){return action==='return'?'return':action==='exchange'?'exchange':null;}
function historyColumn(kind){return kind==='return'?'return_image_history':'exchange_image_history';}
function parseHistory(value){
  const entries=String(value||'').split('|').filter(Boolean);
  for(let i=0;i<entries.length;i++)if(entries[i]!==`${i+1}:${Number(entries[i].split(':')[1])}` || !/^[0-6]$/.test(entries[i].split(':')[1]))throw new Error('cs_photo_history_invalid');
  return entries.map(x=>Number(x.split(':')[1]));
}
function photoKey(orderNo,kind,round,slot){
  const m=/^(\d{4})(\d{2})(\d{2})-([A-Z]\d{7})$/.exec(String(orderNo));
  if(!m)throw new Error('cs_photo_order_number_invalid');
  if(!Number.isSafeInteger(round)||round<1||!Number.isSafeInteger(slot)||slot<1||slot>6)throw new Error('cs_photo_slot_invalid');
  const imageNo=(round-1)*10+slot;
  // The order serial restarts EVERY DAY. Day folder is required to prevent collisions.
  return `order-cs/${m[1]}/${m[2]}/${m[3]}/${kind}/${m[4]}_${String(imageNo).padStart(2,'0')}.webp`;
}
async function photoOrder(req,lock=false){
  const b=req.body||{};
  const member=clean(b.member_id),no=clean(b.order_no);
  if(!member||!no)throw new Error('order_identity_required');
  const pool=db(req);
  const result=await pool.query('SELECT order_no,member_id,customer_status,return_image_history,exchange_image_history FROM gm_order WHERE member_id=$1 AND order_no=$2'+(lock?' FOR UPDATE':''),[member,no]);
  if(!result.rows.length)throw new Error('order_not_found');
  return result.rows[0];
}
// Caller uses existing order member identity contract; new independent auth is not introduced.
router.post('/api/gm/order-cs/photos/prepare',async(req,res)=>{
  try{
    const b=req.body||{},kind=photoKind(clean(b.kind)),count=Number(b.count),round=Number(b.round);
    if(!kind||!Number.isSafeInteger(count)||count<1||count>6||!Number.isSafeInteger(round))throw new Error('cs_photo_request_invalid');
    const order=await photoOrder(req),history=parseHistory(order[historyColumn(kind)]);
    if(round!==history.length||history[round-1]!==0||clean(order.customer_status)!==kind.toUpperCase()+'_REQUESTED')throw new Error('cs_photo_round_not_active');
    const uploads=Array.from({length:count},(_,i)=>({slot:i+1,put_url:r2.presignedPutUrl(photoKey(order.order_no,kind,round,i+1)),content_type:'image/webp'}));
    return res.json({ok:true,round,uploads});
  }catch(e){console.error('[GM_CS_PHOTO_PREPARE_FAIL]',String(e.message||e));return res.status(409).json({ok:false,error:String(e.message||e)});}
});
router.post('/api/gm/order-cs/photos/commit',async(req,res)=>{
  const b=req.body||{},kind=photoKind(clean(b.kind)),round=Number(b.round),count=Number(b.count);
  if(!kind||!Number.isSafeInteger(round)||!Number.isSafeInteger(count)||count<1||count>6)return res.status(400).json({ok:false,error:'cs_photo_request_invalid'});
  const pool=db(req),client=typeof pool.connect==='function'?await pool.connect():pool;
  try{
    await client.query('BEGIN');
    const result=await client.query('SELECT * FROM gm_order WHERE member_id=$1 AND order_no=$2 FOR UPDATE',[clean(b.member_id),clean(b.order_no)]);
    if(!result.rows.length)throw new Error('order_not_found');
    const o=result.rows[0],col=historyColumn(kind),history=parseHistory(o[col]);
    if(round!==history.length||history[round-1]!==0||clean(o.customer_status)!==kind.toUpperCase()+'_REQUESTED')throw new Error('cs_photo_round_not_active');
    for(let slot=1;slot<=count;slot++){
      const metadata=await r2.headObject(photoKey(o.order_no,kind,round,slot));
      if(metadata.content_type!=='image/webp'||metadata.content_length<1||metadata.content_length>300*1024)throw new Error('cs_photo_size_or_type_invalid');
    }
    history[round-1]=count;
    await client.query('UPDATE gm_order SET '+col+'=$3 WHERE member_id=$1 AND order_no=$2',[o.member_id,o.order_no,history.map((n,i)=>`${i+1}:${n}`).join('|')]);
    await client.query('COMMIT');
    console.log('[GM_CS_PHOTO_COMMITTED]',JSON.stringify({order_no:o.order_no,kind,round,count}));
    return res.json({ok:true,round,count});
  }catch(e){try{await client.query('ROLLBACK');}catch(_){}console.error('[GM_CS_PHOTO_COMMIT_FAIL]',String(e.message||e));return res.status(409).json({ok:false,error:String(e.message||e)});}
  finally{if(client!==pool&&typeof client.release==='function')client.release();}
});
router.post('/api/gm/order-cs/photos/history',async(req,res)=>{
  try{
    const kind=photoKind(clean((req.body||{}).kind));if(!kind)throw new Error('cs_photo_kind_invalid');
    const o=await photoOrder(req),counts=parseHistory(o[historyColumn(kind)]);
    return res.json({ok:true,history:counts.map((count,i)=>({round:i+1,count,images:Array.from({length:count},(_,j)=>r2.publicUrl(photoKey(o.order_no,kind,i+1,j+1)))}))});
  }catch(e){return res.status(400).json({ok:false,error:String(e.message||e)});}
});

console.log('[' + VERSION + '] routes/order_history registered');
module.exports = router;
