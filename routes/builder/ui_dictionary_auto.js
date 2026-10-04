'use strict';
// GM_UI_DICTIONARY_AUTO_V001
const express=require('express');
const fs=require('fs');
const path=require('path');
const router=express.Router();
const {dbFrom}=require('./core');
const uiV2=require('../../services/ui_dictionary_v2');
function s(v){return String(v==null?'':v).replace(/\s+/g,' ').trim();}
function hasKo(v){return /[가-힣]/.test(String(v||''));}
function pageNameFromFile(f){return String(f||'').replace(/\\/g,'/').replace(/^.*?public\//,'').replace(/\.[^.]+$/,'').slice(0,240);}
function cleanUiText(v){let x=s(v).replace(/<[^>]+>/g,' ').replace(/\{\$[^}]+\}/g,' ').replace(/\{[^}]{0,120}\}/g,' ').replace(/\s+/g,' ').trim();return x.length>500?'':x;}
async function ensure(db){
  await db.query(`SELECT 1 FROM gm_ui_dictionary_pending LIMIT 1`);
}
async function pendingUpsert(db,row){
  const q=await db.query(`SELECT pending_id FROM gm_ui_dictionary_pending WHERE status='PENDING' AND change_type=$1 AND COALESCE(gm_code,'')=COALESCE($2,'') AND source_locator=$3 AND source_text_ko=$4 ORDER BY pending_id DESC LIMIT 1`,[row.change_type,row.gm_code||null,row.source_locator||'',row.source_text_ko]);
  if(q.rowCount){await db.query(`UPDATE gm_ui_dictionary_pending SET seen_count=seen_count+1,last_seen_at=now(),source_file=$2,page_name=$3,previous_text_ko=$4 WHERE pending_id=$1`,[q.rows[0].pending_id,row.source_file||'',row.page_name||'',row.previous_text_ko||'']);return q.rows[0].pending_id;}
  const r=await db.query(`INSERT INTO gm_ui_dictionary_pending(gm_code,source_text_ko,previous_text_ko,page_name,source_file,source_locator,source_type,change_type) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING pending_id`,[row.gm_code||null,row.source_text_ko,row.previous_text_ko||'',row.page_name||'',row.source_file||'',row.source_locator||'',row.source_type,row.change_type]);
  return r.rows[0].pending_id;
}
async function observe(db,row){
  const code=s(row.gm_code).toUpperCase(); const text=cleanUiText(row.source_text_ko); if(!text||!hasKo(text))return {skip:true};
  let cur=null;
  if(/^GM_\d{4,}$/.test(code)){const r=await db.query(`SELECT gm_code,kr FROM gm_ui_dictionary WHERE gm_code=$1`,[code]);cur=r.rows[0]||null;}
  if(cur){
    if(s(cur.kr)!==text){await pendingUpsert(db,{...row,gm_code:code,source_text_ko:text,previous_text_ko:s(cur.kr),change_type:'CHANGED'});return {changed:true};}
    await db.query(`UPDATE gm_ui_dictionary SET source_file=CASE WHEN $2<>'' THEN $2 ELSE source_file END,source_locator=CASE WHEN $3<>'' THEN $3 ELSE source_locator END,source_type=$4,last_seen_at=now(),first_seen_at=COALESCE(first_seen_at,now()),active_yn='Y',removed_at=NULL WHERE gm_code=$1`,[code,row.source_file||'',row.source_locator||'',row.source_type]);
    return {same:true};
  }
  if(!code){
    const ex=await db.query(`SELECT gm_code FROM gm_ui_dictionary WHERE active_yn='Y' AND kr=$1 ORDER BY gm_code LIMIT 1`,[text]);
    if(ex.rowCount)return {sameText:true};
  }
  await pendingUpsert(db,{...row,gm_code:code||null,source_text_ko:text,change_type:'NEW'});return {new:true};
}
function walk(dir,out,root){if(!fs.existsSync(dir))return;for(const ent of fs.readdirSync(dir,{withFileTypes:true})){if(ent.name==='node_modules'||ent.name.startsWith('.'))continue;const p=path.join(dir,ent.name);if(ent.isDirectory())walk(p,out,root);else if(/\.(html?|js)$/i.test(ent.name)){try{const st=fs.statSync(p);if(st.size<=2*1024*1024)out.push({abs:p,rel:path.relative(root,p).replace(/\\/g,'/')});}catch(_){}}}}
function extractFile(file){const src=fs.readFileSync(file.abs,'utf8');const rows=[];const lines=src.split(/\r?\n/);function add(gm,text,line,kind){text=cleanUiText(text);if(!text||!hasKo(text))return;rows.push({gm_code:gm||'',source_text_ko:text,page_name:pageNameFromFile(file.rel),source_file:file.rel,source_locator:file.rel+':'+line+':'+kind,source_type:'STATIC'});}let m;
  const keyed=/<[^>]*data-gm-ui-key=["'](GM_\d{4,})["'][^>]*>([^<]{1,500})</ig;while((m=keyed.exec(src))){add(m[1],m[2],src.slice(0,m.index).split(/\r?\n/).length,'key-text');}
  if(/\.html?$/i.test(file.rel)){
    lines.forEach((ln,i)=>{let a;const ar=/(placeholder|title|aria-label|value)=["']([^"']*[가-힣][^"']*)["']/ig;while((a=ar.exec(ln)))add('',a[2],i+1,'attr-'+a[1]);const tr=/>\s*([^<>{}]*[가-힣][^<>{}]*)\s*</g;while((a=tr.exec(ln)))add('',a[1],i+1,'text');});
  }
  return rows;
}
router.get('/api/gm/builder/ui-dictionary-auto/status',async(req,res)=>{const db=dbFrom(req);try{await ensure(db);const a=(await db.query(`SELECT change_type,status,COUNT(*)::int n FROM gm_ui_dictionary_pending GROUP BY change_type,status ORDER BY status,change_type`)).rows;const d=(await db.query(`SELECT COUNT(*)::int total,COUNT(*) FILTER(WHERE active_yn='Y')::int active,COUNT(*) FILTER(WHERE translation_status<>'READY')::int recheck FROM gm_ui_dictionary`)).rows[0];res.json({ok:true,dictionary:d,pending:a});}catch(e){res.status(500).json({ok:false,error:String(e&&e.message||e)});}});
router.get('/api/gm/builder/ui-dictionary-auto/pending',async(req,res)=>{const db=dbFrom(req);try{const r=await db.query(`SELECT * FROM gm_ui_dictionary_pending WHERE status='PENDING' ORDER BY CASE change_type WHEN 'CHANGED' THEN 1 WHEN 'NEW' THEN 2 ELSE 3 END,last_seen_at DESC LIMIT 1000`);res.json({ok:true,items:r.rows});}catch(e){res.status(500).json({ok:false,error:String(e&&e.message||e)});}});
router.post('/api/gm/builder/ui-dictionary-auto/scan-static',express.json({limit:'1mb'}),async(req,res)=>{const db=dbFrom(req);try{await ensure(db);const root=path.resolve(__dirname,'../..');const envDirs=s(process.env.GM_UI_SCAN_DIRS||'public,routes,services').split(',').map(x=>x.trim()).filter(Boolean);const files=[];envDirs.forEach(x=>walk(path.join(root,x),files,root));let stats={files:files.length,candidates:0,new:0,changed:0,same:0,removed:0};const seenCodes=new Set();for(const f of files){for(const row of extractFile(f)){stats.candidates++;if(row.gm_code)seenCodes.add(String(row.gm_code).toUpperCase());const o=await observe(db,row);if(o.new)stats.new++;else if(o.changed)stats.changed++;else stats.same++;}}const staticRows=(await db.query(`SELECT gm_code,kr,page_name,source_file,source_locator FROM gm_ui_dictionary WHERE active_yn='Y' AND source_type='STATIC' AND source_file<>''`)).rows;for(const x of staticRows){const sf=String(x.source_file||'').replace(/\\/g,'/');const covered=envDirs.some(d=>sf===d||sf.startsWith(d.replace(/\/$/,'')+'/'));if(!covered||seenCodes.has(String(x.gm_code||'').toUpperCase()))continue;await pendingUpsert(db,{gm_code:x.gm_code,source_text_ko:x.kr||'',previous_text_ko:x.kr||'',page_name:x.page_name||'',source_file:sf,source_locator:x.source_locator||sf,source_type:'STATIC',change_type:'REMOVED'});stats.removed++;}res.json({ok:true,dirs:envDirs,stats});}catch(e){res.status(500).json({ok:false,error:String(e&&e.message||e)});}});
router.post('/api/gm/ui-dictionary/runtime-capture',express.json({limit:'256kb'}),async(req,res)=>{const db=dbFrom(req);try{await ensure(db);const body=req.body||{},items=Array.isArray(body.items)?body.items.slice(0,200):[];let stats={received:items.length,new:0,changed:0,same:0,skipped:0};for(let i=0;i<items.length;i++){const x=items[i]||{};const row={gm_code:x.gm_code||x.gmCode||'',source_text_ko:x.text||x.source_text_ko||'',page_name:s(x.page||x.page_name||'').slice(0,240),source_file:s(x.page||x.page_name||'').slice(0,500),source_locator:s(x.locator||'').slice(0,800),source_type:'RUNTIME'};const o=await observe(db,row);if(o.new)stats.new++;else if(o.changed)stats.changed++;else if(o.skip)stats.skipped++;else stats.same++;}res.json({ok:true,stats});}catch(e){res.status(500).json({ok:false,error:String(e&&e.message||e)});}});
async function nextCode(db){const r=await db.query(`SELECT COALESCE(MAX(NULLIF(regexp_replace(gm_code,'\\D','','g'),'')::bigint),0)+1 AS n FROM gm_ui_dictionary WHERE gm_code ~ '^GM_[0-9]+$'`);return 'GM_'+String(r.rows[0].n).padStart(4,'0');}
router.post('/api/gm/builder/ui-dictionary-auto/approve',express.json({limit:'1mb'}),async(req,res)=>{const db=dbFrom(req),ids=(Array.isArray(req.body&&req.body.pending_ids)?req.body.pending_ids:[]).map(Number).filter(Number.isFinite);if(!ids.length)return res.status(400).json({ok:false,error:'pending_ids required'});const client=await db.connect();try{await client.query('BEGIN');let out=[];for(const id of ids){const pr=(await client.query(`SELECT * FROM gm_ui_dictionary_pending WHERE pending_id=$1 AND status='PENDING' FOR UPDATE`,[id])).rows[0];if(!pr)continue;let code=s(pr.gm_code).toUpperCase();if(pr.change_type==='NEW'){
        if(!/^GM_\d{4,}$/.test(code)||(await client.query(`SELECT 1 FROM gm_ui_dictionary WHERE gm_code=$1`,[code])).rowCount)code=await nextCode(client);
        await client.query(`INSERT INTO gm_ui_dictionary(gm_code,page_name,kr,source_file,source_locator,source_type,active_yn,translation_status,first_seen_at,last_seen_at) VALUES($1,$2,$3,$4,$5,$6,'Y','NEW',now(),now())`,[code,pr.page_name||'',pr.source_text_ko,pr.source_file||'',pr.source_locator||'',pr.source_type]);
      }else if(pr.change_type==='CHANGED'){
        code=code||s((await client.query(`SELECT gm_code FROM gm_ui_dictionary WHERE source_locator=$1 LIMIT 1`,[pr.source_locator])).rows[0]?.gm_code);
        if(!code)throw new Error('CHANGED gm_code missing pending_id='+id);
        const old=(await client.query(`SELECT kr FROM gm_ui_dictionary WHERE gm_code=$1 FOR UPDATE`,[code])).rows[0];if(!old)throw new Error('dictionary row missing '+code);
        await client.query(`INSERT INTO gm_ui_dictionary_history(gm_code,old_kr,new_kr,change_type,source_file,source_locator,source_type) VALUES($1,$2,$3,'CHANGED',$4,$5,$6)`,[code,old.kr||'',pr.source_text_ko,pr.source_file||'',pr.source_locator||'',pr.source_type]);
        await client.query(`UPDATE gm_ui_dictionary SET kr=$2,page_name=COALESCE(NULLIF($3,''),page_name),source_file=$4,source_locator=$5,source_type=$6,active_yn='Y',translation_status='RECHECK',last_seen_at=now(),removed_at=NULL,updated_at=now() WHERE gm_code=$1`,[code,pr.source_text_ko,pr.page_name||'',pr.source_file||'',pr.source_locator||'',pr.source_type]);
      }else if(pr.change_type==='REMOVED'){
        if(!code)throw new Error('REMOVED gm_code missing pending_id='+id);const old=(await client.query(`SELECT kr FROM gm_ui_dictionary WHERE gm_code=$1 FOR UPDATE`,[code])).rows[0];if(old){await client.query(`INSERT INTO gm_ui_dictionary_history(gm_code,old_kr,new_kr,change_type,source_file,source_locator,source_type) VALUES($1,$2,'','REMOVED',$3,$4,$5)`,[code,old.kr||'',pr.source_file||'',pr.source_locator||'',pr.source_type]);await client.query(`UPDATE gm_ui_dictionary SET active_yn='N',removed_at=now(),updated_at=now() WHERE gm_code=$1`,[code]);}
      }
      await client.query(`UPDATE gm_ui_dictionary_pending SET status='APPROVED',reviewed_at=now(),gm_code=$2 WHERE pending_id=$1`,[id,code||null]);out.push({pending_id:id,gm_code:code,change_type:pr.change_type});}
    await client.query('COMMIT');res.json({ok:true,applied:out.length,items:out});
  }catch(e){await client.query('ROLLBACK').catch(()=>{});res.status(500).json({ok:false,error:String(e&&e.message||e)});}finally{client.release();}});
router.post('/api/gm/builder/ui-dictionary-auto/ignore',express.json({limit:'256kb'}),async(req,res)=>{const db=dbFrom(req),ids=(Array.isArray(req.body&&req.body.pending_ids)?req.body.pending_ids:[]).map(Number).filter(Number.isFinite);try{const r=await db.query(`UPDATE gm_ui_dictionary_pending SET status='IGNORED',reviewed_at=now() WHERE pending_id=ANY($1::bigint[]) AND status='PENDING' RETURNING pending_id`,[ids]);res.json({ok:true,ignored:r.rowCount});}catch(e){res.status(500).json({ok:false,error:String(e&&e.message||e)});}});

// GM_UI_DICTIONARY_V005: V2 experimental path.
// Existing pending/approve/REMOVED flow above remains untouched for immediate rollback.
router.get('/api/gm/builder/ui-dictionary-auto/v2/status',async(req,res)=>{
  const db=dbFrom(req);
  try{
    const foreign=uiV2.FOREIGN;
    const miss=foreign.map(l=>`COALESCE(${l},'')=''`).join(' OR ');
    const d=(await db.query(`SELECT COUNT(*)::int total,COUNT(*) FILTER(WHERE active_yn='Y')::int active,COUNT(*) FILTER(WHERE template_hash<>'')::int templated,COALESCE(SUM(use_count),0)::bigint use_count,COALESCE(SUM(glomart_use_count),0)::bigint glomart_use_count,COALESCE(SUM(guppy_use_count),0)::bigint guppy_use_count,COUNT(*) FILTER(WHERE translation_status<>'READY' OR ${miss})::int translation_pending FROM gm_ui_dictionary`)).rows[0];
    const recent=(await db.query(`SELECT gm_code,kr,translation_status,use_count,glomart_use_count,guppy_use_count,first_used_at,last_used_at,updated_at,source_map FROM gm_ui_dictionary WHERE template_hash<>'' ORDER BY COALESCE(last_used_at,updated_at) DESC LIMIT 80`)).rows;
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
    outer: for(const f of files){for(const row of extractFile(f)){
      rows.push({...row,source_app:'GLOMART',source_surface:'STATIC:'+pageNameFromFile(f.rel),source_type:'STATIC_V2'});
      if(rows.length>=limit)break outer;
    }}
    const stats=await uiV2.captureMany(db,rows,{incrementUsage:false});
    uiV2.queueTranslations(db,stats.translate_codes);
    res.json({ok:true,dirs:envDirs,limit,stats});
  }catch(e){res.status(500).json({ok:false,error:String(e&&e.message||e)});}
});
router.post('/api/gm/ui-dictionary/v2/runtime-capture',express.json({limit:'256kb'}),async(req,res)=>{
  const db=dbFrom(req);
  try{
    const body=req.body||{},baseApp=s(body.source_app||body.sourceApp||'').toUpperCase();
    const items=(Array.isArray(body.items)?body.items:[]).slice(0,160).map(x=>Object.assign({},x||{}, {
      source_app:(x&&x.source_app)||(x&&x.sourceApp)||baseApp||'GLOMART',
      source_surface:(x&&x.source_surface)||(x&&x.sourceSurface)||(x&&x.page)||'RUNTIME',
      source_type:'RUNTIME_V2'
    }));
    const stats=await uiV2.captureMany(db,items,{incrementUsage:true});
    uiV2.queueTranslations(db,stats.translate_codes);
    res.json({ok:true,stats:{received:stats.received,created:stats.created,changed:stats.changed,reused:stats.reused,skipped:stats.skipped,ambiguous_number:stats.ambiguous_number,translation_queued:stats.translate_codes.length}});
  }catch(e){res.status(500).json({ok:false,error:String(e&&e.message||e)});}
});
router.post('/api/gm/builder/ui-dictionary-auto/v2/retry-translations',express.json({limit:'64kb'}),async(req,res)=>{
  const db=dbFrom(req);
  try{const limit=Math.max(1,Math.min(50,Number(req.body&&req.body.limit||10)));const items=await uiV2.retryPending(db,limit);res.json({ok:true,count:items.length,items});}
  catch(e){res.status(500).json({ok:false,error:String(e&&e.message||e)});}
});

module.exports=router;
