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
})();})();