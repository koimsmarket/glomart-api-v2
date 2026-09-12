'use strict';
// GM_IMAGE_VECTOR_WRITE_V010_NO_MIGRATION_QUEUE
// Single authoritative mutation path for gm_product_image_vector.
// INSERT/UPDATE and DELETE both serialize on the same short representative-mutation lock.
// A full representative rebuild uses a separate long-lived builder lock and only takes
// this short mutation lock at marker/publish boundaries.

const {assignIncrementalOnClient,invalidate:invalidateRepresentativeAssign}=require('./image_representative_assign');
const {encodeCandidateVector}=require('./image_candidate_vector');

const DIM=512;
const MUTATION_LOCK_KEY=20911001;
let cachedVectorColumnType=null;
function S(v){return String(v==null?'':v).trim();}
function vectorLiteral(a){return '['+a.map(v=>Number(v).toPrecision(9)).join(',')+']';}
function isArrayVectorType(t){return /^(real|double precision)\[\]$/.test(S(t).toLowerCase());}
function isPgVectorType(t){return /^vector(?:\(|$)/.test(S(t).toLowerCase());}
function validVector(v){return Array.isArray(v)&&v.length===DIM&&v.every(x=>Number.isFinite(Number(x)));}
async function lockMutation(client){await client.query('SELECT pg_advisory_xact_lock($1)',[MUTATION_LOCK_KEY]);}
async function bumpLiveEpoch(client){await client.query(`INSERT INTO gm_runtime_config(config_key,config_value,value_type,category,mode,enabled,description,updated_at) VALUES('image_vector_representative_live_epoch','1','NUMBER','IMAGE_VECTOR','FIXED',TRUE,'현재 LIVE 대표망 topology 세대. 대표 집합/대표 벡터 변경 또는 전체 publish 시 증가',now()) ON CONFLICT(config_key) DO UPDATE SET config_value=(COALESCE(NULLIF(gm_runtime_config.config_value,''),'0')::bigint+1)::text,enabled=TRUE,updated_at=now()`);}
async function bumpRun0Epoch(client){await client.query(`INSERT INTO gm_runtime_config(config_key,config_value,value_type,category,mode,enabled,description,updated_at) VALUES('image_vector_representative_run0_epoch','1','NUMBER','IMAGE_VECTOR','FIXED',TRUE,'RUN0 searchable membership generation. RUN0 진입/이탈/전체 publish 시 증가',now()) ON CONFLICT(config_key) DO UPDATE SET config_value=(COALESCE(NULLIF(gm_runtime_config.config_value,''),'0')::bigint+1)::text,enabled=TRUE,updated_at=now()`);}
async function refreshRepresentativeStat(client,runNo,repPuid){
  const uid=S(repPuid);if(!uid||!(Number(runNo)>0))return;
  const self=await client.query('SELECT 1 FROM gm_image_vector_representative_map WHERE puid=$1 AND representative_puid=$1 AND run_no=$2',[uid,runNo]);
  if(!self.rows.length){await client.query('DELETE FROM gm_image_vector_representative_stat WHERE representative_puid=$1 AND run_no=$2',[uid,runNo]);return;}
  const s=await client.query(`SELECT representative_no,
      COUNT(*) FILTER (WHERE puid<>representative_puid)::int AS member_count,
      AVG(similarity) FILTER (WHERE puid<>representative_puid)::real AS avg_similarity,
      MIN(similarity) FILTER (WHERE puid<>representative_puid)::real AS min_similarity,
      MAX(similarity) FILTER (WHERE puid<>representative_puid)::real AS max_similarity
    FROM gm_image_vector_representative_map
    WHERE run_no=$1 AND representative_puid=$2
    GROUP BY representative_no`,[runNo,uid]);
  const r=s.rows&&s.rows[0];if(!r)return;
  await client.query(`INSERT INTO gm_image_vector_representative_stat(representative_no,representative_puid,run_no,member_count,avg_similarity,min_similarity,max_similarity,updated_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,now())
    ON CONFLICT(representative_puid,run_no) DO UPDATE SET representative_no=EXCLUDED.representative_no,member_count=EXCLUDED.member_count,avg_similarity=EXCLUDED.avg_similarity,min_similarity=EXCLUDED.min_similarity,max_similarity=EXCLUDED.max_similarity,updated_at=now()`,
    [r.representative_no,uid,runNo,Number(r.member_count||0),r.avg_similarity,r.min_similarity,r.max_similarity]);
}

async function vectorColumnType(db){
  if(cachedVectorColumnType)return cachedVectorColumnType;
  const q=await db.query(`
    SELECT format_type(a.atttypid,a.atttypmod) AS column_type
      FROM pg_attribute a
      JOIN pg_class c ON c.oid=a.attrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE c.relname='gm_product_image_vector'
       AND a.attname='vector_image'
       AND a.attnum>0
       AND NOT a.attisdropped
     ORDER BY CASE WHEN n.nspname=current_schema() THEN 0 ELSE 1 END
     LIMIT 1`);
  const t=S(q.rows&&q.rows[0]&&q.rows[0].column_type).toLowerCase();
  if(!t)throw new Error('gm_product_image_vector.vector_image type not found');
  cachedVectorColumnType=t;return t;
}

async function currentBuildId(client){
  const b=await client.query(`SELECT config_value FROM gm_runtime_config WHERE config_key='image_vector_representative_building'`);
  return S(b.rows&&b.rows[0]&&b.rows[0].config_value);
}
async function upsertImageVector(db,{product_uid,vector_image,candidate_vector=null}){
  const uid=S(product_uid),v=vector_image;
  if(!uid)throw new Error('product_uid required');
  if(!validVector(v))throw new Error('valid 512D vector_image required');
  // candidate_vector must describe the SAME exact vector_image. Never preserve an old compact
  // candidate when a mobile/Special write replaces vector_image without supplying one.
  const candidate=candidate_vector||encodeCandidateVector(v);
  if(!candidate)throw new Error('candidate_vector encode failed');
  const client=typeof db.connect==='function'?await db.connect():db;
  const release=client!==db&&typeof client.release==='function';
  let columnType='';
  try{
    await client.query('BEGIN');
    await lockMutation(client);
    columnType=await vectorColumnType(client);
    if(isArrayVectorType(columnType)){
      await client.query(`INSERT INTO gm_product_image_vector(product_uid,vector_image,candidate_vector)
        VALUES($1,$2::real[],$3::bytea)
        ON CONFLICT(product_uid) DO UPDATE
           SET vector_image=EXCLUDED.vector_image,
               candidate_vector=EXCLUDED.candidate_vector`,[uid,v,candidate]);
    }else if(isPgVectorType(columnType)){
      await client.query(`INSERT INTO gm_product_image_vector(product_uid,vector_image,candidate_vector)
        VALUES($1,$2::vector,$3::bytea)
        ON CONFLICT(product_uid) DO UPDATE
           SET vector_image=EXCLUDED.vector_image,
               candidate_vector=EXCLUDED.candidate_vector`,[uid,vectorLiteral(v),candidate]);
    }else throw new Error('unsupported vector_image type '+columnType);

    const representative=await assignIncrementalOnClient(client,uid,v);
    await client.query('COMMIT');
    return {product_uid:uid,column_type:columnType,representative_assignment:representative};
  }catch(e){
    try{await client.query('ROLLBACK');}catch(_e){}
    invalidateRepresentativeAssign();
    throw e;
  }finally{if(release)client.release();}
}

// Delete exact vector identities through the same mutation lock as UPSERT.
// If a deleted vector was a representative, still-valid children are moved to RUN0 so
// they remain searchable until their next vector write or the next full representative rebuild.
async function deleteImageVectorsOnClient(client,productUids,{rejectDuringBuild=true}={}){
  const ids=[...new Set((productUids||[]).map(S).filter(Boolean))];
  if(!ids.length)return {deleted:0,deleted_ids:[],representative_children_moved_run0:0,representative_children_requeue:0,representative_map_deleted:0,representative_stat_deleted:0};
  await lockMutation(client);
  const buildId=await currentBuildId(client);
  if(rejectDuringBuild&&buildId){
    const e=new Error('REPRESENTATIVE_REBUILD_RUNNING');e.code='REPRESENTATIVE_REBUILD_RUNNING';e.build_id=buildId;throw e;
  }
  // Capture surviving representatives whose member rows are about to disappear. Their
  // aggregate stats must be recomputed after map deletion.
  const deletedRepresentativeQ=await client.query(`SELECT DISTINCT puid FROM gm_image_vector_representative_map WHERE puid=ANY($1::text[]) AND run_no>0 AND puid=representative_puid`,[ids]);
  const deletedRepresentativeCount=Number(deletedRepresentativeQ.rowCount||0);
  const deletedRun0Q=await client.query(`SELECT COUNT(*)::int AS n FROM gm_image_vector_representative_map WHERE puid=ANY($1::text[]) AND run_no=0`,[ids]);
  const deletedRun0Count=Number(deletedRun0Q.rows&&deletedRun0Q.rows[0]&&deletedRun0Q.rows[0].n||0);
  const affectedRepQ=await client.query(`SELECT DISTINCT run_no,representative_puid
      FROM gm_image_vector_representative_map
     WHERE puid=ANY($1::text[])
       AND run_no>0
       AND representative_puid IS NOT NULL
       AND NOT (representative_puid=ANY($1::text[]))`,[ids]);
  const affectedSurvivingReps=(affectedRepQ.rows||[]).map(r=>({run_no:Number(r.run_no||0),representative_puid:S(r.representative_puid)})).filter(x=>x.run_no>0&&x.representative_puid);
  const del=await client.query('DELETE FROM gm_product_image_vector WHERE product_uid=ANY($1::text[]) RETURNING product_uid',[ids]);
  const deletedIds=(del.rows||[]).map(r=>S(r.product_uid)).filter(Boolean);
  let childrenToRun0=0,rehomedChildren=0,mapDeleted=0,statDeleted=0,statsRefreshed=0;
  if(deletedIds.length){
    const ch=await client.query(`UPDATE gm_image_vector_representative_map
       SET representative_no=NULL,representative_puid=NULL,similarity=NULL,run_no=0,updated_at=now()
     WHERE representative_puid=ANY($1::text[]) AND NOT (puid=ANY($1::text[]))
     RETURNING puid`,[deletedIds]);
    const movedChildren=(ch.rows||[]).map(r=>S(r.puid)).filter(Boolean);
    childrenToRun0=movedChildren.length;
    // No DB refresh queue: re-home surviving children immediately inside the same mutation transaction.
    for(const childUid of movedChildren){
      const vq=await client.query('SELECT vector_image FROM gm_product_image_vector WHERE product_uid=$1',[childUid]);
      const vv=vq.rows&&vq.rows[0]&&vq.rows[0].vector_image;
      if(validVector(vv)){invalidateRepresentativeAssign();await assignIncrementalOnClient(client,childUid,vv);rehomedChildren++;}
    }
    const md=await client.query('DELETE FROM gm_image_vector_representative_map WHERE puid=ANY($1::text[])',[deletedIds]);
    mapDeleted=Number(md.rowCount||0);
    const sd=await client.query('DELETE FROM gm_image_vector_representative_stat WHERE representative_puid=ANY($1::text[])',[deletedIds]);
    statDeleted=Number(sd.rowCount||0);
    for(const x of affectedSurvivingReps){await refreshRepresentativeStat(client,x.run_no,x.representative_puid);statsRefreshed++;}
    if(deletedRepresentativeCount>0)await bumpLiveEpoch(client);
    // RUN0 search has its own generation. Count/MAX(updated_at) alone is not a safe token
    // for arbitrary membership swaps, especially across long transactions.
    if(deletedRun0Count>0||movedChildren.length>0)await bumpRun0Epoch(client);
  }
  invalidateRepresentativeAssign();
  return {deleted:deletedIds.length,deleted_ids:deletedIds,representative_children_moved_run0:childrenToRun0,representative_children_reassigned:rehomedChildren,representative_map_deleted:mapDeleted,representative_stat_deleted:statDeleted,representative_stats_refreshed:statsRefreshed,build_id:buildId};
}

async function deleteImageVectors(db,productUids,opts){
  const client=typeof db.connect==='function'?await db.connect():db;
  const release=client!==db&&typeof client.release==='function';
  try{
    await client.query('BEGIN');
    const out=await deleteImageVectorsOnClient(client,productUids,opts);
    await client.query('COMMIT');return out;
  }catch(e){try{await client.query('ROLLBACK');}catch(_e){} throw e;}
  finally{if(release)client.release();}
}

// Re-evaluate one product against committed metadata without any DB queue table.
// Background calls this only for rows whose gm_product.updated_at is newer than the current map row.
async function refreshRepresentativeFromMetadata(db,productUid,opts={}){
  const uid=S(productUid);if(!uid)return {action:'skip',reason:'EMPTY_UID'};
  const client=typeof db.connect==='function'?await db.connect():db;
  const release=client!==db&&typeof client.release==='function';
  try{
    await client.query('BEGIN');
    await lockMutation(client);
    const buildId=await currentBuildId(client);
    if(buildId){await client.query('ROLLBACK');return {action:'defer_builder',build_id:buildId};}
    const vq=await client.query('SELECT vector_image FROM gm_product_image_vector WHERE product_uid=$1',[uid]);
    const vector=vq.rows&&vq.rows[0]&&vq.rows[0].vector_image;
    if(!validVector(vector)){await client.query('ROLLBACK');return {action:'no_vector',product_uid:uid};}
    const mq=await client.query('SELECT representative_puid,run_no FROM gm_image_vector_representative_map WHERE puid=$1',[uid]);
    const mr=mq.rows&&mq.rows[0]||null;
    if(mr&&S(mr.representative_puid)===uid)invalidateRepresentativeAssign();
    const representative=await assignIncrementalOnClient(client,uid,vector,{metadataOnly:!!opts.reconcile});
    await client.query('COMMIT');
    const changed=!!(representative&&representative.changed);
    return {action:changed?'reassigned':'verified',changed,product_uid:uid,representative_assignment:representative};
  }catch(e){try{await client.query('ROLLBACK');}catch(_e){}invalidateRepresentativeAssign();throw e;}
  finally{if(release)client.release();}
}

function invalidateVectorColumnType(){cachedVectorColumnType=null;}
module.exports={DIM,MUTATION_LOCK_KEY,upsertImageVector,deleteImageVectors,deleteImageVectorsOnClient,refreshRepresentativeFromMetadata,vectorColumnType,isArrayVectorType,isPgVectorType,invalidateVectorColumnType};
