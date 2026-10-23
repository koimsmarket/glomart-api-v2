async function uploadCafe24Members(apply,button){
  const f=document.getElementById('memberFile').files[0]; if(!f){alert('Cafe24 회원 Excel 또는 CSV 파일을 선택하세요.');return;}
  if(apply && prompt('회원정보를 실제 저장하려면 MEMBER APPLY 라고 입력하세요.')!=='MEMBER APPLY') return;
  const timed=startButtonTimer(button,apply?'회원 업로드 중':'회원 검증 중');
  try{const text=await readCsvText(f);await uploadCafe24MemberText(text,f.name,apply);log({file:f.name,mode:apply?'APPLY':'DRY_RUN',result:'DONE'});}catch(e){log(String(e&&e.message||e));}finally{stopButtonTimer(timed);}
}
function memberDryRun(button){return uploadCafe24Members(false,button)} function memberApply(button){return uploadCafe24Members(true,button)}
function downloadMemberTemplate(){location.href=`${API}/api/gm/builder/cafe24-member-template`;}
async function downloadCafe24MemberExport(){
  try {
    await GMBuilderWithReauth(async()=>{
      const r=await fetch(`${API}/api/gm/builder/cafe24-member-export`,{method:'GET',cache:'no-store'});
      if(!r.ok){const body=await r.text();throw new Error(`회원 다운로드 HTTP ${r.status}: ${body.slice(0,250)}`);}
      await downloadCsvResponse(r,`cafe24_member_export_${Date.now()}.csv`);
    });
  } catch(e){log(`회원 다운로드 실패: ${String(e&&e.message||e)}`);}
}
