'use strict';
// GM_PLAY_UPDATE_V005: DEV/PROD policy is inert until explicitly published.
// Server-only staging. No automatic activation, no client app modifications.
const express = require('express');
const router = express.Router();
const CHANNELS = {DEV:'com.glomart.app.dev',PROD:'com.glomart.app'};
const MAX_CODE = 2147483647;
function db(req){return req.app&&req.app.locals&&req.app.locals.pool;}
function noStore(res){res.set('Cache-Control','no-store');}
function safeResponse(channel) {return {
  ok:true,enabled:false,channel,package_name:CHANNELS[channel],
  latest_version_code:1,minimum_version_code:1,latest_version:'',
  apk_url:'',play_url:'',force_update:false,release_ready:false,
  message:'',status:'NOT_CONFIGURED'
};}
function validCode(n){return typeof n==='number'&&Number.isSafeInteger(n)&&n>=1&&n<=MAX_CODE;}
function httpsUrl(value){
  if(typeof value!=='string'||value.length>1200)return false;
  if(!value)return true;
  try{const u=new URL(value);return u.protocol==='https:'&&!!u.hostname&&!u.username&&!u.password&&u.hash==='';}
  catch(_){return false;}
}
function cleanChannel(x){const c=String(x||'').trim().toUpperCase();return Object.prototype.hasOwnProperty.call(CHANNELS,c)?c:null;}
function publicPolicy(row,channel){
  if(!row||!row.enabled||!row.release_ready)return safeResponse(channel);
  return {ok:true,enabled:true,channel,package_name:CHANNELS[channel],
    latest_version_code:Number(row.latest_version_code),minimum_version_code:Number(row.minimum_version_code),
    latest_version:String(row.latest_version||''),apk_url:String(row.apk_url||''),play_url:String(row.play_url||''),
    force_update:!!row.force_update,release_ready:true,message:String(row.message||''),status:'ACTIVE'};
}
// Public endpoint intentionally OUTSIDE /api/gm/builder/*; that prefix is admin-session protected.
router.get('/api/gm/app-update/policy',async(req,res)=>{
  noStore(res);
  const channel=cleanChannel(req.query.channel);
  if(!channel)return res.status(400).json({ok:false,error:'INVALID_CHANNEL'});
  const claimedPackage=String(req.query.package_name||'').trim();
  if(claimedPackage&&claimedPackage!==CHANNELS[channel])return res.status(400).json({ok:false,error:'PACKAGE_CHANNEL_MISMATCH'});
  const pool=db(req);if(!pool)return res.json(safeResponse(channel));
  try{
    const r=await pool.query('SELECT * FROM gm_android_update_policy WHERE channel=$1',[channel]);
    return res.json(publicPolicy(r.rows[0],channel));
  }catch(e){
    if(e&&e.code==='42P01')return res.json(safeResponse(channel));
    console.warn('[GM_PLAY_UPDATE_V005 POLICY_READ]',e&&e.code||'FAILED');
    return res.status(503).json({ok:false,error:'POLICY_UNAVAILABLE'});
  }
});
// Protected by existing admin_session_gate AND admin_reauth's exact POST route.
router.get('/api/gm/builder/app-update/policy',async(req,res)=>{
  noStore(res);const pool=db(req);
  if(!pool)return res.status(503).json({ok:false,error:'DB_UNAVAILABLE'});
  try{const r=await pool.query('SELECT * FROM gm_android_update_policy ORDER BY channel');return res.json({ok:true,items:r.rows});}
  catch(e){return res.status(e&&e.code==='42P01'?409:503).json({ok:false,error:e&&e.code==='42P01'?'MIGRATION_REQUIRED':'POLICY_UNAVAILABLE'});}
});
router.post('/api/gm/builder/app-update/policy',async(req,res)=>{
  noStore(res);
  if(res.getHeader('X-GM-Builder-Reauth')!=='verified')return res.status(403).json({ok:false,error:'ADMIN_REAUTH_REQUIRED'});
  const b=req.body||{},channel=cleanChannel(b.channel),pool=db(req);
  if(!channel)return res.status(400).json({ok:false,error:'INVALID_CHANNEL'});
  if(!pool)return res.status(503).json({ok:false,error:'DB_UNAVAILABLE'});
  // V009 safety override: reauthenticated OFF cannot be blocked by invalid form
  // fields (version range / URLs) and cannot accidentally publish a new policy.
  if(b.disable_only===true){
    try{
      const r=await pool.query(`UPDATE gm_android_update_policy
        SET enabled=false,force_update=false,updated_at=now()
        WHERE channel=$1 RETURNING *`,[channel]);
      return res.json({ok:true,disabled:true,item:r.rows[0]||null});
    }catch(e){
      console.warn('[GM_PLAY_UPDATE_V009 POLICY_OFF]',e&&e.code||'FAILED');
      return res.status(e&&e.code==='42P01'?409:503).json({ok:false,error:e&&e.code==='42P01'?'MIGRATION_REQUIRED':'POLICY_OFF_FAILED'});
    }
  }
  const enabled=b.enabled===true,ready=b.release_ready===true,forced=b.force_update===true;
  const latest=b.latest_version_code,minimum=b.minimum_version_code;
  const apk=String(b.apk_url||'').trim(),play=String(b.play_url||'').trim(),version=String(b.latest_version||'').trim(),message=String(b.message||'').trim();
  if(!validCode(latest)||!validCode(minimum)||minimum>latest)return res.status(400).json({ok:false,error:'INVALID_VERSION_RANGE'});
  if(!httpsUrl(apk)||!httpsUrl(play)||version.length>100||message.length>1000)return res.status(400).json({ok:false,error:'INVALID_POLICY_FIELDS'});
  // Publish gate: all channels must have a deliverable HTTPS APK before activating direct-install clients.
  if(enabled&&(!ready||!apk))return res.status(409).json({ok:false,error:'RELEASE_NOT_READY'});
  // A forced upgrade must point to a version strictly above the minimum permitted prior version.
  // Release availability (actual download checksum / Play release) must still be tested before enable.
  try {
    const q=`INSERT INTO gm_android_update_policy
      (channel,package_name,latest_version_code,minimum_version_code,latest_version,apk_url,play_url,message,enabled,release_ready,force_update,updated_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now())
      ON CONFLICT(channel) DO UPDATE SET
      latest_version_code=EXCLUDED.latest_version_code,minimum_version_code=EXCLUDED.minimum_version_code,
      latest_version=EXCLUDED.latest_version,apk_url=EXCLUDED.apk_url,play_url=EXCLUDED.play_url,
      message=EXCLUDED.message,enabled=EXCLUDED.enabled,release_ready=EXCLUDED.release_ready,
      force_update=EXCLUDED.force_update,updated_at=now() RETURNING *`;
    const r=await pool.query(q,[channel,CHANNELS[channel],latest,minimum,version,apk,play,message,enabled,ready,forced]);
    return res.json({ok:true,item:r.rows[0]});
  }catch(e){console.warn('[GM_PLAY_UPDATE_V005 POLICY_WRITE]',e&&e.code||'FAILED');return res.status(e&&e.code==='42P01'?409:503).json({ok:false,error:e&&e.code==='42P01'?'MIGRATION_REQUIRED':'POLICY_SAVE_FAILED'});}
});
module.exports=router;
