const { VERSION, LIMITS } = require('./config');
const { dbFrom, fail, qIdent } = require('./common');
const { clean, toCsv } = require('./csv');
const { getColumns, pickKey, validateCell } = require('./schema');

// GM_CATEGORY_SAFE_UPDATE_V004_FD_HS_6SEG
// Category CSV policy:
// - gm_code is the only comparison key.
// - Existing rows: blank cells KEEP_OLD, protected/operational columns are ignored,
//   and only values that actually changed are UPDATEd.
// - New gm_code: INSERT is allowed, but gm_code + name_ko are required.
// - Full exported CSV files are accepted without rewriting counters/history/raw_json.
// - Other Builder tables are unaffected; this policy is gm_category-only.

const CATEGORY_EDITABLE = new Set([
  'gm_code','cp_code','gm_parent_code','cp_parent_code','parent_name_ko',
  'depth','leaf_yn','display_yn','sort_order','name_ko',
  'name_en','name_zh','name_vi','name_ja','name_tw','name_th','name_uz','name_ne',
  'name_km','name_id','name_tl','name_mn','name_my','name_kk','name_si','name_ru',
  'name_bn','name_ur','name_lo','name_hi','name_tr','name_fa','name_es','name_fr',
  'keyword_seed','keyword'
]);

function comparable(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date && Number.isFinite(v.getTime())) return v.toISOString();
  return String(v).trim();
}

function valueChanged(currentValue, nextValue) {
  if (typeof nextValue === 'number') {
    const a = Number(currentValue);
    return !Number.isFinite(a) || a !== nextValue;
  }
  return comparable(currentValue) !== comparable(nextValue);
}


function fdHs6SegCodeInfo(code) {
  const m = /^(FD|HS)-\d{2}-\d{3}-\d{4}-\d{4}-\d{4}$/i.exec(clean(code));
  return m ? { prefix:m[1].toUpperCase(), code:clean(code) } : null;
}
function fdHsRowIdentity(row) {
  const cp = clean(row.cp_code);
  const id = clean(row.category_id);
  const gm = clean(row.gm_code);
  if (cp) return { type:'cp_code', value:cp, label:`cp_code=${cp}` };
  if (id) return { type:'category_id', value:id, label:`category_id=${id}` };
  if (gm) return { type:'gm_code', value:gm, label:`gm_code=${gm}` };
  return null;
}
function fdHsMapKey(v){ return clean(v); }

async function loadFdHsExisting(q, rows) {
  const cpCodes = [], ids = [], gmCodes = [];
  for (const row of rows) {
    const cp = clean(row.cp_code), id = clean(row.category_id), gm = clean(row.gm_code);
    if (cp) cpCodes.push(cp);
    if (id) ids.push(id);
    if (gm) gmCodes.push(gm);
  }
  const uniq = a => Array.from(new Set(a.filter(Boolean)));
  const byCp = new Map(), byId = new Map(), byGm = new Map();

  const cps = uniq(cpCodes);
  if (cps.length) {
    const r = await q.query(`SELECT * FROM gm_category WHERE cp_code = ANY($1::text[])`, [cps]);
    for (const x of r.rows) byCp.set(fdHsMapKey(x.cp_code), x);
  }
  const idList = uniq(ids);
  if (idList.length) {
    if (idList.some(v => !/^\d+$/.test(v))) throw new Error('FD_HS_INVALID_CATEGORY_ID');
    const r = await q.query(`SELECT * FROM gm_category WHERE category_id = ANY($1::bigint[])`, [idList]);
    for (const x of r.rows) byId.set(String(x.category_id), x);
  }
  const gms = uniq(gmCodes);
  if (gms.length) {
    const r = await q.query(`SELECT * FROM gm_category WHERE gm_code = ANY($1::text[])`, [gms]);
    for (const x of r.rows) byGm.set(fdHsMapKey(x.gm_code), x);
  }
  return { byCp, byId, byGm };
}

function preflightFdHsRows(rows, maps) {
  if (!rows.length) throw new Error('FD_HS_EMPTY_FILE');
  let prefix = '';
  const seenGm = new Set(), seenCp = new Set(), seenId = new Set(), matchedIds = new Set();
  const plans = [];

  for (const row of rows) {
    const info = fdHs6SegCodeInfo(row.gm_code);
    if (!info) throw new Error(`ROW_${row.__row_no}_NOT_FD_HS_6SEG:${clean(row.gm_code)}`);
    if (!prefix) prefix = info.prefix;
    if (prefix !== info.prefix) throw new Error(`ROW_${row.__row_no}_MIXED_PREFIX:${info.prefix}`);

    const gm = clean(row.gm_code), cp = clean(row.cp_code), id = clean(row.category_id);
    if (seenGm.has(gm)) throw new Error(`ROW_${row.__row_no}_DUP_GM_CODE:${gm}`);
    seenGm.add(gm);
    if (cp) {
      if (seenCp.has(cp)) throw new Error(`ROW_${row.__row_no}_DUP_CP_CODE:${cp}`);
      seenCp.add(cp);
    }
    if (id) {
      if (!/^\d+$/.test(id)) throw new Error(`ROW_${row.__row_no}_INVALID_CATEGORY_ID:${id}`);
      if (seenId.has(id)) throw new Error(`ROW_${row.__row_no}_DUP_CATEGORY_ID:${id}`);
      seenId.add(id);
    }

    const ident = fdHsRowIdentity(row);
    if (!ident) throw new Error(`ROW_${row.__row_no}_MISSING_IDENTITY`);

    let current = null;
    if (cp) {
      current = maps.byCp.get(cp) || null;
      if (id) {
        const byId = maps.byId.get(id) || null;
        if (current && byId && String(current.category_id) !== String(byId.category_id)) {
          throw new Error(`ROW_${row.__row_no}_CP_ID_CONFLICT:cp=${cp},id=${id}`);
        }
        // cp_code is authoritative for real Coupang categories.
        // A nonblank CSV category_id that no longer points to the same DB row is suspicious.
        if (current && !byId) throw new Error(`ROW_${row.__row_no}_CSV_CATEGORY_ID_NOT_FOUND:${id}`);
        if (!current && byId) throw new Error(`ROW_${row.__row_no}_CP_CODE_NOT_FOUND_BUT_ID_EXISTS:cp=${cp},id=${id}`);
      }
    } else if (id) {
      current = maps.byId.get(id) || null;
      if (!current) throw new Error(`ROW_${row.__row_no}_CATEGORY_ID_NOT_FOUND:${id}`);
    } else {
      // New non-Coupang/campaign rows are idempotent by their final gm_code.
      current = maps.byGm.get(gm) || null;
    }

    if (current) {
      const cid = String(current.category_id);
      if (matchedIds.has(cid)) throw new Error(`ROW_${row.__row_no}_DB_ROW_MATCHED_TWICE:${cid}`);
      matchedIds.add(cid);
    }
    plans.push({ row, ident, current, targetGm:gm });
  }

  const targetPlanByExistingId = new Map();
  for (const p of plans) if (p.current) targetPlanByExistingId.set(String(p.current.category_id), p);

  // A target gm_code can be occupied only by the same row, or by another row that is
  // also in this file and will move away inside the same transaction.
  for (const p of plans) {
    const occupant = maps.byGm.get(p.targetGm) || null;
    if (!occupant) continue;
    if (p.current && String(occupant.category_id) === String(p.current.category_id)) continue;
    const occPlan = targetPlanByExistingId.get(String(occupant.category_id)) || null;
    if (!occPlan) throw new Error(`ROW_${p.row.__row_no}_TARGET_GM_CODE_OCCUPIED:${p.targetGm}:category_id=${occupant.category_id}`);
    if (occPlan.targetGm === p.targetGm) throw new Error(`ROW_${p.row.__row_no}_TARGET_GM_CODE_DUP_PLAN:${p.targetGm}`);
  }

  return { prefix, plans };
}

async function safeUpdateCategoryFdHs6Seg(req, res, spec, rows, apply, buildParts) {
  const db = dbFrom(req);
  const table = spec.table;
  const outCols = ['row_no','batch_no','table','key','result','action','column_name','value','reason'];
  const result = [];
  let processed=0, applied=0, inserted=0, updated=0, unchanged=0, skipped=0, invalid=0, failed=0;
  function push(rowNo,key,resultName,action,column,value,reason){
    result.push({row_no:rowNo,batch_no:1,table,key:key||'',result:resultName,action:action||'',column_name:column||'',value:value??'',reason:reason||''});
  }

  let client = null;
  const fdHs6SegMode = String(req.query.fd_hs_6seg || '').toUpperCase() === 'YES';
  if (fdHs6SegMode) {
    if (leafOnly) return fail(res, 400, 'FD/HS 6-segment mode cannot be combined with leaf_only');
    return safeUpdateCategoryFdHs6Seg(req, res, spec, rows, apply, buildParts);
  }

  try {
    const columns = await getColumns(db, table);
    const colSet = new Set(columns);
    const q = apply ? (client = await db.connect()) : db;
    if (client) {
      await client.query('BEGIN');
      // Prevent another category writer from changing identities between preflight and apply.
      await client.query(`LOCK TABLE ${qIdent(table)} IN SHARE ROW EXCLUSIVE MODE`);
    }

    const maps = await loadFdHsExisting(q, rows);
    const pre = preflightFdHsRows(rows, maps);
    console.log(`[GM_CATEGORY_FD_HS_6SEG_V001] start prefix=${pre.prefix} rows=${rows.length} apply=${apply?'Y':'N'}`);

    const changedExisting = pre.plans.filter(p => p.current && clean(p.current.gm_code) !== p.targetGm);
    if (apply && changedExisting.length) {
      const ids = changedExisting.map(p => String(p.current.category_id));
      await client.query(
        `UPDATE ${qIdent(table)}
            SET gm_code='__GM6TMP__'||category_id::text
          WHERE category_id = ANY($1::bigint[])`,
        [ids]
      );
    }

    for (const plan of pre.plans) {
      const row = plan.row;
      processed++;
      const key = {keys:[plan.ident.type], values:[plan.ident.value], label:plan.ident.label};
      const parts = buildParts(row, colSet, key, plan.current);
      if (!parts.ok) {
        invalid++; skipped++;
        push(row.__row_no,key.label,'SKIP','VALIDATE',parts.column,parts.value,parts.reason);
        if (apply) throw new Error(`ROW_${row.__row_no}_${parts.reason}`);
        continue;
      }

      if (plan.current && !parts.updateCols.length) {
        unchanged++;
        push(row.__row_no,key.label,'UNCHANGED','COMPARE','','','NO_CHANGE');
        continue;
      }

      if (!apply) {
        applied++;
        if (plan.current) {
          updated++;
          push(row.__row_no,key.label,'VALID_UPDATE','DRY_RUN','','',`CHANGED_${parts.updateCols.length}`);
        } else {
          inserted++;
          push(row.__row_no,key.label,'VALID_INSERT','DRY_RUN','','','NEW_ROW');
        }
        continue;
      }

      await client.query('SAVEPOINT gm_category_fdhs_row');
      try {
        if (plan.current) {
          const setSql = parts.updateCols.map((c,i)=>`${qIdent(c)}=$${i+1}`).join(', ');
          const params = parts.updateVals.slice();
          params.push(String(plan.current.category_id));
          const ur = await client.query(
            `UPDATE ${qIdent(table)} SET ${setSql}, updated_at=NOW() WHERE category_id=$${params.length}::bigint`,
            params
          );
          if (ur.rowCount !== 1) throw new Error(`UPDATE_ROWCOUNT_${ur.rowCount}`);
          applied++; updated++;
          push(row.__row_no,key.label,'UPDATED','UPDATE_CHANGED_ONLY','','',`APPLIED_${parts.updateCols.length}_COLUMNS`);
        } else {
          if (!parts.insertCols.length) throw new Error('NO_INSERT_VALUE');
          const ph = parts.insertCols.map((_,i)=>'$'+(i+1)).join(', ');
          await client.query(
            `INSERT INTO ${qIdent(table)} (${parts.insertCols.map(qIdent).join(', ')}) VALUES (${ph})`,
            parts.insertVals
          );
          applied++; inserted++;
          push(row.__row_no,key.label,'INSERTED','INSERT','','','APPLIED');
        }
        await client.query('RELEASE SAVEPOINT gm_category_fdhs_row');
      } catch(e) {
        failed++; invalid++;
        try { await client.query('ROLLBACK TO SAVEPOINT gm_category_fdhs_row'); } catch(_e) {}
        try { await client.query('RELEASE SAVEPOINT gm_category_fdhs_row'); } catch(_e) {}
        push(row.__row_no,key.label,'FAIL','DB','','',String(e&&e.message||e));
        // Special conversion is all-or-nothing. Never leave temp gm_code or partial batches.
        throw e;
      }
    }

    if (client) await client.query('COMMIT');
    console.log(`[GM_CATEGORY_FD_HS_6SEG_V001] done prefix=${pre.prefix} processed=${processed} updated=${updated} inserted=${inserted} unchanged=${unchanged} failed=${failed}`);

    const csv = toCsv(result, outCols);
    res.setHeader('Content-Type','text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="gm_category_fdhs_6seg_${apply?'apply':'dryrun'}_${Date.now()}.csv"`);
    res.setHeader('X-GM-Builder-Version', VERSION);
    res.setHeader('X-GM-Category-Processed', String(processed));
    res.setHeader('X-GM-Category-Applied', String(applied));
    res.setHeader('X-GM-Category-Updated', String(updated));
    res.setHeader('X-GM-Category-Inserted', String(inserted));
    res.setHeader('X-GM-Category-Unchanged', String(unchanged));
    res.setHeader('X-GM-FD-HS-6SEG-Prefix', pre.prefix);
    return res.end(csv);
  } catch(e) {
    if (client) {
      try { await client.query('ROLLBACK'); } catch(_e) {}
    }
    return fail(res,500,'FD/HS 6-segment category safe-update failed',{
      detail:String(e&&e.message||e),processed,applied,inserted,updated,unchanged,skipped,invalid,failed
    });
  } finally {
    if (client) client.release();
  }
}


async function safeUpdateCategoryBatch(req, res, spec, rows, apply) {
  const serverManagedColumns = new Set(['updated_at']);
  const leafOnly = String(req.query.leaf_only || '').toUpperCase() === 'YES';
  const db = dbFrom(req);
  const table = spec.table;
  const result = [];
  const outCols = ['row_no','batch_no','table','key','result','action','column_name','value','reason'];
  const batchSize = Math.min(Math.max(Number(req.query.batch || LIMITS.BATCH_SIZE || 300), 50), 1000);
  let processed = 0, applied = 0, inserted = 0, updated = 0, unchanged = 0, skipped = 0, invalid = 0, failed = 0;

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

  // Existing rows are intentionally permissive: blank CSV cells keep DB values.
  // INSERT rows are strict only for the two true required fields.
  function buildParts(row, colSet, key, currentRow) {
    const isInsert = !currentRow;
    const insertCols = [];
    const insertVals = [];
    const updateCols = [];
    const updateVals = [];

    for (const [col, raw] of Object.entries(row)) {
      if (col === '__row_no') continue;
      if (!colSet.has(col)) continue; // full export may contain columns unknown to an older DB
      if ((spec.blocked || []).includes(col) || serverManagedColumns.has(col)) continue;
      if (!CATEGORY_EDITABLE.has(col)) continue; // counters/history/raw_json are never rewritten here
      if (leafOnly && col !== 'leaf_yn' && !(key && key.keys.includes(col))) continue;

      const rawClean = clean(raw);
      if (!isInsert && rawClean === '') continue; // KEEP_OLD; do not reject partial category edits

      const v = validateCell(col, raw, spec);
      if (!v.ok) {
        // For existing rows, an empty critical field is not an error: it simply means KEEP_OLD.
        if (!isInsert && v.reason === 'CRITICAL_EMPTY') continue;
        return { ok:false, column:col, value:raw, reason:v.reason };
      }
      if (v.action === 'KEEP_OLD') continue;

      insertCols.push(col);
      insertVals.push(v.value);

      if (!key.keys.includes(col) && !isInsert && valueChanged(currentRow[col], v.value)) {
        updateCols.push(col);
        updateVals.push(v.value);
      }
    }

    for (const k of key.keys) {
      if (!insertCols.includes(k) && colSet.has(k)) {
        insertCols.push(k);
        insertVals.push(clean(row[k]));
      }
    }

    if (isInsert) {
      if (!clean(row.gm_code)) return { ok:false, column:'gm_code', value:row.gm_code, reason:'MISSING_KEY' };
      if (!clean(row.name_ko)) return { ok:false, column:'name_ko', value:row.name_ko, reason:'CRITICAL_EMPTY' };
    }

    return { ok:true, insertCols, insertVals, updateCols, updateVals };
  }

  try {
    const columns = await getColumns(db, table);
    const colSet = new Set(columns);
    console.log(`[GM_CATEGORY_BATCH_IMPORT_V003] start rows=${rows.length} apply=${apply ? 'Y':'N'} leafOnly=${leafOnly ? 'Y':'N'} batch=${batchSize}`);

    for (let start = 0; start < rows.length; start += batchSize) {
      const batch = rows.slice(start, start + batchSize);
      const batchNo = Math.floor(start / batchSize) + 1;
      const batchTotal = Math.ceil(rows.length / batchSize);
      const client = apply ? await db.connect() : null;
      const q = client || db;

      console.log(`[GM_CATEGORY_BATCH_IMPORT_V003] batch ${batchNo}/${batchTotal} rows=${batch.length} range=${start+1}-${start+batch.length}`);

      try {
        if (client) await client.query('BEGIN');

        // One lookup per batch instead of one SELECT per row.
        const codeList = [];
        for (const row of batch) {
          const code = clean(row.gm_code);
          if (code) codeList.push(code);
        }
        const existingMap = new Map();
        if (codeList.length) {
          const er = await q.query(`SELECT * FROM ${qIdent(table)} WHERE gm_code = ANY($1::text[])`, [Array.from(new Set(codeList))]);
          for (const r of er.rows) existingMap.set(clean(r.gm_code), r);
        }

        for (const row of batch) {
          processed++;
          const key = pickKey(row, spec);
          if (!key) {
            invalid++; skipped++;
            push(row.__row_no, batchNo, '', 'SKIP', '', 'gm_code', '', 'MISSING_KEY');
            continue;
          }

          const currentRow = existingMap.get(clean(row.gm_code)) || null;
          const parts = buildParts(row, colSet, key, currentRow);
          if (!parts.ok) {
            invalid++; skipped++;
            push(row.__row_no, batchNo, key.label, 'SKIP', '', parts.column, parts.value, parts.reason);
            continue;
          }

          if (currentRow && !parts.updateCols.length) {
            unchanged++;
            push(row.__row_no, batchNo, key.label, 'UNCHANGED', 'COMPARE', '', '', 'NO_CHANGE');
            continue;
          }

          if (!apply) {
            applied++;
            push(row.__row_no, batchNo, key.label, currentRow ? 'VALID_UPDATE' : 'VALID_INSERT', 'DRY_RUN', '', '', currentRow ? `CHANGED_${parts.updateCols.length}` : 'NEW_GM_CODE');
            continue;
          }

          try {
            await client.query('SAVEPOINT gm_category_row');

            if (currentRow) {
              const setSql = parts.updateCols.map((c,i)=>`${qIdent(c)}=$${i+1}`).join(', ');
              const params = parts.updateVals.slice();
              params.push(key.values[0]);
              const serverTouchSql = parts.updateCols.length === 1 && parts.updateCols[0] === 'last_search_at' ? '' : ', updated_at=NOW()';
              const ur = await client.query(
                `UPDATE ${qIdent(table)} SET ${setSql}${serverTouchSql} WHERE gm_code=$${params.length}`,
                params
              );
              if (ur.rowCount !== 1) throw new Error(`UPDATE_ROWCOUNT_${ur.rowCount}`);
              applied++; updated++;
              push(row.__row_no, batchNo, key.label, 'UPDATED', 'UPDATE_CHANGED_ONLY', '', '', `APPLIED_${parts.updateCols.length}_COLUMNS`);
            } else {
              if (!parts.insertCols.length) throw new Error('NO_INSERT_VALUE');
              const ph = parts.insertCols.map((_,i)=>'$'+(i+1)).join(', ');
              await client.query(`INSERT INTO ${qIdent(table)} (${parts.insertCols.map(qIdent).join(', ')}) VALUES (${ph})`, parts.insertVals);
              applied++; inserted++;
              push(row.__row_no, batchNo, key.label, 'INSERTED', 'INSERT', '', '', 'APPLIED');
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

    console.log(`[GM_CATEGORY_BATCH_IMPORT_V003] done processed=${processed} applied=${applied} inserted=${inserted} updated=${updated} unchanged=${unchanged} skipped=${skipped} invalid=${invalid} failed=${failed}`);
    const csv = toCsv(result, outCols);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="gm_category_batch_${apply?'apply':'dryrun'}_${Date.now()}.csv"`);
    res.setHeader('X-GM-Builder-Version', VERSION);
    res.setHeader('X-GM-Category-Processed', String(processed));
    res.setHeader('X-GM-Category-Applied', String(applied));
    res.setHeader('X-GM-Category-Unchanged', String(unchanged));
    res.end(csv);
  } catch(e) {
    fail(res, 500, 'category batch import failed', {
      detail:String(e && e.message || e), processed, applied, inserted, updated, unchanged, skipped, invalid, failed
    });
  }
}

module.exports = { safeUpdateCategoryBatch };
