'use strict';
// GM_DEVICE_LANG_V003
const express=require('express');
const multer=require('multer');
const router=express.Router();
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:8*1024*1024}});
const {dbFrom,ok,fail,parseCsv,toCsv}=require('./core');
const {resolveCountryCode}=require('../../services/request_country');
const {normLang,countVisit,rollover}=require('../../services/visit_stats');
const generator=require('../../services/device_lang_generator');

const BUILTIN=new Set(['kr','en','vi','zh','ja','tw','th','uz','ne','km','id','tl','mn','my','kk','si','ru','bn','ur','lo','hi','tr','fa','es','fr']);
function yn(v){return /^(1|y|yes|true|on)$/i.test(String(v||''));}
function placeholders(s){return (String(s||'').match(/%[a-zA-Z]/g)||[]).sort().join('|');}
async function languageRow(db,lang){
  const r=await db.query(`SELECT lang_code,status,pack_version,pack_url,download_count,
    visit_day_count,visit_yesterday_count,visit_month_count,visit_last_month_count,
    visit_year_count,visit_last_year_count,visit_total_count,first_seen_at,updated_at,
    CASE WHEN pack_data IS NULL THEN 0 ELSE jsonb_array_length(pack_data) END AS pack_count
    FROM gm_device_language WHERE lang_code=$1`,[lang]);
  return r.rows[0]||null;
}

router.get('/api/gm/device-lang/resolve',async(req,res)=>{
  const db=dbFrom(req);
  const locale=String(req.query.locale||req.query.lang||'').trim();
  const lang=normLang(req.query.lang||locale);
  if(!lang)return fail(res,400,'invalid device language');
  try{
    generator.ensureStarted(db);
    const country=await resolveCountryCode(req);
    let row;
    if(yn(req.query.visit)){
      const counted=await countVisit(db,lang,country,BUILTIN.has(lang));
      row=counted.lang;
    }else{
      if(!BUILTIN.has(lang)){
        await db.query(`INSERT INTO gm_device_language(lang_code,status,first_seen_at,updated_at) VALUES($1,'NEW',now(),now()) ON CONFLICT(lang_code) DO NOTHING`,[lang]);
      }
      row=await languageRow(db,lang);
    }
    if(!row && BUILTIN.has(lang)) row={lang_code:lang,status:'BUILTIN',pack_version:1,pack_url:null};
    if(!BUILTIN.has(lang) && row && (row.status==='NEW'||row.status==='FAILED')) generator.kick(db);
    const status=String(row&&row.status|| (BUILTIN.has(lang)?'BUILTIN':'NEW'));
    const approved=status==='APPROVED';
    res.set('Cache-Control','no-store, no-cache, must-revalidate');
    ok(res,{
      lang_code:lang,
      builtin:BUILTIN.has(lang),
      status,
      approved:BUILTIN.has(lang)||approved,
      extension_approved:approved,
      pack_version:Number(row&&row.pack_version||1),
      pack_url:approved?(row&&row.pack_url||('/api/gm/device-lang/pack/'+lang+'.js')):null,
      country_code:country||''
    });
  }catch(e){fail(res,500,'device language resolve failed',{detail:String(e&&e.message||e)});}
});

router.get('/api/gm/device-lang/pack/:lang.js',async(req,res)=>{
  const db=dbFrom(req),lang=normLang(req.params.lang);
  if(!lang||BUILTIN.has(lang))return res.status(404).type('text/plain').send('PACK_NOT_FOUND');
  try{
    const r=await db.query(`UPDATE gm_device_language SET download_count=download_count+1,updated_at=now()
      WHERE lang_code=$1 AND status='APPROVED' AND pack_data IS NOT NULL
      RETURNING lang_code,pack_version,pack_data`,[lang]);
    if(!r.rows.length)return res.status(404).type('text/plain').send('PACK_NOT_APPROVED');
    const row=r.rows[0],data=Array.isArray(row.pack_data)?row.pack_data:[];
    res.set('Cache-Control','public, max-age=31536000, immutable');
    res.type('application/javascript; charset=utf-8');
    res.send(`/* GM DEVICE LANGUAGE PACK ${lang} v${row.pack_version} */\n(function(w){'use strict';var LANG=${JSON.stringify(lang)};var DATA=${JSON.stringify(data)};w['Patch_Dic_'+LANG]=DATA;})(window);\n`);
  }catch(e){res.status(500).type('text/plain').send('PACK_READ_FAILED');}
});

router.get('/api/gm/builder/device-lang',async(req,res)=>{
  const db=dbFrom(req);
  try{
    generator.ensureStarted(db);
    const client=await db.connect();
    try{await client.query('BEGIN');await rollover(client);await client.query('COMMIT');}catch(e){try{await client.query('ROLLBACK');}catch(_e){}throw e;}finally{client.release();}
    const src=(await db.query(`SELECT COUNT(*)::bigint AS n FROM gm_ui_dictionary_source`)).rows[0];
    const r=await db.query(`SELECT lang_code,status,pack_version,pack_url,download_count,
      visit_day_count,visit_yesterday_count,visit_month_count,visit_last_month_count,
      visit_year_count,visit_last_year_count,visit_total_count,first_seen_at,updated_at,
      CASE WHEN pack_data IS NULL THEN 0 ELSE jsonb_array_length(pack_data) END AS pack_count
      FROM gm_device_language ORDER BY
      CASE status WHEN 'GENERATED' THEN 0 WHEN 'NEW' THEN 1 WHEN 'FAILED' THEN 2 WHEN 'GENERATING' THEN 3 WHEN 'APPROVED' THEN 4 ELSE 5 END,
      visit_total_count DESC,lang_code`);
    ok(res,{source_count:Number(src&&src.n||0),items:r.rows,generator:generator.status()});
  }catch(e){fail(res,500,'device language list failed',{detail:String(e&&e.message||e)});}
});

router.get('/api/gm/builder/country-stat',async(req,res)=>{
  const db=dbFrom(req);
  try{
    const client=await db.connect();
    try{await client.query('BEGIN');await rollover(client);await client.query('COMMIT');}catch(e){try{await client.query('ROLLBACK');}catch(_e){}throw e;}finally{client.release();}
    const r=await db.query(`SELECT country_code,member_count,visit_day_count,visit_yesterday_count,
      visit_month_count,visit_last_month_count,visit_year_count,visit_last_year_count,visit_total_count,
      first_seen_at,updated_at FROM gm_country_stat ORDER BY member_count DESC,visit_total_count DESC,country_code`);
    ok(res,{items:r.rows});
  }catch(e){fail(res,500,'country stat list failed',{detail:String(e&&e.message||e)});}
});

router.post('/api/gm/builder/device-lang/:lang/generate',async(req,res)=>{
  const db=dbFrom(req),lang=normLang(req.params.lang);
  if(!lang||BUILTIN.has(lang))return fail(res,400,'extension language only');
  try{
    const lock=await db.query(`UPDATE gm_device_language SET status='GENERATING',updated_at=now() WHERE lang_code=$1 AND status IN ('NEW','FAILED','GENERATED') RETURNING lang_code`,[lang]);
    if(!lock.rows.length)return fail(res,409,'language is not ready for generation');
    try{
      const result=await generator.generate(db,lang);
      ok(res,{lang_code:lang,status:'GENERATED',result});
    }catch(e){
      await db.query(`UPDATE gm_device_language SET status='FAILED',updated_at=now() WHERE lang_code=$1`,[lang]).catch(()=>{});
      fail(res,500,'generation failed',{detail:String(e&&e.message||e)});
    }
  }catch(e){fail(res,500,'generation start failed',{detail:String(e&&e.message||e)});}
});

router.get('/api/gm/builder/device-lang/:lang/export',async(req,res)=>{
  const db=dbFrom(req),lang=normLang(req.params.lang);
  if(!lang)return res.status(400).send('INVALID_LANG');
  try{
    const r=await db.query(`SELECT pack_data FROM gm_device_language WHERE lang_code=$1 AND pack_data IS NOT NULL`,[lang]);
    if(!r.rows.length)return res.status(404).send('PACK_NOT_FOUND');
    const rows=(Array.isArray(r.rows[0].pack_data)?r.rows[0].pack_data:[]).map(x=>({
      dict_key:x[0],source_text:x[1],translation:x[2],
      issue:!String(x[2]||'').trim()?'EMPTY':(/[가-힣]/.test(String(x[2]||''))?'KOREAN_REMAINS':(placeholders(x[1])!==placeholders(x[2])?'PLACEHOLDER_MISMATCH':''))
    }));
    res.set('Content-Disposition',`attachment; filename="Patch_Dic_${lang}_review.csv"`);
    res.type('text/csv; charset=utf-8').send(toCsv(rows,['dict_key','source_text','translation','issue']));
  }catch(e){res.status(500).send('EXPORT_FAILED');}
});

router.post('/api/gm/builder/device-lang/:lang/import',upload.single('file'),async(req,res)=>{
  const db=dbFrom(req),lang=normLang(req.params.lang);
  if(!lang||BUILTIN.has(lang))return fail(res,400,'extension language only');
  if(!req.file||!req.file.buffer)return fail(res,400,'CSV file required');
  try{
    const rows=parseCsv(req.file.buffer.toString('utf8'));
    const source=(await db.query(`SELECT dict_key,source_text FROM gm_ui_dictionary_source ORDER BY dict_key`)).rows;
    const byKey=new Map(rows.map(x=>[String(x.dict_key||'').trim(),x]));
    const data=[];const issues=[];
    for(const s of source){
      const x=byKey.get(s.dict_key); const tr=String(x&&x.translation||'').trim();
      if(!x||!tr){issues.push(s.dict_key+':EMPTY');continue;}
      if(placeholders(s.source_text)!==placeholders(tr))issues.push(s.dict_key+':PLACEHOLDER_MISMATCH');
      data.push([s.dict_key,s.source_text,tr]);
    }
    if(issues.length)return fail(res,400,'review file validation failed',{issues:issues.slice(0,50),issue_count:issues.length});
    const r=await db.query(`UPDATE gm_device_language SET
      pack_version=CASE WHEN status='APPROVED' THEN pack_version+1 ELSE pack_version END,
      pack_data=$2::jsonb,status='GENERATED',pack_url='/api/gm/device-lang/pack/'||lang_code||'.js',updated_at=now()
      WHERE lang_code=$1 RETURNING lang_code,status,pack_version`,[lang,JSON.stringify(data)]);
    if(!r.rows.length)return fail(res,404,'language not found');
    ok(res,{item:r.rows[0],pack_count:data.length});
  }catch(e){fail(res,500,'review file import failed',{detail:String(e&&e.message||e)});}
});

router.post('/api/gm/builder/device-lang/:lang/approve',async(req,res)=>{
  const db=dbFrom(req),lang=normLang(req.params.lang);
  if(!lang||BUILTIN.has(lang))return fail(res,400,'extension language only');
  try{
    const sourceCount=Number((await db.query(`SELECT COUNT(*)::bigint AS n FROM gm_ui_dictionary_source`)).rows[0].n||0);
    const r0=await db.query(`SELECT status,pack_data FROM gm_device_language WHERE lang_code=$1`,[lang]);
    if(!r0.rows.length)return fail(res,404,'language not found');
    const data=Array.isArray(r0.rows[0].pack_data)?r0.rows[0].pack_data:[];
    if(data.length!==sourceCount)return fail(res,400,'pack count mismatch',{source_count:sourceCount,pack_count:data.length});
    const missing=data.filter(x=>!x||!String(x[0]||'').trim()||!String(x[2]||'').trim());
    if(missing.length)return fail(res,400,'pack has empty rows',{empty_count:missing.length});
    const ph=data.filter(x=>placeholders(x[1])!==placeholders(x[2]));
    if(ph.length)return fail(res,400,'pack placeholder mismatch',{issue_count:ph.length});
    const r=await db.query(`UPDATE gm_device_language SET status='APPROVED',pack_url='/api/gm/device-lang/pack/'||lang_code||'.js',updated_at=now()
      WHERE lang_code=$1 AND status='GENERATED' RETURNING lang_code,status,pack_version,pack_url`,[lang]);
    if(!r.rows.length)return fail(res,409,'only GENERATED pack can be approved');
    ok(res,{item:r.rows[0]});
  }catch(e){fail(res,500,'approve failed',{detail:String(e&&e.message||e)});}
});

module.exports=router;
