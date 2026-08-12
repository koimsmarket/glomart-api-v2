/* GM_IMAGE_VECTOR_ROUTE_V001
 * Lightweight v1 vector store/search. Table remains exactly product_uid + vector_image.
 * Similarity is computed in Node for initial testing; migrate search engine later when scale requires it.
 */
const express=require('express');
const router=express.Router();
function C(v){return String(v==null?'':v).trim();}
function vec(v){if(!Array.isArray(v))return null; const a=v.map(Number).filter(Number.isFinite); return a.length>=16&&a.length<=2048?a:null;}
function cosine(a,b){if(!a||!b||a.length!==b.length)return -1;let ab=0,aa=0,bb=0;for(let i=0;i<a.length;i++){ab+=a[i]*b[i];aa+=a[i]*a[i];bb+=b[i]*b[i];}return aa&&bb?ab/Math.sqrt(aa*bb):-1;}
router.post('/api/gm/image-vector/upsert',async(req,res)=>{
 const pool=req.app.locals.pool, uid=C(req.body&&req.body.product_uid), v=vec(req.body&&req.body.vector_image);
 if(!pool)return res.status(503).json({ok:false,error:'db unavailable'}); if(!uid||!v)return res.status(400).json({ok:false,error:'product_uid/vector_image required'});
 try{await pool.query(`INSERT INTO gm_product_image_vector(product_uid,vector_image) VALUES($1,$2::real[]) ON CONFLICT(product_uid) DO NOTHING`,[uid,v]);return res.json({ok:true,product_uid:uid,dimensions:v.length});}
 catch(e){return res.status(500).json({ok:false,error:C(e&&e.message||e)});}
});
router.post('/api/gm/image-vector/search',async(req,res)=>{
 const pool=req.app.locals.pool,v=vec(req.body&&req.body.vector_image),limit=Math.max(1,Math.min(20,Number(req.body&&req.body.limit||8)||8));
 if(!pool)return res.status(503).json({ok:false,error:'db unavailable'}); if(!v)return res.status(400).json({ok:false,error:'vector_image required'});
 try{
  const q=await pool.query(`SELECT v.product_uid,v.vector_image,p.product_name,p.product_url,p.thumb_origin_url,p.mall_code FROM gm_product_image_vector v LEFT JOIN gm_product p ON p.product_uid=v.product_uid LIMIT 20000`);
  const matches=q.rows.map(r=>({product_uid:r.product_uid,score:cosine(v,r.vector_image),product_name:C(r.product_name),product_url:C(r.product_url),image_url:C(r.thumb_origin_url),mall_code:C(r.mall_code)})).filter(x=>x.score>=0).sort((a,b)=>b.score-a.score).slice(0,limit);
  return res.json({ok:true,count:matches.length,matches});
 }catch(e){return res.status(500).json({ok:false,error:C(e&&e.message||e)});}
});
module.exports=router;
