'use strict';
const ui=require('./ui'),category=require('./category');
let running=false;
let state={stage:'idle',total:{ui:0,category:0},done:{ui:0,category:0},failed:{category:0},remaining:{ui:0,category:0},error:null,version:null};
async function launch(db){
 if(running)return {ok:false,error:'ALREADY_RUNNING'};
 running=true;state={stage:'scanning',total:{ui:0,category:0},done:{ui:0,category:0},failed:{category:0},remaining:{ui:0,category:0},error:null,version:null};
 void (async()=>{try{
  // Fail closed: category translations and legacy publishing stay untouched.
  state.remaining.category=await category.inspect(db);
  state.stage='translating_ui';const uiOk=await ui.complete(db,state);
  state.stage='translating_category';const catOk=await category.complete(db,state);
  state.stage='verifying';state.remaining.category=await category.inspect(db);
  if(!uiOk || !catOk || state.remaining.category) {state.stage='incomplete';return;}
  // V002 deliberately does NOT alter existing category publisher/version.
  state.stage='publishing_ui';const p=await ui.publish(db);
  if(!p||!p.ok||!p.ready)throw Error('UI_PUBLISH_NOT_CONFIRMED '+JSON.stringify(p));
  state.version=p.version;state.stage='ui_complete_category_publish_pending';
 }catch(e){state.stage='error';state.error=String(e&&e.message||e);}finally{running=false;}})();
 return {ok:true,started:true};
}
module.exports={launch,status:()=>({...state,running})};
