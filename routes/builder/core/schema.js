const { clean } = require('./csv');
const { TABLES, LIMITS } = require('./config');
async function getColumns(db, table) {
  const r = await db.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name=$1
    ORDER BY ordinal_position
  `, [table]);
  return r.rows.map(x => x.column_name);
}
async function getColumnMeta(db, table) {
  const r = await db.query(`
    SELECT column_name, is_nullable
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name=$1
    ORDER BY ordinal_position
  `, [table]);
  const out = {};
  for (const x of r.rows) out[x.column_name] = x;
  return out;
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




module.exports = { getColumns, getColumnMeta, tableSpec, keySets, pickKey, isNumberValue, normalizeNumber, validateCell, shouldStop, resultRow };
