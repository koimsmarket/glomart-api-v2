// GM_UI_AUTO_V040: derzon-only native background translation worker endpoints.
// Does not change the existing server translation engine, publisher, or Builder endpoints.
'use strict';
const express = require('express');
const { dbFrom } = require('./core');
const uiV2 = require('../../services/multilingual/ui/ui_dictionary_v2');
const memberGuard = require('../gm_member_access_guard');
const router = express.Router();
const API='/api/gm/ui-dictionary/v2/derzon-worker';
const LIFE_DASHBOARD='https://port-0-glomart-life-api-mss6kcqn688f1333.sel3.cloudtype.app/api/life/gpay/dashboard';
let missingCells=null, missingPhrases=null;
let cachedUntil=0;
let runningUpload=false;

// Verify the actual Guppy Life bearer against the Life server; never accept client ID alone.
// No administrative password is persisted or bypassed. This token grants access only to
// the narrow, non-overwriting translation-cell endpoints below.
async function isAuthenticatedDerzon(req){
 const member=String(req.get('X-GM-Life-Member')||'');
 const token=String(req.get('X-GM-Life-Token')||'');
 if(member!=='derzon'||!/^life_[A-Za-z0-9_-]{12,256}$/.test(token))return false;
 try{
  const ac=new AbortController();const timer=setTimeout(()=>ac.abort(),6000);
  try{
   const r=await fetch(LIFE_DASHBOARD,{
    method:'GET',headers:{'X-GM-Life-Member':member,'X-GM-Life-Token':token,'Accept':'application/json'},
    signal:ac.signal,redirect:'error',cache:'no-store'
   });
   if(!r.ok)return false;
   const j=await r.json();
   return j && j.ok===true && j.member_id==='derzon';
  }finally{clearTimeout(timer);}
 }catch(_){return false;}
}
async function gate(req,res,next){
 // Two independent SERVER-VERIFIED alternatives: existing Glomart signed member
 // access token or the existing Guppy Life token. No client-supplied ID authority.
 const bearer=memberGuard.validate(req);
 if(bearer==='derzon')return next();
 if(await isAuthenticatedDerzon(req))return next();
 console.warn('[GM_UI_DERZON_AUTH_V040] denied path='+String(req.path||'').slice(0,110));
 return res.status(403).set('Cache-Control','no-store').json({ok:false,error:'DERZON_AUTH_REQUIRED'});
}
function conditions(){return uiV2.FOREIGN.map(l=>`NULLIF(BTRIM(${l}::text),'') IS NULL`)}
async function updateMissing(db,force){
 const now=Date.now();if(!force&&missingCells!==null&&now<cachedUntil)return;
 const cases=conditions().map(c=>`CASE WHEN ${c} THEN 1 ELSE 0 END`).join('+');
 const where=conditions().join(' OR ');
 const q=await db.query(`SELECT COUNT(*)::int AS phrases,COALESCE(SUM(${cases}),0)::int AS cells FROM gm_ui_dictionary WHERE active_yn='Y' AND NULLIF(BTRIM(kr::text),'') IS NOT NULL AND (${where})`);
 missingCells=Number(q.rows[0].cells||0);missingPhrases=Number(q.rows[0].phrases||0);cachedUntil=now+60000;
}
router.get(API+'/status',gate,async(req,res)=>{
 try{await updateMissing(dbFrom(req),false);res.set('Cache-Control','no-store').json({ok:true,missing_cells:missingCells,missing_phrases:missingPhrases});}
 catch(_){res.status(500).json({ok:false,error:'WORKER_STATUS_FAILED'});}
});
router.get(API+'/missing',gate,async(req,res)=>{
 try{
  const db=dbFrom(req),cols=uiV2.FOREIGN,where=conditions().join(' OR ');
  const q=await db.query(`SELECT gm_code,kr,${cols.join(',')} FROM gm_ui_dictionary WHERE active_yn='Y' AND NULLIF(BTRIM(kr::text),'') IS NOT NULL AND (${where}) ORDER BY gm_code LIMIT 10`);
  res.set('Cache-Control','no-store').json({ok:true,items:q.rows.map(r=>({gm_code:r.gm_code,kr:r.kr,missing:cols.filter(l=>!String(r[l]||'').trim())}))});
 }catch(_){res.status(500).json({ok:false,error:'WORKER_MISSING_FAILED'});}
});
router.post(API+'/upload',gate,express.json({limit:'48kb'}),async(req,res)=>{
 const entries=req.body&&req.body.items;
 if(!Array.isArray(entries)||entries.length<1||entries.length>10)return res.status(400).json({ok:false,error:'BATCH_LIMIT'});
 if(runningUpload)return res.status(429).json({ok:false,error:'UPLOAD_BUSY'});
 const validated=[],seen=new Set();
 for(const x of entries){
  const code=String(x&&x.gm_code||''),kr=String(x&&x.kr||''),lang=String(x&&x.lang||''),value=String(x&&x.value||'').trim();
  if(!/^GM_\d{4,}$/.test(code)||!uiV2.FOREIGN.includes(lang)||!kr.trim()||kr.length>500||!value||value.length>3000||value===kr)
   return res.status(400).json({ok:false,error:'INVALID_CELL'});
  if((kr.match(/%[dsm]/g)||[]).join('|')!==(value.match(/%[dsm]/g)||[]).join('|'))return res.status(400).json({ok:false,error:'PLACEHOLDER_MISMATCH'});
  const key=code+':'+lang;if(seen.has(key))return res.status(400).json({ok:false,error:'DUPLICATE_CELL'});
  seen.add(key);validated.push({code,kr,lang,value});
 }
 runningUpload=true;const db=dbFrom(req);let client,tx=false;
 try{
  client=await db.connect();await client.query('BEGIN');tx=true;
  const codes=[...new Set(validated.map(x=>x.code))].sort();const rows=new Map();
  for(const code of codes){
   const q=await client.query(`SELECT gm_code,kr,${uiV2.FOREIGN.join(',')} FROM gm_ui_dictionary WHERE gm_code=$1 AND active_yn='Y' FOR UPDATE`,[code]);
   if(q.rowCount!==1)throw Error('ROW_CHANGED');rows.set(code,q.rows[0]);
  }
  let saved=0,already=0;
  for(const x of validated){
   const row=rows.get(x.code);if(row.kr!==x.kr)throw Error('TEXT_CHANGED');
   if(String(row[x.lang]||'').trim()){already++;continue;}
   await client.query(`UPDATE gm_ui_dictionary SET ${x.lang}=$2,updated_at=now() WHERE gm_code=$1 AND NULLIF(BTRIM(${x.lang}::text),'') IS NULL`,[x.code,x.value]);
   row[x.lang]=x.value;saved++;
  }
  for(const code of codes){const row=rows.get(code);await client.query('UPDATE gm_ui_dictionary SET translation_status=$2 WHERE gm_code=$1',[code,uiV2.FOREIGN.some(l=>!String(row[l]||'').trim())?'PARTIAL':'READY']);}
  await client.query('COMMIT');tx=false;
  if(saved){cachedUntil=0; // Only existing publisher is used; no new publisher or translation algorithm.
   require('../../services/multilingual/ui/ui_dictionary_auto_publish').scheduleAutomation(db,'CLIENT_TRANSLATION_SAVED');}
  res.set('Cache-Control','no-store').json({ok:true,saved,already});
 }catch(_){if(tx&&client)await client.query('ROLLBACK').catch(()=>{});res.status(409).json({ok:false,error:'WORKER_UPLOAD_FAILED'});}
 finally{if(client)client.release();runningUpload=false;}
});
module.exports=router;
