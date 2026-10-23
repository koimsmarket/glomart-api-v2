'use strict';
// GM_GPAY_V108. Event-driven recovery, no interval polling.
// Only a known G-PAY ledger payment may be retried; never calls debit/refund.
const RETRY_DELAYS_MS=[0,5000,15000,30000,60000];
const active=new Set();
const timers=new Map();
let ctx=null;
let bootstrapped=false;
const msg=e=>String(e&&e.message||e||'UNKNOWN').slice(0,100);
const sleep=t=>new Promise(resolve=>setTimeout(resolve,t));
async function pool(){if(!ctx||!ctx.getPool())throw Error('RECOVERY_DB_UNAVAILABLE');return ctx.getPool();}
async function record(c,tx,key,step,result,details){
 await c.query(`INSERT INTO public.gm_purchase_saga_event(tx_id,event_key,step,result,details)
 VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT(tx_id,event_key) DO NOTHING`,[tx,key,step,result,JSON.stringify(details||{})]);
}
async function manual(tx,reason){
 try{
  const p=await pool();
  const c=await p.connect();
  try{await c.query('BEGIN');
   const q=await c.query(`SELECT status FROM public.gm_purchase_saga WHERE tx_id=$1 FOR UPDATE`,[tx]);
   if(q.rows[0]&&!['ORDER_PAID','PURCHASE_CONFIRMED'].includes(q.rows[0].status)){
    await record(c,tx,'RECOVERY_ADMIN_REQUIRED','RECOVERY','FAILED',{reason:msg(reason)});
    await c.query(`UPDATE public.gm_purchase_saga SET status='RECONCILE_REQUIRED',last_error_code='RECOVERY_ADMIN_REQUIRED',updated_at=NOW() WHERE tx_id=$1`,[tx]);
   }
   await c.query('COMMIT');
  }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}
 }catch(e){console.error('[GM_GPAY_V108] ADMIN_RECORD_FAIL',tx,msg(e));}
}
async function attempt(tx,index){
 const p=await pool(); const c=await p.connect();
 let payload,ref,member,orderNo,sagaPoints;
 try{
  await c.query('BEGIN');
  const q=await c.query('SELECT * FROM public.gm_purchase_saga WHERE tx_id=$1 FOR UPDATE',[tx]);
  const s=q.rows[0];
  if(!s||['ORDER_PAID','PURCHASE_CONFIRMED','CANCELLED','COMPENSATED'].includes(s.status)){await c.query('COMMIT');return 'DONE';}
  const flags=await c.query(`SELECT event_key,details FROM public.gm_purchase_saga_event WHERE tx_id=$1 AND event_key IN ('RECOVERY_ADMIN_REQUIRED','RECOVERY_SNAPSHOT')`,[tx]);
  if(flags.rows.some(x=>x.event_key==='RECOVERY_ADMIN_REQUIRED')){await c.query('COMMIT');return 'ADMIN';}
  const snap=flags.rows.find(x=>x.event_key==='RECOVERY_SNAPSHOT');payload=snap&&snap.details&&snap.details.payload;
  ref=s.gpay_payment_ref;member=s.member_id;orderNo=s.order_no;sagaPoints=s.point_used_krw;
  if(!payload||!ref){await c.query('COMMIT');await manual(tx,'SNAPSHOT_OR_PAYMENT_REF_MISSING');return 'ADMIN';}
  if(String(payload.order_no)!==orderNo||String(payload.member_id)!==member||Number(payload.total_payment_price)!==Number(s.product_amount_krw)+Number(s.shipping_amount_krw)){
   await c.query('COMMIT');await manual(tx,'SNAPSHOT_IDENTITY_MISMATCH');return 'ADMIN';
  }
  const duplicate=await c.query(`SELECT event_id FROM public.gm_purchase_saga_event WHERE tx_id=$1 AND event_key=$2`,[tx,'RECOVERY_ATTEMPT_'+index]);
  if(duplicate.rowCount){await c.query('COMMIT');return 'ALREADY';}
  await record(c,tx,'RECOVERY_ATTEMPT_'+index,'RECOVERY','STARTED',{attempt:index});
  await c.query('COMMIT');
 }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}
 // Before any common order handling, ALWAYS verify payment again through existing order-create route.
 const request=Object.assign({},payload,{payment_method:'GPAY',gpay_payment_key:ref,gpay_tx_id:tx,
  point_used_amount:Number(sagaPoints),order_no:orderNo,gm_order_no:orderNo,member_id:member});
 await ctx.replay(request);
 return 'DONE';
}
async function run(tx){
 if(active.has(tx))return;active.add(tx);
 try{
  for(let i=1;i<=5;i++){
   try{
    const result=await attempt(tx,i);
    if(result==='DONE'||result==='ADMIN')return;
    if(result==='ALREADY')continue;
   }catch(e){console.error('[GM_GPAY_V108] RECOVERY_FAIL',JSON.stringify({tx,attempt:i,error:msg(e)}));}
   if(i<5)await sleep(RETRY_DELAYS_MS[i]);
  }
  await manual(tx,'MAX_RETRIES_EXCEEDED');
 }finally{active.delete(tx);}
}
function enqueue(tx){if(!/^[A-Za-z0-9_-]{10,130}$/.test(String(tx||'')))return;
 if(active.has(tx)||timers.has(tx))return;
 const task=setTimeout(()=>{timers.delete(tx);run(tx).catch(e=>console.error('[GM_GPAY_V108] RUN_FAIL',tx,msg(e)));},0);
 timers.set(tx,task);
}
function initialize(config){if(ctx)return;ctx=config;
 if(bootstrapped)return;bootstrapped=true;
 // Startup is a ONE-TIME recovery discovery, not a repeating database query.
 setImmediate(async()=>{
  try{
   const p=await pool();
   const q=await p.query(`SELECT s.tx_id FROM public.gm_purchase_saga s
     WHERE s.status IN ('GPAY_PAID','RECONCILE_REQUIRED') AND s.gpay_payment_ref IS NOT NULL
     AND NOT EXISTS(SELECT 1 FROM public.gm_purchase_saga_event e WHERE e.tx_id=s.tx_id AND e.event_key='RECOVERY_ADMIN_REQUIRED')
     ORDER BY s.updated_at ASC LIMIT 100`);
   for(const x of q.rows)enqueue(x.tx_id);
   console.log('[GM_GPAY_V108] STARTUP_ONCE',{found:q.rowCount});
  }catch(e){console.error('[GM_GPAY_V108] STARTUP_SCAN_UNAVAILABLE',msg(e));}
 });
}
module.exports={initialize,enqueue};
