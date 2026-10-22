// GM_BUILDER_MENU_V001: two-level navigation using existing tab IDs and existing pages.
(function(){
  'use strict';
  const KEY='gm_builder_active_tab';
  const GROUP_KEY='gm_builder_menu_group';
  const menus=[
    {id:'data',title:'데이터 관리',items:[['inventory','전체 테이블'],['status','DB / Queue'],['/builder/record_editor.html','조회·수정·삭제'],['/builder/safe_update.html','안전 업데이트']]},
    {id:'transfer',title:'업로드 / 다운로드',items:[['/builder/download.html','종류별 다운로드'],['/builder/safe_update.html','종류별 업로드'],['/builder/members.html','회원 가져오기']]},
    {id:'build',title:'빌드 / 발행',items:[['asset','카테고리 / 사전'],['lang','언어 / 국가'],['translation','다국어 번역'],['gmcode','상품 코드']]},
    {id:'special',title:'특별 기능',items:[['vector','이미지 벡터'],['/builder/image_hnsw.html','HNSW / 대표이미지'],['purchase','구매확정'],['/builder/category_unit.html','단위가격'],['/builder/ui_dictionary_auto.html','UI 사전 자동점검'],['/builder/dev_restore.html','개발 파일 복원']]},
    {id:'operation',title:'운영 / 설정',items:[['runtime','운영 설정'],['status','현황 / 로그'],['/auto-order/','자동주문 대시보드']]}
  ];
  let group='data';
  function names(el){return String(el.getAttribute('data-builder-tab')||'').split(/\s+/).filter(Boolean);}
  function remembered(key,fallback){try{return localStorage.getItem(key)||fallback;}catch(_){return fallback;}}
  function save(key,val){try{localStorage.setItem(key,val);}catch(_){}}
  function groupOf(tab){return menus.find(m=>m.items.some(x=>x[0]===tab))?.id||'data';}
  function renderMenus(active){
    const p=document.getElementById('builderPrimaryMenu'),s=document.getElementById('builderSecondaryMenu');
    if(!p||!s)return;
    p.replaceChildren();s.replaceChildren();
    for(const m of menus){
      const btn=document.createElement('button');btn.type='button';btn.className='builder-primary-btn'+(group===m.id?' active':'');
      btn.textContent=m.title;btn.setAttribute('aria-pressed',String(group===m.id));
      btn.addEventListener('click',()=>{group=m.id;save(GROUP_KEY,group);renderMenus(active);});p.appendChild(btn);
    }
    const m=menus.find(m=>m.id===group)||menus[0];
    for(const [id,title] of m.items){
      const el=document.createElement(id[0]==='/'?'a':'button');
      el.className='builder-secondary-btn'+(id===active?' active':'');el.textContent=title;
      if(id[0]==='/'){el.href=id;}else{el.type='button';el.addEventListener('click',()=>window.openBuilderTab(id));}
      s.appendChild(el);
    }
  }
  window.openBuilderTab=function(name){
    const tab=String(name||'status');
    document.querySelectorAll('[data-builder-tab]').forEach(el=>{el.style.display=names(el).includes(tab)?'':'none';});
    document.querySelectorAll('.builder-tab-btn').forEach(btn=>btn.classList.toggle('active',btn.dataset.tab===tab));
    if(!menus.find(m=>m.id===group)?.items.some(x=>x[0]===tab))group=groupOf(tab);
    save(KEY,tab);save(GROUP_KEY,group);renderMenus(tab);
    if(tab==='inventory' && typeof window.loadBuilderInventory==='function')window.loadBuilderInventory();
    window.scrollTo({top:0,behavior:'smooth'});
  };
  // Registered table names are a local fallback only; live database discovery supersedes them.
  const registeredFallback=["gm_product", "gm_product_option", "gm_product_image_vector", "gm_image_vector_pending", "gm_smartfit_template_vector", "gm_smartfit_space_vector", "gm_basket", "gm_order", "gm_order_item", "gm_cs", "gm_cs_message", "gm_member", "gm_member_address", "gm_supplier", "gm_product_archive", "gm_category", "gm_category_keyword", "gm_search_keyword_stat", "gm_category_search_stat", "gm_category_search_monthly", "gm_category_search_yearly", "gm_product_sales_monthly", "gm_product_sales_yearly", "gm_product_country_sales_monthly", "gm_product_country_sales_yearly", "gm_category_sales_monthly", "gm_category_sales_yearly", "gm_category_country_sales_monthly", "gm_category_country_sales_yearly", "gm_ui_dictionary", "gm_keyword_translate", "gm_keyword_relation", "gm_search_log", "gm_dashboard_snapshot"];
  let currentTables=[];
  function prettyBytes(n){const v=Number(n);if(!Number.isFinite(v))return "—";if(v<1024)return v+" B";const units=["KB","MB","GB","TB"];let x=v,i=-1;do{x/=1024;i++;}while(x>=1024&&i<units.length-1);return x.toFixed(x>=100?0:x>=10?1:2)+" "+units[i];}
  window.filterBuilderInventory=function(){
    const value=String(document.getElementById('builderInventoryFilter')?.value||'').trim().toLowerCase();
    const rows=document.getElementById('builderInventoryRows');if(!rows)return;
    rows.replaceChildren();
    const filtered=currentTables.filter(x=>String(x.table||'').toLowerCase().includes(value));
    for(const spec of filtered){
      const tr=document.createElement('tr');
      for(const value of [spec.table,spec.readOnly?'자동 발견':(spec.source==='fallback'?'기준본 등록':'기존 등록'),spec.rowEstimate==null?'—':Number(spec.rowEstimate).toLocaleString()+' (추정)',spec.totalBytes==null?'—':prettyBytes(spec.totalBytes),spec.readOnly?'미등록: 권한 별도 검토':'기존 관리 정책 유지']){
        const td=document.createElement('td');td.textContent=value;tr.appendChild(td);
      }
      rows.appendChild(tr);
    }
    if(!filtered.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=5;td.textContent='해당 테이블 없음';tr.appendChild(td);rows.appendChild(tr);}
  };
  function mergeInventory(before,after){
    const index=new Map(before.map(x=>[x.table,x]));
    for(const entry of after){index.set(entry.table,{...(index.get(entry.table)||{}),...entry});}
    return [...index.values()].sort((a,b)=>a.table.localeCompare(b.table));
  }
  let inventoryRequestSerial=0;
  async function inventoryGet(url,timeoutMs){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),timeoutMs);
    try{
      const resp=await fetch(url,{cache:'no-store',signal:controller.signal});
      if(!resp.ok)throw new Error('HTTP '+resp.status);
      const body=await resp.json();
      if(!body.ok||!Array.isArray(body.tables))throw new Error('테이블 목록 응답 오류');
      return body;
    }finally{clearTimeout(timer);}
  }
  window.loadBuilderInventory=async function(){
    const request=++inventoryRequestSerial;
    const el=document.getElementById('builderInventorySummary');
    const rows=document.getElementById('builderInventoryRows');
    // Never remove the last visible inventory on refresh or slow/failing network.
    if(!currentTables.length){currentTables=registeredFallback.map(table=>({table,readOnly:false,source:'fallback',rowEstimate:null,totalBytes:null}));}
    window.filterBuilderInventory();
    if(el)el.textContent='기준본 등록 '+currentTables.length+'개 먼저 표시 · 운영 DB 전체 테이블 확인 중…';
    const url='/api/gm/builder/tables?t='+Date.now();
    // Step 1: obtain live names first; statistics are deliberately a separate DB request.
    // Keep the locally displayed list if either request fails.
    try{
      const names=await inventoryGet(url+'&phase=names',14000);
      if(request!==inventoryRequestSerial)return;
      currentTables=mergeInventory(currentTables,names.tables);
      window.filterBuilderInventory();
      if(el)el.textContent='운영 DB 테이블 '+currentTables.length+'개 확인 · 레코드 수·용량 조회 중…';
    }catch(e){
      if(request!==inventoryRequestSerial)return;
      if(el)el.textContent='운영 DB 테이블명 조회 실패: '+String(e.message||e)+' · 기존 등록 '+currentTables.length+'개 유지';
      return; // Do not start costly statistics until name discovery succeeds.
    }
    try{
      const stats=await inventoryGet(url+'&phase=stats',14000);
      if(request!==inventoryRequestSerial)return;
      currentTables=mergeInventory(currentTables,stats.tables);
      window.filterBuilderInventory();
      if(el)el.textContent='운영 DB 전체 '+currentTables.length+'개 · 건수는 통계 추정치 · 용량은 인덱스 포함';
    }catch(e){
      if(request!==inventoryRequestSerial)return;
      if(el)el.textContent='운영 DB 테이블 '+currentTables.length+'개 표시 중 · 건수/용량 조회 실패: '+String(e.message||e);
    }
  };
  window.addEventListener('DOMContentLoaded',()=>{
    const tab=remembered(KEY,'status');group=remembered(GROUP_KEY,groupOf(tab));
    if(!menus.some(m=>m.id===group))group=groupOf(tab);
    if(![...document.querySelectorAll('[data-builder-tab]')].some(el=>names(el).includes(tab)))window.openBuilderTab('status');
    else window.openBuilderTab(tab);
  });
})();
