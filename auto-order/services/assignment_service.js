'use strict';

/*
 * GM_AUTO_ORDER_ASSIGNMENT_SERVICE_V002
 *
 * Purpose:
 * - Assign READY control-tower work to an enabled operator/account.
 * - Use gm_auto_order_account as the assignment master.
 * - CPKR/ALKR require matching mall_code + can_order=true.
 * - GMKR also participates. Until supplier accounts are fully modeled,
 *   GMKR can use a GMKR account row or a generic row whose mall_code is blank.
 * - Assignment does NOT start execution. work_status remains READY.
 * - Existing assignment is preserved unless manually reassigned.
 */

function clean(v){ return String(v == null ? '' : v).trim(); }
function upper(v){ return clean(v).toUpperCase(); }
function int(v, fallback){
  const n = Number.parseInt(clean(v),10);
  return Number.isFinite(n) ? n : (fallback == null ? 0 : fallback);
}
async function tableExists(pool,name){
  const r=await pool.query(`
    SELECT EXISTS(
      SELECT 1 FROM information_schema.tables
      WHERE table_schema='public' AND table_name=$1
    ) AS ok
  `,[name]);
  return !!(r.rows[0]&&r.rows[0].ok);
}
async function ensure(pool){
  const names=['gm_auto_order','gm_auto_order_work','gm_auto_order_account'];
  const missing=[];
  for(const n of names) if(!(await tableExists(pool,n))) missing.push(n);
  if(missing.length) throw new Error('missing assignment tables: '+missing.join(','));
}

async function listAccounts(pool,opts){
  await ensure(pool);
  opts=opts||{};
  const where=[];
  const params=[];
  const add=v=>{params.push(v);return '$'+params.length;};

  const mall=upper(opts.mall_code);
  if(mall){
    const p=add(mall);
    where.push(`upper(COALESCE(a.mall_code,''))=${p}`);
  }
  if(String(opts.enabled||'').toLowerCase()==='true') where.push(`a.enabled=true`);
  if(String(opts.enabled||'').toLowerCase()==='false') where.push(`a.enabled=false`);

  const whereSql=where.length?'WHERE '+where.join(' AND '):'';
  const r=await pool.query(`
    SELECT
      a.account_admin_id,
      a.admin_id,
      a.account_admin_role,
      a.mall_account_id,
      a.mall_code,
      a.account_name,
      a.login_id,
      a.can_order,
      a.can_payment,
      a.enabled,
      COALESCE(w.active_count,0)::int AS active_count
    FROM gm_auto_order_account a
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS active_count
      FROM gm_auto_order_work x
      WHERE x.admin_id=a.admin_id
        AND (
          a.mall_account_id IS NULL
          OR x.mall_account_id=a.mall_account_id
        )
        AND upper(COALESCE(x.work_status,'')) IN ('READY','RUNNING')
    ) w ON TRUE
    ${whereSql}
    ORDER BY
      a.enabled DESC,
      a.can_order DESC,
      COALESCE(w.active_count,0) ASC,
      a.admin_id,
      a.account_admin_id
  `,params);

  return {rows:r.rows||[],count:r.rows.length};
}

async function candidateAccounts(client,mallCode){
  const mall=upper(mallCode);
  const r=await client.query(`
    SELECT
      a.account_admin_id,
      a.admin_id,
      a.mall_account_id,
      a.mall_code,
      a.account_name,
      a.account_admin_role,
      COALESCE(w.active_count,0)::int AS active_count
    FROM gm_auto_order_account a
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS active_count
      FROM gm_auto_order_work x
      WHERE x.admin_id=a.admin_id
        AND (
          a.mall_account_id IS NULL
          OR x.mall_account_id=a.mall_account_id
        )
        AND upper(COALESCE(x.work_status,'')) IN ('READY','RUNNING')
    ) w ON TRUE
    WHERE a.enabled=true
      AND a.can_order=true
      AND (
        upper(COALESCE(a.mall_code,''))=$1
        OR ($1='GMKR' AND COALESCE(a.mall_code,'')='')
      )
    ORDER BY
      COALESCE(w.active_count,0) ASC,
      CASE upper(COALESCE(a.account_admin_role,''))
        WHEN 'MASTER' THEN 1
        WHEN 'DEPUTY' THEN 2
        ELSE 3
      END,
      a.account_admin_id
  `,[mall]);
  return r.rows||[];
}

async function assignOne(client,work,account,source){
  const workId=work.work_id;
  const aoNo=work.auto_order_no;

  await client.query(`
    UPDATE gm_auto_order_work
    SET
      admin_id=$2,
      mall_account_id=$3,
      updated_at=now()
    WHERE work_id=$1
      AND upper(COALESCE(work_status,''))='READY'
  `,[workId,clean(account.admin_id),clean(account.mall_account_id)||null]);

  await client.query(`
    UPDATE gm_auto_order
    SET
      admin_id=$2,
      mall_account_id=$3,
      updated_at=now()
    WHERE auto_order_no=$1
  `,[aoNo,clean(account.admin_id),clean(account.mall_account_id)||null]);

  await client.query(`
    INSERT INTO gm_auto_order_log(
      auto_order_no,work_id,action_type,status_before,status_after,
      admin_id,mall_account_id,message,detail_json,created_at
    ) VALUES(
      $1,$2,'WORK_ASSIGN','READY','READY',
      $3,$4,$5,$6::jsonb,now()
    )
  `,[
    aoNo,workId,
    clean(account.admin_id),
    clean(account.mall_account_id)||null,
    'control tower work assigned',
    JSON.stringify({
      source:source||'auto',
      account_admin_id:account.account_admin_id||null,
      mall_code:work.mall_code||''
    })
  ]).catch(()=>{});

  return {
    work_id:workId,
    auto_order_no:aoNo,
    mall_code:work.mall_code,
    admin_id:clean(account.admin_id),
    mall_account_id:clean(account.mall_account_id)||null,
    account_admin_id:account.account_admin_id||null
  };
}

async function assignReady(pool,opts){
  await ensure(pool);
  opts=opts||{};
  const limit=Math.max(1,Math.min(500,int(opts.limit,100)));

  const client=await pool.connect();
  const out={scanned:0,assigned:0,no_account:0,already_assigned:0,items:[],unassigned:[]};

  try{
    await client.query('BEGIN');

    const r=await client.query(`
      SELECT
        w.work_id,w.auto_order_no,w.work_status,
        w.admin_id,w.mall_account_id,
        a.mall_code
      FROM gm_auto_order_work w
      JOIN gm_auto_order a ON a.auto_order_no=w.auto_order_no
      WHERE w.work_type='ORDER'
        AND upper(COALESCE(w.work_status,''))='READY'
      ORDER BY w.priority DESC,w.requested_at ASC,w.work_id ASC
      FOR UPDATE OF w SKIP LOCKED
      LIMIT $1
    `,[limit]);

    out.scanned=r.rows.length;

    for(const work of r.rows){
      if(clean(work.admin_id) || clean(work.mall_account_id)){
        out.already_assigned+=1;
        continue;
      }

      const accounts=await candidateAccounts(client,work.mall_code);
      if(!accounts.length){
        out.no_account+=1;
        out.unassigned.push({
          work_id:work.work_id,
          auto_order_no:work.auto_order_no,
          mall_code:work.mall_code,
          reason:'NO_ENABLED_ORDER_ACCOUNT'
        });
        continue;
      }

      const assigned=await assignOne(client,work,accounts[0],'auto');
      out.assigned+=1;
      out.items.push(assigned);
    }

    await client.query('COMMIT');
    return out;
  }catch(e){
    await client.query('ROLLBACK').catch(()=>{});
    throw e;
  }finally{
    client.release();
  }
}

async function assignWork(pool,input){
  await ensure(pool);
  input=input||{};
  const workId=int(input.work_id,0);
  if(!workId) throw new Error('work_id required');

  const client=await pool.connect();
  try{
    await client.query('BEGIN');

    const wr=await client.query(`
      SELECT w.*,a.mall_code
      FROM gm_auto_order_work w
      JOIN gm_auto_order a ON a.auto_order_no=w.auto_order_no
      WHERE w.work_id=$1
      FOR UPDATE
    `,[workId]);
    if(!wr.rows.length) throw new Error('work not found');

    const work=wr.rows[0];
    if(upper(work.work_status)!=='READY') throw new Error('only READY work can be assigned');

    let account=null;

    if(input.account_admin_id){
      const ar=await client.query(`
        SELECT *
        FROM gm_auto_order_account
        WHERE account_admin_id=$1
          AND enabled=true
          AND can_order=true
        LIMIT 1
      `,[int(input.account_admin_id,0)]);
      if(!ar.rows.length) throw new Error('enabled order account not found');
      account=ar.rows[0];
    }else{
      const adminId=clean(input.admin_id);
      const mallAccountId=clean(input.mall_account_id);
      if(!adminId) throw new Error('admin_id or account_admin_id required');
      account={
        account_admin_id:null,
        admin_id:adminId,
        mall_account_id:mallAccountId||null
      };
    }

    const result=await assignOne(client,work,account,'manual');
    await client.query('COMMIT');
    return result;
  }catch(e){
    await client.query('ROLLBACK').catch(()=>{});
    throw e;
  }finally{
    client.release();
  }
}

module.exports={
  VERSION:'GM_AUTO_ORDER_ASSIGNMENT_SERVICE_V002',
  listAccounts,
  assignReady,
  assignWork
};
