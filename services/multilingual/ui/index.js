'use strict';
const legacy=require('./ui_dictionary_v2');
const publisher=require('./ui_dictionary_auto_publish');
const FOREIGN=legacy.FOREIGN;
const empty=FOREIGN.map(l=>`NULLIF(BTRIM(${l}::text),'') IS NULL`).join(' OR ');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function missing(db){const r=await db.query(`SELECT gm_code FROM gm_ui_dictionary WHERE active_yn='Y' AND NULLIF(BTRIM(kr),'') IS NOT NULL AND (${empty}) ORDER BY gm_code`);return r.rows.map(x=>x.gm_code);}
async function missingCells(db){
 const sums=FOREIGN.map(l=>`SUM(CASE WHEN NULLIF(BTRIM(${l}::text),'') IS NULL THEN 1 ELSE 0 END) AS ${l}`).join(',');
 const r=await db.query(`SELECT ${sums} FROM gm_ui_dictionary WHERE active_yn='Y' AND NULLIF(BTRIM(kr),'') IS NOT NULL`);
 return FOREIGN.reduce((n,l)=>n+Number((r.rows[0]||{})[l]||0),0);
}
function rateLimited(result){
 return !!(result&&result.rateLimited) || /429|rate.limit|too.many.requests/i.test(String(result&&result.error||'')) ||
  !!(result&&Array.isArray(result.failed)&&result.failed.some(x=>/429|rate.limit|too.many.requests/i.test(JSON.stringify(x))));
}
async function complete(db,progress){
 const codes=await missing(db);
 progress.total.ui=codes.length;
 progress.remaining.ui=codes.length;
 console.log('[GM_UI_AUTO_SCAN]',JSON.stringify({phrases:codes.length,cells:await missingCells(db)}));
 for(let i=0;i<codes.length;i++){
  const code=codes[i];let result=null;let ok=false;
  for(let attempt=0;attempt<5;attempt++){
   try{result=await legacy.fillTranslations(db,code);}catch(e){result={ok:false,error:String(e&&e.message||e)};}
   if(result&&result.ok&&(!result.missing||!result.missing.length)){ok=true;break;}
   // Stop across all phrases when upstream rate limits: do not hammer 71 phrases.
   if(rateLimited(result)){console.warn('[GM_UI_AUTO_RATE_LIMIT_STOP]',JSON.stringify({code,attempt:attempt+1}));progress.remaining.ui=(await missing(db)).length;return false;}
   if(attempt<4){
    const limited=rateLimited(result);
    const waitMs=limited?Math.min(120000,15000*Math.pow(2,attempt)):Math.min(30000,2000*Math.pow(2,attempt));
    console.warn('[GM_UI_AUTO_TRANSLATE_RETRY]',JSON.stringify({code,attempt:attempt+1,rateLimited:limited,waitMs,error:String(result&&result.error||'').slice(0,160)}));
    await sleep(waitMs);
   }
  }
  progress.done.ui++;
  if(!ok)console.warn('[GM_UI_AUTO_TRANSLATE_PARTIAL]',JSON.stringify({code}));
  if((i+1)%10===0||i+1===codes.length){
   const left=await missing(db);progress.remaining.ui=left.length;
   console.log('[GM_UI_AUTO_PROGRESS]',JSON.stringify({done:i+1,total:codes.length,remainingPhrases:left.length}));
  }
  if(i+1<codes.length)await sleep(1000);
 }
 const left=await missing(db);progress.remaining.ui=left.length;
 console.log('[GM_UI_AUTO_SCAN_DONE]',JSON.stringify({remainingPhrases:left.length,remainingCells:await missingCells(db)}));
 return left.length===0;
}
module.exports={missing,complete,publish:publisher.publishCompleted};
