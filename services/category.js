
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
  '아트/공예': {
    en:'Arts/Crafts', zh:'艺术/手工', vi:'Nghệ thuật/Thủ công', ja:'アート／クラフト', tw:'藝術/手作', th:'ศิลปะ/งานฝีมือ', uz:'San’at/Hunarmandchilik', ne:'कला/शिल्प', km:'សិល្បៈ/សិប្បកម្ម', id:'Seni/Kerajinan', tl:'Sining/Kasangkapan', mn:'Урлаг/Гар урлал', my:'အနုပညာ/လက်မှုပညာ', kk:'Өнер/Қолөнер', si:'කලා/හස්තකර්මාන්ත', ru:'Искусство/Ремесла', bn:'শিল্প/কারুশিল্প', ur:'آرٹ/دستکاری', lo:'ສິລະປະ/ຫັດຖະກຳ', hi:'कला/शिल्प', tr:'Sanat/El işleri', fa:'هنر/صنایع دستی', es:'Arte/Manualidades', fr:'Arts/Loisirs créatifs'
  },
  '결혼준비': {
    en:'Wedding preparation', zh:'婚礼准备', vi:'Chuẩn bị đám cưới', ja:'結婚準備', tw:'婚禮準備', th:'การเตรียมงานแต่งงาน', uz:'To‘y tayyorgarligi', ne:'विवाह तयारी', km:'ការរៀបចំអាពាហ៍ពិពាហ៍', id:'Persiapan pernikahan', tl:'Paghahanda sa kasal', mn:'Хуримын бэлтгэл', my:'မင်္ဂလာဆောင်ပြင်ဆင်မှု', kk:'Үйлену тойына дайындық', si:'විවාහ සූදානම', ru:'Подготовка к свадьбе', bn:'বিয়ের প্রস্তুতি', ur:'شادی کی تیاری', lo:'ການກະກຽມງານແຕ່ງງານ', hi:'शादी की तैयारी', tr:'Düğün hazırlığı', fa:'آمادگی عروسی', es:'Preparación de boda', fr:'Préparation du mariage'
  },
  '이벤트용품': {
    en:'Event supplies', zh:'活动用品', vi:'Đồ dùng sự kiện', ja:'イベント用品', tw:'活動用品', th:'อุปกรณ์งานอีเวนต์', uz:'Tadbir buyumlari', ne:'कार्यक्रम सामग्री', km:'សម្ភារៈព្រឹត្តិការណ៍', id:'Perlengkapan acara', tl:'Kagamitan sa kaganapan', mn:'Арга хэмжээний хэрэгсэл', my:'ပွဲအခမ်းအနားပစ္စည်းများ', kk:'Іс-шара жабдықтары', si:'උත්සව භාණ්ඩ', ru:'Товары для мероприятий', bn:'ইভেন্ট সামগ্রী', ur:'ایونٹ کا سامان', lo:'ອຸປະກອນກິດຈະກຳ', hi:'इवेंट सामग्री', tr:'Etkinlik malzemeleri', fa:'لوازم رویداد', es:'Artículos para eventos', fr:'Articles événementiels'
  },
  '파티/이벤트': {
    en:'Party/Event', zh:'派对/活动', vi:'Tiệc/Sự kiện', ja:'パーティー／イベント', tw:'派對/活動', th:'งานเลี้ยง/กิจกรรม', uz:'Bayram/Tadbir', ne:'पार्टी/कार्यक्रम', km:'ពិធីជប់លៀង/ព្រឹត្តិការណ៍', id:'Pesta/Acara', tl:'Party/Kaganapan', mn:'Үдэшлэг/Арга хэмжээ', my:'ပါတီ/ပွဲ', kk:'Кеш/Іс-шара', si:'සාදය/සිදුවීම', ru:'Вечеринка/Мероприятие', bn:'পার্টি/অনুষ্ঠান', ur:'پارٹی/ایونٹ', lo:'ງານລ້ຽງ/ກິດຈະກຳ', hi:'पार्टी/कार्यक्रम', tr:'Parti/Etkinlik', fa:'مهمانی/رویداد', es:'Fiesta/Evento', fr:'Fête/Événement'
  },
  '스파클라/불꽃놀이': {
    en:'Sparklers/Fireworks', zh:'仙女棒/烟花', vi:'Pháo sáng/Pháo hoa', ja:'線香花火／花火', tw:'仙女棒/煙火', th:'ดอกไม้ไฟ/พลุ', uz:'Uchqunlar/Mushakbozlik', ne:'स्पार्कलर/आतिशबाजी', km:'ផ្កាភ្លើង/កាំជ្រួច', id:'Kembang api/percikan api', tl:'Mga sparkler/paputok', mn:'Бенгал гал/Салют', my:'မီးပန်း/မီးရှူးမီးပန်း', kk:'Бенгал оттары/отшашулар', si:'ගිනි පුපුරු/ගිනිකෙළි', ru:'Бенгальские огни/Фейерверки', bn:'ফুলঝুরি/আতশবাজি', ur:'چمکنے والے/آتش بازی', lo:'ດອກໄຟ/ດອກໄມ້ໄຟ', hi:'फुलझड़ियाँ/आतिशबाजी', tr:'Maytap/Havai fişek', fa:'فشفشه/آتش‌بازی', es:'Bengalas/Fuegos artificiales', fr:'Cierges magiques/Feux d’artifice'
  },
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
  // GM_CATEGORY_TRANSLATE_NO_KO_COPY_V055
  // fallback 사전에 없는 언어를 한글로 복사하지 않는다.
  // 미번역은 빈 값으로 두고 빌더 업로드에서 24개국어 번역만 보강한다.
  CATEGORY_LANGS.forEach(l => { if(l !== 'ko' && !cleanText(base[l])) base[l] = ''; });
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
function categoryTranslationComplete(t){
  t = t || {};
  return CATEGORY_LANGS.filter(l => l !== 'ko').every(l => !!cleanText(t[l]));
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
      CATEGORY_LANGS.forEach(l => {
        const v=cleanText(row['name_'+l]);
        // 기존 잘못 생성된 row처럼 24개국어가 모두 한글로 복사된 값은 번역으로 보지 않는다.
        if(v && (l === 'ko' || v !== ko)) out[l]=v;
      });
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
function splitSlashCategoryTokens(v){
  const out=[];
  const seen=new Set();
  cleanText(v).split('/').forEach(x=>{
    const t=cleanText(x);
    if(!t) return;
    const k=normalizeCategoryNameForMatch(t);
    if(seen.has(k)) return;
    seen.add(k); out.push(t);
  });
  return out;
}
function isSlashExactNameMatch(name, keyword){
  const kw=normalizeCategoryNameForMatch(keyword);
  if(!kw) return false;
  if(normalizeCategoryNameForMatch(name) === kw) return true;
  return splitSlashCategoryTokens(name).some(t=>normalizeCategoryNameForMatch(t) === kw);
}

function isDeliveryPseudoCategoryName(name){
  const n=normalizeCategoryNameForMatch(name);
  if(!n) return false;
  return ['쿠팡홈','로켓프레시','로켓배송','로켓와우','판매자로켓','무료배송','판매자배송','쿠팡'].includes(n);
}
function isDeliveryPseudoCategoryCode(code, name){
  const c=cleanText(code);
  // 393760 has appeared from Coupang scripts as "로켓프레시". It is a service badge, not a category path node.
  if(c === '393760' && normalizeCategoryNameForMatch(name) === '로켓프레시') return true;
  return false;
}
function sanitizeCoupangCategoryTree(arr){
  const out=[]; const seen=new Set();
  (Array.isArray(arr)?arr:[]).forEach((x)=>{
    const cp=cleanText(x && x.cp_code);
    const name=cleanText(x && x.name_ko);
    if(!cp && !name) return;
    if(isDeliveryPseudoCategoryName(name) || isDeliveryPseudoCategoryCode(cp, name)) return;
    const sig=(cp||'')+'|'+normalizeCategoryNameForMatch(name);
    if(seen.has(sig)) return;
    seen.add(sig);
    out.push(Object.assign({}, x, { depth: out.length+1, cp_code: cp, name_ko: name }));
  });
  return out;
}
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
  return sanitizeCoupangCategoryTree(arr.filter(x=>!/^쿠팡\s*홈$/i.test(x.name_ko)).map((x,i)=>Object.assign({}, x, { depth:i+1 })));
}
async function findBaseCategoryRow(pool, code, name, parentCode){
  code=cleanText(code); name=cleanText(name); parentCode=cleanText(parentCode);
  if(code){
    try{
      const r=await pool.query(`SELECT 'base' AS src, gm_code, cp_code, gm_parent_code, cp_parent_code, name_ko, parent_name_ko, COALESCE(depth::int,0) depth, leaf_yn, COALESCE(sort_order::int,0) sort_order FROM gm_category WHERE cp_code::text=$1 LIMIT 1`, [code]);
      return r.rows[0]||null;
    }catch(e){ try{ console.warn('[GM_CATEGORY_BASE_FIND_CODE_FAIL]', Object.assign({code,name,parentCode}, compactError(e))); }catch(_l){} return null; }
  }
  if(!name) return null;
  const params=[]; let idx=1; const conds=[];
  if(parentCode){ conds.push(`(name_ko=$${idx++} AND COALESCE(cp_parent_code,'')=$${idx++})`); params.push(name,parentCode); }
  conds.push(`name_ko=$${idx++}`); params.push(name);
  const sql=`SELECT 'base' AS src, gm_code, cp_code, gm_parent_code, cp_parent_code, name_ko, parent_name_ko, COALESCE(depth::int,0) depth, leaf_yn, COALESCE(sort_order::int,0) sort_order
    FROM gm_category WHERE ${conds.join(' OR ')}
    ORDER BY CASE WHEN COALESCE(cp_parent_code,'')=$${idx} THEN 0 ELSE 1 END, depth DESC LIMIT 1`;
  params.push(parentCode);
  try{ const r=await pool.query(sql, params); return r.rows[0]||null; }catch(e){ try{ console.warn('[GM_CATEGORY_BASE_FIND_NAME_FAIL]', Object.assign({code,name,parentCode}, compactError(e))); }catch(_l){} return null; }
}

async function findCategoryRow(pool, code, name, parentCode){
  code=cleanText(code); name=cleanText(name); parentCode=cleanText(parentCode);

  // IMPORTANT: 상세에서 쿠팡 cp_code가 들어온 경우에는 이름 중복으로 대체하지 않는다.
  // 폭죽처럼 같은 name_ko가 여러 부모 아래 존재하므로, cp_code가 다르면 반드시 신규 카테고리로 본다.
  if(code){
    // 신규 생성 여부는 반드시 gm_category 본 테이블만 기준으로 판단한다.
    // gm_category_dynamic에 있다고 해서 본 테이블 INSERT를 막으면 안 된다.
    return await findBaseCategoryRow(pool, code, name, parentCode);
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

function normalizeGmCodeParts(code){
  let parts=cleanText(code).split('-');
  if(parts.length < 6) parts = (cleanText(code) || 'XX-00-000-0000-0000-0000').split('-');
  while(parts.length<6) parts.push(parts.length<3?'000':'0000');
  if(!parts[0]) parts[0]='XX';
  if(!/^\d+$/.test(parts[1]||'')) parts[1]='00';
  if(!/^\d+$/.test(parts[2]||'')) parts[2]='000';
  for(let i=3;i<6;i++) if(!/^\d+$/.test(parts[i]||'')) parts[i]='0000';
  return parts.slice(0,6);
}
function blockIndexForDepth(depth){
  const d=toInt(depth,1);
  if(d<=1) return 1;
  if(d===2) return 2;
  if(d===3) return 3;
  if(d===4) return 4;
  return 5;
}
function buildChildGmCode(parentGmCode, childDepth, seq){
  const depth=toInt(childDepth,1);
  let parts=normalizeGmCodeParts(parentGmCode || 'XA-00-000-0000-0000-0000');
  const idx=blockIndexForDepth(depth);
  const width=(idx===1?2:(idx===2?3:4));
  parts[idx]=String(seq).padStart(width,'0');
  for(let i=idx+1;i<6;i++) parts[i]='0'.repeat(parts[i].length || 4);
  return parts.join('-');
}
function makeRootGmCode(prefix){
  prefix=cleanText(prefix || '').toUpperCase();
  if(!/^[A-Z]{2}$/.test(prefix)) prefix='XA';
  return [prefix, '00', '000', '0000', '0000', '0000'].join('-');
}
function rootPrefixCandidates(){
  const out=[];
  for(const first of ['X','Y','Z']){
    for(let i=65;i<=90;i++) out.push(first + String.fromCharCode(i));
  }
  return out;
}
async function nextAvailableRootPrefix(pool){
  const candidates=rootPrefixCandidates();
  const used=new Set();
  try{
    const r=await pool.query(`SELECT DISTINCT UPPER(SPLIT_PART(gm_code,'-',1)) AS prefix
      FROM gm_category
      WHERE gm_code IS NOT NULL AND gm_code <> ''`);
    (r.rows||[]).forEach(x=>{ const p=cleanText(x.prefix).toUpperCase(); if(p) used.add(p); });
  }catch(_e){}
  for(const p of candidates){
    if(!used.has(p)) return p;
  }
  return '';
}
function extractGmCodeBlock(gmCode, depth){
  const parts=normalizeGmCodeParts(gmCode);
  const idx=blockIndexForDepth(depth);
  return toInt(parts[idx],0);
}
async function gmCodeExists(pool, gmCode){
  const code=cleanText(gmCode);
  if(!code) return false;
  try{
    const r=await pool.query(`SELECT 1 FROM gm_category WHERE gm_code=$1 LIMIT 1`, [code]);
    return !!(r.rows && r.rows.length);
  }catch(_e){ return false; }
}
async function nextGmChildSeq(pool, parentRow, childDepth){
  const parentGm=cleanText(parentRow && parentRow.gm_code);
  const parentCp=cleanText(parentRow && parentRow.cp_code);
  const depth=toInt(childDepth,1);
  try{
    let rows=[];
    if(parentGm || parentCp){
      const r=await pool.query(`SELECT gm_code FROM gm_category WHERE (COALESCE(gm_parent_code,'')=$1 OR COALESCE(cp_parent_code,'')=$2) AND COALESCE(depth::int,0)=$3`, [parentGm, parentCp, depth]);
      rows=r.rows||[];
    }else{
      const r=await pool.query(`SELECT gm_code FROM gm_category WHERE COALESCE(gm_parent_code,'')='' AND COALESCE(cp_parent_code,'')='' AND COALESCE(depth::int,0)<=1`);
      rows=r.rows||[];
    }
    let max=0;
    rows.forEach(x=>{ max=Math.max(max, extractGmCodeBlock(x.gm_code, depth)); });
    return max+1;
  }catch(_e){ return 1; }
}
async function nextCategorySortOrder(pool, parentRow, childDepth){
  const parentGm=cleanText(parentRow && parentRow.gm_code);
  const parentCp=cleanText(parentRow && parentRow.cp_code);
  const depth=toInt(childDepth,1);
  try{
    let r;
    if(parentGm || parentCp){
      r=await pool.query(`SELECT COALESCE(MAX(COALESCE(sort_order::int,0)),0)::int + 1 AS next_sort
        FROM gm_category
        WHERE (COALESCE(gm_parent_code,'')=$1 OR COALESCE(cp_parent_code,'')=$2)
          AND COALESCE(depth::int,0)=$3`, [parentGm, parentCp, depth]);
    }else{
      r=await pool.query(`SELECT COALESCE(MAX(COALESCE(sort_order::int,0)),0)::int + 1 AS next_sort
        FROM gm_category
        WHERE COALESCE(gm_parent_code,'')='' AND COALESCE(cp_parent_code,'')=''
          AND COALESCE(depth::int,0)<=1`);
    }
    return Number((r.rows && r.rows[0] && r.rows[0].next_sort) || 1) || 1;
  }catch(_e){ return 1; }
}

async function makeUniqueChildGmCode(pool, parentRow, childDepth){
  const hasParent=!!(parentRow && (cleanText(parentRow.gm_code) || cleanText(parentRow.cp_code)));
  const depth=toInt(childDepth,1);

  // New top-level categories must not keep piling up under XX.
  // Allocate one unused root prefix in order: XA, XB, XC ... ZZ.
  if(!hasParent && depth <= 1){
    const prefix=await nextAvailableRootPrefix(pool);
    if(!prefix) throw new Error('GM_CATEGORY_ROOT_PREFIX_EXHAUSTED_XA_TO_ZZ');
    const code=makeRootGmCode(prefix);
    if(!(await gmCodeExists(pool, code))) return { gm_code:code, seq:0, root_prefix:prefix };
    throw new Error('GM_CATEGORY_ROOT_PREFIX_CONFLICT_' + prefix);
  }

  let seq=await nextGmChildSeq(pool, parentRow, childDepth);
  const parentGm=cleanText(parentRow && parentRow.gm_code) || 'XA-00-000-0000-0000-0000';
  for(let guard=0; guard<10000; guard++){
    const code=buildChildGmCode(parentGm, childDepth, seq+guard);
    if(!(await gmCodeExists(pool, code))) return { gm_code:code, seq:seq+guard };
  }
  const code=buildChildGmCode(parentGm, childDepth, seq+10000);
  return { gm_code:code, seq:seq+10000 };
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
  if(cols.includes(col)) return; // 동일 컬럼 중복 지정 방지(name_ko 등)
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
    out.sort_order = explicit > 0 ? explicit : 0;
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
    if(l === 'ko') continue; // name_ko는 위에서 이미 1회 추가됨. 중복 INSERT 방지.
    pushCategoryValue(cols, vals, 'name_'+l, cleanText(tr[l]), columnMap);
  }
  pushCategoryValue(cols, vals, 'translate_complete', categoryTranslationComplete(tr) ? 'T' : 'F', columnMap);
  pushCategoryValue(cols, vals, 'keyword_seed', row.keyword || row.name_ko, columnMap);
  pushCategoryValue(cols, vals, 'keyword', row.keyword || row.name_ko, columnMap);
  pushCategoryValue(cols, vals, 'category_path', row.category_path || '', columnMap);
  pushCategoryValue(cols, vals, 'source_keyword', row.source_keyword || '', columnMap);
  pushCategoryValue(cols, vals, 'source', row.source || 'detail_auto', columnMap);
  pushCategoryValue(cols, vals, 'active_yn', 'Y', columnMap);
  // GM_CATEGORY_RAW_JSON_DROP_V055: 운영 DB 용량 절감. 디버깅용 raw_json 저장 중단.
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
    if(exists){
      try{ await updateExistingCategoryTranslations(pool, row, exists); }catch(_e){}
      return exists;
    }
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

async function updateExistingCategoryTranslations(pool, row, existing){
  const columnMap = await getGmCategoryColumns(pool);
  const cp=cleanText(row && row.cp_code);
  if(!cp) return { updated:0 };
  const ko=cleanText(row && row.name_ko);
  const tr=row.translations || translationFallback(ko);
  const sets=[]; const vals=[]; let idx=1;
  for(const l of CATEGORY_LANGS){
    if(l === 'ko') continue;
    const col='name_'+l;
    const v=cleanText(tr[l]);
    if(!v || v === ko || !columnMap.has(col)) continue;
    sets.push(`${col}=CASE WHEN ${col} IS NULL OR ${col}::text='' OR ${col}::text=$${idx+1} THEN $${idx} ELSE ${col} END`);
    vals.push(v, ko); idx += 2;
  }
  if(columnMap.has('translate_complete')){
    sets.push(`translate_complete=CASE WHEN ${categoryTranslationComplete(tr) ? "'T'" : "'F'"}='T' THEN 'T' ELSE COALESCE(translate_complete,'F') END`);
  }
  if(!sets.length) return { updated:0 };
  if(columnMap.has('updated_at')) sets.push(`updated_at=now()`);
  vals.push(cp);
  const r=await pool.query(`UPDATE gm_category SET ${sets.join(', ')} WHERE cp_code::text=$${idx}`, vals);
  return { updated:r.rowCount||0 };
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
  // GM_CATEGORY_PATH_CREATE_V051
  // Rule fixed by 운영 기준:
  // 1) Existing gm_category match is ONLY by Coupang cp_code. Never attach by name/search-word inference.
  // 2) If any node in the received Coupang path already exists in gm_category, skip unmatched ancestors and continue under the first matched node.
  // 3) If no cp_code in the path exists in gm_category, create the whole path under XX temporary tree.
  // Service badges such as 로켓프레시 are removed before this decision.
  meta=meta||{}; p=p||{};
  await ensureDynamicCategoryTable(pool);
  let tree=sanitizeCoupangCategoryTree(parseCategoryTreeFromPayload(p));
  try{ console.log('[GM_CATEGORY_TREE_RECEIVE]', { version:'V055', rule:'cp_code_only_else_xa_to_zz', tree_count:tree.length, leaf:cleanText(p.cp_fix_code || p.cpFixCode || ''), keyword:cleanText(meta.keyword || p.keyword || ''), sample:tree.slice(0,10).map(x=>({depth:x.depth, cp_code:x.cp_code, name_ko:x.name_ko})) }); }catch(_l){}
  if(!tree.length) return { applied:false, reason:'no_category_tree' };

  const created=[]; const matched=[]; const errors=[];
  const mallCode=cleanText(meta.mall_code || p.mall_code || p.mallCode || 'CPKR').toUpperCase();
  const sourceKeyword=cleanText(meta.keyword || p.keyword || '');

  // First pass: decide whether this Coupang path belongs under an existing gm_category node.
  // This pass uses cp_code only. Name match is intentionally forbidden here.
  const existingByIndex = new Map();
  let firstMatchedIndex = -1;
  let firstMatchedRow = null;
  for(let i=0;i<tree.length;i++){
    const cp=cleanText(tree[i] && tree[i].cp_code);
    if(!cp) continue;
    const r=await findBaseCategoryRow(pool, cp, '', '');
    if(r){
      existingByIndex.set(i, r);
      if(firstMatchedIndex < 0){ firstMatchedIndex=i; firstMatchedRow=r; }
    }
  }

  let parent=null;
  let startIndex=0;
  if(firstMatchedIndex >= 0){
    // A known Coupang code exists. Do not create unknown ancestors above it under XX or OS.
    // Continue only from the matched point downward.
    for(let i=0;i<firstMatchedIndex;i++){
      const n=tree[i] || {};
      matched.push({ name:n.name_ko, cp_code:cleanText(n.cp_code), source:'skipped_unmatched_ancestor_before_cp_match', depth:n.depth });
    }
    parent=firstMatchedRow;
    const n=tree[firstMatchedIndex] || {};
    matched.push({ name:n.name_ko, cp_code:firstMatchedRow.cp_code, source:'base_first_match', parent:firstMatchedRow.cp_parent_code || '', gm_code:firstMatchedRow.gm_code || '', depth:firstMatchedRow.depth || n.depth });
    startIndex=firstMatchedIndex+1;
  }

  try{ console.log('[GM_CATEGORY_PATH_DECISION]', { version:'V055', mode:firstMatchedIndex>=0?'attach_under_existing_cp':'create_full_xa_to_zz_path', firstMatchedIndex, firstMatched:firstMatchedRow?{cp_code:firstMatchedRow.cp_code, name_ko:firstMatchedRow.name_ko, gm_code:firstMatchedRow.gm_code, depth:firstMatchedRow.depth}:null, skipped_ancestors:firstMatchedIndex>0?tree.slice(0,firstMatchedIndex).map(x=>({cp_code:x.cp_code,name_ko:x.name_ko,depth:x.depth})):[] }); }catch(_l){}

  for(let i=startIndex;i<tree.length;i++){
    const priorMatched = existingByIndex.get(i);
    const node=Object.assign({}, tree[i], { depth: parent ? (toInt(parent.depth,0)+1) : (i+1) });
    const parentCode=cleanText(parent && parent.cp_code || '');
    let row=null;
    if(priorMatched) row=priorMatched;
    else if(node.cp_code) row=await findBaseCategoryRow(pool, node.cp_code, '', '');
    if(row){
      matched.push({ name:node.name_ko, cp_code:row.cp_code, source:'base', parent:row.cp_parent_code || '', gm_code:row.gm_code || '', depth:row.depth || node.depth });
      parent=row;
      continue;
    }

    if(!node.cp_code){
      // cp_code 없는 breadcrumb는 생성하지 않고 부모 후보로도 쓰지 않는다.
      matched.push({ name:node.name_ko, cp_code:'', source:'name_only_no_code', depth:node.depth });
      continue;
    }

    const parentGm=cleanText(parent && parent.gm_code || '');
    const parentCp=cleanText(parent && parent.cp_code || '');
    const parentName=cleanText(parent && parent.name_ko || '');
    const made=await makeUniqueChildGmCode(pool, parent, node.depth);
    const gmCode=made.gm_code;
    const seq=made.seq;
    const sortOrder=await nextCategorySortOrder(pool, parent, node.depth);
    const path=tree.slice(0, i+1).map(x=>x.name_ko).filter(Boolean).join(' > ');
    const isLeaf = (i === tree.length-1) ? 'Y' : 'N';
    try{
      const tr = await findNameTranslations(pool, node.name_ko);
      const keywordText = translationKeywordString(tr) || node.name_ko;
      try{ console.log('[GM_CATEGORY_INSERT_START]', { version:'V055', cp_code:node.cp_code, name_ko:node.name_ko, parent_cp_code:parentCp, parent_gm_code:parentGm, depth:node.depth, gm_code:gmCode, seq, sort_order:sortOrder, path }); }catch(_l){}
      if(parentCp){
        try{ await pool.query(`UPDATE gm_category SET leaf_yn='N', updated_at=now() WHERE cp_code::text=$1`, [parentCp]); }catch(_e){}
      }
      const inserted = await insertGmCategoryRow(pool, {
        gm_code: gmCode,
        cp_code: node.cp_code,
        gm_parent_code: parentGm,
        cp_parent_code: parentCp,
        cp_id: '',
        parent_name_ko: parentName,
        depth: node.depth,
        leaf_yn: isLeaf,
        display_yn: 'Y',
        sort_order: sortOrder,
        name_ko: node.name_ko,
        keyword: keywordText,
        category_path: path,
        source_keyword: sourceKeyword,
        source: 'detail_auto',
        raw_json: {},
        translations: tr
      });
      row={
        src:'base', gm_code:cleanText(inserted && inserted.gm_code || gmCode), cp_code:cleanText(inserted && inserted.cp_code || node.cp_code),
        gm_parent_code:cleanText(inserted && inserted.gm_parent_code || parentGm), cp_parent_code:cleanText(inserted && inserted.cp_parent_code || parentCp),
        name_ko:cleanText(inserted && inserted.name_ko || node.name_ko), parent_name_ko:cleanText(inserted && inserted.parent_name_ko || parentName),
        depth:toInt(inserted && inserted.depth, node.depth), leaf_yn:cleanText(inserted && inserted.leaf_yn || isLeaf), sort_order:toInt(inserted && inserted.sort_order, seq)
      };
      created.push({ table:'gm_category', name:node.name_ko, cp_code:node.cp_code, parent_cp_code:parentCp, gm_code:row.gm_code, path });
      try{ console.log('[GM_CATEGORY_INSERT_OK]', { version:'V055', cp_code:node.cp_code, name_ko:node.name_ko, parent_cp_code:parentCp, gm_code:row.gm_code, table:'gm_category' }); }catch(_l){}
      parent=row;
    }catch(e){
      const err=Object.assign({ cp_code:node.cp_code, name_ko:node.name_ko, parent_cp_code:parentCp, parent_gm_code:parentGm, depth:node.depth, gm_code:gmCode, path }, compactError(e), e && e.gm_category_insert_context ? { insert_context:e.gm_category_insert_context } : {});
      errors.push(err);
      created.push({ table:'gm_category', name:node.name_ko, cp_code:node.cp_code, parent_cp_code:parentCp, gm_code:gmCode, error:err });
      try{ console.warn('[GM_CATEGORY_INSERT_FAIL]', err); }catch(_l){}
      // Continue with synthetic parent so descendants keep the path.
      parent={ src:'synthetic_failed', gm_code:gmCode, cp_code:node.cp_code, gm_parent_code:parentGm, cp_parent_code:parentCp, name_ko:node.name_ko, parent_name_ko:parentName, depth:node.depth, leaf_yn:isLeaf, sort_order:seq };
    }
  }
  try{ console.log('[GM_CATEGORY_DYNAMIC_RESULT]', { version:'V055', table:'gm_category', created_count:created.filter(x=>!x.error).length, matched_count:matched.length, error_count:errors.length, created, matched:matched.slice(-12), errors }); }catch(_l){}
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
        WHEN $1 = ANY(regexp_split_to_array(COALESCE(name_ko,''), '\\s*/\\s*')) THEN 'SLASH_EXACT'
        WHEN keyword=$1 OR keyword_seed=$1 THEN 'KEYWORD'
        WHEN $1 = ANY(regexp_split_to_array(COALESCE(keyword,'') || ',' || COALESCE(keyword_seed,''), '\\s*,\\s*')) THEN 'KEYWORD_LIST'
        WHEN position($1 in COALESCE(name_ko,'')) > 0 THEN 'PARTIAL'
        ELSE 'OTHER' END AS match_type
      FROM allcat
      WHERE COALESCE(cp_code,'')<>'' AND (
        name_ko=$1
        OR $1 = ANY(regexp_split_to_array(COALESCE(name_ko,''), '\\s*/\\s*'))
        OR keyword=$1 OR keyword_seed=$1
        OR $1 = ANY(regexp_split_to_array(COALESCE(keyword,'') || ',' || COALESCE(keyword_seed,''), '\\s*,\\s*'))
        OR position($1 in COALESCE(name_ko,'')) > 0
      )
      ORDER BY CASE WHEN name_ko=$1 THEN 0 WHEN $1 = ANY(regexp_split_to_array(COALESCE(name_ko,''), '\\s*/\\s*')) THEN 0 WHEN keyword=$1 OR keyword_seed=$1 THEN 1 WHEN position($1 in COALESCE(name_ko,'')) > 0 THEN 3 ELSE 8 END,
               depth DESC, CASE WHEN leaf_yn='Y' THEN 0 ELSE 1 END, search_count DESC, cp_code
      LIMIT 50`, [kw]);
    return r.rows || [];
  }catch(e){ try{ console.warn('[GM_CATEGORY_CANDIDATE_FAIL]', Object.assign({keyword:kw}, compactError(e))); }catch(_l){} return []; }
}
async function findCpSelectedCodeForKeyword(pool, keyword){
  // GM_CP_SELECTED_AMBIGUOUS_SAFE_V054
  // 검색 queue 단계에서는 동명이인 카테고리를 확정하지 않는다.
  // 예: "폭죽"처럼 여러 부모 아래 같은 name_ko가 있으면 상세 CATEGORY_TREE에서만 확정한다.
  const kw = cleanText(keyword);
  if(!kw) return '';
  const cand=await findCategoryCandidatesForKeyword(pool, kw);
  const exact=cand.filter(r=>isSlashExactNameMatch(r.name_ko, kw) || cleanText(r.keyword)===kw || cleanText(r.keyword_seed)===kw || cleanText(r.match_type)==='SLASH_EXACT');
  let code='';
  let selected=null;
  if(exact.length === 1){
    selected=exact[0];
    code=cleanText(selected.cp_code);
  }
  try{ console.log('[GM_CP_SELECTED_MATCH]', { keyword:kw, candidate_count:cand.length, exact_count:exact.length, cp_selected_code:code, selected:selected&&{cp_code:selected.cp_code,name_ko:selected.name_ko,parent_name_ko:selected.parent_name_ko,cp_parent_code:selected.cp_parent_code,depth:selected.depth,match_type:selected.match_type}, candidates:cand.slice(0,8).map(r=>({cp_code:r.cp_code,name_ko:r.name_ko,parent_name_ko:r.parent_name_ko,cp_parent_code:r.cp_parent_code,depth:r.depth,match_type:r.match_type})) }); }catch(_l){}
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
    if(isSlashExactNameMatch(r.name_ko, kw)) score += 80;
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
function decideCpMatch(p, mallCode, cpFixCode, cpSelectedCode){
  const explicit = normalizeCpMatch(p.cp_match || p.cpMatch || '');
  if(explicit) return explicit;
  const fix=cleanText(cpFixCode);
  if(!fix) return 'F';
  const mall = cleanText(mallCode).toUpperCase();
  // GM_CP_MATCH_DETAIL_FIX_V054
  // cp_fix_code는 상세 CATEGORY_INFO leaf에서 직접 확인한 값이므로 CPKR 상세 수집에서는 T로 본다.
  // cp_selected_code와 다르더라도 검색어 후보가 틀린 것이고, 상세 leaf 자체는 직접 검증값이다.
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
        SET cp_selected_code=COALESCE(NULLIF($4,''), cp_selected_code, $2), cp_fix_code=$2, cp_match='T', updated_at=now()
        WHERE product_uid=$1
          AND NOT (COALESCE(cp_match,'')='T' AND COALESCE(cp_fix_code,'')<>'' AND COALESCE(cp_fix_code,'')<>$2)
          AND (COALESCE(cp_selected_code,'')<>COALESCE(NULLIF($4,''), cp_selected_code, $2) OR COALESCE(cp_fix_code,'')<>$2 OR COALESCE(cp_match,'')<>'T')
      `, [productUid, fix, keyword, selected]);
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
        SET cp_selected_code=COALESCE(NULLIF($4,''), cp_selected_code, $1), cp_fix_code=$2, cp_match='F', updated_at=now()
        WHERE product_uid<>$3
          AND COALESCE(cp_match,'')<>'T'
          AND (
            ($1<>'' AND keyword=$1)
            OR ($1<>'' AND cp_selected_code=$1)
            OR ($4<>'' AND cp_selected_code=$4)
          )
          AND (COALESCE(cp_selected_code,'')<>COALESCE(NULLIF($4,''), cp_selected_code, $1) OR COALESCE(cp_fix_code,'')<>$2 OR COALESCE(cp_match,'')<>'F')
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
