'use strict';
// GM_PRODUCT_GLOMART_CODE_V004_MULTI_HISTORY
const express=require('express');
const router=express.Router();
const {dbFrom,ok,fail}=require('./core');

const GM_CODE_RE=/^[A-Z]{2}-\d{2}-\d{3}-\d{4}-\d{4}-\d{4}$/i;
const APPLY_BATCH=250;

function norm(v){return String(v==null?'':v).normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();}
function raw(v){return String(v==null?'':v).trim();}
function splitCodes(v){return [...new Set(raw(v).split('|').map(x=>raw(x)).filter(Boolean))];}
function joinCodes(rows){return [...new Set((rows||[]).map(x=>raw(x.gm_code||x)).filter(Boolean))].sort().join('|');}
function addMulti(map,key,row){if(!key)return;let a=map.get(key);if(!a){a=[];map.set(key,a);}if(!a.some(x=>x.gm_code===row.gm_code))a.push(row);}
function splitKeyword(v){const s=raw(v);if(!s)return [];const out=[norm(s)];for(const p of s.split(/[,;\n\r|]+/g)){const n=norm(p);if(n)out.push(n);}return [...new Set(out.filter(Boolean))];}
function addHistory(map,key,code){if(!key||!code)return;let x=map.get(key);if(!x){x={total:0,codes:new Map()};map.set(key,x);}x.total++;x.codes.set(code,(x.codes.get(code)||0)+1);}
function historyWinner(map,key,minCount){const x=map.get(norm(key));if(!x||x.total<minCount||x.codes.size!==1)return null;const code=[...x.codes.keys()][0];return {code,count:x.total};}

async function loadMaps(db){
  const r=await db.query(`SELECT gm_code,cp_code,depth,sort_order,name_ko,keyword,keyword_seed,display_yn FROM gm_category WHERE COALESCE(gm_code,'')<>''`);
  const gm=new Map(),cp=new Map(),full=new Map(),token=new Map();
  for(const x of r.rows){
    const row={gm_code:raw(x.gm_code),cp_code:raw(x.cp_code),depth:Number(x.depth||0),sort_order:Number(x.sort_order||0),name_ko:raw(x.name_ko)};
    gm.set(norm(row.gm_code),row);
    if(row.cp_code)addMulti(cp,norm(row.cp_code),row);
    for(const source of [x.keyword,x.keyword_seed,x.name_ko]){
      const sourceNorm=norm(source);if(sourceNorm)addMulti(full,sourceNorm,row);
      for(const k of splitKeyword(source))addMulti(token,k,row);
    }
  }
  return {gm,cp,full,token,category_count:r.rows.length};
}

async function loadHistory(db,maps){
  const pair=new Map(),keyword=new Map(),category=new Map();
  const r=await db.query(`SELECT glomart_code,category_keyword,keyword FROM gm_product WHERE COALESCE(glomart_code,'')<>''`);
  let learned=0,skippedMulti=0,skippedUnknown=0;
  for(const p of r.rows){
    const codes=splitCodes(p.glomart_code);
    if(codes.length!==1){if(codes.length>1)skippedMulti++;continue;}
    const code=codes[0];
    if(!maps.gm.has(norm(code))){skippedUnknown++;continue;}
    const ck=norm(p.category_keyword),kw=norm(p.keyword);
    if(ck&&kw)addHistory(pair,ck+'\u0001'+kw,code);
    if(kw)addHistory(keyword,kw,code);
    if(ck)addHistory(category,ck,code);
    learned++;
  }
  return {pair,keyword,category,learned,skippedMulti,skippedUnknown};
}

function uniqueHit(map,value){const k=norm(value);if(!k)return null;const a=map.get(k)||[];if(a.length===1)return {row:a[0],ambiguous:false,count:1,key:k,rows:a};if(a.length>1)return {row:null,ambiguous:true,count:a.length,key:k,rows:a};return null;}
function categoryNames(rows){return (rows||[]).map(x=>x.name_ko).filter(Boolean).join(' | ');}

function classify(p,m,h){
  const directSources=[['cp_fix_code',p.cp_fix_code],['cp_selected_code',p.cp_selected_code],['category_code',p.category_code]];
  for(const [field,v] of directSources){const s=raw(v);if(!s||!GM_CODE_RE.test(s))continue;const hit=m.gm.get(norm(s));if(hit)return {gm_code:hit.gm_code,match_by:'DIRECT_GM_CODE',source_field:field,source_value:s,category_name:hit.name_ko,history_count:0,candidate_count:1};}

  const cpSources=[['mall_category',p.mall_category],['cp_fix_code',p.cp_fix_code],['cp_selected_code',p.cp_selected_code],['category_code',p.category_code]];
  let firstAmbiguous=null;
  for(const [field,v] of cpSources){
    const s=raw(v);if(!s||GM_CODE_RE.test(s))continue;const hit=uniqueHit(m.cp,s);
    if(hit&&hit.row)return {gm_code:hit.row.gm_code,match_by:field==='mall_category'?'MALL_CATEGORY_CP':'CP_CODE',source_field:field,source_value:s,category_name:hit.row.name_ko,history_count:0,candidate_count:1};
    if(hit&&hit.ambiguous&&!firstAmbiguous)firstAmbiguous={match_by:'AMBIGUOUS_CP_CODE',source_field:field,source_value:s,candidate_count:hit.count};
  }

  const ck=norm(p.category_keyword),kw=norm(p.keyword);
  if(ck&&kw){const z=historyWinner(h.pair,ck+'\u0001'+kw,2);if(z){const c=m.gm.get(norm(z.code));return {gm_code:z.code,match_by:'HISTORY_PAIR',source_field:'category_keyword+keyword',source_value:`${raw(p.category_keyword)} | ${raw(p.keyword)}`,category_name:c?c.name_ko:'',history_count:z.count,candidate_count:1};}}
  if(kw){const z=historyWinner(h.keyword,kw,2);if(z){const c=m.gm.get(norm(z.code));return {gm_code:z.code,match_by:'HISTORY_KEYWORD',source_field:'keyword',source_value:raw(p.keyword),category_name:c?c.name_ko:'',history_count:z.count,candidate_count:1};}}
  if(ck){const z=historyWinner(h.category,ck,5);if(z){const c=m.gm.get(norm(z.code));return {gm_code:z.code,match_by:'HISTORY_CATEGORY',source_field:'category_keyword',source_value:raw(p.category_keyword),category_name:c?c.name_ko:'',history_count:z.count,candidate_count:1};}}

  const kwSources=[['category_keyword',p.category_keyword],['keyword',p.keyword],['cp_selected_code',p.cp_selected_code],['cp_fix_code',p.cp_fix_code],['category_code',p.category_code]];
  for(const [field,v] of kwSources){
    const s=raw(v);if(!s||GM_CODE_RE.test(s))continue;const hit=uniqueHit(m.full,s);
    if(hit&&hit.row)return {gm_code:hit.row.gm_code,match_by:'KEYWORD_FULL_EXACT',source_field:field,source_value:s,category_name:hit.row.name_ko,history_count:0,candidate_count:1};
    if(hit&&hit.ambiguous){
      const code=joinCodes(hit.rows);
      if(code && hit.count<=8)return {gm_code:code,match_by:'KEYWORD_FULL_MULTI',source_field:field,source_value:s,category_name:categoryNames(hit.rows),history_count:0,candidate_count:hit.count};
      if(!firstAmbiguous)firstAmbiguous={match_by:'AMBIGUOUS_KEYWORD_FULL',source_field:field,source_value:s,candidate_count:hit.count};
    }
  }

  for(const [field,v] of kwSources){
    const s=raw(v);if(!s||GM_CODE_RE.test(s))continue;const hit=uniqueHit(m.token,s);
    if(hit&&hit.row)return {gm_code:hit.row.gm_code,match_by:'KEYWORD_TOKEN_UNIQUE',source_field:field,source_value:s,category_name:hit.row.name_ko,history_count:0,candidate_count:1};
    if(hit&&hit.ambiguous&&!firstAmbiguous)firstAmbiguous={match_by:'AMBIGUOUS_KEYWORD_TOKEN',source_field:field,source_value:s,candidate_count:hit.count};
  }
  if(firstAmbiguous)return {...firstAmbiguous,gm_code:'',category_name:'',history_count:0};
  return {gm_code:'',match_by:'NO_MATCH',source_field:'',source_value:'',category_name:'',history_count:0,candidate_count:0};
}

async function status(db){const r=await db.query(`SELECT COUNT(*)::int total,COUNT(*) FILTER(WHERE COALESCE(glomart_code,'')<>'')::int filled,COUNT(*) FILTER(WHERE COALESCE(glomart_code,'')='')::int empty,COUNT(*) FILTER(WHERE POSITION('|' IN COALESCE(glomart_code,''))>0)::int multi FROM gm_product`);return {...(r.rows[0]||{})};}
async function loadProducts(db,limit){const params=[];let lim='';if(limit){params.push(limit);lim=' LIMIT $1';}const r=await db.query(`SELECT product_uid,glomart_code,cp_selected_code,cp_fix_code,category_code,category_keyword,keyword,product_name,mall_code,mall_category FROM gm_product WHERE COALESCE(glomart_code,'')='' ORDER BY product_uid${lim}`,params);return r.rows;}
function summarize(items){const s={matched:0,matched_single:0,matched_multi:0,unmatched:0,ambiguous:0,by:{}};for(const x of items){s.by[x.match_by]=(s.by[x.match_by]||0)+1;if(x.gm_code){s.matched++;if(String(x.gm_code).includes('|'))s.matched_multi++;else s.matched_single++;}else{s.unmatched++;if(String(x.match_by).startsWith('AMBIGUOUS_'))s.ambiguous++;}}return s;}

router.get('/api/gm/builder/product-gm-code/status',async(req,res)=>{const db=dbFrom(req);if(!db)return fail(res,500,'DB_NOT_READY');try{ok(res,{action:'product-gm-code.status',...(await status(db))});}catch(e){fail(res,500,'PRODUCT_GM_CODE_STATUS_FAILED',{detail:String(e&&e.message||e)});}});
router.get('/api/gm/builder/product-gm-code/preview',async(req,res)=>{const db=dbFrom(req);if(!db)return fail(res,500,'DB_NOT_READY');try{const limit=Math.min(Math.max(Number(req.query.limit||300),1),2000);const maps=await loadMaps(db),history=await loadHistory(db,maps),products=await loadProducts(db,limit);const items=products.map(p=>({product_uid:p.product_uid,product_name:p.product_name,mall_code:p.mall_code,mall_category:p.mall_category,cp_selected_code:p.cp_selected_code,cp_fix_code:p.cp_fix_code,category_code:p.category_code,category_keyword:p.category_keyword,keyword:p.keyword,...classify(p,maps,history)}));ok(res,{action:'product-gm-code.preview',limit,category_count:maps.category_count,history:{learned:history.learned,skipped_multi:history.skippedMulti,skipped_unknown:history.skippedUnknown},summary:summarize(items),items});}catch(e){fail(res,500,'PRODUCT_GM_CODE_PREVIEW_FAILED',{detail:String(e&&e.message||e)});}});
router.post('/api/gm/builder/product-gm-code/apply',async(req,res)=>{const db=dbFrom(req);if(!db)return fail(res,500,'DB_NOT_READY');if(String(req.query.confirm||req.body&&req.body.confirm||'').toUpperCase()!=='YES')return fail(res,400,'CONFIRM_REQUIRED',{hint:'confirm=YES'});let client=null,release=false;try{const maps=await loadMaps(db),history=await loadHistory(db,maps),products=await loadProducts(db,0);const matched=[],classified=[];for(const p of products){const c=classify(p,maps,history);classified.push(c);if(c.gm_code)matched.push({product_uid:p.product_uid,...c});}client=typeof db.connect==='function'?await db.connect():db;release=client!==db&&typeof client.release==='function';await client.query('BEGIN');let updated=0;for(let i=0;i<matched.length;i+=APPLY_BATCH){const batch=matched.slice(i,i+APPLY_BATCH),vals=[],rows=[];let n=1;for(const x of batch){rows.push(`($${n++}::text,$${n++}::text)`);vals.push(x.product_uid,x.gm_code);}const q=await client.query(`UPDATE gm_product p SET glomart_code=v.gm_code,updated_at=COALESCE(p.updated_at,NOW()) FROM (VALUES ${rows.join(',')}) AS v(product_uid,gm_code) WHERE p.product_uid=v.product_uid AND COALESCE(p.glomart_code,'')=''`,vals);updated+=q.rowCount||0;}await client.query('COMMIT');const summary=summarize(classified);console.log(`[GM_PRODUCT_GLOMART_CODE_V004] apply scanned=${products.length} matched=${summary.matched} single=${summary.matched_single} multi=${summary.matched_multi} ambiguous=${summary.ambiguous} unmatched=${summary.unmatched} updated=${updated} by=${JSON.stringify(summary.by)}`);ok(res,{action:'product-gm-code.apply',category_count:maps.category_count,history:{learned:history.learned},scanned:products.length,updated,summary});}catch(e){try{if(client)await client.query('ROLLBACK');}catch(_){}fail(res,500,'PRODUCT_GM_CODE_APPLY_FAILED',{detail:String(e&&e.message||e)});}finally{if(release)client.release();}});

function csvCell(v){if(v===null||v===undefined)return '';const x=String(v);return /[",\r\n]/.test(x)?'"'+x.replace(/"/g,'""')+'"':x;}
router.get('/api/gm/builder/product-gm-code/unmatched.csv',async(req,res)=>{const db=dbFrom(req);if(!db)return fail(res,500,'DB_NOT_READY');try{const maps=await loadMaps(db),history=await loadHistory(db,maps);const cols=['product_uid','mall_code','product_name','cp_selected_code','cp_fix_code','mall_category','category_code','category_keyword','keyword','match_by','source_field','source_value','candidate_count','history_count','resolved_gm_code','category_name'];res.setHeader('Content-Type','text/csv; charset=utf-8');res.setHeader('Content-Disposition',`attachment; filename="gm_product_glomart_code_unmatched_${Date.now()}.csv"`);res.setHeader('Cache-Control','no-store, no-cache, must-revalidate');res.setHeader('X-Content-Type-Options','nosniff');const writeChunk=async chunk=>{if(res.write(chunk))return;if(res.destroyed)throw new Error('client disconnected');await new Promise(resolve=>res.once('drain',resolve));};await writeChunk('\ufeff'+cols.join(',')+'\n');const pageSize=1000;let lastUid='',sent=0;while(true){const r=await db.query(`SELECT product_uid,glomart_code,cp_selected_code,cp_fix_code,mall_category,category_code,category_keyword,keyword,product_name,mall_code FROM gm_product WHERE COALESCE(glomart_code,'')='' AND product_uid>$1 ORDER BY product_uid ASC LIMIT $2`,[lastUid,pageSize]);if(!r.rows.length)break;for(const row of r.rows){const c=classify(row,maps,history);if(c.gm_code)continue;const out={...row,...c,resolved_gm_code:c.gm_code};await writeChunk(cols.map(k=>csvCell(out[k])).join(',')+'\n');sent++;}lastUid=String(r.rows[r.rows.length-1].product_uid||'');if(r.rows.length<pageSize)break;}console.log(`[GM_PRODUCT_GLOMART_CODE_V004] unmatched export sent=${sent}`);res.end();}catch(e){if(!res.headersSent)return fail(res,500,'PRODUCT_GM_CODE_UNMATCHED_EXPORT_FAILED',{detail:String(e&&e.message||e)});try{res.end();}catch(_){}}});

module.exports=router;
