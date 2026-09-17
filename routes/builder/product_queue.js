'use strict';
// GM_BUILDER_PRODUCT_QUEUE_STATUS_V001
// Read-only monitor for the adaptive product queue controller. No worker/control mutation here.
const express=require('express');
const fs=require('fs');
const os=require('os');
const router=express.Router();
const searchController=require('../../services/search_controller');
const {dbFrom,ok,fail}=require('./core');

function readNumber(file){try{const s=fs.readFileSync(file,'utf8').trim();if(!s||s==='max')return null;const n=Number(s);return Number.isFinite(n)&&n>0?n:null;}catch(_){return null;}}
function containerLimit(){
  let limit=readNumber('/sys/fs/cgroup/memory.max');
  if(!limit)limit=readNumber('/sys/fs/cgroup/memory/memory.limit_in_bytes');
  if(!limit||limit>os.totalmem()*8){
    const constrained=typeof process.constrainedMemory==='function'?Number(process.constrainedMemory()||0):0;
    limit=constrained>0?constrained:os.totalmem();
  }
  return limit;
}
function containerUsage(){
  let used=readNumber('/sys/fs/cgroup/memory.current');
  if(!used)used=readNumber('/sys/fs/cgroup/memory/memory.usage_in_bytes');
  if(!used)used=Number(process.memoryUsage().rss||0);
  return used;
}
function memorySnapshot(){
  const used=containerUsage(),limit=containerLimit();
  const ratio=limit>0?used/limit:0;
  return {percent:Math.round(ratio*1000)/10,used_mb:Math.round(used/1048576*10)/10,limit_mb:Math.round(limit/1048576*10)/10};
}

router.get('/api/gm/builder/product-queue/status',async(req,res)=>{
  const db=dbFrom(req);
  try{
    const c=searchController.getConcurrencyStatus?searchController.getConcurrencyStatus():{ready:false};
    const poolMax=Math.max(1,Number(db&&db.options&&db.options.max||10));
    const total=Math.max(0,Number(db&&db.totalCount||0));
    const idle=Math.max(0,Number(db&&db.idleCount||0));
    const waiting=Math.max(0,Number(db&&db.waitingCount||0));
    const busy=Math.max(0,total-idle);
    const cpuCount=Math.max(1,(os.cpus()||[]).length||1);
    const load1=(os.loadavg&&os.loadavg()[0])||0;
    const osTotal=Math.max(1,Number(os.totalmem&&os.totalmem()||1));
    const osFree=Math.max(0,Number(os.freemem&&os.freemem()||0));
    ok(res,{
      controller:c,
      memory:memorySnapshot(),
      controller_memory:{percent:Math.round((1-osFree/osTotal)*1000)/10},
      cpu:{count:cpuCount,load_ratio:Number((load1/cpuCount).toFixed(3))},
      db_pool:{max:poolMax,total,idle,busy,waiting}
    });
  }catch(e){fail(res,500,'product queue status failed',{detail:String(e&&e.message||e)});}
});

module.exports=router;
