const { VERSION, LIMITS } = require('./config');
const { dbFrom, fail, qIdent } = require('./common');
const { clean, toCsv } = require('./csv');
const { getColumns, pickKey, validateCell } = require('./schema');
async function safeUpdateCategoryBatch(req, res, spec, rows, apply) {
  // updated_at is owned by the server for this batch route.
  // Keep this guard here as well as config.blocked so an uploaded file can
  // never generate both `updated_at=$n` and `updated_at=NOW()` in one UPDATE.
  const serverManagedColumns = new Set(['updated_at']);
  const leafOnly = String(req.query.leaf_only || '').toUpperCase() === 'YES';
  const db = dbFrom(req);
  const table = spec.table;
  const result = [];
  const outCols = ['row_no','batch_no','table','key','result','action','column_name','value','reason'];
  const batchSize = Math.min(Math.max(Number(req.query.batch || LIMITS.BATCH_SIZE || 300), 50), 1000);
  let processed = 0, applied = 0, inserted = 0, updated = 0, skipped = 0, invalid = 0, failed = 0;

  function push(rowNo, batchNo, key, resultName, action, column, value, reason) {
    result.push({
      row_no: rowNo,
      batch_no: batchNo,
      table,
      key: key || '',
      result: resultName,
      action: action || '',
      column_name: column || '',
      value: value ?? '',
      reason: reason || ''
    });
  }

  function buildRowParts(row, colSet, key) {
    const insertCols = [];
    const insertVals = [];
    const updateCols = [];
    const updateVals = [];
    for (const [col, raw] of Object.entries(row)) {
      if (col === '__row_no') continue;
      if (!colSet.has(col)) {
        push(row.__row_no, '', key && key.label, 'SKIP_CELL', '', col, raw, 'UNKNOWN_COLUMN');
        continue;
      }
      if ((spec.blocked || []).includes(col) || serverManagedColumns.has(col)) continue;
      if (leafOnly && col !== 'leaf_yn' && !(key && key.keys.includes(col))) continue;
      const v = validateCell(col, raw, spec);
      if (!v.ok) return { ok:false, column:col, value:raw, reason:v.reason };
      if (v.action === 'KEEP_OLD') continue;
      insertCols.push(col);
      insertVals.push(v.value);
      if (!key.keys.includes(col)) {
        updateCols.push(col);
        updateVals.push(v.value);
      }
    }
    // 키 컬럼은 INSERT에 반드시 포함한다.
    for (const k of key.keys) {
      if (!insertCols.includes(k) && colSet.has(k)) {
        insertCols.push(k);
        insertVals.push(clean(row[k]));
      }
    }
    return { ok:true, insertCols, insertVals, updateCols, updateVals };
  }

  try {
    const columns = await getColumns(db, table);
    const colSet = new Set(columns);
    console.log(`[GM_CATEGORY_BATCH_IMPORT] start rows=${rows.length} apply=${apply ? 'Y':'N'} leafOnly=${leafOnly ? 'Y':'N'} batch=${batchSize}`);

    for (let start = 0; start < rows.length; start += batchSize) {
      const batch = rows.slice(start, start + batchSize);
      const batchNo = Math.floor(start / batchSize) + 1;
      const batchTotal = Math.ceil(rows.length / batchSize);
      const client = apply ? await db.connect() : null;
      console.log(`[GM_CATEGORY_BATCH_IMPORT] batch ${batchNo}/${batchTotal} rows=${batch.length} range=${start+1}-${start+batch.length}`);

      try {
        if (client) await client.query('BEGIN');

        for (const row of batch) {
          processed++;
          const key = pickKey(row, spec);
          if (!key) {
            invalid++; skipped++;
            push(row.__row_no, batchNo, '', 'SKIP', '', '', '', 'MISSING_KEY');
            continue;
          }

          const parts = buildRowParts(row, colSet, key);
          if (!parts.ok) {
            invalid++; skipped++;
            push(row.__row_no, batchNo, key.label, 'SKIP', '', parts.column, parts.value, parts.reason);
            continue;
          }
          if (!parts.insertCols.length && !parts.updateCols.length) {
            skipped++;
            push(row.__row_no, batchNo, key.label, 'SKIP', '', '', '', 'NO_UPDATABLE_VALUE');
            continue;
          }

          if (!apply) {
            applied++;
            push(row.__row_no, batchNo, key.label, 'VALID', 'DRY_RUN', '', '', 'BATCH_VALID');
            continue;
          }

          try {
            await client.query('SAVEPOINT gm_category_row');
            const where = key.keys.map((k,i)=>`${qIdent(k)}=$${i+1}`).join(' AND ');
            const exists = await client.query(
              leafOnly
                ? `SELECT leaf_yn FROM ${qIdent(table)} WHERE ${where} LIMIT 1`
                : `SELECT 1 FROM ${qIdent(table)} WHERE ${where} LIMIT 1`,
              key.values
            );

            if (exists.rows.length) {
              if (leafOnly) {
                const expectedLeaf = String(row.leaf_yn || '').trim().toUpperCase();
                const currentLeaf = String(exists.rows[0] && exists.rows[0].leaf_yn || '').trim().toUpperCase();
                if (!expectedLeaf || !['Y','N'].includes(expectedLeaf)) {
                  invalid++; skipped++;
                  push(row.__row_no, batchNo, key.label, 'SKIP', 'LEAF_VERIFY', 'leaf_yn', expectedLeaf, `INVALID_LEAF_VALUE_${expectedLeaf}`);
                  await client.query('RELEASE SAVEPOINT gm_category_row');
                  continue;
                }
                if (currentLeaf === expectedLeaf) {
                  skipped++;
                  push(row.__row_no, batchNo, key.label, 'UNCHANGED', 'LEAF_VERIFY', 'leaf_yn', expectedLeaf, 'ALREADY_MATCHED');
                  await client.query('RELEASE SAVEPOINT gm_category_row');
                  continue;
                }
              }
              if (!parts.updateCols.length) {
                skipped++;
                push(row.__row_no, batchNo, key.label, 'SKIP', 'UPDATE', '', '', 'NO_UPDATABLE_VALUE');
              } else {
                const setSql = parts.updateCols.map((c,i)=>`${qIdent(c)}=$${i+1}`).join(', ');
                const params = parts.updateVals.slice();
                key.values.forEach(v => params.push(v));
                const where2 = key.keys.map((k,i)=>`${qIdent(k)}=$${parts.updateVals.length+i+1}`).join(' AND ');
                const ur = await client.query(`UPDATE ${qIdent(table)} SET ${setSql}, updated_at=NOW() WHERE ${where2} RETURNING leaf_yn`, params);
                if (ur.rowCount !== 1) throw new Error(`UPDATE_ROWCOUNT_${ur.rowCount}`);
                if (leafOnly) {
                  const expectedLeaf = String(row.leaf_yn || '').trim().toUpperCase();
                  const actualLeaf = String(ur.rows[0] && ur.rows[0].leaf_yn || '').trim().toUpperCase();
                  if (!expectedLeaf || !['Y','N'].includes(expectedLeaf)) throw new Error(`INVALID_LEAF_VALUE_${expectedLeaf}`);
                  if (actualLeaf !== expectedLeaf) throw new Error(`LEAF_VERIFY_FAIL_expected_${expectedLeaf}_actual_${actualLeaf}`);
                }
                applied++; updated++;
                push(row.__row_no, batchNo, key.label, 'UPDATED', leafOnly ? 'LEAF_UPDATE' : 'UPDATE', leafOnly ? 'leaf_yn' : '', leafOnly ? String(row.leaf_yn || '').trim() : '', 'APPLIED_VERIFIED');
              }
            } else {
              if (leafOnly) {
                skipped++;
                push(row.__row_no, batchNo, key.label, 'SKIP', 'LEAF_VERIFY', 'leaf_yn', String(row.leaf_yn || '').trim(), 'KEY_NOT_FOUND_NO_INSERT');
              } else {
                const ph = parts.insertCols.map((_,i)=>'$'+(i+1)).join(', ');
                await client.query(`INSERT INTO ${qIdent(table)} (${parts.insertCols.map(qIdent).join(', ')}) VALUES (${ph})`, parts.insertVals);
                applied++; inserted++;
                push(row.__row_no, batchNo, key.label, 'INSERTED', 'INSERT', '', '', 'APPLIED');
              }
            }
            await client.query('RELEASE SAVEPOINT gm_category_row');
          } catch (e) {
            failed++; invalid++;
            try { await client.query('ROLLBACK TO SAVEPOINT gm_category_row'); } catch(_e) {}
            try { await client.query('RELEASE SAVEPOINT gm_category_row'); } catch(_e) {}
            push(row.__row_no, batchNo, key.label, 'FAIL', 'DB', '', '', String(e && e.message || e));
          }
        }

        if (client) await client.query('COMMIT');
      } catch (e) {
        if (client) await client.query('ROLLBACK').catch(()=>{});
        throw e;
      } finally {
        if (client) client.release();
      }
    }

    console.log(`[GM_CATEGORY_BATCH_IMPORT] done processed=${processed} applied=${applied} inserted=${inserted} updated=${updated} skipped=${skipped} invalid=${invalid} failed=${failed}`);
    const csv = toCsv(result, outCols);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="gm_category_batch_${apply?'apply':'dryrun'}_${Date.now()}.csv"`);
    res.setHeader('X-GM-Builder-Version', VERSION);
    res.setHeader('X-GM-Category-Processed', String(processed));
    res.setHeader('X-GM-Category-Applied', String(applied));
    res.end(csv);
  } catch(e) {
    fail(res, 500, 'category batch import failed', {
      detail:String(e && e.message || e), processed, applied, inserted, updated, skipped, invalid, failed
    });
  }
}




module.exports = { safeUpdateCategoryBatch };
