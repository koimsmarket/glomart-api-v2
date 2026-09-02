const express = require('express');
const router = express.Router();
const { LIMITS, tableSpec, dbFrom, fail, parseCsv, getColumns, getColumnMeta, pickKey, qIdent, validateCell, shouldStop, resultRow, safeUpdateCategoryBatch, mapCafe24Member, cafe24ImportResultRow, upsertObject, toCsv } = require('./core');


// GM_PRODUCT_SAFE_KEY_V002
// gm_product export reality:
// CPKR has PID/IID/VID; ALKR legitimately stores blank IID.
// For ALKR blank IID is still compared to DB NULL/blank, never ignored.
function cleanProductKey(v){ return String(v == null ? '' : v).trim(); }
function pickProductSafeKey(row){
  const mall=cleanProductKey(row.mall_code).toUpperCase();
  const pid=cleanProductKey(row.product_id);
  const iid=cleanProductKey(row.item_id);
  const vid=cleanProductKey(row.vendor_item_id);
  if(!mall || !pid || !vid) return null;
  if(mall==='CPKR' && !iid) return null;
  return {keys:['mall_code','product_id','item_id','vendor_item_id'], values:[mall,pid,iid,vid], label:[mall,pid,iid,vid].join('+'), blankComparable:iid===''?new Set(['item_id']):new Set()};
}
function productSafeWhere(key,startIndex=1){
  return key.keys.map((k,i)=> key.blankComparable && key.blankComparable.has(k)
    ? `COALESCE(${qIdent(k)}::text,'')=$${startIndex+i}`
    : `${qIdent(k)}=$${startIndex+i}`).join(' AND ');
}

router.post('/api/gm/builder/safe-update', express.text({ type:['text/*','application/csv'], limit:'30mb' }), async (req,res)=>{
  const spec = tableSpec(req.query.table);
  if (!spec) return fail(res, 400, 'invalid table');

  const apply = String(req.query.apply || '').toUpperCase() === 'YES';
  const exactFileMode = String(req.query.file_mode || '').toUpperCase() === 'EXACT';
  const db = dbFrom(req);

  let rows = parseCsv(req.body);
  if (rows.length > LIMITS.MAX_ROWS) {
    rows = rows.slice(0, LIMITS.MAX_ROWS);
  }

  // Cafe24 회원명부를 일반 gm_member safe-update에 넣어도 자동으로 전용 import로 처리한다.
  // 일반 safe-update는 member_id 컬럼을 찾기 때문에 Cafe24 원본 CSV(아이디/이름/휴대폰번호...)를 그대로 넣으면 MISSING_KEY가 난다.
  if (spec.table === 'gm_member' && rows.some(r => Object.prototype.hasOwnProperty.call(r, '아이디'))) {
    const result = [];
    let processed=0, insertedOrUpdated=0, skipped=0, invalid=0;
    const outCols = ['row_no','member_id','result','member_action','address_action','name','email','phone','mobile','zipcode','address1','address2','member_grade','member_grade_code','deposit_balance','point_balance','refund_account_info','total_order_count','total_purchase_amount','last_login_at','joined_at','reason'];
    try {
      const memberCols = new Set(await getColumns(db, 'gm_member'));
      const addressCols = new Set(await getColumns(db, 'gm_member_address'));
      const client = apply ? await db.connect() : null;
      try {
        if (client) await client.query('BEGIN');
        for (const row of rows) {
          processed++;
          const mapped = mapCafe24Member(row);
          const m = mapped.member;
          const a = mapped.address;
          if (!m.member_id) {
            invalid++; skipped++;
            result.push(cafe24ImportResultRow(row, m, 'SKIP', '', '', 'MISSING_MEMBER_ID'));
            continue;
          }
          const mObj = {};
          for (const [k,v] of Object.entries(m)) if (memberCols.has(k)) mObj[k]=v;
          const aObj = {};
          for (const [k,v] of Object.entries(a)) if (addressCols.has(k)) aObj[k]=v;
          let memberAction = 'VALID_MEMBER';
          let addressAction = (a.zipcode || a.address1 || a.address2) ? 'VALID_ADDRESS' : 'NO_ADDRESS';
          if (apply) {
            const mr = await upsertObject(client, 'gm_member', mObj, ['member_id']);
            memberAction = mr.action;
            if (addressAction !== 'NO_ADDRESS') {
              if (addressCols.has('is_default')) await client.query(`UPDATE gm_member_address SET is_default='N', updated_at=NOW() WHERE member_id=$1`, [m.member_id]);
              const ar = await upsertObject(client, 'gm_member_address', aObj, ['address_id']);
              addressAction = ar.action;
            }
          }
          insertedOrUpdated++;
          result.push(cafe24ImportResultRow(row, m, apply?'APPLIED':'VALID', memberAction, addressAction, apply?'APPLIED':'DRY_RUN'));
        }
        if (client) await client.query('COMMIT');
      } catch(e) {
        if (client) await client.query('ROLLBACK').catch(()=>{});
        throw e;
      } finally {
        if (client) client.release();
      }
      const csv = toCsv(result, outCols);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="cafe24_member_import_${apply?'apply':'dryrun'}_${Date.now()}.csv"`);
      return res.end(csv);
    } catch(e) {
      return fail(res, 500, 'cafe24 member auto import failed', { detail:String(e && e.message || e), processed, insertedOrUpdated, skipped, invalid });
    }
  }

  if (spec.table === 'gm_category') {
    return safeUpdateCategoryBatch(req, res, spec, rows, apply);
  }

  const result = [];
  let processed = 0, updated = 0, skipped = 0, invalid = 0;
  let stopped = '';

  try {
    const columns = await getColumns(db, spec.table);
    const colSet = new Set(columns);
    const columnMeta = exactFileMode ? await getColumnMeta(db, spec.table) : {};
    const client = apply ? await db.connect() : null;

    try {
      if (client) await client.query('BEGIN');

      for (const row of rows) {
        processed++;
        const key = spec.table === 'gm_product' ? pickProductSafeKey(row) : pickKey(row, spec);
        if (!key) {
          invalid++; skipped++;
          result.push(resultRow(row.__row_no, spec.table, '', 'SKIP', '', '', 'MISSING_KEY'));
        } else {
          const where = spec.table === 'gm_product' ? productSafeWhere(key,1) : key.keys.map((k,i)=>`${qIdent(k)}=$${i+1}`).join(' AND ');
          const exist = await (client || db).query(`SELECT 1 FROM ${qIdent(spec.table)} WHERE ${where} LIMIT 1`, key.values);

          if (!exist.rows.length) {
            if (!spec.allowInsert) {
              skipped++;
              result.push(resultRow(row.__row_no, spec.table, key.label, 'SKIP', '', '', 'KEY_NOT_FOUND'));
            } else {
              const insertCols = [];
              const params = [];
              let rowInvalid = false;
              for (const [col, raw] of Object.entries(row)) {
                if (col === '__row_no') continue;
                if (!colSet.has(col)) {
                  skipped++;
                  result.push(resultRow(row.__row_no, spec.table, key.label, 'SKIP_CELL', col, raw, 'UNKNOWN_COLUMN'));
                  continue;
                }
                if ((spec.blocked || []).includes(col)) continue;
                const v = validateCell(col, raw, spec);
                if (!v.ok) {
                  invalid++;
                  rowInvalid = true;
                  result.push(resultRow(row.__row_no, spec.table, key.label, 'SKIP', col, raw, v.reason));
                  break;
                }
                if (v.action === 'KEEP_OLD') continue;
                insertCols.push(col);
                params.push(v.value);
              }
              for (const k of key.keys) {
                if (!insertCols.includes(k) && colSet.has(k)) {
                  insertCols.push(k);
                  params.push(row[k] || '');
                }
              }
              if (!rowInvalid && insertCols.length) {
                if (apply) {
                  const ph = insertCols.map((_,i)=>'$'+(i+1)).join(', ');
                  await client.query(`INSERT INTO ${qIdent(spec.table)} (${insertCols.map(qIdent).join(', ')}) VALUES (${ph})`, params);
                }
                updated++;
                result.push(resultRow(row.__row_no, spec.table, key.label, apply ? 'INSERTED' : 'VALID_INSERT', '', '', apply ? 'APPLIED' : 'DRY_RUN'));
              } else if (!rowInvalid) {
                skipped++;
                result.push(resultRow(row.__row_no, spec.table, key.label, 'SKIP', '', '', 'NO_INSERT_VALUE'));
              }
            }
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
              if (v.action === 'KEEP_OLD') {
                const meta = columnMeta[col];
                if (exactFileMode && meta && String(meta.is_nullable).toUpperCase() === 'YES') {
                  params.push(null);
                  updates.push(`${qIdent(col)}=$${params.length}`);
                }
                continue;
              }

              params.push(v.value);
              updates.push(`${qIdent(col)}=$${params.length}`);
            }

            if (updates.length) {
              if (apply) {
                key.values.forEach(v=>params.push(v));
                const updateWhere = spec.table === 'gm_product'
                  ? productSafeWhere(key, params.length-key.values.length+1)
                  : where.replace(/\$(\d+)/g, (_,n)=>'$'+(params.length-key.values.length+Number(n)));
                await client.query(
                  `UPDATE ${qIdent(spec.table)} SET ${updates.join(', ')} WHERE ${updateWhere}`,
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
