'use strict';
const crypto=require('crypto');
function clean(v){return String(v==null?'':v).trim();}
function upper(v){return clean(v).toUpperCase();}
function bool(v,d){if(v===true||v===1)return true;if(v===false||v===0)return false;const s=clean(v).toLowerCase();if(['true','1','y','yes','on'].includes(s))return true;if(['false','0','n','no','off'].includes(s))return false;return d;}
function id(v){const n=parseInt(clean(v),10);return Number.isFinite(n)?n:0;}


/*
 * [AUTO ORDER CREDENTIAL VAULT]
 * gm_auto_order_account.encrypted_password는 기존 101 migration에 이미 존재한다.
 * 평문 비밀번호를 DB/로그/API 목록에 저장하거나 노출하지 않는다.
 * 전용 환경변수 GM_AUTO_ORDER_CREDENTIAL_KEY를 SHA-256으로 32바이트 키화하여
 * AES-256-GCM으로 암호화한다. 키가 없으면 비밀번호 신규 저장/복호화는 거부한다.
 */
function credentialSecrets(){
  const values=[
    clean(process.env.GM_AUTO_ORDER_CREDENTIAL_KEY),
    clean(process.env.GM_AUTO_ORDER_CREDENTIAL_SECRET),
    clean(process.env.AUTH_SESSION_SECRET)
  ].filter(Boolean);
  return [...new Set(values)];
}
function credentialKey(raw){
  raw=clean(raw||credentialSecrets()[0]);
  if(!raw) throw new Error('GM_AUTO_ORDER_CREDENTIAL_KEY or GM_AUTO_ORDER_CREDENTIAL_SECRET required');
  return crypto.createHash('sha256').update(raw,'utf8').digest();
}

function encryptPassword(plain){
  plain=String(plain==null?'':plain);
  if(!plain) return null;
  const iv=crypto.randomBytes(12);
  const cipher=crypto.createCipheriv('aes-256-gcm',credentialKey(),iv);
  const enc=Buffer.concat([cipher.update(plain,'utf8'),cipher.final()]);
  const tag=cipher.getAuthTag();
  return ['v1',iv.toString('base64url'),tag.toString('base64url'),enc.toString('base64url')].join(':');
}
function decryptPassword(value){
  const raw=clean(value);
  if(!raw) return '';
  const parts=raw.split(':');
  if(parts.length!==4||parts[0]!=='v1') throw new Error('unsupported encrypted_password format');
  const secrets=credentialSecrets();
  if(!secrets.length) throw new Error('GM_AUTO_ORDER_CREDENTIAL_KEY or GM_AUTO_ORDER_CREDENTIAL_SECRET required');
  let lastError=null;
  for(const sec of secrets){
    try{
      const decipher=crypto.createDecipheriv('aes-256-gcm',credentialKey(sec),Buffer.from(parts[1],'base64url'));
      decipher.setAuthTag(Buffer.from(parts[2],'base64url'));
      return Buffer.concat([decipher.update(Buffer.from(parts[3],'base64url')),decipher.final()]).toString('utf8');
    }catch(error){ lastError=error; }
  }
  throw new Error('encrypted_password decrypt failed with configured credential keys'+(lastError?'':' '));
}

async function ensure(pool){
  const r=await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='gm_auto_order_account'`);
  const c=new Set((r.rows||[]).map(x=>x.column_name));
  if(!c.size) throw new Error('gm_auto_order_account table not found');
  return c;
}
async function listAccounts(pool,o){
  const c=await ensure(pool); o=o||{};
  const where=[],p=[]; const add=v=>{p.push(v);return '$'+p.length;};
  if(clean(o.q)){
    const q=add('%'+clean(o.q)+'%'), parts=[];
    for(const x of ['admin_id','account_name','mall_account_id','login_id']) if(c.has(x)) parts.push(`COALESCE(${x}::text,'') ILIKE ${q}`);
    if(parts.length) where.push('('+parts.join(' OR ')+')');
  }
  if(clean(o.mall_code)&&c.has('mall_code')) where.push(`upper(COALESCE(mall_code,''))=${add(upper(o.mall_code))}`);
  if(['true','false'].includes(clean(o.enabled).toLowerCase())&&c.has('enabled')) where.push(`enabled=${add(clean(o.enabled).toLowerCase()==='true')}`);
  const cols=['account_admin_id','admin_id','account_admin_role','mall_account_id','mall_code','account_name','login_id','can_order','can_payment','enabled','created_at','updated_at'].filter(x=>c.has(x)); if(c.has('encrypted_password')) cols.push(`CASE WHEN COALESCE(encrypted_password,'')<>'' THEN true ELSE false END AS password_configured`);
  const w=where.length?'WHERE '+where.join(' AND '):'';
  const r=await pool.query(`SELECT ${cols.join(',')} FROM gm_auto_order_account ${w} ORDER BY mall_code,enabled DESC,admin_id,account_admin_id`,p);
  return {rows:r.rows||[],total:r.rows.length};
}
async function saveAccount(pool,x){
  const c=await ensure(pool); x=x||{};
  const mall=upper(x.mall_code), admin=clean(x.admin_id), name=clean(x.account_name);
  if(!['GMKR','CPKR','ALKR'].includes(mall)) throw new Error('mall_code must be GMKR, CPKR, or ALKR');
  if(!admin) throw new Error('admin_id required');
  if(!name) throw new Error('account_name required');
  const values={
    admin_id:admin,account_admin_role:upper(x.account_admin_role)||'OPERATOR',
    mall_account_id:clean(x.mall_account_id)||null,mall_code:mall,account_name:name,
    login_id:clean(x.login_id)||null,can_order:bool(x.can_order,true),
    can_payment:bool(x.can_payment,false),enabled:bool(x.enabled,true)
  };
  const usable=Object.entries(values).filter(([k])=>c.has(k));
  if(c.has('encrypted_password')){
    if(bool(x.clear_password,false)===true){
      usable.push(['encrypted_password',null]);
    }else if(clean(x.password)){
      usable.push(['encrypted_password',encryptPassword(String(x.password))]);
    }
  }
  const pk=id(x.account_admin_id);
  if(pk){
    const p=[pk], set=[];
    for(const [k,v] of usable){p.push(v);set.push(`${k}=$${p.length}`);}
    if(c.has('updated_at')) set.push('updated_at=now()');
    const r=await pool.query(`UPDATE gm_auto_order_account SET ${set.join(',')} WHERE account_admin_id=$1 RETURNING *`,p);
    if(!r.rows.length) throw new Error('account not found');
    return r.rows[0];
  }
  const cols=usable.map(([k])=>k), p=usable.map(([,v])=>v), vals=p.map((_,i)=>'$'+(i+1));
  if(c.has('created_at')){cols.push('created_at');vals.push('now()');}
  if(c.has('updated_at')){cols.push('updated_at');vals.push('now()');}
  return (await pool.query(`INSERT INTO gm_auto_order_account(${cols.join(',')}) VALUES(${vals.join(',')}) RETURNING *`,p)).rows[0];
}
async function setEnabled(pool,x){
  const c=await ensure(pool), pk=id(x.account_admin_id), en=bool(x.enabled,null);
  if(!pk) throw new Error('account_admin_id required');
  if(en===null) throw new Error('enabled required');
  const r=await pool.query(`UPDATE gm_auto_order_account SET enabled=$2${c.has('updated_at')?',updated_at=now()':''} WHERE account_admin_id=$1 RETURNING *`,[pk,en]);
  if(!r.rows.length) throw new Error('account not found');
  return r.rows[0];
}

async function credentialForLockedWork(pool,workId,input){
  input=input||{};
  const wid=id(workId), token=clean(input.lock_token), admin=clean(input.admin_id), mallAccount=clean(input.mall_account_id);
  if(!wid||!token) throw new Error('work_id and lock_token required');
  const wr=await pool.query(`
    SELECT w.work_id,w.work_status,w.lock_token,w.lock_admin_id,w.lock_mall_account_id,
           o.mall_code
      FROM gm_auto_order_work w
      JOIN gm_auto_order o ON o.auto_order_no=w.auto_order_no
     WHERE w.work_id=$1
     LIMIT 1`,[wid]);
  if(!wr.rows.length) throw new Error('work_not_found');
  const w=wr.rows[0];
  if(upper(w.work_status)!=='RUNNING') throw new Error('work_not_running');
  if(clean(w.lock_token)!==token) throw new Error('work_lock_invalid');
  if(admin && clean(w.lock_admin_id)!==admin) throw new Error('work_admin_mismatch');
  if(mallAccount && clean(w.lock_mall_account_id)!==mallAccount) throw new Error('work_mall_account_mismatch');
  const ar=await pool.query(`
    SELECT account_admin_id,login_id,encrypted_password
      FROM gm_auto_order_account
     WHERE enabled=true
       AND can_order=true
       AND upper(COALESCE(mall_code,''))=upper($1)
       AND COALESCE(mall_account_id,'')=$2
       AND COALESCE(admin_id,'')=$3
     ORDER BY CASE WHEN upper(COALESCE(account_admin_role,''))='MASTER' THEN 0 ELSE 1 END,
              account_admin_id DESC
     LIMIT 1`,[clean(w.mall_code),clean(w.lock_mall_account_id),clean(w.lock_admin_id)]);
  if(!ar.rows.length) throw new Error('mall_account_credential_not_found');
  const a=ar.rows[0];
  if(!clean(a.encrypted_password)) throw new Error('mall_account_password_not_configured');
  return {login_id:clean(a.login_id)||null,password:decryptPassword(a.encrypted_password)};
}
module.exports={VERSION:'GM_AUTO_ORDER_ACCOUNT_SERVICE_V004_CREDENTIAL_KEY_COMPAT',listAccounts,saveAccount,setEnabled,credentialForLockedWork};

