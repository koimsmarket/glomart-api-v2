'use strict';
function clean(v){return String(v==null?'':v).trim();}
function upper(v){return clean(v).toUpperCase();}
function bool(v,d){if(v===true||v===1)return true;if(v===false||v===0)return false;const s=clean(v).toLowerCase();if(['true','1','y','yes','on'].includes(s))return true;if(['false','0','n','no','off'].includes(s))return false;return d;}
function id(v){const n=parseInt(clean(v),10);return Number.isFinite(n)?n:0;}

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
  const cols=['account_admin_id','admin_id','account_admin_role','mall_account_id','mall_code','account_name','login_id','can_order','can_payment','can_builder','enabled','created_at','updated_at'].filter(x=>c.has(x));
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
    can_payment:bool(x.can_payment,false),can_builder:bool(x.can_builder,false),enabled:bool(x.enabled,true)
  };
  const usable=Object.entries(values).filter(([k])=>c.has(k));
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
module.exports={VERSION:'GM_AUTO_ORDER_ACCOUNT_SERVICE_V002',listAccounts,saveAccount,setEnabled};
