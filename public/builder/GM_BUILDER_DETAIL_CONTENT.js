// GM_DETAIL_CONTENT_BUILDER_UI_V002 - indexed, collapsible GM category tree; collection API unchanged.
(()=>{'use strict';
const $=id=>document.getElementById(id),API='/api/gm/builder/detail-content';
let cats=[],selected=new Set(),expanded=new Set(),nodes=new Map(),roots=[],interval=null;
function clean(v){return String(v==null?'':v).trim().toUpperCase();}
function msg(v){if($('gmDcProgress'))$('gmDcProgress').textContent=String(v);}
async function api(path,opts={}){const r=await fetch(API+path,Object.assign({credentials:'same-origin'},opts));const d=await r.json();if(!r.ok||!d.ok)throw Error(d.error||('HTTP '+r.status));return d;}
// Mirror routes/category_menu.js: category hierarchy is derived from GM code segments,
// not gm_parent_code (which may be missing or inconsistent in historical rows).
function parentCandidates(code){
 const parts=clean(code).split('-');if(parts.length<5||parts.length>6)return [];
 const answer=[];
 for(let i=parts.length-1;i>=1;i--){
   if(!/^0+$/.test(parts[i])){
     const a=parts.slice();for(let j=i;j<a.length;j++)a[j]='0'.repeat(a[j].length);
     const candidate=a.join('-');if(candidate!==code&&!answer.includes(candidate))answer.push(candidate);
   }
 }
 return answer;
}
function rebuildTree(rows){
 nodes=new Map();roots=[];
 for(const c of rows){const code=clean(c.gm_code);if(!code||nodes.has(code))continue;
   nodes.set(code,{...c,code,parent:'',children:[],name:String(c.name_ko||code),order:Number(c.sort_order)||0});}
 for(const n of nodes.values()){
   // Prefer GM code lineage to match the production category menu.
   const parent=parentCandidates(n.code).find(p=>nodes.has(p))||'';
   const fallback=clean(n.gm_parent_code);
   n.parent=parent||(fallback!==n.code&&nodes.has(fallback)?fallback:'');
   if(n.parent)nodes.get(n.parent).children.push(n);else roots.push(n);
 }
 const sort=(a,b)=>a.order-b.order||a.name.localeCompare(b.name,'ko')||a.code.localeCompare(b.code);
 roots.sort(sort);for(const n of nodes.values())n.children.sort(sort);
}
function allDescendants(code){const result=[];const stack=[nodes.get(code)];const seen=new Set();
 while(stack.length){const n=stack.pop();if(!n||seen.has(n.code))continue;seen.add(n.code);result.push(n.code);for(const child of n.children)stack.push(child);}return result;}
function countSelected(n){let total=0,marked=0;const stack=[n],seen=new Set();while(stack.length){const v=stack.pop();if(!v||seen.has(v.code))continue;seen.add(v.code);total++;if(selected.has(v.code))marked++;for(const c of v.children)stack.push(c);}return {total,marked};}
function render(){const host=$('gmDcTree');if(!host)return;host.replaceChildren();
 const kw=String($('gmDcFilter')?.value||'').trim().toLowerCase();
 const visible=new Set(),forcedOpen=new Set();
 if(kw){for(const n of nodes.values()){
   if(!n.name.toLowerCase().includes(kw)&&!n.code.toLowerCase().includes(kw))continue;
   const seen=new Set();let cur=n;
   while(cur&&!seen.has(cur.code)){seen.add(cur.code);visible.add(cur.code);if(cur!==n)forcedOpen.add(cur.code);cur=nodes.get(cur.parent);}
 }}
 const line=(n,indent,index)=>{
   if(kw&&!visible.has(n.code))return;
   const row=document.createElement('div');row.style.cssText='display:flex;align-items:center;gap:7px;min-height:31px;padding:2px 4px 2px '+(6+indent*21)+'px;border-bottom:1px solid #f3f4f6';
   const open=expanded.has(n.code)||forcedOpen.has(n.code);
   const arrow=document.createElement('button');arrow.type='button';arrow.style.cssText='width:25px;height:25px;flex:none;padding:0;background:transparent;color:#334155;border:0;cursor:pointer;font-size:16px';
   arrow.textContent=n.children.length?(open?'▾':'▸'):'·';arrow.disabled=!n.children.length;
   arrow.title=n.children.length?(open?'하위 접기':'하위 펼치기'):'하위 카테고리 없음';
   arrow.addEventListener('click',()=>{if(expanded.has(n.code))expanded.delete(n.code);else expanded.add(n.code);render();});row.appendChild(arrow);
   const check=document.createElement('input');check.type='checkbox';check.style.cssText='flex:none;min-width:15px;min-height:15px;margin:0';
   const counts=countSelected(n);check.checked=counts.marked===counts.total;check.indeterminate=counts.marked>0&&counts.marked<counts.total;
   check.title='이 항목과 하위 모든 카테고리 선택/해제';check.addEventListener('change',()=>{
     for(const id of allDescendants(n.code)){if(check.checked)selected.add(id);else selected.delete(id);}render();});row.appendChild(check);
   const text=document.createElement('span');text.style.cssText='font-size:13px;line-height:1.5;cursor:pointer;overflow-wrap:anywhere';
   const number=document.createElement('strong');number.textContent=index+' ';number.style.color='#2563eb';
   text.appendChild(number);text.append(document.createTextNode(n.name+' ('+n.code+')'));
   text.addEventListener('click',()=>{if(n.children.length){if(expanded.has(n.code))expanded.delete(n.code);else expanded.add(n.code);render();}});
   row.appendChild(text);host.appendChild(row);
   if(open){n.children.forEach((child,i)=>line(child,indent+1,index+'.'+(i+1)));}
 };
 roots.forEach((n,i)=>line(n,0,String(i+1)));
 if(!host.childNodes.length)host.textContent=kw?'검색 결과 없음':'카테고리 데이터 없음';
 const summary=$('gmDcTreeSummary');if(summary)summary.textContent='전체 '+nodes.size.toLocaleString()+'개 · 선택 '+selected.size.toLocaleString()+'개 · 최상위 '+roots.length+'개';
}
async function load(){try{const d=await api('/categories');cats=d.categories||[];rebuildTree(cats);
 selected=new Set([...selected].filter(id=>nodes.has(id)));render();msg('전체 카테고리 '+nodes.size+'개 · 선택 '+selected.size+'개');
 }catch(e){msg('카테고리 조회 실패: '+e.message);}}
async function status(){try{const d=await api('/status');const j=d.job||{};msg(['서버 실행기: '+(d.worker_ready?'준비':'미준비 ('+d.worker_error+')'),'상태: '+(j.state||'idle'),'선택 카테고리: '+(j.selected_codes||0),'처리: '+(j.seen||0)+' / '+(j.max_items||0),'저장: '+(j.saved||0),'실패: '+(j.failed||0),'마지막 PID: '+(j.last_pid||'-'),'메시지: '+(j.error||'-')].join('\n'));}catch(e){msg('상태 조회 실패: '+e.message);}}
async function write(path,body){const password=prompt('derzon 관리자 비밀번호 (이번 작업 인증)');if(password==null)return;try{await api(path,{method:'POST',headers:{'Content-Type':'application/json','x-gm-builder-admin-password':password},body:JSON.stringify(body||{})});await status();}catch(e){msg(path+' 실패: '+e.message);}}
function init(){if(!$('gmDcTree'))return;
 const host=$('gmDcTree');const summary=document.createElement('div');summary.id='gmDcTreeSummary';summary.style.cssText='font-size:12px;color:#475569;margin:0 0 8px';host.parentNode.insertBefore(summary,host);
 $('gmDcFilter').addEventListener('input',render);$('gmDcRefresh').addEventListener('click',load);
 $('gmDcAll').addEventListener('click',()=>{selected=new Set(nodes.keys());render();});$('gmDcNone').addEventListener('click',()=>{selected.clear();render();});
 $('gmDcStatus').addEventListener('click',status);
 $('gmDcStart').addEventListener('click',()=>{if(!selected.size){msg('카테고리를 선택하세요');return;}write('/start',{mall_code:'CPKR',category_codes:[...selected],skip_saved:$('gmDcSkip').checked,max_items:Number($('gmDcMax').value)||50});});
 $('gmDcStop').addEventListener('click',()=>write('/stop',{}));
 load();status();interval=setInterval(()=>{if(!document.hidden&&$('gmDetailContentCard')?.style.display!=='none')status();},5000);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
