'use strict';
// GM_UI_AUTO_V005: Record a successful combined release WITHOUT changing the
// separately owned UI/category pack versions or the browser GM_V1 cache version.
// This marker is not an atomic public asset switch: the existing publishers
// remain sequential until a future staged-publication implementation.
const crypto=require('crypto');
const KEY='gm_multilingual_last_complete_release';
const {snapshot}=require('./dictionary_fingerprint');
function nonempty(v){return typeof v==='string'&&v.trim().length>0&&v.length<160;}
function kstStamp(){const d=new Date(Date.now()+9*3600000);return d.toISOString().slice(0,19).replace('T','_')+'KST';}
async function record(db,args){
 if(!db||typeof db.query!=='function')return {ok:false,error:'DB_MISSING'};
 const u=String(args&&args.uiVersion||'').trim(),c=String(args&&args.categoryVersion||'').trim();
 if(!nonempty(u)||!nonempty(c))return {ok:false,error:'VERSION_MISSING'};
 // Single-row UPSERT ensures readers never see a partially written release record.
 const dictionaryHash=await snapshot(db);
 const payload={schema:2,ui_version:u,category_version:c,completed_at_kst:kstStamp(),dictionary_hash:dictionaryHash};
 payload.fingerprint=crypto.createHash('sha256').update(u+'\n'+c).digest('hex');
 try{
   const previous=await db.query('SELECT config_value FROM gm_runtime_config WHERE config_key=$1',[KEY]);
   if(previous.rows&&previous.rows[0]){
     try{const x=JSON.parse(previous.rows[0].config_value);if(x.fingerprint===payload.fingerprint&&x.dictionary_hash===payload.dictionary_hash)return {ok:true,unchanged:true,release:x};}catch(_){}
   }
   await db.query(`INSERT INTO gm_runtime_config(config_key,config_value,value_type,category,mode,enabled,description,updated_at)
       VALUES($1,$2,'STRING','ASSET','AUTO',TRUE,'Last fully confirmed UI/category release pair',now())
       ON CONFLICT(config_key) DO UPDATE SET config_value=EXCLUDED.config_value,updated_at=now()`,[KEY,JSON.stringify(payload)]);
   return {ok:true,release:payload};
 }catch(e){return {ok:false,error:String(e&&e.message||e)};}
}
module.exports={record,KEY};
