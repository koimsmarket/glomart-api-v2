/* GM_AUTO_ORDER_ACCOUNT_UI_V004
 * Production account UI: DB rows only. No demo/fallback accounts.
 * Until account-allocation rules are re-finalized, account rows remain MASTER-only.
 */
(function(){
  'use strict';
  const API={
    list:'/api/gm/auto-order/accounts',
    create:'/api/gm/auto-order/accounts',
    update:(id)=>'/api/gm/auto-order/accounts/'+encodeURIComponent(id),
    remove:(id)=>'/api/gm/auto-order/accounts/'+encodeURIComponent(id)
  };
  const state={accounts:[],loadError:''};
  const $=(id)=>document.getElementById(id);
  const esc=(s)=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const toast=(m)=>{const t=$('toast');t.textContent=m;t.classList.remove('hidden');setTimeout(()=>t.classList.add('hidden'),2600)};
  const open=(id)=>$(id).classList.remove('hidden');
  const close=(id)=>$(id).classList.add('hidden');

  async function api(url,opt){
    const r=await fetch(url,Object.assign({headers:{'Content-Type':'application/json','Accept':'application/json'}},opt||{}));
    const text=await r.text(); let j={}; try{j=text?JSON.parse(text):{}}catch(_){j={error:text||('HTTP '+r.status)}}
    if(!r.ok || j.ok===false) throw new Error(j.error||j.detail||('HTTP '+r.status));
    return j;
  }
  async function loadAccounts(){
    state.loadError='';
    try{
      const j=await api(API.list);
      state.accounts=Array.isArray(j)?j:(j.accounts||j.rows||[]);
    }catch(e){
      state.accounts=[];
      state.loadError=String(e&&e.message||e);
      console.error('[GM_AUTO_ORDER_ACCOUNT_UI_V004] load failed',e);
    }
    render();
  }
  function filtered(){
    const mall=$('mallFilter').value,k=$('keyword').value.trim().toLowerCase();
    return state.accounts.filter(a=>(!mall||a.mall_code===mall)&&(!k||[a.mall_account_id,a.account_name,a.login_id,a.admin_id].some(v=>String(v||'').toLowerCase().includes(k))));
  }
  function render(){
    const rows=filtered();
    $('accountRows').innerHTML=rows.map(a=>`<tr>
      <td><strong>${esc(a.mall_account_id)}</strong></td>
      <td>${esc(a.mall_code)}</td>
      <td>${esc(a.account_name||'-')}</td>
      <td class="masked-id">${esc(a.login_id||'-')}</td>
      <td><strong>${esc(a.admin_id||'-')}</strong></td>
      <td>${esc(a.account_admin_role||'MASTER')}</td>
      <td><span class="status-toggle ${a.enabled?'on':'off'}">${a.enabled?'사용':'중지'}</span></td>
      <td><div class="row-actions"><button data-act="edit" data-id="${esc(a.mall_account_id)}">수정</button><button class="danger-lite" data-act="delete" data-id="${esc(a.mall_account_id)}">삭제</button></div></td>
    </tr>`).join('');
    const empty=$('emptyState');
    if(state.loadError){ empty.textContent='계정 정보를 불러오지 못했습니다: '+state.loadError; empty.classList.remove('hidden'); }
    else if(!rows.length){ empty.textContent='등록된 외부몰 계정이 없습니다.'; empty.classList.remove('hidden'); }
    else empty.classList.add('hidden');
    $('sumTotal').textContent=state.accounts.length;
    $('sumEnabled').textContent=state.accounts.filter(a=>a.enabled).length;
    $('sumDisabled').textContent=state.accounts.filter(a=>!a.enabled).length;
    $('sumMaster').textContent=state.accounts.filter(a=>String(a.account_admin_role||'').toUpperCase()==='MASTER').length;
  }
  function masterAdminId(){
    const m=state.accounts.find(a=>String(a.account_admin_role||'').toUpperCase()==='MASTER' && a.admin_id);
    return m?String(m.admin_id):'';
  }
  function newAccount(){
    $('modalTitle').textContent='외부몰 계정 등록'; $('editMallAccountId').value='';
    $('mallCode').value='CPKR'; $('mallAccountId').value=''; $('mallAccountId').disabled=false;
    $('accountName').value=''; $('loginId').value=''; $('password').value=''; $('password').required=true;
    $('pwHint').textContent='등록 시 필수'; $('adminId').value=masterAdminId(); $('enabled').checked=true; open('accountModal');
  }
  function editAccount(id){
    const a=state.accounts.find(x=>x.mall_account_id===id); if(!a)return;
    $('modalTitle').textContent='외부몰 계정 수정'; $('editMallAccountId').value=id;
    $('mallCode').value=a.mall_code; $('mallAccountId').value=a.mall_account_id; $('mallAccountId').disabled=true;
    $('accountName').value=a.account_name||''; $('loginId').value=a.login_id_raw||'';
    $('password').value=''; $('password').required=false; $('pwHint').textContent='비워두면 기존 비밀번호 유지';
    $('adminId').value=a.admin_id||masterAdminId(); $('enabled').checked=!!a.enabled; open('accountModal');
  }
  async function saveAccount(e){
    e.preventDefault();
    const editId=$('editMallAccountId').value;
    const body={
      mall_code:$('mallCode').value,
      mall_account_id:$('mallAccountId').value.trim(),
      account_name:$('accountName').value.trim(),
      login_id:$('loginId').value.trim(),
      admin_id:$('adminId').value.trim(),
      account_admin_role:'MASTER',
      enabled:$('enabled').checked
    };
    if($('password').value) body.password=$('password').value;
    try{
      if(editId) await api(API.update(editId),{method:'PUT',body:JSON.stringify(body)});
      else await api(API.create,{method:'POST',body:JSON.stringify(body)});
      close('accountModal'); $('password').value=''; toast('저장되었습니다.'); await loadAccounts();
    }catch(err){toast('저장 실패: '+String(err&&err.message||err));}
  }
  async function deleteAccount(id){
    const a=state.accounts.find(x=>x.mall_account_id===id); if(!a)return;
    if(!confirm('['+id+'] 계정을 삭제하시겠습니까?\n이미 주문/작업에 사용된 계정은 삭제되지 않습니다.')) return;
    try{ await api(API.remove(id),{method:'DELETE'}); toast('삭제되었습니다.'); await loadAccounts(); }
    catch(err){ toast('삭제 불가: '+String(err&&err.message||err)); }
  }

  $('btnNew').onclick=newAccount; $('btnSearch').onclick=render; $('mallFilter').onchange=render; $('keyword').oninput=render;
  $('accountForm').onsubmit=saveAccount;
  document.addEventListener('click',e=>{
    const c=e.target.closest('[data-close]'); if(c)close(c.dataset.close);
    const a=e.target.closest('[data-act]'); if(a){ if(a.dataset.act==='edit')editAccount(a.dataset.id); if(a.dataset.act==='delete')deleteAccount(a.dataset.id); }
  });
  loadAccounts();
})();
