'use strict';
// GM_BUILDER_IMAGE_VECTOR_CATEGORY_GROUP_V003
//
// PURPOSE
//   Import ONLY: product_uid,category_group -> gm_product_image_vector.category_group
//
// OWNERSHIP / SAFETY
//   - This route is independent from generic safe_update.js.
//   - UPDATE existing vector rows only; never INSERT vector rows.
//   - Never changes vector_image, candidate_vector, class_id, or other columns.
//   - Accepts up to 200,000 input rows so a 100k+ vector partition can be uploaded
//     as one source file.
//   - DB work is set-based and split into 10,000-row batches. No per-row SQL loop.
//   - Duplicate product_uid and malformed category_group are rejected per row.
//
// REQUEST
//   POST /api/gm/builder/image-vector/category-group/import?apply=YES|NO
//   Content-Type: text/csv
//   Header must contain exactly: product_uid,category_group

const express = require('express');
const router = express.Router();
const { dbFrom, parseCsv } = require('../core');

const VERSION = 'GM_BUILDER_IMAGE_VECTOR_CATEGORY_GROUP_V003';
const MAX_ROWS = 200000;
const BATCH_ROWS = 10000;

function clean(v){ return String(v == null ? '' : v).trim(); }
function elapsedMs(start){ return Date.now() - start; }

router.post(
  '/api/gm/builder/image-vector/category-group/import',
  express.text({ type:['text/*','application/csv'], limit:'100mb' }),
  async (req,res)=>{
    const started = Date.now();
    const apply = String(req.query.apply || '').toUpperCase() === 'YES';
    const db = dbFrom(req);

    let rows;
    try {
      rows = parseCsv(req.body);
    } catch (e) {
      return res.status(400).json({ ok:false, version:VERSION, error:'CSV_PARSE_FAILED', detail:String(e && e.message || e) });
    }

    if (!rows.length) return res.status(400).json({ ok:false, version:VERSION, error:'NO_ROWS' });
    if (rows.length > MAX_ROWS) {
      return res.status(400).json({ ok:false, version:VERSION, error:'TOO_MANY_ROWS', input_rows:rows.length, limit:MAX_ROWS });
    }

    // Keep this importer narrow. Extra columns often mean the wrong export file was selected.
    const sourceCols = Object.keys(rows[0] || {}).filter(k=>k !== '__row_no');
    const expected = ['product_uid','category_group'];
    const normalizedCols = sourceCols.map(x=>String(x).trim().toLowerCase());
    const badHeader = expected.some(x=>!normalizedCols.includes(x)) || normalizedCols.some(x=>!expected.includes(x));
    if (badHeader) {
      return res.status(400).json({ ok:false, version:VERSION, error:'INVALID_COLUMNS', expected, received:sourceCols });
    }

    const seen = new Set();
    const valid = [];
    const issues = [];

    for (const row of rows) {
      const uid = clean(row.product_uid);
      const group = clean(row.category_group).toUpperCase();
      const rowNo = row.__row_no || '';

      if (!uid) {
        issues.push({ row_no:rowNo, product_uid:'', reason:'MISSING_PRODUCT_UID' });
        continue;
      }
      if (!/^[A-Z]{2}$/.test(group)) {
        issues.push({ row_no:rowNo, product_uid:uid, reason:'INVALID_CATEGORY_GROUP' });
        continue;
      }
      if (seen.has(uid)) {
        issues.push({ row_no:rowNo, product_uid:uid, reason:'DUPLICATE_PRODUCT_UID' });
        continue;
      }
      seen.add(uid);
      valid.push({ rowNo, uid, group });
    }

    if (!valid.length) {
      return res.status(400).json({ ok:false, version:VERSION, error:'NO_VALID_ROWS', input_rows:rows.length, invalid:issues.length, issues:issues.slice(0,100) });
    }

    console.log(`[${VERSION}] START`, JSON.stringify({ apply, input_rows:rows.length, valid:valid.length, invalid:issues.length, batch_rows:BATCH_ROWS }));

    let matched = 0;
    let updated = 0;
    let unchanged = 0;
    let notFound = 0;
    const batchCount = Math.ceil(valid.length / BATCH_ROWS);

    try {
      for (let offset=0, batchNo=1; offset<valid.length; offset+=BATCH_ROWS, batchNo++) {
        const part = valid.slice(offset, offset + BATCH_ROWS);
        const uids = part.map(x=>x.uid);
        const groups = part.map(x=>x.group);
        const client = await db.connect();
        const batchStarted = Date.now();

        try {
          if (apply) await client.query('BEGIN');

          // One set-based lookup for the whole batch. Used for matched/unchanged counts.
          const found = await client.query(
            `SELECT product_uid, BTRIM(category_group::text) AS category_group
               FROM gm_product_image_vector
              WHERE product_uid = ANY($1::text[])`,
            [uids]
          );
          const oldByUid = new Map(found.rows.map(r=>[String(r.product_uid), clean(r.category_group).toUpperCase()]));
          const batchMatched = found.rows.length;
          let batchUnchanged = 0;
          for (const x of part) {
            if (oldByUid.has(x.uid) && oldByUid.get(x.uid) === x.group) batchUnchanged++;
          }

          let batchUpdated = 0;
          if (apply) {
            const q = await client.query(
              `UPDATE gm_product_image_vector v
                  SET category_group = x.category_group::char(2)
                 FROM UNNEST($1::text[], $2::text[]) AS x(product_uid, category_group)
                WHERE v.product_uid = x.product_uid
                  AND v.category_group IS DISTINCT FROM x.category_group::char(2)`,
              [uids, groups]
            );
            batchUpdated = q.rowCount || 0;
            await client.query('COMMIT');
          }

          matched += batchMatched;
          unchanged += batchUnchanged;
          updated += batchUpdated;
          notFound += part.length - batchMatched;

          console.log(`[${VERSION}] BATCH`, JSON.stringify({
            apply, batch:batchNo, batches:batchCount, rows:part.length,
            matched:batchMatched, updated:batchUpdated, unchanged:batchUnchanged,
            not_found:part.length-batchMatched, elapsed_ms:elapsedMs(batchStarted)
          }));
        } catch (e) {
          if (apply) await client.query('ROLLBACK').catch(()=>{});
          throw e;
        } finally {
          client.release();
        }
      }

      const result = {
        ok:true,
        version:VERSION,
        apply,
        input_rows:rows.length,
        valid:valid.length,
        invalid:issues.length,
        matched,
        not_found:notFound,
        updated,
        unchanged,
        batch_rows:BATCH_ROWS,
        batches:batchCount,
        elapsed_ms:elapsedMs(started),
        issues:issues.slice(0,100)
      };
      console.log(`[${VERSION}] COMPLETE`, JSON.stringify(result));
      return res.json(result);
    } catch (e) {
      const detail = String(e && e.message || e);
      console.error(`[${VERSION}] FAILED`, JSON.stringify({ apply, detail, elapsed_ms:elapsedMs(started) }));
      return res.status(500).json({ ok:false, version:VERSION, error:'VECTOR_CATEGORY_GROUP_IMPORT_FAILED', detail, elapsed_ms:elapsedMs(started) });
    }
  }
);

module.exports = router;
