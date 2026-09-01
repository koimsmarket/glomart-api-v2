'use strict';
/* SPECIAL vector CPU worker. Heavy MobileCLIP work is isolated from the HTTP event loop. */
const {parentPort}=require('worker_threads');
const DIM=512;
const S=v=>String(v==null?'':v).trim();
let concurrency=15, active=0, modelPromise=null;
const queue=[];
function log(tag,o){console.log('[GM_CATEGORY_BATCH_VECTOR_WORKER '+tag+']',JSON.stringify(Object.assign({ts:new Date().toISOString()},o||{})));}
async function loadModel(){
 if(modelPromise)return modelPromise;
 modelPromise=(async()=>{
   const cacheDir=process.env.GM_HF_CACHE_DIR||'/tmp/glomart-hf-cache';
   process.env.HF_HOME=process.env.HF_HOME||cacheDir;
   process.env.TRANSFORMERS_CACHE=process.env.TRANSFORMERS_CACHE||cacheDir;
   log('AI_LOAD_START',{model:'Xenova/mobileclip_s0',cache_dir:cacheDir});
   const T=await import('@huggingface/transformers');
   if(T.env){T.env.cacheDir=cacheDir;T.env.useBrowserCache=false;}
   const processor=await T.AutoProcessor.from_pretrained('Xenova/mobileclip_s0');
   const Model=T.CLIPVisionModelWithProjection||T.AutoModel;
   const model=await Model.from_pretrained('Xenova/mobileclip_s0',{quantized:true,device:'cpu'});
   log('AI_READY',{dim:DIM,cache_dir:cacheDir});return {T,processor,model};
 })().catch(e=>{modelPromise=null;log('AI_LOAD_FAIL',{error:S(e&&e.message||e)});throw e;});
 return modelPromise;
}
async function infer(url){
 const A=await loadModel();
 const r=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0','Accept':'image/*,*/*;q=0.8'},redirect:'follow'});
 if(!r.ok)throw new Error('image HTTP '+r.status);
 const blob=await r.blob(),raw=await A.T.RawImage.fromBlob(blob),inputs=await A.processor(raw),o=await A.model(inputs);
 const t=o.image_embeds||o.image_embedding||o.pooler_output;
 if(!t||!t.data||t.data.length!==DIM)throw new Error('embedding dimension '+(t&&t.data&&t.data.length||0));
 const v=new Array(DIM);let n=0;
 for(let i=0;i<DIM;i++){const x=Number(t.data[i])||0;v[i]=x;n+=x*x;}
 n=Math.sqrt(n)||1;for(let i=0;i<DIM;i++)v[i]/=n;return v;
}
async function run(job){
 active++;const t=Date.now();
 try{const vector=await infer(job.image_url);parentPort.postMessage({type:'result',task_id:job.task_id,product_uid:job.product_uid,ok:true,vector,elapsed_ms:Date.now()-t});}
 catch(e){parentPort.postMessage({type:'result',task_id:job.task_id,product_uid:job.product_uid,ok:false,error:S(e&&e.message||e),elapsed_ms:Date.now()-t});}
 finally{active--;pump();}
}
function pump(){while(queue.length&&active<concurrency)void run(queue.shift());}
parentPort.on('message',msg=>{
 if(!msg)return;
 if(msg.type==='config'){const n=Math.round(Number(msg.concurrency)||15);concurrency=Math.max(1,Math.min(32,n));pump();return;}
 if(msg.type==='task'){queue.push({task_id:msg.task_id,product_uid:S(msg.product_uid),image_url:S(msg.image_url)});pump();}
});
