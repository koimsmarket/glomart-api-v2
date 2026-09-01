'use strict';
/* GM_CATEGORY_BATCH_SPECIAL_V019
 * Special category product collection module.
 * V019: image-vector generation is fully detached to background/image-vector.
 */
const express=require('express');
const router=express.Router();
const ADMIN_IDS=new Set(['derzon','derzon1287','msoon']);
const control={mode:'STOPPED',batch_date:'',updated_at:null,updated_by:'',command:''};
const leases=new Map();
let poolRef=null;
const S=v=>String(v==null?'':v).trim();
function pool(req){const p=req.app&&req.app.locals&&req.app.locals.pool;if(!p)throw new Error('DB_POOL_NOT_AVAILABLE');poolRef=p;return p;}
function auth(req,res){const m=S((req.body&&req.body.member_id)||(req.query&&req.query.member_id));if(!ADMIN_IDS.has(m)){res.status(403).json({ok:false,error:'ADMIN_ID_REQUIRED'});return null;}return m;}
function log(tag,o){console.log('[GM_CATEGORY_BATCH_SPECIAL_V019 '+tag+']',JSON.stringify(Object.assign({ts:new Date().toISOString()},o||{})));}
function splitKeywords(v){return [...new Set(S(v).split('/').map(x=>x.trim()).filter(Boolean))];}
function batchDate(v){const x=S(v);return /^\d{4}-\d{2}-\d{2}$/.test(x)?x:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
function prioritySql(){return `CASE WHEN gm_code LIKE 'FD-%' THEN 1 WHEN gm_code LIKE 'HS-%' THEN 2 ELSE 3 END`;}

router.get('/api/special/category-batch/control',(req,res)=>{const m=auth(req,res);if(!m)return;res.json({ok:true,version:'GM_CATEGORY_BATCH_SPECIAL_V019',control});});
router.post('/api/special/category-batch/command',(req,res)=>{const m=auth(req,res);if(!m)return;pool(req);const cmd=S(req.body&&req.body.command);if(cmd==='#카테고리 검색#')control.mode='RUN';else if(cmd==='#카테고리 일시정지#')control.mode='PAUSE';else if(cmd==='#카테고리 중지#')control.mode='STOPPED';else return res.status(400).json({ok:false,error:'UNKNOWN_COMMAND'});if(cmd==='#카테고리 검색#')control.batch_date=batchDate(req.body&&req.body.batch_date||control.batch_date);control.updated_at=new Date().toISOString();control.updated_by=m;control.command=cmd;log('COMMAND',{member:m,mode:control.mode,batch_date:control.batch_date});res.json({ok:true,control});});

async function release(deviceId,complete){const l=leases.get(deviceId);if(!l)return null;try{if(complete)await l.client.query('UPDATE gm_category SET created_at=NOW(),updated_at=NOW() WHERE category_id=$1',[l.category_id]);await l.client.query('SELECT pg_advisory_unlock($1::bigint)',[l.category_id]);}finally{l.client.release();leases.delete(deviceId);}return l.category_id;}
router.post('/api/special/category-batch/next',async(req,res)=>{const m=auth(req,res);if(!m)return;const p=pool(req),deviceId=S(req.body&&req.body.device_id),bd=batchDate(req.body&&req.body.batch_date||control.batch_date);if(!deviceId)return res.status(400).json({ok:false,error:'device_id required'});if(control.mode!=='RUN')return res.json({ok:true,state:control.mode,category:null,batch_date:bd});if(leases.has(deviceId)){const l=leases.get(deviceId),q=await l.client.query("SELECT category_id,gm_code,name_ko,leaf_yn,created_at FROM gm_category WHERE category_id=$1 AND UPPER(COALESCE(leaf_yn,''))='Y'",[l.category_id]);const r=q.rows[0];return res.json({ok:true,state:'LEASED',batch_date:bd,category:r?Object.assign(r,{keywords:splitKeywords(r.name_ko)}):null});}
 const q=await p.query(`SELECT category_id,gm_code,name_ko,leaf_yn,depth,sort_order,created_at FROM gm_category WHERE COALESCE(name_ko,'')<>'' AND UPPER(COALESCE(leaf_yn,''))='Y' AND (created_at IS NULL OR created_at < $1::date) ORDER BY ${prioritySql()} ASC, depth ASC, sort_order ASC, category_id ASC LIMIT 120`,[bd]);
 for(const row of q.rows){const c=await p.connect();let keep=false;try{const lk=await c.query('SELECT pg_try_advisory_lock($1::bigint) ok',[row.category_id]);if(lk.rows[0]&&lk.rows[0].ok){const chk=await c.query("SELECT category_id,gm_code,name_ko,leaf_yn,created_at FROM gm_category WHERE category_id=$1 AND UPPER(COALESCE(leaf_yn,''))='Y' AND (created_at IS NULL OR created_at < $2::date)",[row.category_id,bd]);if(chk.rows[0]){leases.set(deviceId,{category_id:row.category_id,client:c,member_id:m,leased_at:Date.now(),batch_date:bd});keep=true;log('LEASE',{device_id:deviceId,category_id:row.category_id,gm_code:row.gm_code,name_ko:row.name_ko,leaf_yn:row.leaf_yn,batch_date:bd});return res.json({ok:true,state:'LEASED',batch_date:bd,category:Object.assign(chk.rows[0],{keywords:splitKeywords(chk.rows[0].name_ko)})});}await c.query('SELECT pg_advisory_unlock($1::bigint)',[row.category_id]);}}finally{if(!keep)c.release();}}
 res.json({ok:true,state:'EMPTY',category:null,batch_date:bd});
});
router.post('/api/special/category-batch/complete',async(req,res)=>{const m=auth(req,res);if(!m)return;pool(req);const d=S(req.body&&req.body.device_id),id=Number(req.body&&req.body.category_id||0),l=leases.get(d);if(!l||Number(l.category_id)!==id)return res.status(409).json({ok:false,error:'LEASE_MISMATCH'});await release(d,true);log('CATEGORY_DONE',{device_id:d,category_id:id});res.json({ok:true,category_id:id});});
router.post('/api/special/category-batch/release',async(req,res)=>{const m=auth(req,res);if(!m)return;pool(req);const d=S(req.body&&req.body.device_id),id=await release(d,false);res.json({ok:true,category_id:id});});

router.get('/api/special/category-batch/search-state',async(req,res)=>{const m=auth(req,res);if(!m)return;const p=pool(req),kw=S(req.query.keyword),st=S(req.query.started_at),rid=S(req.query.request_id);if(!st||(!kw&&!rid))return res.status(400).json({ok:false,error:'started_at and keyword/request_id required'});let q;if(rid){q=await p.query(`SELECT COUNT(*)::int total,COUNT(*) FILTER(WHERE status='pending')::int pending,COUNT(*) FILTER(WHERE status='processing')::int processing,COUNT(*) FILTER(WHERE status='done')::int done,COUNT(*) FILTER(WHERE status='failed')::int failed,COUNT(DISTINCT mall_code)::int mall_count,ARRAY_REMOVE(ARRAY_AGG(DISTINCT keyword),NULL) keywords,MAX(created_at) last_created_at FROM gm_product_upsert_queue WHERE request_id LIKE $1 AND created_at >= $2::timestamptz`,[rid+'%',st]);}else{q=await p.query(`SELECT COUNT(*)::int total,COUNT(*) FILTER(WHERE status='pending')::int pending,COUNT(*) FILTER(WHERE status='processing')::int processing,COUNT(*) FILTER(WHERE status='done')::int done,COUNT(*) FILTER(WHERE status='failed')::int failed,COUNT(DISTINCT mall_code)::int mall_count,ARRAY_REMOVE(ARRAY_AGG(DISTINCT keyword),NULL) keywords,MAX(created_at) last_created_at FROM gm_product_upsert_queue WHERE keyword=$1 AND created_at >= $2::timestamptz`,[kw,st]);}const x=q.rows[0]||{},last=x.last_created_at?new Date(x.last_created_at).getTime():0,quiet=last?Math.max(0,(Date.now()-last)/1000):0,settled=Number(x.total||0)>0&&Number(x.pending||0)===0&&Number(x.processing||0)===0&&quiet>=5;res.json({ok:true,total:+x.total||0,pending:+x.pending||0,processing:+x.processing||0,done:+x.done||0,failed:+x.failed||0,mall_count:+x.mall_count||0,keywords:x.keywords||[],quiet_sec:Math.round(quiet*10)/10,settled});});

// V019: category SPECIAL no longer owns image-vector queues or workers.
// Keep the old status URL as a harmless compatibility response for older controllers.
router.get('/api/special/category-batch/vector-status',(req,res)=>{
 const m=auth(req,res);if(!m)return;
 res.json({ok:true,detached:true,managed_by:'background/image-vector'});
});

module.exports=router;
