'use strict';
// GM_UI_DICTIONARY_AUTO_V009_RUNTIME_500_FIX
const express=require('express');
const crypto=require('crypto');
const fs=require('fs');
const path=require('path');
const router=express.Router();
const {dbFrom}=require('./core');
const uiV2=require('../../services/multilingual/ui/ui_dictionary_v2');

function s(v){return String(v==null?'':v).replace(/\s+/g,' ').trim();}
function hasKo(v){return /[가-힣]/.test(String(v||''));}
// UI dictionary runtime capture is only enabled for derzon; no DB access for others.
function captureAllowed(req){return s((req.body||{}).member_id||'')==='derzon';}
function pageNameFromFile(f){return String(f||'').replace(/\\/g,'/').replace(/^.*?public\//,'').replace(/\.[^.]+$/,'').slice(0,240);}
function cleanUiText(v){let x=s(v).replace(/<[^>]+>/g,' ').replace(/\{\$[^}]+\}/g,' ').replace(/\{[^}]{0,120}\}/g,' ').replace(/\s+/g,' ').trim();return x.length>500?'':x;}
function hasVariable(text){return /%[dsm]/.test(String(text||''))?'Y':'N';}

async function ensure(db){await db.query(`SELECT 1 FROM gm_ui_dictionary_pending LIMIT 1`);}

// V009: runtime-capture requires the four canonical runtime metadata columns.
// Keep the current UI dictionary structure; only repair a DB that missed migration 133.
let runtimeSchemaReady=false;
let runtimeSchemaPromise=null;
async function ensureRuntimeSchema(db){
  if(runtimeSchemaReady)return;
  if(runtimeSchemaPromise)return runtimeSchemaPromise;
  runtimeSchemaPromise=(async()=>{
    await db.query(`ALTER TABLE gm_ui_dictionary ADD COLUMN IF NOT EXISTS source_map JSONB NOT NULL DEFAULT '{}'::jsonb`);
    await db.query(`ALTER TABLE gm_ui_dictionary ADD COLUMN IF NOT EXISTS use_count BIGINT NOT NULL DEFAULT 0`);
    await db.query(`ALTER TABLE gm_ui_dictionary ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ`);
    await db.query(`ALTER TABLE gm_ui_dictionary ADD COLUMN IF NOT EXISTS has_variable CHAR(1) NOT NULL DEFAULT 'N'`);
    runtimeSchemaReady=true;
  })();
  try{
    await runtimeSchemaPromise;
  }finally{
    runtimeSchemaPromise=null;
  }
}

function runtimeCaptureError(tag,e){
  try{
    console.error('[GM_UI_DICTIONARY_RUNTIME_V009]',tag,{
      message:String(e&&e.message||e),
      code:e&&e.code||'',
      detail:e&&e.detail||'',
      hint:e&&e.hint||'',
      table:e&&e.table||'',
      column:e&&e.column||'',
      constraint:e&&e.constraint||''
    });
  }catch(_e){}
}

async function pendingUpsert(db,row){
  const q=await db.query(
    `SELECT pending_id FROM gm_ui_dictionary_pending
     WHERE status='PENDING' AND change_type=$1
       AND COALESCE(gm_code,'')=COALESCE($2,'')
       AND source_locator=$3 AND source_text_ko=$4
     ORDER BY pending_id DESC LIMIT 1`,
    [row.change_type,row.gm_code||null,row.source_locator||'',row.source_text_ko]
  );
  if(q.rowCount){
    await db.query(
      `UPDATE gm_ui_dictionary_pending
       SET seen_count=seen_count+1,last_seen_at=now(),source_file=$2,page_name=$3,previous_text_ko=$4
       WHERE pending_id=$1`,
      [q.rows[0].pending_id,row.source_file||'',row.page_name||'',row.previous_text_ko||'']
    );
    return q.rows[0].pending_id;
  }
  const r=await db.query(
    `INSERT INTO gm_ui_dictionary_pending(
       gm_code,source_text_ko,previous_text_ko,page_name,source_file,source_locator,source_type,change_type
     ) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING pending_id`,
    [row.gm_code||null,row.source_text_ko,row.previous_text_ko||'',row.page_name||'',row.source_file||'',row.source_locator||'',row.source_type,row.change_type]
  );
  return r.rows[0].pending_id;
}

// Legacy/fallback observer: source metadata stays in pending/history only.
// Canonical gm_ui_dictionary no longer owns source_file/source_locator/source_type timestamps.
async function observe(db,row){
  const code=s(row.gm_code).toUpperCase();
  const text=cleanUiText(row.source_text_ko);
  if(!text||!hasKo(text))return {skip:true};

  let cur=null;
  if(/^GM_\d{4,}$/.test(code)){
    const r=await db.query(`SELECT gm_code,kr FROM gm_ui_dictionary WHERE gm_code=$1`,[code]);
    cur=r.rows[0]||null;
  }
  if(cur){
    if(s(cur.kr)!==text){
      await pendingUpsert(db,{...row,gm_code:code,source_text_ko:text,previous_text_ko:s(cur.kr),change_type:'CHANGED'});
      return {changed:true};
    }
    return {same:true};
  }
  if(!code){
    const ex=await db.query(`SELECT gm_code FROM gm_ui_dictionary WHERE active_yn='Y' AND kr=$1 ORDER BY gm_code LIMIT 1`,[text]);
    if(ex.rowCount)return {sameText:true};
  }
  await pendingUpsert(db,{...row,gm_code:code||null,source_text_ko:text,change_type:'NEW'});
  return {new:true};
}

// GM_BUILDER_STATIC_CAPTURE_PAUSE_V003: Builder and auto-order UI capture paused.
// Keep normal display/translation/API behavior unchanged.
function gmUiStaticCapturePausedPath(rel){
  const p=String(rel||'').replace(/\\/g,'/').replace(/^\/+/, '').toLowerCase();
  return p.startsWith('public/builder/') || p.startsWith('builder/') ||
    p.startsWith('auto-order/') || p.startsWith('public/auto-order/');
}
function walk(dir,out,root){
  if(!fs.existsSync(dir))return;
  for(const ent of fs.readdirSync(dir,{withFileTypes:true})){
    if(ent.name==='node_modules'||ent.name.startsWith('.'))continue;
    const p=path.join(dir,ent.name);
    if(gmUiStaticCapturePausedPath(path.relative(root,p)))continue; // No STATIC capture here.
    if(ent.isDirectory())walk(p,out,root);
    else if(/\.(html?|js)$/i.test(ent.name)){
      try{const st=fs.statSync(p);if(st.size<=2*1024*1024)out.push({abs:p,rel:path.relative(root,p).replace(/\\/g,'/')});}catch(_){ }
    }
  }
}

function extractFile(file){
  if(gmUiStaticCapturePausedPath(file.rel))return [];
  const src=fs.readFileSync(file.abs,'utf8');
  const rows=[];
  const lines=src.split(/\r?\n/);
  function add(gm,text,line,kind){
    text=cleanUiText(text);if(!text||!hasKo(text))return;
    rows.push({gm_code:gm||'',source_text_ko:text,page_name:pageNameFromFile(file.rel),source_file:file.rel,source_locator:file.rel+':'+line+':'+kind,source_type:'STATIC'});
  }
  let m;
  const keyed=/<[^>]*data-gm-ui-key=["'](GM_\d{4,})["'][^>]*>([^<]{1,500})</ig;
  while((m=keyed.exec(src)))add(m[1],m[2],src.slice(0,m.index).split(/\r?\n/).length,'key-text');
  if(/\.html?$/i.test(file.rel)){
    lines.forEach((ln,i)=>{
      let a;
      const ar=/(placeholder|title|aria-label|value)=["']([^"']*[가-힣][^"']*)["']/ig;
      while((a=ar.exec(ln)))add('',a[2],i+1,'attr-'+a[1]);
      const tr=/>\s*([^<>{}]*[가-힣][^<>{}]*)\s*</g;
      while((a=tr.exec(ln)))add('',a[1],i+1,'text');
    });
  }
  return rows;
}

router.get('/api/gm/builder/ui-dictionary-auto/status',async(req,res)=>{
  const db=dbFrom(req);
  try{
    await ensure(db);
    const a=(await db.query(`SELECT change_type,status,COUNT(*)::int n FROM gm_ui_dictionary_pending GROUP BY change_type,status ORDER BY status,change_type`)).rows;
    const d=(await db.query(`SELECT COUNT(*)::int total,COUNT(*) FILTER(WHERE active_yn='Y')::int active,COUNT(*) FILTER(WHERE translation_status<>'READY')::int recheck FROM gm_ui_dictionary`)).rows[0];
    res.json({ok:true,dictionary:d,pending:a});
  }catch(e){res.status(500).json({ok:false,error:String(e&&e.message||e)});}
});

// GM_UI_PENDING_CLEAN_V001: export/replace ONLY PENDING rows, never the canonical dictionary.
// Both endpoints require the existing Builder server-side derzon password verification.
const PENDING_COLUMNS='pending_id,gm_code,source_text_ko,previous_text_ko,page_name,source_file,source_locator,source_type,change_type,status,seen_count,first_seen_at,last_seen_at,reviewed_at,review_note';
async function pendingSnapshot(db){
 const q=await db.query(`SELECT ${PENDING_COLUMNS} FROM gm_ui_dictionary_pending WHERE status='PENDING' ORDER BY pending_id`);
 const items=q.rows;
 const sha256=crypto.createHash('sha256').update(JSON.stringify(items)).digest('hex');
 return {items,count:items.length,sha256};
}
router.get('/api/gm/builder/ui-dictionary-auto/pending-clean/export',async(req,res)=>{
 try{
  const snap=await pendingSnapshot(dbFrom(req));
  res.set('Cache-Control','no-store');res.json({ok:true,format:'GM_UI_PENDING_CLEAN_V001',exported_at:new Date().toISOString(),snapshot:{count:snap.count,sha256:snap.sha256},keep_ids:snap.items.map(x=>Number(x.pending_id)),items:snap.items});
 }catch(e){res.status(500).json({ok:false,error:'PENDING_EXPORT_FAILED',detail:String(e&&e.message||e)});}
});
// GM_UI_PENDING_CLEAN_V003: download remains read-only; delete is a separate explicit action.
// The legacy file-upload replacement route is intentionally disabled.
router.post('/api/gm/builder/ui-dictionary-auto/pending-clean/replace',(_req,res)=>res.status(410).json({ok:false,error:'REPLACE_DISABLED_USE_SELECTION_DELETE'}));
router.post('/api/gm/builder/ui-dictionary-auto/pending-clean/delete-selected',express.json({limit:'64kb'}),async(req,res)=>{
 const ids=req.body&&req.body.pending_ids;
 if(!Array.isArray(ids)||!ids.length||ids.length>1000||!ids.every(x=>Number.isSafeInteger(x)&&x>0)||new Set(ids).size!==ids.length)
  return res.status(400).json({ok:false,error:'INVALID_PENDING_IDS'});
 const db=dbFrom(req);
 try{
  const r=await db.query(`DELETE FROM gm_ui_dictionary_pending WHERE status='PENDING' AND pending_id=ANY($1::bigint[]) RETURNING pending_id`,[ids]);
  res.set('Cache-Control','no-store').json({ok:true,deleted:r.rowCount,requested:ids.length});
 }catch(e){res.status(500).json({ok:false,error:'PENDING_SELECTED_DELETE_FAILED',detail:String(e&&e.message||e)});}
});
router.post('/api/gm/builder/ui-dictionary-auto/pending-clean/delete-all',express.json({limit:'4kb'}),async(req,res)=>{
 const expected=req.body&&req.body.snapshot;
 if(!expected||!Number.isInteger(expected.count)||!/^[a-f0-9]{64}$/.test(String(expected.sha256||'')))
  return res.status(400).json({ok:false,error:'BACKUP_SNAPSHOT_REQUIRED'});
 const db=dbFrom(req),client=await db.connect();
 try{
  await client.query('BEGIN');
  await client.query('LOCK TABLE gm_ui_dictionary_pending IN SHARE ROW EXCLUSIVE MODE');
  const snap=await pendingSnapshot(client);
  if(snap.count!==expected.count||snap.sha256!==expected.sha256){
   await client.query('ROLLBACK');return res.status(409).json({ok:false,error:'PENDING_CHANGED_EXPORT_AGAIN',current_count:snap.count});
  }
  const r=await client.query(`DELETE FROM gm_ui_dictionary_pending WHERE status='PENDING'`);
  if(r.rowCount!==snap.count)throw Error('DELETE_COUNT_MISMATCH');
  await client.query('COMMIT');
  res.set('Cache-Control','no-store').json({ok:true,deleted:r.rowCount});
 }catch(e){await client.query('ROLLBACK').catch(()=>{});res.status(500).json({ok:false,error:'PENDING_DELETE_ALL_FAILED',detail:String(e&&e.message||e)});}
 finally{client.release();}
});

router.get('/api/gm/builder/ui-dictionary-auto/pending',async(req,res)=>{
  const db=dbFrom(req);
  try{
    const r=await db.query(`SELECT * FROM gm_ui_dictionary_pending WHERE status='PENDING' ORDER BY CASE change_type WHEN 'CHANGED' THEN 1 WHEN 'NEW' THEN 2 ELSE 3 END,last_seen_at DESC LIMIT 1000`);
    res.json({ok:true,items:r.rows});
  }catch(e){res.status(500).json({ok:false,error:String(e&&e.message||e)});}
});

router.post('/api/gm/builder/ui-dictionary-auto/scan-static',express.json({limit:'1mb'}),async(req,res)=>{
  const db=dbFrom(req);
  try{
    await ensure(db);
    const root=path.resolve(__dirname,'../..');
    const envDirs=s(process.env.GM_UI_SCAN_DIRS||'public,routes,services').split(',').map(x=>x.trim()).filter(Boolean);
    const files=[];envDirs.forEach(x=>walk(path.join(root,x),files,root));
    const stats={files:files.length,candidates:0,new:0,changed:0,same:0,removed:0};
    for(const f of files){
      for(const row of extractFile(f)){
        stats.candidates++;
        const o=await observe(db,row);
        if(o.new)stats.new++;else if(o.changed)stats.changed++;else stats.same++;
      }
    }
    // V007: no REMOVED inference from canonical rows. Source lifecycle lives in pending/history only.
    res.json({ok:true,dirs:envDirs,stats});
  }catch(e){res.status(500).json({ok:false,error:String(e&&e.message||e)});}
});

// Compatibility endpoint: use the same V2 canonical path instead of writing dropped source columns.
router.post('/api/gm/ui-dictionary/runtime-capture',express.json({limit:'256kb'}),async(req,res)=>{
  if(!captureAllowed(req))return res.json({ok:true,skipped:'NOT_DERZON'});
  const db=dbFrom(req);
  try{
    await ensure(db);
    await ensureRuntimeSchema(db);
    const body=req.body||{},baseApp=s(body.source_app||body.sourceApp||'').toUpperCase();
    const items=(Array.isArray(body.items)?body.items:[]).slice(0,200).map(x=>Object.assign({},x||{}, {
      source_app:(x&&x.source_app)||(x&&x.sourceApp)||baseApp||'GLOMART',
      source_surface:(x&&x.source_surface)||(x&&x.sourceSurface)||(x&&x.page)||'RUNTIME'
    }));
    const stats=await uiV2.captureMany(db,items,{incrementUsage:true});
    uiV2.queueTranslations(db,stats.translate_codes);
    if(stats.created||stats.changed){
      require('../../services/multilingual/ui/ui_dictionary_auto_publish').scheduleAutomation(db,'NEW_UI_WORD');
    }
    res.json({ok:true,stats});
  }catch(e){runtimeCaptureError('compat',e);res.status(500).json({ok:false,error:String(e&&e.message||e)});}
});

async function nextCode(db){
  const r=await db.query(`SELECT COALESCE(MAX(NULLIF(regexp_replace(gm_code,'\\D','','g'),'')::bigint),0)+1 AS n FROM gm_ui_dictionary WHERE gm_code ~ '^GM_[0-9]+$'`);
  return 'GM_'+String(r.rows[0].n).padStart(4,'0');
}

router.post('/api/gm/builder/ui-dictionary-auto/approve',express.json({limit:'1mb'}),async(req,res)=>{
  const db=dbFrom(req);
  const ids=(Array.isArray(req.body&&req.body.pending_ids)?req.body.pending_ids:[]).map(Number).filter(Number.isFinite);
  if(!ids.length)return res.status(400).json({ok:false,error:'pending_ids required'});
  const client=await db.connect();
  try{
    await client.query('BEGIN');
    const out=[];
    for(const id of ids){
      const pr=(await client.query(`SELECT * FROM gm_ui_dictionary_pending WHERE pending_id=$1 AND status='PENDING' FOR UPDATE`,[id])).rows[0];
      if(!pr)continue;
      let code=s(pr.gm_code).toUpperCase();
      if(pr.change_type==='NEW'){
        if(!/^GM_\d{4,}$/.test(code)||(await client.query(`SELECT 1 FROM gm_ui_dictionary WHERE gm_code=$1`,[code])).rowCount)code=await nextCode(client);
        await client.query(
          `INSERT INTO gm_ui_dictionary(gm_code,page_name,kr,active_yn,translation_status,has_variable)
           VALUES($1,$2,$3,'Y','NEW',$4)`,
          [code,pr.page_name||'',pr.source_text_ko,hasVariable(pr.source_text_ko)]
        );
      }else if(pr.change_type==='CHANGED'){
        code=code||s((await client.query(`SELECT gm_code FROM gm_ui_dictionary WHERE kr=$1 ORDER BY gm_code LIMIT 1`,[pr.previous_text_ko||''])).rows[0]?.gm_code);
        if(!code)throw new Error('CHANGED gm_code missing pending_id='+id);
        const old=(await client.query(`SELECT kr FROM gm_ui_dictionary WHERE gm_code=$1 FOR UPDATE`,[code])).rows[0];
        if(!old)throw new Error('dictionary row missing '+code);
        await client.query(
          `INSERT INTO gm_ui_dictionary_history(gm_code,old_kr,new_kr,change_type,source_file,source_locator,source_type)
           VALUES($1,$2,$3,'CHANGED',$4,$5,$6)`,
          [code,old.kr||'',pr.source_text_ko,pr.source_file||'',pr.source_locator||'',pr.source_type]
        );
        await client.query(
          `UPDATE gm_ui_dictionary
           SET kr=$2,page_name=COALESCE(NULLIF($3,''),page_name),active_yn='Y',translation_status='RECHECK',has_variable=$4,updated_at=now()
           WHERE gm_code=$1`,
          [code,pr.source_text_ko,pr.page_name||'',hasVariable(pr.source_text_ko)]
        );
      }else if(pr.change_type==='REMOVED'){
        if(!code)throw new Error('REMOVED gm_code missing pending_id='+id);
        const old=(await client.query(`SELECT kr FROM gm_ui_dictionary WHERE gm_code=$1 FOR UPDATE`,[code])).rows[0];
        if(old){
          await client.query(
            `INSERT INTO gm_ui_dictionary_history(gm_code,old_kr,new_kr,change_type,source_file,source_locator,source_type)
             VALUES($1,$2,'','REMOVED',$3,$4,$5)`,
            [code,old.kr||'',pr.source_file||'',pr.source_locator||'',pr.source_type]
          );
          await client.query(`UPDATE gm_ui_dictionary SET active_yn='N',updated_at=now() WHERE gm_code=$1`,[code]);
        }
      }
      await client.query(`UPDATE gm_ui_dictionary_pending SET status='APPROVED',reviewed_at=now(),gm_code=$2 WHERE pending_id=$1`,[id,code||null]);
      out.push({pending_id:id,gm_code:code,change_type:pr.change_type});
    }
    await client.query('COMMIT');
    if(out.some(x=>x.change_type==='NEW'||x.change_type==='CHANGED')){
      require('../../services/multilingual/ui/ui_dictionary_auto_publish').scheduleAutomation(db,'BUILDER_APPROVAL');
    }
    res.json({ok:true,applied:out.length,items:out});
  }catch(e){
    await client.query('ROLLBACK').catch(()=>{});
    res.status(500).json({ok:false,error:String(e&&e.message||e)});
  }finally{client.release();}
});

router.post('/api/gm/builder/ui-dictionary-auto/ignore',express.json({limit:'256kb'}),async(req,res)=>{
  const db=dbFrom(req),ids=(Array.isArray(req.body&&req.body.pending_ids)?req.body.pending_ids:[]).map(Number).filter(Number.isFinite);
  try{
    const r=await db.query(`UPDATE gm_ui_dictionary_pending SET status='IGNORED',reviewed_at=now() WHERE pending_id=ANY($1::bigint[]) AND status='PENDING' RETURNING pending_id`,[ids]);
    res.json({ok:true,ignored:r.rowCount});
  }catch(e){res.status(500).json({ok:false,error:String(e&&e.message||e)});}
});

// V2 automatic UI dictionary. Canonical runtime metadata is intentionally limited to:
// source_map / use_count / last_used_at / has_variable.
router.get('/api/gm/builder/ui-dictionary-auto/v2/status',async(req,res)=>{
  const db=dbFrom(req);
  try{
    const miss=uiV2.FOREIGN.map(l=>`COALESCE(${l},'')=''`).join(' OR ');
    const d=(await db.query(
      `SELECT COUNT(*)::int total,
              COUNT(*) FILTER(WHERE active_yn='Y')::int active,
              COUNT(*) FILTER(WHERE has_variable='Y')::int variable,
              COALESCE(SUM(use_count),0)::bigint use_count,
              COUNT(*) FILTER(WHERE translation_status<>'READY' OR ${miss})::int translation_pending
       FROM gm_ui_dictionary`
    )).rows[0];
    const recent=(await db.query(
      `SELECT gm_code,kr,translation_status,has_variable,use_count,last_used_at,updated_at,source_map
       FROM gm_ui_dictionary
       WHERE use_count>0 OR has_variable='Y'
       ORDER BY COALESCE(last_used_at,updated_at) DESC
       LIMIT 80`
    )).rows;
    res.json({ok:true,dictionary:d,recent});
  }catch(e){res.status(500).json({ok:false,error:String(e&&e.message||e)});}
});

router.post('/api/gm/builder/ui-dictionary-auto/v2/scan-static',express.json({limit:'256kb'}),async(req,res)=>{
  const db=dbFrom(req);
  try{
    const root=path.resolve(__dirname,'../..');
    const envDirs=s(process.env.GM_UI_SCAN_DIRS||'public,routes,services').split(',').map(x=>x.trim()).filter(Boolean);
    const files=[];envDirs.forEach(x=>walk(path.join(root,x),files,root));
    const limit=Math.max(1,Math.min(1000,Number(req.body&&req.body.limit||250)));
    const rows=[];
    outer: for(const f of files){
      for(const row of extractFile(f)){
        rows.push({...row,source_app:'GLOMART',source_surface:'STATIC:'+pageNameFromFile(f.rel)});
        if(rows.length>=limit)break outer;
      }
    }
    const stats=await uiV2.captureMany(db,rows,{incrementUsage:false});
    uiV2.queueTranslations(db,stats.translate_codes);
    if(stats.created||stats.changed){
      require('../../services/multilingual/ui/ui_dictionary_auto_publish').scheduleAutomation(db,'NEW_UI_WORD');
    }
    res.json({ok:true,dirs:envDirs,limit,stats});
  }catch(e){res.status(500).json({ok:false,error:String(e&&e.message||e)});}
});

// Generated, versioned, per-language UI JSON. No dictionary scan triggered by ordinary users.
router.get('/api/gm/ui-dictionary/v2/auto/meta',async(req,res)=>{
 try{const m=await require('../../services/multilingual/ui/ui_dictionary_auto_publish').current(dbFrom(req));res.set('Cache-Control','no-store');res.json({ok:true,...m});}
 catch(e){res.status(500).json({ok:false,error:String(e&&e.message||e)});}
});
router.get('/api/gm/ui-dictionary/v2/auto/:lang/:version.json',async(req,res)=>{
 try{const svc=require('../../services/multilingual/ui/ui_dictionary_auto_publish');const lang=String(req.params.lang||'').toLowerCase();
 if(!svc.LANGS.includes(lang))return res.status(404).json({ok:false,error:'INVALID_LANG'});
 const pack=await svc.getPack(dbFrom(req),lang,String(req.params.version||''));
 if(!pack)return res.status(404).json({ok:false,error:'PACK_NOT_READY_OR_VERSION_MISMATCH'});
 res.set('Cache-Control','public,max-age=31536000,immutable');res.json(pack);
 }catch(e){res.status(500).json({ok:false,error:String(e&&e.message||e)});}
});

router.post('/api/gm/ui-dictionary/v2/runtime-capture',express.json({limit:'256kb'}),async(req,res)=>{
  if(!captureAllowed(req))return res.json({ok:true,skipped:'NOT_DERZON'});
  const db=dbFrom(req);
  try{
    await ensureRuntimeSchema(db);
    const body=req.body||{},baseApp=s(body.source_app||body.sourceApp||'').toUpperCase();
    const items=(Array.isArray(body.items)?body.items:[]).slice(0,160).map(x=>Object.assign({},x||{}, {
      source_app:(x&&x.source_app)||(x&&x.sourceApp)||baseApp||'GLOMART',
      source_surface:(x&&x.source_surface)||(x&&x.sourceSurface)||(x&&x.page)||'RUNTIME'
    }));
    const stats=await uiV2.captureMany(db,items,{incrementUsage:true});
    uiV2.queueTranslations(db,stats.translate_codes);
    if(stats.created||stats.changed){
      require('../../services/multilingual/ui/ui_dictionary_auto_publish').scheduleAutomation(db,'NEW_UI_WORD');
    }
    res.json({ok:true,stats:{received:stats.received,created:stats.created,changed:stats.changed,reused:stats.reused,skipped:stats.skipped,ambiguous_number:stats.ambiguous_number,translation_queued:stats.translate_codes.length}});
  }catch(e){runtimeCaptureError('v2',e);res.status(500).json({ok:false,error:String(e&&e.message||e)});}
});

router.get('/api/gm/builder/ui-dictionary-auto/v2/automation-status',(req,res)=>{
 try{res.set('Cache-Control','no-store').json({ok:true,automation:require('../../services/multilingual/ui/ui_dictionary_auto_publish').autoStatus()});}
 catch(e){res.status(500).json({ok:false,error:String(e&&e.message||e)});}
});

let uiManualTranslationRunning=false;
// GM_UI_AUTO_V030: Explicit manual JSON publish; translation button never publishes.
// Existing server-level builder admin gate protects this POST route.
router.post('/api/gm/builder/ui-dictionary-auto/v2/publish-json',express.json({limit:'16kb'}),async(req,res)=>{
  const db=dbFrom(req);
  try{
    const svc=require('../../services/multilingual/ui/ui_dictionary_auto_publish');
    const state=svc.autoStatus();
    if(state.running||state.scheduled)return res.status(409).json({ok:false,error:'AUTO_TRANSLATION_RUNNING'});
    if(!uiV2.isIdle()||uiManualTranslationRunning)return res.status(409).json({ok:false,error:'TRANSLATION_RUNNING'});
    const result=await svc.publishCompleted(db);
    if(!result.ok)return res.status(409).json(result);
    res.set('Cache-Control','no-store').json(result);
  }catch(e){res.status(500).json({ok:false,error:String(e&&e.message||e)});}
});

router.post('/api/gm/builder/ui-dictionary-auto/v2/retry-translations',express.json({limit:'64kb'}),async(req,res)=>{
  // V036: legacy server-side GTX translation is deliberately disabled.
  return res.status(409).json({ok:false,error:'CLIENT_TRANSLATION_REQUIRED'});
  const db=dbFrom(req);
  try{
    const limit=Math.max(1,Math.min(50,Number(req.body&&req.body.limit||10)));
    const publisher=require('../../services/multilingual/ui/ui_dictionary_auto_publish');
    const state=publisher.autoStatus();
    // Scheduled automatic work yields to explicit manual work (V034 existing API).
    if(state.running||!uiV2.isIdle()||uiManualTranslationRunning)return res.status(409).json({ok:false,error:'TRANSLATION_RUNNING'});
    if(uiV2.upstreamRateLimited())return res.status(429).json({ok:false,error:'TRANSLATION_PROVIDER_RATE_LIMITED',upstream:uiV2.upstreamStatus()});
    if(!publisher.startManualTranslation())return res.status(409).json({ok:false,error:'TRANSLATION_RUNNING'});
    uiManualTranslationRunning=true;
    try{
      const items=await uiV2.retryPending(db,limit);
      const translated=items.reduce((n,x)=>n+Number(x.result&&x.result.translated||0),0);
      res.json({ok:true,count:items.length,translated,rate_limited:uiV2.upstreamRateLimited(),upstream:uiV2.upstreamStatus(),items});
    }finally{uiManualTranslationRunning=false;publisher.endManualTranslation();}
  }catch(e){res.status(500).json({ok:false,error:String(e&&e.message||e)});}
});

// V036: server supplies ONLY missing cells; Google requests originate from client device.
router.get('/api/gm/builder/ui-dictionary-auto/v2/client-missing', async(req,res)=>{
 const db=dbFrom(req);
 try{
  const limit=Math.max(1,Math.min(100,Number(req.query.limit)||20));
  const cols=uiV2.FOREIGN;
  const where=cols.map(l=>`NULLIF(BTRIM(${l}::text),'') IS NULL`).join(' OR ');
  const result=await db.query(`SELECT gm_code,kr,${cols.join(',')} FROM gm_ui_dictionary
    WHERE active_yn='Y' AND NULLIF(BTRIM(kr::text),'') IS NOT NULL AND (${where})
    ORDER BY gm_code LIMIT $1`,[limit]);
  const items=result.rows.map(row=>({gm_code:row.gm_code,kr:row.kr,
     missing:cols.filter(l=>!String(row[l]||'').trim())}));
  res.set('Cache-Control','no-store').json({ok:true,items,count:items.length});
 }catch(e){res.status(500).json({ok:false,error:'CLIENT_MISSING_FAILED',detail:String(e.message||e)});}
});

// Each upload requires the EXISTING Builder per-operation derzon password hash check.
// Never trust an arbitrary GM_CODE/language or overwrite a translated cell.
// V038: repeat the existing mandatory admin session gate for this exact endpoint.
// It independently verifies derzon's HttpOnly session cookie and same-origin POST.
// No generic Builder write/delete permission is changed.
router.post('/api/gm/builder/ui-dictionary-auto/v2/client-upload',require('../admin_session_gate').middleware,express.json({limit:'128kb'}),async(req,res)=>{
 const db=dbFrom(req),entries=req.body&&req.body.items;
 if(!Array.isArray(entries)||!entries.length||entries.length>100)return res.status(400).json({ok:false,error:'INVALID_BATCH_SIZE'});
 const seen=new Set(),validated=[];
 for(const x of entries){
  const code=String(x&&x.gm_code||'');const kr=String(x&&x.kr||'');
  const lang=String(x&&x.lang||'');const value=String(x&&x.value||'').trim();
  if(!/^GM_\d{4,}$/.test(code)||!uiV2.FOREIGN.includes(lang)||!kr.trim()||kr.length>500||!value||value.length>3000)
   return res.status(400).json({ok:false,error:'INVALID_CELL'});
  const srcSlots=(kr.match(/%[dsm]/g)||[]).join('|'),dstSlots=(value.match(/%[dsm]/g)||[]).join('|');
  if(srcSlots!==dstSlots)return res.status(400).json({ok:false,error:'PLACEHOLDER_MISMATCH',gm_code:code,lang});
  if(value===kr && !/^[\d\s%.,:()/-]+$/.test(kr))return res.status(400).json({ok:false,error:'UNTRANSLATED_VALUE',gm_code:code,lang});
  const sig=code+':'+lang;if(seen.has(sig))return res.status(400).json({ok:false,error:'DUPLICATE_CELL'});
  seen.add(sig);validated.push({code,kr,lang,value});
 }
 const handle=await db.connect();let inTx=false;
 try{
  await handle.query('BEGIN');inTx=true;
  // Lock all affected rows in deterministic order to avoid concurrent conflicts.
  const codes=[...new Set(validated.map(x=>x.code))].sort();const rows=new Map();
  for(const code of codes){
   const r=await handle.query(`SELECT gm_code,kr,${uiV2.FOREIGN.join(',')} FROM gm_ui_dictionary WHERE gm_code=$1 AND active_yn='Y' FOR UPDATE`,[code]);
   if(r.rows.length!==1)throw Object.assign(Error('ROW_NOT_FOUND'),{http:409});
   rows.set(code,r.rows[0]);
  }
  let saved=0,already=0;
  for(const x of validated){
   const row=rows.get(x.code);
   if(row.kr!==x.kr)throw Object.assign(Error('SOURCE_TEXT_CHANGED:'+x.code),{http:409});
   if(String(row[x.lang]||'').trim()){already++;continue;}
   await handle.query(`UPDATE gm_ui_dictionary SET ${x.lang}=$2,updated_at=now() WHERE gm_code=$1`,[x.code,x.value]);
   row[x.lang]=x.value;saved++;
  }
  for(const code of codes){
   const row=rows.get(code),missing=uiV2.FOREIGN.filter(l=>!String(row[l]||'').trim());
   await handle.query('UPDATE gm_ui_dictionary SET translation_status=$2 WHERE gm_code=$1',[code,missing.length?'PARTIAL':'READY']);
  }
  await handle.query('COMMIT');inTx=false;
  if(saved)require('../../services/multilingual/ui/ui_dictionary_auto_publish').scheduleAutomation(db,'CLIENT_TRANSLATION_SAVED');
  console.log('[GM_UI_CLIENT_DB_SAVED_V038]',JSON.stringify({cells:saved,already,rows:codes.length,auth:'DERZON_ADMIN_SESSION',source:'BUILDER_CLIENT'}));
  res.set('Cache-Control','no-store').json({ok:true,saved,already,rows:codes.length});
 }catch(e){if(inTx)await handle.query('ROLLBACK').catch(()=>{});res.status(e.http||500).json({ok:false,error:'CLIENT_UPLOAD_FAILED',detail:String(e.message||e)});}
 finally{handle.release();}
});

// V039: separate, life-session-verified derzon client worker; existing translation routes preserved.
router.use(require('./ui_dictionary_derzon_worker'));
module.exports=router;
