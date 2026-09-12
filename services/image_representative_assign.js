'use strict';

// GM_IMAGE_REPRESENTATIVE_ASSIGN_V016_BOUNDED_CATEGORY_CACHE
// Incremental representative assignment after every successful image-vector INSERT/UPDATE.
// Upstream code decides when a vector must be created/refreshed. This module only handles the follow-up representative-net assignment.
// Uses the same runtime RUN/minimum similarity settings as the Builder representative job.

const DIM=512;
const LOCK_KEY=20911001;
// Category membership lives in gm_product, not in the representative map. No DB migration/trigger
// stores a category generation, so an in-process category grouping must never be unbounded.
// Keep vector/group caching for burst performance, but force a short periodic metadata refresh
// on every Node/Cloudtype instance. This prevents a representative category change from leaving
// another process on an old group forever.
const CACHE_MAX_AGE_MS=Math.max(250,Math.min(30000,Number(process.env.GM_IMAGE_REP_ASSIGN_CACHE_MS||2000)||2000));
function S(v){return String(v==null?'':v).trim();}
function N(v,d=0){const n=Number(v);return Number.isFinite(n)?n:d;}
function norm(v){return S(v).replace(/\s+/g,' ').toLowerCase();}
function splitComma(v){return S(v).split(/\s*,\s*/).map(norm).filter(Boolean);}
function splitSlash(v){return S(v).split(/\s*[\/／]\s*/).map(norm).filter(Boolean);}
function catCode(r){return S(r&&r.cp_code)||S(r&&r.gm_code);}
function catKey(r){const cp=S(r&&r.cp_code),gm=S(r&&r.gm_code);return cp?`CP:${cp}`:(gm?`GM:${gm}`:`PATH:${S(r&&r.gm_parent_code)}|${S(r&&r.cp_parent_code)}|${norm(r&&r.name_ko)}|${N(r&&r.depth,0)}`);}
function dedupe(rows){const out=[],idx=new Map();for(const r of rows||[]){const k=catKey(r),prev=idx.get(k);if(!prev){idx.set(k,r);out.push(r);continue;}const ps=(S(prev.src)==='base'?20:0)+(S(prev.cp_code)?10:0)+(S(prev.gm_code)?2:0),rs=(S(r.src)==='base'?20:0)+(S(r.cp_code)?10:0)+(S(r.gm_code)?2:0);if(rs>ps){const i=out.indexOf(prev);if(i>=0)out[i]=r;idx.set(k,r);}}return out;}
function addIndex(map,key,row){key=norm(key);if(!key)return;if(!map.has(key))map.set(key,[]);map.get(key).push(row);}
function normalizedFloat32(raw){if(!Array.isArray(raw)||raw.length!==DIM)return null;const a=new Float32Array(DIM);let z=0;for(let i=0;i<DIM;i++){const x=Number(raw[i]);if(!Number.isFinite(x))return null;a[i]=x;z+=x*x;}if(!(z>0))return null;const inv=1/Math.sqrt(z);for(let i=0;i<DIM;i++)a[i]*=inv;return a;}
function cosineNorm(a,b){let s=0;for(let i=0;i<DIM;i++)s+=a[i]*b[i];return s;}
function pidFromVectorUid(raw){const s=S(raw);if(!s)return '';const m=s.match(/^(?:CPKR_|ALKR_)?(\d+)(?:_|$)/i);return m?S(m[1]):s;}
function mallHintFromVectorUid(raw){const s=S(raw);if(/^CPKR_/i.test(s))return 'CPKR';if(/^ALKR_/i.test(s))return 'ALKR';if(/^\d+_\d+_\d+$/.test(s))return 'CPKR';return '';}
function preciseOptionIdentity(raw){const s=S(raw);if(/^(?:CPKR_|ALKR_)\d+_\d+(?:_\d+)?$/i.test(s))return s.replace(/^(?:CPKR_|ALKR_)/i,'');if(/^\d+_\d+_\d+$/.test(s))return s;return '';}

async function config(db,key,def){const q=await db.query('SELECT config_value FROM gm_runtime_config WHERE config_key=$1',[key]);return q.rows&&q.rows.length?S(q.rows[0].config_value):S(def);}
async function settings(db){const targetRun=await config(db,'image_vector_representative_run','1');const targetThreshold=await config(db,'image_vector_representative_similarity','0.95');const runNo=Math.max(1,Math.trunc(N(await config(db,'image_vector_representative_live_run',targetRun),1)));const threshold=N(await config(db,'image_vector_representative_live_similarity',targetThreshold),0.95);const liveEpoch=Math.max(0,Math.trunc(N(await config(db,'image_vector_representative_live_epoch','0'),0)));if(!(threshold>0&&threshold<=1))throw new Error('image_vector_representative_live_similarity must be > 0 and <= 1');return {run_no:runNo,threshold,live_epoch:liveEpoch};}

async function loadCategoryReference(db){
  const r=await db.query(`
    SELECT 'base' AS src,cp_code,gm_code,gm_parent_code,cp_parent_code,parent_name_ko,depth,leaf_yn,name_ko,keyword,keyword_seed
      FROM gm_category
    UNION ALL
    SELECT 'dynamic' AS src,cp_code,gm_code,gm_parent_code,cp_parent_code,parent_name_ko,depth,leaf_yn,name_ko,keyword,keyword AS keyword_seed
      FROM gm_category_dynamic WHERE active_yn='Y'`);
  const ref={byCode:new Map(),exact:new Map(),keyword:new Map(),seed:new Map(),list:new Map(),slash:new Map()};
  for(const row of r.rows||[]){const cp=S(row.cp_code),gm=S(row.gm_code);if(cp)ref.byCode.set(cp,row);if(gm&&!ref.byCode.has(gm))ref.byCode.set(gm,row);addIndex(ref.exact,row.name_ko,row);addIndex(ref.keyword,row.keyword,row);addIndex(ref.seed,row.keyword_seed,row);for(const x of splitComma(`${S(row.keyword)},${S(row.keyword_seed)}`))addIndex(ref.list,x,row);const name=norm(row.name_ko),parts=splitSlash(name);if(parts.length>1)for(const x of parts)addIndex(ref.slash,x,row);}
  return ref;
}
function selectStage(rows,stage){const cand=dedupe(rows||[]);const valid=cand.filter(r=>{const slashGroup=/[\/／]/.test(S(r.name_ko));return !(slashGroup&&N(r.depth,0)<5)&&!!catCode(r);});if(valid.length===1)return {code:catCode(valid[0]),reason:stage};if(valid.length>1){const confirmed=valid.filter(r=>S(r.cp_code));if(confirmed.length===1){const c=confirmed[0],cn=norm(c.name_ko),pg=S(c.gm_parent_code),pc=S(c.cp_parent_code);const same=valid.every(r=>r===c||(norm(r.name_ko)===cn&&S(r.gm_parent_code)===pg&&S(r.cp_parent_code)===pc));if(same)return {code:catCode(c),reason:stage+'_CONFIRMED_SAME_PATH'};}return {code:'',reason:stage+'_AMBIGUOUS',ambiguous:true};}return null;}
function resolveKeyword(ref,keyword){const kw=norm(keyword);if(!kw)return {code:'',group:'',reason:'NO_KEYWORD'};const stages=[['EXACT',ref.exact.get(kw)],['KEYWORD',ref.keyword.get(kw)],['KEYWORD_SEED',ref.seed.get(kw)],['KEYWORD_LIST',ref.list.get(kw)]];for(const [name,rows] of stages){if(!rows||!rows.length)continue;const x=selectStage(rows,name);if(x&&x.code)return {code:x.code,group:`CAT:${x.code}`,reason:x.reason};if(x&&x.ambiguous)return {code:'',group:`KW:${kw}`,reason:x.reason+'_REFERENCE_FAMILY'};}const slash=dedupe(ref.slash.get(kw)||[]).filter(r=>!!catCode(r));if(slash.length===1)return {code:'',group:`KW:${kw}`,reason:'SLASH_REFERENCE_FAMILY'};if(slash.length>1)return {code:'',group:`KW:${kw}`,reason:'SLASH_AMBIGUOUS_REFERENCE_FAMILY'};return {code:'',group:'',reason:'NO_CATEGORY_REFERENCE'};}
function resolveProductCategory(ref,p){const fix=S(p&&p.cp_fix_code);if(fix&&ref.byCode.has(fix)){const code=catCode(ref.byCode.get(fix));return {code,group:`CAT:${code}`,reason:'CP_FIX'};}const selected=S(p&&p.cp_selected_code);if(selected&&ref.byCode.has(selected)){const code=catCode(ref.byCode.get(selected));return {code,group:`CAT:${code}`,reason:'CP_SELECTED'};}return resolveKeyword(ref,S(p&&p.category_keyword)||S(p&&p.keyword));}

async function productMeta(db,puid){
  const pid=pidFromVectorUid(puid),mall=mallHintFromVectorUid(puid),pi=preciseOptionIdentity(puid);
  const q=await db.query(`
    SELECT product_uid,product_id,mall_code,pi_ii_vi,cp_fix_code,cp_selected_code,category_keyword,keyword,thumb_origin_url
      FROM gm_product
     WHERE product_uid=$1
        OR ($4<>'' AND pi_ii_vi=$4 AND ($3='' OR mall_code=$3))
        OR ($4='' AND product_id=$2 AND ($3='' OR mall_code=$3))
     ORDER BY CASE WHEN product_uid=$1 THEN 0 WHEN $4<>'' AND pi_ii_vi=$4 THEN 1 ELSE 2 END,
              CASE WHEN COALESCE(sale_status,'active')='active' AND COALESCE(soldout_yn,'N')<>'Y' THEN 0 ELSE 1 END,
              COALESCE(updated_at,last_seen_at) DESC NULLS LAST
     LIMIT 1`,[puid,pid,mall,pi]);
  return q.rows&&q.rows[0]||null;
}

let cache={run_no:0,threshold:0,live_epoch:-1,stamp:'',count:0,loaded_at:0,ref:null,groups:new Map(),repGroup:new Map()};
async function representativeCache(db,st){
  // live_epoch is part of the cache key. COUNT/MAX(updated_at) is insufficient across
  // multiple Node/Cloudtype instances: another instance can change an older representative
  // while the global MAX timestamp/count stays unchanged. Every representative topology/vector
  // mutation bumps live_epoch, so a stale in-process cache can never survive a new LIVE generation.
  const m=await db.query(`SELECT COUNT(*)::int AS n,COALESCE(MAX(updated_at)::text,'') AS stamp FROM gm_image_vector_representative_map WHERE run_no=$1 AND puid=representative_puid`,[st.run_no]);
  const count=N(m.rows&&m.rows[0]&&m.rows[0].n),stamp=S(m.rows&&m.rows[0]&&m.rows[0].stamp);
  if(cache.run_no===st.run_no&&cache.threshold===st.threshold&&cache.live_epoch===st.live_epoch&&cache.count===count&&cache.stamp===stamp&&cache.ref&&(Date.now()-Number(cache.loaded_at||0))<=CACHE_MAX_AGE_MS)return cache;
  const ref=await loadCategoryReference(db),groups=new Map(),repGroup=new Map();
  const q=await db.query(`
    SELECT m.representative_no,m.representative_puid,v.vector_image
      FROM gm_image_vector_representative_map m
      JOIN gm_product_image_vector v ON v.product_uid=m.representative_puid
     WHERE m.run_no=$1 AND m.puid=m.representative_puid
       AND v.vector_image IS NOT NULL AND array_length(v.vector_image,1)=$2
     ORDER BY m.representative_no`,[st.run_no,DIM]);
  // Resolve metadata for EXISTING representatives with the exact same identity priority as
  // productMeta(): exact product_uid -> exact option pi_ii_vi+mall -> PID+mall only for
  // non-option vector UIDs. PID-only batching is unsafe for PID_IID_VID because it can attach
  // representative A to another option row of the same product and therefore the wrong category.
  const wanted=(q.rows||[]).map((r,idx)=>{const vectorUid=S(r.representative_puid);return {vector_uid:vectorUid,product_id:pidFromVectorUid(vectorUid),mall_code:mallHintFromVectorUid(vectorUid),pi_ii_vi:preciseOptionIdentity(vectorUid),ord:idx+1};}).filter(x=>x.vector_uid);
  const metaByVectorUid=new Map();
  if(wanted.length){
    const vectorUids=wanted.map(x=>x.vector_uid),pids=wanted.map(x=>x.product_id),malls=wanted.map(x=>x.mall_code),pis=wanted.map(x=>x.pi_ii_vi);
    const pq=await db.query(`
      WITH wanted AS (
        SELECT vector_uid,product_id,mall_code,pi_ii_vi,ord
          FROM unnest($1::text[],$2::text[],$3::text[],$4::text[]) WITH ORDINALITY AS x(vector_uid,product_id,mall_code,pi_ii_vi,ord)
      )
      SELECT w.vector_uid,p.product_uid,p.product_id,p.mall_code,p.pi_ii_vi,p.cp_fix_code,p.cp_selected_code,p.category_keyword,p.keyword
        FROM wanted w
        LEFT JOIN LATERAL (
          SELECT p.product_uid,p.product_id,p.mall_code,p.pi_ii_vi,p.cp_fix_code,p.cp_selected_code,p.category_keyword,p.keyword,p.updated_at,p.last_seen_at
            FROM gm_product p
           WHERE p.product_uid=w.vector_uid
              OR (w.pi_ii_vi<>'' AND p.pi_ii_vi=w.pi_ii_vi AND (w.mall_code='' OR p.mall_code=w.mall_code))
              OR (w.pi_ii_vi='' AND p.product_id=w.product_id AND (w.mall_code='' OR p.mall_code=w.mall_code))
           ORDER BY CASE WHEN p.product_uid=w.vector_uid THEN 0 WHEN w.pi_ii_vi<>'' AND p.pi_ii_vi=w.pi_ii_vi THEN 1 ELSE 2 END,
                    CASE WHEN COALESCE(p.sale_status,'active')='active' AND COALESCE(p.soldout_yn,'N')<>'Y' THEN 0 ELSE 1 END,
                    COALESCE(p.updated_at,p.last_seen_at) DESC NULLS LAST,
                    p.product_uid ASC
           LIMIT 1
        ) p ON TRUE
       ORDER BY w.ord`,[vectorUids,pids,malls,pis]);
    for(const p of pq.rows||[])metaByVectorUid.set(S(p.vector_uid),p);
  }
  for(const r of q.rows||[]){
    const rp=S(r.representative_puid),meta=metaByVectorUid.get(rp)||{};
    const x=resolveProductCategory(ref,meta),vec=normalizedFloat32(r.vector_image);if(!x.group||!vec)continue;
    if(!groups.has(x.group))groups.set(x.group,[]);
    groups.get(x.group).push({representative_no:N(r.representative_no),representative_puid:rp,vector:vec});repGroup.set(rp,x.group);
  }
  cache={run_no:st.run_no,threshold:st.threshold,live_epoch:st.live_epoch,stamp,count,loaded_at:Date.now(),ref,groups,repGroup};
  return cache;
}
function bestRep(vectorNorm,reps,excludePuid){let best=null,score=-2;for(const r of reps||[]){if(excludePuid&&S(r.representative_puid)===S(excludePuid))continue;const s=cosineNorm(vectorNorm,r.vector);if(s>score){score=s;best=r;}}return {rep:best,score};}
async function nextRepresentativeNo(client,runNo){await client.query('SELECT pg_advisory_xact_lock($1)',[LOCK_KEY]);const q=await client.query('SELECT COALESCE(MAX(representative_no),0)::bigint AS n FROM gm_image_vector_representative_map WHERE run_no=$1',[runNo]);return N(q.rows&&q.rows[0]&&q.rows[0].n)+1;}
async function refreshStat(client,runNo,repPuid){
  if(!repPuid)return;
  const self=await client.query('SELECT 1 FROM gm_image_vector_representative_map WHERE puid=$1 AND representative_puid=$1 AND run_no=$2',[repPuid,runNo]);
  if(!self.rows.length){await client.query('DELETE FROM gm_image_vector_representative_stat WHERE representative_puid=$1 AND run_no=$2',[repPuid,runNo]);return;}
  const s=await client.query(`SELECT representative_no,
      COUNT(*) FILTER (WHERE puid<>representative_puid)::int AS member_count,
      AVG(similarity) FILTER (WHERE puid<>representative_puid)::real AS avg_similarity,
      MIN(similarity) FILTER (WHERE puid<>representative_puid)::real AS min_similarity,
      MAX(similarity) FILTER (WHERE puid<>representative_puid)::real AS max_similarity
    FROM gm_image_vector_representative_map
    WHERE run_no=$1 AND representative_puid=$2
    GROUP BY representative_no`,[runNo,repPuid]);
  const r=s.rows&&s.rows[0];if(!r)return;
  await client.query(`INSERT INTO gm_image_vector_representative_stat(representative_no,representative_puid,run_no,member_count,avg_similarity,min_similarity,max_similarity,updated_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,now())
    ON CONFLICT(representative_puid,run_no) DO UPDATE SET representative_no=EXCLUDED.representative_no,member_count=EXCLUDED.member_count,avg_similarity=EXCLUDED.avg_similarity,min_similarity=EXCLUDED.min_similarity,max_similarity=EXCLUDED.max_similarity,updated_at=now()`,[r.representative_no,repPuid,runNo,N(r.member_count),r.avg_similarity,r.min_similarity,r.max_similarity]);
}
async function bumpLiveEpoch(client){
  await client.query(`INSERT INTO gm_runtime_config(config_key,config_value,value_type,category,mode,enabled,description,updated_at)
    VALUES('image_vector_representative_live_epoch','1','NUMBER','IMAGE_VECTOR','FIXED',TRUE,'현재 LIVE 대표망 topology 세대. 대표 집합/대표 벡터 변경 또는 전체 publish 시 증가',now())
    ON CONFLICT(config_key) DO UPDATE
       SET config_value=(COALESCE(NULLIF(gm_runtime_config.config_value,''),'0')::bigint+1)::text,
           enabled=TRUE,updated_at=now()`);
}
async function bumpRun0Epoch(client){
  await client.query(`INSERT INTO gm_runtime_config(config_key,config_value,value_type,category,mode,enabled,description,updated_at)
    VALUES('image_vector_representative_run0_epoch','1','NUMBER','IMAGE_VECTOR','FIXED',TRUE,'RUN0 searchable membership generation. RUN0 진입/이탈/전체 publish 시 증가',now())
    ON CONFLICT(config_key) DO UPDATE
       SET config_value=(COALESCE(NULLIF(gm_runtime_config.config_value,''),'0')::bigint+1)::text,
           enabled=TRUE,updated_at=now()`);
}
async function upsertMap(client,puid,runNo,repNo,repPuid,similarity){await client.query(`INSERT INTO gm_image_vector_representative_map(puid,representative_no,representative_puid,similarity,run_no,updated_at)
  VALUES($1,$2,$3,$4,$5,clock_timestamp())
  ON CONFLICT(puid) DO UPDATE SET representative_no=EXCLUDED.representative_no,representative_puid=EXCLUDED.representative_puid,similarity=EXCLUDED.similarity,run_no=EXCLUDED.run_no,updated_at=clock_timestamp()`,[puid,repNo,repPuid,similarity,runNo]);}
async function markRun0(client,puid){await client.query(`INSERT INTO gm_image_vector_representative_map(puid,representative_no,representative_puid,similarity,run_no,updated_at)
  VALUES($1,NULL,NULL,NULL,0,clock_timestamp()) ON CONFLICT(puid) DO UPDATE SET representative_no=NULL,representative_puid=NULL,similarity=NULL,run_no=0,updated_at=clock_timestamp()`,[puid]);}

async function rehomeFormerRepresentativeChildren(client,st,formerRepPuid,oldChildren,{keepFormerRepresentative=false,formerGroup='',formerRepNo=0,formerVectorNorm=null}={}){
  cache={run_no:0,threshold:0,live_epoch:-1,stamp:'',count:0,loaded_at:0,ref:null,groups:new Map(),repGroup:new Map()};
  const fresh=await representativeCache(client,st);
  const workingGroups=new Map();
  for(const [group,list] of fresh.groups.entries())workingGroups.set(group,list.filter(r=>S(r.representative_puid)!==formerRepPuid).slice());
  if(keepFormerRepresentative&&formerGroup&&formerVectorNorm){
    if(!workingGroups.has(formerGroup))workingGroups.set(formerGroup,[]);
    workingGroups.get(formerGroup).push({representative_no:formerRepNo,representative_puid:formerRepPuid,vector:formerVectorNorm});
  }
  const touched=new Set();
  let rechecked=0,run0=0,newRepresentatives=0,linked=0,mappingChanged=0;
  for(const row of oldChildren.rows||[]){
    const child=S(row.puid);if(!child)continue;rechecked++;
    const vq=await client.query('SELECT vector_image FROM gm_product_image_vector WHERE product_uid=$1 AND vector_image IS NOT NULL AND array_length(vector_image,1)=$2',[child,DIM]);
    const cv=normalizedFloat32(vq.rows&&vq.rows[0]&&vq.rows[0].vector_image);
    if(!cv){if(N(row.run_no,-1)!==0)mappingChanged++;await markRun0(client,child);run0++;continue;}
    const childMeta=await productMeta(client,child),childCat=resolveProductCategory(fresh.ref,childMeta||{});
    if(!childCat.group){if(N(row.run_no,-1)!==0)mappingChanged++;await markRun0(client,child);run0++;continue;}
    if(!workingGroups.has(childCat.group))workingGroups.set(childCat.group,[]);
    const activeReps=workingGroups.get(childCat.group);
    const b=bestRep(cv,activeReps,'');
    if(b.rep&&b.score>=st.threshold){
      if(N(row.run_no,-1)!==st.run_no||S(row.representative_puid)!==S(b.rep.representative_puid)||N(row.representative_no,-1)!==N(b.rep.representative_no,-2))mappingChanged++;
      await upsertMap(client,child,st.run_no,b.rep.representative_no,b.rep.representative_puid,b.score);
      touched.add(b.rep.representative_puid);linked++;continue;
    }
    const no=await nextRepresentativeNo(client,st.run_no);
    if(N(row.run_no,-1)!==st.run_no||S(row.representative_puid)!==child)mappingChanged++;
    await upsertMap(client,child,st.run_no,no,child,1);
    activeReps.push({representative_no:no,representative_puid:child,vector:cv});
    touched.add(child);newRepresentatives++;
  }
  for(const r of touched)await refreshStat(client,st.run_no,r);
  cache={run_no:0,threshold:0,live_epoch:-1,stamp:'',count:0,loaded_at:0,ref:null,groups:new Map(),repGroup:new Map()};
  return {rechecked,run0,linked,new_representatives:newRepresentatives,mapping_changed:mappingChanged,touched};
}

async function assignIncrementalOnClient(client,puid,newVector,opts={}){
  const vn=normalizedFloat32(newVector);if(!vn)throw new Error('invalid 512D vector for representative assignment');
  const metadataOnly=!!opts.metadataOnly;
  let st=null,c=null,cat=null,old=null,wasRepresentative=false,reps=[],first=null;
  const touched=new Set();
  try{
    // Serialize incremental assignments so simultaneous Special/search workers do not create duplicate representatives.
    await client.query('SELECT pg_advisory_xact_lock($1)',[LOCK_KEY]);
    st=await settings(client);
    c=await representativeCache(client,st);const meta=await productMeta(client,puid);
    cat=resolveProductCategory(c.ref,meta||{});
    const oldQ=await client.query('SELECT puid,representative_no,representative_puid,similarity,run_no FROM gm_image_vector_representative_map WHERE puid=$1',[puid]);
    old=oldQ.rows&&oldQ.rows[0]||null;
    const oldRun=old?N(old.run_no,-1):-1,wasRun0=!!(old&&oldRun===0);
    wasRepresentative=!!(old&&oldRun===st.run_no&&S(old.representative_puid)===puid);
    if(!cat.group){
      if(metadataOnly&&old&&oldRun===0)return {action:'verified_run0',changed:false,run_no:0,threshold:st.threshold,category_reason:cat.reason};
      let childResult=null;
      if(wasRepresentative){
        const oldChildren=await client.query('SELECT puid FROM gm_image_vector_representative_map WHERE run_no=$1 AND representative_puid=$2 AND puid<>$2',[st.run_no,puid]);
        await markRun0(client,puid);
        await refreshStat(client,st.run_no,puid);
        childResult=await rehomeFormerRepresentativeChildren(client,st,puid,oldChildren);
      }else{
        await markRun0(client,puid);
        if(old&&S(old.representative_puid))await refreshStat(client,st.run_no,S(old.representative_puid));
      }
      if(wasRepresentative){cache={run_no:0,threshold:0,live_epoch:-1,stamp:'',count:0,loaded_at:0,ref:null,groups:new Map(),repGroup:new Map()};await bumpLiveEpoch(client);}
      // RUN0 HNSW indexes the product vector itself, not only membership. Even when this
      // product was already in RUN0, an image-vector UPSERT can replace its 512D vector while
      // RUN0 membership/count stays unchanged. MAX(updated_at) is not a safe cross-instance
      // generation token because another RUN0 row may own the global maximum timestamp.
      // Therefore every RUN0 assignment invalidates the RUN0 generation. Metadata-only background
      // refreshes may cause an extra rebuild, but they cannot leave a stale RUN0 vector searchable.
      await bumpRun0Epoch(client);
      return {action:'run0',changed:true,run_no:0,threshold:st.threshold,category_reason:cat.reason,rechecked_members:childResult?childResult.rechecked:0,children_run0:childResult?childResult.run0:0,children_linked:childResult?childResult.linked:0,children_new_representatives:childResult?childResult.new_representatives:0,cache_action:wasRepresentative?'invalidate':'keep'};
    }
    reps=(c.groups.get(cat.group)||[]).slice();first=bestRep(vn,reps,wasRepresentative?puid:'');
    if(!wasRepresentative){
      if(first.rep&&first.score>=st.threshold){
        if(metadataOnly&&old&&oldRun===st.run_no&&S(old.representative_puid)===S(first.rep.representative_puid)&&N(old.representative_no,-1)===N(first.rep.representative_no,-2))return {action:'verified_link',changed:false,run_no:st.run_no,threshold:st.threshold,representative_no:first.rep.representative_no,representative_puid:first.rep.representative_puid,similarity:first.score,category_group:cat.group,category_reason:cat.reason};
        await upsertMap(client,puid,st.run_no,first.rep.representative_no,first.rep.representative_puid,first.score);touched.add(first.rep.representative_puid);if(old&&S(old.representative_puid)&&S(old.representative_puid)!==first.rep.representative_puid)touched.add(S(old.representative_puid));
        for(const r of touched)await refreshStat(client,st.run_no,r);
        if(wasRun0)await bumpRun0Epoch(client);
        return {action:'linked',changed:true,run_no:st.run_no,threshold:st.threshold,representative_no:first.rep.representative_no,representative_puid:first.rep.representative_puid,similarity:first.score,category_group:cat.group,category_reason:cat.reason,cache_action:'keep'};
      }
      const no=await nextRepresentativeNo(client,st.run_no);await upsertMap(client,puid,st.run_no,no,puid,1);await refreshStat(client,st.run_no,puid);if(old&&S(old.representative_puid))await refreshStat(client,st.run_no,S(old.representative_puid));
      // Keep the assignment cache warm during Special/batch work; only the search HNSW must refresh.
      if(c&&c.run_no===st.run_no&&c.ref){if(!c.groups.has(cat.group))c.groups.set(cat.group,[]);c.groups.get(cat.group).push({representative_no:no,representative_puid:puid,vector:vn});if(c.repGroup instanceof Map)c.repGroup.set(puid,cat.group);const mm=await client.query(`SELECT COUNT(*)::int AS n,COALESCE(MAX(updated_at)::text,'') AS stamp FROM gm_image_vector_representative_map WHERE run_no=$1 AND puid=representative_puid`,[st.run_no]);c.count=N(mm.rows&&mm.rows[0]&&mm.rows[0].n);c.stamp=S(mm.rows&&mm.rows[0]&&mm.rows[0].stamp);c.loaded_at=Date.now();cache=c;}
      await bumpLiveEpoch(client);
      if(wasRun0)await bumpRun0Epoch(client);
      return {action:'new_representative',changed:true,run_no:st.run_no,threshold:st.threshold,representative_no:no,representative_puid:puid,similarity:1,category_group:cat.group,category_reason:cat.reason,cache_action:'representative_changed'};
    }

    // Metadata reconciliation never treats an unchanged representative vector as a reason to
    // collapse that representative into another one. Keep the self representative in its CURRENT
    // category and only re-home children using EACH CHILD'S current metadata. This catches category
    // moves without causing topology churn on every rolling audit cycle.
    const oldChildren=await client.query('SELECT puid,representative_no,representative_puid,run_no FROM gm_image_vector_representative_map WHERE run_no=$1 AND representative_puid=$2 AND puid<>$2',[st.run_no,puid]);
    const selfRepNo=N(old.representative_no);
    if(metadataOnly){
      // Category membership itself is not part of the search HNSW topology (representative ID/vector
      // are unchanged), so a pure category move must not bump LIVE epoch and force search warming.
      // This process already refreshed the representative metadata before reaching here, and every
      // other assignment process expires its category grouping after CACHE_MAX_AGE_MS. Re-home only
      // children whose actual map assignment changes; those topology changes still bump LIVE epoch.
      const childResult=await rehomeFormerRepresentativeChildren(client,st,puid,oldChildren,{keepFormerRepresentative:true,formerGroup:cat.group,formerRepNo:selfRepNo,formerVectorNorm:vn});
      const topologyChanged=Number(childResult.mapping_changed||0)>0||Number(childResult.new_representatives||0)>0;
      if(topologyChanged){cache={run_no:0,threshold:0,live_epoch:-1,stamp:'',count:0,loaded_at:0,ref:null,groups:new Map(),repGroup:new Map()};await bumpLiveEpoch(client);}
      if(childResult.run0>0&&topologyChanged)await bumpRun0Epoch(client);
      return {action:topologyChanged?'representative_children_reconciled':'verified_representative',changed:topologyChanged,run_no:st.run_no,threshold:st.threshold,representative_no:selfRepNo,representative_puid:puid,similarity:1,rechecked_members:childResult.rechecked,children_run0:childResult.run0,children_linked:childResult.linked,children_new_representatives:childResult.new_representatives,category_group:cat.group,category_reason:cat.reason,cache_action:topologyChanged?'invalidate':'bounded_ttl'};
    }
    // Existing representative vector was updated. Re-evaluate whether it remains a representative.
    let remainsRepresentative=!(first.rep&&first.score>=st.threshold);
    if(remainsRepresentative){await upsertMap(client,puid,st.run_no,selfRepNo,puid,1);touched.add(puid);}else{await upsertMap(client,puid,st.run_no,first.rep.representative_no,first.rep.representative_puid,first.score);touched.add(first.rep.representative_puid);touched.add(puid);}

    // Former members must be re-homed inside EACH CHILD'S CURRENT CATEGORY.
    const childResult=await rehomeFormerRepresentativeChildren(client,st,puid,oldChildren,{keepFormerRepresentative:remainsRepresentative,formerGroup:cat.group,formerRepNo:selfRepNo,formerVectorNorm:vn});
    for(const r of touched)await refreshStat(client,st.run_no,r);
    cache={run_no:0,threshold:0,live_epoch:-1,stamp:'',count:0,loaded_at:0,ref:null,groups:new Map(),repGroup:new Map()};
    // The representative vector changed (even if it remains the same representative ID), or the
    // representative was relinked. Old HNSW vectors/IDs must not be queried against the new map.
    await bumpLiveEpoch(client);
    if(childResult.run0>0)await bumpRun0Epoch(client);
    return {action:remainsRepresentative?'representative_kept':'representative_relinked',changed:true,run_no:st.run_no,threshold:st.threshold,representative_no:remainsRepresentative?selfRepNo:first.rep.representative_no,representative_puid:remainsRepresentative?puid:first.rep.representative_puid,similarity:remainsRepresentative?1:first.score,rechecked_members:childResult.rechecked,children_run0:childResult.run0,children_linked:childResult.linked,children_new_representatives:childResult.new_representatives,category_group:cat.group,category_reason:cat.reason,cache_action:'invalidate'};
  }catch(e){throw e;}
}


async function assignIncremental(db,puid,newVector){
  const client=typeof db.connect==='function'?await db.connect():db;
  const release=client!==db&&typeof client.release==='function';
  try{
    await client.query('BEGIN');
    const out=await assignIncrementalOnClient(client,puid,newVector);
    await client.query('COMMIT');
    return out;
  }catch(e){
    try{await client.query('ROLLBACK');}catch(_e){}
    invalidate();
    throw e;
  }finally{if(release)client.release();}
}

function invalidate(){cache={run_no:0,threshold:0,live_epoch:-1,stamp:'',count:0,loaded_at:0,ref:null,groups:new Map(),repGroup:new Map()};}
module.exports={assignIncremental,assignIncrementalOnClient,invalidate,settings};
