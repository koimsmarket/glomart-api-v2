'use strict';
// GM_GPAY_CHECKOUT_BALANCE_V061. Read-only, per-member authenticated bridge.
// Never accept member_id alone as authorization. Never expose the trusted caller key.
const router = require('express').Router();
const DEFAULT_BASE = 'https://port-0-guppy-pay-api-mss6kcqn688f1333.sel3.cloudtype.app';
const base = () => String(process.env.GPAY_API_BASE || DEFAULT_BASE).trim().replace(/\/+$/, '');
const member = x => String(x || '').trim();
router.get('/api/gm/gpay/checkout-balance', async (req,res) => {
  res.set('Cache-Control','no-store');
  const id=member(req.query.member_id);
  const auth=String(req.get('authorization')||'');
  if(!id || id.length>120)return res.status(400).json({ok:false,error:'MEMBER_ID_REQUIRED'});
  if(!/^Bearer [A-Za-z0-9._~+\/-]+={0,2}$/i.test(auth))return res.status(401).json({ok:false,error:'GPAY_OWNER_TOKEN_REQUIRED'});
  try{
    const controller = new AbortController();
    const timeout=setTimeout(()=>controller.abort(),6000);
    let upstream;
    try{upstream=await fetch(base()+'/api/gpay/dashboard?member_id='+encodeURIComponent(id),{
      headers:{authorization:auth,accept:'application/json'},signal:controller.signal});}
    finally{clearTimeout(timeout)}
    if(!upstream.ok){
      console.warn('[GM_GPAY_CHECKOUT_BALANCE_V001] upstream_rejected status='+upstream.status);
      return res.status(upstream.status===401||upstream.status===403?403:502).json({ok:false,error:upstream.status===401||upstream.status===403?'GPAY_OWNER_AUTH_REJECTED':'GPAY_BALANCE_UPSTREAM_FAILED'});
    }
    const data=await upstream.json();
    const amount=Number(data.balance_g);
    if(data.ok!==true || member(data.member_id)!==id || !Number.isSafeInteger(amount) || amount<0)
      return res.status(502).json({ok:false,error:'GPAY_BALANCE_INVALID_RESPONSE'});
    // V061: verify dashboard balance against ACTIVE certificate rows before passing
    // a *read-only* coverage preview to the checkout. No secrets/render seeds/transactions.
    if(!Array.isArray(data.wallet) || data.wallet.length>10000)
      return res.status(502).json({ok:false,error:'GPAY_WALLET_INVALID'});
    const wallet=[];
    let sum=0;
    for(const row of data.wallet){
      if(!row || !['ACTIVE','HOLD'].includes(row.status))
        return res.status(502).json({ok:false,error:'GPAY_WALLET_STATUS_INVALID'});
      if(row.status!=='ACTIVE')continue;
      const idNumber=Number(row.pay_id), value=Number(row.balance);
      if(!Number.isSafeInteger(idNumber)||idNumber<=0||!Number.isSafeInteger(value)||value<0||!Number.isSafeInteger(sum+value))
        return res.status(502).json({ok:false,error:'GPAY_WALLET_AMOUNT_INVALID'});
      sum+=value;
      wallet.push({pay_id:idNumber,balance_g:value,issued_at:row.issued_at||null});
    }
    if(sum!==amount){
      console.error('[GM_GPAY_CHECKOUT_BALANCE_V061] WALLET_SUM_MISMATCH');
      return res.status(502).json({ok:false,error:'GPAY_WALLET_TOTAL_MISMATCH'});
    }
    wallet.sort((a,b)=>String(a.issued_at||'').localeCompare(String(b.issued_at||''))||a.pay_id-b.pay_id);
    console.log('[GM_GPAY_CHECKOUT_BALANCE_V061] verified member=Y active_count='+wallet.length);
    return res.json({ok:true,member_id:id,balance_g:amount,active_certificates:wallet});
  }catch(e){
    console.error('[GM_GPAY_CHECKOUT_BALANCE_V001] error='+String(e&&e.name||'UNKNOWN'));
    return res.status(502).json({ok:false,error:'GPAY_BALANCE_UNAVAILABLE'});
  }
});

// V084: execute existing G-PAY payment using the already authenticated owner token.
// Only the trusted server holds GPAY_TRUSTED_CALLER_KEY. No second password challenge.
router.post('/api/gm/gpay/checkout-pay',async(req,res)=>{
  res.set('Cache-Control','no-store');
  const b=req.body||{};
  const mid=member(b.member_id),order=member(b.order_no),key=member(b.idempotency_key);
  const token=member(b.certificate_owner_token);
  const pay=Number(b.pay_amount_g);
  if(!mid||!token||!order||!key||order.length>80||key.length>160||
     !Number.isSafeInteger(pay)||pay<=0)
     return res.status(400).json({ok:false,error:'INVALID_CHECKOUT_PAYMENT'});
  // Glomart alone determines the payable amount. Check its prepared transaction
  // before allowing any G-PAY debit; never accept an arbitrary browser amount.
  const db=req.app.locals.db||req.app.locals.pool;
  if(!db){console.error('[GM_GPAY_V097_DIAG] CHECKOUT_STOP reason=GLOMART_DB_UNAVAILABLE order='+order);return res.status(503).json({ok:false,error:'GLOMART_DB_UNAVAILABLE'});}
  try{
    const prepared=await db.query(`SELECT member_id,gpay_amount,status,gpay_payment_ref
       FROM gm_purchase_saga WHERE order_no=$1 LIMIT 1`,[order]);
    const row=prepared.rows[0];
    if(!row||row.member_id!==mid||Number(row.gpay_amount)!==pay)
      return res.status(409).json({ok:false,error:'GLOMART_PREPARED_PAYMENT_MISMATCH'});
    if(!['ORDER_PENDING','GPAY_PAID','RECONCILE_REQUIRED','ORDER_PAID','PURCHASE_CONFIRMED'].includes(row.status))
      return res.status(409).json({ok:false,error:'GLOMART_PREPARED_PAYMENT_INVALID_STATUS'});
    if(row.gpay_payment_ref&&row.gpay_payment_ref!==key)
      return res.status(409).json({ok:false,error:'GLOMART_PAYMENT_REFERENCE_CONFLICT'});
  }catch(err){
    console.error('[GM_GPAY_V092] PREPARED_PAYMENT_LOOKUP_FAILED',String(err&&err.code||err&&err.message||err),'order='+order);
    return res.status(503).json({ok:false,error:'GLOMART_PREPARED_PAYMENT_UNAVAILABLE'});
  }
  const trusted=member(process.env.GPAY_TRUSTED_CALLER_KEY);
  if(trusted.length<32){console.error('[GM_GPAY_V097_DIAG] CHECKOUT_STOP reason=GPAY_TRUST_NOT_CONFIGURED order='+order);return res.status(503).json({ok:false,error:'GPAY_TRUST_NOT_CONFIGURED'});}
  const url=base(), trustedHeaders={'Content-Type':'application/json','Accept':'application/json','x-gpay-trusted-caller':trusted};
  const ac=new AbortController(), timer=setTimeout(()=>ac.abort(),12000);
  const upstream=async(path,body,headers)=>{
    const r=await fetch(url+path,{method:'POST',headers:headers||trustedHeaders,body:JSON.stringify(body),signal:ac.signal});
    const json=await r.json().catch(()=>({}));
    if(!r.ok||json.ok!==true){const e=new Error(String(json.error||'GPAY_UPSTREAM_FAILED'));e.status=r.status;throw e;}
    return json;
  };
  let paymentStage='VERIFY_ROUTE';
  let paymentCommitted=false;
  let paymentRef='';
  try{
    // Fail BEFORE debiting if the required V079 server-side verifier is absent.
    const probe=await fetch(url+'/api/gpay/ledger/payment/verify?'+new URLSearchParams({
      order_no:'GM_PRECHECK_NONEXISTENT',member_id:mid,idempotency_key:'GM_PRECHECK_NONEXISTENT'
    }),{headers:{'x-gpay-trusted-caller':trusted,'Accept':'application/json'},signal:ac.signal});
    const probeJson=await probe.json().catch(()=>({}));
    if(probe.status!==404||probeJson.error!=='PAYMENT_NOT_FOUND'){
      console.error('[GM_GPAY_V097_DIAG] CHECKOUT_STOP reason=GPAY_VERIFY_ROUTE_NOT_READY order='+order+' upstream_status='+probe.status+' upstream_error='+String(probeJson.error||'').slice(0,100));
      return res.status(503).json({ok:false,error:'GPAY_VERIFY_ROUTE_NOT_READY'});
    }
    // This token was created only after member-password verification in checkout-owner-auth.
    paymentStage='OWNER_AUTH';
    await upstream('/api/gpay/security/owner-token/verify',{member_id:mid,certificate_owner_token:token});
    paymentStage='NONCE';
    const nonce=await upstream('/api/gpay/security/nonces',{
      actor_type:'MEMBER',actor_id:mid,action_type:'PAYMENT',target_ref:order,amount:pay
    });
    paymentStage='GPAY_DEBIT_REQUESTED';
    const paid=await upstream('/api/gpay/ledger/payment',{
      member_id:mid,merchant_id:member(process.env.GPAY_MERCHANT_ID)||'GLOMART',
      order_no:order,idempotency_key:key,pay_amount_g:pay,security_nonce:nonce.nonce
    });
    if(!paid.payment||paid.payment.status!=='PAID'||paid.payment.order_no!==order||
       paid.payment.member_id!==mid||paid.payment.idempotency_key!==key)throw new Error('GPAY_COMMIT_RESPONSE_MISMATCH');
    paymentCommitted=true;
    paymentRef=String(paid.payment.id||paid.transaction_id||'');
    paymentStage='SAGA_PAID_JOURNAL';
    // V101: durable journal entry for the already committed G-PAY debit.
    // Any database failure here must NOT attempt another debit or invent a success.
    const journal=await db.connect();
    try{
      await journal.query('BEGIN');
      const intent=await journal.query('SELECT tx_id,status,gpay_payment_ref FROM public.gm_purchase_saga WHERE order_no=$1 FOR UPDATE',[order]);
      if(intent.rowCount!==1)throw new Error('GPAY_SAGA_AFTER_DEBIT_MISSING');
      const tx=intent.rows[0];
      if(tx.gpay_payment_ref&&tx.gpay_payment_ref!==key)throw new Error('GPAY_SAGA_PAYMENT_KEY_CONFLICT');
      if(tx.status==='ORDER_PENDING'||tx.status==='GPAY_UNKNOWN'){
        await journal.query(`UPDATE public.gm_purchase_saga SET status='GPAY_PAID',gpay_payment_ref=$2,version=version+1,updated_at=NOW() WHERE tx_id=$1`,[tx.tx_id,key]);
      }else if(!['GPAY_PAID','ORDER_PAID','PURCHASE_CONFIRMED'].includes(tx.status))throw new Error('GPAY_SAGA_STATUS_CONFLICT');
      await journal.query(`INSERT INTO public.gm_purchase_saga_event(tx_id,event_key,step,result,remote_ref,details)
        VALUES($1,$2,'GPAY_PAID','RECORDED',$2,$3::jsonb) ON CONFLICT(tx_id,event_key) DO NOTHING`,
        [tx.tx_id,'GPAY_PAID:'+key,JSON.stringify({order_no:order,payment_id:paid.payment.id||null})]);
      await journal.query('COMMIT');
    }catch(journalError){await journal.query('ROLLBACK').catch(()=>{});throw journalError;}
    finally{journal.release();}
    paymentStage='COMPLETE';
    console.info('[GM_GPAY_V084] GPAY_PAYMENT_COMMITTED',{order_no:order,transaction_id:paid.transaction_id});
    return res.json({ok:true,status:'PAID',order_no:order,idempotency_key:key,transaction_id:paid.transaction_id});
  }catch(e){
    console.error('[GM_GPAY_V084] CHECKOUT_PAYMENT_STOP',{order_no:order,error:String(e.message||e)});
    return res.status(e.status>=400&&e.status<500?409:502).json({ok:false,error:String(e.message||e),order_no:order,
      // A transport failure can occur AFTER the debit; do not create a new transaction on retry.
      status:'CHECK_LEDGER_BEFORE_RETRY'});
  }finally{clearTimeout(timer);}
});

module.exports=router;
