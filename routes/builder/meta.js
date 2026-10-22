const express = require('express');
const router = express.Router();
const { TABLES, dbFrom, ok, fail, keySets } = require('./core');

// GM_BUILDER_MENU_V001: live public-schema inventory; this endpoint grants no write/export permissions.
// Unregistered tables are NOT added to TABLES (write/edit allowlist).
router.get('/api/gm/builder/tables', async (req,res)=>{
  const configured=Object.keys(TABLES).map(k=>({key:k,table:TABLES[k].table,keys:keySets(TABLES[k]),readOnly:false,source:'configured'}));
  const phase=String(req.query.phase||'full');
  if(req.query.configured_only==='1')return ok(res,{tables:configured,configured:configured.length,discovered:0,partial:true});
  if(!['names','stats','full'].includes(phase))return fail(res,400,'invalid table inventory phase');
  const started=Date.now();
  console.info('[GM_BUILDER_TABLES_V004] START',phase);
  try{
    const db=dbFrom(req);
    if(!db || typeof db.query!=='function')throw new Error('DB connection unavailable');
    // Names can be fetched quickly without computing sizes for every relation.
    const names=await db.query({
      text:`SELECT c.relname AS tablename
            FROM pg_catalog.pg_class c
            JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
            WHERE n.nspname='public' AND c.relkind IN ('r','p')
            ORDER BY c.relname`,
      query_timeout:8000
    });
    console.info('[GM_BUILDER_TABLES_V004] NAMES_OK',phase,'count='+names.rows.length,'ms='+(Date.now()-started));
    const registered=new Set(configured.map(x=>x.table));
    const live=names.rows.map(x=>String(x.tablename||'')).filter(x=>/^[a-z_][a-z0-9_]*$/.test(x));
    const result=live.map(table=>{
      const found=configured.find(x=>x.table===table);
      return found||{key:'readonly:'+table,table,keys:[],readOnly:true,source:'database'};
    });
    // Preserve configured entries whose underlying table is missing, but distinguish them.
    for(const entry of configured){if(!live.includes(entry.table))result.push({...entry,source:'configured_unverified'});}
    if(phase==='names'){
      console.info('[GM_BUILDER_TABLES_V004] DONE',phase,'ms='+(Date.now()-started));
      return ok(res,{tables:result,configured:configured.length,discovered:result.filter(x=>x.readOnly).length});
    }
    let details;
    try{
      // row_estimate is approximate; size includes TOAST and indexes.
      const stats=await db.query({
        text:`SELECT c.relname AS tablename,
                     GREATEST(c.reltuples,0)::bigint AS row_estimate,
                     pg_total_relation_size(c.oid)::bigint AS total_bytes
              FROM pg_catalog.pg_class c
              JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
              WHERE n.nspname='public' AND c.relkind IN ('r','p')
              ORDER BY c.relname`,
        query_timeout:8000
      });
      details=new Map(stats.rows.map(x=>[String(x.tablename),{rowEstimate:x.row_estimate==null?null:Number(x.row_estimate),totalBytes:x.total_bytes==null?null:Number(x.total_bytes)}]));
      console.info('[GM_BUILDER_TABLES_V004] STATS_OK',phase,'count='+stats.rows.length,'ms='+(Date.now()-started));
    }catch(err){
      console.warn('[GM_BUILDER_TABLES_V004] STATS_FAIL',phase,'ms='+(Date.now()-started),String(err&&err.message||err));
      return ok(res,{tables:result,configured:configured.length,discovered:result.filter(x=>x.readOnly).length,statsError:String(err&&err.message||err)});
    }
    const combined=result.map(x=>({...x,...(details.get(x.table)||{})}));
    console.info('[GM_BUILDER_TABLES_V004] DONE',phase,'ms='+(Date.now()-started));
    return ok(res,{tables:combined,configured:configured.length,discovered:result.filter(x=>x.readOnly).length});
  }catch(e){
    console.error('[GM_BUILDER_TABLES_V004] FAIL',phase,'ms='+(Date.now()-started),String(e&&e.stack||e));
    // A failed DB discovery MUST NOT be represented as a successful whole-DB inventory.
    return fail(res,503,'builder table discovery unavailable',{detail:String(e&&e.message||e)});
  }
});

// GM_BUILDER_REFUND_REQUEST_LIST_V002_PAID_ONLY
// 1차 환불 운영: 실제 송금/마감 처리는 하지 않는다.
// 주문취소 후 BANK + REQUESTED 상태만 조회하고, 환불계좌는 주문에 복사하지 않고
// gm_member의 현재 환불계좌를 JOIN하여 Builder에 표시한다.


router.get('/api/gm/builder/refund-requests', async (req,res)=>{
  const db = dbFrom(req);
  const limit = Math.min(Math.max(Number(req.query.limit || 500), 1), 5000);
  try{
    const r = await db.query(`
      SELECT
        o.order_no,
        o.member_id,
        COALESCE(m.member_name,'') AS member_name,
        COALESCE(o.refund_amount,0)::bigint AS refund_amount,
        COALESCE(o.refund_method,'') AS refund_method,
        COALESCE(o.refund_status,'') AS refund_status,
        COALESCE(m.refund_bank_name,'') AS refund_bank_name,
        COALESCE(m.refund_account_no,'') AS refund_account_no,
        COALESCE(m.refund_account_holder,'') AS refund_account_holder,
        o.cancel_completed_at,
        o.updated_at
      FROM gm_order o
      LEFT JOIN gm_member m ON m.member_id=o.member_id
      WHERE UPPER(COALESCE(o.refund_method,''))='BANK'
        AND UPPER(COALESCE(o.refund_status,'')) IN ('REQUESTED','PENDING')
        /* 환불목록은 반드시 결제 완료된 주문만 표시한다. 부분입금/미결제는 취소만 하고 제외한다. */
        AND UPPER(COALESCE(o.payment_status,'')) IN (
          'PAID','OVERPAID','PAYMENT_COMPLETE','PAYMENT_COMPLETED',
          'COMPLETED','COMPLETE','DONE','SUCCESS','SETTLED'
        )
      ORDER BY COALESCE(o.cancel_completed_at,o.updated_at,o.ordered_at) ASC, o.order_no ASC
      LIMIT $1
    `,[limit]);
    ok(res,{count:r.rows.length,items:r.rows});
  }catch(e){
    fail(res,500,'refund request list failed',{detail:String(e&&e.message||e)});
  }
});

module.exports = router;
