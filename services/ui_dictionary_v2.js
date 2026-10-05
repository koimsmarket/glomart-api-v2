'use strict';
// GM_UI_DICTIONARY_V005
// Reuses the existing gm_ui_dictionary + GM_MATCH_ENGINE slot contract (%d/%m/%s).
// V2 policy: Korean UI phrase -> normalize safe dynamic values -> reuse/create GM_CODE
// -> accumulate source/use counters -> fill missing 24 translations. Never auto-remove.

const LANGS=['kr','en','zh','vi','ja','tw','th','uz','ne','km','id','tl','mn','my','kk','si','ru','bn','ur','lo','hi','tr','fa','es','fr'];
const TARGET={tw:'zh-TW'};
const FOREIGN=LANGS.filter(x=>x!=='kr');
const MAX_SOURCE_LOCATORS=120;
const TRANSLATING=new Map();
const TRANSLATE_QUEUE=[];
const QUEUED=new Set();
let TRANSLATE_ACTIVE=0;
const TRANSLATE_CONCURRENCY=2;

function s(v){return String(v==null?'':v).replace(/\s+/g,' ').trim();}
function hasKo(v){return /[가-힣]/.test(String(v||''));}
function safeApp(v){v=s(v).toUpperCase();return v==='GUPPY'?'GUPPY':'GLOMART';}
function safeSurface(v){return s(v).replace(/[^A-Za-z0-9_\-/.]/g,'_').slice(0,120)||'UNKNOWN';}
function safeLocator(v){return s(v).slice(0,500);}
function safePage(v){return s(v).slice(0,240);}
function cleanText(v){let x=s(v).replace(/<[^>]+>/g,' ').replace(/\{\$[^}]+\}/g,' ').replace(/\s+/g,' ').trim();return x.length>500?'':x;}
function needsTranslation(row){return !row || s(row.translation_status)!=='READY' || FOREIGN.some(l=>!s(row[l]));}

// Important: do not normalize every number. Existing static UI numbers such as 1:1,
// 10초/30초, 24시간 can be semantic controls. Only clearly dynamic patterns become slots.
function normalizeTemplate(raw){
  let text=cleanText(raw);
  if(!text||!hasKo(text)) return {ok:false,reason:'NO_KO',raw:text,template:''};
  let changed=false;

  // Money: GM_MATCH_ENGINE %m preserves and restores the complete money token.
  text=text.replace(/(?:[₩￦]\s*)?\d{1,3}(?:,\d{3})+(?:\.\d+)?\s*원|(?:[₩￦]\s*)?\d+(?:\.\d+)?\s*원/g,function(){changed=true;return '%m';});

  // Korean dates - units stay translatable, only numeric values become slots.
  text=text.replace(/(20\d{2})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/g,function(){changed=true;return '%d년 %d월 %d일';});
  text=text.replace(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/g,function(){changed=true;return '%d월 %d일';});

  // Time with a real minute field. 1:1 is intentionally not matched.
  text=text.replace(/\b(?:[01]?\d|2[0-3]):[0-5]\d\b/g,function(){changed=true;return '%s';});

  // Integer percentages.
  text=text.replace(/\b\d{1,3}\s*%/g,function(){changed=true;return '%d%';});

  // Clearly variable counters only. Seconds/minutes/hours are intentionally excluded.
  text=text.replace(/\b\d+\s*(?=(?:개|명|건|회|쪽|페이지|번째)(?:\s|의|이|가|을|를|은|는|$))/g,function(){changed=true;return '%d';});

  text=s(text);
  // If unclassified digits remain, keep the exact phrase only when it has an explicit GM code.
  // Caller decides whether an ambiguous auto-code phrase is safe to create.
  return {ok:true,raw:cleanText(raw),template:text,changed,has_variable:changed||/%[dsm]/.test(text),has_unclassified_digit:/\d/.test(text)};
}

function sourceKey(row){
  return [safeApp(row.source_app),safeSurface(row.source_surface),safePage(row.page_name||row.page),safeLocator(row.source_locator||row.locator)].join('|');
}
function mergeSourceMap(current,row,increment){
  let map={};
  try{map=(current&&typeof current==='object'&&!Array.isArray(current))?JSON.parse(JSON.stringify(current)):{};}catch(_e){map={};}
  const app=safeApp(row.source_app),surface=safeSurface(row.source_surface),page=safePage(row.page_name||row.page),locator=safeLocator(row.source_locator||row.locator),now=new Date().toISOString();
  if(!map[app]||typeof map[app]!=='object')map[app]={};
  if(!map[app][surface]||typeof map[app][surface]!=='object')map[app][surface]={count:0,last_used_at:null,locations:{}};
  const bucket=map[app][surface];
  bucket.count=Number(bucket.count||0)+(increment?1:0);
  if(increment)bucket.last_used_at=now;
  if(!bucket.locations||typeof bucket.locations!=='object')bucket.locations={};
  const key=(page||'')+'#'+(locator||'');
  if(key!=='#'){
    if(!bucket.locations[key]&&Object.keys(bucket.locations).length<MAX_SOURCE_LOCATORS)bucket.locations[key]={count:0,last_used_at:null};
    if(bucket.locations[key]){
      bucket.locations[key].count=Number(bucket.locations[key].count||0)+(increment?1:0);
      if(increment)bucket.locations[key].last_used_at=now;
    }
  }
  return map;
}

function protect(text){
  const tokens=[];
  const safe=String(text||'').replace(/(%[dsm]|https?:\/\/[^\s)\]}>,”"']+|\{\$[^}]+\}|<\/?[A-Za-z][^>]*>)/g,m=>{const k='ZZGMKEEP'+tokens.length+'ZZ';tokens.push(m);return k;});
  return {safe,restore(out){let x=String(out==null?'':out);for(let i=0;i<tokens.length;i++)x=x.replace(new RegExp('ZZGMKEEP\\s*'+i+'ZZ','g'),tokens[i]);return x;}};
}
async function translateOne(text,lang){
  const p=protect(text),target=TARGET[lang]||lang;
  const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),8000);
  try{
    const url='https://translate.googleapis.com/translate_a/single?client=gtx&sl=ko&tl='+encodeURIComponent(target)+'&dt=t&q='+encodeURIComponent(p.safe);
    const r=await fetch(url,{headers:{accept:'application/json'},signal:ctrl.signal});
    if(!r.ok)throw new Error('translate_http_'+r.status);
    const j=await r.json();let out='';if(j&&Array.isArray(j[0]))for(const z of j[0])if(z&&z[0])out+=z[0];
    out=s(p.restore(out));
    // Slot contract must survive translation exactly.
    const srcSlots=(String(text).match(/%[dsm]/g)||[]).join('|');
    const outSlots=(String(out).match(/%[dsm]/g)||[]).join('|');
    if(srcSlots!==outSlots)throw new Error('slot_mismatch_'+lang+'_'+srcSlots+'_'+outSlots);
    return out;
  }finally{clearTimeout(timer);}
}
async function fillTranslations(db,gmCode){
  gmCode=s(gmCode).toUpperCase();if(!gmCode)return {ok:false};
  const q=await db.query(`SELECT * FROM gm_ui_dictionary WHERE gm_code=$1`,[gmCode]);
  const row=q.rows[0];if(!row)return {ok:false,reason:'NOT_FOUND'};
  const kr=s(row.kr);if(!kr)return {ok:false,reason:'EMPTY_KR'};
  const need=FOREIGN.filter(l=>!s(row[l]));
  if(!need.length){await db.query(`UPDATE gm_ui_dictionary SET translation_status='READY' WHERE gm_code=$1`,[gmCode]);return {ok:true,ready:true,translated:0};}
  await db.query(`UPDATE gm_ui_dictionary SET translation_status='TRANSLATING' WHERE gm_code=$1`,[gmCode]);
  const done={};let failed=[];
  for(let i=0;i<need.length;i+=6){
    const part=need.slice(i,i+6);
    const vals=await Promise.all(part.map(async l=>{try{return [l,await translateOne(kr,l),''];}catch(e){return [l,'',String(e&&e.message||e)];}}));
    for(const [l,v,e] of vals){if(v)done[l]=v;else failed.push({lang:l,error:e});}
  }
  const keys=Object.keys(done);
  if(keys.length){
    const sets=[],vals=[gmCode];keys.forEach((l,i)=>{sets.push(`${l}=$${i+2}`);vals.push(done[l]);});
    sets.push(`updated_at=now()`);
    await db.query(`UPDATE gm_ui_dictionary SET ${sets.join(',')} WHERE gm_code=$1`,vals);
  }
  const check=(await db.query(`SELECT ${FOREIGN.join(',')} FROM gm_ui_dictionary WHERE gm_code=$1`,[gmCode])).rows[0]||{};
  const missing=FOREIGN.filter(l=>!s(check[l]));
  await db.query(`UPDATE gm_ui_dictionary SET translation_status=$2 WHERE gm_code=$1`,[gmCode,missing.length?'PARTIAL':'READY']);
  return {ok:true,translated:keys.length,missing,failed};
}
function pumpTranslationQueue(){
  while(TRANSLATE_ACTIVE<TRANSLATE_CONCURRENCY && TRANSLATE_QUEUE.length){
    const job=TRANSLATE_QUEUE.shift(),code=job.code,db=job.db;
    QUEUED.delete(code);TRANSLATE_ACTIVE++;
    const p=Promise.resolve().then(()=>fillTranslations(db,code)).catch(e=>{try{console.warn('[GM_UI_DICTIONARY_V2_TRANSLATE_FAIL]',code,String(e&&e.message||e));}catch(_e){}}).finally(()=>{TRANSLATING.delete(code);TRANSLATE_ACTIVE--;pumpTranslationQueue();});
    TRANSLATING.set(code,p);
  }
}
function queueTranslations(db,codes){
  for(const raw of codes||[]){
    const code=s(raw).toUpperCase();if(!code||TRANSLATING.has(code)||QUEUED.has(code))continue;
    QUEUED.add(code);TRANSLATE_QUEUE.push({db,code});
  }
  pumpTranslationQueue();
}
async function nextCode(client){
  await client.query(`SELECT pg_advisory_xact_lock(hashtext('gm_ui_dictionary_code')::bigint)`);
  const r=await client.query(`SELECT COALESCE(MAX(NULLIF(regexp_replace(gm_code,'\\D','','g'),'')::bigint),0)+1 AS n FROM gm_ui_dictionary WHERE gm_code ~ '^GM_[0-9]+$'`);
  return 'GM_'+String(r.rows[0].n).padStart(4,'0');
}
async function observe(db,input,opt={}){
  const norm=normalizeTemplate(input.source_text_ko||input.text||'');
  if(!norm.ok)return {skip:true,reason:norm.reason};
  const explicit=s(input.gm_code||input.gmCode).toUpperCase();
  if(!explicit && norm.has_unclassified_digit)return {skip:true,reason:'AMBIGUOUS_NUMBER',text:norm.raw};
  const app=safeApp(input.source_app||input.sourceApp),surface=safeSurface(input.source_surface||input.sourceSurface||input.page_name||input.page),page=safePage(input.page_name||input.page),locator=safeLocator(input.source_locator||input.locator);
  const increment=opt.incrementUsage!==false;
  const variableYn=norm.has_variable?'Y':'N';
  const client=await db.connect();
  try{
    await client.query('BEGIN');
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1)::bigint)`,['gm_ui_dictionary_phrase:'+norm.template]);
    let row=null;
    if(/^GM_\d{4,}$/.test(explicit))row=(await client.query(`SELECT * FROM gm_ui_dictionary WHERE gm_code=$1 FOR UPDATE`,[explicit])).rows[0]||null;
    if(!row)row=(await client.query(`SELECT * FROM gm_ui_dictionary WHERE kr=$1 ORDER BY gm_code LIMIT 1 FOR UPDATE`,[norm.template])).rows[0]||null;
    let code='',created=false,changed=false;
    if(!row){
      code=(/^GM_\d{4,}$/.test(explicit)&&!(await client.query(`SELECT 1 FROM gm_ui_dictionary WHERE gm_code=$1`,[explicit])).rowCount)?explicit:await nextCode(client);
      const sm=mergeSourceMap({}, {source_app:app,source_surface:surface,page_name:page,source_locator:locator},increment);
      await client.query(`INSERT INTO gm_ui_dictionary(gm_code,page_name,kr,active_yn,translation_status,source_map,use_count,last_used_at,has_variable) VALUES($1,$2,$3,'Y','NEW',$4::jsonb,$5::bigint,CASE WHEN $5::bigint>0 THEN now() END,$6)`,[code,page,norm.template,JSON.stringify(sm),increment?1:0,variableYn]);
      created=true;
    }else{
      code=s(row.gm_code).toUpperCase();
      if(/^GM_\d{4,}$/.test(explicit)&&code===explicit&&s(row.kr)!==norm.template){
        await client.query(`INSERT INTO gm_ui_dictionary_history(gm_code,old_kr,new_kr,change_type,source_file,source_locator,source_type) VALUES($1,$2,$3,'CHANGED',$4,$5,$6)`,[code,row.kr||'',norm.template,page,locator,'RUNTIME_V2']);
        const clear=FOREIGN.map(l=>`${l}=''`).join(',');
        await client.query(`UPDATE gm_ui_dictionary SET kr=$2,${clear},translation_status='RECHECK',active_yn='Y',has_variable=$3,updated_at=now() WHERE gm_code=$1`,[code,norm.template,variableYn]);
        row.kr=norm.template;row.has_variable=variableYn;changed=true;
      }else if(s(row.has_variable)!==variableYn){
        await client.query(`UPDATE gm_ui_dictionary SET has_variable=$2 WHERE gm_code=$1`,[code,variableYn]);
        row.has_variable=variableYn;
      }
      const sm=mergeSourceMap(row.source_map||{}, {source_app:app,source_surface:surface,page_name:page,source_locator:locator},increment);
      await client.query(`UPDATE gm_ui_dictionary SET source_map=$2::jsonb,use_count=use_count+$3::bigint,last_used_at=CASE WHEN $3::bigint>0 THEN now() ELSE last_used_at END WHERE gm_code=$1`,[code,JSON.stringify(sm),increment?1:0]);
    }
    await client.query('COMMIT');
    return {ok:true,gm_code:code,template:norm.template,has_variable:variableYn,created,changed,needs_translation:created||changed||needsTranslation(row)};
  }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}
}

async function captureMany(db,items,opt={}){
  const stats={received:items.length,created:0,changed:0,reused:0,skipped:0,ambiguous_number:0,translate_codes:[]};
  for(const item of items){
    const r=await observe(db,item,opt);
    if(r.skip){stats.skipped++;if(r.reason==='AMBIGUOUS_NUMBER')stats.ambiguous_number++;continue;}
    if(r.created)stats.created++;else if(r.changed)stats.changed++;else stats.reused++;
    if(r.needs_translation)stats.translate_codes.push(r.gm_code);
  }
  stats.translate_codes=Array.from(new Set(stats.translate_codes));
  return stats;
}
async function retryPending(db,limit=20){
  limit=Math.max(1,Math.min(100,Number(limit||20)));
  const where=FOREIGN.map(l=>`COALESCE(${l},'')=''`).join(' OR ');
  const r=await db.query(`SELECT gm_code FROM gm_ui_dictionary WHERE active_yn='Y' AND (translation_status<>'READY' OR ${where}) ORDER BY updated_at ASC LIMIT $1`,[limit]);
  const out=[];for(const x of r.rows)out.push({gm_code:x.gm_code,result:await fillTranslations(db,x.gm_code)});return out;
}

module.exports={LANGS,FOREIGN,normalizeTemplate,observe,captureMany,queueTranslations,fillTranslations,retryPending,sourceKey};
