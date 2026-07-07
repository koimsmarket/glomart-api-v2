const express = require('express');
const router = express.Router();

/* GM_SEARCH_KEYWORD_ROUTE_V003
 * External search keyword normalization only.
 * Scope:
 * - Used by mobile/product/gm_search.html before CPKR / ALKR search.
 * - Does not touch product.js, internal product search, or GM_SEARCH_CATEGORY_ENGINE.
 *
 * Priority:
 * 1) gm_category name_[gm_lang] exact match -> name_ko
 * 2) gm_keyword_relation related_keyword_[gm_lang] exact match -> related_keyword_ko
 *    IMPORTANT: relation match must NOT return keyword_ko as the search term.
 * 3) gm_keyword_translate keyword_[gm_lang] / input_keyword exact match -> main_keyword_ko or keyword_ko
 * 4) fallback original keyword
 *    - fallback means CPKR may search original first and gm_search can reuse Coupang correctedQuery for GMKR/ALKR.
 */
'use strict';

const VERSION = 'GM_SEARCH_KEYWORD_ROUTE_V003';
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

async function matchRelation(pool, input, lang){
  const col = langColumn('related_keyword', lang);
  const n = norm(input);
  const sql = `
    SELECT
      category_main_keyword_ko, keyword_ko, related_keyword_ko,
      ${col} AS matched_value, updated_at
    FROM gm_keyword_relation
    WHERE LOWER(REGEXP_REPLACE(COALESCE(${col}::text,''), '[[:space:]"''“”‘’.,/\\\\|_\\-()\\[\\]{}]+', '', 'g')) = $1
    ORDER BY updated_at DESC NULLS LAST
    LIMIT 1`;
  const r = await safeQuery(pool, sql, [n]);
  if(!r.rows.length) return null;
  const row = r.rows[0];
  return buildCandidate('gm_keyword_relation', row.related_keyword_ko, row.matched_value, row, 200);
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
          AND ($2 = 'ko' OR lang=$2 OR lang='all')
       )
    ORDER BY COALESCE(hit_count,0) DESC, updated_at DESC NULLS LAST
    LIMIT 1`;
  const r = await safeQuery(pool, sql, [n, l]);
  if(!r.rows.length) return null;
  const row = r.rows[0];
  return buildCandidate('gm_keyword_translate', row.main_keyword_ko || row.keyword_ko, row.matched_value || row.input_keyword, row, 100 + Math.min(50, Number(row.hit_count || 0)));
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
  const c1 = await matchCategory(pool, input, lang); if(c1) candidates.push(c1);
  const c2 = await matchRelation(pool, input, lang); if(c2) candidates.push(c2);
  const c3 = await matchKeywordTranslate(pool, input, lang); if(c3) candidates.push(c3);

  const priority = { gm_category:1, gm_keyword_relation:2, gm_keyword_translate:3, fallback:9 };
  candidates.sort((a,b)=> (priority[a.source] || 99) - (priority[b.source] || 99) || b.score - a.score);

  const best = candidates[0] || buildCandidate('fallback', input, input, {}, 0);
  const ko = cleanText(best.search_keyword_ko || input);

  return {
    ok:true,
    route_version:VERSION,
    keyword_original: input,
    input_keyword: input,
    lang,
    matched: best.source !== 'fallback',
    source: best.source,
    priority: priority[best.source] || 9,
    keyword_ko: ko,
    main_keyword_ko: ko,
    search_keyword_ko: ko,
    normalized_keyword: ko,
    keyword_canonical: ko,
    matched_keyword: best.matched_value,
    matched_value: best.matched_value,
    need_dictionary_save: best.source === 'fallback',
    coupang_refine_required: best.source === 'fallback',
    fallback: best.source === 'fallback',
    searchKeywordMeta: {
      inputKeyword: input,
      originalKeyword: input,
      mainKeyword: ko,
      normalizedKeyword: ko,
      keywordKo: ko,
      source: best.source,
      priority: priority[best.source] || 9,
      matchedKeyword: best.matched_value,
      need_dictionary_save: best.source === 'fallback',
      coupangRefineRequired: best.source === 'fallback',
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
router.all('/api/gm/search/keyword/normalize', handler);
router.all('/api/gm/search/normalize-keyword', handler);
router.all('/api/gm/search/keyword-normalize', handler);

router.normalizeKeyword = normalizeKeyword;
module.exports = router;
