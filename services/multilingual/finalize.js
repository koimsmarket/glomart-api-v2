'use strict';
const ui=require('./ui'),category=require('./category');
let running=false;
let state={stage:'idle',total:{ui:0,category:0},done:{ui:0,category:0},failed:{category:0},remaining:{ui:0,category:0},error:null,version:null,categoryVersion:null};
async function launch(db){
 if(running)return {ok:false,error:'ALREADY_RUNNING'};
 running=true;state={stage:'scanning',total:{ui:0,category:0},done:{ui:0,category:0},failed:{category:0},remaining:{ui:0,category:0},error:null,version:null,categoryVersion:null};
 void (async()=>{try{
  // Fail closed: category translations and legacy publishing stay untouched.
  state.remaining.category=await category.inspect(db);
  state.stage='translating_ui';const uiOk=await ui.complete(db,state);
  state.stage='translating_category';const catOk=await category.complete(db,state);
  state.stage='verifying';state.remaining.category=await category.inspect(db);state.remaining.ui=(await ui.missing(db)).length;
  if(!uiOk || !catOk || state.remaining.category || state.remaining.ui) {state.stage='incomplete';return;}
  // Publish category first; do not expose a new UI version if category fails.
  // Category and UI versions remain distinct until the integrated version phase.
  state.stage='publishing_category';const c=await category.publish(db);
  if(!c||!c.ok)throw Error('CATEGORY_PUBLISH_NOT_CONFIRMED');
  state.categoryVersion=c.version;
  state.stage='publishing_ui';const p=await ui.publish(db);
  if(!p||!p.ok||!p.ready)throw Error('UI_PUBLISH_NOT_CONFIRMED '+JSON.stringify(p));
  state.version=p.version;state.stage='published_separate_versions';
 }catch(e){state.stage='error';state.error=String(e&&e.message||e);}finally{running=false;}})();
 return {ok:true,started:true};
}
module.exports={launch,status:()=>({...state,running})};
