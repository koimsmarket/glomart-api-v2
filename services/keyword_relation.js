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
  // Existing databases may already have the old 30-column table and migration 26
  // is not re-run automatically. Reconcile it in place once per server process.
  await pool.query(`CREATE TABLE IF NOT EXISTS gm_keyword_relation (
    gm_lang VARCHAR(10),
    keyword_ko TEXT,
    related_keyword_ko TEXT
  )`);
  await pool.query('ALTER TABLE gm_keyword_relation ADD COLUMN IF NOT EXISTS gm_lang VARCHAR(10)');
  await pool.query('ALTER TABLE gm_keyword_relation ADD COLUMN IF NOT EXISTS keyword_ko TEXT');
  await pool.query('ALTER TABLE gm_keyword_relation ADD COLUMN IF NOT EXISTS related_keyword_ko TEXT');

  await pool.query(`DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='gm_keyword_relation' AND column_name='keyword') THEN
      EXECUTE 'UPDATE gm_keyword_relation SET keyword_ko=COALESCE(NULLIF(BTRIM(keyword_ko),''''),NULLIF(BTRIM(keyword::text),'''')) WHERE keyword_ko IS NULL OR BTRIM(keyword_ko)=''''';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='gm_keyword_relation' AND column_name='related_keyword') THEN
      EXECUTE 'UPDATE gm_keyword_relation SET related_keyword_ko=COALESCE(NULLIF(BTRIM(related_keyword_ko),''''),NULLIF(BTRIM(related_keyword::text),'''')) WHERE related_keyword_ko IS NULL OR BTRIM(related_keyword_ko)=''''';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='gm_keyword_relation' AND column_name='lang') THEN
      EXECUTE 'UPDATE gm_keyword_relation SET gm_lang=COALESCE(NULLIF(BTRIM(gm_lang),''''),NULLIF(BTRIM(lang::text),'''')) WHERE gm_lang IS NULL OR BTRIM(gm_lang)=''''';
    END IF;
  END $$`);

  await pool.query(`UPDATE gm_keyword_relation
    SET gm_lang=CASE WHEN COALESCE(keyword_ko,'') ~ '[가-힣]' THEN 'ko' ELSE 'en' END
    WHERE gm_lang IS NULL OR BTRIM(gm_lang)=''`);
  await pool.query(`UPDATE gm_keyword_relation SET gm_lang=LOWER(SPLIT_PART(REPLACE(gm_lang,'_','-'),'-',1))`);
  await pool.query(`UPDATE gm_keyword_relation SET gm_lang=CASE gm_lang WHEN 'kr' THEN 'ko' WHEN 'cn' THEN 'zh' WHEN 'jp' THEN 'ja' WHEN 'vn' THEN 'vi' ELSE gm_lang END`);
  await pool.query(`DELETE FROM gm_keyword_relation WHERE COALESCE(BTRIM(keyword_ko),'')='' OR COALESCE(BTRIM(related_keyword_ko),'')=''`);
  await pool.query(`DELETE FROM gm_keyword_relation a USING gm_keyword_relation b
    WHERE a.ctid < b.ctid AND a.gm_lang=b.gm_lang AND a.keyword_ko=b.keyword_ko AND a.related_keyword_ko=b.related_keyword_ko`);

  await pool.query(`DO $$
  DECLARE c RECORD; r RECORD;
  BEGIN
    FOR r IN SELECT conname FROM pg_constraint WHERE conrelid='gm_keyword_relation'::regclass AND contype IN ('p','u') LOOP
      EXECUTE format('ALTER TABLE gm_keyword_relation DROP CONSTRAINT IF EXISTS %I',r.conname);
    END LOOP;
    FOR c IN SELECT column_name FROM information_schema.columns
      WHERE table_schema=current_schema() AND table_name='gm_keyword_relation'
        AND column_name NOT IN ('gm_lang','keyword_ko','related_keyword_ko')
    LOOP
      EXECUTE format('ALTER TABLE gm_keyword_relation DROP COLUMN IF EXISTS %I CASCADE',c.column_name);
    END LOOP;
  END $$`);
  await pool.query('ALTER TABLE gm_keyword_relation ALTER COLUMN gm_lang SET NOT NULL');
  await pool.query('ALTER TABLE gm_keyword_relation ALTER COLUMN keyword_ko SET NOT NULL');
  await pool.query('ALTER TABLE gm_keyword_relation ALTER COLUMN related_keyword_ko SET NOT NULL');
  await pool.query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='gm_keyword_relation'::regclass AND conname='gm_keyword_relation_pkey') THEN
      ALTER TABLE gm_keyword_relation ADD CONSTRAINT gm_keyword_relation_pkey PRIMARY KEY (gm_lang,keyword_ko,related_keyword_ko);
    END IF;
  END $$`);
}
async function ensureRelationTable(pool){
  if(!relationSchemaReadyPromise){
    relationSchemaReadyPromise=reconcileRelationTable(pool).catch(err=>{ relationSchemaReadyPromise=null; throw err; });
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
  return rows.slice(0,5000);
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
    hit_count INTEGER NOT NULL DEFAULT 1,
    updated_at DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at DATE NOT NULL DEFAULT CURRENT_DATE,
    translate_complete CHAR(1) NOT NULL DEFAULT 'F',
    PRIMARY KEY (lang,input_keyword)
  )`);
  for(const l of LANGS){ try{await pool.query(`ALTER TABLE gm_keyword_translate ADD COLUMN IF NOT EXISTS keyword_${l} TEXT`);}catch(_e){} }
}
function pickTranslations(p){
  p=p||{}; const root=p.translations||p.keywordTranslations||p.keyword_translations||p.mainKeywordTranslations||p.main_keyword_translations||{}; const out={};
  for(const l of LANGS){ out[l]=cleanText(root[l]||root['keyword_'+l]||p['keyword_'+l]||''); }
  return out;
}
async function saveKeywordTranslate(pool,payload){
  await ensureTranslateTable(pool); const p=payload||{}; const meta=pickMeta(p);
  const main=cleanText(p.main_keyword_ko||p.mainKeywordKo||p.keyword_ko||p.keywordKo||meta.keyword_ko||p.keyword||'');
  const input=cleanText(p.input_keyword||p.inputKeyword||p.keyword||main); const lang=normalizeLang(p.gm_lang||p.lang||'ko');
  if(!main) return {mainKeyword:'',saved:0};
  const tr=pickTranslations(p); tr.ko=tr.ko||main; if(lang!=='ko'&&input) tr[lang]=tr[lang]||input;
  const cols=['lang','input_keyword','main_keyword_ko','keyword_ko','hit_count','updated_at','created_at','translate_complete'].concat(LANGS.map(l=>'keyword_'+l));
  const vals=['all',main,main,main,1,new Date().toISOString().slice(0,10),new Date().toISOString().slice(0,10),LANGS.every(l=>!!tr[l])?'T':'F'].concat(LANGS.map(l=>tr[l]||''));
  const upd=['main_keyword_ko=EXCLUDED.main_keyword_ko','keyword_ko=EXCLUDED.keyword_ko','hit_count=gm_keyword_translate.hit_count+1','updated_at=CURRENT_DATE'];
  for(const l of LANGS) upd.push(`keyword_${l}=CASE WHEN EXCLUDED.keyword_${l}='' THEN gm_keyword_translate.keyword_${l} ELSE EXCLUDED.keyword_${l} END`);
  await pool.query(`INSERT INTO gm_keyword_translate (${cols.join(',')}) VALUES (${vals.map((_,i)=>'$'+(i+1)).join(',')}) ON CONFLICT (lang,input_keyword) DO UPDATE SET ${upd.join(',')}`,vals);
  const relation=await saveRelations(pool,Object.assign({},p,{gm_lang:lang,keyword_ko:main}));
  return {mainKeyword:main,inputKeyword:input,lang,alias_saved:1,relation_saved:relation.saved,relation_existing:relation.updated,related_count:relation.received};
}

module.exports={LANGS,normalizeLang,pickMeta,ensureRelationTable,saveRelations,relationStatus,captureProductKeywordMeta,ensureTranslateTable,saveKeywordTranslate};
