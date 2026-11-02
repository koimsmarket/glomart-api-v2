'use strict';
// GM_UI_AUTO_V006: server-side hook only. The Android application must call
// /api/gm/builder/multilingual/app-closed on an EXPLICIT app close, not on idle,
// backgrounding, page visibility, or process termination.
const flow=require('./finalize');
const ui=require('./ui');
const category=require('./category');
let inFlight=false;
async function onClosed(db){
 if(inFlight||flow.status().running)return {ok:true,started:false,reason:'ALREADY_RUNNING'};
 inFlight=true;
 try{
  // Missing cells are a persistent DB signal. Never launch for an unchanged,
  // fully translated dictionary merely because the admin window was closed.
  const [missingUI,missingCategory]=await Promise.all([ui.missing(db),category.inspect(db)]);
  if(!missingUI.length&&!missingCategory)return {ok:true,started:false,reason:'NO_MISSING_TRANSLATIONS'};
  const started=await flow.launch(db);
  return {ok:!!started.ok,started:!!started.started,reason:started.error||'MISSING_TRANSLATIONS',remaining:{ui:missingUI.length,category:missingCategory}};
 }finally{inFlight=false;}
}
module.exports={onClosed};
