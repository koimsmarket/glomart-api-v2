'use strict';

const crypto = require('crypto');
const LOCK_SECONDS = Math.max(
  60,
  Number(process.env.GM_AUTO_ORDER_CLIENT_LOCK_SECONDS || 180)
);

function clean(value) {
  return String(value == null ? '' : value).trim();
}
function upper(value) {
  return clean(value).toUpperCase();
}

async function writeLog(db, work, before, after, action, message, detail) {
  await db.query(
    `INSERT INTO gm_auto_order_log
      (auto_order_no, work_id, action_type, status_before, status_after,
       admin_id, mall_account_id, message, detail_json, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,now())`,
    [
      work.auto_order_no,
      work.work_id,
      action,
      before,
      after,
      work.admin_id || null,
      work.mall_account_id || null,
      message || '',
      JSON.stringify(detail || {})
    ]
  );
}


function stripMallPrefix(value) {
  return clean(value).replace(/^(CPKR|GMKR|CAFE24)_/i, '');
}
function parseCpkrUrl(value) {
  const raw = clean(value);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const match = url.pathname.match(/\/vp\/products\/(\d+)/i);
    const productId = match ? match[1] : '';
    const itemId = clean(url.searchParams.get('itemId'));
    const vendorItemId = clean(url.searchParams.get('vendorItemId'));
    if (productId && itemId && vendorItemId) {
      return { product_id: productId, item_id: itemId, vendor_item_id: vendorItemId };
    }
  } catch (_) {}
  return null;
}
function parseCpkrUid(value) {
  const normalized = stripMallPrefix(value);
  const match = normalized.match(/^(\d+)_(\d+)_(\d+)$/);
  if (!match) {
    return { ok:false, uid:normalized, product_id:'', item_id:'', vendor_item_id:'', product_url:'', error:'invalid_cpkr_uid' };
  }
  const productId=match[1], itemId=match[2], vendorItemId=match[3];
  return {
    ok:true,
    uid:normalized,
    product_id:productId,
    item_id:itemId,
    vendor_item_id:vendorItemId,
    product_url:'https://www.coupang.com/vp/products/'+encodeURIComponent(productId)+'?itemId='+encodeURIComponent(itemId)+'&vendorItemId='+encodeURIComponent(vendorItemId),
    error:''
  };
}
function parseCpkrIdentity(row) {
  const source = row || {};
  for (const candidate of [
    source.pi_ii_vi,
    source.source_uid,
    source.product_uid,
    [source.product_id, source.item_id, source.vendor_item_id].filter(Boolean).join('_')
  ]) {
    const parsed = parseCpkrUid(candidate);
    if (parsed.ok) return parsed;
  }
  for (const candidate of [source.product_url, source.source_url, source.mall_product_url]) {
    const ids = parseCpkrUrl(candidate);
    if (!ids) continue;
    return parseCpkrUid([ids.product_id, ids.item_id, ids.vendor_item_id].join('_'));
  }
  return parseCpkrUid('');
}
async function resolveCpkrIdentity(db, item, orderNo) {
  let parsed = parseCpkrIdentity(item);
  if (parsed.ok) return { parsed, source: 'gm_auto_order_item' };

  const original = (
    await db.query(
      `SELECT *
         FROM gm_order_item
        WHERE order_no=$1
          AND (
            NULLIF(pi_ii_vi,'') = NULLIF($2,'')
            OR NULLIF(source_uid,'') = NULLIF($3,'')
            OR (
              NULLIF(product_name,'') = NULLIF($4,'')
              AND COALESCE(NULLIF(option_value,''),NULLIF(option_name,''),'') = $5
            )
          )
        ORDER BY
          CASE WHEN NULLIF(pi_ii_vi,'') = NULLIF($2,'') THEN 0
               WHEN NULLIF(source_uid,'') = NULLIF($3,'') THEN 1
               ELSE 2 END,
          created_at ASC NULLS LAST
        LIMIT 1`,
      [
        clean(orderNo),
        clean(item && item.pi_ii_vi),
        clean(item && item.source_uid),
        clean(item && item.product_name),
        clean((item && (item.option_value || item.option_name)) || '')
      ]
    )
  ).rows[0];

  parsed = parseCpkrIdentity(original);
  if (parsed.ok) return { parsed, source: 'gm_order_item' };

  const keys = [
    item && item.source_uid,
    item && item.pi_ii_vi,
    original && original.source_uid,
    original && original.pi_ii_vi
  ].map(clean).filter(Boolean);
  const stripped = [...new Set(keys.map(stripMallPrefix).filter(Boolean))];
  const full = [...new Set(keys)];

  if (stripped.length || full.length) {
    const product = (
      await db.query(
        `SELECT *
           FROM gm_product
          WHERE product_uid = ANY($1::text[])
             OR source_uid = ANY($1::text[])
             OR pi_ii_vi = ANY($2::text[])
             OR internal_product_code = ANY($2::text[])
          ORDER BY
            CASE
              WHEN source_uid = ANY($1::text[]) THEN 0
              WHEN product_uid = ANY($1::text[]) THEN 1
              WHEN pi_ii_vi = ANY($2::text[]) THEN 2
              ELSE 3
            END,
            updated_at DESC NULLS LAST
          LIMIT 1`,
        [full, stripped]
      )
    ).rows[0];

    parsed = parseCpkrIdentity(product);
    if (parsed.ok) return { parsed, source: 'gm_product_link' };
  }

  return { parsed, source: 'unresolved' };
}
async function enrichCpkrItem(db, item, orderNo) {
  const resolved = await resolveCpkrIdentity(db, item, orderNo);
  const parsed = resolved.parsed;
  return {
    ...item,
    cpkr_uid_valid: parsed.ok,
    cpkr_uid_error: parsed.error,
    cpkr_identity_source: resolved.source,
    pi_ii_vi: parsed.ok ? parsed.uid : clean(item && item.pi_ii_vi),
    source_uid: parsed.ok ? 'CPKR_' + parsed.uid : clean(item && item.source_uid),
    product_id: parsed.product_id || clean(item && item.product_id),
    item_id: parsed.item_id || clean(item && item.item_id),
    vendor_item_id: parsed.vendor_item_id || clean(item && item.vendor_item_id),
    product_url: parsed.product_url || clean(item && item.product_url)
  };
}

async function buildPayload(db, work) {
  const order = (
    await db.query(
      'SELECT * FROM gm_auto_order WHERE auto_order_no=$1 LIMIT 1',
      [work.auto_order_no]
    )
  ).rows[0];

  if (!order) throw new Error('auto_order_not_found');

  const rawItems = (
    await db.query(
      `SELECT *
       FROM gm_auto_order_item
       WHERE auto_order_no=$1
       ORDER BY auto_order_item_id ASC`,
      [work.auto_order_no]
    )
  ).rows;
  const items = [];
  for (const item of rawItems) {
    items.push(await enrichCpkrItem(db, item, order.order_no));
  }

  const gmOrder = (
    await db.query(
      `SELECT
         receiver_name, receiver_phone, receiver_mobile, receiver_safe_phone,
         receiver_zipcode, receiver_address1, receiver_address2, delivery_memo
       FROM gm_order
       WHERE order_no=$1
       LIMIT 1`,
      [order.order_no]
    )
  ).rows[0] || {};

  const receiver = {
    name: clean(gmOrder.receiver_name),
    receiver_name: clean(gmOrder.receiver_name),
    phone: clean(gmOrder.receiver_mobile || gmOrder.receiver_phone),
    mobile: clean(gmOrder.receiver_mobile),
    safe_phone: clean(gmOrder.receiver_safe_phone),
    zipcode: clean(gmOrder.receiver_zipcode),
    road_address: clean(gmOrder.receiver_address1),
    address: clean(gmOrder.receiver_address1),
    detail_address: clean(gmOrder.receiver_address2),
    memo: clean(gmOrder.delivery_memo),
    persist_address: false,
    set_default_address: false
  };

  return {
    work_id: work.work_id,
    auto_order_no: work.auto_order_no,
    mall_code: upper(order.mall_code),
    source_mall: upper(order.mall_code),
    mode: order.mode || 'SEMI_AUTO',
    stop_before_payment: upper(order.mode || 'SEMI_AUTO') !== 'FULL_AUTO',
    order,
    receiver,
    items
  };
}

async function recoverExpired(db) {
  const result = await db.query(
    `UPDATE gm_auto_order_work
     SET work_status='READY',
         lock_token=NULL,
         lock_admin_id=NULL,
         lock_mall_account_id=NULL,
         lock_at=NULL,
         lock_expires_at=NULL,
         updated_at=now()
     WHERE upper(work_status)='RUNNING'
       AND lock_expires_at IS NOT NULL
       AND lock_expires_at < now()
     RETURNING *`
  );

  for (const work of result.rows) {
    await writeLog(
      db,
      work,
      'RUNNING',
      'READY',
      'LOCK_EXPIRED',
      'client lock expired',
      {}
    );
  }
}

async function readyList(pool, data) {
  const adminId = clean(data.admin_id || data.adminId);
  const mallAccountId = clean(data.mall_account_id || data.mallAccountId);
  const mallCode = upper(data.mall_code || data.mallCode || 'CPKR');
  const limit = Math.min(Math.max(Number(data.limit || 20), 1), 100);

  const params = [mallCode];
  let where = `
    upper(w.work_status)='READY'
    AND upper(w.work_type)='ORDER'
    AND upper(o.mall_code)=$1
    /* [CANCEL GUARD] 고객 취소 주문은 READY 목록에도 다시 노출하지 않는다. */
    AND upper(COALESCE(g.customer_status,'')) <> 'CANCEL_COMPLETED'
    AND upper(COALESCE(g.seller_status,'')) <> 'CANCELLED'
    AND upper(COALESCE(g.order_status,'')) <> 'CANCELLED'
  `;

  if (adminId) {
    params.push(adminId);
    where += ` AND w.admin_id=$${params.length}`;
  }
  if (mallAccountId) {
    params.push(mallAccountId);
    where += ` AND w.mall_account_id=$${params.length}`;
  }

  params.push(limit);

  const result = await pool.query(
    `SELECT
       w.work_id,
       w.auto_order_no,
       w.work_type,
       w.work_status,
       w.priority,
       w.admin_id,
       w.mall_account_id,
       w.requested_at,
       w.updated_at,
       o.mall_code,
       o.order_status,
       o.process_status,
       o.actual_payment_amount AS expected_amount,
       COALESCE(i.item_count,0)::int AS item_count,
       COALESCE(i.product_names,'') AS product_names
     FROM gm_auto_order_work w
     JOIN gm_auto_order o
       ON o.auto_order_no=w.auto_order_no
     JOIN gm_order g
       ON g.order_no=o.order_no
     LEFT JOIN (
       SELECT
         auto_order_no,
         count(*) AS item_count,
         string_agg(
           COALESCE(product_name,''),
           ' / '
           ORDER BY auto_order_item_id
         ) AS product_names
       FROM gm_auto_order_item
       GROUP BY auto_order_no
     ) i ON i.auto_order_no=w.auto_order_no
     WHERE ${where}
     ORDER BY
       w.priority DESC,
       w.requested_at ASC,
       w.work_id ASC
     LIMIT $${params.length}`,
    params
  );

  return result.rows;
}

async function claim(pool, data) {
  const adminId = clean(data.admin_id || data.adminId);
  const mallAccountId = clean(data.mall_account_id || data.mallAccountId);
  const mallCode = upper(data.mall_code || data.mallCode || 'CPKR');

  if (!adminId || !mallAccountId) {
    return { job: null, reason: 'client_assignment_required' };
  }

  const db = await pool.connect();

  try {
    await db.query('BEGIN');
    await recoverExpired(db);

    const result = await db.query(
      `SELECT w.*
       FROM gm_auto_order_work w
       JOIN gm_auto_order o
         ON o.auto_order_no=w.auto_order_no
       JOIN gm_order g
         ON g.order_no=o.order_no
       WHERE upper(w.work_status)='READY'
         /* [CANCEL GUARD] claim 직전에도 gm_order 취소 여부를 다시 확인한다. */
         AND upper(COALESCE(g.customer_status,'')) <> 'CANCEL_COMPLETED'
         AND upper(COALESCE(g.seller_status,'')) <> 'CANCELLED'
         AND upper(COALESCE(g.order_status,'')) <> 'CANCELLED'
         AND upper(w.work_type)='ORDER'
         AND w.admin_id=$1
         AND w.mall_account_id=$2
         AND upper(o.mall_code)=$3
         AND (w.lock_token IS NULL OR w.lock_expires_at < now())
       ORDER BY
         w.priority DESC,
         w.requested_at ASC,
         w.work_id ASC
       FOR UPDATE SKIP LOCKED
       LIMIT 1`,
      [adminId, mallAccountId, mallCode]
    );

    if (!result.rows.length) {
      await db.query('COMMIT');
      return { job: null, reason: 'queue_empty' };
    }

    const previous = result.rows[0];
    const lockToken = crypto.randomUUID();

    const work = (
      await db.query(
        `UPDATE gm_auto_order_work
         SET work_status='RUNNING',
             lock_token=$2,
             lock_admin_id=$3,
             lock_mall_account_id=$4,
             lock_at=now(),
             lock_expires_at=now()+($5::int * interval '1 second'),
             started_at=COALESCE(started_at,now()),
             updated_at=now()
         WHERE work_id=$1
         RETURNING *`,
        [
          previous.work_id,
          lockToken,
          adminId,
          mallAccountId,
          LOCK_SECONDS
        ]
      )
    ).rows[0];

    await writeLog(
      db,
      work,
      previous.work_status,
      'RUNNING',
      'CLIENT_CLAIM',
      'client claimed work',
      { client_id: clean(data.client_id) }
    );

    const job = {
      ...work,
      lock_token: lockToken,
      payload: await buildPayload(db, work)
    };

    await db.query('COMMIT');
    return { job };
  } catch (error) {
    await db.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    db.release();
  }
}

async function heartbeat(pool, workId, data) {
  /*
   * [FINAL ORDER CANCEL GUARD]
   * heartbeat는 lock 연장뿐 아니라 "이 주문을 계속 진행해도 되는가"를 확인하는 실행 허가점이다.
   * gm_order에 고객취소가 들어오면 work를 즉시 CANCELLED로 바꾸고 lock을 끊는다.
   * Runner는 장바구니/주문서/최종 주문 직전에 이 heartbeat를 호출해야 한다.
   */
  const db = await pool.connect();
  try {
    await db.query('BEGIN');

    const current = (
      await db.query(
        `SELECT
           w.*,
           g.customer_status AS gm_customer_status,
           g.seller_status AS gm_seller_status,
           g.order_status AS gm_order_status
         FROM gm_auto_order_work w
         JOIN gm_auto_order a ON a.auto_order_no=w.auto_order_no
         JOIN gm_order g ON g.order_no=a.order_no
         WHERE w.work_id=$1
         FOR UPDATE OF w`,
        [Number(workId)]
      )
    ).rows[0];

    if (!current) throw new Error('work_not_found');
    if (
      clean(current.lock_token) !== clean(data.lock_token) ||
      clean(current.lock_admin_id) !== clean(data.admin_id) ||
      clean(current.lock_mall_account_id) !== clean(data.mall_account_id)
    ) {
      throw new Error('work_lock_invalid_or_expired');
    }

    const cancelled =
      upper(current.gm_customer_status) === 'CANCEL_COMPLETED' ||
      upper(current.gm_seller_status) === 'CANCELLED' ||
      upper(current.gm_order_status) === 'CANCELLED';

    if (cancelled) {
      await db.query(
        `UPDATE gm_auto_order_work
         SET work_status='CANCELLED',
             lock_token=NULL,
             lock_admin_id=NULL,
             lock_mall_account_id=NULL,
             lock_at=NULL,
             lock_expires_at=NULL,
             error_code='CUSTOMER_CANCELLED',
             error_message='Glomart 주문 취소 확인: Runner 진행 금지',
             updated_at=now()
         WHERE work_id=$1`,
        [Number(workId)]
      );
      await db.query('COMMIT');
      throw new Error('work_cancelled_by_customer');
    }

    if (upper(current.work_status) !== 'RUNNING') {
      throw new Error('work_lock_invalid_or_expired');
    }

    const result = await db.query(
      `UPDATE gm_auto_order_work
       SET lock_expires_at=now()+($2::int * interval '1 second'),
           updated_at=now()
       WHERE work_id=$1
       RETURNING *`,
      [Number(workId), LOCK_SECONDS]
    );

    await db.query('COMMIT');
    return result.rows[0];
  } catch (error) {
    if (error && error.message === 'work_cancelled_by_customer') throw error;
    await db.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    db.release();
  }
}

async function release(pool, workId, data) {
  const token = clean(data.lock_token);
  if (!token) throw new Error('lock_token_is_required');

  const db = await pool.connect();

  try {
    await db.query('BEGIN');

    const current = (
      await db.query(
        'SELECT * FROM gm_auto_order_work WHERE work_id=$1 FOR UPDATE',
        [Number(workId)]
      )
    ).rows[0];

    if (!current) throw new Error('work_not_found');
    if (clean(current.lock_token) !== token) {
      throw new Error('work_lock_invalid');
    }
    if (upper(current.work_status) !== 'RUNNING') {
      throw new Error('work_not_running');
    }

    const work = (
      await db.query(
        `UPDATE gm_auto_order_work
         SET work_status='READY',
             lock_token=NULL,
             lock_admin_id=NULL,
             lock_mall_account_id=NULL,
             lock_at=NULL,
             lock_expires_at=NULL,
             updated_at=now()
         WHERE work_id=$1
         RETURNING *`,
        [Number(workId)]
      )
    ).rows[0];

    await writeLog(
      db,
      work,
      'RUNNING',
      'READY',
      'CLIENT_RELEASE',
      'client released test claim',
      { client_id: clean(data.client_id) }
    );

    await db.query('COMMIT');
    return work;
  } catch (error) {
    await db.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    db.release();
  }
}

async function updateState(pool, workId, data) {
  const status = upper(data.status);
  const allowed = new Set([
    'RUNNING',
    'PAYMENT_WAITING',
    'STOPPED_BEFORE_PAYMENT',
    'COMPLETED',
    'FAILED',
    'LOGIN_REQUIRED',
    'OPTION_ERROR',
    'OUT_OF_STOCK',
    'PRICE_CHANGED',
    'CANCELLED'
  ]);

  if (!allowed.has(status)) {
    throw new Error(`unsupported_status:${status}`);
  }

  const db = await pool.connect();

  try {
    await db.query('BEGIN');

    const current = (
      await db.query(
        'SELECT * FROM gm_auto_order_work WHERE work_id=$1 FOR UPDATE',
        [Number(workId)]
      )
    ).rows[0];

    if (!current) throw new Error('work_not_found');
    if (clean(current.lock_token) !== clean(data.lock_token)) {
      throw new Error('work_lock_invalid');
    }

    const storedStatus =
      status === 'STOPPED_BEFORE_PAYMENT'
        ? 'PAYMENT_WAITING'
        : status;

    const terminal = storedStatus !== 'RUNNING';
    const detail = data.detail || {};

    const work = (
      await db.query(
        `UPDATE gm_auto_order_work
         SET work_status=$2,
             completed_at=CASE WHEN $2='COMPLETED' THEN now() ELSE completed_at END,
             error_code=CASE
               WHEN $2 IN ('FAILED','LOGIN_REQUIRED','OPTION_ERROR','OUT_OF_STOCK','PRICE_CHANGED')
               THEN $3 ELSE error_code END,
             error_message=CASE
               WHEN $2 IN ('FAILED','LOGIN_REQUIRED','OPTION_ERROR','OUT_OF_STOCK','PRICE_CHANGED')
               THEN $4 ELSE error_message END,
             lock_token=CASE WHEN $5 THEN NULL ELSE lock_token END,
             lock_expires_at=CASE
               WHEN $5 THEN NULL
               ELSE now()+($6::int * interval '1 second')
             END,
             updated_at=now()
         WHERE work_id=$1
         RETURNING *`,
        [
          Number(workId),
          storedStatus,
          clean(detail.error_code || storedStatus),
          clean(detail.message),
          terminal,
          LOCK_SECONDS
        ]
      )
    ).rows[0];

    await writeLog(
      db,
      work,
      current.work_status,
      storedStatus,
      'CLIENT_STATE',
      clean(detail.message || detail.phase),
      detail
    );

    if (storedStatus === 'COMPLETED') {
      await db.query(
        `UPDATE gm_auto_order
         SET process_status='COMPLETED',
             order_status='ORDERED',
             mall_order_no=COALESCE($2,mall_order_no),
             updated_at=now()
         WHERE auto_order_no=$1`,
        [work.auto_order_no, clean(detail.mall_order_no) || null]
      );
    } else if (storedStatus === 'PAYMENT_WAITING') {
      await db.query(
        `UPDATE gm_auto_order
         SET process_status='PAYMENT_WAITING',
             updated_at=now()
         WHERE auto_order_no=$1`,
        [work.auto_order_no]
      );
    }

    await db.query('COMMIT');
    return work;
  } catch (error) {
    await db.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    db.release();
  }
}

async function status(pool) {
  const counts = (
    await pool.query(
      `SELECT
         upper(work_status) AS status,
         count(*)::int AS count
       FROM gm_auto_order_work
       GROUP BY upper(work_status)
       ORDER BY 1`
    )
  ).rows;

  return {
    counts,
    lock_seconds: LOCK_SECONDS
  };
}

module.exports = {
  readyList,
  claim,
  heartbeat,
  release,
  updateState,
  status,
  LOCK_SECONDS
};
