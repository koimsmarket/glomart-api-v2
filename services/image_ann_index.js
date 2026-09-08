'use strict';
/* GM_IMAGE_ANN_INDEX_V001
 * Dependency-free ANN candidate index for 512-d INT8 candidate vectors.
 *
 * Algorithm: deterministic sparse random-projection SimHash + multi-table LSH.
 * - candidate_vector remains the persistent source of truth in PostgreSQL.
 * - the ANN index stores only product_uid + 64-bit signature + bucket postings;
 *   it does NOT duplicate the 512-d REAL[] source vectors.
 * - search probes exact + Hamming-distance-1 neighbor buckets, then ranks the
 *   gathered candidates by 64-bit signature distance.
 * - routes/image_vector.js performs candidate-vector cosine rerank and finally
 *   exact REAL[] cosine rerank.
 *
 * This is intentionally separate from HNSW/pgvector so the current Node 20
 * deployment needs no native addon or PostgreSQL extension.
 */
const {DIM,HEADER_BYTES,BYTE_LEN}=require('./image_candidate_vector');

const TABLES=3;
const TABLE_BITS=14;
const BUCKET_MASK=(1<<TABLE_BITS)-1;
const PROJECTION_BITS=64;
const SPARSE_DIMS=16;
const BUILD_BATCH=Math.max(500,Math.min(10000,Number(process.env.GM_IMAGE_ANN_BUILD_BATCH||4000)||4000));
const REFRESH_MS=Math.max(30_000,Number(process.env.GM_IMAGE_ANN_REFRESH_MS||120_000)||120_000);
const MAX_SIGNATURE_CANDIDATES=Math.max(100,Math.min(5000,Number(process.env.GM_IMAGE_ANN_SIGNATURE_CANDIDATES||400)||400));

const state={
  ready:false,loading:null,dirty:true,loadedAt:0,lastError:'',loadMs:0,count:0,
  uids:[],sigLo:[],sigHi:[],tables:[],version:'GM_IMAGE_ANN_INDEX_V001'
};

function S(v){return String(v==null?'':v).trim();}
function validCandidate(buf){
  if(!Buffer.isBuffer(buf))buf=Buffer.from(buf||[]);
  return buf.length===BYTE_LEN&&buf.readUInt8(0)===1&&buf.readUInt16LE(1)===DIM;
}

// Deterministic xorshift PRNG; only used once at module load to define the
// sparse hyperplanes. The same process always builds/querys identical signatures.
function makeProjections(){
  let x=0x6d2b79f5>>>0;
  function rnd(){x^=x<<13;x^=x>>>17;x^=x<<5;return x>>>0;}
  const out=[];
  for(let bit=0;bit<PROJECTION_BITS;bit++){
    const dims=[];const used=new Set();
    while(dims.length<SPARSE_DIMS){
      const d=rnd()%DIM;if(used.has(d))continue;used.add(d);
      dims.push([d,(rnd()&1)?1:-1]);
    }
    out.push(dims);
  }
  return out;
}
const PROJECTIONS=makeProjections();

function signatureFromCandidate(buf){
  if(!validCandidate(buf))return null;
  let lo=0,hi=0;
  for(let bit=0;bit<PROJECTION_BITS;bit++){
    let sum=0;
    const p=PROJECTIONS[bit];
    for(let j=0;j<p.length;j++)sum+=buf.readInt8(HEADER_BYTES+p[j][0])*p[j][1];
    if(sum>=0){
      if(bit<32)lo=(lo|(1<<bit))>>>0;
      else hi=(hi|(1<<(bit-32)))>>>0;
    }
  }
  return {lo:lo>>>0,hi:hi>>>0};
}
function tableKey(sig,t){
  // Three overlapping 14-bit views across the 64-bit signature.
  if(t===0)return sig.lo&BUCKET_MASK;
  if(t===1)return (sig.lo>>>14)&BUCKET_MASK;
  // crosses lo/hi boundary: signature bits 28..41
  return (((sig.lo>>>28)|((sig.hi&0x3ff)<<4))&BUCKET_MASK)>>>0;
}
function addBucket(table,key,idx){
  let a=table.get(key);if(!a){a=[];table.set(key,a);}a.push(idx);
}
function popcnt32(v){
  v=v>>>0;v=v-((v>>>1)&0x55555555);v=(v&0x33333333)+((v>>>2)&0x33333333);
  return (((v+(v>>>4))&0x0f0f0f0f)*0x01010101)>>>24;
}
function hamming64(aLo,aHi,bLo,bHi){return popcnt32((aLo^bLo)>>>0)+popcnt32((aHi^bHi)>>>0);}
function markDirty(){state.dirty=true;}

async function build(pool,force){
  const now=Date.now();
  if(!force&&state.ready&&!state.dirty&&(now-state.loadedAt)<REFRESH_MS)return state;
  // While background writes are active, don't rebuild more often than REFRESH_MS.
  if(!force&&state.ready&&(now-state.loadedAt)<REFRESH_MS)return state;
  if(state.loading)return state.loading;
  state.loading=(async()=>{
    const started=Date.now();
    try{
      const uids=[],sigLo=[],sigHi=[];
      const tables=Array.from({length:TABLES},()=>new Map());
      let cursor='',rowsSeen=0;
      while(true){
        const q=await pool.query(`
          SELECT product_uid,candidate_vector
            FROM gm_product_image_vector
           WHERE product_uid > $1
             AND candidate_vector IS NOT NULL
           ORDER BY product_uid ASC
           LIMIT $2`,[cursor,BUILD_BATCH]);
        const rows=q.rows||[];
        if(!rows.length)break;
        for(const r of rows){
          const uid=S(r.product_uid),sig=signatureFromCandidate(r.candidate_vector);
          if(!uid||!sig)continue;
          const idx=uids.length;uids.push(uid);sigLo.push(sig.lo);sigHi.push(sig.hi);
          for(let t=0;t<TABLES;t++)addBucket(tables[t],tableKey(sig,t),idx);
        }
        rowsSeen+=rows.length;
        cursor=S(rows[rows.length-1].product_uid);
        if(rows.length<BUILD_BATCH)break;
      }
      state.uids=uids;state.sigLo=sigLo;state.sigHi=sigHi;state.tables=tables;
      state.count=uids.length;state.ready=true;state.dirty=false;state.loadedAt=Date.now();
      state.loadMs=state.loadedAt-started;state.lastError='';
      console.log('[GM_IMAGE_ANN_INDEX_READY]',JSON.stringify({count:state.count,rows_seen:rowsSeen,load_ms:state.loadMs,tables:TABLES,bits:TABLE_BITS,version:state.version}));
      return state;
    }catch(e){
      state.lastError=S(e&&e.message||e);
      console.error('[GM_IMAGE_ANN_INDEX_FAIL]',state.lastError);
      throw e;
    }finally{state.loading=null;}
  })();
  return state.loading;
}

function gatherBucketCandidates(sig){
  const seen=new Set();
  for(let t=0;t<TABLES;t++){
    const base=tableKey(sig,t);
    const keys=[base];
    for(let b=0;b<TABLE_BITS;b++)keys.push(base^(1<<b));
    const table=state.tables[t];
    for(const key of keys){
      const a=table.get(key);if(!a)continue;
      for(let i=0;i<a.length;i++)seen.add(a[i]);
    }
  }
  return seen;
}
function search(candidateBuf,wanted){
  const sig=signatureFromCandidate(candidateBuf);if(!sig||!state.ready)return [];
  const gathered=gatherBucketCandidates(sig);
  // Tiny indexes can produce too few LSH collisions. Include all items only while
  // the index is small; this keeps development/current-data searches robust without
  // turning million-scale production searches into a full scan.
  if(gathered.size<Math.min(wanted,100)&&state.count<=20_000){
    for(let i=0;i<state.count;i++)gathered.add(i);
  }
  const ranked=[];
  const cap=Math.max(wanted,MAX_SIGNATURE_CANDIDATES);
  for(const idx of gathered){
    const dist=hamming64(sig.lo,sig.hi,state.sigLo[idx]>>>0,state.sigHi[idx]>>>0);
    if(ranked.length<cap){ranked.push({idx,dist});ranked.sort((a,b)=>b.dist-a.dist);}
    else if(dist<ranked[0].dist){ranked[0]={idx,dist};ranked.sort((a,b)=>b.dist-a.dist);}
  }
  ranked.sort((a,b)=>a.dist-b.dist);
  return ranked.slice(0,cap).map(x=>({product_uid:state.uids[x.idx],signature_distance:x.dist}));
}
function status(){return {ready:state.ready,dirty:state.dirty,count:state.count,loaded_at:state.loadedAt,load_ms:state.loadMs,last_error:state.lastError||null,version:state.version,tables:TABLES,table_bits:TABLE_BITS};}

module.exports={build,search,markDirty,status,signatureFromCandidate};
