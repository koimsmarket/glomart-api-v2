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

async function buildPayload(db, work) {
  const order = (
    await db.query(
      'SELECT * FROM gm_auto_order WHERE auto_order_no=$1 LIMIT 1',
      [work.auto_order_no]
    )
  ).rows[0];

  if (!order) throw new Error('auto_order_not_found');

  const items = (
    await db.query(
      `SELECT *
       FROM gm_auto_order_item
       WHERE auto_order_no=$1
       ORDER BY auto_order_item_id ASC`,
      [work.auto_order_no]
    )
  ).rows;

  return {
    work_id: work.work_id,
    auto_order_no: work.auto_order_no,
    mall_code: upper(order.mall_code),
    source_mall: upper(order.mall_code),
    mode: order.mode || 'SEMI_AUTO',
    stop_before_payment: upper(order.mode || 'SEMI_AUTO') !== 'FULL_AUTO',
    order,
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
       o.expected_amount,
       COALESCE(i.item_count,0)::int AS item_count,
       COALESCE(i.product_names,'') AS product_names
     FROM gm_auto_order_work w
     JOIN gm_auto_order o
       ON o.auto_order_no=w.auto_order_no
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
       WHERE upper(w.work_status)='READY'
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
  const result = await pool.query(
    `UPDATE gm_auto_order_work
     SET lock_expires_at=now()+($5::int * interval '1 second'),
         updated_at=now()
     WHERE work_id=$1
       AND lock_token=$2
       AND lock_admin_id=$3
       AND lock_mall_account_id=$4
       AND upper(work_status)='RUNNING'
     RETURNING *`,
    [
      Number(workId),
      clean(data.lock_token),
      clean(data.admin_id),
      clean(data.mall_account_id),
      LOCK_SECONDS
    ]
  );

  if (!result.rows.length) {
    throw new Error('work_lock_invalid_or_expired');
  }

  return result.rows[0];
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
