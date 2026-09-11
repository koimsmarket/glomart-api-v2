'use strict';
// GM_BUILDER_IMAGE_VECTOR_REPRESENTATIVE_V001
// Representative selection only. No HNSW/search logic here.
// Group key is the existing gm_product.gm_category value. Empty category => run_no 0.

const express=require('express');
const router=express.Router();
const {dbFrom,ok,fail}=require('../core');

const DIM=512;
let job={running:false,started_at:null,finished_at:null,run_no:null,threshold:null,total:0,processed:0,categories:0,representatives:0,category_missing:0,last_category:null,error:null};
function S(v){return String(v==null?'':v).trim();}
function N(v,d=0){const n=Number(v);return Number.isFinite(n)?n:d;}
function cosine(a,b){let dot=0,aa=0,bb=0;for(let i=0;i<DIM;i++){const x=Number(a[i])||0,y=Number(b[i])||0;dot+=x*y;aa+=x*x;bb+=y*y;}return aa>0&&bb>0?dot/Math.sqrt(aa*bb):-1;}
async function config(db,key,def){const r=await db.query('SELECT config_value FROM gm_runtime_config WHERE config_key=$1',[key]);return r.rows.length?r.rows[0].config_value:def;}
async function settings(db){
 const run=Math.max(1,Math.trunc(N(await config(db,'image_vector_representative_run','1'),1)));
 const threshold=N(await config(db,'image_vector_representative_similarity','0.95'),0.95);
 if(!(threshold>0&&threshold<=1))throw new Error('대표이미지 유사율은 0 초과 1 이하여야 합니다.');
 return {run_no:run,threshold};
}
async function status(db){
 const s=await settings(db);
 const q=await db.query(`SELECT
   (SELECT COUNT(*)::int FROM gm_product_image_vector WHERE vector_image IS NOT NULL AND array_length(vector_image,1)=512) AS total_vector,
   (SELECT COUNT(*)::int FROM gm_image_vector_representative_map WHERE run_no=$1) AS current_done,
   (SELECT COUNT(*)::int FROM gm_image_vector_representative_map WHERE run_no=0) AS category_missing,
   (SELECT COUNT(*)::int FROM gm_image_vector_representative_map WHERE run_no>0 AND run_no<$1) AS previous_run,
   (SELECT COUNT(*)::int FROM gm_image_vector_representative_map WHERE run_no=$1 AND puid=representative_puid) AS representatives`,[s.run_no]);
 const x=q.rows[0]||{}; const total=N(x.total_vector),done=N(x.current_done),missing=N(x.category_missing);
 return {...s,total_vector:total,current_done:done,category_missing:missing,previous_run:N(x.previous_run),representatives:N(x.representatives),unprocessed:Math.max(0,total-done-missing)};
}
async function processCategory(db,category,rows,runNo,threshold){
 const reps=[]; const mapped=[];
 for(const row of rows){
   const v=row.vector_image;
   if(!Array.isArray(v)||v.length!==DIM)continue;
   let best=null,bestScore=-2;
   for(const rep of reps){const score=cosine(v,rep.vector);if(score>bestScore){bestScore=score;best=rep;}}
   if(!best || bestScore<threshold){
     const rep={puid:S(row.puid),vector:v};reps.push(rep);mapped.push([rep.puid,rep.puid,1,runNo]);
   }else mapped.push([S(row.puid),best.puid,bestScore,runNo]);
 }
 const client=await db.connect();
 try{
  await client.query('BEGIN');
  for(const m of mapped)await client.query(`INSERT INTO gm_image_vector_representative_map(puid,representative_puid,similarity,run_no,updated_at) VALUES($1,$2,$3,$4,now()) ON CONFLICT(puid) DO UPDATE SET representative_puid=EXCLUDED.representative_puid,similarity=EXCLUDED.similarity,run_no=EXCLUDED.run_no,updated_at=now()`,m);
  await client.query('DELETE FROM gm_image_vector_representative_stat WHERE run_no=$1 AND representative_puid IN (SELECT representative_puid FROM gm_image_vector_representative_map WHERE run_no=$1 AND puid=representative_puid AND puid=ANY($2::text[]))',[runNo,reps.map(x=>x.puid)]);
  for(const rep of reps)await client.query(`INSERT INTO gm_image_vector_representative_stat(representative_puid,run_no,member_count,avg_similarity,min_similarity,max_similarity,updated_at)
    SELECT $1,$2,COUNT(*)::int,AVG(similarity)::real,MIN(similarity)::real,MAX(similarity)::real,now() FROM gm_image_vector_representative_map WHERE run_no=$2 AND representative_puid=$1
    ON CONFLICT(representative_puid,run_no) DO UPDATE SET member_count=EXCLUDED.member_count,avg_similarity=EXCLUDED.avg_similarity,min_similarity=EXCLUDED.min_similarity,max_similarity=EXCLUDED.max_similarity,updated_at=now()`,[rep.puid,runNo]);
  await client.query('COMMIT');
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
 return {members:mapped.length,reps:reps.length};
}
async function runAll(db){
 const s=await settings(db);job={running:true,started_at:new Date().toISOString(),finished_at:null,run_no:s.run_no,threshold:s.threshold,total:0,processed:0,categories:0,representatives:0,category_missing:0,last_category:null,error:null};
 try{
  const missing=await db.query(`SELECT v.product_uid AS puid FROM gm_product_image_vector v LEFT JOIN gm_product p ON p.product_uid=v.product_uid WHERE v.vector_image IS NOT NULL AND array_length(v.vector_image,1)=512 AND COALESCE(NULLIF(BTRIM(p.gm_category),''),'')=''`);
  for(const r of missing.rows)await db.query(`INSERT INTO gm_image_vector_representative_map(puid,representative_puid,similarity,run_no,updated_at) VALUES($1,NULL,NULL,0,now()) ON CONFLICT(puid) DO UPDATE SET representative_puid=NULL,similarity=NULL,run_no=0,updated_at=now()`,[S(r.puid)]);
  job.category_missing=missing.rowCount;
  const cats=await db.query(`SELECT DISTINCT BTRIM(p.gm_category) AS category FROM gm_product_image_vector v JOIN gm_product p ON p.product_uid=v.product_uid WHERE v.vector_image IS NOT NULL AND array_length(v.vector_image,1)=512 AND COALESCE(NULLIF(BTRIM(p.gm_category),''),'')<>'' ORDER BY 1`);
  const total=await db.query(`SELECT COUNT(*)::int n FROM gm_product_image_vector v JOIN gm_product p ON p.product_uid=v.product_uid WHERE v.vector_image IS NOT NULL AND array_length(v.vector_image,1)=512 AND COALESCE(NULLIF(BTRIM(p.gm_category),''),'')<>''`);job.total=N(total.rows[0]&&total.rows[0].n);
  for(const c of cats.rows){
   const category=S(c.category);job.last_category=category;
   const q=await db.query(`SELECT v.product_uid AS puid,v.vector_image FROM gm_product_image_vector v JOIN gm_product p ON p.product_uid=v.product_uid WHERE BTRIM(p.gm_category)=$1 AND v.vector_image IS NOT NULL AND array_length(v.vector_image,1)=512 ORDER BY v.product_uid`,[category]);
   const r=await processCategory(db,category,q.rows,s.run_no,s.threshold);job.processed+=r.members;job.representatives+=r.reps;job.categories++;
  }
  job.running=false;job.finished_at=new Date().toISOString();
 }catch(e){job.running=false;job.finished_at=new Date().toISOString();job.error=S(e&&e.message||e);}
}
router.get('/api/gm/builder/image-vector/representative/status',async(req,res)=>{const db=dbFrom(req);try{ok(res,{...(await status(db)),job});}catch(e){fail(res,500,'representative status failed',{detail:S(e&&e.message||e)});}});
router.get('/api/gm/builder/image-vector/representative/stats',async(req,res)=>{const db=dbFrom(req);try{const s=await settings(db);const r=await db.query(`SELECT representative_puid,run_no,member_count,avg_similarity,min_similarity,max_similarity,updated_at FROM gm_image_vector_representative_stat WHERE run_no=$1 ORDER BY member_count DESC,representative_puid LIMIT 500`,[s.run_no]);ok(res,{run_no:s.run_no,items:r.rows});}catch(e){fail(res,500,'representative stats failed',{detail:S(e&&e.message||e)});}});
router.post('/api/gm/builder/image-vector/representative/run',async(req,res)=>{const db=dbFrom(req);if(job.running)return fail(res,409,'representative job already running');try{const s=await settings(db);setImmediate(()=>void runAll(db));ok(res,{started:true,...s});}catch(e){fail(res,500,'representative start failed',{detail:S(e&&e.message||e)});}});
module.exports=router;
