/* GM_AUTO_ORDER_ACCOUNT_API_V008_CREDENTIAL_SELF_VERIFY
 * Production DB rows only. MASTER-only policy.
 * Password save succeeds only after DB re-read + decrypt + exact-match verification.
 * Plain password is never returned by this admin API.
 */
'use strict';
const express=require('express');
const router=express.Router();
const accountService=require('../services/account_service');
const VERSION='GM_AUTO_ORDER_ACCOUNT_API_V008_CREDENTIAL_SELF_VERIFY';
const clean=v=>String(v==null?'':v).trim();
const bool=v=>v===true||v===1||/^(1|true|y|yes)$/i.test(clean(v));
function db(req){return req.app.locals.pool||req.app.locals.db;}
function maskLogin(v){const s=clean(v);if(!s)return '';const at=s.indexOf('@');if(at>1)return s.slice(0,Math.min(3,at))+'***'+s.slice(at);if(s.length<=4)return '***';return s.slice(0,2)+'***'+s.slice(-2);}
async function tableExists(q,name){const r=await q.query("SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1 LIMIT 1",[name]);return !!r.rows.length;}
async function cols(q,name){const r=await q.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1",[name]);return new Set(r.rows.map(x=>x.column_name));}
function validate(b,editing){for(const k of ['mall_account_id','mall_code','account_name','login_id','admin_id'])if(!clean(b[k]))return k+' is required';if(!editing&&!clean(b.password))return 'password is required';if(clean(b.account_admin_role||'MASTER').toUpperCase()!=='MASTER')return 'current policy allows MASTER only';return '';}
async function withTx(q,fn){
  const client=typeof q.connect==='function'?await q.connect():q;
  const release=client!==q&&typeof client.release==='function'?()=>client.release():()=>{};
  try{await client.query('BEGIN');const out=await fn(client);await client.query('COMMIT');return out;}
  catch(e){try{await client.query('ROLLBACK');}catch(_e){}throw e;}
  finally{release();}
}
function healthPublic(h){return {
  credential_status:clean(h&&h.credential_status)||'UNKNOWN',
  password_configured:!!(h&&h.password_configured),
  password_decryptable:!!(h&&h.password_decryptable),
  login_id_configured:!!(h&&h.login_id_configured)
};}

router.get('/api/gm/auto-order/accounts',async(req,res)=>{
  try{
    const q=db(req);if(!q)return res.status(503).json({ok:false,error:'DB_NOT_READY',version:VERSION});
    if(!(await tableExists(q,'gm_auto_order_account')))return res.json({ok:true,accounts:[],version:VERSION});
    const c=await cols(q,'gm_auto_order_account');
    const wanted=['account_admin_id','admin_id','account_admin_role','mall_account_id','mall_code','account_name','login_id','enabled','can_order','can_payment','can_cancel','can_exchange','can_return','created_at','updated_at'];
    const selectParts=wanted.filter(x=>c.has(x)).map(x=>'"'+x+'"');
    if(c.has('encrypted_password')) selectParts.push(`CASE WHEN COALESCE(encrypted_password,'')<>'' THEN true ELSE false END AS password_configured`);
    const select=selectParts.join(', ');
    const order=[
      'mall_account_id',
      c.has('encrypted_password')?`CASE WHEN COALESCE(encrypted_password,'')<>'' THEN 0 ELSE 1 END`:'1',
      c.has('account_admin_role')?`CASE WHEN upper(COALESCE(account_admin_role,''))='MASTER' THEN 0 ELSE 1 END`:'1',
      c.has('account_admin_id')?'account_admin_id DESC':'mall_account_id'
    ].join(', ');
    const r=await q.query(`SELECT ${select||'*'} FROM gm_auto_order_account ORDER BY ${order}`);
    const seen=new Set(),accounts=[];
    for(const row of r.rows){
      const id=clean(row.mall_account_id);if(!id||seen.has(id))continue;seen.add(id);
      const h=await accountService.credentialHealth(q,id);
      accounts.push({...row,...healthPublic(h),login_id_raw:clean(row.login_id),login_id:maskLogin(row.login_id),enabled:row.enabled!==false});
    }
    res.json({ok:true,accounts,version:VERSION});
  }catch(e){res.status(500).json({ok:false,error:String(e&&e.message||e),version:VERSION});}
});

router.get('/api/gm/auto-order/accounts/:id/credential-health',async(req,res)=>{
  try{
    const q=db(req);if(!q)return res.status(503).json({ok:false,error:'DB_NOT_READY',version:VERSION});
    const h=await accountService.credentialHealth(q,clean(req.params.id));
    return res.status(h.credential_status==='ACCOUNT_NOT_FOUND'?404:200).json({ok:h.ok,health:healthPublic(h),error:h.ok?undefined:h.credential_status,version:VERSION});
  }catch(e){return res.status(500).json({ok:false,error:String(e&&e.message||e),version:VERSION});}
});

router.post('/api/gm/auto-order/accounts',async(req,res)=>{
  const q=db(req),b=req.body||{};
  try{
    const err=validate(b,false);if(err)return res.status(400).json({ok:false,error:err,version:VERSION});
    if(!(await tableExists(q,'gm_auto_order_account')))return res.status(409).json({ok:false,error:'gm_auto_order_account table not found',version:VERSION});
    const c=await cols(q,'gm_auto_order_account');
    const h=await withTx(q,async tx=>{
      const f={admin_id:clean(b.admin_id),account_admin_role:'MASTER',mall_account_id:clean(b.mall_account_id),mall_code:clean(b.mall_code).toUpperCase(),account_name:clean(b.account_name),login_id:clean(b.login_id),encrypted_password:accountService.encryptPassword(String(b.password)),can_order:true,can_payment:true,can_cancel:true,can_exchange:true,can_return:true,enabled:bool(b.enabled),created_by_member_id:clean(b.admin_id),updated_by_member_id:clean(b.admin_id)};
      const ks=Object.keys(f).filter(k=>c.has(k)),vals=ks.map(k=>f[k]);
      if(c.has('created_at')){ks.push('created_at');vals.push(new Date());}if(c.has('updated_at')){ks.push('updated_at');vals.push(new Date());}
      await tx.query(`INSERT INTO gm_auto_order_account (${ks.map(k=>'"'+k+'"').join(',')}) VALUES (${vals.map((_,i)=>'$'+(i+1)).join(',')})`,vals);
      const check=await accountService.credentialHealth(tx,clean(b.mall_account_id),String(b.password));
      if(!check.ok||check.password_matches!==true)throw new Error('credential_self_verify_failed:'+check.credential_status);
      return check;
    });
    res.json({ok:true,mall_account_id:clean(b.mall_account_id),health:healthPublic(h),version:VERSION});
  }catch(e){const m=String(e&&e.message||e);res.status(/duplicate|unique/i.test(m)?409:500).json({ok:false,error:m,version:VERSION});}
});

router.put('/api/gm/auto-order/accounts/:id',async(req,res)=>{
  const q=db(req),b={...(req.body||{}),mall_account_id:clean(req.params.id)};
  try{
    const err=validate(b,true);if(err)return res.status(400).json({ok:false,error:err,version:VERSION});
    const c=await cols(q,'gm_auto_order_account');
    const passwordChanged=!!clean(b.password);
    const h=await withTx(q,async tx=>{
      const f={admin_id:clean(b.admin_id),account_admin_role:'MASTER',mall_code:clean(b.mall_code).toUpperCase(),account_name:clean(b.account_name),login_id:clean(b.login_id),can_order:true,can_payment:true,can_cancel:true,can_exchange:true,can_return:true,enabled:bool(b.enabled),updated_by_member_id:clean(b.admin_id)};
      if(passwordChanged)f.encrypted_password=accountService.encryptPassword(String(b.password));if(c.has('updated_at'))f.updated_at=new Date();
      const ks=Object.keys(f).filter(k=>c.has(k)),vals=ks.map(k=>f[k]);vals.push(clean(req.params.id));
      const r=await tx.query(`UPDATE gm_auto_order_account SET ${ks.map((k,i)=>`"${k}"=$${i+1}`).join(',')} WHERE mall_account_id=$${vals.length}`,vals);
      if(!r.rowCount)throw Object.assign(new Error('account not found'),{statusCode:404});
      const check=await accountService.credentialHealth(tx,clean(req.params.id),passwordChanged?String(b.password):undefined);
      if(passwordChanged&&(!check.ok||check.password_matches!==true))throw new Error('credential_self_verify_failed:'+check.credential_status);
      return check;
    });
    res.json({ok:true,mall_account_id:clean(req.params.id),health:healthPublic(h),version:VERSION});
  }catch(e){res.status(e&&e.statusCode||500).json({ok:false,error:String(e&&e.message||e),version:VERSION});}
});

router.delete('/api/gm/auto-order/accounts/:id',async(req,res)=>{
  try{
    const q=db(req),id=clean(req.params.id);if(!id)return res.status(400).json({ok:false,error:'mall_account_id is required',version:VERSION});
    for(const table of ['gm_auto_order_work','gm_auto_order']){
      if(!(await tableExists(q,table)))continue;const c=await cols(q,table);if(!c.has('mall_account_id'))continue;
      const x=await q.query(`SELECT COUNT(*)::int AS n FROM ${table} WHERE mall_account_id=$1`,[id]);
      if(Number(x.rows[0]&&x.rows[0].n||0)>0)return res.status(409).json({ok:false,error:'이미 주문/작업 이력이 있는 계정입니다. 삭제 대신 사용중지하세요.',version:VERSION});
    }
    const r=await q.query('DELETE FROM gm_auto_order_account WHERE mall_account_id=$1',[id]);
    if(!r.rowCount)return res.status(404).json({ok:false,error:'account not found',version:VERSION});
    res.json({ok:true,deleted:id,version:VERSION});
  }catch(e){res.status(500).json({ok:false,error:String(e&&e.message||e),version:VERSION});}
});
module.exports=router;
