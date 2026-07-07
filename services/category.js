
'use strict';

function cleanText(v){
  if(v === null || v === undefined) return '';
  if(typeof v === 'string') return v.replace(/\u0000/g,'').trim();
  if(typeof v === 'number' || typeof v === 'boolean') return String(v).trim();
  return String(v || '').trim();
}
function toInt(v, d=0){
  if(v === null || v === undefined || v === '') return d;
  const n = parseInt(String(v).replace(/[^0-9\-]/g,''), 10);
  return Number.isFinite(n) ? n : d;
}
function isPlainObject(v){ return !!v && typeof v === 'object' && !Array.isArray(v); }
function parseMaybeJsonAny(v){
  if(v === null || v === undefined || v === '') return null;
  if(typeof v !== 'string') return v;
  try{ return JSON.parse(v); }catch(_e){ return null; }
}
function firstNonEmpty(obj, keys){
  obj = obj || {};
  for(const k of keys || []){
    const v = obj[k];
    if(v !== undefined && v !== null && cleanText(v) !== '') return v;
  }
  return '';
}
function compactError(e){
  return { message: (e && e.message) || String(e || ''), code: e && e.code, detail: e && e.detail };
}

const CATEGORY_LANGS = ['ko','en','zh','vi','ja','tw','th','uz','ne','km','id','tl','mn','my','kk','si','ru','bn','ur','lo','hi','tr','fa','es','fr'];
const CATEGORY_NAME_COLS = CATEGORY_LANGS.map(l => 'name_' + l);
const CATEGORY_FALLBACK_TRANSLATIONS = {
  '폭죽': {
    en:'firecracker', zh:'鞭炮', vi:'pháo hoa', ja:'爆竹', tw:'鞭炮', th:'พลุ', uz:'mushakboz', ne:'पटाका', km:'កាំជ្រួច', id:'petasan', tl:'paputok', mn:'салют', my:'မီးရှူးမီးပန်း', kk:'отшашу', si:'රතිඤ්ඤා', ru:'петарда', bn:'আতশবাজি', ur:'پٹاخہ', lo:'ດອກໄມ້ໄຟ', hi:'पटाखे', tr:'havai fişek', fa:'ترقه', es:'petardo', fr:'pétard'
  },
  '불꽃놀이': {
    en:'fireworks', zh:'烟花', vi:'pháo hoa', ja:'花火', tw:'煙火', th:'ดอกไม้ไฟ', uz:'mushakbozlik', ne:'आतिशबाजी', km:'កាំជ្រួច', id:'kembang api', tl:'paputok', mn:'салют', my:'မီးရှူးမီးပန်း', kk:'отшашу', si:'ගිනිකෙළි', ru:'фейерверк', bn:'আতশবাজি', ur:'آتش بازی', lo:'ດອກໄມ້ໄຟ', hi:'आतिशबाजी', tr:'havai fişek', fa:'آتش‌بازی', es:'fuegos artificiales', fr:'feux d’artifice'
  },
  '꽃잎/폭죽/불꽃놀이': {
    en:'confetti/firecrackers/fireworks', zh:'花瓣/鞭炮/烟花', vi:'cánh hoa/pháo hoa', ja:'花びら/爆竹/花火', tw:'花瓣/鞭炮/煙火', th:'กลีบดอกไม้/พลุ/ดอกไม้ไฟ', id:'kelopak/petasan/kembang api', tl:'petals/paputok/fireworks', ru:'лепестки/петарды/фейерверки', es:'pétalos/petardos/fuegos artificiales', fr:'pétales/pétards/feux d’artifice'
  }
};
function translationFallback(name){
  const ko = cleanText(name);
  const base = Object.assign({}, CATEGORY_FALLBACK_TRANSLATIONS[ko] || {});
  base.ko = ko;
  CATEGORY_LANGS.forEach(l => { if(!cleanText(base[l])) base[l] = ko; });
  return base;
}
function translationKeywordString(t){
  const seen = new Set();
  const arr=[];
  CATEGORY_LANGS.forEach(l => {
    cleanText(t && t[l]).split(/[|,\/]+/g).forEach(v=>{
      v=cleanText(v); if(!v) return; const k=v.toLowerCase(); if(seen.has(k)) return; seen.add(k); arr.push(v);
    });
  });
  return arr.join(',');
}
async function findNameTranslations(pool, name){
  const ko = cleanText(name);
  const out = translationFallback(ko);
  if(!ko) return out;
  try{
    const cols = CATEGORY_NAME_COLS.join(', ');
    const r = await pool.query(`SELECT ${cols}, keyword, keyword_seed FROM gm_category WHERE name_ko=$1 ORDER BY COALESCE(search_count,0) DESC, COALESCE(depth,0) DESC LIMIT 1`, [ko]);
    const row = r.rows && r.rows[0];
    if(row){
      CATEGORY_LANGS.forEach(l => { const v=cleanText(row['name_'+l]); if(v) out[l]=v; });
    }
  }catch(e){ try{ console.warn('[GM_CATEGORY_TRANSLATION_LOOKUP_FAIL]', Object.assign({name:ko}, compactError(e))); }catch(_l){} }
  return out;
}

function pickCpSelectedCode(p){
  return cleanText(firstNonEmpty(p, ['cp_selected_code','cpSelectedCode','selectedCategoryCode','categorySelectedCode']));
}
function pickCpFixCode(p){
  const v = cleanText(firstNonEmpty(p, ['cp_fix_code','cpFixCode','cp_code','cpCode','cp_category_no','cpCategoryNo','categoryNo','category_no','displayCategoryCode','leafCategoryId']));
  return /^\d+$/.test(v) ? v : '';
}

// GM_CP_SELECTED_FIX_V027
// cp_selected_code: 검색어를 gm_category와 매칭해서 고른 후보 카테고리 코드.
// cp_fix_code: 상세페이지 CATEGORY_INFO leaf에서 직접 확인한 최종 카테고리 코드.
// cp_match: T = 해당 상품 상세에서 직접 확인, F = 검색어/selected_code 기준 전파값.
function normalizeCpMatch(v){
  const s = cleanText(v).toUpperCase();
  if(['T','TRUE','Y','YES','1','DETAIL','DETAIL_EXACT','MATCH'].includes(s)) return 'T';
  if(['F','FALSE','N','NO','0','INFER','AI','PROPAGATED','SEARCH'].includes(s)) return 'F';
  return '';
}
async function ensureProductCpColumns(pool){
  try{ await pool.query(`ALTER TABLE gm_product ADD COLUMN IF NOT EXISTS cp_selected_code TEXT`); }catch(_e){}
  try{ await pool.query(`ALTER TABLE gm_product ADD COLUMN IF NOT EXISTS cp_fix_code TEXT`); }catch(_e){}
  try{ await pool.query(`ALTER TABLE gm_product ADD COLUMN IF NOT EXISTS cp_match TEXT NOT NULL DEFAULT 'F'`); }catch(_e){ try{ await pool.query(`ALTER TABLE gm_product ADD COLUMN IF NOT EXISTS cp_match TEXT`); }catch(_e2){} }
}
async function ensureDynamicCategoryTable(pool){
  try{
    await pool.query(`CREATE TABLE IF NOT EXISTS gm_category_dynamic (
      id BIGSERIAL PRIMARY KEY,
      mall_code TEXT NOT NULL DEFAULT 'CPKR',
      gm_code TEXT NOT NULL,
      cp_code TEXT NOT NULL,
      gm_parent_code TEXT,
      cp_parent_code TEXT,
      cp_id TEXT,
      parent_name_ko TEXT,
      depth INTEGER NOT NULL DEFAULT 1,
      leaf_yn TEXT NOT NULL DEFAULT 'Y',
      display_yn TEXT NOT NULL DEFAULT 'Y',
      sort_order INTEGER NOT NULL DEFAULT 0,
      name_ko TEXT NOT NULL,
      keyword TEXT,
      category_path TEXT,
      source_keyword TEXT,
      source_product_id TEXT,
      source_item_id TEXT,
      source_vendor_item_id TEXT,
      source TEXT NOT NULL DEFAULT 'detail_auto',
      active_yn TEXT NOT NULL DEFAULT 'Y',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (mall_code, cp_code)
    )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_gm_category_dynamic_keyword ON gm_category_dynamic(keyword)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_gm_category_dynamic_name_ko ON gm_category_dynamic(name_ko)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_gm_category_dynamic_parent ON gm_category_dynamic(cp_parent_code)`);
  }catch(e){ try{ console.warn('[GM_CATEGORY_DYNAMIC_DDL_FAIL]', compactError(e)); }catch(_l){} }
}
function normalizeCategoryNameForMatch(v){ return cleanText(v).replace(/\s+/g,'').toLowerCase(); }
function pickFirstCategoryTreeSource(p){
  const keys=['mall_category_json','mallCategoryJson','cp_category_tree_json','cpCategoryTreeJson','category_tree_json','categoryTreeJson','categoryTree','category_tree','cpCategoryTree','cp_category_tree','breadcrumbs','breadcrumb','categoryPathItems','category_path_items'];
  for(const k of keys){
    let v=p && p[k];
    if(typeof v === 'string'){ const parsed=parseMaybeJsonAny(v); if(parsed) v=parsed; }
    if(v && !Array.isArray(v) && Array.isArray(v.path)) v=v.path;
    if(v && !Array.isArray(v) && Array.isArray(v.nodes)) v=v.nodes;
    if(v && !Array.isArray(v) && Array.isArray(v.tree)) v=v.tree;
    if(Array.isArray(v) && v.length) return v;
  }
  return [];
}
function parseCategoryTreeFromPayload(p){
  p=p||{};
  let src = pickFirstCategoryTreeSource(p);
  let arr=[];
  if(Array.isArray(src)){
    arr=src.map((x,i)=>{
      if(isPlainObject(x)) return {
        depth: toInt(x.depth || x.level || (i+1), i+1),
        cp_code: cleanText(x.cp_code || x.cpCode || x.id || x.code || x.categoryId || x.category_id || x.cate_no || x.cateNo || ''),
        name_ko: cleanText(x.name_ko || x.nameKo || x.name || x.categoryName || x.category_name || x.title || x.label || ''),
        href: cleanText(x.href || x.url || '')
      };
      return { depth:i+1, cp_code:'', name_ko:cleanText(x), href:'' };
    }).filter(x=>x.name_ko || x.cp_code);
  }
  if(!arr.length){
    const path=cleanText(p.mall_category_path || p.mallCategoryPath || p.cp_category_path || p.cpCategoryPath || p.category_path || p.categoryPath || '');
    if(path) arr=path.split(/\s*>\s*/).map((name,i)=>({depth:i+1, cp_code:'', name_ko:cleanText(name), href:''})).filter(x=>x.name_ko);
  }
  const leafCode=cleanText(p.cp_fix_code || p.cpFixCode || p.cp_code || p.cpCode || p.mall_category_id || p.mallCategoryId || p.mall_category || p.mallCategory || '');
  if(arr.length && leafCode && !arr[arr.length-1].cp_code) arr[arr.length-1].cp_code=leafCode;
  return arr.filter(x=>!/^쿠팡\s*홈$/i.test(x.name_ko)).map((x,i)=>Object.assign({}, x, { depth:i+1 }));
}
async function findCategoryRow(pool, code, name, parentCode){
  code=cleanText(code); name=cleanText(name); parentCode=cleanText(parentCode);

  // IMPORTANT: 상세에서 쿠팡 cp_code가 들어온 경우에는 이름 중복으로 대체하지 않는다.
  // 폭죽처럼 같은 name_ko가 여러 부모 아래 존재하므로, cp_code가 다르면 반드시 신규 카테고리로 본다.
  if(code){
    const sql=`WITH allcat AS (
      SELECT 'base' AS src, gm_code, cp_code, gm_parent_code, cp_parent_code, name_ko, parent_name_ko, COALESCE(depth::int,0) depth, leaf_yn, COALESCE(sort_order::int,0) sort_order FROM gm_category
      UNION ALL
      SELECT 'dynamic' AS src, gm_code, cp_code, gm_parent_code, cp_parent_code, name_ko, parent_name_ko, COALESCE(depth::int,0) depth, leaf_yn, COALESCE(sort_order::int,0) sort_order FROM gm_category_dynamic
    ) SELECT * FROM allcat WHERE cp_code=$1 LIMIT 1`;
    try{ const r=await pool.query(sql, [code]); return r.rows[0]||null; }catch(e){ try{ console.warn('[GM_CATEGORY_FIND_CODE_FAIL]', Object.assign({code,name,parentCode}, compactError(e))); }catch(_l){} return null; }
  }

  // code가 없을 때만 이름으로 부모 탐색을 보조한다. 이 결과는 후보/부모 추정용이지 신규 cp_code 삽입 차단용이 아니다.
  const params=[]; let idx=1; const conds=[];
  if(name){
    if(parentCode){ conds.push(`(name_ko=$${idx++} AND COALESCE(cp_parent_code,'')=$${idx++})`); params.push(name,parentCode); }
    conds.push(`name_ko=$${idx++}`); params.push(name);
  }
  if(!conds.length) return null;
  const sql=`WITH allcat AS (
    SELECT 'base' AS src, gm_code, cp_code, gm_parent_code, cp_parent_code, name_ko, parent_name_ko, COALESCE(depth::int,0) depth, leaf_yn, COALESCE(sort_order::int,0) sort_order FROM gm_category
    UNION ALL
    SELECT 'dynamic' AS src, gm_code, cp_code, gm_parent_code, cp_parent_code, name_ko, parent_name_ko, COALESCE(depth::int,0) depth, leaf_yn, COALESCE(sort_order::int,0) sort_order FROM gm_category_dynamic
  ) SELECT * FROM allcat WHERE ${conds.join(' OR ')}
    ORDER BY CASE WHEN COALESCE(cp_parent_code,'')=$${idx} THEN 0 ELSE 1 END,
             CASE WHEN name_ko=$${idx+1} THEN 0 ELSE 1 END,
             depth DESC, src LIMIT 1`;
  params.push(parentCode,name);
  try{ const r=await pool.query(sql, params); return r.rows[0]||null; }catch(e){ try{ console.warn('[GM_CATEGORY_FIND_NAME_FAIL]', Object.assign({code,name,parentCode}, compactError(e))); }catch(_l){} return null; }
}

function makeDynamicGmCode(parentCode, seq){
  let code=cleanText(parentCode) || 'XX-00-000-0000-0000-0000';
  let parts=code.split('-');
  while(parts.length<6) parts.push(parts.length<3?'000':'0000');
  parts[0]='XX';
  let target=-1;
  for(let i=1;i<parts.length;i++){ if(/^0+$/.test(parts[i])){ target=i; break; } }
  if(target<0) target=parts.length-1;
  const width=parts[target].length || (target<=2?3:4);
  parts[target]=String(seq).padStart(width,'0');
  for(let i=target+1;i<parts.length;i++) parts[i]='0'.repeat(parts[i].length || 4);
  return parts.join('-');
}
async function nextDynamicChildSeq(pool, parentCpCode){
  parentCpCode=cleanText(parentCpCode);
  try{
    const r=await pool.query(`
      SELECT COALESCE(SUM(cnt),0)::int AS cnt FROM (
        SELECT COUNT(*)::int AS cnt FROM gm_category WHERE COALESCE(cp_parent_code,'')=$1
        UNION ALL
        SELECT COUNT(*)::int AS cnt FROM gm_category_dynamic WHERE COALESCE(cp_parent_code,'')=$1
      ) x`, [parentCpCode]);
    return (r.rows[0] && Number(r.rows[0].cnt) || 0) + 1;
  }catch(_e){ return 1; }
}

let __gmCategoryColumnsCache = null;
async function getGmCategoryColumns(pool){
  if(__gmCategoryColumnsCache) return __gmCategoryColumnsCache;
  try{
    const r = await pool.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name='gm_category'`);
    const map = new Map();
    (r.rows||[]).forEach(x=>map.set(cleanText(x.column_name), cleanText(x.data_type)));
    __gmCategoryColumnsCache = map;
    return map;
  }catch(e){
    try{ console.warn('[GM_CATEGORY_COLUMNS_LOOKUP_FAIL]', compactError(e)); }catch(_l){}
    __gmCategoryColumnsCache = new Map();
    return __gmCategoryColumnsCache;
  }
}
function pushCategoryValue(cols, vals, col, val, columnMap){
  if(!columnMap.has(col)) return;
  cols.push(col);
  vals.push(val);
}
async function nextGmCategoryNumber(pool, columnName){
  columnName = cleanText(columnName);
  if(!/^[a-zA-Z0-9_]+$/.test(columnName)) return 1;
  try{
    const r = await pool.query(`SELECT COALESCE(MAX(${columnName}::bigint),0)::bigint + 1 AS next_no FROM gm_category WHERE ${columnName}::text ~ '^[0-9]+$'`);
    return Number((r.rows && r.rows[0] && r.rows[0].next_no) || 1);
  }catch(_e){
    try{
      const r = await pool.query(`SELECT COALESCE(MAX(${columnName}),0) + 1 AS next_no FROM gm_category`);
      return Number((r.rows && r.rows[0] && r.rows[0].next_no) || 1);
    }catch(_e2){ return 1; }
  }
}
async function buildGmCategoryInsertIdentity(pool, row, columnMap){
  const out = {};
  // CSV/운영 DB에서 category_id가 필수값처럼 쓰인다. 없으면 INSERT가 조용히 실패하므로 항상 보정한다.
  if(columnMap.has('category_id')){
    const explicit = toInt(row.category_id, 0);
    out.category_id = explicit > 0 ? explicit : await nextGmCategoryNumber(pool, 'category_id');
  }
  if(columnMap.has('id')){
    const explicit = toInt(row.id, 0);
    if(explicit > 0) out.id = explicit;
  }
  if(columnMap.has('sort_order')){
    const explicit = toInt(row.sort_order, 0);
    out.sort_order = explicit > 0 ? explicit : (out.category_id || await nextGmCategoryNumber(pool, 'sort_order'));
  }
  return out;
}
async function insertGmCategoryRow(pool, row){
  const columnMap = await getGmCategoryColumns(pool);
  const cols=[]; const vals=[];
  const tr = row.translations || translationFallback(row.name_ko);
  const identity = await buildGmCategoryInsertIdentity(pool, row, columnMap);
  pushCategoryValue(cols, vals, 'category_id', identity.category_id, columnMap);
  pushCategoryValue(cols, vals, 'id', identity.id, columnMap);
  pushCategoryValue(cols, vals, 'gm_code', row.gm_code, columnMap);
  pushCategoryValue(cols, vals, 'cp_code', row.cp_code, columnMap);
  pushCategoryValue(cols, vals, 'gm_parent_code', row.gm_parent_code || '', columnMap);
  pushCategoryValue(cols, vals, 'cp_parent_code', row.cp_parent_code || '', columnMap);
  pushCategoryValue(cols, vals, 'cp_id', row.cp_id || '', columnMap);
  pushCategoryValue(cols, vals, 'parent_name_ko', row.parent_name_ko || '', columnMap);
  pushCategoryValue(cols, vals, 'depth', toInt(row.depth,1), columnMap);
  pushCategoryValue(cols, vals, 'leaf_yn', row.leaf_yn || 'Y', columnMap);
  pushCategoryValue(cols, vals, 'display_yn', row.display_yn || 'Y', columnMap);
  pushCategoryValue(cols, vals, 'sort_order', identity.sort_order || toInt(row.sort_order,0), columnMap);
  pushCategoryValue(cols, vals, 'name_ko', row.name_ko, columnMap);
  for(const l of CATEGORY_LANGS){
    pushCategoryValue(cols, vals, 'name_'+l, cleanText(tr[l]) || row.name_ko, columnMap);
  }
  pushCategoryValue(cols, vals, 'keyword_seed', row.keyword || row.name_ko, columnMap);
  pushCategoryValue(cols, vals, 'keyword', row.keyword || row.name_ko, columnMap);
  pushCategoryValue(cols, vals, 'category_path', row.category_path || '', columnMap);
  pushCategoryValue(cols, vals, 'source_keyword', row.source_keyword || '', columnMap);
  pushCategoryValue(cols, vals, 'source', row.source || 'detail_auto', columnMap);
  pushCategoryValue(cols, vals, 'active_yn', 'Y', columnMap);
  pushCategoryValue(cols, vals, 'raw_json', JSON.stringify(row.raw_json || {}), columnMap);
  for(const c of ['view_count','search_count','wish_count','cart_count','order_count','sales_qty','sales_amount','purchase_amount','gross_profit','return_count','exchange_count','ad_view_count','ad_order_count','ad_sales_qty','ad_sales_amount']){
    pushCategoryValue(cols, vals, c, 0, columnMap);
  }
  pushCategoryValue(cols, vals, 'created_at', new Date(), columnMap);
  pushCategoryValue(cols, vals, 'updated_at', new Date(), columnMap);
  if(!cols.includes('cp_code') || !cols.includes('name_ko')) throw new Error('gm_category required columns missing: cp_code/name_ko');
  const placeholders = vals.map((_,i)=>'$'+(i+1)).join(',');
  const sql = `INSERT INTO gm_category (${cols.join(',')}) VALUES (${placeholders}) RETURNING *`;
  try{
    const exists = await findCategoryRow(pool, row.cp_code, '', '');
    if(exists) return exists;
    const ins = await pool.query(sql, vals);
    return ins.rows && ins.rows[0] || null;
  }catch(e){
    e.gm_category_insert_context = {
      cp_code: cleanText(row.cp_code),
      name_ko: cleanText(row.name_ko),
      parent_cp_code: cleanText(row.cp_parent_code),
      category_id: identity.category_id,
      sort_order: identity.sort_order,
      cols
    };
    throw e;
  }
}

async function insertDynamicFallbackRow(pool, row){
  await ensureDynamicCategoryTable(pool);
  const tr = row.translations || translationFallback(row.name_ko);
  const keywordText = row.keyword || translationKeywordString(tr) || row.name_ko;
  const vals = [
    cleanText(row.mall_code || 'CPKR'), cleanText(row.gm_code), cleanText(row.cp_code), cleanText(row.gm_parent_code||''), cleanText(row.cp_parent_code||''), cleanText(row.cp_id||''),
    cleanText(row.parent_name_ko||''), toInt(row.depth,1), cleanText(row.leaf_yn||'Y'), cleanText(row.display_yn||'Y'), toInt(row.sort_order,0), cleanText(row.name_ko),
    keywordText, cleanText(row.category_path||''), cleanText(row.source_keyword||''), cleanText(row.source_product_id||''), cleanText(row.source_item_id||''), cleanText(row.source_vendor_item_id||'')
  ];
  const r = await pool.query(`INSERT INTO gm_category_dynamic (mall_code,gm_code,cp_code,gm_parent_code,cp_parent_code,cp_id,parent_name_ko,depth,leaf_yn,display_yn,sort_order,name_ko,keyword,category_path,source_keyword,source_product_id,source_item_id,source_vendor_item_id)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
    ON CONFLICT (mall_code, cp_code) DO UPDATE SET updated_at=now(), gm_parent_code=EXCLUDED.gm_parent_code, cp_parent_code=EXCLUDED.cp_parent_code, category_path=EXCLUDED.category_path
    RETURNING *`, vals);
  return r.rows && r.rows[0] || null;
}

async function ensureDynamicCategoriesFromDetail(pool, p, meta){
  // 이름 중복 때문에 상세 카테고리 생성은 name_ko가 아니라 cp_code 기준이다.
  // 신규 cp_code는 gm_category 본 테이블에 추가해서 builder 다운로드에 바로 보이게 한다.
  meta=meta||{}; p=p||{};
  await ensureDynamicCategoryTable(pool);
  const tree=parseCategoryTreeFromPayload(p);
  if(!tree.length) return { applied:false, reason:'no_category_tree' };
  const created=[]; const matched=[]; let parent=null;
  const mallCode=cleanText(meta.mall_code || p.mall_code || p.mallCode || 'CPKR').toUpperCase();
  const sourceKeyword=cleanText(meta.keyword || p.keyword || '');
  for(const node of tree){
    let row=await findCategoryRow(pool, node.cp_code, node.name_ko, parent && parent.cp_code);
    if(row){ matched.push({ name:node.name_ko, cp_code:row.cp_code, source:row.src, parent:row.cp_parent_code || '' }); parent=row; continue; }
    if(!node.cp_code){ matched.push({ name:node.name_ko, cp_code:'', source:'name_only_no_code' }); continue; }

    const parentCode=cleanText(parent && parent.cp_code || '');
    const parentGm=cleanText(parent && parent.gm_code || 'XX-00-000-0000-0000-0000');
    const seq=await nextDynamicChildSeq(pool, parentCode);
    const gmCode=makeDynamicGmCode(parentGm, seq);
    const path=tree.slice(0, node.depth).map(x=>x.name_ko).filter(Boolean).join(' > ');
    const isLeaf = node.depth >= tree.length ? 'Y' : 'N';
    try{
      const tr = await findNameTranslations(pool, node.name_ko);
      const keywordText = translationKeywordString(tr) || node.name_ko;
      const raw = { source:'detail_auto', mall_code:mallCode, category_path:path, source_keyword:sourceKeyword, source_product_id:cleanText(meta.product_id||''), source_item_id:cleanText(meta.item_id||''), source_vendor_item_id:cleanText(meta.vendor_item_id||''), translations:tr };
      const inserted = await insertGmCategoryRow(pool, {
        gm_code: gmCode,
        cp_code: node.cp_code,
        gm_parent_code: cleanText(parent && parent.gm_code || ''),
        cp_parent_code: parentCode,
        cp_id: '',
        parent_name_ko: cleanText(parent && parent.name_ko || ''),
        depth: node.depth,
        leaf_yn: isLeaf,
        display_yn: 'Y',
        sort_order: seq,
        name_ko: node.name_ko,
        keyword: keywordText,
        category_path: path,
        source_keyword: sourceKeyword,
        source: 'detail_auto',
        raw_json: raw,
        translations: tr
      });
      if(inserted){
        row={
          src:'base',
          gm_code:cleanText(inserted.gm_code || gmCode),
          cp_code:cleanText(inserted.cp_code || node.cp_code),
          gm_parent_code:cleanText(inserted.gm_parent_code || (parent && parent.gm_code) || ''),
          cp_parent_code:cleanText(inserted.cp_parent_code || parentCode),
          name_ko:cleanText(inserted.name_ko || node.name_ko),
          parent_name_ko:cleanText(inserted.parent_name_ko || (parent && parent.name_ko) || ''),
          depth:toInt(inserted.depth, node.depth),
          leaf_yn:cleanText(inserted.leaf_yn || isLeaf),
          sort_order:toInt(inserted.sort_order, seq)
        };
        created.push({ table:'gm_category', name:node.name_ko, cp_code:node.cp_code, parent_cp_code:parentCode, gm_code:row.gm_code, path });
      }else{
        row=await findCategoryRow(pool, node.cp_code, '', '') || { src:'base', gm_code:gmCode, cp_code:node.cp_code, cp_parent_code:parentCode, name_ko:node.name_ko, parent_name_ko:cleanText(parent && parent.name_ko || ''), depth:node.depth, leaf_yn:isLeaf, sort_order:seq };
        matched.push({ name:node.name_ko, cp_code:node.cp_code, source:'conflict_or_existing_after_insert', parent:parentCode });
      }
      parent=row;
    }catch(e){
      const err = Object.assign({node,parentCode, insert_context:e && e.gm_category_insert_context}, compactError(e));
      try{
        const tr = await findNameTranslations(pool, node.name_ko);
        const path=tree.slice(0, node.depth).map(x=>x.name_ko).filter(Boolean).join(' > ');
        const fallback = await insertDynamicFallbackRow(pool, {
          mall_code:mallCode, gm_code:gmCode, cp_code:node.cp_code, gm_parent_code:cleanText(parent && parent.gm_code || ''), cp_parent_code:parentCode,
          cp_id:'', parent_name_ko:cleanText(parent && parent.name_ko || ''), depth:node.depth, leaf_yn:isLeaf, display_yn:'Y', sort_order:seq,
          name_ko:node.name_ko, keyword:translationKeywordString(tr) || node.name_ko, category_path:path, source_keyword:sourceKeyword,
          source_product_id:cleanText(meta.product_id||''), source_item_id:cleanText(meta.item_id||''), source_vendor_item_id:cleanText(meta.vendor_item_id||''), translations:tr
        });
        if(fallback){
          row={src:'dynamic', gm_code:cleanText(fallback.gm_code || gmCode), cp_code:cleanText(fallback.cp_code || node.cp_code), gm_parent_code:cleanText(fallback.gm_parent_code || (parent && parent.gm_code) || ''), cp_parent_code:cleanText(fallback.cp_parent_code || parentCode), name_ko:cleanText(fallback.name_ko || node.name_ko), parent_name_ko:cleanText(fallback.parent_name_ko || (parent && parent.name_ko) || ''), depth:toInt(fallback.depth, node.depth), leaf_yn:cleanText(fallback.leaf_yn || isLeaf), sort_order:toInt(fallback.sort_order, seq)};
          created.push({ table:'gm_category_dynamic', fallback:true, name:node.name_ko, cp_code:node.cp_code, parent_cp_code:parentCode, gm_code:row.gm_code, path, gm_category_error:err });
          parent=row;
        }else{
          created.push({ table:'gm_category', name:node.name_ko, cp_code:node.cp_code, parent_cp_code:parentCode, error:err });
        }
      }catch(e2){
        created.push({ table:'gm_category', name:node.name_ko, cp_code:node.cp_code, parent_cp_code:parentCode, error:Object.assign({ fallback_error:compactError(e2) }, err) });
      }
      try{ console.warn('[GM_CATEGORY_INSERT_FAIL]', err); }catch(_l){}
    }
  }
  const errors = created.filter(x=>x && x.error);
  try{ console.log('[GM_CATEGORY_DYNAMIC_RESULT]', { table:'gm_category', created_count:created.filter(x=>!x.error).length, matched_count:matched.length, error_count:errors.length, created, matched:matched.slice(-8) }); }catch(_l){}
  return { applied:true, created_count:created.filter(x=>!x.error).length, matched_count:matched.length, error_count:errors.length, created, matched, errors };
}

async function findCategoryCandidatesForKeyword(pool, keyword){
  const kw=cleanText(keyword);
  if(!kw) return [];
  await ensureDynamicCategoryTable(pool);
  try{
    const r=await pool.query(`
      WITH allcat AS (
        SELECT 'base' AS src, cp_code, name_ko, keyword, keyword_seed, gm_code, gm_parent_code, cp_parent_code, parent_name_ko, COALESCE(depth::int,0) depth, leaf_yn, COALESCE(search_count::int,0) search_count
        FROM gm_category
        UNION ALL
        SELECT 'dynamic' AS src, cp_code, name_ko, keyword, keyword AS keyword_seed, gm_code, gm_parent_code, cp_parent_code, parent_name_ko, COALESCE(depth::int,0) depth, leaf_yn, 0 AS search_count
        FROM gm_category_dynamic WHERE active_yn='Y'
      )
      SELECT *, CASE
        WHEN name_ko=$1 THEN 'EXACT'
        WHEN keyword=$1 OR keyword_seed=$1 THEN 'KEYWORD'
        WHEN $1 = ANY(regexp_split_to_array(COALESCE(keyword,'') || ',' || COALESCE(keyword_seed,''), '\\s*,\\s*')) THEN 'KEYWORD_LIST'
        WHEN position($1 in COALESCE(name_ko,'')) > 0 THEN 'PARTIAL'
        ELSE 'OTHER' END AS match_type
      FROM allcat
      WHERE COALESCE(cp_code,'')<>'' AND (
        name_ko=$1 OR keyword=$1 OR keyword_seed=$1
        OR $1 = ANY(regexp_split_to_array(COALESCE(keyword,'') || ',' || COALESCE(keyword_seed,''), '\\s*,\\s*'))
        OR position($1 in COALESCE(name_ko,'')) > 0
      )
      ORDER BY CASE WHEN name_ko=$1 THEN 0 WHEN keyword=$1 OR keyword_seed=$1 THEN 1 WHEN position($1 in COALESCE(name_ko,'')) > 0 THEN 3 ELSE 8 END,
               depth DESC, CASE WHEN leaf_yn='Y' THEN 0 ELSE 1 END, search_count DESC, cp_code
      LIMIT 50`, [kw]);
    return r.rows || [];
  }catch(e){ try{ console.warn('[GM_CATEGORY_CANDIDATE_FAIL]', Object.assign({keyword:kw}, compactError(e))); }catch(_l){} return []; }
}
async function findCpSelectedCodeForKeyword(pool, keyword){
  // 검색 단계에서는 동명이인 카테고리 문제 때문에 확정 선택하지 않는다.
  // exact 후보가 하나뿐일 때만 selected를 넣고, 그 외에는 상세 category_tree에서 path로 확정한다.
  const kw = cleanText(keyword);
  if(!kw) return '';
  const cand=await findCategoryCandidatesForKeyword(pool, kw);
  const exact=cand.filter(r=>cleanText(r.name_ko)===kw || cleanText(r.keyword)===kw || cleanText(r.keyword_seed)===kw);
  let code='';
  if(exact.length === 1) code=cleanText(exact[0].cp_code);
  try{ console.log('[GM_CP_SELECTED_MATCH]', { keyword:kw, candidate_count:cand.length, exact_count:exact.length, cp_selected_code:code, candidates:cand.slice(0,8).map(r=>({cp_code:r.cp_code,name_ko:r.name_ko,parent_name_ko:r.parent_name_ko,cp_parent_code:r.cp_parent_code,depth:r.depth,match_type:r.match_type})) }); }catch(_l){}
  return code;
}
async function findCpSelectedCodeForKeywordAndTree(pool, keyword, tree){
  const kw=cleanText(keyword);
  if(!kw || !Array.isArray(tree) || !tree.length) return '';
  const cand=await findCategoryCandidatesForKeyword(pool, kw);
  if(!cand.length) return '';
  const names=tree.map(x=>normalizeCategoryNameForMatch(x.name_ko));
  const codes=tree.map(x=>cleanText(x.cp_code));
  const nameSet=new Set(names.filter(Boolean));
  const codeSet=new Set(codes.filter(Boolean));
  let best=null;
  for(const r of cand){
    const name=normalizeCategoryNameForMatch(r.name_ko);
    const parentName=normalizeCategoryNameForMatch(r.parent_name_ko);
    const cp=cleanText(r.cp_code);
    let score=0;
    if(name && nameSet.has(name)) score += 100;
    if(parentName && nameSet.has(parentName)) score += 80;
    if(cp && codeSet.has(cp)) score += 200;
    if(cleanText(r.name_ko) === kw) score += 40;
    else if(cleanText(r.name_ko).includes(kw)) score += 20;
    if(cleanText(r.leaf_yn)==='Y') score += 5;
    score += Math.min(toInt(r.depth,0), 20);
    const item={row:r, score};
    if(!best || item.score > best.score || (item.score===best.score && toInt(r.depth,0)>toInt(best.row.depth,0))) best=item;
  }
  const code=best && best.score>0 ? cleanText(best.row.cp_code) : '';
  try{ console.log('[GM_CP_SELECTED_TREE_MATCH]', { keyword:kw, cp_selected_code:code, score:best&&best.score, selected:best&&{cp_code:best.row.cp_code,name_ko:best.row.name_ko,parent_name_ko:best.row.parent_name_ko,cp_parent_code:best.row.cp_parent_code,depth:best.row.depth}, candidate_count:cand.length, tree:tree.map(x=>({cp_code:x.cp_code,name_ko:x.name_ko,depth:x.depth})) }); }catch(_l){}
  return code;
}
function decideCpMatch(p, mallCode, cpFixCode){
  const explicit = normalizeCpMatch(p.cp_match || p.cpMatch || '');
  if(explicit) return explicit;
  if(!cleanText(cpFixCode)) return 'F';
  const mall = cleanText(mallCode).toUpperCase();
  return mall === 'CPKR' ? 'T' : 'F';
}
async function applyCpFixLearning(pool, args){
  args=args||{};
  const mall=cleanText(args.mall_code).toUpperCase();
  const keyword=cleanText(args.keyword);
  const selected=cleanText(args.cp_selected_code);
  const fix=cleanText(args.cp_fix_code);
  const match=normalizeCpMatch(args.cp_match);
  const productUid=cleanText(args.product_uid);
  if(!fix) return { applied:false, reason:'no_cp_fix_code' };
  await ensureProductCpColumns(pool);
  const out={ applied:true, current:0, propagated:0, protected_t:0 };
  try{
    // 현재 상세 상품이 직접 검증(T)이면 해당 상품은 selected/fix 모두 leaf로 확정한다.
    if(productUid && match === 'T'){
      const r=await pool.query(`
        UPDATE gm_product
        SET cp_selected_code=$2, cp_fix_code=$2, cp_match='T', updated_at=now()
        WHERE product_uid=$1
          AND NOT (COALESCE(cp_match,'')='T' AND COALESCE(cp_fix_code,'')<>'' AND COALESCE(cp_fix_code,'')<>$2)
          AND (COALESCE(cp_selected_code,'')<>$2 OR COALESCE(cp_fix_code,'')<>$2 OR COALESCE(cp_match,'')<>'T')
      `, [productUid, fix]);
      out.current=r.rowCount||0;
    }

    if(match === 'T'){
      try{
        const pt=await pool.query(`SELECT COUNT(*)::int AS cnt FROM gm_product WHERE COALESCE(cp_match,'')='T' AND product_uid<>$1 AND (keyword=$2 OR cp_selected_code=$2 OR cp_selected_code=$3)`, [productUid || '', keyword, selected]);
        out.protected_t = (pt.rows && pt.rows[0] && Number(pt.rows[0].cnt)) || 0;
      }catch(_e){}
      // 같은 검색어로 들어온 미분류/과거 selected 상품은 모두 leaf로 승격한다.
      // 단, 이미 T인 상품은 절대 건드리지 않는다.
      const f=await pool.query(`
        UPDATE gm_product
        SET cp_selected_code=$2, cp_fix_code=$2, cp_match='F', updated_at=now()
        WHERE product_uid<>$3
          AND COALESCE(cp_match,'')<>'T'
          AND (
            ($1<>'' AND keyword=$1)
            OR ($1<>'' AND cp_selected_code=$1)
            OR ($4<>'' AND cp_selected_code=$4)
          )
          AND (COALESCE(cp_selected_code,'')<>$2 OR COALESCE(cp_fix_code,'')<>$2 OR COALESCE(cp_match,'')<>'F')
      `, [keyword, fix, productUid || '', selected]);
      out.propagated=f.rowCount||0;
    }
    try{ console.log('[GM_CP_FIX_PROPAGATE]', { mall, keyword, old_selected:selected, fix, match, product_uid:productUid, result:out }); }catch(_l){}
    return out;
  }catch(e){
    try{ console.warn('[GM_CP_FIX_LEARNING_FAIL]', Object.assign({ mall, keyword, cp_selected_code:selected, cp_fix_code:fix, cp_match:match }, compactError(e))); }catch(_l){}
    return { applied:false, error:compactError(e) };
  }
}


module.exports = {
  pickCpSelectedCode,
  pickCpFixCode,
  normalizeCpMatch,
  ensureProductCpColumns,
  ensureDynamicCategoryTable,
  parseCategoryTreeFromPayload,
  findCpSelectedCodeForKeyword,
  findCpSelectedCodeForKeywordAndTree,
  ensureDynamicCategoriesFromDetail,
  decideCpMatch,
  applyCpFixLearning
};
