'use strict';

/*
 * GM_AUTO_ORDER_DASHBOARD_DATA_V010
 * Dashboard DB aggregation only.
 * Never connects to Coupang/Ali.
 */

function qIdent(name){
  return '"' + String(name).replace(/"/g, '""') + '"';
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

async function columns(pool, table){
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

function col(alias, cols, names, fallback="''"){
  const c = firstCol(cols, names);
  return c ? `${alias}.${qIdent(c)}` : fallback;
}

function text(alias, cols, names){
  return `COALESCE(${col(alias, cols, names, "''")}::text,'')`;
}

function numeric(alias, cols, names){
  const c = firstCol(cols, names);
  if(!c) return '0';
  const e = `${alias}.${qIdent(c)}`;
  return `COALESCE(NULLIF(regexp_replace(COALESCE(${e}::text,''),'[^0-9.\\\\-]','','g'),'')::numeric,0)`;
}

function date(alias, cols, names){
  const c = firstCol(cols, names);
  return c ? `${alias}.${qIdent(c)}` : '';
}

function today(expr){ return expr ? `${expr} >= date_trunc('day', now())` : 'FALSE'; }
function month(expr){ return expr ? `${expr} >= date_trunc('month', now())` : 'FALSE'; }
function n(v){ const x = Number(v); return Number.isFinite(x) ? x : 0; }

function emptySummary(){
  return {
    mode: process.env.GM_AUTO_ORDER_MODE || 'SEMI_AUTO',
    updated_at: new Date().toISOString(),
    today_order_amount:0, month_order_amount:0, today_orders:0, month_orders:0,
    today_paid_amount:0, month_paid_amount:0, today_paid_count:0, month_paid_count:0,
    today_refund_amount:0, month_refund_amount:0, today_refund_count:0, month_refund_count:0,
    auto_order_waiting:0, preparing:0, delivery_hold:0, delivery_ready:0, shipping:0,
    cancel_request:0, cancel_processing:0, exchange_request:0, exchange_processing:0,
    return_request:0, return_processing:0, refund_waiting:0,
    auto_order_success:0, payment_done:0, delivery_ready_done:0, shipping_started:0,
    delivered:0, cancel_done:0, exchange_done:0, return_done:0, refund_done:0,
    client_online:0, cpkr_ready:0, alkr_ready:0, payment_waiting:0,
    auto_order_failed:0, login_required:0, price_changed:0,
    stock_or_option_error:0, no_invoice:0, delivery_delay:0, pending_cs:0
  };
}

async function buildSummary(pool){
  const out = emptySummary();
  const orderTable = await firstExistingTable(pool, ['gm_order','gm_orders']);
  const itemTable = await firstExistingTable(pool, ['gm_order_item','gm_order_items']);
  if(!orderTable) return out;

  const oc = await columns(pool, orderTable);
  const orderedAt = date('o', oc, ['ordered_at','created_at','order_date','updated_at']);
  const updatedAt = date('o', oc, ['updated_at','created_at','ordered_at']);
  const paidAt = date('o', oc, ['payment_completed_at','payment_confirmed_at','paid_at','updated_at','ordered_at','created_at']);
  const refundAt = date('o', oc, ['refund_completed_at','refunded_at','updated_at','created_at','ordered_at']);

  const totalAmount = numeric('o', oc, [
    'total_payment_price','expected_payment_amount','total_order_amount',
    'order_amount','total_amount','total_product_price'
  ]);
  const paidAmount = numeric('o', oc, [
    'actual_payment_amount','paid_amount','payment_amount','total_paid_amount'
  ]);
  const refundAmount = numeric('o', oc, [
    'refund_amount','refunded_amount','total_refund_amount'
  ]);

  const orderStatus = text('o', oc, ['order_status','status','total_status','item_order_status']);
  const sellerStatus = text('o', oc, ['seller_status','order_status','status','total_status']);
  const customerStatus = text('o', oc, ['customer_status']);
  const shippingStatus = text('o', oc, ['shipping_status','delivery_status']);
  const csStatus = text('o', oc, ['cs_status']);

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

      COUNT(*) FILTER (WHERE upper(${sellerStatus}) IN ('PREPARING','PRODUCT_PREPARING'))::int AS preparing,
      COUNT(*) FILTER (WHERE upper(${shippingStatus}) IN ('HOLD','ON_HOLD','DELIVERY_HOLD'))::int AS delivery_hold,
      COUNT(*) FILTER (WHERE upper(${shippingStatus}) IN ('READY','READY_TO_SHIP','DELIVERY_READY','PREPARING'))::int AS delivery_ready,
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
        WHERE lower(${orderStatus}) IN ('complete','completed','done','purchased','paid','주문완료','처리완료','발주완료')
          AND ${today(updatedAt || orderedAt)}
      )::int AS auto_order_success,

      COUNT(*) FILTER (WHERE ${paidAmount}>0 AND ${today(paidAt)})::int AS payment_done,
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
      COUNT(*) FILTER (WHERE upper(${customerStatus})='CANCEL_COMPLETED' AND ${today(updatedAt || orderedAt)})::int AS cancel_done,
      COUNT(*) FILTER (WHERE upper(${customerStatus})='EXCHANGE_COMPLETED' AND ${today(updatedAt || orderedAt)})::int AS exchange_done,
      COUNT(*) FILTER (WHERE upper(${customerStatus})='RETURN_COMPLETED' AND ${today(updatedAt || orderedAt)})::int AS return_done,
      COUNT(*) FILTER (WHERE ${refundAmount}>0 AND ${today(refundAt)})::int AS refund_done,
      COUNT(*) FILTER (WHERE upper(${csStatus}) NOT IN ('','NONE','DONE','COMPLETED','CLOSED'))::int AS pending_cs
    FROM ${qIdent(orderTable)} o
  `);

  Object.assign(out, r.rows[0] || {});

  if(itemTable){
    const ic = await columns(pool, itemTable);
    const itemStatus = text('i', ic, ['item_order_status','order_status','status']);
    const itemShipping = text('i', ic, ['item_shipping_status','shipping_status','delivery_status']);
    const tracking = text('i', ic, ['tracking_number','invoice_no']);

    const ex = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE upper(${itemStatus}) IN ('FAILED','ORDER_FAILED','AUTO_ORDER_FAILED','ERROR'))::int AS auto_order_failed,
        COUNT(*) FILTER (WHERE upper(${itemStatus}) IN ('LOGIN_REQUIRED','AUTH_REQUIRED'))::int AS login_required,
        COUNT(*) FILTER (WHERE upper(${itemStatus}) IN ('PRICE_CHANGED','PRICE_MISMATCH'))::int AS price_changed,
        COUNT(*) FILTER (WHERE upper(${itemStatus}) IN ('OUT_OF_STOCK','OPTION_ERROR','OPTION_MISMATCH','STOCK_ERROR'))::int AS stock_or_option_error,
        COUNT(*) FILTER (
          WHERE upper(${itemShipping}) IN ('SHIPPING','IN_TRANSIT','SHIPPED','DISPATCHED')
            AND btrim(${tracking})=''
        )::int AS no_invoice,
        COUNT(*) FILTER (WHERE upper(${itemShipping}) IN ('DELAYED','DELIVERY_DELAY'))::int AS delivery_delay
      FROM ${qIdent(itemTable)} i
    `);
    Object.assign(out, ex.rows[0] || {});
  }

  for(const [k,v] of Object.entries(out)){
    if(k === 'mode' || k === 'updated_at') continue;
    out[k] = n(v);
  }
  out.updated_at = new Date().toISOString();
  return out;
}

async function buildAttention(pool){
  const orderTable = await firstExistingTable(pool, ['gm_order','gm_orders']);
  const itemTable = await firstExistingTable(pool, ['gm_order_item','gm_order_items']);
  if(!orderTable) return [];

  const oc = await columns(pool, orderTable);
  const orderNo = col('o', oc, ['order_no','order_id','cafe24_order_id','gm_order_id'], "''");
  const orderedAt = col('o', oc, ['ordered_at','created_at','order_date','updated_at'], 'now()');
  const orderStatus = text('o', oc, ['order_status','status','total_status','item_order_status']);
  const customerStatus = text('o', oc, ['customer_status']);
  const shippingStatus = text('o', oc, ['shipping_status','delivery_status']);
  const csStatus = text('o', oc, ['cs_status']);

  let join = '';
  let productName = "''";
  let sourceMall = "''";
  let itemStatus = "''";

  if(itemTable){
    const ic = await columns(pool, itemTable);
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
      productName = text('i', ic, ['product_name','name']);
      sourceMall = text('i', ic, ['source_mall','mall_code','source_code']);
      itemStatus = text('i', ic, ['item_order_status','order_status','status']);
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
        WHEN upper(${itemStatus}) IN ('FAILED','ORDER_FAILED','AUTO_ORDER_FAILED','ERROR') THEN '자동주문 실패'
        WHEN upper(${itemStatus}) IN ('LOGIN_REQUIRED','AUTH_REQUIRED') THEN '로그인 필요'
        WHEN upper(${itemStatus}) IN ('PRICE_CHANGED','PRICE_MISMATCH') THEN '가격변경'
        WHEN upper(${itemStatus}) IN ('OUT_OF_STOCK','OPTION_ERROR','OPTION_MISMATCH','STOCK_ERROR') THEN '품절/옵션 오류'
        WHEN upper(${customerStatus}) LIKE '%REQUESTED' OR upper(${customerStatus}) LIKE '%PROCESSING' THEN '취소/교환/반품'
        WHEN upper(${csStatus}) NOT IN ('','NONE','DONE','COMPLETED','CLOSED') THEN '미처리 CS'
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

module.exports = { buildSummary, buildAttention };
