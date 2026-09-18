'use strict';

/* GM_CATEGORY_MENU_V001_GLOMART_CODE_TREE
 * Read-only Glomart hamburger category API.
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
  return s;
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
      // A root may legitimately own both five- and six-segment direct-child families.
      // Below root, remain inside the selected parent's segment family so a branch
      // never crosses into another code family that shares the same visible prefix.
      if(pd>0){
        const family=parts.length;
        rows=rows.filter(r=>C(r.gm_code).split('-').length===family);
      }
    }else{
      const q=await pool.query(baseSelect+` AND depth=0 ORDER BY COALESCE(sort_order,2147483647),category_id`);
      rows=q.rows||[];
    }
    const items=rows.map(r=>({
      gm_code:C(r.gm_code).toUpperCase(),
      depth:Number(r.depth||0),
      leaf_yn:C(r.leaf_yn).toUpperCase(),
      has_children:C(r.leaf_yn).toUpperCase()!=='Y',
      sort_order:Number(r.sort_order||0),
      name_ko:C(r.name_ko),
      name:C(r.display_name)||C(r.name_ko),
      keyword:C(r.keyword),
      translate_required:translateRequired
    }));
    return res.json({ok:true,parent_code:parent,depth,lang:rawLang,translate_required:translateRequired,count:items.length,items});
  }catch(e){
    console.error('[GM_CATEGORY_MENU_V001]',String(e&&e.stack||e));
    return res.status(500).json({ok:false,error:C(e&&e.message||e)});
  }
});

module.exports=router;
