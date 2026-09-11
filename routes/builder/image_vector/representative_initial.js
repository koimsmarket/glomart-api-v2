'use strict';
// GM_BUILDER_IMAGE_VECTOR_REPRESENTATIVE_INITIAL_V002
// Initial/full representative-map builder.
// V007: category reference resolution + representative_no (1..N, shared by all members).
// Category tables are READ ONLY. Source vectors/products are READ ONLY.

const express=require('express');
const router=express.Router();
const {dbFrom,ok,fail}=require('../core');
const DIM=512;
let job={running:false,started_at:null,finished_at:null,run_no:null,threshold:null,total_vector:0,eligible:0,processed:0,categories_total:0,categories_done:0,representatives:0,excluded_run0:0,last_category:null,last_representative_no:0,error:null};
function S(v){return String(v==null?'':v).trim();}
function N(v,d=0){const n=Number(v);return Number.isFinite(n)?n:d;}
function cosine(a,b){let dot=0,aa=0,bb=0;for(let i=0;i<DIM;i++){const x=Number(a[i])||0,y=Number(b[i])||0;dot+=x*y;aa+=x*x;bb+=y*y;}return aa>0&&bb>0?dot/Math.sqrt(aa*bb):-1;}
async function config(db,key,def){const r=await db.query('SELECT config_value FROM gm_runtime_config WHERE config_key=$1',[key]);return r.rows.length?r.rows[0].config_value:def;}
async function settings(db){const runNo=Math.max(1,Math.trunc(N(await config(db,'image_vector_representative_run','1'),1)));const threshold=N(await config(db,'image_vector_representative_similarity','0.95'),0.95);if(!(threshold>0&&threshold<=1))throw new Error('대표이미지 유사율은 0 초과 1 이하여야 합니다.');return {run_no:runNo,threshold};}

// Read-only category resolution.
// Priority: verified/detail cp_fix_code -> stored cp_selected_code -> exact unique category_keyword match.
// Both gm_category and gm_category_dynamic are reference data only; this job never creates/updates categories.
async function buildResolvedRows(db){
  return db.query(`
    WITH category_ref AS (
      SELECT cp_code,gm_code,name_ko,keyword,depth FROM gm_category
      UNION ALL
      SELECT cp_code,gm_code,name_ko,keyword,depth FROM gm_category_dynamic
    ), keyword_exact AS (
      SELECT BTRIM(p.category_keyword) AS kw,
             MIN(COALESCE(NULLIF(BTRIM(c.cp_code),''),NULLIF(BTRIM(c.gm_code),''))) AS code,
             COUNT(DISTINCT COALESCE(NULLIF(BTRIM(c.cp_code),''),NULLIF(BTRIM(c.gm_code),'')))::int AS code_count
        FROM gm_product p
        JOIN category_ref c ON BTRIM(p.category_keyword)<>'' AND BTRIM(c.name_ko)=BTRIM(p.category_keyword)
       GROUP BY BTRIM(p.category_keyword)
    )
    SELECT v.product_uid AS puid,v.vector_image,
           COALESCE(
             (SELECT COALESCE(NULLIF(BTRIM(c.cp_code),''),NULLIF(BTRIM(c.gm_code),'')) FROM category_ref c
               WHERE BTRIM(p.cp_fix_code)<>'' AND (BTRIM(c.cp_code)=BTRIM(p.cp_fix_code) OR BTRIM(c.gm_code)=BTRIM(p.cp_fix_code))
               ORDER BY CASE WHEN BTRIM(c.cp_code)=BTRIM(p.cp_fix_code) THEN 0 ELSE 1 END, c.depth DESC LIMIT 1),
             (SELECT COALESCE(NULLIF(BTRIM(c.cp_code),''),NULLIF(BTRIM(c.gm_code),'')) FROM category_ref c
               WHERE BTRIM(p.cp_selected_code)<>'' AND (BTRIM(c.cp_code)=BTRIM(p.cp_selected_code) OR BTRIM(c.gm_code)=BTRIM(p.cp_selected_code))
               ORDER BY CASE WHEN BTRIM(c.cp_code)=BTRIM(p.cp_selected_code) THEN 0 ELSE 1 END, c.depth DESC LIMIT 1),
             CASE WHEN k.code_count=1 THEN k.code END
           ) AS category_code
      FROM gm_product_image_vector v
      LEFT JOIN gm_product p ON p.product_uid=v.product_uid
      LEFT JOIN keyword_exact k ON k.kw=BTRIM(p.category_keyword)
     WHERE v.vector_image IS NOT NULL AND array_length(v.vector_image,1)=$1
     ORDER BY v.product_uid`,[DIM]);
}

async function allocateRepresentativeNos(client,count){
  if(count<=0)return [];
  // Serial allocation is protected across server instances. Numbers begin at 1 and never reuse an existing max.
  await client.query('SELECT pg_advisory_xact_lock($1)',[20911001]);
  const q=await client.query('SELECT COALESCE(MAX(representative_no),0)::bigint AS max_no FROM gm_image_vector_representative_map');
  const start=Number(q.rows[0].max_no||0)+1;
  return Array.from({length:count},(_,i)=>start+i);
}

async function processCategory(db,categoryCode,rows,runNo,threshold){
  const reps=[],mapped=[];
  for(const row of rows){
    const puid=S(row.puid),v=row.vector_image;if(!puid||!Array.isArray(v)||v.length!==DIM)continue;
    let best=null,bestScore=-2;
    for(const rep of reps){const score=cosine(v,rep.vector);if(score>bestScore){bestScore=score;best=rep;}}
    if(!best||bestScore<threshold){const rep={puid,vector:v,no:null};reps.push(rep);mapped.push({puid,rep,similarity:1});}
    else mapped.push({puid,rep:best,similarity:bestScore});
  }
  const client=await db.connect();
  try{
    await client.query('BEGIN');
    const nos=await allocateRepresentativeNos(client,reps.length);reps.forEach((r,i)=>{r.no=nos[i];});
    for(const m of mapped){
      await client.query(`INSERT INTO gm_image_vector_representative_map
        (puid,representative_no,representative_puid,similarity,run_no,updated_at)
        VALUES($1,$2,$3,$4,$5,now())
        ON CONFLICT(puid) DO UPDATE SET representative_no=EXCLUDED.representative_no,representative_puid=EXCLUDED.representative_puid,similarity=EXCLUDED.similarity,run_no=EXCLUDED.run_no,updated_at=now()`,
        [m.puid,m.rep.no,m.rep.puid,m.similarity,runNo]);
    }
    for(const rep of reps){
      await client.query(`INSERT INTO gm_image_vector_representative_stat
        (representative_no,representative_puid,run_no,member_count,avg_similarity,min_similarity,max_similarity,updated_at)
        SELECT $1,$2,$3,COUNT(*) FILTER (WHERE puid<>representative_puid)::int,
          AVG(similarity) FILTER (WHERE puid<>representative_puid)::real,
          MIN(similarity) FILTER (WHERE puid<>representative_puid)::real,
          MAX(similarity) FILTER (WHERE puid<>representative_puid)::real,now()
        FROM gm_image_vector_representative_map WHERE run_no=$3 AND representative_no=$1
        ON CONFLICT(representative_puid,run_no) DO UPDATE SET representative_no=EXCLUDED.representative_no,member_count=EXCLUDED.member_count,avg_similarity=EXCLUDED.avg_similarity,min_similarity=EXCLUDED.min_similarity,max_similarity=EXCLUDED.max_similarity,updated_at=now()`,
        [rep.no,rep.puid,runNo]);
    }
    await client.query('COMMIT');
    return {members:mapped.length,reps:reps.length,last_no:nos.length?nos[nos.length-1]:0};
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}

async function runInitial(db){
  const s=await settings(db);job={running:true,started_at:new Date().toISOString(),finished_at:null,run_no:s.run_no,threshold:s.threshold,total_vector:0,eligible:0,processed:0,categories_total:0,categories_done:0,representatives:0,excluded_run0:0,last_category:null,last_representative_no:0,error:null};
  try{
    const all=(await buildResolvedRows(db)).rows;job.total_vector=all.length;
    const groups=new Map(),excluded=[];
    for(const r of all){const code=S(r.category_code);if(!code)excluded.push(S(r.puid));else{if(!groups.has(code))groups.set(code,[]);groups.get(code).push(r);}}
    job.excluded_run0=excluded.length;job.categories_total=groups.size;job.eligible=all.length-excluded.length;
    const client=await db.connect();
    try{await client.query('BEGIN');for(const puid of excluded){await client.query(`INSERT INTO gm_image_vector_representative_map(puid,representative_no,representative_puid,similarity,run_no,updated_at) VALUES($1,NULL,NULL,NULL,0,now()) ON CONFLICT(puid) DO UPDATE SET representative_no=NULL,representative_puid=NULL,similarity=NULL,run_no=0,updated_at=now()`,[puid]);}await client.query('COMMIT');}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
    for(const [code,rows] of groups){job.last_category=code;const r=await processCategory(db,code,rows,s.run_no,s.threshold);job.processed+=r.members;job.representatives+=r.reps;job.last_representative_no=Math.max(job.last_representative_no,r.last_no||0);job.categories_done++;}
    job.running=false;job.finished_at=new Date().toISOString();
  }catch(e){job.running=false;job.finished_at=new Date().toISOString();job.error=S(e&&e.message||e);}
}
router.get('/api/gm/builder/image-vector/representative/initial/status',(req,res)=>ok(res,{job}));
router.post('/api/gm/builder/image-vector/representative/initial/run',async(req,res)=>{const db=dbFrom(req);if(job.running)return fail(res,409,'representative initial job already running');try{const s=await settings(db);setImmediate(()=>void runInitial(db));ok(res,{started:true,...s});}catch(e){fail(res,500,'representative initial start failed',{detail:S(e&&e.message||e)});}});
module.exports=router;
