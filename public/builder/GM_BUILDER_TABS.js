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
  let currentTables=[];
  window.filterBuilderInventory=function(){
    const value=String(document.getElementById('builderInventoryFilter')?.value||'').trim().toLowerCase();
    const rows=document.getElementById('builderInventoryRows');if(!rows)return;
    rows.replaceChildren();
    const filtered=currentTables.filter(x=>String(x.table||'').toLowerCase().includes(value));
    for(const spec of filtered){
      const tr=document.createElement('tr');
      for(const value of [spec.table,spec.readOnly?'자동 발견':'기존 등록',spec.readOnly?'미등록: 백업/수정 권한 별도 검토':'기존 관리 정책 유지']){
        const td=document.createElement('td');td.textContent=value;tr.appendChild(td);
      }
      rows.appendChild(tr);
    }
    if(!filtered.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=3;td.textContent='해당 테이블 없음';tr.appendChild(td);rows.appendChild(tr);}
  };
  window.loadBuilderInventory=async function(){
    const el=document.getElementById('builderInventorySummary');
    if(el)el.textContent='운영 DB 조회 중';
    try{
      const resp=await fetch('/api/gm/builder/tables?t='+Date.now(),{cache:'no-store'});
      if(!resp.ok)throw new Error('HTTP '+resp.status);
      const data=await resp.json();if(!data.ok||!Array.isArray(data.tables))throw new Error('테이블 목록 응답 오류');
      currentTables=data.tables;
      if(el)el.textContent='목록 '+currentTables.length+'개 / 기존 등록 '+(data.configured||0)+'개 / 자동 발견 '+(data.discovered||0)+'개'+(data.discoveryError?' · DB 검색 실패: '+data.discoveryError:'');
      window.filterBuilderInventory();
    }catch(e){if(el)el.textContent='조회 실패: '+String(e.message||e);}
  };
  window.addEventListener('DOMContentLoaded',()=>{
    const tab=remembered(KEY,'status');group=remembered(GROUP_KEY,groupOf(tab));
    if(!menus.some(m=>m.id===group))group=groupOf(tab);
    if(![...document.querySelectorAll('[data-builder-tab]')].some(el=>names(el).includes(tab)))window.openBuilderTab('status');
    else window.openBuilderTab(tab);
  });
})();
