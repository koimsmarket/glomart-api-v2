// GM_DETAIL_CONTENT_BUILDER_UI_V001 - builder only, no automatic collection.
(()=>{'use strict';
const $=id=>document.getElementById(id),API='/api/gm/builder/detail-content';
let cats=[],selected=new Set(),active=false,interval=null;
function msg(v){if($('gmDcProgress'))$('gmDcProgress').textContent=String(v);}
async function api(path,opts={}){const r=await fetch(API+path,Object.assign({credentials:'same-origin'},opts));const d=await r.json();if(!r.ok||!d.ok)throw Error(d.error||('HTTP '+r.status));return d;}
function descendants(code){const found=new Set([code]);let old=-1;while(old!==found.size){old=found.size;cats.forEach(c=>{if(found.has(c.gm_parent_code))found.add(c.gm_code);});}return found;}
function render(){const host=$('gmDcTree');if(!host)return;host.replaceChildren();const kw=String($('gmDcFilter')?.value||'').toLowerCase();
 const ordered=cats.filter(c=>!kw||String(c.name_ko||'').toLowerCase().includes(kw)||String(c.gm_code).toLowerCase().includes(kw));
 for(const c of ordered){const label=document.createElement('label');label.style.cssText='display:block;padding:3px 5px;margin-left:'+Math.min(8,Number(c.depth)||0)*12+'px';
 const box=document.createElement('input');box.type='checkbox';box.checked=selected.has(c.gm_code);
 box.addEventListener('change',()=>{const all=descendants(c.gm_code);for(const id of all){if(box.checked)selected.add(id);else selected.delete(id);}render();});
 label.appendChild(box);label.append(' '+String(c.name_ko||c.gm_code)+' ('+c.gm_code+')');host.appendChild(label);}
 if(!ordered.length)host.textContent='해당 카테고리 없음';}
async function load(){try{const d=await api('/categories');cats=d.categories||[];render();msg('전체 카테고리 '+cats.length+'개 · 선택 '+selected.size+'개');}catch(e){msg('카테고리 조회 실패: '+e.message);}}
async function status(){try{const d=await api('/status');const j=d.job||{};active=j.state==='running'||j.state==='stopping';msg(['서버 실행기: '+(d.worker_ready?'준비':'미준비 ('+d.worker_error+')'),'상태: '+(j.state||'idle'),'선택 카테고리: '+(j.selected_codes||0),'처리: '+(j.seen||0)+' / '+(j.max_items||0),'저장: '+(j.saved||0),'실패: '+(j.failed||0),'마지막 PID: '+(j.last_pid||'-'),'메시지: '+(j.error||'-')].join('\n'));}catch(e){msg('상태 조회 실패: '+e.message);}}
async function write(path,body){const password=prompt('derzon 관리자 비밀번호 (이번 작업 인증)');if(password==null)return;try{await api(path,{method:'POST',headers:{'Content-Type':'application/json','x-gm-builder-admin-password':password},body:JSON.stringify(body||{})});await status();}catch(e){msg(path+' 실패: '+e.message);}}
function init(){if(!$('gmDcTree'))return;$('gmDcFilter').addEventListener('input',render);$('gmDcRefresh').addEventListener('click',load);
 $('gmDcAll').addEventListener('click',()=>{selected=new Set(cats.map(c=>c.gm_code));render();});$('gmDcNone').addEventListener('click',()=>{selected.clear();render();});
 $('gmDcStatus').addEventListener('click',status);
 $('gmDcStart').addEventListener('click',()=>{if(!selected.size){msg('카테고리를 선택하세요');return;}write('/start',{mall_code:'CPKR',category_codes:[...selected],skip_saved:$('gmDcSkip').checked,max_items:Number($('gmDcMax').value)||50});});
 $('gmDcStop').addEventListener('click',()=>write('/stop',{}));
 load();status();interval=setInterval(()=>{if(!document.hidden&&$('gmDetailContentCard')?.style.display!=='none')status();},5000);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
