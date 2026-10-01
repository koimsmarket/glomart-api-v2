'use strict';
// GM_PRODUCT_SPLIT_V003_KEYWORD
const {cleanText,toInt,parseIncomingPayloadBody,compactError}=require('./shared');
function normalizeKeywordValue(v){
  return cleanText(v).toLowerCase().replace(/\s+/g, '');
}
function firstKeywordText(){
  for(let i=0;i<arguments.length;i++){
    const v=cleanText(arguments[i]);
    if(v) return v;
  }
  return '';
}
function pickSearchKeyword(p, parent){
  p=p||{}; parent=parent||{};
  const m=p.searchKeywordMeta || p.keywordMeta || p.keyword_meta || p.search_keyword_meta || {};
  const pm=parent.searchKeywordMeta || parent.keywordMeta || parent.keyword_meta || parent.search_keyword_meta || {};
  // GM_PRODUCT_KEYWORD_PRIORITY_V014
  // Prefer normalized/canonical keyword metadata first, without restricting valid ASCII-only keywords such as USB/SSD/PC.
  return firstKeywordText(
    m.keyword_ko, m.keywordKo, m.main_keyword_ko, m.mainKeyword, m.mainSearchKeyword, m.normalizedKeyword, m.correctedKeyword,
    p.keyword_ko, p.keywordKo, p.main_keyword_ko, p.mainKeyword, p.mainSearchKeyword, p.normalizedKeyword, p.correctedKeyword,
    pm.keyword_ko, pm.keywordKo, pm.main_keyword_ko, pm.mainKeyword, pm.mainSearchKeyword, pm.normalizedKeyword, pm.correctedKeyword,
    parent.keyword_ko, parent.keywordKo, parent.main_keyword_ko, parent.mainKeyword, parent.mainSearchKeyword, parent.normalizedKeyword, parent.correctedKeyword,
    p.keyword, p.q, p.search_keyword, p.searchKeyword,
    parent.keyword, parent.q, parent.search_keyword, parent.searchKeyword
  );
}
function pickCategoryKeyword(p, parent, fallbackKo){
  p=p||{}; parent=parent||{};
  return firstKeywordText(fallbackKo, p.category_keyword, p.categoryKeyword, parent.category_keyword, parent.categoryKeyword);
}
function pickRelatedKeywords(p, parent){
  const raw = p.related_keywords || p.relatedKeywords || p.suggest_keywords || p.suggestKeywords ||
    p.recommend_keywords || p.recommendKeywords || p.coupang_related_keywords || p.coupangRelatedKeywords ||
    (parent && (parent.related_keywords || parent.relatedKeywords || parent.suggest_keywords || parent.suggestKeywords));
  let arr = [];
  if(Array.isArray(raw)) arr = raw;
  else if(typeof raw === 'string') arr = raw.split(/[|,\n\t]+/g);
  return arr.map(cleanText).filter(Boolean).filter((v,i,a)=>a.indexOf(v)===i).slice(0,50);
}


function uniqClean(arr){
  const seen = new Set();
  return (Array.isArray(arr) ? arr : (typeof arr === 'string' ? arr.split(/[|,\n\t]+/g) : []))
    .map(cleanText).filter(Boolean).filter(v => { const k=v.toLowerCase(); if(seen.has(k)) return false; seen.add(k); return true; });
}
function pickKeywordMeta(p){
  p = p || {};
  const meta = p.searchKeywordMeta || p.keywordMeta || p.keyword_meta || p.search_keyword_meta || {};
  const inputKeyword = cleanText(meta.inputKeyword || meta.input_keyword || p.inputKeyword || p.input_keyword || p.keyword || p.q || '');
  const correctedKeyword = cleanText(meta.correctedKeyword || meta.corrected_keyword || p.correctedKeyword || p.corrected_keyword || '');
  const mainKeyword = cleanText(meta.mainKeyword || meta.mainSearchKeyword || meta.main_search_keyword || meta.normalizedKeyword || meta.normalized_keyword || p.mainKeyword || p.mainSearchKeyword || p.normalized || p.normalizedKeyword || correctedKeyword || inputKeyword);
  const originalKeyword = cleanText(meta.originalKeyword || meta.original_keyword || p.originalKeyword || p.original_keyword || inputKeyword);
  const relatedKeywords = uniqClean(meta.relatedKeywords || meta.related_keywords || p.relatedKeywords || p.related_keywords || p.suggestKeywords || p.suggest_keywords);
  const categoryMainKeywordKo = cleanText(meta.categoryMainKeywordKo || meta.category_main_keyword_ko || p.categoryMainKeywordKo || p.category_main_keyword_ko || '');
  return { inputKeyword, correctedKeyword, originalKeyword, mainKeyword, relatedKeywords, categoryMainKeywordKo, raw:meta };
}
function pickTranslationValue(src, lang, baseKey){
  src = src || {};
  baseKey = baseKey || '';
  return cleanText(
    src[lang] || src[baseKey + '_' + lang] || src[baseKey + lang.toUpperCase()] ||
    (src[baseKey] && src[baseKey][lang]) || ''
  );
}
function pickKeywordTranslations(p, meta){
  p = p || {}; meta = meta || {};
  const root = p.keywordTranslations || p.keyword_translations || p.translations || p.translation ||
    (p.mainKeywordTranslations ? { mainKeywordTranslations:p.mainKeywordTranslations } : null) ||
    meta.keywordTranslations || meta.keyword_translations || meta.translations || {};
  const main = root.mainKeywordTranslations || root.main_keyword_translations || root.mainKeyword || root.main_keyword || root.keyword || root;
  const out = {};
  KEYWORD_LANGS.forEach(lang => {
    const v = lang === 'ko' ? (meta.mainKeyword || '') : pickTranslationValue(main, lang, 'keyword');
    if(v) out[lang] = v;
  });
  return out;
}
function pickRelatedTranslations(p, meta){
  p = p || {}; meta = meta || {};
  const root = p.relatedKeywordTranslations || p.related_keyword_translations ||
    p.relatedKeywordRows || p.related_keyword_rows ||
    (p.keywordTranslations && (p.keywordTranslations.relatedKeywordTranslations || p.keywordTranslations.relatedKeywordRows || p.keywordTranslations.related_keywords)) ||
    (meta.relatedKeywordTranslations || meta.related_keyword_translations || meta.relatedKeywordRows || meta.related_keyword_rows) || {};
  if(Array.isArray(root)){
    const out = {};
    root.forEach(row => {
      const ko = cleanText(row && (row.relatedKeywordKo || row.related_keyword_ko || row.ko || row.keyword));
      const tr = row && (row.translations || row.relatedKeywordTranslations || row.related_keyword_translations || row);
      if(ko) out[ko] = tr || {};
    });
    return out;
  }
  return root && typeof root === 'object' ? root : {};
}
function relatedTransFor(relatedTranslations, relatedKo){
  relatedTranslations = relatedTranslations || {};
  relatedKo = cleanText(relatedKo);
  const norm = normalizeKeywordValue(relatedKo);
  let direct = relatedTranslations[relatedKo] || relatedTranslations[norm] || {};
  if(!direct && Array.isArray(relatedTranslations)){
    direct = relatedTranslations.find(x => normalizeKeywordValue(x.related_keyword_ko || x.relatedKeywordKo || x.ko || x.keyword || '') === norm) || {};
  }
  if(direct && typeof direct === 'object'){
    // {ko:'숟가락', en:'spoon'} 또는 {relatedKeywordTranslations:{...}} 모두 허용
    direct = direct.translations || direct.relatedKeywordTranslations || direct.related_keyword_translations || direct;
  }
  return direct && typeof direct === 'object' ? direct : {};
}
function enrichTranslationKo(t, ko){
  t = Object.assign({}, t || {});
  if(!cleanText(t.ko)) t.ko = cleanText(ko);
  return t;
}

async function ensureKeywordTranslateTable(pool){
  await pool.query(`CREATE TABLE IF NOT EXISTS gm_keyword_translate (
    lang TEXT NOT NULL,
    input_keyword TEXT NOT NULL,
    main_keyword_ko TEXT NOT NULL,
    hit_count INTEGER NOT NULL DEFAULT 1,
    updated_at DATE NOT NULL DEFAULT CURRENT_DATE,
    PRIMARY KEY (lang, input_keyword)
  )`);
}
function pickLang(p){
  return cleanText(p.lang || p.gm_lang || p.ui_lang_code || p.lang_code || p.country_lang || (p.searchKeywordMeta && (p.searchKeywordMeta.lang || p.searchKeywordMeta.gm_lang)) || 'ko').toLowerCase() || 'ko';
}

async function ensureSearchLogSchema(pool){
  // 검색로그는 분석용 최소 데이터만 저장한다. raw_json은 운영/백업 부담이 커서 제거한다.
  try{ await pool.query(`ALTER TABLE gm_search_log DROP COLUMN IF EXISTS raw_json`); }
  catch(e){ try{ console.warn('[GM_SEARCH_LOG_RAW_JSON_DROP_SKIP]', { message:e && e.message, code:e && e.code }); }catch(_l){} }
  try{ await pool.query(`ALTER TABLE gm_search_log ALTER COLUMN cache_used TYPE CHAR(1) USING CASE WHEN COALESCE(cache_used::text,'') IN ('true','t','T','Y','y','1') THEN 'T' ELSE 'F' END`); }
  catch(e){ try{ console.warn('[GM_SEARCH_LOG_CACHE_TF_SKIP]', { message:e && e.message, code:e && e.code }); }catch(_l){} }
}
async function lookupCategoryNameByCode(pool, cpCode){
  cpCode = cleanText(cpCode);
  if(!cpCode) return '';
  try{
    const r = await pool.query(`SELECT name_ko FROM gm_category WHERE cp_code::text=$1 LIMIT 1`, [cpCode]);
    if(r.rows && r.rows[0] && cleanText(r.rows[0].name_ko)) return cleanText(r.rows[0].name_ko);
  }catch(_e){}
  try{
    const r = await pool.query(`SELECT name_ko FROM gm_category_dynamic WHERE cp_code::text=$1 LIMIT 1`, [cpCode]);
    if(r.rows && r.rows[0] && cleanText(r.rows[0].name_ko)) return cleanText(r.rows[0].name_ko);
  }catch(_e){}
  return '';
}
async function updateSearchLogCategoryByKeyword(pool, args){
  args=args||{};
  const keyword = cleanText(args.keyword);
  const fix = cleanText(args.cp_fix_code);
  if(!keyword || !fix) return { applied:false, reason:'keyword_or_fix_missing' };
  await ensureSearchLogSchema(pool);
  const name = cleanText(args.category_name || await lookupCategoryNameByCode(pool, fix));
  const selected = cleanText(args.cp_selected_code || keyword);
  const r = await pool.query(`
    UPDATE gm_search_log
    SET category_code=$2,
        category_name=COALESCE(NULLIF($3,''), category_name),
        category_no=COALESCE(NULLIF(category_no,''), $4),
        cache_used=CASE WHEN COALESCE(cache_used::text,'') IN ('true','t','T','Y','y','1') THEN 'T' ELSE 'F' END
    WHERE (keyword_normalized=$1 OR keyword_original=$1 OR keyword_canonical=$1)
      AND (category_code IS NULL OR category_code::text='' OR category_code::text=$2)
  `, [keyword, fix, name, selected]);
  return { applied:true, updated:r.rowCount||0, category_name:name };
}
async function upsertKeywordTranslate(pool, lang, inputKeyword, mainKeywordKo, inc=1){
  lang = cleanText(lang).toLowerCase(); inputKeyword = cleanText(inputKeyword); mainKeywordKo = cleanText(mainKeywordKo);
  if(!lang || !inputKeyword || !mainKeywordKo) return false;
  await pool.query(`INSERT INTO gm_keyword_translate (lang,input_keyword,main_keyword_ko,hit_count,updated_at)
    VALUES ($1,$2,$3,$4,CURRENT_DATE)
    ON CONFLICT (lang,input_keyword) DO UPDATE SET
      main_keyword_ko=EXCLUDED.main_keyword_ko,
      hit_count=gm_keyword_translate.hit_count + EXCLUDED.hit_count,
      updated_at=CURRENT_DATE`, [lang, inputKeyword, mainKeywordKo, Math.max(1, toInt(inc,1))]);
  return true;
}
async function saveKeywordTranslatePayload(pool, payload){
  payload = payload || {};
  await ensureKeywordTranslateTable(pool);
  const meta = pickKeywordMeta(payload);
  const mainKeywordKo = meta.mainKeyword;
  const inputKeyword = meta.inputKeyword || payload.inputKeyword || payload.input_keyword || '';
  const lang = pickLang(payload);
  const translations = pickKeywordTranslations(payload, Object.assign({}, meta.raw || {}, { mainKeyword:mainKeywordKo }));
  const relatedTranslations = pickRelatedTranslations(payload, meta.raw || {});
  let alias_saved = 0, relation_saved = 0, relation_skipped = 0;

  if(inputKeyword && mainKeywordKo){
    const inputLooksKo = /[가-힣]/.test(inputKeyword);
    const useLang = inputLooksKo ? 'ko' : lang;
    if(await upsertKeywordTranslate(pool, useLang, inputKeyword, mainKeywordKo, 1)) alias_saved++;
  }

  for(const l of KEYWORD_LANGS){
    if(l === 'ko') continue;
    const v = cleanText(translations[l] || '');
    if(v && mainKeywordKo){
      if(await upsertKeywordTranslate(pool, l, v, mainKeywordKo, 0)) alias_saved++;
    }
  }

  for(const rk of meta.relatedKeywords){
    try{
      const ok = await saveKeywordRelationRow(pool, mainKeywordKo, rk, { categoryMainKeywordKo:meta.categoryMainKeywordKo });
      if(ok){ relation_saved++; await saveKeywordRelationStats(pool, mainKeywordKo, rk, meta.categoryMainKeywordKo); }
      else relation_skipped++;
    }catch(e){ relation_skipped++; }
  }

  return {
    mainKeyword: mainKeywordKo,
    inputKeyword,
    lang,
    alias_saved,
    relation_saved,
    relation_skipped,
    related_count: meta.relatedKeywords.length,
    mainKeywordTranslations: translations,
    relation_mode: 'three-fields-no-translation'
  };
}
async function ensureKeywordRelationSchema(pool){
  // GM_KEYWORD_RELATION_THREE_COL_V006
  // Final runtime policy: relation table is non-destructive.
  // Never DROP table/columns here. Only ensure the final 3-column shape exists.
  await pool.query(`CREATE TABLE IF NOT EXISTS gm_keyword_relation (
    category_main_keyword_ko TEXT NOT NULL DEFAULT '',
    keyword_ko TEXT NOT NULL,
    related_keyword_ko TEXT NOT NULL,
    PRIMARY KEY (keyword_ko,related_keyword_ko)
  )`);
  try{ await pool.query(`ALTER TABLE gm_keyword_relation ADD COLUMN IF NOT EXISTS category_main_keyword_ko TEXT NOT NULL DEFAULT ''`); }catch(e){}
  try{ await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_gm_keyword_relation_pair ON gm_keyword_relation(keyword_ko,related_keyword_ko)`); }catch(e){
    try{ console.warn('[GM_KEYWORD_RELATION_PAIR_INDEX_SKIP]', {message:e&&e.message, code:e&&e.code, reason:'existing rows preserved'}); }catch(_log){}
  }
}
async function saveKeywordRelationRow(pool, keywordKo, relatedKo, options={}){
  keywordKo = cleanText(keywordKo);
  relatedKo = cleanText(relatedKo);
  if(!keywordKo || !relatedKo) return false;
  await ensureKeywordRelationSchema(pool);
  const categoryMainKeywordKo = cleanText(options.categoryMainKeywordKo || '');
  await pool.query(`INSERT INTO gm_keyword_relation (category_main_keyword_ko,keyword_ko,related_keyword_ko)
    VALUES ($1,$2,$3)
    ON CONFLICT (keyword_ko,related_keyword_ko) DO UPDATE SET
      category_main_keyword_ko=CASE
        WHEN EXCLUDED.category_main_keyword_ko='' THEN gm_keyword_relation.category_main_keyword_ko
        ELSE EXCLUDED.category_main_keyword_ko
      END`,
    [categoryMainKeywordKo,keywordKo,relatedKo]);
  return true;
}
async function saveKeywordRelationStats(pool, keywordKo, relatedKo, categoryMainKeywordKo){
  keywordKo = cleanText(keywordKo); relatedKo = cleanText(relatedKo);
  if(!keywordKo || !relatedKo) return;
  const d = new Date();
  const ym = String(d.getFullYear()) + String(d.getMonth()+1).padStart(2,'0');
  const yy = String(d.getFullYear());
  const dayCol = 'day_' + String(d.getDate()).padStart(2,'0');
  const monCol = 'month_' + String(d.getMonth()+1).padStart(2,'0');
  const category = cleanText(categoryMainKeywordKo || '');
  try{
    await pool.query(`INSERT INTO gm_keyword_relation_${ym} (category_main_keyword_ko,keyword_ko,related_keyword_ko,${dayCol},month_total)
      VALUES ($1,$2,$3,1,1)
      ON CONFLICT (keyword_ko, related_keyword_ko) DO UPDATE SET ${dayCol}=gm_keyword_relation_${ym}.${dayCol}+1, month_total=gm_keyword_relation_${ym}.month_total+1`, [category, keywordKo, relatedKo]);
  }catch(e){}
  try{
    await pool.query(`INSERT INTO gm_keyword_relation_${yy} (category_main_keyword_ko,keyword_ko,related_keyword_ko,${monCol},year_total)
      VALUES ($1,$2,$3,1,1)
      ON CONFLICT (keyword_ko, related_keyword_ko) DO UPDATE SET ${monCol}=gm_keyword_relation_${yy}.${monCol}+1, year_total=gm_keyword_relation_${yy}.year_total+1`, [category, keywordKo, relatedKo]);
  }catch(e){}
}
async function saveKeywordMetaPayload(pool, payload){
  const meta = pickKeywordMeta(payload || {});
  const keywordKo = meta.mainKeyword;
  const related = meta.relatedKeywords;
  let saved = 0, skipped = 0;
  if(!keywordKo) return { keyword_ko:'', saved, skipped, related_count:0 };
  for(const rk of related){
    try{
      const ok = await saveKeywordRelationRow(pool, keywordKo, rk, { categoryMainKeywordKo:meta.categoryMainKeywordKo });
      if(ok){ saved++; await saveKeywordRelationStats(pool, keywordKo, rk, meta.categoryMainKeywordKo); }
      else skipped++;
    }catch(e){ skipped++; }
  }
  return { keyword_ko:keywordKo, input_keyword:meta.inputKeyword, original_keyword:meta.originalKeyword, corrected_keyword:meta.correctedKeyword, related_count:related.length, saved, skipped };
}
async function saveProductKeywordMeta(pool, productUid, mallCode, keyword, relatedKeywords, parentPayload){
  const payload = Object.assign({}, parentPayload || {});
  if(keyword && !payload.keyword) payload.keyword = keyword;
  if(relatedKeywords && !payload.relatedKeywords) payload.relatedKeywords = relatedKeywords;
  const meta = pickKeywordMeta(payload);
  const keywordKo = firstKeywordText(meta.mainKeyword, meta.correctedKeyword, meta.inputKeyword, keyword);
  if(!keywordKo){
    return { keyword_ko:'', input_keyword:meta.inputKeyword, original_keyword:meta.originalKeyword, corrected_keyword:meta.correctedKeyword, related_count:0, saved:0, skipped:0, reason:'NO_CANONICAL_KEYWORD' };
  }
  if(productUid){
    try{ await pool.query('UPDATE gm_product SET keyword=$1, updated_at=now() WHERE product_uid=$2', [keywordKo, productUid]); }catch(e){}
  }
  return saveKeywordMetaPayload(pool, Object.assign({}, payload, { mainKeyword:keywordKo, normalizedKeyword:keywordKo, keyword_ko:keywordKo, relatedKeywords:meta.relatedKeywords }));
}


// GM_KEYWORD_TRANSLATE_WIDE_V043
// 검색어 번역은 1개 한국어 키워드 = 1 row = 25개 언어 컬럼으로 저장한다.
// 기존 PK(lang,input_keyword)를 유지하는 운영 DB에서도 lang='all', input_keyword=main_keyword_ko 로 1 row만 사용한다.
const KEYWORD_WIDE_COLS = ['ko','en','zh','vi','ja','tw','th','uz','ne','km','id','tl','mn','my','kk','si','ru','bn','ur','lo','hi','tr','fa','es','fr'].map(l => 'keyword_' + l);
async function ensureKeywordTranslateTable(pool){
  await pool.query(`CREATE TABLE IF NOT EXISTS gm_keyword_translate (
    lang TEXT NOT NULL,
    input_keyword TEXT NOT NULL,
    main_keyword_ko TEXT NOT NULL,
    hit_count INTEGER NOT NULL DEFAULT 1,
    updated_at DATE NOT NULL DEFAULT CURRENT_DATE,
    PRIMARY KEY (lang, input_keyword)
  )`);
  try{ await pool.query(`ALTER TABLE gm_keyword_translate ADD COLUMN IF NOT EXISTS keyword_ko TEXT`); }catch(_e){}
  for(const l of KEYWORD_LANGS.filter(x=>x !== 'ko')){
    try{ await pool.query(`ALTER TABLE gm_keyword_translate ADD COLUMN IF NOT EXISTS keyword_${l} TEXT`); }catch(_e){}
  }
  try{ await pool.query(`ALTER TABLE gm_keyword_translate ADD COLUMN IF NOT EXISTS translate_complete CHAR(1) NOT NULL DEFAULT 'F'`); }catch(_e){}
  try{ await pool.query(`ALTER TABLE gm_keyword_translate ADD COLUMN IF NOT EXISTS created_at DATE NOT NULL DEFAULT CURRENT_DATE`); }catch(_e){}
  try{ await pool.query(`CREATE INDEX IF NOT EXISTS idx_gm_keyword_translate_main_keyword_ko ON gm_keyword_translate(main_keyword_ko)`); }catch(_e){}
}
function keywordWideComplete(trans, mainKeywordKo){
  const t = trans || {};
  return KEYWORD_LANGS.every(l => !!cleanText(l === 'ko' ? (t.ko || mainKeywordKo) : t[l])) ? 'T' : 'F';
}
async function upsertKeywordTranslate(pool, lang, inputKeyword, mainKeywordKo, inc=1, translationsArg=null){
  mainKeywordKo = cleanText(mainKeywordKo || inputKeyword);
  if(!mainKeywordKo) return false;
  await ensureKeywordTranslateTable(pool);
  const trans = Object.assign({}, translationsArg || {});
  trans.ko = cleanText(trans.ko || mainKeywordKo);
  // 단일어 호출 호환: 과거 방식으로 들어와도 해당 lang 컬럼만 보강한다.
  const l0 = cleanText(lang).toLowerCase();
  if(l0 && l0 !== 'all' && l0 !== 'ko' && cleanText(inputKeyword)) trans[l0] = cleanText(inputKeyword);
  const complete = keywordWideComplete(trans, mainKeywordKo);
  const cols = ['lang','input_keyword','main_keyword_ko','hit_count','updated_at','created_at','translate_complete'];
  const vals = ['all', mainKeywordKo, mainKeywordKo, Math.max(0, toInt(inc,1)), new Date().toISOString().slice(0,10), new Date().toISOString().slice(0,10), complete];
  for(const l of KEYWORD_LANGS){ cols.push('keyword_'+l); vals.push(cleanText(trans[l] || (l==='ko' ? mainKeywordKo : ''))); }
  const placeholders = vals.map((_,i)=>'$'+(i+1)).join(',');
  const upd=[];
  upd.push(`main_keyword_ko=EXCLUDED.main_keyword_ko`);
  upd.push(`hit_count=gm_keyword_translate.hit_count + EXCLUDED.hit_count`);
  upd.push(`updated_at=CURRENT_DATE`);
  for(const l of KEYWORD_LANGS){
    const c='keyword_'+l;
    upd.push(`${c}=CASE WHEN EXCLUDED.${c} IS NULL OR EXCLUDED.${c}::text='' THEN gm_keyword_translate.${c} ELSE EXCLUDED.${c} END`);
  }
  const completeExpr = KEYWORD_LANGS.map(l => `(CASE WHEN EXCLUDED.keyword_${l} IS NULL OR EXCLUDED.keyword_${l}::text='' THEN gm_keyword_translate.keyword_${l} ELSE EXCLUDED.keyword_${l} END) IS NOT NULL AND (CASE WHEN EXCLUDED.keyword_${l} IS NULL OR EXCLUDED.keyword_${l}::text='' THEN gm_keyword_translate.keyword_${l} ELSE EXCLUDED.keyword_${l} END)::text<>''`).join(' AND ');
  upd.push(`translate_complete=CASE WHEN ${completeExpr} THEN 'T' ELSE 'F' END`);
  await pool.query(`INSERT INTO gm_keyword_translate (${cols.join(',')}) VALUES (${placeholders}) ON CONFLICT (lang,input_keyword) DO UPDATE SET ${upd.join(', ')}`, vals);
  return true;
}
async function saveKeywordTranslatePayload(pool, payload){
  payload = payload || {};
  await ensureKeywordTranslateTable(pool);
  const meta = pickKeywordMeta(payload);
  const mainKeywordKo = cleanText(meta.mainKeyword || payload.main_keyword_ko || payload.mainKeywordKo || payload.keyword_ko || payload.keyword || '');
  const inputKeyword = cleanText(meta.inputKeyword || payload.inputKeyword || payload.input_keyword || mainKeywordKo);
  const lang = pickLang(payload);
  const translations = pickKeywordTranslations(payload, Object.assign({}, meta.raw || {}, { mainKeyword:mainKeywordKo }));
  translations.ko = cleanText(translations.ko || mainKeywordKo);
  let alias_saved = 0, relation_saved = 0, relation_skipped = 0;
  if(mainKeywordKo){
    if(await upsertKeywordTranslate(pool, lang, inputKeyword || mainKeywordKo, mainKeywordKo, 1, translations)) alias_saved++;
  }
  const relatedTranslations = pickRelatedTranslations(payload, meta.raw || {});
  for(const rk of meta.relatedKeywords){
    try{
      const ok = await saveKeywordRelationRow(pool, mainKeywordKo, rk, { categoryMainKeywordKo:meta.categoryMainKeywordKo });
      if(ok){ relation_saved++; await saveKeywordRelationStats(pool, mainKeywordKo, rk, meta.categoryMainKeywordKo); }
      else relation_skipped++;
    }catch(e){ relation_skipped++; try{ console.warn('[GM_KEYWORD_RELATION_SAVE_FAIL]', { keyword_ko:mainKeywordKo, related_keyword_ko:rk, message:e && e.message }); }catch(_l){} }
  }
  return { mainKeyword: mainKeywordKo, inputKeyword, lang, wide:true, alias_saved, relation_saved, relation_skipped, related_count: meta.relatedKeywords.length, relation_mode:'three-fields-no-translation', mainKeywordTranslations: translations };
}



module.exports={normalizeKeywordValue,firstKeywordText,pickSearchKeyword,pickCategoryKeyword,pickRelatedKeywords,uniqClean,pickKeywordMeta,ensureKeywordTranslateTable,updateSearchLogCategoryByKeyword,saveKeywordTranslatePayload,ensureKeywordRelationSchema,saveKeywordRelationRow,saveKeywordRelationStats,saveKeywordMetaPayload,saveProductKeywordMeta};
