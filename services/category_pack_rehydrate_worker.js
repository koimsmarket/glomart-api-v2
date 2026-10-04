'use strict';
/* GM_CATEGORY_PACK_REHYDRATE_WORKER_V001
 * Startup-only CPU worker. Reuses services/category_hnsw_pack.js unchanged.
 */
const fs=require('fs');
const path=require('path');
const {parentPort,workerData}=require('worker_threads');
const categoryHnsw=require('./category_hnsw_pack');
function mkdirp(p){fs.mkdirSync(p,{recursive:true});}
function writeJson(file,obj){mkdirp(path.dirname(file));const tmp=file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(obj),'utf8');fs.renameSync(tmp,file);}
(async()=>{
  try{
    const rows=Array.isArray(workerData&&workerData.rows)?workerData.rows:[];
    const token=String(workerData&&workerData.token||'').trim();
    const legacyV=Number(workerData&&workerData.legacyV||0);
    const root=String(workerData&&workerData.root||'').trim();
    if(!token||!root)throw new Error('CATEGORY_HNSW_WORKER_ARGS_INVALID');
    const pack=categoryHnsw.build(rows,token,token);
    const file=path.join(root,'hnsw',token,'index.json');
    writeJson(file,pack);
    if(legacyV>0)writeJson(path.join(root,'hnsw','v'+Math.trunc(legacyV),'index.json'),pack);
    parentPort.postMessage({ok:true,result:{count:Number(pack.count||0),bytes:fs.statSync(file).size,version:token,build_ms:Number(pack.build_ms||0)}});
  }catch(e){parentPort.postMessage({ok:false,error:String(e&&e.stack||e)});}
})();
