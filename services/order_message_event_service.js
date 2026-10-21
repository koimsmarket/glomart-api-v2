/* services/order_message_event_service.js | GM_ORDER_MESSAGE_EVENT_SERVICE_V001
 * 주문/취소/반품/교환 상태 이벤트를 gm_order_message에 저장한다.
 * 기존 주문접수 메시지와 같은 테이블/언어 선택 규칙을 사용한다.
 * 메시지 실패는 주문/CS 성공 자체를 취소하지 않도록 호출부에서 별도 catch 한다.
 */
'use strict';

const VERSION='GM_ORDER_MESSAGE_EVENT_SERVICE_V001';

function s(v){ return v==null?'':String(v).replace(/[\u00A0\u200B-\u200D\uFEFF]/g,' ').replace(/\s+/g,' ').trim(); }
function validDeviceLang(v){
  const x=s(v).replace(/_/g,'-');
  if(!x || /^(und|unknown|null|undefined|false)$/i.test(x) || x.length>35) return '';
  return /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(x) ? x : '';
}
async function resolveDeviceLang(db,order,requested){
  const req=validDeviceLang(requested);
  if(req) return req;
  const member=s(order&&order.member_id);
  if(member){
    try{
      const r=await db.query(`SELECT device_lang FROM gm_member_device
        WHERE member_id=$1 AND push_enabled='Y' AND token_status='ACTIVE'
          AND COALESCE(device_lang,'')<>''
        ORDER BY last_seen_at DESC NULLS LAST, updated_at DESC NULLS LAST LIMIT 1`,[member]);
      const x=validDeviceLang(r.rows[0]&&r.rows[0].device_lang);
      if(x) return x;
    }catch(_e){}
    try{
      const r=await db.query(`SELECT device_lang,language_code,cs_language FROM gm_member WHERE member_id=$1 LIMIT 1`,[member]);
      const row=r.rows[0]||{};
      const x=validDeviceLang(row.device_lang)||validDeviceLang(row.language_code)||validDeviceLang(row.cs_language);
      if(x) return x;
    }catch(_e){}
  }
  return 'en';
}
async function findOrder(db,orderNo){
  const no=s(orderNo);
  if(!no) return null;
  const r=await db.query(`SELECT * FROM gm_order
    WHERE order_no=$1 OR cafe24_order_no=$1
    ORDER BY CASE WHEN order_no=$1 THEN 0 ELSE 1 END, created_at DESC LIMIT 1`,[no]);
  return r.rows[0]||null;
}
async function create(db,opt){
  opt=opt||{};
  const order=opt.order||await findOrder(db,opt.order_no||opt.orderNo);
  if(!order) throw new Error('order_not_found_for_message');
  const orderNo=s(order.order_no);
  const messageType=s(opt.message_type||opt.messageType).toUpperCase();
  if(!messageType) throw new Error('message_type_required');
  const deviceLang=await resolveDeviceLang(db,order,opt.device_lang||opt.deviceLang);
  // gm_order row is already FOR UPDATE in the main CS service. For the fallback route,
  // this advisory lock serializes message_seq allocation without creating duplicates.
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',[orderNo]);
  const seqR=await db.query(`SELECT COALESCE(MAX(message_seq),0)+1 AS next_seq FROM gm_order_message WHERE order_no=$1`,[orderNo]);
  const seq=Number(seqR.rows[0]&&seqR.rows[0].next_seq)||1;
  const r=await db.query(`INSERT INTO gm_order_message
    (order_no,message_seq,message_type,direct_message,device_lang,received_yn,sent_at)
    VALUES($1,$2,$3,NULL,$4,'N',CURRENT_TIMESTAMP)
    RETURNING *`,[orderNo,seq,messageType,deviceLang]);
  return {version:VERSION,item:r.rows[0],order};
}

module.exports={VERSION,validDeviceLang,resolveDeviceLang,findOrder,create};
