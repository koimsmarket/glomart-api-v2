'use strict';

// GM_IMAGE_REPRESENTATIVE_HNSW_V001
// Dependency-free in-memory HNSW for normalized 512D representative vectors.
// The DB REAL[] vectors remain authoritative. This index only selects representative groups.

const DEFAULT_M=Math.max(4,Math.min(32,Number(process.env.GM_IMAGE_HNSW_M||16)||16));
const DEFAULT_EF_CONSTRUCTION=Math.max(16,Math.min(256,Number(process.env.GM_IMAGE_HNSW_EF_CONSTRUCTION||128)||128));
const DEFAULT_EF_SEARCH=Math.max(16,Math.min(512,Number(process.env.GM_IMAGE_HNSW_EF_SEARCH||256)||256));
const LEVEL_MULT=1/Math.log(DEFAULT_M);

function C(v){return String(v==null?'':v).trim();}
function dot(a,b){let s=0;for(let i=0;i<a.length;i++)s+=a[i]*b[i];return s;}
function hash32(s){
  let h=2166136261>>>0;
  s=C(s);
  for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)>>>0;}
  return h>>>0;
}
function unitFromHash(s){return ((hash32(s)+1)>>>0)/4294967297;}
function levelForKey(key){
  const u=Math.max(1e-12,Math.min(1-1e-12,unitFromHash(key)));
  return Math.min(24,Math.max(0,Math.floor(-Math.log(u)*LEVEL_MULT)));
}

class MaxHeap{
  constructor(){this.a=[];}
  get size(){return this.a.length;}
  peek(){return this.a[0]||null;}
  push(x){const a=this.a;a.push(x);let i=a.length-1;while(i>0){const p=(i-1)>>1;if(a[p].score>=x.score)break;a[i]=a[p];i=p;}a[i]=x;}
  pop(){const a=this.a;if(!a.length)return null;const top=a[0],last=a.pop();if(a.length){a[0]=last;let i=0;while(true){let l=i*2+1,r=l+1,b=i;if(l<a.length&&a[l].score>a[b].score)b=l;if(r<a.length&&a[r].score>a[b].score)b=r;if(b===i)break;const t=a[i];a[i]=a[b];a[b]=t;i=b;}}return top;}
}
class MinHeap{
  constructor(){this.a=[];}
  get size(){return this.a.length;}
  peek(){return this.a[0]||null;}
  push(x){const a=this.a;a.push(x);let i=a.length-1;while(i>0){const p=(i-1)>>1;if(a[p].score<=x.score)break;a[i]=a[p];i=p;}a[i]=x;}
  pop(){const a=this.a;if(!a.length)return null;const top=a[0],last=a.pop();if(a.length){a[0]=last;let i=0;while(true){let l=i*2+1,r=l+1,b=i;if(l<a.length&&a[l].score<a[b].score)b=l;if(r<a.length&&a[r].score<a[b].score)b=r;if(b===i)break;const t=a[i];a[i]=a[b];a[b]=t;i=b;}}return top;}
}

class RepresentativeHnsw{
  constructor(opts){
    opts=opts||{};
    this.M=Math.max(4,Math.min(32,Number(opts.M||DEFAULT_M)||DEFAULT_M));
    this.efConstruction=Math.max(this.M*2,Math.min(256,Number(opts.efConstruction||DEFAULT_EF_CONSTRUCTION)||DEFAULT_EF_CONSTRUCTION));
    this.efSearch=Math.max(this.M*2,Math.min(512,Number(opts.efSearch||DEFAULT_EF_SEARCH)||DEFAULT_EF_SEARCH));
    this.nodes=[];this.entry=-1;this.maxLevel=-1;this.builtAt=0;this.buildMs=0;
  }
  score(query,id){return dot(query,this.nodes[id].vector);}
  greedy(query,entry,level){
    let cur=entry,curScore=this.score(query,cur),changed=true;
    while(changed){changed=false;const links=this.nodes[cur].links[level];if(!links)break;
      for(const n of links){const s=this.score(query,n);if(s>curScore){cur=n;curScore=s;changed=true;}}
    }
    return {id:cur,score:curScore};
  }
  searchLayer(query,entryIds,ef,level){
    const candidates=new MaxHeap(); // highest score explored first
    const best=new MinHeap();       // lowest score among retained best at root
    const visited=new Set();
    for(const id of entryIds){if(id<0||visited.has(id))continue;visited.add(id);const s=this.score(query,id);const x={id,score:s};candidates.push(x);best.push(x);}
    while(candidates.size){
      const cur=candidates.pop();const worst=best.peek();
      if(worst&&best.size>=ef&&cur.score<worst.score)break;
      const links=this.nodes[cur.id].links[level];if(!links)continue;
      for(const n of links){if(visited.has(n))continue;visited.add(n);const s=this.score(query,n),w=best.peek();
        if(best.size<ef||!w||s>w.score){const x={id:n,score:s};candidates.push(x);best.push(x);if(best.size>ef)best.pop();}
      }
    }
    return best.a.slice().sort((a,b)=>b.score-a.score);
  }
  pruneNode(id,level){
    const links=this.nodes[id].links[level];if(!links||links.length<=this.M)return;
    const base=this.nodes[id].vector;
    links.sort((a,b)=>dot(base,this.nodes[b].vector)-dot(base,this.nodes[a].vector));
    const keep=links.slice(0,this.M),drop=links.slice(this.M);this.nodes[id].links[level]=keep;
    for(const other of drop){const ol=this.nodes[other].links[level];if(!ol)continue;const pos=ol.indexOf(id);if(pos>=0)ol.splice(pos,1);}
  }
  connect(a,b,level){
    const la=this.nodes[a].links[level]||(this.nodes[a].links[level]=[]);
    if(!la.includes(b))la.push(b);
    const lb=this.nodes[b].links[level]||(this.nodes[b].links[level]=[]);
    if(!lb.includes(a))lb.push(a);
    if(la.length>this.M)this.pruneNode(a,level);
    if(lb.length>this.M)this.pruneNode(b,level);
  }
  add(row){
    const id=this.nodes.length,level=levelForKey(row.representative_puid||row.representative_no||id),links=[];
    for(let l=0;l<=level;l++)links.push([]);
    this.nodes.push({representative_no:Number(row.representative_no||0),representative_puid:C(row.representative_puid),vector:row.vector,level,links});
    if(this.entry<0){this.entry=id;this.maxLevel=level;return;}
    let ep=this.entry;
    for(let l=this.maxLevel;l>level;l--){ep=this.greedy(row.vector,ep,l).id;}
    const top=Math.min(level,this.maxLevel);
    for(let l=top;l>=0;l--){
      const found=this.searchLayer(row.vector,[ep],this.efConstruction,l);
      const selected=found.slice(0,this.M);
      for(const x of selected)this.connect(id,x.id,l);
      if(found.length)ep=found[0].id;
    }
    if(level>this.maxLevel){this.entry=id;this.maxLevel=level;}
  }
  build(rows){
    const started=Date.now();this.nodes=[];this.entry=-1;this.maxLevel=-1;
    for(const row of rows||[])this.add(row);
    this.builtAt=Date.now();this.buildMs=this.builtAt-started;return this;
  }
  search(query,k,efSearch){
    if(this.entry<0||!this.nodes.length)return [];
    k=Math.max(1,Math.min(this.nodes.length,Number(k)||1));
    let ep=this.entry;
    for(let l=this.maxLevel;l>0;l--)ep=this.greedy(query,ep,l).id;
    const ef=Math.max(k,Math.min(this.nodes.length,Number(efSearch||this.efSearch)||this.efSearch));
    const found=this.searchLayer(query,[ep],ef,0).slice(0,k);
    return found.map(x=>{const n=this.nodes[x.id];return {representative_no:n.representative_no,representative_puid:n.representative_puid,score:x.score};});
  }
  status(){return {count:this.nodes.length,max_level:this.maxLevel,M:this.M,ef_construction:this.efConstruction,ef_search:this.efSearch,built_at:this.builtAt,build_ms:this.buildMs};}
}

module.exports={RepresentativeHnsw,DEFAULT_M,DEFAULT_EF_CONSTRUCTION,DEFAULT_EF_SEARCH};
