'use strict';
const fs=require('fs');
const os=require('os');

let poolRef=null, timer=null, pumping=false;
let lastState={running:false,mode:'AUTO',state:'IDLE',lang_code:'',completed:0,failed:0,last_error:'',memory_percent:0};

function readNumber(file){try{const s=fs.readFileSync(file,'utf8').trim();if(!s||s==='max')return null;const n=Number(s);return Number.isFinite(n)&&n>0?n:null;}catch(_){return null;}}
function memorySnapshot(){
  let limit=readNumber('/sys/fs/cgroup/memory.max')||readNumber('/sys/fs/cgroup/memory/memory.limit_in_bytes');
  if(!limit||limit>os.totalmem()*8){const c=typeof process.constrainedMemory==='function'?Number(process.constrainedMemory()||0):0;limit=c>0?c:os.totalmem();}
  const used=readNumber('/sys/fs/cgroup/memory.current')||readNumber('/sys/fs/cgroup/memory/memory.usage_in_bytes')||Number(process.memoryUsage().rss||0);
  const ratio=limit>0?used/limit:1;
  return {ratio,percent:Math.round(ratio*1000)/10};
}
function kstHHMM(){const d=new Date(Date.now()+9*60*60*1000);return String(d.getUTCHours()).padStart(2,'0')+':'+String(d.getUTCMinutes()).padStart(2,'0');}
function inWindow(now,start,end){
  if(start===end) return true;
  if(start<end) return now>=start && now<end;
  return now>=start || now<end;
}
function protect(text){
  const tokens=[];
  const src=String(text==null?'':text);
  const rx=/(https?:\/\/[^\s)\]}>,"']+|%[a-zA-Z]|\{\$[^}]+\}|<\/?[A-Za-z][^>]*>)/g;
  const safe=src.replace(rx,m=>{const key='ZZGMKEEP'+tokens.length+'ZZ';tokens.push(m);return key;});
  return {safe,restore(out){let x=String(out==null?'':out);for(let i=0;i<tokens.length;i++)x=x.replace(new RegExp('ZZGMKEEP\\s*'+i+'ZZ','g'),tokens[i]);return x;},tokens};
}
async function translateOne(text,target){
  const p=protect(text);
  if(!p.safe.trim()) return String(text||'');
  const url='https://translate.googleapis.com/translate_a/single?client=gtx&sl=ko&tl='+encodeURIComponent(target)+'&dt=t&q='+encodeURIComponent(p.safe);
  const ctrl=new AbortController(); const to=setTimeout(()=>ctrl.abort(),8000);
  try{
    const r=await fetch(url,{headers:{accept:'application/json'},signal:ctrl.signal});
    if(!r.ok) throw new Error('translate_http_'+r.status);
    const j=await r.json();
    let out=''; if(j&&Array.isArray(j[0])) for(const row of j[0]) if(row&&row[0]) out+=row[0];
    out=p.restore(out||text);
    return out||String(text||'');
  }finally{clearTimeout(to);}
}
async function cfg(){
  const r=await poolRef.query(`SELECT config_key,config_value FROM gm_runtime_config WHERE enabled=TRUE AND config_key LIKE 'device_lang_%'`);
  const m={};for(const x of r.rows)m[x.config_key]=String(x.config_value||'');return m;
}
async function generate(lang){
  const source=await poolRef.query(`SELECT dict_key,source_text,source_value FROM gm_ui_dictionary_source ORDER BY dict_key`);
  if(!source.rows.length) throw new Error('UI_SOURCE_EMPTY');
  const data=[];
  let failCount=0;
  const conf=await cfg().catch(()=>({}));
  const stop=Math.max(1,Number(conf.device_lang_memory_stop_pct||80))/100;
  for(let i=0;i<source.rows.length;i++){
    const row=source.rows[i];
    let tr='';
    try{tr=await translateOne(row.source_value,lang);}catch(e){failCount++;tr=row.source_value;}
    data.push([row.dict_key,row.source_text,tr]);
    if((i+1)%25===0) await new Promise(r=>setTimeout(r,100));
    const mem=memorySnapshot();
    if(mem.ratio>=stop) throw new Error('MEMORY_STOP_'+mem.percent+'%');
  }
  if(failCount>Math.max(10,Math.floor(source.rows.length*0.10))){
    throw new Error('TRANSLATION_FAILURE_RATE_'+failCount+'/'+source.rows.length);
  }
  await poolRef.query(`UPDATE gm_device_language SET
    status='GENERATED',pack_data=$2::jsonb,
    pack_url='/api/gm/device-lang/pack/'||lang_code||'.js',updated_at=now()
    WHERE lang_code=$1`,[lang,JSON.stringify(data)]);
  return {rows:data.length,translation_fallbacks:failCount};
}
async function pump(){
  if(!poolRef||pumping) return;
  pumping=true;
  try{
    const c=await cfg();
    const mode=String(c.device_lang_background_mode||'AUTO').toUpperCase();
    const mem=memorySnapshot();
    lastState.mode=mode;lastState.memory_percent=mem.percent;
    if(mode==='OFF'){lastState.state='OFF';return;}
    if(mode==='AUTO'){
      const now=kstHHMM(),start=String(c.device_lang_auto_start||'00:00'),end=String(c.device_lang_auto_end||'08:00');
      if(!inWindow(now,start,end)){lastState.state='AUTO_TIME_WAIT';return;}
      const startPct=Math.max(1,Number(c.device_lang_memory_start_pct||70))/100;
      if(mem.ratio>startPct){lastState.state='AUTO_MEMORY_WAIT';return;}
    }
    const q=await poolRef.query(`SELECT lang_code FROM gm_device_language WHERE status IN ('NEW','FAILED') ORDER BY first_seen_at LIMIT 1`);
    if(!q.rows.length){lastState.state='NO_PENDING';return;}
    const lang=q.rows[0].lang_code;
    const lock=await poolRef.query(`UPDATE gm_device_language SET status='GENERATING',updated_at=now() WHERE lang_code=$1 AND status IN ('NEW','FAILED') RETURNING lang_code`,[lang]);
    if(!lock.rows.length){lastState.state='RACE_SKIP';return;}
    lastState.running=true;lastState.state='GENERATING';lastState.lang_code=lang;lastState.last_error='';
    try{
      const result=await generate(lang);
      lastState.completed++;lastState.state='GENERATED';lastState.last_result=result;
    }catch(e){
      lastState.failed++;lastState.state='FAILED';lastState.last_error=String(e&&e.message||e);
      await poolRef.query(`UPDATE gm_device_language SET status='FAILED',updated_at=now() WHERE lang_code=$1`,[lang]).catch(()=>{});
    }finally{lastState.running=false;lastState.lang_code='';}
  }catch(e){lastState.last_error=String(e&&e.message||e);lastState.state='ERROR';}
  finally{pumping=false;}
}
function ensureStarted(pool){
  if(pool) poolRef=pool;
  if(timer||!poolRef) return;
  timer=setInterval(()=>pump().catch(()=>{}),60000); if(timer.unref)timer.unref();
  setTimeout(()=>pump().catch(()=>{}),1500);
}
function kick(pool){ensureStarted(pool);setTimeout(()=>pump().catch(()=>{}),50);}
function status(){return Object.assign({},lastState);}
module.exports={ensureStarted,kick,status,generate:async(pool,lang)=>{poolRef=pool;return generate(lang);}};
