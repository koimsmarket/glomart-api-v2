'use strict';
// GM_UI_AUTO_V007: explicit-close only, plus persisted content comparison.
// A fully translated but newly discovered word still requires publication.
const flow=require('./finalize');
const ui=require('./ui');
const category=require('./category');
const {snapshot}=require('./dictionary_fingerprint');
const {KEY}=require('./release');
let inFlight=false;
async function onClosed(db){
 if(inFlight||flow.status().running)return {ok:true,started:false,reason:'ALREADY_RUNNING'};
 inFlight=true;
 try{
  const [missingUI,missingCategory,now,record]=await Promise.all([
   ui.missing(db),category.inspect(db),snapshot(db),
   db.query('SELECT config_value FROM gm_runtime_config WHERE config_key=$1',[KEY])
  ]);
  let prior='';
  try{prior=String(JSON.parse(record.rows[0].config_value).dictionary_hash||'');}catch(_){/* no prior release */}
  if(!missingUI.length&&!missingCategory&&prior===now)
   return {ok:true,started:false,reason:'NO_DICTIONARY_CHANGE'};
  const result=await flow.launch(db);
  return {ok:!!result.ok,started:!!result.started,reason:result.error||(prior!==now?'DICTIONARY_CHANGED':'MISSING_TRANSLATIONS'),remaining:{ui:missingUI.length,category:missingCategory}};
 }finally{inFlight=false;}
}
module.exports={onClosed};
