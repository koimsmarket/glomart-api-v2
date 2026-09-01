'use strict';
/* GM_IMAGE_VECTOR_BACKGROUND_WORKER_V002
 * Heavy MobileCLIP work lives outside category-batch.
 * The parent scheduler dispatches only the number of jobs allowed by memory.
 */
const { parentPort } = require('worker_threads');
const DIM=512;
const S=v=>String(v==null?'':v).trim();
let modelPromise=null;
function log(tag,o){console.log('[GM_IMAGE_VECTOR_BACKGROUND_WORKER '+tag+']',JSON.stringify(Object.assign({ts:new Date().toISOString()},o||{})));}
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
    log('AI_READY',{model:'Xenova/mobileclip_s0',dim:DIM,cache_dir:cacheDir});
    return {T,processor,model};
  })().catch(e=>{modelPromise=null;log('AI_LOAD_FAIL',{error:S(e&&e.message||e)});throw e;});
  return modelPromise;
}
async function infer(url){
  const A=await loadModel();
  const r=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0','Accept':'image/avif,image/webp,image/apng,image/*,*/*;q=0.8'},redirect:'follow'});
  if(!r.ok)throw new Error('image HTTP '+r.status);
  const blob=await r.blob();
  if(!/^image\//i.test(S(blob.type)))throw new Error('non-image '+S(blob.type));
  const raw=await A.T.RawImage.fromBlob(blob);
  const inputs=await A.processor(raw);
  const out=await A.model(inputs);
  const t=out.image_embeds||out.image_embedding||out.pooler_output;
  if(!t||!t.data||t.data.length!==DIM)throw new Error('embedding dimension '+(t&&t.data&&t.data.length||0));
  const v=new Array(DIM);let norm=0;
  for(let i=0;i<DIM;i++){const n=Number(t.data[i])||0;v[i]=n;norm+=n*n;}
  norm=Math.sqrt(norm)||1;
  for(let i=0;i<DIM;i++)v[i]/=norm;
  return v;
}
parentPort.on('message',async msg=>{
  if(!msg||msg.type!=='task')return;
  const started=Date.now();
  const taskId=msg.task_id,productUid=S(msg.product_uid),imageUrl=S(msg.image_url),updatedAt=S(msg.updated_at);
  try{
    const vector=await infer(imageUrl);
    parentPort.postMessage({type:'result',task_id:taskId,product_uid:productUid,image_url:imageUrl,updated_at:updatedAt,ok:true,vector,elapsed_ms:Date.now()-started});
  }catch(e){
    parentPort.postMessage({type:'result',task_id:taskId,product_uid:productUid,image_url:imageUrl,updated_at:updatedAt,ok:false,error:S(e&&e.message||e),elapsed_ms:Date.now()-started});
  }
});
