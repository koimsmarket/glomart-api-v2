const express = require('express');
const router = express.Router();

// GM_BUILDER_SAFE_UPDATE_V022_BATCH_UPDATE
// Generic table safe-update only.
// IMPORTANT: domain-specific jobs (image vector, device language, etc.) must NOT be added here.
// This file owns generic CSV validation/update behavior only.
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
function pickCategoryKeywordSafeKey(row){
  const keyword=cleanProductKey(row.keyword_normalized);
  if(!keyword) return null;
  const lang=cleanProductKey(row.lang_code);
  const country=cleanProductKey(row.country_code);
  const categoryNo=cleanProductKey(row.category_no);
  return {
    keys:['keyword_normalized','lang_code','country_code','category_no'],
    values:[keyword,lang,country,categoryNo],
    label:[keyword,lang,country,categoryNo].join('+'),
    blankComparable:new Set(['lang_code','country_code','category_no'])
  };
}
function safeKeyWhere(key,startIndex=1){
  return key.keys.map((k,i)=> key.blankComparable && key.blankComparable.has(k)
    ? `COALESCE(${qIdent(k)}::text,'')=$${startIndex+i}`
    : `${qIdent(k)}=$${startIndex+i}`).join(' AND ');
}


// GM_BUILDER_SAFE_UPDATE_V022_BATCH_UPDATE
// Existing-row UPDATE tables are processed in DB batches instead of one SELECT + one UPDATE per CSV row.
// INSERT-capable tables keep the legacy path because their row-level insert/update semantics are different.
const SAFE_UPDATE_BATCH_SIZE=Math.max(50,Math.min(1000,Number(process.env.GM_SAFE_UPDATE_BATCH_SIZE||500)||500));
function chunksOf(arr,size){ const out=[]; for(let i=0;i<arr.length;i+=size) out.push(arr.slice(i,i+size)); return out; }
function batchKeyId(key){ return JSON.stringify((key&&key.values||[]).map(v=>String(v==null?'':v))); }
function batchGroupKey(key){
  const blank=key&&key.blankComparable?Array.from(key.blankComparable).sort():[];
  return JSON.stringify({keys:key&&key.keys||[],blank});
}
function pgCastType(meta){
  if(!meta) return '';
  const t=String(meta.data_type||'').toLowerCase();
  const u=String(meta.udt_name||'').toLowerCase();
  if(t==='text'||t==='character varying'||t==='character') return 'text';
  if(t==='smallint'||u==='int2') return 'smallint';
  if(t==='integer'||u==='int4') return 'integer';
  if(t==='bigint'||u==='int8') return 'bigint';
  if(t==='numeric'||t==='decimal'||u==='numeric') return 'numeric';
  if(t==='real'||u==='float4') return 'real';
  if(t==='double precision'||u==='float8') return 'double precision';
  if(t==='boolean'||u==='bool') return 'boolean';
  if(t==='date') return 'date';
  if(t==='timestamp without time zone') return 'timestamp';
  if(t==='timestamp with time zone') return 'timestamptz';
  if(t==='json') return 'json';
  if(t==='jsonb'||u==='jsonb') return 'jsonb';
  if(t==='uuid'||u==='uuid') return 'uuid';
  return '';
}
function batchKeyForRow(row,spec){
  return spec.table==='gm_product' ? pickProductSafeKey(row)
    : (spec.table==='gm_category_keyword' ? pickCategoryKeywordSafeKey(row) : pickKey(row,spec));
}
function batchJoinSql(key,aliasT='t',aliasV='v'){
  return key.keys.map((k,i)=> key.blankComparable&&key.blankComparable.has(k)
    ? `COALESCE(${aliasT}.${qIdent(k)}::text,'')=COALESCE(${aliasV}.${qIdent('k'+i)},'')`
    : `${aliasT}.${qIdent(k)}::text=${aliasV}.${qIdent('k'+i)}`).join(' AND ');
}
function batchValue(v){ return v===null||v===undefined ? null : String(v); }
async function tryBatchExistingOnly(db,spec,rows,apply,exactFileMode){
  if(spec.allowInsert) return null;
  const columns=await getColumns(db,spec.table);
  const colSet=new Set(columns);
  const columnMeta=await getColumnMeta(db,spec.table);
  const localResult=[];
  let processed=0,updated=0,skipped=0,invalid=0,stopped='';
  const plans=[];
  const seen=new Set();

  for(const row of rows){
    processed++;
    const key=batchKeyForRow(row,spec);
    if(!key){
      invalid++; skipped++;
      localResult.push(resultRow(row.__row_no,spec.table,'','SKIP','','','MISSING_KEY'));
    }else{
      const dup=batchGroupKey(key)+'|'+batchKeyId(key);
      if(seen.has(dup)) return null; // preserve legacy sequential semantics for duplicate keys
      seen.add(dup);
      const updateCols=[];
      const updateVals=[];
      let rowInvalid=false;
      let unsupported=false;
      for(const [col,raw] of Object.entries(row)){
        if(col==='__row_no') continue;
        if(!colSet.has(col)){
          skipped++;
          localResult.push(resultRow(row.__row_no,spec.table,key.label,'SKIP_CELL',col,raw,'UNKNOWN_COLUMN'));
          continue;
        }
        if(key.keys.includes(col)) continue;
        if((spec.blocked||[]).includes(col)) continue;
        const v=validateCell(col,raw,spec);
        if(!v.ok){
          invalid++; rowInvalid=true;
          localResult.push(resultRow(row.__row_no,spec.table,key.label,'SKIP',col,raw,v.reason));
          break;
        }
        if(v.action==='KEEP_OLD'){
          const meta=columnMeta[col];
          if(exactFileMode&&meta&&String(meta.is_nullable).toUpperCase()==='YES'){
            if(!pgCastType(meta)){ unsupported=true; break; }
            updateCols.push(col); updateVals.push(null);
          }
          continue;
        }
        if(!pgCastType(columnMeta[col])){ unsupported=true; break; }
        updateCols.push(col); updateVals.push(v.value);
      }
      if(unsupported) return null;
      if(!rowInvalid){
        if(updateCols.length){ plans.push({row,key,updateCols,updateVals,planId:plans.length}); }
        else if(!localResult.find(r=>r.row_no===row.__row_no&&r.result==='SKIP')){
          skipped++;
          localResult.push(resultRow(row.__row_no,spec.table,key.label,'SKIP','','','NO_UPDATABLE_VALUE'));
        }
      }
    }
    stopped=shouldStop(invalid,processed);
    if(stopped){
      localResult.push(resultRow(row.__row_no,spec.table,'','STOPPED','','',stopped));
      break;
    }
  }

  const client=apply?await db.connect():null;
  const q=client||db;
  const existing=new Set();
  let selectBatches=0,updateBatches=0;
  try{
    if(client) await client.query('BEGIN');
    const keyGroups=new Map();
    for(const plan of plans){
      const g=batchGroupKey(plan.key);
      if(!keyGroups.has(g)) keyGroups.set(g,[]);
      keyGroups.get(g).push(plan);
    }
    for(const group of keyGroups.values()){
      const sample=group[0].key;
      for(const part of chunksOf(group,SAFE_UPDATE_BATCH_SIZE)){
        selectBatches++;
        const payload=part.map(p=>{
          const x={__i:p.planId}; p.key.values.forEach((v,i)=>x['k'+i]=String(v==null?'':v)); return x;
        });
        const defs=['"__i" integer'].concat(sample.keys.map((_,i)=>`${qIdent('k'+i)} text`)).join(', ');
        const sql=`WITH v AS (SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(${defs})) SELECT v."__i" FROM v JOIN ${qIdent(spec.table)} t ON ${batchJoinSql(sample,'t','v')}`;
        const r=await q.query(sql,[JSON.stringify(payload)]);
        for(const x of r.rows) existing.add(Number(x.__i));
      }
    }

    const updateGroups=new Map();
    for(const plan of plans){
      if(!existing.has(plan.planId)){
        skipped++;
        localResult.push(resultRow(plan.row.__row_no,spec.table,plan.key.label,'SKIP','','','KEY_NOT_FOUND'));
        continue;
      }
      const sig=JSON.stringify({kg:batchGroupKey(plan.key),cols:plan.updateCols});
      if(!updateGroups.has(sig)) updateGroups.set(sig,[]);
      updateGroups.get(sig).push(plan);
    }

    for(const group of updateGroups.values()){
      const sample=group[0];
      if(apply){
        for(const part of chunksOf(group,SAFE_UPDATE_BATCH_SIZE)){
          updateBatches++;
          const payload=part.map(p=>{
            const x={__i:p.planId};
            p.key.values.forEach((v,i)=>x['k'+i]=String(v==null?'':v));
            p.updateVals.forEach((v,i)=>x['u'+i]=batchValue(v));
            return x;
          });
          const defs=['"__i" integer']
            .concat(sample.key.keys.map((_,i)=>`${qIdent('k'+i)} text`))
            .concat(sample.updateCols.map((_,i)=>`${qIdent('u'+i)} text`)).join(', ');
          const setSql=sample.updateCols.map((col,i)=>`${qIdent(col)}=v.${qIdent('u'+i)}::${pgCastType(columnMeta[col])}`).join(', ');
          const sql=`WITH v AS (SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(${defs})) UPDATE ${qIdent(spec.table)} t SET ${setSql} FROM v WHERE ${batchJoinSql(sample.key,'t','v')}`;
          const r=await client.query(sql,[JSON.stringify(payload)]);
          if(Number(r.rowCount)!==part.length) throw new Error(`BATCH_ROWCOUNT_MISMATCH expected=${part.length} actual=${r.rowCount}`);
        }
      }
      for(const plan of group){
        updated++;
        localResult.push(resultRow(plan.row.__row_no,spec.table,plan.key.label,apply?'UPDATED':'VALID_UPDATE','','',apply?'APPLIED':'DRY_RUN'));
      }
    }
    if(client) await client.query('COMMIT');
  }catch(e){
    if(client) await client.query('ROLLBACK').catch(()=>{});
    throw e;
  }finally{
    if(client) client.release();
  }
  localResult.sort((a,b)=>Number(a.row_no||0)-Number(b.row_no||0));
  return {result:localResult,processed,updated,skipped,invalid,stopped,selectBatches,updateBatches,batchSize:SAFE_UPDATE_BATCH_SIZE};
}

router.post('/api/gm/builder/safe-update', express.text({ type:['text/*','application/csv'], limit:'100mb' }), async (req,res)=>{
  const spec = tableSpec(req.query.table);
  if (!spec) return fail(res, 400, 'invalid table');
  // gm_product_image_vector is managed only by the image-vector domain service.
  // Generic CSV writes would bypass representative assignment / mutation locking.
  if (spec.table === 'gm_product_image_vector') return fail(res,409,'IMAGE_VECTOR_DOMAIN_WRITE_ONLY',{detail:'Use /api/gm/image-vector/upsert or image-vector Builder domain operations.'});

  const apply = String(req.query.apply || '').toUpperCase() === 'YES';
  const exactFileMode = String(req.query.file_mode || '').toUpperCase() === 'EXACT';
  const db = dbFrom(req);

  let rows = parseCsv(req.body);
  // Never truncate silently. A partial APPLY is more dangerous than a visible error.
  if (rows.length > LIMITS.MAX_ROWS) {
    return fail(res, 400, 'too many rows', { input_rows: rows.length, limit: LIMITS.MAX_ROWS });
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
    // Fast path: update-only tables use batched existence checks + batched UPDATEs.
    // If the request contains duplicate keys or an unsupported DB type, fall back to the legacy row-by-row path.
    const batch = await tryBatchExistingOnly(db, spec, rows, apply, exactFileMode);
    if (batch) {
      const cols = ['row_no','table','key','result','column_name','value','reason'];
      const csv = toCsv(batch.result, cols);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="gm_safe_update_result_${Date.now()}.csv"`);
      res.setHeader('X-GM-Safe-Update-Mode','BATCH');
      res.setHeader('X-GM-Safe-Update-Batch-Size',String(batch.batchSize));
      res.setHeader('X-GM-Safe-Update-Select-Batches',String(batch.selectBatches));
      res.setHeader('X-GM-Safe-Update-Update-Batches',String(batch.updateBatches));
      return res.end(csv);
    }

    const columns = await getColumns(db, spec.table);
    const colSet = new Set(columns);
    const columnMeta = exactFileMode ? await getColumnMeta(db, spec.table) : {};
    const client = apply ? await db.connect() : null;

    try {
      if (client) await client.query('BEGIN');

      for (const row of rows) {
        processed++;
        const key = spec.table === 'gm_product' ? pickProductSafeKey(row) : (spec.table === 'gm_category_keyword' ? pickCategoryKeywordSafeKey(row) : pickKey(row, spec));
        if (!key) {
          invalid++; skipped++;
          result.push(resultRow(row.__row_no, spec.table, '', 'SKIP', '', '', 'MISSING_KEY'));
        } else {
          const where = spec.table === 'gm_product' ? productSafeWhere(key,1) : (spec.table === 'gm_category_keyword' ? safeKeyWhere(key,1) : key.keys.map((k,i)=>`${qIdent(k)}=$${i+1}`).join(' AND '));
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
                const startKeyParam=params.length-key.values.length+1;
                const updateWhere = spec.table === 'gm_product'
                  ? productSafeWhere(key, startKeyParam)
                  : (spec.table === 'gm_category_keyword' ? safeKeyWhere(key,startKeyParam) : where.replace(/\$(\d+)/g, (_,n)=>'$'+(params.length-key.values.length+Number(n))));
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
