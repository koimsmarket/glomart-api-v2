'use strict';

// GM_IMAGE_REPRESENTATIVE_ASSIGN_V002
// Incremental representative assignment after every successful image-vector INSERT/UPDATE.
// Upstream code decides when a vector must be created/refreshed. This module only handles the follow-up representative-net assignment.
// Uses the same runtime RUN/minimum similarity settings as the Builder representative job.

const DIM=512;
const LOCK_KEY=20911001;
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

async function config(db,key,def){const q=await db.query('SELECT config_value FROM gm_runtime_config WHERE config_key=$1',[key]);return q.rows&&q.rows.length?S(q.rows[0].config_value):S(def);}
async function settings(db){const runNo=Math.max(1,Math.trunc(N(await config(db,'image_vector_representative_run','1'),1)));const threshold=N(await config(db,'image_vector_representative_similarity','0.95'),0.95);if(!(threshold>0&&threshold<=1))throw new Error('image_vector_representative_similarity must be > 0 and <= 1');return {run_no:runNo,threshold};}

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
  const pid=pidFromVectorUid(puid),mall=mallHintFromVectorUid(puid);
  const q=await db.query(`
    SELECT product_uid,product_id,mall_code,cp_fix_code,cp_selected_code,category_keyword,keyword,thumb_origin_url
      FROM gm_product
     WHERE product_uid=$1
        OR (product_id=$2 AND ($3='' OR mall_code=$3))
     ORDER BY CASE WHEN product_uid=$1 THEN 0 ELSE 1 END,
              COALESCE(updated_at,last_seen_at) DESC NULLS LAST
     LIMIT 1`,[puid,pid,mall]);
  return q.rows&&q.rows[0]||null;
}

let cache={run_no:0,threshold:0,stamp:'',count:0,ref:null,groups:new Map()};
async function representativeCache(db,st){
  const m=await db.query(`SELECT COUNT(*)::int AS n,COALESCE(MAX(updated_at)::text,'') AS stamp FROM gm_image_vector_representative_map WHERE run_no=$1 AND puid=representative_puid`,[st.run_no]);
  const count=N(m.rows&&m.rows[0]&&m.rows[0].n),stamp=S(m.rows&&m.rows[0]&&m.rows[0].stamp);
  if(cache.run_no===st.run_no&&cache.threshold===st.threshold&&cache.count===count&&cache.stamp===stamp&&cache.ref)return cache;
  const ref=await loadCategoryReference(db),groups=new Map();
  const q=await db.query(`
    SELECT m.representative_no,m.representative_puid,v.vector_image
      FROM gm_image_vector_representative_map m
      JOIN gm_product_image_vector v ON v.product_uid=m.representative_puid
     WHERE m.run_no=$1 AND m.puid=m.representative_puid
       AND v.vector_image IS NOT NULL AND array_length(v.vector_image,1)=$2
     ORDER BY m.representative_no`,[st.run_no,DIM]);
  const repPuids=(q.rows||[]).map(r=>S(r.representative_puid)).filter(Boolean),pids=repPuids.map(pidFromVectorUid);
  const pq=repPuids.length?await db.query(`SELECT product_uid,product_id,mall_code,cp_fix_code,cp_selected_code,category_keyword,keyword,updated_at,last_seen_at
      FROM gm_product WHERE product_uid=ANY($1::text[]) OR product_id=ANY($2::text[])
      ORDER BY COALESCE(updated_at,last_seen_at) DESC NULLS LAST`,[repPuids,pids]):{rows:[]};
  const byUid=new Map(),byPidMall=new Map();
  for(const p of pq.rows||[]){const uid=S(p.product_uid),pid=S(p.product_id),mall=S(p.mall_code).toUpperCase();if(uid&&!byUid.has(uid))byUid.set(uid,p);const k=mall+'|'+pid;if(pid&&!byPidMall.has(k))byPidMall.set(k,p);if(pid&&!byPidMall.has('|'+pid))byPidMall.set('|'+pid,p);}
  for(const r of q.rows||[]){
    const rp=S(r.representative_puid),mall=mallHintFromVectorUid(rp),pid=pidFromVectorUid(rp),meta=byUid.get(rp)||byPidMall.get(mall+'|'+pid)||byPidMall.get('|'+pid)||{};
    const x=resolveProductCategory(ref,meta),vec=normalizedFloat32(r.vector_image);if(!x.group||!vec)continue;
    if(!groups.has(x.group))groups.set(x.group,[]);
    groups.get(x.group).push({representative_no:N(r.representative_no),representative_puid:rp,vector:vec});
  }
  cache={run_no:st.run_no,threshold:st.threshold,stamp,count,ref,groups};
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
async function upsertMap(client,puid,runNo,repNo,repPuid,similarity){await client.query(`INSERT INTO gm_image_vector_representative_map(puid,representative_no,representative_puid,similarity,run_no,updated_at)
  VALUES($1,$2,$3,$4,$5,now())
  ON CONFLICT(puid) DO UPDATE SET representative_no=EXCLUDED.representative_no,representative_puid=EXCLUDED.representative_puid,similarity=EXCLUDED.similarity,run_no=EXCLUDED.run_no,updated_at=now()`,[puid,repNo,repPuid,similarity,runNo]);}
async function markRun0(client,puid){await client.query(`INSERT INTO gm_image_vector_representative_map(puid,representative_no,representative_puid,similarity,run_no,updated_at)
  VALUES($1,NULL,NULL,NULL,0,now()) ON CONFLICT(puid) DO UPDATE SET representative_no=NULL,representative_puid=NULL,similarity=NULL,run_no=0,updated_at=now()`,[puid]);}

async function assignIncremental(db,puid,newVector){
  const vn=normalizedFloat32(newVector);if(!vn)throw new Error('invalid 512D vector for representative assignment');
  const client=await db.connect();
  let st=null,c=null,cat=null,old=null,wasRepresentative=false,reps=[],first=null;
  const touched=new Set();
  try{
    await client.query('BEGIN');
    // Serialize incremental assignments so simultaneous Special/search workers do not create duplicate representatives.
    await client.query('SELECT pg_advisory_xact_lock($1)',[LOCK_KEY]);
    st=await settings(client);
    c=await representativeCache(client,st);const meta=await productMeta(client,puid);
    cat=resolveProductCategory(c.ref,meta||{});
    const oldQ=await client.query('SELECT puid,representative_no,representative_puid,similarity,run_no FROM gm_image_vector_representative_map WHERE puid=$1',[puid]);
    old=oldQ.rows&&oldQ.rows[0]||null;
    wasRepresentative=!!(old&&N(old.run_no)===st.run_no&&S(old.representative_puid)===puid);
    if(!cat.group){
      await markRun0(client,puid);if(old&&S(old.representative_puid))await refreshStat(client,st.run_no,S(old.representative_puid));await client.query('COMMIT');
      if(wasRepresentative)cache={run_no:0,threshold:0,stamp:'',count:0,ref:null,groups:new Map()};
      return {action:'run0',run_no:0,threshold:st.threshold,category_reason:cat.reason,cache_action:wasRepresentative?'invalidate':'keep'};
    }
    reps=(c.groups.get(cat.group)||[]).slice();first=bestRep(vn,reps,wasRepresentative?puid:'');
    if(!wasRepresentative){
      if(first.rep&&first.score>=st.threshold){
        await upsertMap(client,puid,st.run_no,first.rep.representative_no,first.rep.representative_puid,first.score);touched.add(first.rep.representative_puid);if(old&&S(old.representative_puid)&&S(old.representative_puid)!==first.rep.representative_puid)touched.add(S(old.representative_puid));
        for(const r of touched)await refreshStat(client,st.run_no,r);
        await client.query('COMMIT');
        return {action:'linked',run_no:st.run_no,threshold:st.threshold,representative_no:first.rep.representative_no,representative_puid:first.rep.representative_puid,similarity:first.score,category_group:cat.group,category_reason:cat.reason,cache_action:'keep'};
      }
      const no=await nextRepresentativeNo(client,st.run_no);await upsertMap(client,puid,st.run_no,no,puid,1);await refreshStat(client,st.run_no,puid);if(old&&S(old.representative_puid))await refreshStat(client,st.run_no,S(old.representative_puid));await client.query('COMMIT');
      // Keep the assignment cache warm during Special/batch work; only the search HNSW must refresh.
      if(c&&c.run_no===st.run_no&&c.ref){if(!c.groups.has(cat.group))c.groups.set(cat.group,[]);c.groups.get(cat.group).push({representative_no:no,representative_puid:puid,vector:vn});const mm=await client.query(`SELECT COUNT(*)::int AS n,COALESCE(MAX(updated_at)::text,'') AS stamp FROM gm_image_vector_representative_map WHERE run_no=$1 AND puid=representative_puid`,[st.run_no]);c.count=N(mm.rows&&mm.rows[0]&&mm.rows[0].n);c.stamp=S(mm.rows&&mm.rows[0]&&mm.rows[0].stamp);cache=c;}
      return {action:'new_representative',run_no:st.run_no,threshold:st.threshold,representative_no:no,representative_puid:puid,similarity:1,category_group:cat.group,category_reason:cat.reason,cache_action:'representative_changed'};
    }

    // Existing representative vector was updated. Re-evaluate whether it remains a representative.
    const oldChildren=await client.query('SELECT puid FROM gm_image_vector_representative_map WHERE run_no=$1 AND representative_puid=$2 AND puid<>$2',[st.run_no,puid]);
    let remainsRepresentative=!(first.rep&&first.score>=st.threshold),selfRepNo=N(old.representative_no);
    if(remainsRepresentative){await upsertMap(client,puid,st.run_no,selfRepNo,puid,1);touched.add(puid);}else{await upsertMap(client,puid,st.run_no,first.rep.representative_no,first.rep.representative_puid,first.score);touched.add(first.rep.representative_puid);touched.add(puid);}

    // Former members must be checked against the changed representative net so no dangling/invalid group remains.
    let activeReps=reps.filter(r=>S(r.representative_puid)!==puid);
    if(remainsRepresentative)activeReps.push({representative_no:selfRepNo,representative_puid:puid,vector:vn});
    for(const row of oldChildren.rows||[]){
      const child=S(row.puid);if(!child)continue;
      const vq=await client.query('SELECT vector_image FROM gm_product_image_vector WHERE product_uid=$1 AND vector_image IS NOT NULL AND array_length(vector_image,1)=$2',[child,DIM]);
      const cv=normalizedFloat32(vq.rows&&vq.rows[0]&&vq.rows[0].vector_image);if(!cv)continue;
      const b=bestRep(cv,activeReps,'');
      if(b.rep&&b.score>=st.threshold){await upsertMap(client,child,st.run_no,b.rep.representative_no,b.rep.representative_puid,b.score);touched.add(b.rep.representative_puid);continue;}
      const no=await nextRepresentativeNo(client,st.run_no);await upsertMap(client,child,st.run_no,no,child,1);activeReps.push({representative_no:no,representative_puid:child,vector:cv});touched.add(child);
    }
    for(const r of touched)await refreshStat(client,st.run_no,r);
    await client.query('COMMIT');cache={run_no:0,threshold:0,stamp:'',count:0,ref:null,groups:new Map()};
    return {action:remainsRepresentative?'representative_kept':'representative_relinked',run_no:st.run_no,threshold:st.threshold,representative_no:remainsRepresentative?selfRepNo:first.rep.representative_no,representative_puid:remainsRepresentative?puid:first.rep.representative_puid,similarity:remainsRepresentative?1:first.score,rechecked_members:(oldChildren.rows||[]).length,category_group:cat.group,category_reason:cat.reason,cache_action:'invalidate'};
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}

function invalidate(){cache={run_no:0,threshold:0,stamp:'',count:0,ref:null,groups:new Map()};}
module.exports={assignIncremental,invalidate,settings};
