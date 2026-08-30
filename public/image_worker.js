/* IMAGE_WORKER_V005
 * Glomart persistent MobileCLIP worker runtime.
 * Hosted by glomart-api-v2, executed inside the Android persistent IMAGE_WORKER WebView.
 * KT owns only lifecycle/bridge/local-model serving; processing policy stays here.
 */
(function(){
'use strict';
const WORKER_VERSION='GM_IMAGE_WORKER_V005';
const TF_URL='https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';
const MODEL_ID='Xenova/mobileclip_s0';
const DIM=512;
const VECTOR_VERSION=2;
const PREFETCH_CONCURRENCY=10;
const UPSERT_CONCURRENCY=10;
const SCRIPT_SRC=(document.currentScript&&document.currentScript.src)||'';
const API=(()=>{try{return new URL(SCRIPT_SRC).origin;}catch(_e){return 'https://port-0-glomart-api-v2-mordwrnh222b6c36.sel3.cloudtype.app';}})();
let aiPromise=null;
let queue=[];
let queued=new Set();
let running=false;
function c(v){return String(v==null?'':v).replace(/\s+/g,' ').trim();}
function log(tag,obj){try{AndroidGM.log('[GM_IMAGE_WORKER '+tag+'] '+JSON.stringify(obj||{}));}catch(e){}}
function f32ToF16Bits(val){
  if(!Number.isFinite(val))return val<0?0xfc00:0x7c00;
  const f=new Float32Array(1),u=new Uint32Array(f.buffer);f[0]=val;const x=u[0],sign=(x>>>16)&0x8000,exp=((x>>>23)&0xff)-127+15;let mant=x&0x7fffff;
  if(exp<=0){if(exp<-10)return sign;mant=(mant|0x800000)>>(1-exp);return sign+((mant+0x1000)>>13);}
  if(exp>=31)return sign|0x7c00;
  return sign|(exp<<10)|((mant+0x1000)>>13);
}
function vectorBase64(values){
  if(!values||values.length!==DIM)throw new Error('embedding dimension '+(values&&values.length||0));
  const b=new Uint8Array(DIM*2),view=new DataView(b.buffer);
  for(let i=0;i<DIM;i++)view.setUint16(i*2,f32ToF16Bits(Number(values[i])||0),true);
  let s='';for(let p=0;p<b.length;p+=0x4000)s+=String.fromCharCode.apply(null,b.subarray(p,Math.min(p+0x4000,b.length)));
  return btoa(s);
}
async function ai(){
  if(aiPromise)return aiPromise;
  aiPromise=(async()=>{
    log('AI_LOAD_START',{model:MODEL_ID,runtime:'server_js',version:WORKER_VERSION});
    const T=await import(TF_URL);
    T.env.allowLocalModels=false;T.env.allowRemoteModels=true;T.env.remoteHost='https://gm-model.local';T.env.remotePathTemplate='{model}/';
    try{T.env.useBrowserCache=false;}catch(e){}
    const device=(navigator&&navigator.gpu)?'webgpu':'wasm';
    const processor=await T.AutoProcessor.from_pretrained(MODEL_ID);
    let model,used=device;
    try{model=await T.CLIPVisionModelWithProjection.from_pretrained(MODEL_ID,{quantized:true,device:device});}
    catch(e){if(device!=='wasm'){used='wasm';model=await T.CLIPVisionModelWithProjection.from_pretrained(MODEL_ID,{quantized:true,device:'wasm'});}else throw e;}
    log('AI_READY',{model:MODEL_ID,device:used,dimensions:DIM,runtime:'server_js',version:WORKER_VERSION});
    return {T,processor,model,device:used};
  })().catch(e=>{log('AI_INIT_FAIL',{error:c(e&&e.message||e),stack:c(e&&e.stack||'')});aiPromise=null;throw e;});
  return aiPromise;
}
async function bitmapFromProxy(imageUrl){
  const r=await fetch(API+'/api/gm/image-vector/proxy?url='+encodeURIComponent(imageUrl),{credentials:'omit',cache:'force-cache'});
  if(!r.ok)throw new Error('proxy HTTP '+r.status);
  const blob=await r.blob();if(!blob||c(blob.type).toLowerCase().indexOf('image/')!==0)throw new Error('proxy non-image');
  return createImageBitmap(blob);
}
async function inferOne(bm){
  const A=await ai();
  const canvas=document.createElement('canvas');canvas.width=Math.max(1,bm.width||1);canvas.height=Math.max(1,bm.height||1);canvas.getContext('2d').drawImage(bm,0,0,canvas.width,canvas.height);
  const raw=A.T.RawImage.fromCanvas(canvas),inputs=await A.processor(raw),out=await A.model(inputs),t=out.image_embeds||out.image_embedding||out.pooler_output;
  if(!t||!t.data)throw new Error('image embedding output missing');
  if(t.data.length!==DIM)throw new Error('embedding dimension '+t.data.length);
  const a=new Float32Array(DIM);let norm=0;for(let i=0;i<DIM;i++){a[i]=Number(t.data[i])||0;norm+=a[i]*a[i];}norm=Math.sqrt(norm)||1;for(let i=0;i<DIM;i++)a[i]/=norm;
  return vectorBase64(a);
}
async function upsert(item,b64){
  const r=await fetch(API+'/api/gm/image-vector/upsert',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({product_uid:item.product_uid,vector_base64:b64,vector_version:VECTOR_VERSION}),credentials:'omit'});
  if(!r.ok)throw new Error('upsert HTTP '+r.status);
}
async function processQueue(){
  if(running)return;running=true;
  const prefetch=[];
  const upserts=new Set();
  function fillPrefetch(){
    while(prefetch.length<PREFETCH_CONCURRENCY&&queue.length){
      const item=queue.shift();
      const fetch_started=Date.now();
      const bitmap_promise=bitmapFromProxy(item.image_url)
        .then(bm=>({bm,fetch_ms:Date.now()-fetch_started}))
        .catch(error=>({error,fetch_ms:Date.now()-fetch_started}));
      prefetch.push({item,bitmap_promise,total_started:fetch_started});
    }
  }
  async function waitForUpsertSlot(){
    while(upserts.size>=UPSERT_CONCURRENCY)await Promise.race(Array.from(upserts));
  }
  try{
    await ai();
    fillPrefetch();
    while(queue.length||prefetch.length||upserts.size){
      fillPrefetch();
      if(prefetch.length){
        const entry=prefetch.shift();
        fillPrefetch();
        const item=entry.item;
        let bm=null;
        try{
          const prepared=await entry.bitmap_promise;
          if(prepared.error)throw prepared.error;
          bm=prepared.bm;
          const infer_started=Date.now();
          const b64=await inferOne(bm);
          const infer_ms=Date.now()-infer_started;
          try{if(bm&&bm.close)bm.close();}catch(_e){}
          bm=null;
          await waitForUpsertSlot();
          const upsert_started=Date.now();
          let task;
          task=upsert(item,b64)
            .then(()=>{
              log('INDEX_OK',{product_uid:item.product_uid,mall_code:item.mall_code,dimensions:DIM,fetch_ms:prepared.fetch_ms,infer_ms,upsert_ms:Date.now()-upsert_started,elapsed_ms:Date.now()-entry.total_started,queue_left:queue.length,prefetch_left:prefetch.length});
            })
            .catch(e=>{
              log('INDEX_FAIL',{product_uid:item.product_uid,mall_code:item.mall_code,stage:'upsert',error:c(e&&e.message||e),stack:c(e&&e.stack||'')});
            })
            .finally(()=>{queued.delete(item.product_uid);upserts.delete(task);});
          upserts.add(task);
        }catch(e){
          queued.delete(item.product_uid);
          log('INDEX_FAIL',{product_uid:item.product_uid,mall_code:item.mall_code,stage:'fetch_or_infer',error:c(e&&e.message||e),stack:c(e&&e.stack||'')});
          try{if(bm&&bm.close)bm.close();}catch(_e){}
        }
        await new Promise(r=>setTimeout(r,0));
        continue;
      }
      if(upserts.size)await Promise.race(Array.from(upserts));
    }
  }finally{running=false;}
}
window.GM_IMAGE_WORKER={
  enqueue(items){
    let added=0;(Array.isArray(items)?items:[]).forEach(x=>{const uid=c(x&&x.product_uid),url=c(x&&x.image_url),mall=c(x&&x.mall_code);if(!uid||!url||queued.has(uid))return;queued.add(uid);queue.push({product_uid:uid,image_url:url,mall_code:mall});added++;});
    log('QUEUE',{added,queued:queue.length,running});processQueue();return {added,queued:queue.length};
  },
  status(){return {ready:true,running,queued:queue.length,ai_ready:!!aiPromise,version:WORKER_VERSION,runtime:'server_js'};}
};
log('BOOT',{version:WORKER_VERSION,runtime:'server_js',api:API,prefetch_concurrency:PREFETCH_CONCURRENCY,upsert_concurrency:UPSERT_CONCURRENCY});
try{AndroidGM.gmImageWorkerReady(WORKER_VERSION);}catch(e){log('NATIVE_READY_FAIL',{error:c(e&&e.message||e)});}
ai().catch(()=>{});
})();
