'use strict';
// GM_PRODUCT_KEYWORD_KO_NORMALIZER_V001
// Builder-only cleanup for legacy multilingual product keywords.
// Search logs are read-only. Only gm_product.keyword/category_keyword are updated.

const S=v=>String(v==null?'':v).normalize('NFKC').trim();
const N=v=>S(v).toLowerCase().replace(/\s+/g,' ');
const hasKo=v=>/[가-힣]/.test(S(v));
const isTableMissing=e=>/does not exist|undefined_table/i.test(String(e&&e.message||e));

const SOURCE_RANK={gm_keyword_translate:1,gm_search_log:2,gm_category_name:3};
function put(map,src,target,source){
  src=S(src); target=S(target);
  if(!src||!target||N(src)===N(target))return;
  const key=N(src); if(!key)return;
  const rank=SOURCE_RANK[source]||99;
  if(!map.has(key))map.set(key,{rank,targets:new Map()});
  const box=map.get(key);
  if(rank>box.rank)return;
  if(rank<box.rank){box.rank=rank;box.targets=new Map();}
  const tk=N(target);
  if(!box.targets.has(tk))box.targets.set(tk,{target,sources:new Set()});
  box.targets.get(tk).sources.add(source);
}
function finalize(map){
  const out=new Map(),ambiguous=[];
  for(const [key,box] of map){
    const vals=[...box.targets.values()];
    if(vals.length===1){
      const x=vals[0];
      // Product search keyword must become Korean. Acronyms already used as Korean category names stay untouched.
      if(hasKo(x.target))out.set(key,{target:x.target,source:[...x.sources].sort().join('+')});
    }else if(vals.length>1){
      ambiguous.push({source:key,targets:vals.map(x=>x.target)});
    }
  }
  return {map:out,ambiguous};
}

async function tableExists(db,name){
  try{const r=await db.query('SELECT to_regclass($1) AS t',[`public.${name}`]);return !!(r.rows[0]&&r.rows[0].t);}catch(_){return false;}
}
async function loadProductRows(db){
  const r=await db.query(`SELECT product_uid,keyword,category_keyword FROM gm_product WHERE COALESCE(keyword,'')<>'' OR COALESCE(category_keyword,'')<>'' ORDER BY product_uid`);
  return r.rows||[];
}
function wantedTerms(rows){
  const set=new Set();
  for(const r of rows){for(const v of [r.keyword,r.category_keyword]){const s=S(v);if(s&&!hasKo(s))set.add(N(s));}}
  return set;
}

async function addKeywordTranslate(db,wanted,candidates){
  if(!wanted.size||!(await tableExists(db,'gm_keyword_translate')))return 0;
  let rows=[];
  try{
    const r=await db.query(`SELECT input_keyword,main_keyword_ko,keyword_ko,keyword_en,keyword_zh,keyword_vi,keyword_ja,keyword_tw,keyword_th,keyword_uz,keyword_ne,keyword_km,keyword_id,keyword_tl,keyword_mn,keyword_my,keyword_kk,keyword_si,keyword_ru,keyword_bn,keyword_ur,keyword_lo,keyword_hi,keyword_tr,keyword_fa,keyword_es,keyword_fr FROM gm_keyword_translate`);
    rows=r.rows||[];
  }catch(e){if(!isTableMissing(e))throw e;return 0;}
  let n=0;
  for(const r of rows){
    const target=S(r.main_keyword_ko||r.keyword_ko); if(!target||!hasKo(target))continue;
    for(const [k,v] of Object.entries(r)){
      if(!/^keyword_|^input_keyword$/.test(k))continue;
      const src=S(v); if(!src||!wanted.has(N(src)))continue;
      put(candidates,src,target,'gm_keyword_translate'); n++;
    }
  }
  return n;
}
async function addSearchLog(db,wanted,candidates){
  if(!wanted.size||!(await tableExists(db,'gm_search_log')))return 0;
  const arr=[...wanted]; let rows=[];
  try{
    const r=await db.query(`SELECT keyword_original,keyword_normalized,keyword_canonical,COUNT(*)::int AS cnt
      FROM gm_search_log
      WHERE COALESCE(keyword_canonical,'')<>''
        AND (LOWER(BTRIM(COALESCE(keyword_original,'')))=ANY($1::text[]) OR LOWER(BTRIM(COALESCE(keyword_normalized,'')))=ANY($1::text[]))
      GROUP BY keyword_original,keyword_normalized,keyword_canonical`,[arr]);
    rows=r.rows||[];
  }catch(e){if(!isTableMissing(e))throw e;return 0;}
  let n=0;
  for(const r of rows){const target=S(r.keyword_canonical);if(!hasKo(target))continue;for(const src of [r.keyword_original,r.keyword_normalized]){if(src&&wanted.has(N(src))){put(candidates,src,target,'gm_search_log');n++;}}}
  return n;
}
async function addCategoryTranslations(db,wanted,candidates){
  if(!wanted.size||!(await tableExists(db,'gm_category')))return 0;
  const cr=await db.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='gm_category' AND column_name LIKE 'name_%' ORDER BY ordinal_position`);
  const cols=(cr.rows||[]).map(x=>S(x.column_name)).filter(x=>/^name_[a-z]{2,3}$/i.test(x)&&x!=='name_ko');
  if(!cols.length)return 0;
  const quoted=cols.map(c=>'"'+c.replace(/"/g,'""')+'"').join(',');
  const r=await db.query(`SELECT name_ko,${quoted} FROM gm_category WHERE COALESCE(name_ko,'')<>''`);
  let n=0;
  for(const row of (r.rows||[])){
    const target=S(row.name_ko);if(!hasKo(target))continue;
    for(const c of cols){const src=S(row[c]);if(src&&wanted.has(N(src))){put(candidates,src,target,'gm_category_name');n++;}}
  }
  return n;
}

async function buildMap(db,rows){
  const wanted=wantedTerms(rows), candidates=new Map();
  const sources={keyword_translate:await addKeywordTranslate(db,wanted,candidates),search_log:0,category_names:0};
  sources.search_log=await addSearchLog(db,wanted,candidates);
  sources.category_names=await addCategoryTranslations(db,wanted,candidates);
  const fin=finalize(candidates);
  return {wanted,map:fin.map,ambiguous:fin.ambiguous,sources};
}

async function normalizeProductKeywords(db,{apply=true}={}){
  const rows=await loadProductRows(db); const built=await buildMap(db,rows);
  const changes=[]; const sourceCount={}; let fieldChanges=0;
  for(const r of rows){
    let kw=S(r.keyword),ck=S(r.category_keyword),newKw=kw,newCk=ck,kwSource='',ckSource='';
    if(kw&&!hasKo(kw)){const m=built.map.get(N(kw));if(m){newKw=m.target;kwSource=m.source;}}
    if(ck&&!hasKo(ck)){const m=built.map.get(N(ck));if(m){newCk=m.target;ckSource=m.source;}}
    if(newKw!==kw||newCk!==ck){
      changes.push({product_uid:S(r.product_uid),keyword_before:kw,keyword_after:newKw,category_keyword_before:ck,category_keyword_after:newCk,keyword_source:kwSource,category_keyword_source:ckSource});
      if(newKw!==kw){fieldChanges++;sourceCount[kwSource]=(sourceCount[kwSource]||0)+1;}
      if(newCk!==ck){fieldChanges++;sourceCount[ckSource]=(sourceCount[ckSource]||0)+1;}
    }
  }
  let updated=0;
  if(apply&&changes.length){
    const B=400;
    for(let i=0;i<changes.length;i+=B){
      const batch=changes.slice(i,i+B),vals=[],sqlRows=[];let p=1;
      for(const x of batch){sqlRows.push(`($${p++}::text,$${p++}::text,$${p++}::text)`);vals.push(x.product_uid,x.keyword_after,x.category_keyword_after);}
      const q=await db.query(`UPDATE gm_product p SET keyword=v.keyword,category_keyword=v.category_keyword,updated_at=now() FROM (VALUES ${sqlRows.join(',')}) AS v(product_uid,keyword,category_keyword) WHERE p.product_uid=v.product_uid AND (COALESCE(p.keyword,'')<>COALESCE(v.keyword,'') OR COALESCE(p.category_keyword,'')<>COALESCE(v.category_keyword,''))`,vals);
      updated+=q.rowCount||0;
    }
  }
  const unresolved=new Set();
  for(const r of rows){for(const v of [r.keyword,r.category_keyword]){const s=S(v);if(s&&!hasKo(s)&&!built.map.has(N(s)))unresolved.add(s);}}
  const examples=changes.slice(0,30);
  console.log('[GM_PRODUCT_KEYWORD_KO_NORMALIZER_V001]',JSON.stringify({apply,products:rows.length,wanted_terms:built.wanted.size,mapped_terms:built.map.size,changed_products:changes.length,field_changes:fieldChanges,updated,unresolved_terms:unresolved.size,ambiguous_terms:built.ambiguous.length,sources:built.sources}));
  return {apply,products_scanned:rows.length,wanted_terms:built.wanted.size,mapped_terms:built.map.size,changed_products:changes.length,field_changes:fieldChanges,updated_products:updated,unresolved_terms:unresolved.size,unresolved_samples:[...unresolved].slice(0,30),ambiguous_terms:built.ambiguous.length,ambiguous_samples:built.ambiguous.slice(0,20),source_hits:built.sources,source_changes:sourceCount,examples};
}
module.exports={normalizeProductKeywords};
