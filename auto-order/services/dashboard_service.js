'use strict';

/*
 * GM_AUTO_ORDER_DASHBOARD_SERVICE_V016
 *
 * Dashboard DB aggregation only.
 * - Uses the CURRENT Glomart schema/status values.
 * - Never connects to Coupang/Ali.
 * - Auto-order client/runner state is counted only when the DB actually records it.
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

    auto_order_waiting:0,
    preparing:0,
    delivery_hold:0,
    delivery_ready:0,
    shipping:0,

    cancel_request:0, cancel_processing:0,
    exchange_request:0, exchange_processing:0,
    return_request:0, return_processing:0,
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


async function applyAutoOrderControlTower(pool, out){
  if(!(await tableExists(pool, 'gm_auto_order_work'))) return out;

  const wc = await columns(pool, 'gm_auto_order_work');
  const workType = text('w', wc, ['work_type']);
  const workStatus = text('w', wc, ['work_status']);

  const r = await pool.query(`
    SELECT
      COUNT(*) FILTER (
        WHERE upper(${workType})='ORDER'
          AND upper(${workStatus}) IN ('WAIT_PAYMENT','PENDING','READY')
      )::int AS auto_order_waiting,

      COUNT(*) FILTER (
        WHERE upper(${workType})='ORDER'
          AND upper(${workStatus})='WAIT_PAYMENT'
      )::int AS payment_waiting,

      COUNT(*) FILTER (
        WHERE upper(${workType})='ORDER'
          AND upper(${workStatus}) IN ('COMPLETED','DONE')
      )::int AS auto_order_success,

      COUNT(*) FILTER (
        WHERE upper(${workType})='ORDER'
          AND upper(${workStatus}) IN ('ERROR','FAILED','MANUAL_REQUIRED')
      )::int AS auto_order_failed
    FROM gm_auto_order_work w
  `);

  const x = r.rows[0] || {};
  out.auto_order_waiting = n(x.auto_order_waiting);
  out.payment_waiting = n(x.payment_waiting);
  out.auto_order_success = n(x.auto_order_success);
  out.auto_order_failed = n(x.auto_order_failed);
  return out;
}

async function buildSummary(pool){
  const out = emptySummary();

  const orderTable = await firstExistingTable(pool, ['gm_order','gm_orders']);
  const itemTable = await firstExistingTable(pool, ['gm_order_item','gm_order_items']);
  const csTable = await firstExistingTable(pool, ['gm_cs']);

  if(!orderTable) return out;

  const oc = await columns(pool, orderTable);

  const orderedAt = date('o', oc, ['ordered_at','created_at','order_date','updated_at']);
  const updatedAt = date('o', oc, ['updated_at','created_at','ordered_at']);
  const paidAt = date('o', oc, ['payment_completed_at','payment_confirmed_at','updated_at','ordered_at','created_at']);
  const cancelRequestedAt = date('o', oc, ['cancel_requested_at','updated_at','ordered_at']);
  const cancelCompletedAt = date('o', oc, ['cancel_completed_at','updated_at','ordered_at']);
  const deliveredAt = date('o', oc, ['delivered_at','updated_at','ordered_at']);

  const totalAmount = numeric('o', oc, [
    'total_payment_price','expected_payment_amount','total_order_amount',
    'order_amount','total_amount','total_product_price'
  ]);
  const actualPaid = numeric('o', oc, [
    'actual_payment_amount','paid_amount','payment_amount','total_paid_amount'
  ]);

  const orderStatus = text('o', oc, ['order_status','status','total_status']);
  const paymentStatus = text('o', oc, ['payment_status']);
  const shippingStatus = text('o', oc, ['shipping_status','delivery_status']);
  const csStatus = text('o', oc, ['cs_status']);
  const cancelStatus = text('o', oc, ['cancel_status']);

  // Current gm_order has no dedicated refund_amount in the operational schema.
  // Until that column exists, a refunded order uses actual_payment_amount,
  // falling back to total_payment_price. This keeps the dashboard useful while
  // preserving a single place to replace the rule later.
  const refundAmount = `CASE
    WHEN lower(${paymentStatus})='refunded'
    THEN CASE WHEN ${actualPaid}>0 THEN ${actualPaid} ELSE ${totalAmount} END
    ELSE 0
  END`;
  const refundAt = updatedAt || cancelCompletedAt || orderedAt;

  const orderAgg = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE ${today(orderedAt)})::int AS today_orders,
      COUNT(*) FILTER (WHERE ${month(orderedAt)})::int AS month_orders,

      COALESCE(SUM(${totalAmount}) FILTER (WHERE ${today(orderedAt)}),0)::numeric AS today_order_amount,
      COALESCE(SUM(${totalAmount}) FILTER (WHERE ${month(orderedAt)}),0)::numeric AS month_order_amount,

      COUNT(*) FILTER (
        WHERE lower(${paymentStatus}) IN ('paid','overpaid','refunded')
          AND ${today(paidAt)}
      )::int AS today_paid_count,
      COUNT(*) FILTER (
        WHERE lower(${paymentStatus}) IN ('paid','overpaid','refunded')
          AND ${month(paidAt)}
      )::int AS month_paid_count,
      COALESCE(SUM(${actualPaid}) FILTER (
        WHERE lower(${paymentStatus}) IN ('paid','overpaid','refunded')
          AND ${today(paidAt)}
      ),0)::numeric AS today_paid_amount,
      COALESCE(SUM(${actualPaid}) FILTER (
        WHERE lower(${paymentStatus}) IN ('paid','overpaid','refunded')
          AND ${month(paidAt)}
      ),0)::numeric AS month_paid_amount,

      COUNT(*) FILTER (
        WHERE lower(${paymentStatus})='refunded' AND ${today(refundAt)}
      )::int AS today_refund_count,
      COUNT(*) FILTER (
        WHERE lower(${paymentStatus})='refunded' AND ${month(refundAt)}
      )::int AS month_refund_count,
      COALESCE(SUM(${refundAmount}) FILTER (
        WHERE lower(${paymentStatus})='refunded' AND ${today(refundAt)}
      ),0)::numeric AS today_refund_amount,
      COALESCE(SUM(${refundAmount}) FILTER (
        WHERE lower(${paymentStatus})='refunded' AND ${month(refundAt)}
      ),0)::numeric AS month_refund_amount,

      COUNT(*) FILTER (
        WHERE lower(${shippingStatus})='preparing'
      )::int AS preparing,

      COUNT(*) FILTER (
        WHERE lower(${shippingStatus}) IN ('shipped','in_transit')
      )::int AS shipping,

      COUNT(*) FILTER (
        WHERE lower(${paymentStatus}) IN ('pending','waiting_deposit','partially_paid')
      )::int AS payment_pending_orders,

      COUNT(*) FILTER (
        WHERE lower(${paymentStatus}) IN ('paid','overpaid','refunded')
          AND ${today(paidAt)}
      )::int AS payment_done,

      COUNT(*) FILTER (
        WHERE lower(${shippingStatus})='preparing'
          AND ${today(updatedAt || orderedAt)}
      )::int AS delivery_ready_done,

      COUNT(*) FILTER (
        WHERE lower(${shippingStatus}) IN ('shipped','in_transit')
          AND ${today(updatedAt || orderedAt)}
      )::int AS shipping_started,

      COUNT(*) FILTER (
        WHERE lower(${shippingStatus})='delivered'
          AND ${today(deliveredAt || updatedAt || orderedAt)}
      )::int AS delivered,

      COUNT(*) FILTER (
        WHERE lower(${cancelStatus})='requested'
      )::int AS order_cancel_request,

      COUNT(*) FILTER (
        WHERE lower(${cancelStatus})='completed'
          AND ${today(cancelCompletedAt || updatedAt || orderedAt)}
      )::int AS order_cancel_done,

      COUNT(*) FILTER (
        WHERE lower(${csStatus}) IN ('open','processing')
      )::int AS order_pending_cs

    FROM ${qIdent(orderTable)} o
  `);

  Object.assign(out, orderAgg.rows[0] || {});

  if(itemTable){
    const ic = await columns(pool, itemTable);
    const itemOrderNo = firstCol(ic, ['order_no','order_id','cafe24_order_id','gm_order_id']);
    const itemStatus = text('i', ic, ['item_order_status','order_status','status']);
    const itemShipping = text('i', ic, ['item_shipping_status','shipping_status','delivery_status']);
    const tracking = text('i', ic, ['tracking_number','invoice_no']);
    const itemUpdated = date('i', ic, ['updated_at','created_at']);
    const shippingStartedAt = date('i', ic, ['shipping_started_at','updated_at','created_at']);
    const shippingCompletedAt = date('i', ic, ['shipping_completed_at','updated_at','created_at']);

    const distinctKey = itemOrderNo ? `COUNT(DISTINCT i.${qIdent(itemOrderNo)})` : 'COUNT(*)';

    const itemAgg = await pool.query(`
      SELECT
        ${distinctKey} FILTER (
          WHERE upper(${itemStatus}) IN ('READY_TO_ORDER','ORDERED','WAITING','PENDING')
        )::int AS auto_order_waiting,

        ${distinctKey} FILTER (
          WHERE upper(${itemStatus}) IN (
            'AUTO_ORDERED','ORDERED_AT_MALL','PURCHASED',
            'PAYMENT_WAITING','STOPPED_BEFORE_PAYMENT','COMPLETED','DONE'
          )
            AND ${today(itemUpdated)}
        )::int AS auto_order_success,

        ${distinctKey} FILTER (
          WHERE upper(${itemStatus}) IN ('PAYMENT_WAITING','STOPPED_BEFORE_PAYMENT')
        )::int AS payment_waiting,

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

        ${distinctKey} FILTER (
          WHERE lower(${itemShipping})='preparing'
        )::int AS item_preparing,

        ${distinctKey} FILTER (
          WHERE lower(${itemShipping})='pending'
            AND upper(${itemStatus}) IN (
              'AUTO_ORDERED','ORDERED_AT_MALL','PURCHASED',
              'PAYMENT_WAITING','STOPPED_BEFORE_PAYMENT','COMPLETED','DONE'
            )
        )::int AS delivery_ready,

        ${distinctKey} FILTER (
          WHERE lower(${itemShipping}) IN ('shipped','in_transit')
            AND btrim(${tracking})=''
        )::int AS no_invoice,

        ${distinctKey} FILTER (
          WHERE lower(${itemShipping}) IN ('shipped','in_transit')
            AND ${shippingStartedAt ? `${shippingStartedAt} < now() - interval '7 day'` : 'FALSE'}
        )::int AS delivery_delay,

        ${distinctKey} FILTER (
          WHERE lower(${itemShipping})='delivered'
            AND ${today(shippingCompletedAt || itemUpdated)}
        )::int AS item_delivered_today

      FROM ${qIdent(itemTable)} i
    `);

    const ir = itemAgg.rows[0] || {};
    out.auto_order_waiting = n(ir.auto_order_waiting);
    out.auto_order_success = n(ir.auto_order_success);
    out.payment_waiting = n(ir.payment_waiting);
    out.auto_order_failed = n(ir.auto_order_failed);
    out.login_required = n(ir.login_required);
    out.price_changed = n(ir.price_changed);
    out.stock_or_option_error = n(ir.stock_or_option_error);
    out.delivery_ready = n(ir.delivery_ready);
    out.no_invoice = n(ir.no_invoice);
    out.delivery_delay = n(ir.delivery_delay);

    // Prefer item-level values when they carry more operational detail.
    out.preparing = Math.max(n(out.preparing), n(ir.item_preparing));
    out.delivered = Math.max(n(out.delivered), n(ir.item_delivered_today));
  }

  if(csTable){
    const cc = await columns(pool, csTable);
    const csType = text('c', cc, ['cs_type','type']);
    const claimStatus = text('c', cc, ['cs_status','status']);
    const requestAt = date('c', cc, ['request_at','created_at','updated_at']);
    const claimUpdated = date('c', cc, ['updated_at','created_at','request_at']);

    const cr = await pool.query(`
      SELECT
        COUNT(*) FILTER (
          WHERE lower(${csType})='cancel'
            AND lower(${claimStatus})='requested'
        )::int AS cancel_request,

        COUNT(*) FILTER (
          WHERE lower(${csType})='cancel'
            AND lower(${claimStatus}) IN ('processing','return_shipping','return_received','return_confirmed','reshipped')
        )::int AS cancel_processing,

        COUNT(*) FILTER (
          WHERE lower(${csType})='exchange'
            AND lower(${claimStatus})='requested'
        )::int AS exchange_request,

        COUNT(*) FILTER (
          WHERE lower(${csType})='exchange'
            AND lower(${claimStatus}) IN ('processing','return_shipping','return_received','return_confirmed','reshipped')
        )::int AS exchange_processing,

        COUNT(*) FILTER (
          WHERE lower(${csType})='return'
            AND lower(${claimStatus})='requested'
        )::int AS return_request,

        COUNT(*) FILTER (
          WHERE lower(${csType})='return'
            AND lower(${claimStatus}) IN ('processing','return_shipping','return_received','return_confirmed','reshipped')
        )::int AS return_processing,

        COUNT(*) FILTER (
          WHERE lower(${csType})='refund'
            AND lower(${claimStatus}) NOT IN ('completed','cancelled')
        )::int AS refund_waiting,

        COUNT(*) FILTER (
          WHERE lower(${csType})='cancel'
            AND lower(${claimStatus})='completed'
            AND ${today(claimUpdated)}
        )::int AS cancel_done,

        COUNT(*) FILTER (
          WHERE lower(${csType})='exchange'
            AND lower(${claimStatus})='completed'
            AND ${today(claimUpdated)}
        )::int AS exchange_done,

        COUNT(*) FILTER (
          WHERE lower(${csType})='return'
            AND lower(${claimStatus})='completed'
            AND ${today(claimUpdated)}
        )::int AS return_done,

        COUNT(*) FILTER (
          WHERE lower(${csType})='refund'
            AND lower(${claimStatus})='completed'
            AND ${today(claimUpdated)}
        )::int AS refund_done,

        COUNT(*) FILTER (
          WHERE lower(${claimStatus}) NOT IN ('completed','cancelled')
        )::int AS pending_cs

      FROM ${qIdent(csTable)} c
    `);

    const c = cr.rows[0] || {};
    out.cancel_request = n(c.cancel_request);
    out.cancel_processing = n(c.cancel_processing);
    out.exchange_request = n(c.exchange_request);
    out.exchange_processing = n(c.exchange_processing);
    out.return_request = n(c.return_request);
    out.return_processing = n(c.return_processing);
    out.refund_waiting = n(c.refund_waiting);
    out.cancel_done = n(c.cancel_done);
    out.exchange_done = n(c.exchange_done);
    out.return_done = n(c.return_done);
    out.refund_done = Math.max(n(out.refund_done), n(c.refund_done));
    out.pending_cs = n(c.pending_cs);
  } else {
    out.cancel_request = n(out.order_cancel_request);
    out.cancel_done = n(out.order_cancel_done);
    out.pending_cs = n(out.order_pending_cs);
  }

  // Not yet modeled in the current schema.
  out.delivery_hold = 0;

  // Remove internal temporary fields.
  delete out.payment_pending_orders;
  delete out.order_cancel_request;
  delete out.order_cancel_done;
  delete out.order_pending_cs;

  for(const [k,v] of Object.entries(out)){
    if(k === 'mode' || k === 'updated_at') continue;
    out[k] = n(v);
  }

  await applyAutoOrderControlTower(pool, out);

  out.updated_at = new Date().toISOString();
  return out;
}

async function buildAttention(pool){
  const orderTable = await firstExistingTable(pool, ['gm_order','gm_orders']);
  const itemTable = await firstExistingTable(pool, ['gm_order_item','gm_order_items']);
  const csTable = await firstExistingTable(pool, ['gm_cs']);
  if(!orderTable) return [];

  const oc = await columns(pool, orderTable);
  const orderNo = col('o', oc, ['order_no','order_id','cafe24_order_id','gm_order_id'], "''");
  const orderedAt = col('o', oc, ['ordered_at','created_at','order_date','updated_at'], 'now()');
  const orderStatus = text('o', oc, ['order_status','status','total_status']);
  const paymentStatus = text('o', oc, ['payment_status']);
  const cancelStatus = text('o', oc, ['cancel_status']);
  const shippingStatus = text('o', oc, ['shipping_status','delivery_status']);
  const csStatus = text('o', oc, ['cs_status']);

  let join = '';
  let productName = "''";
  let sourceMall = "''";
  let itemStatus = "''";
  let itemShipping = "''";
  let tracking = "''";

  if(itemTable){
    const ic = await columns(pool, itemTable);
    const itemOrderNo = firstCol(ic, ['order_no','order_id','cafe24_order_id','gm_order_id']);

    if(itemOrderNo){
      join = `
        LEFT JOIN LATERAL (
          SELECT *
          FROM ${qIdent(itemTable)} ix
          WHERE ix.${qIdent(itemOrderNo)}::text = ${orderNo}::text
          ORDER BY ix.updated_at DESC NULLS LAST, ix.created_at DESC NULLS LAST
          LIMIT 1
        ) i ON TRUE
      `;
      productName = text('i', ic, ['product_name','name']);
      sourceMall = text('i', ic, ['source_mall','mall_code','source_code']);
      itemStatus = text('i', ic, ['item_order_status','order_status','status']);
      itemShipping = text('i', ic, ['item_shipping_status','shipping_status','delivery_status']);
      tracking = text('i', ic, ['tracking_number','invoice_no']);
    }
  }

  const r = await pool.query(`
    SELECT
      ${orderedAt} AS ordered_at,
      ${orderNo}::text AS order_no,
      ${sourceMall} AS source_mall,
      ${productName} AS product_name,
      ${itemStatus} AS auto_order_status,
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
        WHEN lower(${itemShipping}) IN ('shipped','in_transit') AND btrim(${tracking})=''
          THEN '송장 미확보'
        WHEN lower(${cancelStatus})='requested'
          THEN '취소 요청'
        WHEN lower(${paymentStatus})='failed'
          THEN '결제 오류'
        WHEN lower(${csStatus}) IN ('open','processing')
          THEN '미처리 CS'
        ELSE '확인 필요'
      END AS attention_reason
    FROM ${qIdent(orderTable)} o
    ${join}
    WHERE
      lower(${orderStatus}) IN ('cancelled')
      OR lower(${paymentStatus})='failed'
      OR lower(${cancelStatus})='requested'
      OR lower(${csStatus}) IN ('open','processing')
      OR upper(${itemStatus}) IN (
        'FAILED','ORDER_FAILED','AUTO_ORDER_FAILED','ERROR',
        'LOGIN_REQUIRED','AUTH_REQUIRED',
        'PRICE_CHANGED','PRICE_MISMATCH',
        'OUT_OF_STOCK','OPTION_ERROR','OPTION_MISMATCH','STOCK_ERROR'
      )
      OR (lower(${itemShipping}) IN ('shipped','in_transit') AND btrim(${tracking})='')
    ORDER BY ${orderedAt} DESC NULLS LAST
    LIMIT 30
  `);

  return r.rows;
}

module.exports = { buildSummary, buildAttention };
