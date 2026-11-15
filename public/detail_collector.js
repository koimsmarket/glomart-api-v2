(()=>{'use strict';const $=id=>document.getElementById(id);let cats=[],sel=new Set(),ready=false;
const root='/api/gm/detail-collector/';
async function get(p){
 const r=await fetch(root+p,{credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'}});
 const ct=String(r.headers.get('content-type')||'').toLowerCase();
 if(!ct.includes('application/json'))throw Error('API 응답 형식 오류: '+p+' / HTTP '+r.status+' / '+(ct||'Content-Type 없음')+' (서버가 JSON 대신 HTML 등을 반환했습니다. 인증 게이트 또는 API 라우트 확인 필요)');
 let d;try{d=await r.json();}catch(_){throw Error('API JSON 파싱 실패: '+p+' / HTTP '+r.status);}
 if(r.status===401){ready=false;location.replace('/detail-collector/');throw Error('로그인 세션 만료: 다시 로그인하세요.');}
 if(!r.ok||!d.ok)throw Error('API '+p+' / HTTP '+r.status+' / '+(d.error||'UNKNOWN'));
 return d;
}
function parentCandidates(code){const p=String(code).toUpperCase().split('-'),out=[];for(let i=p.length-1;i>=1;i--){if(!/^0+$/.test(p[i])){let v=p.slice();for(let j=i;j<v.length;j++)v[j]='0'.repeat(v[j].length);out.push(v.join('-'));}}return out;}
let openNodes=new Set();
function draw(){const q=$('filter').value.toLowerCase(),host=$('tree');host.replaceChildren();const map=new Map(cats.map(c=>[c.gm_code,{...c,children:[],parent:''}])),roots=[];
for(const c of map.values()){const direct=parentCandidates(c.gm_code).find(p=>map.has(p)),fallback=map.has(c.gm_parent_code)?c.gm_parent_code:'';c.parent=direct||fallback;if(c.parent&&c.parent!==c.gm_code)map.get(c.parent).children.push(c);else roots.push(c);}
const sort=(a,b)=>(Number(a.sort_order)||0)-(Number(b.sort_order)||0)||a.gm_code.localeCompare(b.gm_code);roots.sort(sort);for(const c of map.values())c.children.sort(sort);
const visible=new Set(),forced=new Set();if(q){for(const c of map.values()){if(!String(c.name_ko||'').toLowerCase().includes(q)&&!c.gm_code.toLowerCase().includes(q))continue;let x=c;const seen=new Set();while(x&&!seen.has(x.gm_code)){seen.add(x.gm_code);visible.add(x.gm_code);if(x!==c)forced.add(x.gm_code);x=map.get(x.parent);}}}
function descendants(c){const stack=[c],out=[];while(stack.length){const n=stack.pop();if(!n)continue;out.push(n.gm_code);stack.push(...n.children);}return out;}
function line(c,depth){if(q&&!visible.has(c.gm_code))return;const row=document.createElement('div');row.style.cssText='display:flex;align-items:center;gap:5px;padding:4px 3px 4px '+(depth*17+4)+'px;border-bottom:1px solid #eee';const arrow=document.createElement('button');arrow.type='button';arrow.style.cssText='width:26px;min-width:26px;padding:1px;margin:0';arrow.textContent=c.children.length?(openNodes.has(c.gm_code)||forced.has(c.gm_code)?'▾':'▸'):'·';arrow.disabled=!c.children.length;arrow.onclick=()=>{if(openNodes.has(c.gm_code))openNodes.delete(c.gm_code);else openNodes.add(c.gm_code);draw();};const check=document.createElement('input');check.type='checkbox';check.style.cssText='width:16px;min-width:16px;height:16px;margin:0';const ids=descendants(c),chosen=ids.filter(x=>sel.has(x)).length;check.checked=chosen===ids.length;check.indeterminate=chosen>0&&chosen<ids.length;check.onchange=()=>{for(const id of ids){if(check.checked)sel.add(id);else sel.delete(id);}draw();};const title=document.createElement('span');title.textContent=String(c.name_ko||c.gm_code)+' ('+c.gm_code+')';row.append(arrow,check,title);host.append(row);if(openNodes.has(c.gm_code)||forced.has(c.gm_code))for(const ch of c.children)line(ch,depth+1);}
for(const r of roots)line(r,0);$('picked').textContent='전체 '+map.size+'개 · 선택 '+sel.size+'개 · 최상위 '+roots.length+'개';}
async function load(){try{const x=await get('categories');cats=x.categories||[];draw();}catch(e){$('status').textContent=e.message;}}
async function status(){try{const s=await get('status');$('status').textContent='계정: '+s.account+'\n할당 이력: '+s.statistics.claims+'\n현재 작업권: '+s.statistics.active+'\n완료: '+s.statistics.complete;}catch(e){$('status').textContent=e.message;}}
$('reload').onclick=()=>{if(ready)load();};$('filter').oninput=()=>{if(ready)draw();};$('refresh').onclick=()=>{if(ready)status();};
$('logout').onclick=async()=>{try{await fetch(root+'logout',{method:'POST',credentials:'same-origin',headers:{Accept:'application/json'}});}finally{location.replace('/detail-collector/');}};
(async()=>{
 $('account').textContent='수집 전용 계정 확인 중…';
 $('status').textContent='수집 전용 로그인 상태 확인 중…';
 try{
  const s=await get('session');
  if(!s.authenticated||!s.account){location.replace('/detail-collector/');return;}
  ready=true;$('account').textContent='수집 전용 로그인: '+s.account;
  await load();await status();
 }catch(e){$('account').textContent='인증 상태 확인 실패';$('status').textContent=e.message;}
})();
// V009: same PC executor shared with existing Builder tab. Standalone login remains collector-only.
let collecting=false,startedAt='',progress={processed:0,saved:0,failed:0,skipped:0,last_pid:''};
const installed=()=>{const x=window.GM_DETAIL_PC_EXECUTOR;return x&&x.ready===true&&typeof x.start==='function'&&typeof x.stop==='function'?x:null;};
const readyEl=$('executorReady');
function readyText(){if(readyEl)readyEl.textContent=installed()?'PC Chrome 수집 실행기: 연결됨':'PC Chrome 수집 실행기: 미연결 · V015 사용자 스크립트를 이 PC에 설치하세요';}
readyText();setInterval(readyText,3000);
$('start').onclick=async()=>{
 if(collecting){$('status').textContent='이미 이 PC에서 수집 중입니다.';return;}
 if(!ready){$('status').textContent='먼저 수집 전용 계정으로 로그인하세요.';return;}
 if(!sel.size){$('status').textContent='카테고리를 선택하세요.';return;}
 const x=installed();if(!x){readyText();$('status').textContent='PC 수집 실행기가 없습니다. V015 사용자 스크립트 설치가 필요합니다.';return;}
 collecting=true;startedAt=new Date().toISOString();progress={processed:0,saved:0,failed:0,skipped:0,last_pid:''};
 $('status').textContent='PC 수집 시작 준비 중';
 try{await x.start({category_codes:[...sel],max_items:Math.max(1,Math.min(10000,Number($('max').value)||50)),skip_saved:$('skip').checked,api_root:root,
 onProgress:p=>{progress={...progress,...p};$('status').textContent='PC 수집 중\n처리: '+progress.processed+' / 저장: '+progress.saved+' / 실패: '+progress.failed+'\n마지막 PID: '+(progress.last_pid||'-');},
 onFinished:async p=>{collecting=false;progress={...progress,...p};$('status').textContent='작업 종료: '+(p.error||p.stopped?'중지/오류':'완료')+'\n처리: '+progress.processed+' / 저장: '+progress.saved+' / 실패: '+progress.failed+'\n'+(p.reason||'');}});}
 catch(e){collecting=false;$('status').textContent='수집 시작 실패: '+e.message;}
};
$('stop').onclick=async()=>{const x=installed();if(!x||!collecting){$('status').textContent='이 PC에서 진행 중인 수집이 없습니다.';return;}try{await x.stop();$('status').textContent='중지 요청됨 (현재 작업 정리 중)';}catch(e){$('status').textContent='중지 실패: '+e.message;}};

// GM_DETAIL_CONTENT_HISTORY_V018: leaf categories only; read-only server reporting.
// Display rows by category tree order, then count and retained claim timestamps.
let historyBusy=false,historyLastAt=0;
function historyTd(tr,value){const td=document.createElement('td');td.textContent=String(value==null?'':value);tr.append(td);}
function historyEmpty(id,n,msg){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=n;td.textContent=msg;tr.append(td);$(id).replaceChildren(tr);}
function historyTree(){
 const map=new Map(cats.map(c=>[c.gm_code,{...c,children:[],parent:''}])),roots=[];
 for(const c of map.values()){
  const derived=parentCandidates(c.gm_code).find(p=>map.has(p));
  const fallback=map.has(c.gm_parent_code)?c.gm_parent_code:'';
  c.parent=derived||fallback;
  if(c.parent&&c.parent!==c.gm_code)map.get(c.parent).children.push(c);else roots.push(c);
 }
 const sort=(a,b)=>(Number(a.sort_order)||0)-(Number(b.sort_order)||0)||a.gm_code.localeCompare(b.gm_code);
 roots.sort(sort);for(const c of map.values())c.children.sort(sort);
 const leaves=[];function walk(c,parents){const path=[...parents,String(c.name_ko||c.gm_code)];
  if(!c.children.length){if(sel.has(c.gm_code))leaves.push({code:c.gm_code,path:path.join(' > ')});return;}
  for(const child of c.children)walk(child,path);
 }
 for(const r of roots)walk(r,[]);
 return leaves;
}
function elapsedText(sec){if(sec==null||!Number.isFinite(Number(sec)))return '-';let s=Math.max(0,Number(sec));const h=Math.floor(s/3600);s%=3600;const m=Math.floor(s/60);s%=60;return(h?h+'시간 ':'')+(m?m+'분 ':'')+s+'초';}
async function refreshHistory(force=false){
 if(!ready||historyBusy)return;
 const leaves=historyTree();
 if(!leaves.length){$('historyMessage').textContent='최하위 카테고리를 선택하면 이력이 표시됩니다.';historyEmpty('historyCategories',5,'선택된 최하위 카테고리 없음');historyEmpty('historyRows',5,'조회 대상 없음');return;}
 if(!force&&Date.now()-historyLastAt<12000)return;
 historyBusy=true;
 try{
  const response=await fetch(root+'history',{method:'POST',credentials:'same-origin',cache:'no-store',
    headers:{Accept:'application/json','Content-Type':'application/json'},body:JSON.stringify({leaf_codes:leaves.map(x=>x.code)})});
  const data=await response.json();
  if(response.status===401){ready=false;location.replace('/detail-collector/');return;}
  if(!response.ok||!data.ok)throw Error('HTTP '+response.status+' / '+(data.error||'UNKNOWN'));
  historyLastAt=Date.now();
  const byCode=new Map((data.categories||[]).map(x=>[x.category_code,x]));
  const labelByCode=new Map(leaves.map(x=>[x.code,x.path]));
  const catHost=$('historyCategories');catHost.replaceChildren();
  let total=0,performed=0;
  for(const leaf of leaves){const c=byCode.get(leaf.code)||{},tr=document.createElement('tr');
   const n=Number(c.total)||0,d=Number(c.performed)||0;total+=n;performed+=d;
   if(n&&d<n)tr.className='active';
   [leaf.path+' ('+leaf.code+')',n+' / '+d+'건',c.first_kst||'-',c.last_kst||'-',elapsedText(c.elapsed_seconds)].forEach(v=>historyTd(tr,v));catHost.append(tr);
  }
  const rows=$('historyRows');rows.replaceChildren();
  for(const item of data.items||[]){const tr=document.createElement('tr');
    [labelByCode.get(item.category_code)||item.category_code||'-',item.product_id,item.state,item.client_id||'-',item.updated_kst||'-'].forEach(v=>historyTd(tr,v));rows.append(tr);
  }
  if(!rows.children.length)historyEmpty('historyRows',5,'작업 이력 없음');
  const kst=new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date());
  $('historyMessage').textContent='최하위 카테고리 '+leaves.length+'개 · 전체 / 수행 '+total+' / '+performed+'건 (카테고리별 합산) · 최근 이력 '+(data.items||[]).length+'건 · '+kst+' KST 조회';
 }catch(e){$('historyMessage').textContent='서버 작업 이력 조회 실패: '+e.message;}
 finally{historyBusy=false;}
}
$('historyRefresh').onclick=()=>{if(ready)void refreshHistory(true);};
// Refresh only when visible; never pause the collector's claim/result hot path.
setInterval(()=>{if(ready&&!document.hidden)void refreshHistory();},15000);
setTimeout(()=>{if(ready)void refreshHistory(true);},1200);
})();
