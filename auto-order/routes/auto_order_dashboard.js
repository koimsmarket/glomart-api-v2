'use strict';

const express = require('express');
const router = express.Router();
const controlTower = require('../services/control_tower_service');
const assignment = require('../services/assignment_service');

/*
 * GM_AUTO_ORDER_DASHBOARD_API_V017
 *
 * This is the ONLY auto-order dashboard server route file.
 *
 * Browser:
 *   auto-order/dashboard.js
 *
 * Server API:
 *   auto-order/routes/auto_order_dashboard.js
 *
 * No Coupang/Ali access occurs here. This module reads Glomart DB only.
 */

function qIdent(name){
  return '"' + String(name).replace(/"/g, '""') + '"';
}

function num(v){
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

async function tableExists(pool, table){
  const r = await pool.query(`
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema='public' AND table_name=$1
    LIMIT 1
  `, [table]);
  return r.rows.length > 0;
}

async function firstExistingTable(pool, names){
  for(const name of names){
    if(await tableExists(pool, name)) return name;
  }
  return '';
}

async function columnNames(pool, table){
  const r = await pool.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name=$1
    ORDER BY ordinal_position
  `, [table]);
  return r.rows.map(x => x.column_name);
}

function firstCol(cols, names){
  for(const name of names){
    if(cols.includes(name)) return name;
  }
  return '';
}

function rawExpr(alias, cols, names, fallback="''"){
  const c = firstCol(cols, names);
  return c ? `${alias}.${qIdent(c)}` : fallback;
}

function textExpr(alias, cols, names){
  return `COALESCE(${rawExpr(alias, cols, names, "''")}::text,'')`;
}

function numericExpr(alias, cols, names){
  const c = firstCol(cols, names);
  if(!c) return '0';
  const e = `${alias}.${qIdent(c)}`;
  return `COALESCE(NULLIF(regexp_replace(COALESCE(${e}::text,''),'[^0-9.\\\\-]','','g'),'')::numeric,0)`;
}

function dateExpr(alias, cols, names){
  const c = firstCol(cols, names);
  return c ? `${alias}.${qIdent(c)}` : '';
}

function today(expr){
  return expr ? `${expr} >= date_trunc('day', now())` : 'FALSE';
}

function month(expr){
  return expr ? `${expr} >= date_trunc('month', now())` : 'FALSE';
}

function blankSummary(){
  return {
    mode: process.env.GM_AUTO_ORDER_MODE || 'SEMI_AUTO',
    updated_at: new Date().toISOString(),

    today_order_amount:0,
    month_order_amount:0,
    today_orders:0,
    month_orders:0,

    today_paid_amount:0,
    month_paid_amount:0,
    today_paid_count:0,
    month_paid_count:0,

    today_refund_amount:0,
    month_refund_amount:0,
    today_refund_count:0,
    month_refund_count:0,

    auto_order_waiting:0,
    preparing:0,
    delivery_hold:0,
    delivery_ready:0,
    shipping:0,

    cancel_request:0,
    cancel_processing:0,
    exchange_request:0,
    exchange_processing:0,
    return_request:0,
    return_processing:0,
    refund_waiting:0,

    auto_order_success:0,
    payment_done:0,
    delivery_ready_done:0,
    shipping_started:0,
    delivered:0,
    cancel_done:0,
    exchange_done:0,
    return_done:0,
    refund_done:0,

    client_online:0,
    cpkr_ready:0,
    alkr_ready:0,
    payment_waiting:0,

    auto_order_failed:0,
    login_required:0,
    price_changed:0,
    stock_or_option_error:0,
    no_invoice:0,
    delivery_delay:0,
    pending_cs:0
  };
}

async function buildSummary(pool){
  const out = blankSummary();

  const orderTable = await firstExistingTable(pool, ['gm_order','gm_orders']);
  const itemTable = await firstExistingTable(pool, ['gm_order_item','gm_order_items']);
  if(!orderTable) return out;

  const oc = await columnNames(pool, orderTable);

  const orderedAt = dateExpr('o', oc, ['ordered_at','created_at','order_date','updated_at']);
  const updatedAt = dateExpr('o', oc, ['updated_at','created_at','ordered_at']);
  const paidAt = dateExpr('o', oc, ['payment_completed_at','payment_confirmed_at','paid_at','updated_at','ordered_at','created_at']);
  const refundAt = dateExpr('o', oc, ['refund_completed_at','refunded_at','updated_at','created_at','ordered_at']);

  const totalAmount = numericExpr('o', oc, [
    'total_payment_price',
    'expected_payment_amount',
    'total_order_amount',
    'order_amount',
    'total_amount',
    'total_product_price'
  ]);

  const paidAmount = numericExpr('o', oc, [
    'actual_payment_amount',
    'paid_amount',
    'payment_amount',
    'total_paid_amount'
  ]);

  const refundAmount = numericExpr('o', oc, [
    'refund_amount',
    'refunded_amount',
    'total_refund_amount'
  ]);

  const orderStatus = textExpr('o', oc, ['order_status','status','total_status','item_order_status']);
  const sellerStatus = textExpr('o', oc, ['seller_status','order_status','status','total_status']);
  const customerStatus = textExpr('o', oc, ['customer_status']);
  const shippingStatus = textExpr('o', oc, ['shipping_status','delivery_status']);
  const csStatus = textExpr('o', oc, ['cs_status']);

  const r = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE ${today(orderedAt)})::int AS today_orders,
      COUNT(*) FILTER (WHERE ${month(orderedAt)})::int AS month_orders,

      COALESCE(SUM(${totalAmount}) FILTER (WHERE ${today(orderedAt)}),0)::numeric AS today_order_amount,
      COALESCE(SUM(${totalAmount}) FILTER (WHERE ${month(orderedAt)}),0)::numeric AS month_order_amount,

      COUNT(*) FILTER (WHERE ${today(paidAt)} AND ${paidAmount}>0)::int AS today_paid_count,
      COUNT(*) FILTER (WHERE ${month(paidAt)} AND ${paidAmount}>0)::int AS month_paid_count,
      COALESCE(SUM(${paidAmount}) FILTER (WHERE ${today(paidAt)}),0)::numeric AS today_paid_amount,
      COALESCE(SUM(${paidAmount}) FILTER (WHERE ${month(paidAt)}),0)::numeric AS month_paid_amount,

      COUNT(*) FILTER (WHERE ${today(refundAt)} AND ${refundAmount}>0)::int AS today_refund_count,
      COUNT(*) FILTER (WHERE ${month(refundAt)} AND ${refundAmount}>0)::int AS month_refund_count,
      COALESCE(SUM(${refundAmount}) FILTER (WHERE ${today(refundAt)}),0)::numeric AS today_refund_amount,
      COALESCE(SUM(${refundAmount}) FILTER (WHERE ${month(refundAt)}),0)::numeric AS month_refund_amount,

      COUNT(*) FILTER (
        WHERE lower(${orderStatus}) NOT IN (
          'complete','completed','done','purchased','paid','delivered',
          'cancel','cancelled','error','failed',
          '주문완료','처리완료','발주완료','취소','오류'
        )
      )::int AS auto_order_waiting,

      COUNT(*) FILTER (
        WHERE upper(${sellerStatus}) IN ('PREPARING','PRODUCT_PREPARING')
      )::int AS preparing,

      COUNT(*) FILTER (
        WHERE upper(${shippingStatus}) IN ('HOLD','ON_HOLD','DELIVERY_HOLD')
      )::int AS delivery_hold,

      COUNT(*) FILTER (
        WHERE upper(${shippingStatus}) IN ('READY','READY_TO_SHIP','DELIVERY_READY','PREPARING')
      )::int AS delivery_ready,

      COUNT(*) FILTER (
        WHERE upper(${shippingStatus}) IN ('SHIPPING','IN_TRANSIT','SHIPPED','DISPATCHED')
           OR upper(${sellerStatus}) IN ('SHIPPING','IN_TRANSIT','SHIPPED','DISPATCHED')
      )::int AS shipping,

      COUNT(*) FILTER (WHERE upper(${customerStatus})='CANCEL_REQUESTED')::int AS cancel_request,
      COUNT(*) FILTER (WHERE upper(${customerStatus})='CANCEL_PROCESSING')::int AS cancel_processing,
      COUNT(*) FILTER (WHERE upper(${customerStatus})='EXCHANGE_REQUESTED')::int AS exchange_request,
      COUNT(*) FILTER (WHERE upper(${customerStatus})='EXCHANGE_PROCESSING')::int AS exchange_processing,
      COUNT(*) FILTER (WHERE upper(${customerStatus})='RETURN_REQUESTED')::int AS return_request,
      COUNT(*) FILTER (WHERE upper(${customerStatus})='RETURN_PROCESSING')::int AS return_processing,

      COUNT(*) FILTER (
        WHERE upper(${customerStatus}) IN ('CANCEL_COMPLETED','RETURN_COMPLETED')
          AND ${refundAmount}=0
      )::int AS refund_waiting,

      COUNT(*) FILTER (
        WHERE lower(${orderStatus}) IN (
          'complete','completed','done','purchased','paid',
          '주문완료','처리완료','발주완료'
        )
          AND ${today(updatedAt || orderedAt)}
      )::int AS auto_order_success,

      COUNT(*) FILTER (
        WHERE ${paidAmount}>0
          AND ${today(paidAt)}
      )::int AS payment_done,

      COUNT(*) FILTER (
        WHERE upper(${shippingStatus}) IN ('READY','READY_TO_SHIP','DELIVERY_READY','PREPARING')
          AND ${today(updatedAt || orderedAt)}
      )::int AS delivery_ready_done,

      COUNT(*) FILTER (
        WHERE upper(${shippingStatus}) IN ('SHIPPING','IN_TRANSIT','SHIPPED','DISPATCHED')
          AND ${today(updatedAt || orderedAt)}
      )::int AS shipping_started,

      COUNT(*) FILTER (
        WHERE lower(${orderStatus})='delivered'
          AND ${today(updatedAt || orderedAt)}
      )::int AS delivered,

      COUNT(*) FILTER (
        WHERE upper(${customerStatus})='CANCEL_COMPLETED'
          AND ${today(updatedAt || orderedAt)}
      )::int AS cancel_done,

      COUNT(*) FILTER (
        WHERE upper(${customerStatus})='EXCHANGE_COMPLETED'
          AND ${today(updatedAt || orderedAt)}
      )::int AS exchange_done,

      COUNT(*) FILTER (
        WHERE upper(${customerStatus})='RETURN_COMPLETED'
          AND ${today(updatedAt || orderedAt)}
      )::int AS return_done,

      COUNT(*) FILTER (
        WHERE ${refundAmount}>0
          AND ${today(refundAt)}
      )::int AS refund_done,

      COUNT(*) FILTER (
        WHERE upper(${csStatus}) NOT IN ('','NONE','DONE','COMPLETED','CLOSED')
      )::int AS pending_cs
    FROM ${qIdent(orderTable)} o
  `);

  Object.assign(out, r.rows[0] || {});

  if(itemTable){
    const ic = await columnNames(pool, itemTable);
    const itemStatus = textExpr('i', ic, ['item_order_status','order_status','status']);
    const itemShipping = textExpr('i', ic, ['item_shipping_status','shipping_status','delivery_status']);
    const tracking = textExpr('i', ic, ['tracking_number','invoice_no']);

    const ex = await pool.query(`
      SELECT
        COUNT(*) FILTER (
          WHERE upper(${itemStatus}) IN ('FAILED','ORDER_FAILED','AUTO_ORDER_FAILED','ERROR')
        )::int AS auto_order_failed,

        COUNT(*) FILTER (
          WHERE upper(${itemStatus}) IN ('LOGIN_REQUIRED','AUTH_REQUIRED')
        )::int AS login_required,

        COUNT(*) FILTER (
          WHERE upper(${itemStatus}) IN ('PRICE_CHANGED','PRICE_MISMATCH')
        )::int AS price_changed,

        COUNT(*) FILTER (
          WHERE upper(${itemStatus}) IN ('OUT_OF_STOCK','OPTION_ERROR','OPTION_MISMATCH','STOCK_ERROR')
        )::int AS stock_or_option_error,

        COUNT(*) FILTER (
          WHERE upper(${itemShipping}) IN ('SHIPPING','IN_TRANSIT','SHIPPED','DISPATCHED')
            AND btrim(${tracking})=''
        )::int AS no_invoice,

        COUNT(*) FILTER (
          WHERE upper(${itemShipping}) IN ('DELAYED','DELIVERY_DELAY')
        )::int AS delivery_delay
      FROM ${qIdent(itemTable)} i
    `);

    Object.assign(out, ex.rows[0] || {});
  }

  for(const [key, value] of Object.entries(out)){
    if(key === 'mode' || key === 'updated_at') continue;
    out[key] = num(value);
  }
  out.updated_at = new Date().toISOString();
  return out;
}

async function buildAttention(pool){
  const orderTable = await firstExistingTable(pool, ['gm_order','gm_orders']);
  const itemTable = await firstExistingTable(pool, ['gm_order_item','gm_order_items']);
  if(!orderTable) return [];

  const oc = await columnNames(pool, orderTable);

  const orderNo = rawExpr('o', oc, ['order_no','order_id','cafe24_order_id','gm_order_id'], "''");
  const orderedAt = rawExpr('o', oc, ['ordered_at','created_at','order_date','updated_at'], 'now()');
  const orderStatus = textExpr('o', oc, ['order_status','status','total_status','item_order_status']);
  const customerStatus = textExpr('o', oc, ['customer_status']);
  const shippingStatus = textExpr('o', oc, ['shipping_status','delivery_status']);
  const csStatus = textExpr('o', oc, ['cs_status']);

  let join = '';
  let productName = "''";
  let sourceMall = "''";
  let itemStatus = "''";

  if(itemTable){
    const ic = await columnNames(pool, itemTable);
    const itemOrderNo = firstCol(ic, ['order_no','order_id','cafe24_order_id','gm_order_id']);

    if(itemOrderNo){
      join = `
        LEFT JOIN LATERAL (
          SELECT *
          FROM ${qIdent(itemTable)} ix
          WHERE ix.${qIdent(itemOrderNo)}::text = ${orderNo}::text
          LIMIT 1
        ) i ON TRUE
      `;
      productName = textExpr('i', ic, ['product_name','name']);
      sourceMall = textExpr('i', ic, ['source_mall','mall_code','source_code']);
      itemStatus = textExpr('i', ic, ['item_order_status','order_status','status']);
    }
  }

  const r = await pool.query(`
    SELECT
      ${orderedAt} AS ordered_at,
      ${orderNo}::text AS order_no,
      ${sourceMall} AS source_mall,
      ${productName} AS product_name,
      ${orderStatus} AS auto_order_status,
      ${shippingStatus} AS delivery_status,

      CASE
        WHEN upper(${itemStatus}) IN ('FAILED','ORDER_FAILED','AUTO_ORDER_FAILED','ERROR')
          THEN '자동주문 실패'
        WHEN upper(${itemStatus}) IN ('LOGIN_REQUIRED','AUTH_REQUIRED')
          THEN '로그인 필요'
        WHEN upper(${itemStatus}) IN ('PRICE_CHANGED','PRICE_MISMATCH')
          THEN '가격변경'
        WHEN upper(${itemStatus}) IN ('OUT_OF_STOCK','OPTION_ERROR','OPTION_MISMATCH','STOCK_ERROR')
          THEN '품절/옵션 오류'
        WHEN upper(${customerStatus}) LIKE '%REQUESTED'
          OR upper(${customerStatus}) LIKE '%PROCESSING'
          THEN '취소/교환/반품'
        WHEN upper(${csStatus}) NOT IN ('','NONE','DONE','COMPLETED','CLOSED')
          THEN '미처리 CS'
        ELSE '확인 필요'
      END AS attention_reason

    FROM ${qIdent(orderTable)} o
    ${join}

    WHERE
      lower(${orderStatus}) IN ('error','failed','hold','오류','보류')
      OR upper(${itemStatus}) IN (
        'FAILED','ORDER_FAILED','AUTO_ORDER_FAILED','ERROR',
        'LOGIN_REQUIRED','AUTH_REQUIRED',
        'PRICE_CHANGED','PRICE_MISMATCH',
        'OUT_OF_STOCK','OPTION_ERROR','OPTION_MISMATCH','STOCK_ERROR'
      )
      OR upper(${customerStatus}) LIKE '%REQUESTED'
      OR upper(${customerStatus}) LIKE '%PROCESSING'
      OR upper(${csStatus}) NOT IN ('','NONE','DONE','COMPLETED','CLOSED')

    ORDER BY ${orderedAt} DESC NULLS LAST
    LIMIT 30
  `);

  return r.rows;
}

function safeInt(v, fallback, min, max){
  const n = Number.parseInt(String(v == null ? '' : v), 10);
  if(!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

async function buildOrderList(pool, opts){
  const orderTable = await firstExistingTable(pool, ['gm_order','gm_orders']);
  const itemTable = await firstExistingTable(pool, ['gm_order_item','gm_order_items']);
  if(!orderTable) return { rows:[], total:0, limit:opts.limit, offset:opts.offset };

  const oc = await columnNames(pool, orderTable);
  const orderNoCol = firstCol(oc, ['order_no','order_id','cafe24_order_id','gm_order_id']);
  if(!orderNoCol) throw new Error('order number column not found');

  const orderNo = `o.${qIdent(orderNoCol)}`;
  const orderedAt = rawExpr('o', oc, ['ordered_at','created_at','order_date','updated_at'], 'NULL');
  const memberId = textExpr('o', oc, ['member_id']);
  const guestKey = textExpr('o', oc, ['guest_key']);
  const orderMode = textExpr('o', oc, ['order_mode']);
  const paymentStatus = textExpr('o', oc, ['payment_status']);
  const orderStatus = textExpr('o', oc, ['order_status','status','total_status']);
  const shippingStatus = textExpr('o', oc, ['shipping_status','delivery_status']);
  const totalPayment = numericExpr('o', oc, ['total_payment_price','expected_payment_amount','total_order_amount','order_amount','total_amount']);
  const totalProduct = numericExpr('o', oc, ['total_product_price']);
  const totalDelivery = numericExpr('o', oc, ['total_delivery_fee']);
  const extraDelivery = numericExpr('o', oc, ['extra_area_delivery_fee']);
  const receiverName = textExpr('o', oc, ['receiver_name']);
  const receiverZip = textExpr('o', oc, ['receiver_zipcode']);
  const receiverAddress = textExpr('o', oc, ['receiver_address1']);
  const paymentMethod = textExpr('o', oc, ['payment_method_display','payment_method']);

  const where = [];
  const params = [];
  function addParam(value){ params.push(value); return '$' + params.length; }

  if(opts.q){
    const p = addParam('%' + opts.q + '%');
    where.push(`(${orderNo}::text ILIKE ${p} OR ${memberId} ILIKE ${p} OR ${receiverName} ILIKE ${p})`);
  }
  if(opts.order_mode){ const p=addParam(opts.order_mode); where.push(`lower(${orderMode}) = lower(${p})`); }
  if(opts.payment_status){ const p=addParam(opts.payment_status); where.push(`lower(${paymentStatus}) = lower(${p})`); }
  if(opts.order_status){ const p=addParam(opts.order_status); where.push(`lower(${orderStatus}) = lower(${p})`); }

  let itemJoin='';
  let itemSelect=`0::int AS item_count, ''::text AS malls, ''::text AS product_names, ''::text AS item_order_status`;
  if(itemTable){
    const ic = await columnNames(pool, itemTable);
    const itemOrderNo = firstCol(ic, ['order_no','order_id','cafe24_order_id','gm_order_id']);
    if(itemOrderNo){
      const mall=textExpr('ix',ic,['mall_code','source_mall','source_code']);
      const product=textExpr('ix',ic,['product_name','name']);
      const itemStatus=textExpr('ix',ic,['item_order_status','order_status','status']);
      itemJoin=`LEFT JOIN LATERAL (SELECT COUNT(*)::int AS item_count, COALESCE(string_agg(DISTINCT NULLIF(${mall},''), ', '),'') AS malls, COALESCE(string_agg(NULLIF(${product},''), ' / ' ORDER BY NULLIF(${product},'')),'') AS product_names, COALESCE(string_agg(DISTINCT NULLIF(${itemStatus},''), ', '),'') AS item_order_status FROM ${qIdent(itemTable)} ix WHERE ix.${qIdent(itemOrderNo)}::text = ${orderNo}::text) ia ON TRUE`;
      itemSelect=`COALESCE(ia.item_count,0)::int AS item_count, COALESCE(ia.malls,'')::text AS malls, COALESCE(ia.product_names,'')::text AS product_names, COALESCE(ia.item_order_status,'')::text AS item_order_status`;
    }
  }

  const whereSql = where.length ? 'WHERE ' + where.join('\\n AND ') : '';
  const countParams = params.slice();
  const countSql=`SELECT COUNT(*)::int AS total FROM ${qIdent(orderTable)} o ${whereSql}`;
  const limitParam=addParam(opts.limit), offsetParam=addParam(opts.offset);
  const listSql=`SELECT ${orderNo}::text AS order_no, ${orderedAt} AS ordered_at, ${memberId} AS member_id, ${guestKey} AS guest_key, ${orderMode} AS order_mode, ${paymentStatus} AS payment_status, ${orderStatus} AS order_status, ${shippingStatus} AS shipping_status, ${paymentMethod} AS payment_method, ${totalProduct}::numeric AS total_product_price, ${totalDelivery}::numeric AS total_delivery_fee, ${extraDelivery}::numeric AS extra_area_delivery_fee, ${totalPayment}::numeric AS total_payment_price, ${receiverName} AS receiver_name, ${receiverZip} AS receiver_zipcode, ${receiverAddress} AS receiver_address1, ${itemSelect} FROM ${qIdent(orderTable)} o ${itemJoin} ${whereSql} ORDER BY ${orderedAt} DESC NULLS LAST, ${orderNo}::text DESC LIMIT ${limitParam} OFFSET ${offsetParam}`;
  const [countResult,listResult]=await Promise.all([pool.query(countSql,countParams),pool.query(listSql,params)]);
  return {rows:listResult.rows||[],total:Number(countResult.rows?.[0]?.total||0),limit:opts.limit,offset:opts.offset};
}

function poolFrom(req){
  return req && req.app && req.app.locals ? req.app.locals.pool : null;
}

router.get('/api/auto-order/dashboard/summary', async (req, res) => {
  const pool = poolFrom(req);
  if(!pool){
    return res.status(503).json({
      ok:false,
      version:'GM_AUTO_ORDER_DASHBOARD_API_V017',
      error:'database pool not ready'
    });
  }

  try{
    const data = await buildSummary(pool);
    return res.json({
      ok:true,
      version:'GM_AUTO_ORDER_DASHBOARD_API_V017',
      data
    });
  }catch(e){
    console.error('[GM_AUTO_ORDER_DASHBOARD_SUMMARY_V017]', String(e && e.stack || e));
    return res.status(500).json({
      ok:false,
      version:'GM_AUTO_ORDER_DASHBOARD_API_V017',
      error:'dashboard summary failed',
      detail:String(e && e.message || e)
    });
  }
});

router.get('/api/auto-order/orders', async (req, res) => {
  const pool = poolFrom(req);
  if(!pool) return res.status(503).json({ok:false,version:'GM_AUTO_ORDER_DASHBOARD_API_V017',error:'database pool not ready'});
  const opts={q:String(req.query.q||'').trim().slice(0,120),order_mode:String(req.query.order_mode||'').trim().slice(0,40),payment_status:String(req.query.payment_status||'').trim().slice(0,40),order_status:String(req.query.order_status||'').trim().slice(0,40),limit:safeInt(req.query.limit,100,1,500),offset:safeInt(req.query.offset,0,0,1000000)};
  try{
    const data=await buildOrderList(pool,opts);
    console.log('[GM_AUTO_ORDER_LIST_V001]',JSON.stringify({q:opts.q,order_mode:opts.order_mode,payment_status:opts.payment_status,order_status:opts.order_status,total:data.total,rows:data.rows.length}));
    return res.json({ok:true,version:'GM_AUTO_ORDER_ORDER_LIST_V001',data});
  }catch(e){
    console.error('[GM_AUTO_ORDER_LIST_FAIL_V001]',String(e&&e.stack||e));
    return res.status(500).json({ok:false,version:'GM_AUTO_ORDER_ORDER_LIST_V001',error:'order list failed',detail:String(e&&e.message||e)});
  }
});

router.get('/api/auto-order/dashboard/clients', (req, res) => {
  // PC PWA / Android client registry is connected in the next auto-order phase.
  return res.json({
    ok:true,
    version:'GM_AUTO_ORDER_DASHBOARD_API_V017',
    data:[]
  });
});

router.get('/api/auto-order/dashboard/attention', async (req, res) => {
  const pool = poolFrom(req);
  if(!pool){
    return res.status(503).json({
      ok:false,
      version:'GM_AUTO_ORDER_DASHBOARD_API_V017',
      error:'database pool not ready'
    });
  }

  try{
    const data = await buildAttention(pool);
    return res.json({
      ok:true,
      version:'GM_AUTO_ORDER_DASHBOARD_API_V017',
      data
    });
  }catch(e){
    console.error('[GM_AUTO_ORDER_DASHBOARD_ATTENTION_V017]', String(e && e.stack || e));
    return res.status(500).json({
      ok:false,
      version:'GM_AUTO_ORDER_DASHBOARD_API_V017',
      error:'dashboard attention failed',
      detail:String(e && e.message || e)
    });
  }
});


router.post('/api/auto-order/control-tower/sync', async (req, res) => {
  const pool = poolFrom(req);
  if(!pool) return res.status(503).json({ ok:false, version:'GM_AUTO_ORDER_CONTROL_TOWER_API_V004', error:'database pool not ready' });

  try{
    const limit = safeInt((req.body && req.body.limit) || req.query.limit, 200, 1, 1000);
    const data = await controlTower.syncRecentOrders(pool, { limit });
    console.log('[GM_AUTO_ORDER_CONTROL_TOWER_SYNC_V004]', JSON.stringify({
      scanned:data.scanned,
      actionable_orders:data.actionable_orders,
      external_orders:data.external_orders,
      auto_orders:data.auto_orders,
      works:data.works,
      wait_payment:data.wait_payment,
      ready:data.ready,
      skipped_internal:data.skipped_internal
    }));
    return res.json({ ok:true, version:'GM_AUTO_ORDER_CONTROL_TOWER_API_V004', data });
  }catch(e){
    console.error('[GM_AUTO_ORDER_CONTROL_TOWER_SYNC_FAIL_V004]', String(e && e.stack || e));
    return res.status(500).json({
      ok:false,
      version:'GM_AUTO_ORDER_CONTROL_TOWER_API_V004',
      error:'control tower sync failed',
      detail:String(e && e.message || e)
    });
  }
});

router.get('/api/auto-order/control-tower', async (req, res) => {
  const pool = poolFrom(req);
  if(!pool) return res.status(503).json({ ok:false, version:'GM_AUTO_ORDER_CONTROL_TOWER_API_V004', error:'database pool not ready' });

  try{
    // Reconcile first so a newly-created gm_order is visible immediately
    // when the operator opens the control tower.
    const sync = await controlTower.syncRecentOrders(pool, {
      limit:safeInt(req.query.sync_limit, 200, 1, 1000)
    });
    const data = await controlTower.listControlTower(pool, {
      q:String(req.query.q || '').trim().slice(0,120),
      work_status:String(req.query.work_status || '').trim().slice(0,40),
      mall_code:String(req.query.mall_code || '').trim().slice(0,20),
      limit:safeInt(req.query.limit, 200, 1, 500),
      offset:safeInt(req.query.offset, 0, 0, 1000000)
    });
    return res.json({
      ok:true,
      version:'GM_AUTO_ORDER_CONTROL_TOWER_API_V004',
      sync,
      data
    });
  }catch(e){
    console.error('[GM_AUTO_ORDER_CONTROL_TOWER_LIST_FAIL_V004]', String(e && e.stack || e));
    return res.status(500).json({
      ok:false,
      version:'GM_AUTO_ORDER_CONTROL_TOWER_API_V004',
      error:'control tower list failed',
      detail:String(e && e.message || e)
    });
  }
});


router.get('/api/auto-order/control-tower/accounts', async (req,res)=>{
  const pool = poolFrom(req);
  if(!pool) return res.status(503).json({ok:false,version:'GM_AUTO_ORDER_ASSIGNMENT_API_V001',error:'database pool not ready'});
  try{
    const data = await assignment.listAccounts(pool, {
      mall_code:String(req.query.mall_code || '').trim(),
      enabled:req.query.enabled
    });
    return res.json({ok:true,version:'GM_AUTO_ORDER_ASSIGNMENT_API_V001',data});
  }catch(e){
    console.error('[GM_AUTO_ORDER_ACCOUNT_LIST_FAIL_V001]', String(e && e.stack || e));
    return res.status(500).json({
      ok:false,version:'GM_AUTO_ORDER_ASSIGNMENT_API_V001',
      error:'account list failed',detail:String(e && e.message || e)
    });
  }
});

router.post('/api/auto-order/control-tower/assign-ready', async (req,res)=>{
  const pool = poolFrom(req);
  if(!pool) return res.status(503).json({ok:false,version:'GM_AUTO_ORDER_ASSIGNMENT_API_V001',error:'database pool not ready'});
  try{
    const data = await assignment.assignReady(pool, {
      limit:safeInt((req.body && req.body.limit) || req.query.limit, 100, 1, 500)
    });
    console.log('[GM_AUTO_ORDER_ASSIGN_READY_V001]', JSON.stringify({
      scanned:data.scanned,assigned:data.assigned,
      no_account:data.no_account,already_assigned:data.already_assigned
    }));
    return res.json({ok:true,version:'GM_AUTO_ORDER_ASSIGNMENT_API_V001',data});
  }catch(e){
    console.error('[GM_AUTO_ORDER_ASSIGN_READY_FAIL_V001]', String(e && e.stack || e));
    return res.status(500).json({
      ok:false,version:'GM_AUTO_ORDER_ASSIGNMENT_API_V001',
      error:'ready assignment failed',detail:String(e && e.message || e)
    });
  }
});

router.post('/api/auto-order/control-tower/work/:work_id/assign', async (req,res)=>{
  const pool = poolFrom(req);
  if(!pool) return res.status(503).json({ok:false,version:'GM_AUTO_ORDER_ASSIGNMENT_API_V001',error:'database pool not ready'});
  try{
    const b=req.body||{};
    const data = await assignment.assignWork(pool, {
      work_id:req.params.work_id,
      account_admin_id:b.account_admin_id,
      admin_id:b.admin_id,
      mall_account_id:b.mall_account_id
    });
    return res.json({ok:true,version:'GM_AUTO_ORDER_ASSIGNMENT_API_V001',data});
  }catch(e){
    console.error('[GM_AUTO_ORDER_ASSIGN_WORK_FAIL_V001]', String(e && e.stack || e));
    return res.status(400).json({
      ok:false,version:'GM_AUTO_ORDER_ASSIGNMENT_API_V001',
      error:'work assignment failed',detail:String(e && e.message || e)
    });
  }
});

module.exports = router;
