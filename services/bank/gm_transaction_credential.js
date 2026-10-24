 'use strict';
// GM_GPAY_TRANSACTION_CREDENTIAL_V001. Shared proof for PAYMENT and TRANSFER.
// Never authorize a transaction by member_id alone. Caller must bind issued owner token to transaction.
const {gmVerifyHash}=require('../../routes/GM_MEMBER_PASSWORD');
let argon2;try{argon2=require('argon2');}catch(_){argon2=null;}
const memberRe=/^[A-Za-z0-9._@-]{2,80}$/;
const pinRe=/^[0-9]{6}$/;
const allowedPurpose=new Set(['PAYMENT','TRANSFER']);
const s=v=>String(v==null?'':v).trim();
function unavailable(){console.error('[GM_TRANSACTION_CREDENTIAL] PIN_PROVIDER_UNAVAILABLE module=argon2 installed=N');const e=Error('PIN_HASH_PROVIDER_UNAVAILABLE');e.status=503;throw e;}
async function checkMemberPassword(db,mid,pw){
  if(!memberRe.test(mid)||typeof pw!=='string'||pw.length<8||pw.length>256)return false;
  const {rows}=await db.query('SELECT password_hash FROM public.gm_member WHERE member_id=$1 LIMIT 1',[mid]);
  return !!(rows[0]&&rows[0].password_hash&&await gmVerifyHash(pw,String(rows[0].password_hash)));
}
async function getStatus(db,mid){
  if(!memberRe.test(mid))throw Object.assign(Error('INVALID_MEMBER'),{status:400});
  const r=await db.query('SELECT pin_version, locked_until FROM public.gm_member_payment_pin WHERE member_id=$1',[mid]);
  return {registered:r.rows.length>0,locked_until:r.rows[0]&&r.rows[0].locked_until||null};
}
async function register(db,{member_id,password,pin,pin_confirm}){
  const mid=s(member_id);
  if(!memberRe.test(mid)||!pinRe.test(pin)||pin!==pin_confirm)throw Object.assign(Error('INVALID_INPUT'),{status:400});
  if(!argon2||!argon2.hash||!argon2.argon2id)unavailable();
  if(!await checkMemberPassword(db,mid,password))throw Object.assign(Error('INVALID_CREDENTIALS'),{status:401});
  const hashed=await argon2.hash(pin,{type:argon2.argon2id,memoryCost:19456,timeCost:3,parallelism:1});
  const q=`INSERT INTO public.gm_member_payment_pin (member_id,pin_hash,pin_version,failed_attempts,locked_until)
   VALUES ($1,$2,1,0,NULL) ON CONFLICT(member_id) DO UPDATE
   SET pin_hash=excluded.pin_hash,pin_version=public.gm_member_payment_pin.pin_version+1,
       failed_attempts=0,locked_until=NULL,updated_at=NOW() RETURNING pin_version`;
  const r=await db.query(q,[mid,hashed]);
  return {registered:true,pin_version:String(r.rows[0].pin_version)};
}
async function verify(db,{member_id,method,secret,purpose}){
  const mid=s(member_id);const m=s(method).toUpperCase(),p=s(purpose).toUpperCase();
  if(!memberRe.test(mid)||!allowedPurpose.has(p)||!['PIN','PASSWORD'].includes(m))throw Object.assign(Error('INVALID_INPUT'),{status:400});
  if(m==='PASSWORD')return !!(await checkMemberPassword(db,mid,secret));
  if(!pinRe.test(secret))return false;
  if(!argon2||!argon2.verify)unavailable();
  // Lock row for duration of verification + failed counter update; prevents concurrent bypass.
  const client=await db.connect();
  try{
    await client.query('BEGIN');
    const r=await client.query('SELECT pin_hash,failed_attempts,locked_until FROM public.gm_member_payment_pin WHERE member_id=$1 FOR UPDATE',[mid]);
    const row=r.rows[0];
    if(!row){await client.query('COMMIT');return false;}
    if(row.locked_until&&new Date(row.locked_until).getTime()>Date.now()){
      await client.query('COMMIT');throw Object.assign(Error('PIN_LOCKED'),{status:429});
    }
    let valid=false;
    try{valid=!!await argon2.verify(row.pin_hash,secret);}catch(_){valid=false;}
    if(valid){await client.query('UPDATE public.gm_member_payment_pin SET failed_attempts=0,locked_until=NULL WHERE member_id=$1',[mid]);}
    else{
      const count=Number(row.failed_attempts||0)+1;
      await client.query('UPDATE public.gm_member_payment_pin SET failed_attempts=$2,locked_until=CASE WHEN $2>=5 THEN NOW()+INTERVAL \'15 minutes\' ELSE NULL END WHERE member_id=$1',[mid,count]);
    }
    await client.query('COMMIT');return valid;
  }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}
  finally{client.release();}
}
module.exports={verify,register,getStatus};
