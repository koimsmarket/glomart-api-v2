const express = require('express');
const router = express.Router();

function dbFrom(req) {
  return req.app.locals.db || req.app.locals.pool;
}
function ok(res, data) {
  res.json({ ok: true, version: 'GM_ORDER_ROUTE_V006_LIST', ...data });
}
function fail(res, status, message, extra = {}) {
  res.status(status).json({ ok: false, version: 'GM_ORDER_ROUTE_V006_LIST', error: message, ...extra });
}
function cleanText(v) {
  return String(v || '').replace(/[\u00A0\u200B-\u200D\uFEFF]/g, ' ').replace(/\s+/g, ' ').trim();
}
function toInt(v, def = 0) {
  const n = Number(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? Math.round(n) : def;
}
function makeOrderNo() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `GM${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

// POST /api/gm/order/create
router.post('/api/gm/order/create', async (req, res) => {
  const pool = dbFrom(req);
  if (!pool || typeof pool.connect !== 'function') return fail(res, 500, 'DB pool is not attached');

  const o = req.body || {};
  const items = Array.isArray(o.items) ? o.items : [];
  const orderNo = cleanText(o.order_no || makeOrderNo());

  if (!orderNo) return fail(res, 400, 'order_no required');
  if (!items.length) return fail(res, 400, 'items required');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      INSERT INTO gm_orders (
        order_no, member_id, guest_key, orderer_name, orderer_phone, orderer_mobile, orderer_email,
        receiver_name, receiver_phone, receiver_mobile, receiver_safe_phone,
        receiver_zipcode, receiver_address1, receiver_address2, delivery_memo,
        customs_required_yn, customs_clearance_code, customs_name, customs_mobile,
        payment_method, payment_method_display, payment_bank_name, payment_account_number,
        depositor_name, depositor_phone, expected_payment_amount, total_product_price,
        total_delivery_fee, extra_area_delivery_fee, estimated_customs_fee, estimated_import_vat,
        total_payment_price, order_status, payment_status, shipping_status, cs_status,
        ordered_at, created_at, updated_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,now(),now(),now()
      )
      ON CONFLICT (order_no) DO UPDATE SET
        member_id=EXCLUDED.member_id,
        guest_key=EXCLUDED.guest_key,
        orderer_name=EXCLUDED.orderer_name,
        orderer_phone=EXCLUDED.orderer_phone,
        orderer_mobile=EXCLUDED.orderer_mobile,
        orderer_email=EXCLUDED.orderer_email,
        receiver_name=EXCLUDED.receiver_name,
        receiver_phone=EXCLUDED.receiver_phone,
        receiver_mobile=EXCLUDED.receiver_mobile,
        receiver_safe_phone=EXCLUDED.receiver_safe_phone,
        receiver_zipcode=EXCLUDED.receiver_zipcode,
        receiver_address1=EXCLUDED.receiver_address1,
        receiver_address2=EXCLUDED.receiver_address2,
        delivery_memo=EXCLUDED.delivery_memo,
        expected_payment_amount=EXCLUDED.expected_payment_amount,
        total_product_price=EXCLUDED.total_product_price,
        total_delivery_fee=EXCLUDED.total_delivery_fee,
        total_payment_price=EXCLUDED.total_payment_price,
        order_status=EXCLUDED.order_status,
        payment_status=EXCLUDED.payment_status,
        shipping_status=EXCLUDED.shipping_status,
        cs_status=EXCLUDED.cs_status,
        updated_at=now()
    `, [
      orderNo,
      cleanText(o.member_id) || null,
      cleanText(o.guest_key) || null,
      cleanText(o.orderer_name),
      cleanText(o.orderer_phone),
      cleanText(o.orderer_mobile),
      cleanText(o.orderer_email),
      cleanText(o.receiver_name),
      cleanText(o.receiver_phone),
      cleanText(o.receiver_mobile),
      cleanText(o.receiver_safe_phone),
      cleanText(o.receiver_zipcode || o.zipcode),
      cleanText(o.receiver_address1 || o.address1),
      cleanText(o.receiver_address2 || o.address2),
      cleanText(o.delivery_memo),
      cleanText(o.customs_required_yn || 'N'),
      cleanText(o.customs_clearance_code),
      cleanText(o.customs_name),
      cleanText(o.customs_mobile),
      cleanText(o.payment_method || 'pending'),
      cleanText(o.payment_method_display || '미정'),
      cleanText(o.payment_bank_name),
      cleanText(o.payment_account_number),
      cleanText(o.depositor_name),
      cleanText(o.depositor_phone),
      toInt(o.expected_payment_amount, 0),
      toInt(o.total_product_price, 0),
      toInt(o.total_delivery_fee, 0),
      toInt(o.extra_area_delivery_fee, 0),
      toInt(o.estimated_customs_fee, 0),
      toInt(o.estimated_import_vat, 0),
      toInt(o.total_payment_price, 0),
      cleanText(o.order_status || 'ordered'),
      cleanText(o.payment_status || 'pending'),
      cleanText(o.shipping_status || 'pending'),
      cleanText(o.cs_status || 'none')
    ]);

    for (const it of items) {
      await client.query(`
        INSERT INTO gm_order_items (
          order_no, pi_ii_vi, product_name, option_name, option_value, quantity,
          mall_sale_price, customer_order_price, final_supply_price, product_amount,
          delivery_type, delivery_fee, extra_area_delivery_fee, mall_code, supplier_id, supplier_name,
          product_url, thumb_file_name, hs_code, origin_country, carrier_name, tracking_number,
          item_order_status, item_shipping_status, created_at, updated_at
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,now(),now()
        )
        ON CONFLICT (order_no, pi_ii_vi) DO UPDATE SET
          product_name=EXCLUDED.product_name,
          option_name=EXCLUDED.option_name,
          option_value=EXCLUDED.option_value,
          quantity=EXCLUDED.quantity,
          mall_sale_price=EXCLUDED.mall_sale_price,
          customer_order_price=EXCLUDED.customer_order_price,
          final_supply_price=EXCLUDED.final_supply_price,
          product_amount=EXCLUDED.product_amount,
          delivery_type=EXCLUDED.delivery_type,
          delivery_fee=EXCLUDED.delivery_fee,
          item_order_status=EXCLUDED.item_order_status,
          item_shipping_status=EXCLUDED.item_shipping_status,
          updated_at=now()
      `, [
        orderNo,
        cleanText(it.pi_ii_vi),
        cleanText(it.product_name),
        cleanText(it.option_name),
        cleanText(it.option_value),
        Math.max(1, toInt(it.quantity, 1)),
        toInt(it.mall_sale_price || it.amount, 0),
        toInt(it.customer_order_price || it.amount, 0),
        it.final_supply_price == null ? null : toInt(it.final_supply_price, 0),
        toInt(it.product_amount || it.amount, 0),
        cleanText(it.delivery_type),
        toInt(it.delivery_fee, 0),
        toInt(it.extra_area_delivery_fee, 0),
        cleanText(it.mall_code),
        cleanText(it.supplier_id),
        cleanText(it.supplier_name),
        cleanText(it.product_url),
        cleanText(it.thumb_file_name),
        cleanText(it.hs_code),
        cleanText(it.origin_country),
        cleanText(it.carrier_name),
        cleanText(it.tracking_number),
        cleanText(it.item_order_status || 'ordered'),
        cleanText(it.item_shipping_status || 'pending')
      ]);
    }

    await client.query('COMMIT');
    return ok(res, { order_no: orderNo, item_count: items.length });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    return fail(res, 500, 'order create failed', { detail: String(e && e.message || e) });
  } finally {
    client.release();
  }
});

// GET /api/gm/order/list?guest_key=test
router.get('/api/gm/order/list', async (req, res) => {
  const pool = dbFrom(req);
  if (!pool || typeof pool.query !== 'function') return fail(res, 500, 'DB pool is not attached');

  const guestKey = cleanText(req.query.guest_key);
  const memberId = cleanText(req.query.member_id);
  if (!guestKey && !memberId) return fail(res, 400, 'member_id or guest_key required');

  try {
    const where = memberId ? 'o.member_id = $1' : 'o.guest_key = $1';
    const key = memberId || guestKey;

    const r = await pool.query(`
      SELECT
        o.*,
        COALESCE(
          json_agg(
            json_build_object(
              'pi_ii_vi', i.pi_ii_vi,
              'product_name', i.product_name,
              'option_name', i.option_name,
              'option_value', i.option_value,
              'quantity', i.quantity,
              'mall_sale_price', i.mall_sale_price,
              'customer_order_price', i.customer_order_price,
              'product_amount', i.product_amount,
              'delivery_type', i.delivery_type,
              'delivery_fee', i.delivery_fee,
              'item_order_status', i.item_order_status,
              'item_shipping_status', i.item_shipping_status
            )
          ) FILTER (WHERE i.order_no IS NOT NULL),
          '[]'::json
        ) AS items
      FROM gm_orders o
      LEFT JOIN gm_order_items i ON i.order_no = o.order_no
      WHERE ${where}
      GROUP BY o.order_no
      ORDER BY o.created_at DESC
    `, [key]);

    return ok(res, { items: r.rows });
  } catch (e) {
    return fail(res, 500, 'order list failed', { detail: String(e && e.message || e) });
  }
});

// GET /api/gm/order/:order_no
router.get('/api/gm/order/:order_no', async (req, res) => {
  const pool = dbFrom(req);
  if (!pool || typeof pool.query !== 'function') return fail(res, 500, 'DB pool is not attached');

  const orderNo = cleanText(req.params.order_no);
  if (!orderNo) return fail(res, 400, 'order_no required');

  try {
    const order = await pool.query('SELECT * FROM gm_orders WHERE order_no=$1 LIMIT 1', [orderNo]);
    const items = await pool.query('SELECT * FROM gm_order_items WHERE order_no=$1 ORDER BY created_at ASC', [orderNo]);
    return ok(res, { order: order.rows[0] || null, items: items.rows });
  } catch (e) {
    return fail(res, 500, 'order get failed', { detail: String(e && e.message || e) });
  }
});

module.exports = router;
