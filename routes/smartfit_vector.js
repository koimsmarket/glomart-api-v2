/* GM_SMARTFIT_VECTOR_ROUTE_V001
 * SmartFit representative-image vector API.
 *
 * Product image-vector API is intentionally NOT included here.
 * Tables stay minimal:
 *   gm_smartfit_template_vector(template_id, vector_image)
 *   gm_smartfit_space_vector(space_id, vector_image)
 *
 * Template is the current image-search target.
 * Space uses the same storage/API contract so it can become searchable later.
 */
const express=require('express');
const router=express.Router();

function C(v){return String(v==null?'':v).trim();}
function vec(v){
 if(!Array.isArray(v))return null;
 const a=v.map(Number).filter(Number.isFinite);
 return a.length>=16&&a.length<=2048?a:null;
}
function cosine(a,b){
 if(!a||!b||a.length!==b.length)return -1;
 let ab=0,aa=0,bb=0;
 for(let i=0;i<a.length;i++){ab+=a[i]*b[i];aa+=a[i]*a[i];bb+=b[i]*b[i];}
 return aa&&bb?ab/Math.sqrt(aa*bb):-1;
}
function targetOf(raw){
 const type=C(raw).toLowerCase();
 if(type==='template')return {type:'template',table:'gm_smartfit_template_vector',idcol:'template_id'};
 if(type==='space')return {type:'space',table:'gm_smartfit_space_vector',idcol:'space_id'};
 return null;
}
function idOf(v){
 const n=Number(v);
 return Number.isInteger(n)&&n>0?n:0;
}

router.post('/api/gm/smartfit-vector/missing',async(req,res)=>{
 const pool=req.app.locals.pool;
 const target=targetOf(req.body&&req.body.resource_type);
 const raw=Array.isArray(req.body&&req.body.resource_ids)?req.body.resource_ids:[];
 const ids=[...new Set(raw.map(idOf).filter(Boolean))].slice(0,200);
 if(!pool)return res.status(503).json({ok:false,error:'db unavailable'});
 if(!target)return res.status(400).json({ok:false,error:'resource_type required'});
 if(!ids.length)return res.json({ok:true,resource_type:target.type,existing:[],missing:[]});
 try{
  const q=await pool.query(
   `SELECT ${target.idcol} AS resource_id FROM ${target.table} WHERE ${target.idcol}=ANY($1::bigint[])`,
   [ids]
  );
  const have=new Set(q.rows.map(r=>Number(r.resource_id)));
  return res.json({
   ok:true,
   resource_type:target.type,
   existing:ids.filter(id=>have.has(id)),
   missing:ids.filter(id=>!have.has(id))
  });
 }catch(e){
  return res.status(500).json({ok:false,error:C(e&&e.message||e)});
 }
});

router.post('/api/gm/smartfit-vector/upsert',async(req,res)=>{
 const pool=req.app.locals.pool;
 const target=targetOf(req.body&&req.body.resource_type);
 const id=idOf(req.body&&(req.body.resource_id||req.body.template_id||req.body.space_id));
 const vector=vec(req.body&&req.body.vector_image);
 if(!pool)return res.status(503).json({ok:false,error:'db unavailable'});
 if(!target||!id||!vector)return res.status(400).json({ok:false,error:'resource_type/resource_id/vector_image required'});
 try{
  await pool.query(
   `INSERT INTO ${target.table}(${target.idcol},vector_image)
    VALUES($1,$2::real[])
    ON CONFLICT(${target.idcol}) DO UPDATE SET vector_image=EXCLUDED.vector_image`,
   [id,vector]
  );
  return res.json({ok:true,resource_type:target.type,resource_id:id,dimensions:vector.length});
 }catch(e){
  return res.status(500).json({ok:false,error:C(e&&e.message||e)});
 }
});

router.post('/api/gm/smartfit-vector/delete',async(req,res)=>{
 const pool=req.app.locals.pool;
 const target=targetOf(req.body&&req.body.resource_type);
 const id=idOf(req.body&&(req.body.resource_id||req.body.template_id||req.body.space_id));
 if(!pool)return res.status(503).json({ok:false,error:'db unavailable'});
 if(!target||!id)return res.status(400).json({ok:false,error:'resource_type/resource_id required'});
 try{
  await pool.query(`DELETE FROM ${target.table} WHERE ${target.idcol}=$1`,[id]);
  return res.json({ok:true,resource_type:target.type,resource_id:id,deleted:true});
 }catch(e){
  return res.status(500).json({ok:false,error:C(e&&e.message||e)});
 }
});

/* Template image search is active now.
 * Space accepts the same request shape, but no Space UI/search entry is connected yet.
 */
router.post('/api/gm/smartfit-vector/search',async(req,res)=>{
 const pool=req.app.locals.pool;
 const target=targetOf(req.body&&req.body.resource_type||'template');
 const vector=vec(req.body&&req.body.vector_image);
 const limit=Math.max(1,Math.min(20,Number(req.body&&req.body.limit||8)||8));
 if(!pool)return res.status(503).json({ok:false,error:'db unavailable'});
 if(!target||!vector)return res.status(400).json({ok:false,error:'resource_type/vector_image required'});
 try{
  let rows=[];
  if(target.type==='template'){
   const q=await pool.query(`
    SELECT v.template_id AS resource_id,v.vector_image,
           t.template_title_source,t.template_title_ko,t.description,t.category_no,t.image_count
      FROM gm_smartfit_template_vector v
      JOIN gm_smartfit_template t ON t.template_id=v.template_id
     WHERE t.is_active='T'
       AND COALESCE(t.is_deleted,'F')<>'T'
       AND t.visibility='public'
       AND COALESCE(t.search_visible,'T')='T'
     LIMIT 20000`);
   rows=q.rows;
  }else{
   const q=await pool.query(`
    SELECT v.space_id AS resource_id,v.vector_image,
           s.space_title_source,s.space_title_ko,s.description,s.category_no,s.image_count
      FROM gm_smartfit_space_vector v
      JOIN gm_smartfit_space s ON s.space_id=v.space_id
     WHERE s.is_active='T'
       AND COALESCE(s.is_deleted,'F')<>'T'
       AND s.visibility='public'
       AND COALESCE(s.search_visible,'T')='T'
     LIMIT 20000`);
   rows=q.rows;
  }

  const matches=rows.map(r=>({
   resource_type:target.type,
   resource_id:Number(r.resource_id),
   score:cosine(vector,r.vector_image),
   title:C(r.template_title_source||r.template_title_ko||r.space_title_source||r.space_title_ko),
   description:C(r.description),
   category_no:C(r.category_no),
   image_count:Number(r.image_count||0)
  })).filter(x=>x.score>=0)
    .sort((a,b)=>b.score-a.score)
    .slice(0,limit);

  return res.json({ok:true,resource_type:target.type,count:matches.length,matches});
 }catch(e){
  return res.status(500).json({ok:false,error:C(e&&e.message||e)});
 }
});

module.exports=router;
