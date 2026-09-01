const API = location.origin;
const tables = {
  products:'상품 gm_product',
  product_options:'상품 옵션 gm_product_option',
  product_image_vector:'상품 이미지 Vector gm_product_image_vector',
  image_vector_pending:'이미지 Vector 미수행 gm_image_vector_pending',
  cart:'장바구니 gm_basket',
  orders:'주문 gm_order',
  order_items:'주문상품 gm_order_item',
  supplier:'공급사 gm_supplier',
  cs:'CS gm_cs',
  cs_messages:'CS 메시지 gm_cs_message',
  member:'회원 gm_member',
  member_address:'회원 배송지 gm_member_address',
  product_archive:'상품 아카이브 gm_product_archive',
  category:'카테고리 gm_category',
  category_keyword:'카테고리 검색어 gm_category_keyword',
  search_keyword_stat:'검색어 통계 gm_search_keyword_stat',
  category_search_stat:'카테고리 통계 gm_category_search_stat',
  category_search_monthly:'카테고리 월별 통계 gm_category_search_monthly',
  category_search_yearly:'카테고리 연간 검색 통계 gm_category_search_yearly',
  product_sales_monthly:'상품 월별 판매 gm_product_sales_monthly',
  product_sales_yearly:'상품 연간 판매 gm_product_sales_yearly',
  product_country_sales_monthly:'상품 국가별 월별 판매 gm_product_country_sales_monthly',
  product_country_sales_yearly:'상품 국가별 연간 판매 gm_product_country_sales_yearly',
  category_sales_monthly:'카테고리 월별 판매 gm_category_sales_monthly',
  category_sales_yearly:'카테고리 연간 판매 gm_category_sales_yearly',
  category_country_sales_monthly:'카테고리 국가별 월별 판매 gm_category_country_sales_monthly',
  category_country_sales_yearly:'카테고리 국가별 연간 판매 gm_category_country_sales_yearly',
  keyword_relation:'연관검색어 gm_keyword_relation', keyword_translate:'외국어검색어 gm_keyword_translate',
  smartfit_space:'SmartFit 공간 gm_smartfit_space',
  smartfit_template:'SmartFit Template gm_smartfit_template',
  smartfit_template_vector:'SmartFit Template Vector gm_smartfit_template_vector',
  smartfit_space_vector:'SmartFit Space Vector gm_smartfit_space_vector',
  smartfit_item:'SmartFit Item gm_smartfit_item',
  smartfit_collection:'SmartFit 컬렉션 gm_smartfit_collection',
  smartfit_category:'SmartFit 카테고리 gm_smartfit_category',
  search_log:'검색 로그 gm_search_log',
  category_dynamic:'동적 카테고리 gm_category_dynamic',
  product_interest:'상품 관심 gm_product_interest',
  product_upsert_queue:'상품 저장 큐 gm_product_upsert_queue',
  sales_aggregate_event:'판매 집계 이벤트 gm_sales_aggregate_event',
  member_ledger:'회원 원장 gm_member_ledger',
  member_payment_info:'회원 결제정보 gm_member_payment_info',
  member_device:'회원 기기 gm_member_device',
  member_relation_count:'회원 관계 집계 gm_member_relation_count',
  guest_member_link:'비회원-회원 연결 gm_guest_member_link',
  network_incentive_rate:'네트워크 인센티브율 gm_network_incentive_rate',
  network_payment_snapshot:'네트워크 지급 스냅샷 gm_network_payment_snapshot',
  message_policy:'메시지 정책 gm_message_policy',
  message_personal:'개인 메시지 gm_message_personal',
  message_broadcast:'단체 메시지 gm_message_broadcast',
  message_broadcast_receive:'단체 메시지 수신 gm_message_broadcast_receive',
  message_share:'공유 메시지 gm_message_share',
  message_share_receiver:'공유 메시지 수신 gm_message_share_receiver',
  message_counter_daily:'메시지 일별 카운터 gm_message_counter_daily',
  message_broadcast_job:'단체 메시지 작업 gm_message_broadcast_job',
  order_message:'주문 메시지 gm_order_message',
  event_queue:'이벤트 큐 gm_event_queue',
  smartfit_internal_sale:'SmartFit 내부판매 gm_smartfit_internal_sale',
  smartfit_collection_item_delta:'SmartFit 컬렉션 변경 gm_smartfit_collection_item_delta',
  smartfit_space_subscriber:'SmartFit 공간 구독자 gm_smartfit_space_subscriber',
  smartfit_subscribe:'SmartFit 작성자 구독 gm_smartfit_subscribe',
  smartfit_message_receiver:'SmartFit 메시지 수신 gm_smartfit_message_receiver',
  dashboard_snapshot:'대시보드 스냅샷 gm_dashboard_snapshot'
};
const tableNameMap = {
  gm_image_vector_pending:'image_vector_pending',
  gm_product_image_vector:'product_image_vector', gm_product_option:'product_options', gm_product:'products', gm_product_archive:'product_archive',
  gm_category:'category', gm_category_keyword:'category_keyword',
  gm_search_keyword_stat:'search_keyword_stat', gm_category_search_stat:'category_search_stat', gm_category_search_monthly:'category_search_monthly', gm_category_search_yearly:'category_search_yearly', gm_product_sales_monthly:'product_sales_monthly', gm_product_sales_yearly:'product_sales_yearly', gm_product_country_sales_monthly:'product_country_sales_monthly', gm_product_country_sales_yearly:'product_country_sales_yearly', gm_category_sales_monthly:'category_sales_monthly', gm_category_sales_yearly:'category_sales_yearly', gm_category_country_sales_monthly:'category_country_sales_monthly', gm_category_country_sales_yearly:'category_country_sales_yearly',
  gm_basket:'cart', gm_order:'orders', gm_order_item:'order_items', gm_supplier:'supplier',
  gm_cs:'cs', gm_cs_message:'cs_messages', gm_member:'member', gm_member_address:'member_address', gm_keyword_relation:'keyword_relation', gm_keyword_translate:'keyword_translate',
  gm_smartfit_space_vector:'smartfit_space_vector', gm_smartfit_template_vector:'smartfit_template_vector', gm_smartfit_space:'smartfit_space', gm_smartfit_template:'smartfit_template', gm_smartfit_item:'smartfit_item', gm_smartfit_collection:'smartfit_collection', gm_smartfit_category:'smartfit_category',
  gm_category_dynamic:'category_dynamic', gm_product_interest:'product_interest', gm_product_upsert_queue:'product_upsert_queue', gm_sales_aggregate_event:'sales_aggregate_event',
  gm_member_ledger:'member_ledger', gm_member_payment_info:'member_payment_info', gm_member_device:'member_device', gm_member_relation_count:'member_relation_count', gm_guest_member_link:'guest_member_link',
  gm_network_incentive_rate:'network_incentive_rate', gm_network_payment_snapshot:'network_payment_snapshot',
  gm_message_policy:'message_policy', gm_message_personal:'message_personal', gm_message_broadcast:'message_broadcast', gm_message_broadcast_receive:'message_broadcast_receive', gm_message_share:'message_share', gm_message_share_receiver:'message_share_receiver', gm_message_counter_daily:'message_counter_daily', gm_message_broadcast_job:'message_broadcast_job', gm_order_message:'order_message', gm_event_queue:'event_queue',
  gm_smartfit_internal_sale:'smartfit_internal_sale', gm_smartfit_collection_item_delta:'smartfit_collection_item_delta', gm_smartfit_space_subscriber:'smartfit_space_subscriber', gm_smartfit_subscribe:'smartfit_subscribe', gm_smartfit_message_receiver:'smartfit_message_receiver',
  gm_search_log:'search_log', gm_dashboard_snapshot:'dashboard_snapshot'
};

let builderTableSpecPromise=null;
async function loadBuilderTableSpecs(){
  if(!builderTableSpecPromise){
    builderTableSpecPromise=fetch(`${API}/api/gm/builder/tables?t=${Date.now()}`).then(async r=>{
      if(!r.ok) throw new Error(`Builder 테이블 목록 HTTP ${r.status}`);
      const j=await r.json();
      if(!j.ok || !Array.isArray(j.tables)) throw new Error('Builder 테이블 목록 응답 오류');
      return j.tables;
    }).catch(e=>{ builderTableSpecPromise=null; throw e; });
  }
  return builderTableSpecPromise;
}
async function fillSelect(id){
  const el=document.getElementById(id); if(!el)return;
  try{
    const specs=await loadBuilderTableSpecs();
    el.innerHTML=specs.map(x=>`<option value="${x.key}">${tables[x.key]||x.table}</option>`).join('');
  }catch(e){ el.innerHTML='<option value="">테이블 목록 조회 실패</option>'; log(String(e&&e.message||e)); }
}
async function fillChecks(id){
  const el=document.getElementById(id); if(!el)return;
  try{
    const specs=await loadBuilderTableSpecs();
    el.innerHTML=specs.map(x=>`<label class="check"><input type="checkbox" class="exportTableCheck" value="${x.key}" checked><span>${tables[x.key]||x.table}</span></label>`).join('');
  }catch(e){ el.innerHTML='<div class="small">테이블 목록 조회 실패</div>'; log(String(e&&e.message||e)); }
}
function startButtonTimer(button,label){ if(!button)return null; const s={button,original:button.textContent,seconds:0,label,timer:null}; button.disabled=true; button.textContent=`${label} · 0초`; s.timer=setInterval(()=>{s.seconds++;button.textContent=`${s.label} · ${s.seconds}초`;},1000); return s; }
function setButtonTimerLabel(s,label){ if(!s)return; s.label=label; s.button.textContent=`${label} · ${s.seconds}초`; }
function stopButtonTimer(s){ if(!s)return; clearInterval(s.timer); s.button.disabled=false; s.button.textContent=s.original; }
function log(x){ const el=document.getElementById('log'); if(el) el.textContent=typeof x==='string'?x:JSON.stringify(x,null,2); }
function inferTableFromFileName(name){ const lower=String(name||'').toLowerCase(); const entries=Object.entries(tableNameMap).sort((a,b)=>b[0].length-a[0].length); for(const [db,key] of entries){ if(lower.includes(db.toLowerCase())) return key; } return ''; }
async function readCsvText(file){
  const buf=await file.arrayBuffer();
  const name=String(file&&file.name||'').toLowerCase();
  if(name.endsWith('.xlsx') || name.endsWith('.xls')){
    if(!window.XLSX) throw new Error('Excel 변환 모듈을 불러오지 못했습니다. 페이지를 새로고침하세요.');
    const wb=XLSX.read(buf,{type:'array',cellDates:false,raw:false});
    const sheetName=wb.SheetNames[0];
    if(!sheetName) throw new Error('Excel 파일에 시트가 없습니다.');
    return XLSX.utils.sheet_to_csv(wb.Sheets[sheetName],{FS:',',RS:'\n',blankrows:false});
  }
  let text=new TextDecoder('utf-8').decode(buf);
  if((text.match(/�/g)||[]).length>5){
    try{ text=new TextDecoder('euc-kr').decode(buf); }catch(e){}
  }
  return text;
}
function isCafe24MemberCsvText(text){
  const first=String(text||'').split(/\r?\n/)[0]||'';
  return first.indexOf('아이디')>=0 && (first.indexOf('휴대폰번호')>=0 || first.indexOf('회원등급')>=0 || first.indexOf('회원 가입일')>=0);
}
async function uploadCafe24MemberText(text,fileName,apply){
  const url=`${API}/api/gm/builder/cafe24-member-import?apply=${apply?'YES':'NO'}`;
  const r=await fetch(url,{method:'POST',headers:{'Content-Type':'text/csv; charset=utf-8'},body:text});
  if(!r.ok){ const t=await r.text(); throw new Error(`HTTP ${r.status}: ${t.slice(0,500)}`); }
  await downloadCsvResponse(r,(apply?'member_apply':'member_dryrun')+'_result_'+Date.now()+'.csv');
  log({action:'cafe24-member-import',apply,status:r.status,file:fileName||'',result:'CSV result downloaded'});
}
async function downloadCsvResponse(r,filename){ const blob=await r.blob(); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=filename; document.body.appendChild(a); a.click(); setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},1500); }
async function loadDashboard(){ return; }
