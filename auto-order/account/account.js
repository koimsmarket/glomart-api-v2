/* GM_AUTO_ORDER_ACCOUNT_UI_V001
 * UI prototype for gm_auto_order_account + gm_auto_order_admin_account.
 * Production rule: NEVER store plaintext password in localStorage/sessionStorage/logs.
 */
(function(){
  'use strict';
  const API = {
    list:'/api/gm/auto-order/accounts',
    create:'/api/gm/auto-order/accounts',
    update:(id)=>'/api/gm/auto-order/accounts/'+encodeURIComponent(id),
    permissions:(id)=>'/api/gm/auto-order/accounts/'+encodeURIComponent(id)+'/admins',
    permissionCreate:(id)=>'/api/gm/auto-order/accounts/'+encodeURIComponent(id)+'/admins'
  };
  const state={accounts:[],selected:null,permissions:[]};
  const $=(id)=>document.getElementById(id);
  const esc=(s)=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const toast=(m)=>{const t=$('toast');t.textContent=m;t.classList.remove('hidden');setTimeout(()=>t.classList.add('hidden'),2200)};
  const open=(id)=>$(id).classList.remove('hidden');
  const close=(id)=>$(id).classList.add('hidden');

  function demoAccounts(){
    return [
      {mall_account_id:'CPKR_MASTER',mall_code:'CPKR',account_name:'쿠팡 마스터 계정',login_id:'master***@company.com',account_status:'READY',enabled:true,current_work_id:null,last_login_at:'2026-08-19 09:42'},
      {mall_account_id:'CPKR_002',mall_code:'CPKR',account_name:'쿠팡 회사계정 2호',login_id:'order02***@company.com',account_status:'LOGIN_REQUIRED',enabled:true,current_work_id:null,last_login_at:'-'},
      {mall_account_id:'ALKR_001',mall_code:'ALKR',account_name:'알리 회사계정 1호',login_id:'ali01***@company.com',account_status:'READY',enabled:true,current_work_id:31,last_login_at:'2026-08-19 09:20'}
    ];
  }

  async function api(url,opt){
    const r=await fetch(url,Object.assign({headers:{'Content-Type':'application/json','Accept':'application/json'}},opt||{}));
    if(!r.ok) throw new Error('HTTP '+r.status);
    return r.json();
  }
  async function loadAccounts(){
    try{
      const j=await api(API.list);
      state.accounts=Array.isArray(j)?j:(j.accounts||j.rows||[]);
    }catch(e){
      // UI 제작 단계: API 미연결 시 화면 확인용 예시 데이터만 메모리에 표시.
      state.accounts=demoAccounts();
      console.warn('[GM ACCOUNT UI] API not connected; rendering in-memory demo rows only. No credentials are stored.',e);
    }
    render();
  }
  function statusClass(s){if(s==='READY')return'ready';if(s==='LOGIN_REQUIRED'||s==='MFA_REQUIRED')return'login';if(s==='BLOCKED')return'blocked';return'disabled'}
  function filtered(){
    const mall=$('mallFilter').value,st=$('statusFilter').value,k=$('keyword').value.trim().toLowerCase();
    return state.accounts.filter(a=>(!mall||a.mall_code===mall)&&(!st||a.account_status===st)&&(!k||[a.mall_account_id,a.account_name,a.login_id].some(v=>String(v||'').toLowerCase().includes(k))));
  }
  function render(){
    const rows=filtered();
    $('accountRows').innerHTML=rows.map(a=>`<tr>
      <td><strong>${esc(a.mall_account_id)}</strong></td><td>${esc(a.mall_code)}</td><td>${esc(a.account_name)}</td>
      <td class="masked-id">${esc(a.login_id||'-')}</td><td><span class="badge ${statusClass(a.account_status)}">${esc(a.account_status||'-')}</span></td>
      <td>${a.current_work_id?'<strong>#'+esc(a.current_work_id)+'</strong>':'-'}</td><td>${esc(a.last_login_at||'-')}</td>
      <td><span class="status-toggle ${a.enabled?'on':'off'}">${a.enabled?'사용':'중지'}</span></td>
      <td><div class="row-actions"><button data-act="edit" data-id="${esc(a.mall_account_id)}">수정</button><button data-act="perm" data-id="${esc(a.mall_account_id)}">권한</button></div></td>
    </tr>`).join('');
    $('emptyState').classList.toggle('hidden',rows.length>0);
    $('sumTotal').textContent=state.accounts.length;
    $('sumEnabled').textContent=state.accounts.filter(a=>a.enabled).length;
    $('sumLoginRequired').textContent=state.accounts.filter(a=>a.account_status==='LOGIN_REQUIRED'||a.account_status==='MFA_REQUIRED').length;
    $('sumLocked').textContent=state.accounts.filter(a=>a.current_work_id).length;
  }
  function newAccount(){
    $('modalTitle').textContent='외부몰 계정 등록';$('editMallAccountId').value='';$('mallCode').value='CPKR';$('mallAccountId').value='';$('mallAccountId').disabled=false;
    $('accountName').value='';$('loginId').value='';$('password').value='';$('password').required=true;$('pwHint').textContent='등록 시 필수';$('accountStatus').value='READY';$('enabled').checked=true;open('accountModal');
  }
  function editAccount(id){
    const a=state.accounts.find(x=>x.mall_account_id===id);if(!a)return;
    $('modalTitle').textContent='외부몰 계정 수정';$('editMallAccountId').value=id;$('mallCode').value=a.mall_code;$('mallAccountId').value=a.mall_account_id;$('mallAccountId').disabled=true;
    $('accountName').value=a.account_name||'';$('loginId').value=(a.login_id||'').replace(/\*/g,'');$('password').value='';$('password').required=false;$('pwHint').textContent='비워두면 기존 비밀번호 유지';$('accountStatus').value=a.account_status||'READY';$('enabled').checked=!!a.enabled;open('accountModal');
  }
  async function saveAccount(e){
    e.preventDefault();
    const editId=$('editMallAccountId').value;
    const body={mall_code:$('mallCode').value,mall_account_id:$('mallAccountId').value.trim(),account_name:$('accountName').value.trim(),login_id:$('loginId').value.trim(),account_status:$('accountStatus').value,enabled:$('enabled').checked};
    if($('password').value) body.password=$('password').value;
    try{
      if(editId) await api(API.update(editId),{method:'PUT',body:JSON.stringify(body)}); else await api(API.create,{method:'POST',body:JSON.stringify(body)});
      close('accountModal');toast('저장되었습니다.');await loadAccounts();
    }catch(err){toast('API 미연결: UI만 작성된 상태입니다.');console.warn(err)}
    finally{$('password').value='';}
  }
  async function showPermissions(id){
    state.selected=id;$('selectedAccountLabel').textContent=id;
    try{const j=await api(API.permissions(id));state.permissions=Array.isArray(j)?j:(j.rows||j.admins||[])}catch(e){state.permissions=id==='CPKR_MASTER'?[{admin_id:'derzon',role:'MASTER',can_order:true,can_payment:true,can_cancel:true,can_exchange:true,can_return:true,enabled:true}]:[]}
    renderPermissions();
  }
  function renderPermissions(){
    const id=state.selected;if(!id)return;
    $('permissionBox').innerHTML=`<div class="permission-head"><strong>${esc(id)} 사용 관리자</strong><button class="primary" id="btnAddPerm">+ 관리자 권한 추가</button></div>`+
    (state.permissions.length?`<div class="table-wrap"><table class="permission-table"><thead><tr><th>MEMBER ID</th><th>역할</th><th>주문</th><th>결제</th><th>취소</th><th>교환</th><th>반품</th><th>사용</th></tr></thead><tbody>${state.permissions.map(p=>`<tr><td><strong>${esc(p.admin_id)}</strong></td><td>${esc(p.role||'OPERATOR')}</td>${['can_order','can_payment','can_cancel','can_exchange','can_return','enabled'].map(k=>`<td class="${p[k]?'perm-yes':'perm-no'}">${p[k]?'Y':'-'}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`:`<div class="empty">배정된 관리자가 없습니다.</div>`);
    const b=$('btnAddPerm');if(b)b.onclick=()=>{ $('permissionMallAccountId').value=id;$('adminId').value='';$('adminRole').value='OPERATOR';$('canOrder').checked=true;$('canPayment').checked=false;$('canCancel').checked=true;$('canExchange').checked=true;$('canReturn').checked=true;$('permEnabled').checked=true;open('permissionModal') };
  }
  async function savePermission(e){
    e.preventDefault();const id=$('permissionMallAccountId').value;
    const body={admin_id:$('adminId').value.trim(),role:$('adminRole').value,can_order:$('canOrder').checked,can_payment:$('canPayment').checked,can_cancel:$('canCancel').checked,can_exchange:$('canExchange').checked,can_return:$('canReturn').checked,enabled:$('permEnabled').checked};
    try{await api(API.permissionCreate(id),{method:'POST',body:JSON.stringify(body)});close('permissionModal');toast('권한이 저장되었습니다.');await showPermissions(id)}catch(err){toast('API 미연결: UI만 작성된 상태입니다.');console.warn(err)}
  }

  $('btnNew').onclick=newAccount;$('btnSearch').onclick=render;$('mallFilter').onchange=render;$('statusFilter').onchange=render;$('keyword').oninput=render;
  $('accountForm').onsubmit=saveAccount;$('permissionForm').onsubmit=savePermission;
  document.addEventListener('click',e=>{const c=e.target.closest('[data-close]');if(c)close(c.dataset.close);const a=e.target.closest('[data-act]');if(a){if(a.dataset.act==='edit')editAccount(a.dataset.id);if(a.dataset.act==='perm')showPermissions(a.dataset.id)}});
  loadAccounts();
})();
