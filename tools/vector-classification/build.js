'use strict';
/* GM_VECTOR_CLASSIFICATION_BUILD_V002
 * Offline/rebuild tool. Original vector_image REAL[512] only.
 * Default scope is completed special top-level category FD (Food).
 * No candidate_vector / ANN dependency.
 *
 * Safety: dry-run by default. Set GM_VECTOR_CLASS_APPLY=1 to replace the
 * derived classification for the selected scope after the full tree is built.
 */
const {Pool}=require('pg');
const DIM=512;
const LEAF_MAX=Math.max(20,Number(process.env.GM_VECTOR_CLASS_LEAF_MAX||100));
const MAX_DEPTH=Math.max(2,Number(process.env.GM_VECTOR_CLASS_MAX_DEPTH||12));
const MAX_CHILDREN=Math.max(2,Math.min(1000,Number(process.env.GM_VECTOR_CLASS_MAX_CHILDREN||1000)));
const ITER=Math.max(2,Math.min(20,Number(process.env.GM_VECTOR_CLASS_ITER||6)));
const GROUPS=String(process.env.GM_VECTOR_CLASS_GROUPS||'FD').split(',').map(s=>s.trim().toUpperCase()).filter(Boolean);
const APPLY=String(process.env.GM_VECTOR_CLASS_APPLY||'')==='1';
const pool=new Pool();
const S=v=>String(v==null?'':v).trim();
function norm(v){let ss=0;for(let i=0;i<v.length;i++)ss+=v[i]*v[i];const d=Math.sqrt(ss)||1;const o=new Float32Array(DIM);for(let i=0;i<DIM;i++)o[i]=v[i]/d;return o;}
function dot(a,b){let s=0;for(let i=0;i<DIM;i++)s+=a[i]*b[i];return s;}
function mean(indices,vecs){const c=new Float32Array(DIM);for(const ix of indices){const v=vecs[ix];for(let d=0;d<DIM;d++)c[d]+=v[d];}if(indices.length)for(let d=0;d<DIM;d++)c[d]/=indices.length;return norm(c);}
function seededIndices(indices,k,seed){let x=(seed>>>0)||1;const out=[],used=new Set();while(out.length<k){x=(Math.imul(x,1664525)+1013904223)>>>0;const p=indices[x%indices.length];if(!used.has(p)){used.add(p);out.push(p);}}return out;}
function splitK(n){if(n<=LEAF_MAX)return 1;return Math.max(2,Math.min(MAX_CHILDREN,Math.ceil(Math.sqrt(n/LEAF_MAX))));}
function kmeans(indices,vecs,k,seed){let centers=seededIndices(indices,k,seed).map(i=>Float32Array.from(vecs[i]));let assign=new Int32Array(indices.length);assign.fill(-1);
  for(let it=0;it<ITER;it++){
    const sums=Array.from({length:k},()=>new Float32Array(DIM)),counts=new Int32Array(k);let changed=0;
    for(let p=0;p<indices.length;p++){const v=vecs[indices[p]];let best=0,bs=-Infinity;for(let c=0;c<k;c++){const sc=dot(v,centers[c]);if(sc>bs){bs=sc;best=c;}}if(assign[p]!==best){assign[p]=best;changed++;}counts[best]++;const s=sums[best];for(let d=0;d<DIM;d++)s[d]+=v[d];}
    for(let c=0;c<k;c++){if(!counts[c]){centers[c]=Float32Array.from(vecs[indices[(c*997+it*37)%indices.length]]);continue;}for(let d=0;d<DIM;d++)sums[c][d]/=counts[c];centers[c]=norm(sums[c]);}
    if(!changed)break;
  }
  const groups=Array.from({length:k},()=>[]);for(let p=0;p<indices.length;p++)groups[assign[p]].push(indices[p]);return groups.filter(g=>g.length);
}
function buildNode(indices,vecs,parent,childNo,depth,seq){const id=++seq.value;const node={tmp_id:id,parent_tmp_id:parent?parent.tmp_id:null,child_no:childNo,depth,count:indices.length,center:mean(indices,vecs),leaf:false,indices:null};seq.nodes.push(node);
  if(indices.length<=LEAF_MAX||depth>=MAX_DEPTH){node.leaf=true;node.indices=indices;return node;}
  const k=splitK(indices.length);const groups=kmeans(indices,vecs,k,(id*2654435761)>>>0);if(groups.length<=1){node.leaf=true;node.indices=indices;return node;}
  groups.sort((a,b)=>b.length-a.length);for(let i=0;i<groups.length;i++)buildNode(groups[i],vecs,node,i+1,depth+1,seq);return node;}
function pgArray(v){return '{'+Array.from(v,x=>Number(x).toPrecision(9)).join(',')+'}';}
async function load(){const q=await pool.query(`
  SELECT v.product_uid,v.vector_image,v.category_group
    FROM gm_product_image_vector v
   WHERE v.category_group = ANY($1::text[])
     AND v.vector_image IS NOT NULL
     AND array_length(v.vector_image,1)=512
   ORDER BY v.product_uid`,[GROUPS]);
  const uids=[],vecs=[];for(const r of q.rows){const a=Array.isArray(r.vector_image)?r.vector_image.map(Number):null;if(!a||a.length!==DIM||a.some(x=>!Number.isFinite(x)))continue;uids.push(r.product_uid);vecs.push(norm(a));}return {uids,vecs};}
async function validateScope(){const q=await pool.query(`SELECT category_group,COUNT(*)::int n FROM gm_product_image_vector WHERE category_group=ANY($1::text[]) GROUP BY category_group ORDER BY category_group`,[GROUPS]);return q.rows;}
async function applyTree(tree,uids){const c=await pool.connect();try{await c.query('BEGIN');
    // Derived data only. Scope replacement is explicit and transactional.
    await c.query(`UPDATE gm_product_image_vector SET class_id=NULL WHERE category_group=ANY($1::text[])`,[GROUPS]);
    // V001 classifier owns the whole vector-category tree. Refuse to mix trees.
    const old=await c.query('SELECT COUNT(*)::int n FROM gm_vector_category');if(Number(old.rows[0].n)>0)throw new Error('VECTOR_CATEGORY_NOT_EMPTY: rebuild requires an empty derived tree; do not mix classifier generations');
    const realId=new Map();for(const n of tree.nodes){const parent=n.parent_tmp_id?realId.get(n.parent_tmp_id):null;const r=await c.query(`INSERT INTO gm_vector_category(parent_id,child_no,vector_center,is_leaf,product_count) VALUES($1,$2,$3::real[],$4,$5) RETURNING id`,[parent,n.child_no,pgArray(n.center),n.leaf,n.count]);realId.set(n.tmp_id,Number(r.rows[0].id));}
    const pairs=[];for(const n of tree.nodes)if(n.leaf&&n.indices)for(const ix of n.indices)pairs.push([uids[ix],realId.get(n.tmp_id)]);
    const B=1000;for(let i=0;i<pairs.length;i+=B){const p=pairs.slice(i,i+B);await c.query(`UPDATE gm_product_image_vector v SET class_id=x.class_id FROM (SELECT * FROM UNNEST($1::text[],$2::bigint[]) AS t(product_uid,class_id)) x WHERE v.product_uid=x.product_uid`,[p.map(x=>x[0]),p.map(x=>x[1])]);}
    await c.query('COMMIT');return {assigned:pairs.length,nodes:tree.nodes.length};
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
(async()=>{try{console.log('[GM_VECTOR_CLASS_BUILD] scope=',GROUPS.join(','),'apply=',APPLY,'leaf_max=',LEAF_MAX,'max_depth=',MAX_DEPTH);console.log('[GM_VECTOR_CLASS_BUILD] product_scope=',await validateScope());const {uids,vecs}=await load();if(!vecs.length)throw new Error('NO_VECTORS_IN_SCOPE: gm_product_image_vector.category_group must contain selected top-level codes, e.g. FD');console.log('[GM_VECTOR_CLASS_BUILD] vectors=',vecs.length);const all=Array.from({length:vecs.length},(_,i)=>i),tree={nodes:[],value:0};buildNode(all,vecs,null,1,0,tree);const leaves=tree.nodes.filter(n=>n.leaf);const depths=leaves.map(n=>n.depth),sizes=leaves.map(n=>n.count);console.log('[GM_VECTOR_CLASS_BUILD] result=',{nodes:tree.nodes.length,leaves:leaves.length,max_depth:Math.max(...depths),avg_leaf:Number((sizes.reduce((a,b)=>a+b,0)/sizes.length).toFixed(2)),max_leaf:Math.max(...sizes)});if(!APPLY){console.log('[GM_VECTOR_CLASS_BUILD] DRY_RUN_ONLY: set GM_VECTOR_CLASS_APPLY=1 after reviewing counts');return;}console.log('[GM_VECTOR_CLASS_BUILD] applied=',await applyTree(tree,uids));}catch(e){console.error('[GM_VECTOR_CLASS_BUILD_FAIL]',e&&e.stack||e);process.exitCode=1;}finally{await pool.end();}})();
