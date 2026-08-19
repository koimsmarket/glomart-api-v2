/* GM_AUTO_ORDER_ACCOUNT_API_V001
 * V006 integrated gm_auto_order_account table.
 * DB rows only; no seeded/demo data. Current policy: MASTER-only.
 */
const express=require('express');
const crypto=require('crypto');
const router=express.Router();
const VERSION='GM_AUTO_ORDER_ACCOUNT_API_V001';
const clean=v=>String(v==null?'':v).trim();
const bool=v=>v===true||v===1||/^(1|true|y|yes)$/i.test(clean(v));
function db(req){return req.app.locals.pool||req.app.locals.db;}
function maskLogin(v){const s=clean(v);if(!s)return '';const at=s.indexOf('@');if(at>1)return s.slice(0,Math.min(3,at))+'***'+s.slice(at);if(s.length<=4)return '***';return s.slice(0,2)+'***'+s.slice(-2);}
function secret(){return clean(process.env.GM_AUTO_ORDER_CREDENTIAL_SECRET||process.env.AUTH_SESSION_SECRET);}
function encryptPassword(v){
  const sec=secret();if(!sec)throw new Error('GM_AUTO_ORDER_CREDENTIAL_SECRET or AUTH_SESSION_SECRET is required');
  const key=crypto.createHash('sha256').update(sec).digest(),iv=crypto.randomBytes(12);
  const c=crypto.createCipheriv('aes-256-gcm',key,iv),enc=Buffer.concat([c.update(String(v),'utf8'),c.final()]),tag=c.getAuthTag();
  return ['v1',iv.toString('base64url'),tag.toString('base64url'),enc.toString('base64url')].join(':');
}
async function tableExists(q,name){const r=await q.query("SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1 LIMIT 1",[name]);return !!r.rows.length;}
async function cols(q,name){const r=await q.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1",[name]);return new Set(r.rows.map(x=>x.column_name));}
function validate(b,editing){for(const k of ['mall_account_id','mall_code','account_name','login_id','admin_id'])if(!clean(b[k]))return k+' is required';if(!editing&&!clean(b.password))return 'password is required';if(clean(b.account_admin_role||'MASTER').toUpperCase()!=='MASTER')return 'current policy allows MASTER only';return '';}
router.get('/api/gm/auto-order/accounts',async(req,res)=>{
  try{
    const q=db(req);if(!q)return res.status(503).json({ok:false,error:'DB_NOT_READY',version:VERSION});
    if(!(await tableExists(q,'gm_auto_order_account')))return res.json({ok:true,accounts:[],version:VERSION});
    const c=await cols(q,'gm_auto_order_account');
    const wanted=['account_admin_id','admin_id','account_admin_role','mall_account_id','mall_code','account_name','login_id','enabled','can_order','can_payment','can_cancel','can_exchange','can_return','created_at','updated_at'];
    const select=wanted.filter(x=>c.has(x)).map(x=>'"'+x+'"').join(', ');
    const order=c.has('account_admin_id')?'account_admin_id NULLS LAST, mall_account_id':'mall_account_id';
    const r=await q.query(`SELECT ${select||'*'} FROM gm_auto_order_account ORDER BY ${order}`);
    const seen=new Set(),accounts=[];
    for(const row of r.rows){const id=clean(row.mall_account_id);if(!id||seen.has(id))continue;seen.add(id);accounts.push({...row,login_id_raw:clean(row.login_id),login_id:maskLogin(row.login_id),enabled:row.enabled!==false});}
    res.json({ok:true,accounts,version:VERSION});
  }catch(e){res.status(500).json({ok:false,error:String(e&&e.message||e),version:VERSION});}
});
router.post('/api/gm/auto-order/accounts',async(req,res)=>{
  try{
    const q=db(req),b=req.body||{},err=validate(b,false);if(err)return res.status(400).json({ok:false,error:err,version:VERSION});
    if(!(await tableExists(q,'gm_auto_order_account')))return res.status(409).json({ok:false,error:'gm_auto_order_account table not found',version:VERSION});
    const c=await cols(q,'gm_auto_order_account');
    const f={admin_id:clean(b.admin_id),account_admin_role:'MASTER',mall_account_id:clean(b.mall_account_id),mall_code:clean(b.mall_code).toUpperCase(),account_name:clean(b.account_name),login_id:clean(b.login_id),encrypted_password:encryptPassword(b.password),can_order:true,can_payment:true,can_cancel:true,can_exchange:true,can_return:true,enabled:bool(b.enabled),created_by_member_id:clean(b.admin_id),updated_by_member_id:clean(b.admin_id)};
    const ks=Object.keys(f).filter(k=>c.has(k)),vals=ks.map(k=>f[k]);
    if(c.has('created_at')){ks.push('created_at');vals.push(new Date());}if(c.has('updated_at')){ks.push('updated_at');vals.push(new Date());}
    await q.query(`INSERT INTO gm_auto_order_account (${ks.map(k=>'"'+k+'"').join(',')}) VALUES (${vals.map((_,i)=>'$'+(i+1)).join(',')})`,vals);
    res.json({ok:true,mall_account_id:clean(b.mall_account_id),version:VERSION});
  }catch(e){const m=String(e&&e.message||e);res.status(/duplicate|unique/i.test(m)?409:500).json({ok:false,error:m,version:VERSION});}
});
router.put('/api/gm/auto-order/accounts/:id',async(req,res)=>{
  try{
    const q=db(req),b={...(req.body||{}),mall_account_id:clean(req.params.id)},err=validate(b,true);if(err)return res.status(400).json({ok:false,error:err,version:VERSION});
    const c=await cols(q,'gm_auto_order_account');
    const f={admin_id:clean(b.admin_id),account_admin_role:'MASTER',mall_code:clean(b.mall_code).toUpperCase(),account_name:clean(b.account_name),login_id:clean(b.login_id),can_order:true,can_payment:true,can_cancel:true,can_exchange:true,can_return:true,enabled:bool(b.enabled),updated_by_member_id:clean(b.admin_id)};
    if(clean(b.password))f.encrypted_password=encryptPassword(b.password);if(c.has('updated_at'))f.updated_at=new Date();
    const ks=Object.keys(f).filter(k=>c.has(k)),vals=ks.map(k=>f[k]);vals.push(clean(req.params.id));
    const r=await q.query(`UPDATE gm_auto_order_account SET ${ks.map((k,i)=>`"${k}"=$${i+1}`).join(',')} WHERE mall_account_id=$${vals.length}`,vals);
    if(!r.rowCount)return res.status(404).json({ok:false,error:'account not found',version:VERSION});
    res.json({ok:true,mall_account_id:clean(req.params.id),version:VERSION});
  }catch(e){res.status(500).json({ok:false,error:String(e&&e.message||e),version:VERSION});}
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
