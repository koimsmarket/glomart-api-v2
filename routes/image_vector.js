/* GM_IMAGE_VECTOR_ROUTE_V002
 * product_uid + vector_image only.
 * Adds batch missing check and an allow-listed image relay so WebView can read pixels
 * without canvas CORS taint. The relay streams bytes and does not persist images.
 */
const express=require('express');
const https=require('https');
const http=require('http');
const router=express.Router();
function C(v){return String(v==null?'':v).trim();}
function vec(v){if(!Array.isArray(v))return null; const a=v.map(Number).filter(Number.isFinite); return a.length>=16&&a.length<=2048?a:null;}
function cosine(a,b){if(!a||!b||a.length!==b.length)return -1;let ab=0,aa=0,bb=0;for(let i=0;i<a.length;i++){ab+=a[i]*b[i];aa+=a[i]*a[i];bb+=b[i]*b[i];}return aa&&bb?ab/Math.sqrt(aa*bb):-1;}
function allowedImageUrl(raw){
 try{
  const u=new URL(C(raw));
  if(u.protocol!=='https:')return null;
  const h=u.hostname.toLowerCase();
  const ok=(h==='thumbnail.coupangcdn.com'||h.endsWith('.coupangcdn.com')||h==='ae-pic-a1.aliexpress-media.com'||h.endsWith('.aliexpress-media.com')||h.endsWith('.alicdn.com'));
  return ok?u:null;
 }catch(_e){return null;}
}
function fetchImage(u,res,depth){
 if(depth>3)return res.status(502).json({ok:false,error:'too many redirects'});
 const mod=u.protocol==='https:'?https:http;
 const req=mod.get(u,{headers:{'User-Agent':'Mozilla/5.0','Accept':'image/avif,image/webp,image/apng,image/*,*/*;q=0.8'}},r=>{
  if(r.statusCode>=300&&r.statusCode<400&&r.headers.location){
   r.resume();
   try{const next=new URL(r.headers.location,u);const safe=allowedImageUrl(next.toString());if(!safe)return res.status(403).json({ok:false,error:'redirect host blocked'});return fetchImage(safe,res,depth+1);}catch(_e){return res.status(502).json({ok:false,error:'bad redirect'});}
  }
  if(r.statusCode!==200){r.resume();return res.status(502).json({ok:false,error:'image upstream '+r.statusCode});}
  const ct=C(r.headers['content-type']);
  if(!/^image\//i.test(ct)){r.resume();return res.status(415).json({ok:false,error:'upstream is not image'});}
  const len=Number(r.headers['content-length']||0);
  if(len>5*1024*1024){r.resume();return res.status(413).json({ok:false,error:'image too large'});}
  res.setHeader('Content-Type',ct);
  res.setHeader('Cache-Control','public, max-age=86400');
  if(len)res.setHeader('Content-Length',String(len));
  r.pipe(res);
 });
 req.setTimeout(8000,()=>req.destroy(new Error('timeout')));
 req.on('error',e=>{if(!res.headersSent)res.status(502).json({ok:false,error:C(e&&e.message||e)});else try{res.end();}catch(_e){}});
}
router.get('/api/gm/image-vector/proxy',(req,res)=>{
 const u=allowedImageUrl(req.query&&req.query.url);
 if(!u)return res.status(400).json({ok:false,error:'unsupported image url'});
 fetchImage(u,res,0);
});
router.post('/api/gm/image-vector/missing',async(req,res)=>{
 const pool=req.app.locals.pool;
 const raw=Array.isArray(req.body&&req.body.product_uids)?req.body.product_uids:[];
 const ids=[...new Set(raw.map(C).filter(Boolean))].slice(0,200);
 if(!pool)return res.status(503).json({ok:false,error:'db unavailable'});
 if(!ids.length)return res.json({ok:true,missing:[],existing:[]});
 try{
  const q=await pool.query('SELECT product_uid FROM gm_product_image_vector WHERE product_uid = ANY($1::text[])',[ids]);
  const have=new Set(q.rows.map(r=>C(r.product_uid)));
  return res.json({ok:true,existing:ids.filter(x=>have.has(x)),missing:ids.filter(x=>!have.has(x))});
 }catch(e){return res.status(500).json({ok:false,error:C(e&&e.message||e)});}
});
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
