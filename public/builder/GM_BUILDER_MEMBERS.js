async function uploadCafe24Members(apply,button){
  const f=document.getElementById('memberFile').files[0]; if(!f){alert('Cafe24 회원 Excel 또는 CSV 파일을 선택하세요.');return;}
  if(apply && prompt('회원정보를 실제 저장하려면 MEMBER APPLY 라고 입력하세요.')!=='MEMBER APPLY') return;
  const timed=startButtonTimer(button,apply?'회원 업로드 중':'회원 검증 중');
  try{const text=await readCsvText(f);await uploadCafe24MemberText(text,f.name,apply);log({file:f.name,mode:apply?'APPLY':'DRY_RUN',result:'DONE'});}catch(e){log(String(e&&e.message||e));}finally{stopButtonTimer(timed);}
}
function memberDryRun(button){return uploadCafe24Members(false,button)} function memberApply(button){return uploadCafe24Members(true,button)}
function downloadMemberTemplate(){location.href=`${API}/api/gm/builder/cafe24-member-template`;} function downloadCafe24MemberExport(){location.href=`${API}/api/gm/builder/cafe24-member-export`;}
