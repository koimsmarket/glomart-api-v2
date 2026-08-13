/* services/order_cs_service.js | GM_ORDER_CS_SERVICE_V003_AUTO_ORDER_CANCEL_GUARD */
'use strict';
const history=require('./order_history_service');const VERSION='GM_ORDER_CS_SERVICE_V003_AUTO_ORDER_CANCEL_GUARD';
function text(v){return String(v==null?'':v).trim();}
function cafe24Url(action,cafeNo){const base='/myshop/order/';if(action==='detail')return base+'detail.html?order_id='+encodeURIComponent(cafeNo);if(action.indexOf('exchange')===0)return base+'exchange.html?order_id='+encodeURIComponent(cafeNo);if(action.indexOf('return')===0)return base+'return.html?order_id='+encodeURIComponent(cafeNo);return base+'cancel.html?order_id='+encodeURIComponent(cafeNo);}
function allowed(order,action){const a=order.actions||{};return {direct_cancel:a.direct_cancel,cancel_request:a.cancel_request,cancel_withdraw:a.cancel_withdraw,exchange_request:a.exchange_request,exchange_withdraw:a.exchange_withdraw,return_request:a.return_request,return_withdraw:a.return_withdraw,purchase_confirm:a.purchase_confirm,shipping_trace:a.shipping_trace}[action]===true;}
async function action(pool,input){
  const memberId=text(input.member_id),orderNo=text(input.order_no),act=text(input.action);if(!memberId)throw new Error('member_id_required');if(!orderNo)throw new Error('order_no_required');if(!act)throw new Error('action_required');
  const order=await history.detail(pool,{member_id:memberId,order_no:orderNo});
  if(order.source_type==='MIXED')throw new Error('mixed_order_requires_item_selection');
  if(order.source_type==='CAFE24'){
    if(!order.cafe24_order_no)throw new Error('cafe24_order_no_missing');
    return {version:VERSION,cafe24_handoff:true,cafe24_url:cafe24Url(act,order.cafe24_order_no),order_no:orderNo};
  }
  if(act==='shipping_trace'){
    const item=(order.items||[]).find(x=>text(x.tracking_number));return {version:VERSION,tracking_number:item?item.tracking_number:'',carrier_name:item?item.carrier_name:''};
  }
  if(!allowed(order,act))throw new Error('action_not_allowed');
  const reasonCode=text(input.reason_code),reasonText=text(input.reason_text),now=new Date();
  let sql='',params=[];
  if(act==='direct_cancel'){
    sql=`UPDATE gm_order SET seller_status='CANCELLED',customer_status='CANCEL_COMPLETED',cs_status='CANCEL_COMPLETED',cancel_status='completed',cs_reason_code=$3,cs_reason_text=$4,cs_requested_at=COALESCE(cs_requested_at,$5),cs_completed_at=$5,cancel_requested_at=COALESCE(cancel_requested_at,$5),cancel_completed_at=$5,updated_at=$5 WHERE member_id=$1 AND order_no=$2 RETURNING order_no`;params=[memberId,orderNo,reasonCode,reasonText,now];
  }else if(['cancel_request','exchange_request','return_request'].includes(act)){
    const map={cancel_request:'CANCEL_REQUESTED',exchange_request:'EXCHANGE_REQUESTED',return_request:'RETURN_REQUESTED'};const cancelStatus=act==='cancel_request'?'requested':'none';
    sql=`UPDATE gm_order SET customer_status=$3,cs_status=$3,cs_reason_code=$4,cs_reason_text=$5,cs_requested_at=$6,cancel_status=$7,cancel_requested_at=CASE WHEN $3='CANCEL_REQUESTED' THEN $6 ELSE cancel_requested_at END,updated_at=$6 WHERE member_id=$1 AND order_no=$2 RETURNING order_no`;params=[memberId,orderNo,map[act],reasonCode,reasonText,now,cancelStatus];
  }else if(['cancel_withdraw','exchange_withdraw','return_withdraw'].includes(act)){
    const map={cancel_withdraw:'CANCEL_WITHDRAWN',exchange_withdraw:'EXCHANGE_WITHDRAWN',return_withdraw:'RETURN_WITHDRAWN'};
    sql=`UPDATE gm_order SET customer_status=$3,cs_status=$3,cs_withdrawn_at=$4,cancel_status=CASE WHEN $3='CANCEL_WITHDRAWN' THEN 'none' ELSE cancel_status END,updated_at=$4 WHERE member_id=$1 AND order_no=$2 RETURNING order_no`;params=[memberId,orderNo,map[act],now];
  }else if(act==='purchase_confirm'){
    sql=`UPDATE gm_order SET customer_status='PURCHASE_CONFIRMED',purchase_confirmed_yn='Y',purchase_confirmed_at=$3,updated_at=$3 WHERE member_id=$1 AND order_no=$2 RETURNING order_no`;params=[memberId,orderNo,now];
  }else throw new Error('unsupported_action');
  const r=await pool.query(sql,params);if(!r.rowCount)throw new Error('order_not_found');
  /* [AUTO-ORDER CANCEL GUARD] 라우트 우선순위가 바뀌어도 direct_cancel은 work까지 즉시 중단한다. */
  if(act==='direct_cancel'){
    await pool.query(`UPDATE gm_auto_order SET cancel_status='CANCELLED',process_status='CANCELLED',updated_at=now() WHERE order_no=$1`,[orderNo]);
    await pool.query(`UPDATE gm_auto_order_work w SET work_status='CANCELLED',lock_token=NULL,lock_admin_id=NULL,lock_mall_account_id=NULL,lock_at=NULL,lock_expires_at=NULL,error_code='CUSTOMER_CANCELLED',error_message='Glomart 주문이 고객에 의해 취소되어 자동주문 작업을 즉시 중단함',updated_at=now() FROM gm_auto_order a WHERE a.auto_order_no=w.auto_order_no AND a.order_no=$1 AND upper(COALESCE(w.work_status,'')) NOT IN ('COMPLETED','CANCELLED')`,[orderNo]);
  }
  return {version:VERSION,order_no:orderNo,action:act,ok:true};
}
module.exports={VERSION,action};
