// GM_BUILDER_TRANSLATION_BACKFILL_V005: sequential, adjustable interval (ms), one request at a time.
(function(){'use strict';
const root='/api/gm/builder/translation-backfill/';
const LANGS=['en','zh','vi','ja','tw','th','uz','ne','km','id','tl','mn','my','kk','si','ru','bn','ur','lo','hi','tr','fa','es','fr'];
let job=null;
function el(id){return document.getElementById(id);}
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));}
function state(v){const node=el('gmBackfillState');if(node)node.textContent=v;}
async function json(url,opt){const r=await fetch(url,opt);let v;try{v=await r.json();}catch(_){throw Error('HTTP_'+r.status);}if(!r.ok||!v.ok)throw Error(v.error||('HTTP_'+r.status));return v;}
function gap(){const v=Number(el('gmBackfillInterval').value);return Number.isFinite(v)?Math.max(100,Math.min(60000,Math.round(v))):100;}
function label(){return !job?'대기 중':('상태 '+(job.paused?'일시정지':'진행')+' · 대상 '+job.domain+' · 성공 '+job.ok+' · 건너뜀 '+job.skip+' · 실패 '+job.fail+' · 마지막 언어 '+(job.lang||'-')+' · 간격 '+gap()+'ms');}
function update(){state(label()+(job&&job.last?' · '+job.last:''));}
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
async function waitForResume(j){while(j.paused&&!j.stopped){await sleep(150);}return !j.stopped;}
function startLanguageList(){const select=el('gmBackfillLanguage');if(!select||select.options.length>1)return;LANGS.forEach(l=>{const opt=document.createElement('option');opt.value=l;opt.textContent=l;select.appendChild(opt);});}
window.gmBackfillLoad=async function(){try{const data=await json(root+'status?t='+Date.now());const rows=el('gmBackfillRows');let out='';for(const [domain,title] of [['keyword','키워드'],['category','카테고리'],['ui','UI']]){const v=data.domains[domain];out+='<h3>'+title+'</h3>';if(!v.ok){out+='<p>'+esc(v.error)+'</p>';continue;}out+='<div class="small">최대 30건 미리보기 (전체 건수 아님)</div><table><thead><tr><th>한국어 원문</th><th>누락 언어</th><th>수동 보완</th></tr></thead><tbody>';for(const item of v.sample){const langs=item.missing;out+='<tr><td>'+esc(item.source_text)+'</td><td>'+esc(langs.join(', '))+'</td><td>'+(langs.length?'<button type="button" data-gm-do="1" data-domain="'+domain+'" data-lang="'+langs[0]+'" data-row="'+esc(item.row_token)+'">'+esc(langs[0])+' 1개 언어 보완</button>':'완료')+'</td></tr>';}out+='</tbody></table>';if(!v.sample.length)out+='<p>미완료 미발견</p>';}rows.innerHTML=out;if(!job)state('조회 완료 · 설정 후 시작');else update();}catch(e){state('조회 오류: '+e.message);}};
// No automatic retry after 429. On each resume, test only the next single request.
window.gmBackfillStart=function(){if(job&&!job.stopped){state('작업이 이미 실행 중입니다');return;}const max=Number(el('gmBackfillLimit').value)||0;const domain=el('gmBackfillDomain').value;const chosen=el('gmBackfillLanguage').value;job={domain,langs:chosen==='auto'?LANGS.slice():[chosen],max,ok:0,skip:0,fail:0,paused:false,stopped:false,last:'',lang:'',roundComplete:0};update();void run(job);};
window.gmBackfillPause=function(){if(job&&!job.stopped){job.paused=true;job.last='사용자 일시정지';update();}};
window.gmBackfillResume=function(){if(job&&!job.stopped){job.paused=false;job.last='사용자 재개';update();}};
window.gmBackfillStop=function(){if(job){job.stopped=true;job.paused=false;job.last='중지 요청 (진행 중 1건은 완료될 수 있음)';update();}};
async function run(j){
 try{
  for(const lang of j.langs){
   j.lang=lang;j.roundComplete=0;update();
   while(!j.stopped){
    if(!(await waitForResume(j)))break;
    if(j.max>0&&j.ok+j.skip>=j.max){j.stopped=true;j.last='설정한 건수 도달';break;}
    const next=await json(root+'next?domain='+encodeURIComponent(j.domain)+'&lang='+encodeURIComponent(lang)+'&t='+Date.now());
    if(!next.item){j.last=lang+' 미완료 항목 없음';break;}
    if(j.stopped)break;
    if(!(await waitForResume(j)))break;
    let result;
    try{result=await json(root+'one',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({domain:j.domain,lang,row_token:next.item.row_token})});}
    catch(e){j.fail++;j.paused=true;j.last=(e.message.indexOf('429')>=0?'Google 429 발생 · 자동 일시정지 · 간격을 조정한 뒤 재개':'오류 발생 · 자동 일시정지')+' ('+e.message+')';update();if(!(await waitForResume(j)))break;continue;}
    if(result.skipped)j.skip++;else{j.ok++;j.roundComplete++;}
    j.last=lang+' · '+(result.skipped?'건너뜀':'저장 성공');update();
    // Wait after the response and DB save. Read the user's CURRENT setting each time.
    if(j.stopped)break;
    const until=Date.now()+gap();while(Date.now()<until&&!j.stopped){if(!(await waitForResume(j)))break;await sleep(Math.min(100,Math.max(1,until-Date.now())));}
   }
   if(j.stopped)break;
  }
  if(!j.stopped)j.last='선택 언어 미완료 처리 완료';
 }catch(e){j.paused=true;j.last='작업 오류 '+e.message;}
 finally{j.stopped=true;j.paused=false;update();}
}
startLanguageList();
})();
