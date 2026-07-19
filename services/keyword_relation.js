'use strict';

const LANGS = ['ko','en','zh','vi','ja','tw','th','uz','ne','km','id','tl','mn','my','kk','si','ru','bn','ur','lo','hi','tr','fa','es','fr'];

function cleanText(v){ return String(v == null ? '' : v).replace(/[\u00A0\u200B-\u200D\uFEFF]/g,' ').replace(/\s+/g,' ').trim(); }
function normalizeLang(v){
  let s=cleanText(v).toLowerCase().replace('_','-').split('-')[0];
  if(s==='kr') s='ko'; if(s==='cn') s='zh'; if(s==='jp') s='ja'; if(s==='vn') s='vi';
  return LANGS.includes(s) ? s : 'ko';
}
function norm(v){ return cleanText(v).toLowerCase().replace(/[\s"'“”‘’.,/\\|_\-()\[\]{}]+/g,''); }
function uniq(arr){
  const seen=new Set();
  return (Array.isArray(arr)?arr:(typeof arr==='string'?arr.split(/[|,\n\t]+/g):[])).map(cleanText).filter(Boolean).filter(v=>{const k=norm(v); if(!k||seen.has(k)) return false; seen.add(k); return true;});
}
function pickMeta(payload){
  const p=payload||{}; const m=p.searchKeywordMeta||p.keywordMeta||p.keyword_meta||p.search_keyword_meta||{};
  const gm_lang=normalizeLang(m.gm_lang||m.gmLang||m.lang||p.gm_lang||p.gmLang||p.lang||p.keyword_lang_code||p.keywordLangCode||'ko');
  const keyword_ko=cleanText(m.mainKeywordKo||m.main_keyword_ko||m.mainKeyword||m.normalizedKeyword||p.mainKeywordKo||p.main_keyword_ko||p.keyword_ko||p.keywordKo||p.mainKeyword||p.keyword||p.q||'');
  const related=uniq(m.relatedKeywords||m.related_keywords||p.relatedKeywords||p.related_keywords||p.suggestKeywords||p.suggest_keywords||p.recommendKeywords||p.recommend_keywords||[]);
  return {gm_lang,keyword_ko,related};
}
let relationSchemaReadyPromise = null;
async function reconcileRelationTable(pool){
  // 개발 단계 확정 방식: 기존 구조가 정확하지 않으면 보존/변환하지 않고
  // 테이블을 삭제한 뒤 최종 3컬럼 구조로 새로 만든다.
  const client=await pool.connect();
  try{
    await client.query('BEGIN');

    const exists=await client.query(`
      SELECT to_regclass('public.gm_keyword_relation') AS table_name
    `);

    let exact=false;
    if(exists.rows[0]&&exists.rows[0].table_name){
      const columns=await client.query(`
        SELECT column_name,data_type,is_nullable,ordinal_position
          FROM information_schema.columns
         WHERE table_schema='public'
           AND table_name='gm_keyword_relation'
         ORDER BY ordinal_position
      `);
      const names=(columns.rows||[]).map(r=>r.column_name);
      exact=(
        names.length===3 &&
        names[0]==='gm_lang' &&
        names[1]==='keyword_ko' &&
        names[2]==='related_keyword_ko'
      );
    }

    if(!exact){
      await client.query('DROP TABLE IF EXISTS gm_keyword_relation CASCADE');
      await client.query(`CREATE TABLE gm_keyword_relation (
        gm_lang VARCHAR(10) NOT NULL,
        keyword_ko TEXT NOT NULL,
        related_keyword_ko TEXT NOT NULL,
        CONSTRAINT gm_keyword_relation_pkey
          PRIMARY KEY (gm_lang,keyword_ko,related_keyword_ko)
      )`);
      console.log('[GM_KEYWORD_RELATION_RECREATE_OK]', {
        columns:['gm_lang','keyword_ko','related_keyword_ko']
      });
    }

    await client.query('COMMIT');
  }catch(err){
    try{await client.query('ROLLBACK');}catch(_rollback){}
    console.error('[GM_KEYWORD_RELATION_RECREATE_ERROR]', {
      message:err&&err.message,
      code:err&&err.code
    });
    throw err;
  }finally{
    client.release();
  }
}
async function ensureRelationTable(pool){
  if(!relationSchemaReadyPromise){
    relationSchemaReadyPromise=reconcileRelationTable(pool).catch(err=>{
      relationSchemaReadyPromise=null;
      throw err;
    });
  }
  return relationSchemaReadyPromise;
}
function normalizeRows(params){
  const p=params||{}; const meta=pickMeta(p); const rows=[]; const seen=new Set();
  const inputRows=Array.isArray(p.rows)?p.rows:(Array.isArray(p.relatedKeywordRows)?p.relatedKeywordRows:[]);
  function push(r){
    r=r||{};
    const gm_lang=normalizeLang(r.gm_lang||r.gmLang||r.lang||meta.gm_lang);
    const keyword_ko=cleanText(r.keyword_ko||r.keywordKo||r.keyword||r.mainKeyword||meta.keyword_ko);
    const related_keyword_ko=cleanText(r.related_keyword_ko||r.relatedKeywordKo||r.related_keyword||r.relatedKeyword||r.value||r.text||'');
    if(!keyword_ko||!related_keyword_ko) return;
    const sig=gm_lang+'|'+norm(keyword_ko)+'|'+norm(related_keyword_ko);
    if(seen.has(sig)) return; seen.add(sig); rows.push({gm_lang,keyword_ko,related_keyword_ko});
  }
  inputRows.forEach(push);
  meta.related.forEach(v=>push({gm_lang:meta.gm_lang,keyword_ko:meta.keyword_ko,related_keyword_ko:v}));
  return rows.slice(0,100);
}
async function saveRelations(pool, params){
  await ensureRelationTable(pool);
  const rows=normalizeRows(params); let saved=0,updated=0;
  for(const row of rows){
    const r=await pool.query(`INSERT INTO gm_keyword_relation (gm_lang,keyword_ko,related_keyword_ko)
      VALUES ($1,$2,$3)
      ON CONFLICT (gm_lang,keyword_ko,related_keyword_ko) DO NOTHING
      RETURNING 1`,[row.gm_lang,row.keyword_ko,row.related_keyword_ko]);
    if(r.rowCount) saved++; else updated++;
  }
  return {ok:true,received:rows.length,saved,updated,mode:'gm_lang_keyword_ko_related_keyword_ko'};
}
async function relationStatus(pool, params){
  await ensureRelationTable(pool);
  const meta=pickMeta(params||{}); const related=meta.related;
  if(!meta.keyword_ko||!related.length) return {ok:true,gm_lang:meta.gm_lang,keyword_ko:meta.keyword_ko,related_count:related.length,pending:[],complete:[],missing:[]};
  const r=await pool.query(`SELECT v.related_keyword_ko,
    CASE WHEN gr.related_keyword_ko IS NULL THEN 'F' ELSE 'T' END AS saved
    FROM unnest($3::text[]) AS v(related_keyword_ko)
    LEFT JOIN gm_keyword_relation gr ON gr.gm_lang=$1 AND gr.keyword_ko=$2 AND gr.related_keyword_ko=v.related_keyword_ko`,[meta.gm_lang,meta.keyword_ko,related]);
  const pending=[],complete=[],missing=[];
  for(const row of r.rows||[]){ const k=cleanText(row.related_keyword_ko); if(row.saved==='T') complete.push(k); else {pending.push(k);missing.push({related_keyword_ko:k,saved:'F'});} }
  return {ok:true,gm_lang:meta.gm_lang,keyword_ko:meta.keyword_ko,related_count:related.length,pending,complete,pending_count:pending.length,complete_count:complete.length,missing};
}
async function captureProductKeywordMeta(pool, productUid, payload){
  const meta=pickMeta(payload||{});
  if(productUid&&meta.keyword_ko){ try{await pool.query('UPDATE gm_product SET keyword=$1,updated_at=now() WHERE product_uid=$2',[meta.keyword_ko,productUid]);}catch(_e){} }
  if(!meta.keyword_ko||!meta.related.length) return {saved:0,updated:0,received:0};
  return saveRelations(pool,{gm_lang:meta.gm_lang,keyword_ko:meta.keyword_ko,relatedKeywords:meta.related});
}

async function ensureTranslateTable(pool){
  await pool.query(`CREATE TABLE IF NOT EXISTS gm_keyword_translate (
    lang TEXT NOT NULL,
    input_keyword TEXT NOT NULL,
    main_keyword_ko TEXT NOT NULL,
    keyword_ko TEXT,
    device_lang TEXT NOT NULL DEFAULT '',
    hit_count INTEGER NOT NULL DEFAULT 1,
    updated_at DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at DATE NOT NULL DEFAULT CURRENT_DATE,
    translate_complete CHAR(1) NOT NULL DEFAULT 'F',
    PRIMARY KEY (lang,input_keyword)
  )`);
  try{await pool.query(`ALTER TABLE gm_keyword_translate ADD COLUMN IF NOT EXISTS device_lang TEXT NOT NULL DEFAULT ''`);}catch(_e){}
  for(const l of LANGS){ try{await pool.query(`ALTER TABLE gm_keyword_translate ADD COLUMN IF NOT EXISTS keyword_${l} TEXT`);}catch(_e){} }
}
function pickTranslations(p){
  p=p||{};
  // 모바일 payload는 mainKeywordTranslations를 최상위에도 보내고,
  // keywordTranslations.mainKeywordTranslations 안에도 한 번 더 감싸서 보낸다.
  // 기존 코드는 keywordTranslations 객체를 먼저 선택해 실제 언어값을 놓쳤다.
  const roots=[
    p.translations,
    p.mainKeywordTranslations,
    p.main_keyword_translations,
    p.keywordTranslations&&p.keywordTranslations.mainKeywordTranslations,
    p.keywordTranslations&&p.keywordTranslations.main_keyword_translations,
    p.keyword_translations&&p.keyword_translations.mainKeywordTranslations,
    p.keyword_translations&&p.keyword_translations.main_keyword_translations,
    p.keywordTranslations,
    p.keyword_translations
  ].filter(v=>v&&typeof v==='object');
  const out={};
  for(const l of LANGS){
    let value='';
    for(const root of roots){
      value=cleanText(root[l]||root['keyword_'+l]||'');
      if(value) break;
    }
    out[l]=value||cleanText(p['keyword_'+l]||'');
  }
  return out;
}
async function saveKeywordTranslate(pool,payload){
  await ensureTranslateTable(pool); const p=payload||{}; const meta=pickMeta(p);
  const main=cleanText(p.main_keyword_ko||p.mainKeywordKo||p.keyword_ko||p.keywordKo||meta.keyword_ko||p.keyword||'');
  const input=cleanText(p.input_keyword||p.inputKeyword||p.keyword||main); const lang=normalizeLang(p.gm_lang||p.lang||'ko');
  // device_lang is the Android/browser BCP-47 tag captured at search time.
  // Keep the original tag (vi-VN, zh-TW, en-US, etc.) and never replace an existing value with empty data.
  const deviceLang=cleanText(p.device_lang||p.deviceLang||(p.searchKeywordMeta&&(p.searchKeywordMeta.device_lang||p.searchKeywordMeta.deviceLang))||'');
  if(!main) return {mainKeyword:'',saved:0};
  const tr=pickTranslations(p); tr.ko=tr.ko||main; if(lang!=='ko'&&input) tr[lang]=tr[lang]||input;
  const translatedCount=LANGS.filter(l=>!!tr[l]).length;
  const missingLangs=LANGS.filter(l=>!tr[l]);
  console.log('[GM_KEYWORD_TRANSLATE_PAYLOAD]', {
    input_keyword:input,
    main_keyword_ko:main,
    translated_count:translatedCount,
    missing_langs:missingLangs,
    device_lang:deviceLang
  });
  // 횡렬 구조에서는 keyword_ko도 LANGS의 ko 항목에서 한 번만 생성한다.
  // 별도 keyword_ko 선언과 LANGS 반복을 함께 사용하면 INSERT 컬럼이 중복된다.
  const cols=['lang','input_keyword','main_keyword_ko','device_lang','hit_count','updated_at','created_at','translate_complete']
    .concat(LANGS.map(l=>'keyword_'+l));
  const complete=LANGS.every(l=>!!tr[l])?'T':'F';
  const today=new Date().toISOString().slice(0,10);
  const vals=['all',input,main,deviceLang,1,today,today,complete]
    .concat(LANGS.map(l=>tr[l]||''));
  const upd=[
    'main_keyword_ko=EXCLUDED.main_keyword_ko',
    "device_lang=CASE WHEN EXCLUDED.device_lang='' THEN gm_keyword_translate.device_lang ELSE EXCLUDED.device_lang END",
    'hit_count=gm_keyword_translate.hit_count+1',
    'updated_at=CURRENT_DATE',
    "translate_complete=CASE WHEN EXCLUDED.translate_complete='T' THEN 'T' ELSE gm_keyword_translate.translate_complete END"
  ];
  for(const l of LANGS){
    upd.push(`keyword_${l}=CASE WHEN EXCLUDED.keyword_${l}='' THEN gm_keyword_translate.keyword_${l} ELSE EXCLUDED.keyword_${l} END`);
  }
  await pool.query(`INSERT INTO gm_keyword_translate (${cols.join(',')}) VALUES (${vals.map((_,i)=>'$'+(i+1)).join(',')}) ON CONFLICT (lang,input_keyword) DO UPDATE SET ${upd.join(',')}`,vals);
  const relation=await saveRelations(pool,Object.assign({},p,{gm_lang:lang,keyword_ko:main}));
  return {mainKeyword:main,inputKeyword:input,lang,device_lang:deviceLang,alias_saved:1,relation_saved:relation.saved,relation_existing:relation.updated,related_count:relation.received};
}

module.exports={LANGS,normalizeLang,pickMeta,ensureRelationTable,saveRelations,relationStatus,captureProductKeywordMeta,ensureTranslateTable,saveKeywordTranslate};
