// GM_BUILDER_TRANSLATION_BACKFILL_V001
(function(){'use strict';
const root='/api/gm/builder/translation-backfill/';
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));}
function state(s){document.getElementById('gmBackfillState').textContent=s;}
async function json(url,opt){const r=await fetch(url,opt);const v=await r.json();if(!r.ok||!v.ok)throw Error(v.error||('HTTP '+r.status));return v;}
window.gmBackfillLoad=async function(){state('미완료 항목 조회 중');try{const data=await json(root+'status?t='+Date.now());const rows=document.getElementById('gmBackfillRows');let out='';for(const [domain,title] of [['keyword','키워드'],['category','카테고리'],['ui','UI']]){const v=data.domains[domain];out+='<h3>'+title+'</h3>';if(!v.ok){out+='<p>'+esc(v.error)+'</p>';continue;}out+='<div class="small">최대 30건 미리보기 (전체 건수 아님)</div><table><thead><tr><th>한국어 원문</th><th>누락 언어</th><th>수동 보완</th></tr></thead><tbody>';for(const item of v.sample){const langs=item.missing;out+='<tr><td>'+esc(item.source_text)+'</td><td>'+esc(langs.join(', '))+'</td><td>'+(langs.length?'<button type="button" data-gm-do="1" data-domain="'+domain+'" data-lang="'+langs[0]+'" data-row="'+esc(item.row_token)+'">'+esc(langs[0])+' 1개 언어 보완</button>':'완료')+'</td></tr>';}out+='</tbody></table>';if(!v.sample.length)out+='<p>누락 항목 없음 (첫 30건 기준)</p>';}rows.innerHTML=out;state(data.rate_limit_until?'429 중지 중: '+data.rate_limit_until:'조회 완료 · 일괄 보완 가능');}catch(e){state('조회 오류: '+e.message);}};
window.gmBackfillBatch=async function(){
 const btn=document.getElementById('gmBackfillBatchBtn');if(btn.disabled)return;
 const domain=document.getElementById('gmBackfillDomain').value;
 const limit=Number(document.getElementById('gmBackfillLimit').value)||50;
 const token=document.getElementById('gmBackfillToken').value.trim();
 if(!token){state('서버 관리자 토큰을 입력해야 실행할 수 있습니다.');return;}
 btn.disabled=true;state(domain+' 누락 번역 '+limit+'건 순차 처리 시작');
 try{const data=await json(root+'batch',{method:'POST',headers:{'Content-Type':'application/json','x-gm-builder-translation-token':token},body:JSON.stringify({domain,limit})});
 state('작업 종료: 성공 '+data.completed+' · 건너뜀 '+data.skipped+' · 실패 '+data.failed+(data.halted?' · 중지 사유 '+data.halted:''));
 await window.gmBackfillLoad();
 }catch(e){state('작업 중단: '+e.message);}finally{btn.disabled=false;}
};
})();
