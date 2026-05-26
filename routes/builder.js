const express = require('express');
const router = express.Router();

const VERSION = 'GM_SAFE_UPDATE_BUILDER_V002';

// V002 기본 원칙:
// - UPDATE ONLY
// - INSERT 금지
// - DELETE 금지
// - 키 없는 행 SKIP
// - DB에 없는 키 SKIP
// - 빈값은 기본적으로 기존값 유지
// - 중요 컬럼 부적격은 행 SKIP
// - 부적격 과다 시 STOP
// - 결과 CSV 출력

const TABLES = {
  products: {
    table: 'gm_products',
    key: ['mall_code', 'pi_ii_vi'],
    order: 'updated_at DESC NULLS LAST, created_at DESC NULLS LAST',
    critical: ['mall_code', 'pi_ii_vi', 'product_name', 'mall_sale_price'],
    numeric: ['mall_sale_price','customer_sale_price','final_supply_price','normal_price','discount_price','delivery_fee','unit_price_value','unit_base_qty','unit_norm_qty','unit_norm_price','option_count'],
    defaults: { mall_code:'CPKR', currency:'KRW', sale_status:'active', collect_status:'ok', unit_sortable_yn:'N', unit_parse_status:'failed' },
    enums: {
      delivery_type:['seller','bundle','fresh','rocket','rocket_fresh','unknown'],
      sale_status:['active','soldout','unavailable','deleted','collect_failed'],
      collect_status:['ok','option_failed','price_failed','page_failed','etc'],
      unit_sortable_yn:['Y','N']
    },
    blocked: ['product_uid','created_at']
  },
  cart: {
    table: 'gm_basket',
    keyAny: [['member_id','pi_ii_vi'], ['guest_key','pi_ii_vi']],
    order: 'updated_at DESC NULLS LAST, added_at DESC NULLS LAST',
    critical: ['pi_ii_vi','product_name','quantity','amount'],
    numeric: ['quantity','amount','delivery_fee'],
    defaults: { quantity:'1', amount_type:'unit', delivery_fee:'0' },
    enums: { amount_type:['unit','line_total'], delivery_type:['seller','bundle','fresh','rocket','rocket_fresh','unknown'] },
    blocked: ['added_at','created_at']
  },
  orders: {
    table: 'gm_orders',
    key: ['order_no'],
    order: 'created_at DESC NULLS LAST',
    critical: ['order_no','orderer_name','orderer_mobile','receiver_name','receiver_mobile','receiver_zipcode','receiver_address1','total_payment_price'],
    numeric: ['expected_payment_amount','actual_payment_amount','payment_difference_amount','total_product_price','total_delivery_fee','extra_area_delivery_fee','estimated_customs_fee','estimated_import_vat','total_payment_price'],
    defaults: { customs_required_yn:'N', order_status:'ordered', payment_status:'pending', shipping_status:'pending', cs_status:'none', cancel_status:'none', purchase_confirmed_yn:'N' },
    enums: {
      customs_required_yn:['Y','N'],
      order_status:['draft','ordered','cancelled','completed'],
      payment_status:['pending','waiting_deposit','partially_paid','paid','overpaid','refunded','failed'],
      shipping_status:['pending','preparing','shipped','in_transit','delivered','returned'],
      cs_status:['none','open','processing','resolved','closed'],
      cancel_status:['none','requested','completed','rejected'],
      purchase_confirmed_yn:['Y','N']
    },
    blocked: ['order_no','created_at','ordered_at']
  },
  order_items: {
    table: 'gm_order_items',
    key: ['order_no','pi_ii_vi'],
    order: 'created_at DESC NULLS LAST',
    critical: ['order_no','pi_ii_vi','product_name','quantity','mall_sale_price','customer_order_price','product_amount'],
    numeric: ['quantity','mall_sale_price','customer_order_price','final_supply_price','product_amount','delivery_fee','extra_area_delivery_fee'],
    defaults: { quantity:'1', delivery_fee:'0', extra_area_delivery_fee:'0', item_order_status:'ordered', item_shipping_status:'pending' },
    enums: { delivery_type:['seller','bundle','fresh','rocket','rocket_fresh','unknown'], item_order_status:['ordered','cancelled','returned','exchanged'], item_shipping_status:['pending','preparing','shipped','in_transit','delivered','returned'] },
    blocked: ['created_at']
  },
  cs: {
    table: 'gm_cs',
    key: ['cs_no'],
    order: 'created_at DESC NULLS LAST',
    critical: ['cs_no','order_no','cs_type','cs_status'],
    numeric: [],
    defaults: { cs_status:'requested', return_confirm_yn:'N' },
    enums: {
      cs_type:['cs','return','exchange','cancel','refund','delivery','payment'],
      cs_status:['requested','processing','return_shipping','return_received','return_confirmed','reshipped','completed','cancelled'],
      return_confirm_yn:['Y','N']
    },
    blocked: ['cs_no','created_at','request_at']
  },
  cs_messages: {
    table: 'gm_cs_message',
    key: ['message_id'],
    order: 'created_at DESC NULLS LAST',
    critical: ['message_id','cs_no','order_no','sender_type','message_type'],
    numeric: ['message_id'],
    defaults: { sender_type:'customer', message_type:'text', read_yn:'N' },
    enums: {
      sender_type:['customer','seller','admin','system'],
      message_type:['text','image','file','system'],
      read_yn:['Y','N']
    },
    blocked: ['message_id','created_at']
  }
};

const LIMITS = {
  MAX_ROWS: 50000,
  BATCH_SIZE: 300,
  MAX_INVALID: 500,
  MAX_INVALID_RATE: 0.10
};

function dbFrom(req) {
  return req.app.locals.db || req.app.locals.pool;
}
function ok(res, data) {
  res.json({ ok:true, version:VERSION, ...data });
}
function fail(res, status, error, extra={}) {
  res.status(status).json({ ok:false, version:VERSION, error, ...extra });
}
function qIdent(s) {
  return '"' + String(s).replace(/"/g, '""') + '"';
}
function clean(v) {
  return String(v ?? '').replace(/^\ufeff/, '').trim();
}
function csvEscape(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') v = JSON.stringify(v);
  v = String(v);
  return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}
function toCsv(rows, columns) {
  const lines = [columns.map(csvEscape).join(',')];
  for (const r of rows) lines.push(columns.map(c => csvEscape(r[c])).join(','));
  return '\ufeff' + lines.join('\n');
}
function parseCsv(text) {
  text = String(text || '').replace(/^\ufeff/, '');
  const rows = [];
  let row = [], cell = '', quote = false;
  for (let i=0; i<text.length; i++) {
    const ch = text[i], nx = text[i+1];
    if (quote) {
      if (ch === '"' && nx === '"') { cell += '"'; i++; }
      else if (ch === '"') quote = false;
      else cell += ch;
    } else {
      if (ch === '"') quote = true;
      else if (ch === ',') { row.push(cell); cell = ''; }
      else if (ch === '\n') { row.push(cell); rows.push(row); row=[]; cell=''; }
      else if (ch !== '\r') cell += ch;
    }
  }
  row.push(cell);
  if (row.length > 1 || row[0] !== '') rows.push(row);
  if (!rows.length) return [];
  const header = rows.shift().map(h => clean(h));
  return rows
    .filter(r => r.some(v => clean(v) !== ''))
    .map((r, idx) => {
      const o = { __row_no: idx + 2 };
      header.forEach((h,i)=>{ if (h) o[h] = r[i] ?? ''; });
      return o;
    });
}
async function getColumns(db, table) {
  const r = await db.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name=$1
    ORDER BY ordinal_position
  `, [table]);
  return r.rows.map(x => x.column_name);
}
function tableSpec(key) {
  return TABLES[String(key || '').trim()] || null;
}
function keySets(spec) {
  return spec.keyAny || [spec.key];
}
function pickKey(row, spec) {
  for (const ks of keySets(spec)) {
    const ok = ks.every(k => clean(row[k]) !== '');
    if (ok) return { keys:ks, values:ks.map(k => clean(row[k])), label:ks.map(k => clean(row[k])).join('+') };
  }
  return null;
}
function isNumberValue(v) {
  if (v === null || v === undefined || clean(v) === '') return false;
  const n = Number(String(v).replace(/,/g,''));
  return Number.isFinite(n) && n >= 0;
}
function normalizeNumber(v) {
  const n = Number(String(v).replace(/,/g,''));
  return Number.isFinite(n) ? n : null;
}
function validateCell(col, rawValue, spec) {
  let value = clean(rawValue);
  const hasValue = value !== '';

  if (!hasValue && Object.prototype.hasOwnProperty.call(spec.defaults || {}, col)) {
    value = spec.defaults[col];
  }

  if (!hasValue && (spec.critical || []).includes(col)) {
    return { ok:false, value, reason:'CRITICAL_EMPTY' };
  }

  if (!hasValue) {
    return { ok:true, value:null, action:'KEEP_OLD' };
  }

  if ((spec.numeric || []).includes(col)) {
    if (!isNumberValue(value)) return { ok:false, value, reason:'INVALID_NUMBER' };
    return { ok:true, value:normalizeNumber(value) };
  }

  if (spec.enums && spec.enums[col]) {
    if (!spec.enums[col].includes(value)) {
      return { ok:false, value, reason:'INVALID_ENUM:' + spec.enums[col].join('|') };
    }
  }

  if (col.endsWith('_url') || col === 'product_url' || col === 'thumb_origin_url' || col === 'file_url') {
    if (value && !/^https?:\/\//i.test(value)) {
      return { ok:false, value, reason:'INVALID_URL' };
    }
  }

  return { ok:true, value };
}
function shouldStop(invalid, processed) {
  if (invalid >= LIMITS.MAX_INVALID) return 'MAX_INVALID';
  if (processed >= 100 && invalid / processed > LIMITS.MAX_INVALID_RATE) return 'MAX_INVALID_RATE';
  return '';
}
function resultRow(rowNo, table, key, result, column, value, reason) {
  return { row_no:rowNo, table, key:key || '', result, column_name:column || '', value:value ?? '', reason:reason || '' };
}

router.get('/api/gm/builder/tables', (req,res)=>{
  ok(res, { tables:Object.keys(TABLES).map(k=>({ key:k, table:TABLES[k].table, keys:keySets(TABLES[k]) })) });
});

router.get('/api/gm/builder/export', async (req,res)=>{
  const spec = tableSpec(req.query.table);
  if (!spec) return fail(res, 400, 'invalid table');

  const format = String(req.query.format || 'csv').toLowerCase();
  const db = dbFrom(req);
  const limit = Math.min(Math.max(Number(req.query.limit || 5000), 1), 50000);

  try {
    const cols = await getColumns(db, spec.table);
    const r = await db.query(`SELECT ${cols.map(qIdent).join(', ')} FROM ${qIdent(spec.table)} ORDER BY ${spec.order} LIMIT $1`, [limit]);
    if (format === 'json') return ok(res, { table:spec.table, count:r.rows.length, columns:cols, rows:r.rows });

    const csv = toCsv(r.rows, cols);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${spec.table}_${Date.now()}.csv"`);
    res.end(csv);
  } catch(e) {
    fail(res, 500, 'export failed', { detail:String(e && e.message || e) });
  }
});

router.post('/api/gm/builder/safe-update', express.text({ type:['text/*','application/csv'], limit:'30mb' }), async (req,res)=>{
  const spec = tableSpec(req.query.table);
  if (!spec) return fail(res, 400, 'invalid table');

  const apply = String(req.query.apply || '').toUpperCase() === 'YES';
  const db = dbFrom(req);

  let rows = parseCsv(req.body);
  if (rows.length > LIMITS.MAX_ROWS) {
    rows = rows.slice(0, LIMITS.MAX_ROWS);
  }

  const result = [];
  let processed = 0, updated = 0, skipped = 0, invalid = 0;
  let stopped = '';

  try {
    const columns = await getColumns(db, spec.table);
    const colSet = new Set(columns);
    const client = apply ? await db.connect() : null;

    try {
      if (client) await client.query('BEGIN');

      for (const row of rows) {
        processed++;
        const key = pickKey(row, spec);
        if (!key) {
          invalid++; skipped++;
          result.push(resultRow(row.__row_no, spec.table, '', 'SKIP', '', '', 'MISSING_KEY'));
        } else {
          const where = key.keys.map((k,i)=>`${qIdent(k)}=$${i+1}`).join(' AND ');
          const exist = await (client || db).query(`SELECT 1 FROM ${qIdent(spec.table)} WHERE ${where} LIMIT 1`, key.values);

          if (!exist.rows.length) {
            skipped++;
            result.push(resultRow(row.__row_no, spec.table, key.label, 'SKIP', '', '', 'KEY_NOT_FOUND'));
          } else {
            const updates = [];
            const params = [];

            for (const [col, raw] of Object.entries(row)) {
              if (col === '__row_no') continue;
              if (!colSet.has(col)) {
                skipped++;
                result.push(resultRow(row.__row_no, spec.table, key.label, 'SKIP_CELL', col, raw, 'UNKNOWN_COLUMN'));
                continue;
              }
              if (key.keys.includes(col)) continue;
              if ((spec.blocked || []).includes(col)) continue;

              const v = validateCell(col, raw, spec);
              if (!v.ok) {
                invalid++;
                updates.length = 0;
                result.push(resultRow(row.__row_no, spec.table, key.label, 'SKIP', col, raw, v.reason));
                break;
              }
              if (v.action === 'KEEP_OLD') continue;

              params.push(v.value);
              updates.push(`${qIdent(col)}=$${params.length}`);
            }

            if (updates.length) {
              if (apply) {
                key.values.forEach(v=>params.push(v));
                await client.query(
                  `UPDATE ${qIdent(spec.table)} SET ${updates.join(', ')} WHERE ${where.replace(/\$(\d+)/g, (_,n)=>'$'+(params.length-key.values.length+Number(n)))}`,
                  params
                );
              }
              updated++;
              result.push(resultRow(row.__row_no, spec.table, key.label, apply ? 'UPDATED' : 'VALID_UPDATE', '', '', apply ? 'APPLIED' : 'DRY_RUN'));
            } else if (!result.find(r => r.row_no === row.__row_no && r.result === 'SKIP')) {
              skipped++;
              result.push(resultRow(row.__row_no, spec.table, key.label, 'SKIP', '', '', 'NO_UPDATABLE_VALUE'));
            }
          }
        }

        stopped = shouldStop(invalid, processed);
        if (stopped) {
          result.push(resultRow(row.__row_no, spec.table, '', 'STOPPED', '', '', stopped));
          break;
        }
      }

      if (client) await client.query('COMMIT');
    } catch(e) {
      if (client) await client.query('ROLLBACK').catch(()=>{});
      throw e;
    } finally {
      if (client) client.release();
    }

    const cols = ['row_no','table','key','result','column_name','value','reason'];
    const csv = toCsv(result, cols);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="gm_safe_update_result_${Date.now()}.csv"`);
    res.end(csv);
  } catch(e) {
    fail(res, 500, 'safe update failed', { detail:String(e && e.message || e) });
  }
});

module.exports = router;