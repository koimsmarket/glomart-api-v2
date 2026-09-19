'use strict';

/* GM_CATEGORY_MENU_V028_LANG_SELF_HEAL
 * Glomart hamburger category API with on-demand language self-heal.
 * - Never uses Cafe24 category_no/category parent relationships.
 * - Never uses gm_parent_code.
 * - Direct children are selected by gm_code segment prefix + depth.
 * - Returns only the requested gm_lang display column plus Korean/search metadata.
 */
const express=require('express');
const router=express.Router();

const LANG_COLUMN={
  kr:'name_ko',ko:'name_ko',en:'name_en',zh:'name_zh',vi:'name_vi',ja:'name_ja',tw:'name_tw',
  th:'name_th',uz:'name_uz',ne:'name_ne',km:'name_km',id:'name_id',tl:'name_tl',mn:'name_mn',
  my:'name_my',kk:'name_kk',si:'name_si',ru:'name_ru',bn:'name_bn',ur:'name_ur',lo:'name_lo',
  hi:'name_hi',tr:'name_tr',fa:'name_fa',es:'name_es',fr:'name_fr'
};
const CODE_RE=/^[A-Z0-9]{2}-\d{2}-\d{3}-\d{4}-\d{4}(?:-\d{4})?$/i;
function C(v){return String(v==null?'':v).trim();}
function normLang(v){
  let s=C(v).toLowerCase().replace('_','-');
  if(s==='jp')s='ja'; else if(s==='cn')s='zh'; else if(s==='vn')s='vi'; else if(s==='zh-tw')s='tw';
  if(!LANG_COLUMN[s] && s.includes('-')){
    const base=s.split('-')[0];
    if(LANG_COLUMN[base]) s=base;
  }
  return s;
}
const TRANSLATE_TARGET={tw:'zh-TW'};
const FALLBACK_CACHE=new Map();
function safeTargetLang(lang){
  const s=C(lang).toLowerCase();
  return /^[a-z]{2,3}(?:-[a-z]{2,4})?$/.test(s)?s:'';
}
async function translateKo(text,lang){
  text=C(text); lang=C(lang).toLowerCase();
  if(!text||!lang||lang==='ko'||lang==='kr') return text;
  const target=TRANSLATE_TARGET[lang]||safeTargetLang(lang);
  if(!target) return '';
  const key=target+'\u0000'+text;
  if(FALLBACK_CACHE.has(key)) return FALLBACK_CACHE.get(key);
  let lastErr=null;
  for(let attempt=1;attempt<=3;attempt++){
    const ctrl=new AbortController();
    const timer=setTimeout(()=>ctrl.abort(),8000);
    try{
      const url='https://translate.googleapis.com/translate_a/single?client=gtx&sl=ko&tl='+encodeURIComponent(target)+'&dt=t&q='+encodeURIComponent(text);
      const r=await fetch(url,{headers:{accept:'application/json'},signal:ctrl.signal});
      if(!r.ok) throw new Error('translate_http_'+r.status);
      const j=await r.json();
      let out='';
      if(j&&Array.isArray(j[0])) for(const row of j[0]) if(row&&row[0]) out+=row[0];
      out=C(out);
      if(!out) throw new Error('translate_empty');
      if(FALLBACK_CACHE.size>2000) FALLBACK_CACHE.clear();
      FALLBACK_CACHE.set(key,out);
      return out;
    }catch(e){
      lastErr=e;
      if(attempt<3) await new Promise(r=>setTimeout(r,160*attempt));
    }finally{ clearTimeout(timer); }
  }
  try{console.warn('[GM_CATEGORY_MENU_TRANSLATE_FAIL]',{name_ko:text,lang,error:String(lastErr&&lastErr.message||lastErr)});}catch(_e){}
  return '';
}
async function healDisplayNames(pool,rows,rawLang,col){
  if(!rows||!rows.length) return rows||[];
  const supported=!!LANG_COLUMN[rawLang];
  if(rawLang==='ko'||rawLang==='kr') return rows;
  const pending=[];
  for(const row of rows){
    if(supported && C(row.display_name)) continue;
    pending.push(row);
  }
  const batch=6;
  for(let i=0;i<pending.length;i+=batch){
    const part=pending.slice(i,i+batch);
    await Promise.all(part.map(async row=>{
      const tr=await translateKo(row.name_ko,rawLang);
      if(!tr) return;
      row.display_name=tr;
      if(supported && col!=='name_ko'){
        try{
          await pool.query(`UPDATE gm_category SET ${col}=$1, updated_at=now() WHERE gm_code=$2 AND (NULLIF(BTRIM(${col}),'') IS NULL)`,[tr,C(row.gm_code).toUpperCase()]);
          try{console.log('[GM_CATEGORY_MENU_LANG_HEALED]',{gm_code:C(row.gm_code).toUpperCase(),name_ko:C(row.name_ko),lang:rawLang});}catch(_l){}
        }catch(e){
          try{console.warn('[GM_CATEGORY_MENU_LANG_HEAL_DB_FAIL]',{gm_code:C(row.gm_code).toUpperCase(),lang:rawLang,error:String(e&&e.message||e)});}catch(_l){}
        }
      }
    }));
  }
  return rows;
}

function depthFromCode(code){
  const a=C(code).toUpperCase().split('-');
  if(a.length!==5&&a.length!==6)return -1;
  let d=0;
  for(let i=1;i<a.length;i++){
    if(!/^0+$/.test(a[i]))d=i;
  }
  return d;
}
function stemForDepth(code,depth){
  const a=C(code).toUpperCase().split('-');
  return a.slice(0,Math.max(1,depth+1)).join('-');
}

router.get('/api/gm/category/menu',async(req,res)=>{
  const pool=req.app.locals.pool;
  if(!pool)return res.status(503).json({ok:false,error:'db unavailable'});
  const parent=C(req.query&&req.query.parent_code).toUpperCase();
  const rawLang=normLang(req.query&&req.query.lang)||'ko';
  const col=LANG_COLUMN[rawLang]||'name_ko';
  const translateRequired=!LANG_COLUMN[rawLang];
  try{
    let depth=0,rows=[];
    const baseSelect=`SELECT gm_code,depth,leaf_yn,display_yn,sort_order,name_ko,${col} AS display_name,
                             COALESCE(NULLIF(BTRIM(keyword),''),NULLIF(BTRIM(keyword_seed),''),name_ko) AS keyword
                        FROM gm_category
                       WHERE COALESCE(display_yn,'Y')='Y'`;
    if(parent){
      if(!CODE_RE.test(parent))return res.status(400).json({ok:false,error:'invalid parent_code'});
      const pd=depthFromCode(parent),parts=parent.split('-');
      if(pd<0||pd>=parts.length-1)return res.json({ok:true,parent_code:parent,depth:pd+1,lang:rawLang,translate_required:translateRequired,items:[]});
      depth=pd+1;
      const stem=stemForDepth(parent,pd);
      const q=await pool.query(baseSelect+` AND depth=$1 AND gm_code LIKE $2 ORDER BY COALESCE(sort_order,2147483647),category_id`,[depth,stem+'-%']);
      rows=q.rows||[];
      // V019: the published Glomart shopping tree is the five-segment family.
      // Six-segment rows are dynamic/detail-auto branches and must never be mixed into
      // the user-facing hamburger tree. Root itself is six-segment, its published children are five-segment.
      rows=rows.filter(r=>C(r.gm_code).split('-').length===5);
    }else{
      const q=await pool.query(baseSelect+` AND depth=0 ORDER BY COALESCE(sort_order,2147483647),category_id`);
      rows=q.rows||[];
    }
    rows=await healDisplayNames(pool,rows,rawLang,col);
    const items=rows.map(r=>({
      gm_code:C(r.gm_code).toUpperCase(),
      depth:Number(r.depth||0),
      leaf_yn:C(r.leaf_yn).toUpperCase(),
      has_children:C(r.leaf_yn).toUpperCase()!=='Y',
      sort_order:Number(r.sort_order||0),
      name_ko:C(r.name_ko),
      name:C(r.display_name)||C(r.name_ko),
      keyword:C(r.keyword)||C(r.name_ko),
      translate_required:translateRequired || (rawLang!=='ko' && rawLang!=='kr' && !C(r.display_name))
    }));
    return res.json({ok:true,parent_code:parent,depth,lang:rawLang,translate_required:translateRequired,count:items.length,items});
  }catch(e){
    console.error('[GM_CATEGORY_MENU_V028]',String(e&&e.stack||e));
    return res.status(500).json({ok:false,error:C(e&&e.message||e)});
  }
});

module.exports=router;
