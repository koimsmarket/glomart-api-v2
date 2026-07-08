const express = require('express');
const router = express.Router();

/* GM_SEARCH_KEYWORD_ROUTE_V017_RELATION_3COL
 * External search keyword normalization only.
 * Scope:
 * - Used by mobile/product/gm_search.html before CPKR / ALKR search.
 * - Does not touch product.js, internal product search, or GM_SEARCH_CATEGORY_ENGINE.
 *
 * Priority:
 * 1) gm_category name_[gm_lang] exact match -> name_ko
 * 2) gm_keyword_translate keyword_[gm_lang] / input_keyword exact match -> main_keyword_ko or keyword_ko
 * 3) fallback original keyword
 *    - fallback means CPKR may search original first and gm_search can reuse Coupang correctedQuery for GMKR/ALKR.
 */
'use strict';

const VERSION = 'GM_SEARCH_KEYWORD_ROUTE_V017_RELATION_3COL';
const LANGS = ['ko','en','zh','vi','ja','tw','th','uz','ne','km','id','tl','mn','my','kk','si','ru','bn','ur','lo','hi','tr','fa','es','fr'];

function db(req){ return req.app.locals.db || req.app.locals.pool; }
function cleanText(v){ return String(v == null ? '' : v).replace(/[\u00A0\u200B-\u200D\uFEFF]/g, ' ').replace(/\s+/g, ' ').trim(); }
function fail(res, status, message, extra){ res.status(status).json(Object.assign({ ok:false, route_version:VERSION, error:message }, extra || {})); }

function normalizeLang(v){
  let s = cleanText(v).toLowerCase();
  if(!s) return 'ko';
  s = s.replace('_','-').split('-')[0];
  if(s === 'kr') s = 'ko';
  if(s === 'cn') s = 'zh';
  if(s === 'jp') s = 'ja';
  if(s === 'vn') s = 'vi';
  return LANGS.includes(s) ? s : 'ko';
}

function norm(v){
  return cleanText(v).toLowerCase().replace(/[\s"'“”‘’.,/\\|_\-()\[\]{}]+/g, '');
}
function hasKo(v){ return /[가-힣]/.test(cleanText(v)); }

const KO_OVERRIDES = {
  'chicken':'치킨','chikin':'치킨','chickin':'치킨','banana':'바나나','benanan':'바나나','glove':'장갑','gloves':'장갑',
  'milk':'우유','egg':'계란','eggs':'계란','onion':'양파','fireworks':'불꽃놀이','firework':'불꽃놀이','firecracker':'폭죽',
  'stool':'걸상','lamb ribs':'양갈비','prune':'푸룬','cat':'고양이','apple':'사과'
};
function koOverride(v){ const k=cleanText(v).toLowerCase().replace(/[\s\u00a0\u200b-\u200d\ufeff"'“”‘’]+/g,' ').trim(); return cleanText(KO_OVERRIDES[k]||''); }
function koOrEmpty(v){ v=cleanText(v); return hasKo(v) ? v : (koOverride(v)||''); }

function langColumn(prefix, lang){
  const l = normalizeLang(lang);
  return prefix + '_' + l;
}

async function safeQuery(pool, sql, vals){
  return pool.query(sql, vals || []);
}

function buildCandidate(source, searchKeywordKo, matchedValue, row, score){
  const kw = cleanText(searchKeywordKo);
  if(!kw) return null;
  return {
    source,
    search_keyword_ko: kw,
    keyword_ko: kw,
    main_keyword_ko: kw,
    normalized_keyword: kw,
    keyword_canonical: kw,
    matched_value: cleanText(matchedValue),
    score: Number(score || 0),
    row: row || {}
  };
}

async function matchCategory(pool, input, lang){
  const col = langColumn('name', lang);
  const n = norm(input);
  const sql = `
    SELECT
      category_id, gm_code, cp_code, cp_id, depth, leaf_yn,
      name_ko, ${col} AS matched_value, keyword, keyword_seed, search_count, updated_at
    FROM gm_category
    WHERE display_yn IS DISTINCT FROM 'N'
      AND LOWER(REGEXP_REPLACE(COALESCE(${col}::text,''), '[[:space:]"''“”‘’.,/\\\\|_\\-()\\[\\]{}]+', '', 'g')) = $1
    ORDER BY
      CASE WHEN COALESCE(leaf_yn,'')='Y' THEN 0 ELSE 1 END,
      COALESCE(depth,0) DESC,
      COALESCE(search_count,0) DESC,
      updated_at DESC NULLS LAST
    LIMIT 1`;
  const r = await safeQuery(pool, sql, [n]);
  if(!r.rows.length) return null;
  const row = r.rows[0];
  return buildCandidate('gm_category', row.name_ko || row.keyword || row.keyword_seed, row.matched_value, row, 300);
}

async function matchKeywordTranslate(pool, input, lang){
  const col = langColumn('keyword', lang);
  const l = normalizeLang(lang);
  const n = norm(input);
  const sql = `
    SELECT
      lang, input_keyword, main_keyword_ko, keyword_ko,
      ${col} AS matched_value, hit_count, updated_at
    FROM gm_keyword_translate
    WHERE LOWER(REGEXP_REPLACE(COALESCE(${col}::text,''), '[[:space:]"''“”‘’.,/\\\\|_\\-()\\[\\]{}]+', '', 'g')) = $1
       OR (
          LOWER(REGEXP_REPLACE(COALESCE(input_keyword::text,''), '[[:space:]"''“”‘’.,/\\\\|_\\-()\\[\\]{}]+', '', 'g')) = $1
          AND ($2 = 'ko' OR lang=$2 OR lang='all' OR lang IS NULL OR lang='')
       )
    ORDER BY COALESCE(hit_count,0) DESC, updated_at DESC NULLS LAST
    LIMIT 1`;
  const r = await safeQuery(pool, sql, [n, l]);
  if(!r.rows.length) return null;
  const row = r.rows[0];
  const ko = cleanText(row.main_keyword_ko || row.keyword_ko || '');
  // 기존 테스트 쓰레기값 보호: keyword_ko/main_keyword_ko가 한국어가 아니면 매칭으로 인정하지 않는다.
  if(!hasKo(ko)) return null;
  return buildCandidate('gm_keyword_translate', ko, row.matched_value || row.input_keyword, row, 100 + Math.min(50, Number(row.hit_count || 0)));
}

async function normalizeKeyword(pool, params){
  const p = params || {};
  const input = cleanText(p.keyword || p.q || p.inputKeyword || p.input_keyword || p.keyword_original || p.keywordOriginal || '');
  const lang = normalizeLang(p.lang || p.gm_lang || p.ui_lang_code || p.uiLangCode || p.keyword_lang_code || p.keywordLangCode || p.lang_code || 'ko');

  if(!input){
    return {
      ok:false,
      route_version:VERSION,
      reason:'empty_keyword',
      keyword_original:'',
      input_keyword:'',
      lang,
      keyword_ko:'',
      main_keyword_ko:'',
      normalized_keyword:'',
      keyword_canonical:'',
      fallback:true
    };
  }

  const candidates = [];
  const overrideKo = koOverride(input);
  if(overrideKo) candidates.push(buildCandidate('local_ko_override', overrideKo, input, {}, 80));
  const c1 = await matchCategory(pool, input, lang); if(c1) candidates.push(c1);
  const c3 = await matchKeywordTranslate(pool, input, lang); if(c3) candidates.push(c3);

  const priority = { gm_category:1, gm_keyword_translate:2, local_ko_override:3, fallback:9 };
  candidates.sort((a,b)=> (priority[a.source] || 99) - (priority[b.source] || 99) || b.score - a.score);

  const best = candidates[0] || buildCandidate('fallback', input, input, {}, 0);
  const fallback = best.source === 'fallback';
  const ko = fallback ? koOrEmpty(input) : koOrEmpty(best.search_keyword_ko || input);
  const searchText = ko || input;

  return {
    ok:true,
    route_version:VERSION,
    keyword_original: input,
    input_keyword: input,
    lang,
    matched: !fallback,
    source: best.source,
    priority: priority[best.source] || 9,
    keyword_ko: ko,
    main_keyword_ko: ko,
    search_keyword_ko: searchText,
    normalized_keyword: searchText,
    keyword_canonical: searchText,
    matched_keyword: best.matched_value,
    matched_value: best.matched_value,
    need_dictionary_save: fallback,
    coupang_refine_required: fallback,
    fallback: fallback,
    searchKeywordMeta: {
      inputKeyword: input,
      originalKeyword: input,
      mainKeyword: searchText,
      normalizedKeyword: searchText,
      keywordKo: ko,
      source: best.source,
      priority: priority[best.source] || 9,
      matchedKeyword: best.matched_value,
      need_dictionary_save: fallback,
      coupangRefineRequired: fallback,
      relatedKeywords: []
    },
    candidates: candidates.map(c => ({
      source:c.source,
      keyword_ko:c.search_keyword_ko,
      search_keyword_ko:c.search_keyword_ko,
      matched_value:c.matched_value,
      score:c.score
    }))
  };
}


function relationNorm(v){ return norm(v); }
function normalizeRelationLang(v){ return normalizeLang(v); }
function normalizeRelationRows(params){
  const p = params || {};
  const inputRows = Array.isArray(p.rows) ? p.rows : (Array.isArray(p.relatedKeywordRows) ? p.relatedKeywordRows : []);
  const baseLang = normalizeRelationLang(p.gm_lang || p.gmLang || p.lang || p.keyword_lang_code || p.keywordLangCode || 'ko');
  const baseKeyword = cleanText(p.keyword || p.mainKeyword || p.main_keyword || p.mainKeywordKo || p.keyword_ko || p.inputKeyword || p.input_keyword || '');
  const related = Array.isArray(p.relatedKeywords) ? p.relatedKeywords : [];
  const rows = [];
  const seen = new Set();
  function push(row){
    const gmLang = normalizeRelationLang(row.gm_lang || row.gmLang || row.lang || baseLang);
    const keyword = cleanText(row.keyword || row.keyword_ko || row.mainKeyword || baseKeyword);
    const relatedKeyword = cleanText(row.related_keyword || row.relatedKeyword || row.related_keyword_ko || row.relatedKeywordKo || row.value || row.text || '');
    if(!gmLang || !keyword || !relatedKeyword) return;
    if(relationNorm(keyword) === relationNorm(relatedKeyword)) return;
    const sig = gmLang + '|' + relationNorm(keyword) + '|' + relationNorm(relatedKeyword);
    if(seen.has(sig)) return;
    seen.add(sig);
    rows.push({ gm_lang:gmLang, keyword, related_keyword:relatedKeyword });
  }
  inputRows.forEach(r => push(r || {}));
  related.forEach(v => push({ gm_lang:baseLang, keyword:baseKeyword, related_keyword:(typeof v === 'string' ? v : (v && (v.related_keyword || v.relatedKeyword || v.value || v.text || v.keyword)) || '') }));
  return rows.slice(0,100);
}
async function saveKeywordRelation(pool, params){
  const rows = normalizeRelationRows(params);
  if(!rows.length) return { ok:true, route_version:VERSION, saved:0, updated:0, skipped:true, reason:'no_relation_rows' };
  let saved = 0, updated = 0;
  for(const row of rows){
    const sql = `
      INSERT INTO gm_keyword_relation (gm_lang, keyword, related_keyword, hit_count, complete, created_at, updated_at)
      VALUES ($1,$2,$3,1,'F',NOW(),NOW())
      ON CONFLICT (gm_lang, keyword, related_keyword)
      DO UPDATE SET hit_count = COALESCE(gm_keyword_relation.hit_count,0) + 1, updated_at = NOW()
      RETURNING (xmax = 0) AS inserted`;
    const r = await safeQuery(pool, sql, [row.gm_lang, row.keyword, row.related_keyword]);
    if(r.rows && r.rows[0] && r.rows[0].inserted) saved++; else updated++;
  }
  try{ console.log('[GM_KEYWORD_RELATION_SAVE_3COL]', { count:rows.length, saved, updated }); }catch(_log){}
  return { ok:true, route_version:VERSION, received:rows.length, saved, updated };
}
async function relationHandler(req,res){
  const pool = db(req);
  if(!pool) return fail(res, 500, 'DB pool is not attached');
  const params = Object.assign({}, req.query || {}, req.body || {});
  try{ return res.json(await saveKeywordRelation(pool, params)); }
  catch(e){ console.error('[GM_KEYWORD_RELATION_SAVE_3COL_ERROR]', String(e && e.message || e)); return fail(res, 500, 'keyword relation save failed', { detail:String(e && e.message || e) }); }
}

async function handler(req,res){
  const pool = db(req);
  if(!pool) return fail(res, 500, 'DB pool is not attached');
  const params = Object.assign({}, req.query || {}, req.body || {});
  try{
    const out = await normalizeKeyword(pool, params);
    try{ console.log('[GM_SEARCH_KEYWORD_NORMALIZE_V002]', { input:out.input_keyword, lang:out.lang, keyword_ko:out.keyword_ko, source:out.source, fallback:out.fallback }); }catch(_log){}
    return res.json(out);
  }catch(e){
    console.error('[GM_SEARCH_KEYWORD_NORMALIZE_ERROR_V002]', String(e && e.message || e));
    return fail(res, 500, 'keyword normalize failed', { detail:String(e && e.message || e) });
  }
}

router.all('/api/gm/search/keyword', handler);
router.all('/api/gm/keyword/relation', relationHandler);
router.all('/api/gm/search/keyword/relation', relationHandler);
router.all('/api/gm/search/keyword/normalize', handler);
router.all('/api/gm/search/normalize-keyword', handler);
router.all('/api/gm/search/keyword-normalize', handler);

router.normalizeKeyword = normalizeKeyword;
router.saveKeywordRelation = saveKeywordRelation;
module.exports = router;
