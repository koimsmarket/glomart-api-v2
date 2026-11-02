'use strict';
const legacy=require('../../ui_dictionary_v2');
const publisher=require('../../ui_dictionary_auto_publish');
const FOREIGN=legacy.FOREIGN;
const empty=FOREIGN.map(l=>`NULLIF(BTRIM(${l}::text),'') IS NULL`).join(' OR ');
async function missing(db){const r=await db.query(`SELECT gm_code FROM gm_ui_dictionary WHERE active_yn='Y' AND NULLIF(BTRIM(kr),'') IS NOT NULL AND (${empty}) ORDER BY gm_code`);return r.rows.map(x=>x.gm_code);}
async function complete(db,progress){
 const codes=await missing(db);progress.total.ui=codes.length;
 for(const code of codes){
  let result=null;
  for(let attempt=0;attempt<5;attempt++){
   result=await legacy.fillTranslations(db,code);
   if(result&&result.ok&&(!result.missing||!result.missing.length))break;
   await new Promise(r=>setTimeout(r,[1000,2000,3000,5000,8000][attempt]+Math.floor(Math.random()*300)));
  }
  progress.done.ui++;
 }
 const left=await missing(db);progress.remaining.ui=left.length;
 return left.length===0;
}
module.exports={missing,complete,publish:publisher.publishCompleted};
