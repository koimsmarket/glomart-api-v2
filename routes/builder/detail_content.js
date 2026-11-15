 'use strict';
// GM_DETAIL_CONTENT_BUILDER_V003: administrator-driven single worker; hard stop on HTTP 403/404.
const express=require('express');
const fs=require('fs');
const path=require('path');
const router=express.Router();
const {upsertProduct}=require('../../services/product/upsert');
const COLLECTOR_FILE=path.join(__dirname,'../../services/detail_content/GM_DETAIL_COLLECTOR.js');
let job=null,stopping=false;
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const poolFor=req=>req.app.locals.pool||req.app.locals.db;
const clean=v=>String(v==null?'':v).trim();
const status=()=>job?Object.assign({},job,{selected_codes:(job.selected_codes||[]).length}):{state:'idle'};
function browserPath(){
  const p=clean(process.env.GM_DETAIL_CHROME_PATH||'');
  if(!p||!fs.existsSync(p))return '';
  return p;
}
function collectorReady(){
  if(!browserPath())return 'CHROMIUM_PATH_NOT_CONFIGURED';
  try{require.resolve('puppeteer-core');}catch(_){return 'PUPPETEER_CORE_NOT_INSTALLED';}
  if(!fs.existsSync(COLLECTOR_FILE))return 'DETAIL_COLLECTOR_NOT_FOUND';
  return '';
}
router.get('/api/gm/builder/detail-content/categories',async(req,res)=>{
  try{
    const db=poolFor(req);if(!db)return res.status(503).json({ok:false,error:'DB_NOT_READY'});
    const r=await db.query("SELECT gm_code,gm_parent_code,name_ko,depth,sort_order,display_yn FROM gm_category WHERE COALESCE(gm_code,'')<>'' ORDER BY depth,sort_order,gm_code");
    res.json({ok:true,categories:r.rows});
  }catch(e){res.status(500).json({ok:false,error:String(e.message||e)});}
});
router.get('/api/gm/builder/detail-content/status',(req,res)=>res.json({ok:true,worker_ready:!collectorReady(),worker_error:collectorReady()||null,job:status()}));
router.post('/api/gm/builder/detail-content/start',async(req,res)=>{
  if(job&&(job.state==='running'||job.state==='stopping'))return res.status(409).json({ok:false,error:'JOB_ALREADY_RUNNING',job:status()});
  const db=poolFor(req);if(!db)return res.status(503).json({ok:false,error:'DB_NOT_READY'});
  const err=collectorReady();if(err)return res.status(503).json({ok:false,error:err,description:'Install puppeteer-core, provide GM_DETAIL_CHROME_PATH pointing to Chromium executable'});
  const codes=Array.isArray(req.body?.category_codes)?[...new Set(req.body.category_codes.map(clean).filter(v=>v.length>0&&v.length<=64))]:[];
  if(!codes.length||codes.length>10000)return res.status(400).json({ok:false,error:'SELECT_CATEGORY_REQUIRED'});
  if(clean(req.body.mall_code)!=='CPKR')return res.status(400).json({ok:false,error:'CPKR_ONLY'});
  const max=Math.min(1000,Math.max(1,Math.trunc(Number(req.body.max_items)||50)));
  const check=await db.query('SELECT gm_code FROM gm_category WHERE gm_code=ANY($1::text[])',[codes]);
  if(check.rowCount!==codes.length)return res.status(400).json({ok:false,error:'INVALID_CATEGORY_CODE'});
  const id=Date.now();stopping=false;
  job={id,state:'running',mall_code:'CPKR',selected_codes:codes,max_items:max,skip_saved:req.body.skip_saved!==false,started_at:new Date().toISOString(),seen:0,saved:0,failed:0,skipped:0,last_pid:'',error:'',messages:[]};
  res.json({ok:true,job:status()});
  void runJob(db,job).catch(e=>{job.state='error';job.error=String(e.message||e);job.finished_at=new Date().toISOString();});
});
router.post('/api/gm/builder/detail-content/stop',(req,res)=>{
  if(job&&job.state==='running'){stopping=true;job.state='stopping';}
  res.json({ok:true,job:status()});
});
const sql=`SELECT DISTINCT ON (p.product_id) p.product_id,p.item_id,p.vendor_item_id,p.product_uid
 FROM gm_product p
 WHERE p.mall_code='CPKR' AND p.product_id ~ '^[0-9]{5,}$'
 AND p.product_id > $2
 AND string_to_array(COALESCE(p.glomart_code,''),'|') && $1::text[]
 AND ($3::boolean=FALSE OR NOT EXISTS(SELECT 1 FROM gm_cpkr_detail_content c WHERE c.product_id=p.product_id))
 ORDER BY p.product_id,p.product_uid LIMIT 20`;
async function collectOne(browser,row,source){
  const page=await browser.newPage();
  try{
    await page.setDefaultNavigationTimeout(25000);
    const url='https://www.coupang.com/vp/products/'+encodeURIComponent(row.product_id)+
      (row.vendor_item_id?'?vendorItemId='+encodeURIComponent(row.vendor_item_id)+(row.item_id?'&itemId='+encodeURIComponent(row.item_id):''):'');
    const response=await page.goto(url,{waitUntil:'domcontentloaded',timeout:25000});
    if(response&&[403,404].includes(response.status()))return {blocked:true,error:'HTTP_'+response.status()};
    await page.evaluate(identity=>{
      const cache={GM_LAST_GLOMART_DETAIL_QUERY:JSON.stringify(identity)};
      window.GM_getValue=(key,fallback)=>Object.prototype.hasOwnProperty.call(cache,key)?cache[key]:fallback;
      window.GM_setValue=(key,value)=>{cache[key]=value;window.__GM_BUILDER_COLLECTOR_STATE__=cache;};
      window.__GM_BUILDER_COLLECTOR_STATE__=cache;
    },{productId:row.product_id,itemId:row.item_id,vendorItemId:row.vendor_item_id,key:[row.product_id,row.item_id,row.vendor_item_id].filter(Boolean).join('_')});
    await page.evaluate(source);
    const end=Date.now()+45000;
    while(Date.now()<end){
      const data=await page.evaluate(()=>window.__GM_BUILDER_COLLECTOR_STATE__||{}).catch(()=>({}));
      const st=(()=>{try{return JSON.parse(data.GM_STATUS_LAST||'{}');}catch(_){return {};}})();
      if(/\b(?:403|404)\b|HTTP[_ -]?(?:403|404)|ACCESS_DENIED|FORBIDDEN|BLOCKED|PAGE_NOT_FOUND|NOT_FOUND/i.test([st.reason,st.stage,st.status,st.statusCode,st.httpStatus].join(' ')))return {blocked:true,error:st.reason||st.stage||'HTTP_403_OR_404'};
      const v=(()=>{try{return JSON.parse(data.GM_LAST_DETAIL_RESULT||'null');}catch(_){return null;}})();
      if(v&&v.final===true&&v.partial!==true&&v.ok===true&&v.item){
        const item=v.item;
        if(String(item.productId||item.product_id||'')!==String(row.product_id))return {error:'PID_MISMATCH'};
        const d=[item.detailBlocks,item.detailImages,item.detailTexts,item.detail_blocks,item.detail_images];
        if(!d.some(a=>Array.isArray(a)&&a.length))return {error:'NO_DETAIL_CONTENT'};
        return {item};
      }
      if(st.stage==='CODE_ERROR'||st.stage==='STOPPED')return {error:st.reason||st.stage};
      await wait(400);
    }
    return {error:'COLLECTOR_TIMEOUT'};
  }finally{await page.close().catch(()=>{});}
}
async function runJob(db,instance){
  let browser=null,last='';
  try{
    const puppeteer=require('puppeteer-core');
    browser=await puppeteer.launch({executablePath:browserPath(),headless:true,args:['--no-sandbox','--disable-dev-shm-usage'],timeout:20000});
    const source=fs.readFileSync(COLLECTOR_FILE,'utf8');
    while(!stopping && instance.seen<instance.max_items){
      const result=await db.query(sql,[instance.selected_codes,last,instance.skip_saved]);
      if(!result.rows.length)break;
      for(const row of result.rows){
        if(stopping||instance.seen>=instance.max_items)break;
        last=row.product_id;instance.last_pid=last;instance.seen++;
        let got;
        try{got=await collectOne(browser,row,source);}catch(e){got={error:String(e.message||e)};}
        if(got.blocked){instance.failed++;instance.error='403/404 자동 중지: '+got.error;stopping=true;break;}
        if(got.item){
          try{
            const outcome=await upsertProduct(db,Object.assign({},got.item,{source:'connector-detail-coupang'}));
            if(outcome&&outcome.ok){
              const check=await db.query('SELECT 1 FROM gm_cpkr_detail_content WHERE product_id=$1',[row.product_id]);
              if(check.rowCount)instance.saved++;else {instance.failed++;instance.error='JSON_NOT_SAVED_PID_'+last;}
            }else{instance.failed++;instance.error=clean(outcome?.reason||'UPSERT_FAILED');}
          }catch(e){instance.failed++;instance.error=clean(e.message||e);}
        }else{instance.failed++;instance.error=got.error||'COLLECTOR_FAILED';}
        instance.messages.push({pid:last,result:got.item?'saved_or_checked':got.error||'unknown'});
        if(instance.messages.length>20)instance.messages.shift();
        if(!stopping&&instance.seen<instance.max_items)await wait(15000);
      }
    }
    instance.state=stopping?'stopped':'completed';
  }catch(e){instance.state='error';instance.error=clean(e.message||e);}
  finally{instance.finished_at=new Date().toISOString();if(browser)await browser.close().catch(()=>{});stopping=false;}
}
module.exports=router;
