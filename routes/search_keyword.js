/* routes/search_keyword.js
 * GM_SEARCH_KEYWORD_ROUTE_V005
 *
 * Purpose:
 * - Server-side keyword normalization ONLY for mobile/product/gm_search.html external search.
 * - product.js, internal product search, GM_SEARCH_CATEGORY_ENGINE are not used or modified.
 * - This file is self-contained so no new module/server folder is created.
 *
 * Endpoint:
 * - GET/POST /api/gm/search/keyword
 * - GET/POST /api/gm/search/normalize-keyword
 *
 * Match priority:
 * 1) gm_category name_[gm_lang] exact match       -> name_ko
 * 2) gm_keyword_relation related_keyword_[lang]  -> related_keyword_ko
 *    NOTE: keyword_ko is relation base only. Do NOT search keyword_ko for relation matches.
 * 3) gm_keyword_translate keyword_[lang]/input   -> keyword_ko/main_keyword_ko
 * 4) fallback original keyword. No learning/scoring correction is done here.
 */
'use strict';

const express = require('express');
const router = express.Router();

const VERSION = 'GM_SEARCH_KEYWORD_ROUTE_V005';
const LANGS = ['ko','en','zh','vi','ja','tw','th','uz','ne','km','id','tl','mn','my','kk','si','ru','bn','ur','lo','hi','tr','fa','es','fr'];

function cleanText(v){
  return String(v == null ? '' : v)
    .replace(/[\u00A0\u200B-\u200D\uFEFF]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function normalizeText(v){
  return cleanText(v).toLowerCase().replace(/[\s"'“”‘’.,/\\|_\-()\[\]{}]+/g, '');
}
function safeLang(v){
  const s = cleanText(v).toLowerCase();
  return LANGS.includes(s) ? s : 'ko';
}
function firstNonEmpty(){
  for(const v of arguments){ const s = cleanText(v); if(s) return s; }
  return '';
}
function ident(name){
  return '"' + String(name).replace(/"/g, '""') + '"';
}
function db(req){
  return req.app && req.app.locals && (req.app.locals.pool || req.app.locals.db);
}
async function tableExists(pool, table){
  const r = await pool.query(`
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema='public' AND table_name=$1
    LIMIT 1
  `, [table]);
  return !!(r.rows && r.rows[0]);
}
async function columnExists(pool, table, column){
  const r = await pool.query(`
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name=$1 AND column_name=$2
    LIMIT 1
  `, [table, column]);
  return !!(r.rows && r.rows[0]);
}
function pgNormalizeExpr(colSql){
  return `regexp_replace(lower(COALESCE(${colSql},'')), '[\\s"''“”‘’.,/\\\\|_\\-()\\[\\]{}]+', '', 'g')`;
}

async function matchCategory(pool, input, lang){
  if(!(await tableExists(pool, 'gm_category'))) return null;
  const inputNorm = normalizeText(input);
  if(!inputNorm) return null;

  const langCol = 'name_' + lang;
  const col = await columnExists(pool, 'gm_category', langCol) ? langCol : 'name_ko';
  const qCol = ident(col);

  const r = await pool.query(`
    SELECT category_id, gm_code, cp_code, cp_id, depth, leaf_yn, display_yn, sort_order,
           name_ko, ${qCol} AS matched_value
    FROM gm_category
    WHERE COALESCE(display_yn,'Y') <> 'N'
      AND ${pgNormalizeExpr(qCol)} = $1
    ORDER BY
      CASE WHEN COALESCE(leaf_yn,'')='Y' THEN 0 ELSE 1 END,
      depth DESC NULLS LAST,
      sort_order ASC NULLS LAST,
      category_id ASC
    LIMIT 1
  `, [inputNorm]);

  const row = r.rows && r.rows[0];
  if(!row) return null;
  const ko = firstNonEmpty(row.name_ko, row.matched_value, input);
  if(!ko) return null;
  return {
    matched: true,
    source: 'gm_category',
    priority: 1,
    keyword_ko: ko,
    main_keyword_ko: ko,
    matched_keyword: cleanText(row.matched_value),
    category_id: row.category_id,
    category_no: cleanText(row.gm_code),
    category_code: cleanText(row.cp_code),
    cp_id: cleanText(row.cp_id),
    depth: row.depth,
    leaf_yn: cleanText(row.leaf_yn)
  };
}

async function matchRelation(pool, input, lang){
  if(!(await tableExists(pool, 'gm_keyword_relation'))) return null;
  const inputNorm = normalizeText(input);
  if(!inputNorm) return null;

  const relLangCol = 'related_keyword_' + lang;
  const col = await columnExists(pool, 'gm_keyword_relation', relLangCol) ? relLangCol : 'related_keyword_ko';
  const qCol = ident(col);
  const hasTranslateComplete = await columnExists(pool, 'gm_keyword_relation', 'translate_complete');
  const completeOrder = hasTranslateComplete ? `CASE WHEN COALESCE(translate_complete,'')='T' THEN 0 ELSE 1 END,` : '';

  const r = await pool.query(`
    SELECT keyword_ko, related_keyword_ko, category_main_keyword_ko, ${qCol} AS matched_value
    FROM gm_keyword_relation
    WHERE ${pgNormalizeExpr(qCol)} = $1
    ORDER BY
      ${completeOrder}
      updated_at DESC NULLS LAST,
      keyword_ko ASC,
      related_keyword_ko ASC
    LIMIT 1
  `, [inputNorm]);

  const row = r.rows && r.rows[0];
  if(!row) return null;
  const relatedKo = firstNonEmpty(row.related_keyword_ko, row.matched_value, input);
  if(!relatedKo) return null;
  return {
    matched: true,
    source: 'gm_keyword_relation',
    priority: 2,
    keyword_ko: relatedKo,
    main_keyword_ko: relatedKo,
    matched_keyword: cleanText(row.matched_value),
    relation_base_keyword_ko: cleanText(row.keyword_ko),
    category_main_keyword_ko: cleanText(row.category_main_keyword_ko),
    relation_rule: 'use related_keyword_ko as search keyword; keep keyword_ko only as recommendation relation base'
  };
}

async function matchKeywordTranslate(pool, input, lang){
  if(!(await tableExists(pool, 'gm_keyword_translate'))) return null;
  const inputNorm = normalizeText(input);
  if(!inputNorm) return null;

  const keyLangCol = 'keyword_' + lang;
  const hasLangCol = await columnExists(pool, 'gm_keyword_translate', keyLangCol);
  const qLangCol = hasLangCol ? ident(keyLangCol) : null;

  const conds = [];
  if(hasLangCol) conds.push(`${pgNormalizeExpr(qLangCol)} = $1`);
  if(await columnExists(pool, 'gm_keyword_translate', 'input_keyword')) conds.push(`${pgNormalizeExpr('input_keyword')} = $1`);
  if(await columnExists(pool, 'gm_keyword_translate', 'keyword_ko')) conds.push(`${pgNormalizeExpr('keyword_ko')} = $1`);
  if(await columnExists(pool, 'gm_keyword_translate', 'main_keyword_ko')) conds.push(`${pgNormalizeExpr('main_keyword_ko')} = $1`);
  if(!conds.length) return null;

  const selectMatched = hasLangCol ? `${qLangCol} AS matched_value` : `keyword_ko AS matched_value`;
  const langExactOrder = hasLangCol ? `CASE WHEN ${pgNormalizeExpr(qLangCol)} = $1 THEN 0 ELSE 1 END,` : '';

  const r = await pool.query(`
    SELECT *, ${selectMatched}
    FROM gm_keyword_translate
    WHERE ${conds.join(' OR ')}
    ORDER BY
      ${langExactOrder}
      CASE WHEN COALESCE(translate_complete,'')='T' THEN 0 ELSE 1 END,
      hit_count DESC NULLS LAST,
      updated_at DESC NULLS LAST
    LIMIT 1
  `, [inputNorm]);

  const row = r.rows && r.rows[0];
  if(!row) return null;
  const ko = firstNonEmpty(row.keyword_ko, row.main_keyword_ko, row.matched_value, input);
  if(!ko) return null;
  return {
    matched: true,
    source: 'gm_keyword_translate',
    priority: 3,
    keyword_ko: ko,
    main_keyword_ko: ko,
    matched_keyword: firstNonEmpty(row.matched_value, row.input_keyword),
    input_keyword: cleanText(row.input_keyword),
    translate_complete: cleanText(row.translate_complete),
    hit_count: Number(row.hit_count || 0) || 0
  };
}

async function normalizeKeyword(pool, opts){
  opts = opts || {};
  const input = cleanText(opts.keyword || opts.input_keyword || opts.q || '');
  const lang = safeLang(opts.gm_lang || opts.lang || opts.lang_code || opts.ui_lang_code || 'ko');
  const mallCode = cleanText(opts.mall_code || opts.mallCode || '').toUpperCase();
  const started = Date.now();

  if(!input){
    return { ok:false, version:VERSION, error:'keyword is required', keyword_original:'', keyword_ko:'', source:'empty', priority:0, gm_lang:lang, lang_code:lang, mall_code:mallCode };
  }

  let match = await matchCategory(pool, input, lang);
  if(!match) match = await matchRelation(pool, input, lang);
  if(!match) match = await matchKeywordTranslate(pool, input, lang);

  if(!match){
    match = {
      matched: false,
      source: 'fallback_original',
      priority: 9,
      keyword_ko: input,
      main_keyword_ko: input,
      matched_keyword: input,
      need_dictionary_save: lang !== 'ko'
    };
  }

  const keywordKo = firstNonEmpty(match.keyword_ko, input);
  const meta = {
    inputKeyword: input,
    originalKeyword: input,
    mainKeyword: keywordKo,
    mainSearchKeyword: keywordKo,
    normalizedKeyword: keywordKo,
    source: match.source,
    priority: match.priority,
    ts: Date.now()
  };

  return Object.assign({
    ok: true,
    version: VERSION,
    keyword_original: input,
    input_keyword: input,
    keyword_ko: keywordKo,
    keyword_canonical: keywordKo,
    normalized_keyword: keywordKo,
    main_keyword_ko: firstNonEmpty(match.main_keyword_ko, keywordKo),
    gm_lang: lang,
    lang_code: lang,
    mall_code: mallCode,
    elapsed_ms: Date.now() - started,
    searchKeywordMeta: meta
  }, match);
}

async function handler(req, res){
  const pool = db(req);
  if(!pool) return res.status(500).json({ ok:false, version:VERSION, error:'DB pool is not attached' });
  const p = Object.assign({}, req.query || {}, req.body || {});
  try{
    const out = await normalizeKeyword(pool, p);
    if(!out.ok) return res.status(400).json(out);
    return res.json(Object.assign({ action:'search.keyword.normalize' }, out));
  }catch(e){
    const keyword = cleanText(p.keyword || p.input_keyword || p.q || '');
    console.error('[GM_SEARCH_KEYWORD_ROUTE_V005_ERROR]', JSON.stringify({ keyword, error:String(e && e.message || e) }));
    return res.status(500).json({ ok:false, version:VERSION, error:'search keyword normalize failed', detail:String(e && e.message || e) });
  }
}

router.get(['/api/gm/search/keyword','/api/gm/search/normalize-keyword'], handler);
router.post(['/api/gm/search/keyword','/api/gm/search/normalize-keyword'], handler);

module.exports = router;
module.exports.normalizeKeyword = normalizeKeyword;
