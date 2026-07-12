'use strict';
const express = require('express');
const crypto = require('crypto');
const multer = require('multer');
const sharp = require('sharp');
const r2 = require('../services/r2');
const router = express.Router();

const VERSION = 'GM_SMARTFIT_SERVER_V021_R2_IMAGE_TRANSFER';
console.log('[GM_SMARTFIT_ROUTE] loaded', VERSION);

function db(req){ return req.app.locals.db || req.app.locals.pool; }
function s(v){ return v === undefined || v === null ? '' : String(v).replace(/[\u00A0\u200B-\u200D\uFEFF]/g,' ').replace(/\s+/g,' ').trim(); }
function n(v,d=0){ const x=Number(String(v??'').replace(/,/g,'')); return Number.isFinite(x)?x:d; }
function i(v,d=0){ const x=Math.round(n(v,d)); return Number.isFinite(x)?x:d; }
function ok(res,data={}){ res.json({ ok:true, version:VERSION, ...data }); }
function fail(res,status,error,extra={}){ res.status(status).json({ ok:false, version:VERSION, error, ...extra }); }
function pad2(x){ return String(x).padStart(2,'0'); }
function nowText(){ const d=new Date(Date.now()+9*60*60*1000); return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth()+1)}-${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`; }
function yn(v,def='F'){
  const x=s(v).toUpperCase();
  if(['T','Y','YES','TRUE','1','PUBLIC'].includes(x)) return 'T';
  if(['F','N','NO','FALSE','0','PRIVATE','HIDDEN'].includes(x)) return 'F';
  return def;
}
function visibilityOf(v, def='private'){
  const x=s(v || def).toLowerCase();
  if(['draft','private','public'].includes(x)) return x;
  if(['t','y','yes','true','1'].includes(x)) return 'public';
  if(['f','n','no','false','0'].includes(x)) return 'private';
  return def;
}
function publicVisibility(v){ return visibilityOf(v,'private') === 'public' ? 'T' : 'F'; }
function normLang(v){
  const x=s(v).toLowerCase();
  const map={ kr:'ko', jp:'ja', cn:'zh', vn:'vi', 'zh-cn':'zh', 'zh_tw':'tw', 'zh-tw':'tw' };
  return map[x] || x || 'ko';
}
const LANGS = new Set(['ko','en','zh','vi','ja','tw','th','uz','ne','km','id','tl','mn','my','kk','si','ru','bn','ur','lo','hi','tr','fa','es','fr','ot']);
function safeLang(v){ const x=normLang(v); return LANGS.has(x) ? x : 'ot'; }
function nullableId(v){
  const raw=s(v);
  if(!raw || raw==='0' || raw.toLowerCase()==='null' || raw.toLowerCase()==='undefined') return null;
  const x=i(raw,0);
  return x>0 ? x : null;
}
function boolFlag(v, def='F'){
  const x=s(v).toUpperCase();
  if(['T','Y','YES','TRUE','1','ON'].includes(x)) return 'T';
  if(['F','N','NO','FALSE','0','OFF'].includes(x)) return 'F';
  return def;
}
async function assertSpaceOwnerIfSet(client, member, spaceId){
  if(!spaceId) return null;
  const r=await client.query("SELECT * FROM gm_smartfit_space WHERE space_id=$1 AND is_active=$2 AND COALESCE(is_deleted,'F')<>'T' LIMIT 1",[spaceId,'T']);
  const row=r.rows[0];
  if(!row) throw new Error('space not found');
  if(!(await isOwnerOrAdmin(client, member, row.owner_member_id || row.creator_member_id))) throw new Error('space permission denied');
  return row;
}

const ALLOWED_HOSTS = [
  'youtube.com','www.youtube.com','m.youtube.com','youtu.be',
  'vimeo.com','www.vimeo.com',
  'instagram.com','www.instagram.com',
  'facebook.com','www.facebook.com','m.facebook.com',
  'x.com','www.x.com','twitter.com','www.twitter.com',
  'tiktok.com','www.tiktok.com','m.tiktok.com',
  'pinterest.com','www.pinterest.com',
  'threads.net','www.threads.net',
  'blog.naver.com','m.blog.naver.com',
  'tistory.com','www.tistory.com',
  'brunch.co.kr','www.brunch.co.kr',
  'cafe.daum.net','m.cafe.daum.net',
  'band.us','www.band.us',
  'google.com','www.google.com','maps.google.com','www.google.com',
  'map.naver.com','m.map.naver.com',
  'map.kakao.com','place.map.kakao.com',
];
const BLOCKED_EXT = /\.(apk|exe|msi|dmg|pkg|bat|cmd|scr|js|vbs|ps1|zip|rar|7z|torrent)(?:$|[?#])/i;
function allowedByTld(host){ return /\.go\.kr$|\.ac\.kr$|\.edu$|\.gov$/.test(host); }
function normalizeLink(raw){
  let v=s(raw);
  if(!v) return '';
  if(/[\s<>"'`]/.test(v)) throw new Error('링크에 사용할 수 없는 문자가 있습니다.');
  if(!/^https?:\/\//i.test(v)) v='https://' + v;
  let u;
  try{ u=new URL(v); }catch(_){ throw new Error('올바른 링크 형식이 아닙니다.'); }
  const proto=u.protocol.toLowerCase();
  if(proto !== 'http:' && proto !== 'https:') throw new Error('http/https 링크만 등록할 수 있습니다.');
  if(BLOCKED_EXT.test(u.pathname)) throw new Error('다운로드/실행 파일 링크는 등록할 수 없습니다.');
  const host=u.hostname.toLowerCase().replace(/^www\./,'www.');
  const bare=host.replace(/^www\./,'');
  const okHost = ALLOWED_HOSTS.includes(host) || ALLOWED_HOSTS.includes(bare) || allowedByTld(host) || /\.tistory\.com$/.test(host);
  if(!okHost) throw new Error('허용된 사이트 링크만 등록할 수 있습니다.');
  return u.toString();
}
function normalizeLinks(body){
  const out={};
  for(let k=1;k<=6;k++){
    const key='link0'+k;
    out[key]=normalizeLink(body[key] || body['link'+k] || '');
  }
  return out;
}
function validateDescription(text){
  const v=s(text);
  if(!v) return '';
  if(/https?:\/\//i.test(v) || /www\./i.test(v) || /[a-z0-9.-]+\.(com|net|org|kr|co|io|shop|store|site|link|me)(?:\/|\b)/i.test(v)) throw new Error('소개글에는 인터넷 주소(URL)를 입력할 수 없습니다.');
  if(/<\s*\/?\s*[a-z][^>]*>/i.test(v)) throw new Error('소개글에는 HTML 태그를 입력할 수 없습니다.');
  if(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(v)) throw new Error('소개글에는 이메일 주소를 입력할 수 없습니다.');
  if(/(?:\+?\d{1,3}[-.\s]?)?(?:0\d{1,2}|\d{2,4})[-.\s]?\d{3,4}[-.\s]?\d{4}/.test(v)) throw new Error('소개글에는 연락처를 입력할 수 없습니다.');
  if(/(구매|주문|판매|공구|공동구매|카톡|오픈채팅|문의|입금|계좌)/.test(v)) throw new Error('소개글에는 광고/구매 유도 문구를 입력할 수 없습니다.');
  return v.replace(/<[^>]*>/g,'');
}
function imageCount(v){ return Math.max(0, Math.min(r2.CURRENT_UI_IMAGE_LIMIT, i(v,0))); }
function displayAuthor(row){
  row=row||{};
  return { member_id:s(row.owner_member_id || row.creator_member_id || row.member_id), nickname:s(row.author_nickname || row.member_nickname || '') };
}
async function getMember(pool, memberId){
  const id=s(memberId); if(!id) return null;
  try{ return (await pool.query('SELECT member_id, member_name, member_name_en, member_nickname, member_grade, member_grade_code FROM gm_member WHERE member_id=$1 LIMIT 1',[id])).rows[0] || null; }
  catch(_){ return null; }
}
async function memberNickname(pool, memberId){
  const m=await getMember(pool, memberId);
  return s(m && (m.member_nickname || m.member_name_en || m.member_name || m.member_id));
}
function isAdmin(row){
  const code=s(row && (row.member_grade_code || row.grade_code)).toUpperCase();
  const grade=s(row && (row.member_grade || row.grade)).toUpperCase();
  return ['9','09','ADMIN','MANAGER'].includes(code) || /관리자|ADMIN|MANAGER/.test(grade);
}
async function isOwnerOrAdmin(pool, memberId, ownerId){
  if(s(memberId) && s(memberId)===s(ownerId)) return true;
  return isAdmin(await getMember(pool, memberId));
}
function coalesceTitle(row){ return s(row.template_title_source || row.template_title_ko || row.template_title_gm_lang || row.template_title_en || row.template_title || row.title); }
function coalesceSpaceTitle(row){ return s(row.space_title_source || row.space_title_ko || row.space_title_gm_lang || row.space_title_en || row.space_title || row.title); }
function addImageUrls(row, type){
  const count=imageCount(row.image_count);
  const id=type==='space' ? i(row.space_id,0) : i(row.template_id,0);
  let images=[];
  try{ if(id>0) images=r2.imageFiles(type,id,count); }catch(_){ images=[]; }
  return Object.assign({}, row, { image_count:count, image_files:images });
}

/* GM_SMARTFIT_R2_UPLOAD_V001
 * 업로드 규칙은 services/r2.js 상단의 GM_R2_STORAGE_RULE_V001 주석을 기준으로 한다.
 * - 내부 알고리즘/파일 슬롯: 최대 10장
 * - 현재 UI/API 업로드 제한: 최대 5장
 * - 파일명/경로: ID당 10장까지 영구 예약
 * - DB: URL 미저장, 업로드 성공 후 image_count만 갱신
 */
const smartfitImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { files: r2.CURRENT_UI_IMAGE_LIMIT, fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req,file,cb)=>{
    const okType=/^image\/(jpeg|png|webp)$/i.test(String(file.mimetype||''));
    cb(okType ? null : new Error('JPG, PNG, WEBP 이미지만 업로드할 수 있습니다.'), okType);
  }
});

async function assertImageOwner(pool, type, id, member){
  if(type==='space'){
    const row=(await pool.query("SELECT space_id, owner_member_id, creator_member_id, image_count FROM gm_smartfit_space WHERE space_id=$1 AND is_active='T' AND COALESCE(is_deleted,'F')<>'T' LIMIT 1",[id])).rows[0];
    if(!row) throw new Error('space not found');
    if(!(await isOwnerOrAdmin(pool,member,row.owner_member_id || row.creator_member_id))) throw new Error('permission denied');
    return row;
  }
  const row=(await pool.query("SELECT template_id, creator_member_id, image_count FROM gm_smartfit_template WHERE template_id=$1 AND is_active='T' AND COALESCE(is_deleted,'F')<>'T' LIMIT 1",[id])).rows[0];
  if(!row) throw new Error('template not found');
  if(!(await isOwnerOrAdmin(pool,member,row.creator_member_id))) throw new Error('permission denied');
  return row;
}

async function toWebpUnder(buffer, options){
  const width=options.width;
  const height=options.height;
  const maxBytes=options.maxBytes;
  const qualities=options.qualities || [82,76,70,64,58,52,46,40];
  let last=null;
  for(const quality of qualities){
    let pipe=sharp(buffer,{ failOn:'warning' }).rotate().resize({ width, height, fit:'inside', withoutEnlargement:true });
    last=await pipe.webp({ quality, effort:5 }).toBuffer();
    if(last.length<=maxBytes) return last;
  }
  if(last && last.length<=maxBytes) return last;
  throw new Error(`이미지 최적화 후에도 ${Math.round(maxBytes/1024)}KB를 초과합니다.`);
}

router.get('/api/gm/smartfit/r2/health', async (req,res)=>{
  try{ ok(res,{ r2:await r2.health() }); }
  catch(e){ fail(res,503,'r2 unavailable',{ detail:String(e.message||e) }); }
});

router.post('/api/gm/smartfit/image/upload', smartfitImageUpload.array('images', r2.CURRENT_UI_IMAGE_LIMIT), async (req,res)=>{
  const pool=db(req);
  const startedAt=Date.now();
  try{
    console.log('[GM_SMARTFIT_IMAGE_UPLOAD_START_V021]', {
      resource_type:s(req.body.resource_type || req.body.type || req.body.mode),
      resource_id:s(req.body.resource_id || req.body.id || req.body.space_id || req.body.template_id),
      member_id:s(req.body.member_id || req.body.memberId || ''),
      file_count:Array.isArray(req.files) ? req.files.length : 0,
      manifest:s(req.body.manifest || '').slice(0,500)
    });
    const type=r2.normalizeType(req.body.resource_type || req.body.type || req.body.mode);
    const id=r2.normalizeId(req.body.resource_id || req.body.id || req.body.space_id || req.body.template_id);
    const member=s(req.body.member_id || req.body.memberId || '');
    if(!member) return fail(res,401,'login required');
    const ownerRow=await assertImageOwner(pool,type,id,member);
    const oldCount=imageCount(ownerRow.image_count);
    const files=Array.isArray(req.files) ? req.files : [];

    let manifest;
    if(s(req.body.manifest)){
      try{ manifest=JSON.parse(req.body.manifest); }
      catch(_){ return fail(res,400,'invalid image manifest'); }
    }else{
      // 이전 호출부 호환: 전달된 새 파일 전체를 최종 01~N으로 저장한다.
      manifest=files.map((_file,fileIndex)=>({ type:'new', file_index:fileIndex }));
    }
    if(!Array.isArray(manifest)) return fail(res,400,'image manifest required');
    if(manifest.length>r2.CURRENT_UI_IMAGE_LIMIT) return fail(res,400,`현재는 최대 ${r2.CURRENT_UI_IMAGE_LIMIT}장까지 등록할 수 있습니다.`);

    const converted=[];
    for(let idx=0; idx<files.length; idx++){
      const original=await toWebpUnder(files[idx].buffer,{ width:1600, height:1600, maxBytes:300*1024 });
      const small=await toWebpUnder(files[idx].buffer,{ width:480, height:480, maxBytes:100*1024, qualities:[78,70,62,54,46,40] });
      converted.push({ image:original, small, original_name:s(files[idx].originalname) });
    }

    const requestId=crypto.randomUUID().replace(/-/g,'');
    const result=await r2.applyImagePlan({ type, id, oldCount, plan:manifest, newFiles:converted, requestId });

    // R2 최종 상태가 완성된 뒤에만 DB image_count를 변경한다.
    if(type==='space') await pool.query('UPDATE gm_smartfit_space SET image_count=$1, updated_at=CURRENT_TIMESTAMP WHERE space_id=$2',[result.image_count,id]);
    else await pool.query('UPDATE gm_smartfit_template SET image_count=$1, updated_at=CURRENT_TIMESTAMP WHERE template_id=$2',[result.image_count,id]);

    console.log('[GM_SMARTFIT_IMAGE_UPLOAD_DONE_V021]', { resource_type:type, resource_id:id, image_count:result.image_count, ms:Date.now()-startedAt });
    ok(res,{ resource_type:type, resource_id:id, image_count:result.image_count, images:result.images, operations:result.operations, reserved_limit:r2.RESERVED_IMAGES_PER_ID, current_limit:r2.CURRENT_UI_IMAGE_LIMIT });
  }catch(e){
    console.error('[GM_SMARTFIT_IMAGE_UPLOAD_FAIL_V021]', {
      message:String(e && e.message || e),
      stack:String(e && e.stack || '').slice(0,1500),
      ms:Date.now()-startedAt
    });
    fail(res,400,'image upload failed',{ detail:String(e.message||e), restore_error:e && e.restore_error ? e.restore_error : undefined });
  }
});

router.post('/api/gm/smartfit/image/delete', async (req,res)=>{
  const pool=db(req);
  try{
    const b=req.body||{};
    const type=r2.normalizeType(b.resource_type || b.type || b.mode);
    const id=r2.normalizeId(b.resource_id || b.id || b.space_id || b.template_id);
    const member=s(b.member_id || b.memberId || '');
    if(!member) return fail(res,401,'login required');
    await assertImageOwner(pool,type,id,member);
    const keys=[];
    for(let imageNo=1; imageNo<=r2.RESERVED_IMAGES_PER_ID; imageNo++) keys.push(r2.keyFor(type,id,imageNo,'image'),r2.keyFor(type,id,imageNo,'small'));
    await r2.deleteKeys(keys);
    if(type==='space') await pool.query('UPDATE gm_smartfit_space SET image_count=0, updated_at=CURRENT_TIMESTAMP WHERE space_id=$1',[id]);
    else await pool.query('UPDATE gm_smartfit_template SET image_count=0, updated_at=CURRENT_TIMESTAMP WHERE template_id=$1',[id]);
    ok(res,{ resource_type:type, resource_id:id, image_count:0, deleted:true });
  }catch(e){ fail(res,400,'image delete failed',{ detail:String(e.message||e) }); }
});

router.get('/api/gm/smartfit/health', (req,res)=>ok(res,{ service:'smartfit', route:req.path }));

router.get('/api/gm/smartfit/category/list', async (req,res)=>{
  try{
    const pool=db(req);
    const r=await pool.query(`SELECT category_code, parent_code, depth, leaf_yn, display_order, category_name_ko, category_name_en, category_name_gm_lang, is_active
      FROM gm_smartfit_category WHERE is_active='T' ORDER BY depth, display_order, category_code`);
    ok(res,{ items:r.rows, count:r.rowCount });
  }catch(e){ fail(res,500,'category list failed',{ detail:String(e.message||e) }); }
});
router.get('/api/gm/smartfit/category/search', async (req,res)=>{
  try{
    const pool=db(req); const q=s(req.query.q || req.query.keyword || '');
    if(!q) return ok(res,{ items:[], count:0 });
    const p='%'+q+'%';
    const r=await pool.query(`SELECT * FROM gm_smartfit_category WHERE is_active='T' AND (category_name_ko ILIKE $1 OR category_name_en ILIKE $1 OR category_name_gm_lang ILIKE $1 OR search_ko ILIKE $1 OR search_source ILIKE $1) ORDER BY depth, display_order LIMIT 100`, [p]);
    ok(res,{ items:r.rows, count:r.rowCount });
  }catch(e){ fail(res,500,'category search failed',{ detail:String(e.message||e) }); }
});

router.get('/api/gm/smartfit/space/list', async (req,res)=>{
  try{
    const pool=db(req); const member=s(req.query.member_id || req.query.memberId || '');
    const mine=s(req.query.mine || '')==='1' || s(req.query.scope)==='mine' || !!member;
    const category=s(req.query.category_no || req.query.category_code || req.query.category || '');
    const limit=Math.min(100, Math.max(1, i(req.query.limit,80)));
    const params=[]; const where=[`sp.is_active='T'`, `COALESCE(sp.is_deleted,'F')<>'T'`];
    if(category){ params.push(category); where.push(`sp.category_no=$${params.length}`); }
    if(mine && member){ params.push(member); where.push(`sp.owner_member_id=$${params.length}`); }
    else { where.push(`sp.visibility='public'`); where.push(`COALESCE(sp.search_visible,'T')='T'`); }
    params.push(limit); const lim='$'+params.length;
    const r=await pool.query(`SELECT sp.*, m.member_name, m.member_nickname FROM gm_smartfit_space sp LEFT JOIN gm_member m ON m.member_id=sp.owner_member_id WHERE ${where.join(' AND ')} ORDER BY sp.updated_at DESC LIMIT ${lim}`, params);
    ok(res,{ items:r.rows.map(x=>addImageUrls(Object.assign({},x,{ title:coalesceSpaceTitle(x), author:displayAuthor(x) }),'space')), count:r.rowCount });
  }catch(e){ fail(res,500,'space list failed',{ detail:String(e.message||e) }); }
});

router.post('/api/gm/smartfit/space/save', async (req,res)=>{
  console.log('[GM_SMARTFIT_SPACE_SAVE_REQUEST_V017]', { member_id:s((req.body||{}).member_id || (req.body||{}).memberId), mode:s((req.body||{}).mode), title:s((req.body||{}).space_title_source || (req.body||{}).space_title || (req.body||{}).space_name) });
  const pool=db(req); const client=await pool.connect();
  try{
    const b=req.body||{}; const member=s(b.member_id || b.memberId || b.creator_member_id || b.owner_member_id);
    if(!member) return fail(res,401,'login required');
    const spaceId=i(b.space_id || b.spaceId,0);
    const sourceLang=safeLang(b.source_lang || b.gm_lang || 'ko');
    const title=s(b.space_title_source || b.space_title || b.spaceTitle || b.space_name || b.spaceName || '');
    if(!title) return fail(res,400,'space title required');
    const nick=s(b.author_nickname || b.authorNickname || '') || await memberNickname(client, member);
    const desc=validateDescription(b.space_description || b.description || b.space_desc || '');
    const links=normalizeLinks(b);
    const visibility=visibilityOf(b.visibility || b.is_public || 'private','private');
    await client.query('BEGIN');
    let saved;
    if(spaceId){
      const old=(await client.query('SELECT * FROM gm_smartfit_space WHERE space_id=$1 FOR UPDATE',[spaceId])).rows[0];
      if(!old) throw new Error('space not found');
      if(!(await isOwnerOrAdmin(client, member, old.owner_member_id || old.creator_member_id))) throw new Error('permission denied');
      const r=await client.query(`UPDATE gm_smartfit_space SET source_lang=$1, space_title_source=$2, space_title_ko=$3, author_nickname=$4, category_no=$5, image_count=$6,
        link01=$7, link02=$8, link03=$9, link04=$10, link05=$11, link06=$12, description=$13, visibility=$14, search_visible=$15,
        is_deleted='F', deleted_at=NULL, deleted_by=NULL, updated_at=CURRENT_TIMESTAMP WHERE space_id=$16 RETURNING *`,
        [sourceLang,title,s(b.title_ko || b.space_title_ko || ''),nick,s(b.category_no || b.category_code || 'ENTIRE'),imageCount(b.image_count),links.link01,links.link02,links.link03,links.link04,links.link05,links.link06,desc,visibility,publicVisibility(visibility),spaceId]);
      saved=r.rows[0];
    }else{
      const r=await client.query(`INSERT INTO gm_smartfit_space (creator_member_id, owner_member_id, source_lang, space_title_source, space_title_ko, author_nickname, category_no, image_count,
        link01, link02, link03, link04, link05, link06, description, visibility, search_visible)
        VALUES ($1,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
        [member,sourceLang,title,s(b.title_ko || b.space_title_ko || ''),nick,s(b.category_no || b.category_code || 'ENTIRE'),imageCount(b.image_count),links.link01,links.link02,links.link03,links.link04,links.link05,links.link06,desc,visibility,publicVisibility(visibility)]);
      saved=r.rows[0];
    }
    await client.query('COMMIT');
    ok(res,{ space:addImageUrls(Object.assign({},saved,{ title:coalesceSpaceTitle(saved), author:displayAuthor(saved) }),'space') });
  }catch(e){ try{await client.query('ROLLBACK');}catch(_){} fail(res,400,'space save failed',{ detail:String(e.message||e) }); }
  finally{ client.release(); }
});

router.get('/api/gm/smartfit/template/list', async (req,res)=>{
  try{
    const pool=db(req);
    const q=s(req.query.q || req.query.keyword || '');
    const category=s(req.query.category_no || req.query.category_code || req.query.category || '');
    const member=s(req.query.member_id || req.query.memberId || '');
    const mine=s(req.query.mine || '')==='1' || s(req.query.scope)==='mine' || !!member;
    const root=s(req.query.root || '')==='1';
    const limit=Math.min(100, Math.max(1, i(req.query.limit,80)));
    const params=[]; const where=[`t.is_active='T'`, `COALESCE(t.is_deleted,'F')<>'T'`];
    if(q){ params.push('%'+q+'%'); where.push(`(t.template_title_source ILIKE $${params.length} OR t.template_title_ko ILIKE $${params.length} OR t.search_source ILIKE $${params.length} OR t.search_ko ILIKE $${params.length})`); }
    if(category){ params.push(category); where.push(`t.category_no=$${params.length}`); }
    if(root) where.push(`t.space_id IS NULL`);
    if(mine && member){ params.push(member); where.push(`t.creator_member_id=$${params.length}`); }
    else { where.push(`t.visibility='public'`); where.push(`COALESCE(t.search_visible,'T')='T'`); }
    params.push(limit); const lim='$'+params.length;
    const r=await pool.query(`SELECT t.*, sp.space_title_source, sp.space_title_ko, sp.author_nickname AS space_author_nickname, m.member_name, m.member_nickname FROM gm_smartfit_template t
      LEFT JOIN gm_smartfit_space sp ON sp.space_id=t.space_id
      LEFT JOIN gm_member m ON m.member_id=t.creator_member_id
      WHERE ${where.join(' AND ')} ORDER BY t.ranking_score DESC, t.updated_at DESC LIMIT ${lim}`, params);
    ok(res,{ items:r.rows.map(x=>addImageUrls(Object.assign({},x,{ title:coalesceTitle(x), author:displayAuthor(x) }),'template')), count:r.rowCount, limit });
  }catch(e){ fail(res,500,'template list failed',{ detail:String(e.message||e) }); }
});

router.post('/api/gm/smartfit/template/save', async (req,res)=>{
  console.log('[GM_SMARTFIT_TEMPLATE_SAVE_REQUEST_V017]', { member_id:s((req.body||{}).member_id || (req.body||{}).memberId), space_id:s((req.body||{}).space_id || ''), title:s((req.body||{}).template_title_source || (req.body||{}).template_title || (req.body||{}).title) });
  const pool=db(req); const client=await pool.connect();
  try{
    const b=req.body||{}; const member=s(b.member_id || b.memberId || b.creator_member_id || b.creatorMemberId);
    if(!member) return fail(res,401,'login required');
    const templateId=i(b.template_id || b.templateId,0);
    const sourceLang=safeLang(b.source_lang || b.gm_lang || 'ko');
    const title=s(b.template_title_source || b.template_title || b.templateTitle || b.title || '');
    if(!title) return fail(res,400,'template title required');
    const desc=validateDescription(b.template_description || b.description || b.template_desc || '');
    const links=normalizeLinks(b);
    const visibility=visibilityOf(b.visibility || b.is_public || 'private','private');
    const spaceIdValue=nullableId(b.space_id || b.spaceId);
    const searchSource=s(b.search_source || b.search || '');
    const keywordCount=searchSource ? searchSource.split(',').map(x=>s(x)).filter(Boolean).slice(0,10).length : 0;
    await client.query('BEGIN');
    await assertSpaceOwnerIfSet(client, member, spaceIdValue);
    let saved;
    if(templateId){
      const old=(await client.query('SELECT * FROM gm_smartfit_template WHERE template_id=$1 FOR UPDATE',[templateId])).rows[0];
      if(!old) throw new Error('template not found');
      if(!(await isOwnerOrAdmin(client, member, old.creator_member_id))) throw new Error('permission denied');
      const r=await client.query(`UPDATE gm_smartfit_template SET space_id=$1, source_lang=$2, template_title_source=$3, template_title_ko=$4, category_no=$5, image_count=$6,
        link01=$7, link02=$8, link03=$9, link04=$10, link05=$11, link06=$12, description=$13, search_source=$14, search_ko=$15, keyword_count=$16, content_json=$17::jsonb,
        visibility=$18, search_visible=$19, is_deleted='F', deleted_at=NULL, deleted_by=NULL, updated_at=CURRENT_TIMESTAMP WHERE template_id=$20 RETURNING *`,
        [spaceIdValue,sourceLang,title,s(b.title_ko || b.template_title_ko || ''),s(b.category_no || b.category_code || 'ENTIRE'),imageCount(b.image_count),links.link01,links.link02,links.link03,links.link04,links.link05,links.link06,desc,searchSource,s(b.search_ko || ''),keywordCount,JSON.stringify(b.content_json || b.contentJson || b.content || {}),visibility,publicVisibility(visibility),templateId]);
      saved=r.rows[0];
    }else{
      const r=await client.query(`INSERT INTO gm_smartfit_template (space_id, creator_member_id, source_lang, template_title_source, template_title_ko, category_no, image_count,
        link01, link02, link03, link04, link05, link06, description, search_source, search_ko, keyword_count, content_json, visibility, search_visible)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,$19,$20) RETURNING *`,
        [spaceIdValue,member,sourceLang,title,s(b.title_ko || b.template_title_ko || ''),s(b.category_no || b.category_code || 'ENTIRE'),imageCount(b.image_count),links.link01,links.link02,links.link03,links.link04,links.link05,links.link06,desc,searchSource,s(b.search_ko || ''),keywordCount,JSON.stringify(b.content_json || b.contentJson || b.content || {}),visibility,publicVisibility(visibility)]);
      saved=r.rows[0];
    }
    if(Array.isArray(b.items)){
      await client.query("UPDATE gm_smartfit_item SET is_deleted='T', deleted_at=CURRENT_TIMESTAMP, deleted_by=$1, updated_at=CURRENT_TIMESTAMP WHERE template_id=$2", [member, saved.template_id]);
      let order=0;
      for(const it of b.items){
        const productUid=s(it.product_uid || it.productUid); if(!productUid) continue;
        await client.query(`INSERT INTO gm_smartfit_item (template_id,item_role,mall_code,product_uid,qty,sort_no,is_deleted,deleted_at,deleted_by)
          VALUES ($1,$2,$3,$4,$5,$6,'F',NULL,NULL)
          ON CONFLICT (template_id,mall_code,product_uid) DO UPDATE SET item_role=EXCLUDED.item_role, qty=EXCLUDED.qty, sort_no=EXCLUDED.sort_no, is_deleted='F', deleted_at=NULL, deleted_by=NULL, is_active='T', updated_at=CURRENT_TIMESTAMP`,
          [saved.template_id,s(it.item_role || it.role || 'ETC'),s(it.mall_code || it.mallCode || ''),productUid,Math.max(1,i(it.qty,1)),i(it.sort_no || it.sort_order, ++order)]);
      }
    }
    await client.query('COMMIT');
    ok(res,{ template:addImageUrls(Object.assign({},saved,{ title:coalesceTitle(saved), author:displayAuthor(saved) }),'template') });
  }catch(e){ try{await client.query('ROLLBACK');}catch(_){} fail(res,400,'template save failed',{ detail:String(e.message||e) }); }
  finally{ client.release(); }
});

router.get('/api/gm/smartfit/template/:template_id', async (req,res)=>{
  try{
    const pool=db(req); const id=i(req.params.template_id,0);
    const r=await pool.query('SELECT * FROM gm_smartfit_template WHERE template_id=$1 AND is_active=$2 AND COALESCE(is_deleted,\'F\')<>\'T\'', [id,'T']);
    const template=r.rows[0]; if(!template) return fail(res,404,'template not found');
    const items=await pool.query("SELECT * FROM gm_smartfit_item WHERE template_id=$1 AND is_active=$2 AND COALESCE(is_deleted,'F')<>'T' ORDER BY sort_no,item_id", [id,'T']);
    ok(res,{ template:addImageUrls(Object.assign({},template,{ title:coalesceTitle(template), author:displayAuthor(template) }),'template'), items:items.rows, media:[] });
  }catch(e){ fail(res,500,'template detail failed',{ detail:String(e.message||e) }); }
});


router.get('/api/gm/smartfit/space/detail', async (req,res)=>{
  try{
    const pool=db(req); const id=i(req.query.space_id || req.query.spaceId,0);
    if(!id) return fail(res,400,'space_id required');
    const r=await pool.query("SELECT * FROM gm_smartfit_space WHERE space_id=$1 AND is_active='T' AND COALESCE(is_deleted,'F')<>'T' LIMIT 1",[id]);
    const space=r.rows[0]; if(!space) return fail(res,404,'space not found');
    ok(res,{ space:addImageUrls(Object.assign({},space,{ title:coalesceSpaceTitle(space), author:displayAuthor(space) }),'space') });
  }catch(e){ fail(res,500,'space detail failed',{ detail:String(e.message||e) }); }
});

router.get('/api/gm/smartfit/template/detail', async (req,res)=>{
  try{
    const pool=db(req); const id=i(req.query.template_id || req.query.templateId,0);
    if(!id) return fail(res,400,'template_id required');
    const r=await pool.query("SELECT * FROM gm_smartfit_template WHERE template_id=$1 AND is_active='T' AND COALESCE(is_deleted,'F')<>'T' LIMIT 1",[id]);
    const template=r.rows[0]; if(!template) return fail(res,404,'template not found');
    const items=await pool.query("SELECT * FROM gm_smartfit_item WHERE template_id=$1 AND is_active='T' AND COALESCE(is_deleted,'F')<>'T' ORDER BY sort_no,item_id",[id]);
    ok(res,{ template:addImageUrls(Object.assign({},template,{ title:coalesceTitle(template), author:displayAuthor(template) }),'template'), items:items.rows });
  }catch(e){ fail(res,500,'template detail failed',{ detail:String(e.message||e) }); }
});

router.post('/api/gm/smartfit/space/favorite', async (req,res)=>{
  try{
    const pool=db(req); const b=req.body||{}; const member=s(b.member_id || b.memberId || ''); const spaceId=i(b.space_id || b.spaceId,0);
    if(!member) return fail(res,401,'login required'); if(!spaceId) return fail(res,400,'space_id required');
    const old=(await pool.query('SELECT * FROM gm_smartfit_space WHERE space_id=$1 LIMIT 1',[spaceId])).rows[0];
    if(!old) return fail(res,404,'space not found');
    if(!(await isOwnerOrAdmin(pool, member, old.owner_member_id || old.creator_member_id))) return fail(res,403,'permission denied');
    const flag=boolFlag(b.favorite_yn || b.favorite || b.on, old.favorite_yn==='T'?'F':'T');
    const r=await pool.query("UPDATE gm_smartfit_space SET favorite_yn=$1, updated_at=CURRENT_TIMESTAMP WHERE space_id=$2 RETURNING *",[flag,spaceId]);
    ok(res,{ space:addImageUrls(Object.assign({},r.rows[0],{ title:coalesceSpaceTitle(r.rows[0]), author:displayAuthor(r.rows[0]) }),'space') });
  }catch(e){ fail(res,400,'space favorite failed',{ detail:String(e.message||e) }); }
});

router.post('/api/gm/smartfit/template/favorite', async (req,res)=>{
  try{
    const pool=db(req); const b=req.body||{}; const member=s(b.member_id || b.memberId || ''); const templateId=i(b.template_id || b.templateId,0);
    if(!member) return fail(res,401,'login required'); if(!templateId) return fail(res,400,'template_id required');
    const old=(await pool.query('SELECT * FROM gm_smartfit_template WHERE template_id=$1 LIMIT 1',[templateId])).rows[0];
    if(!old) return fail(res,404,'template not found');
    if(!(await isOwnerOrAdmin(pool, member, old.creator_member_id))) return fail(res,403,'permission denied');
    const flag=boolFlag(b.favorite_yn || b.favorite || b.on, old.favorite_yn==='T'?'F':'T');
    const r=await pool.query("UPDATE gm_smartfit_template SET favorite_yn=$1, updated_at=CURRENT_TIMESTAMP WHERE template_id=$2 RETURNING *",[flag,templateId]);
    ok(res,{ template:addImageUrls(Object.assign({},r.rows[0],{ title:coalesceTitle(r.rows[0]), author:displayAuthor(r.rows[0]) }),'template') });
  }catch(e){ fail(res,400,'template favorite failed',{ detail:String(e.message||e) }); }
});

router.post('/api/gm/smartfit/template/move', async (req,res)=>{
  const pool=db(req); const client=await pool.connect();
  try{
    const b=req.body||{}; const member=s(b.member_id || b.memberId || '');
    if(!member) return fail(res,401,'login required');
    const ids=Array.isArray(b.template_ids || b.templateIds) ? (b.template_ids || b.templateIds).map(x=>i(x,0)).filter(Boolean) : [i(b.template_id || b.templateId,0)].filter(Boolean);
    if(!ids.length) return fail(res,400,'template_id required');
    const spaceId=nullableId(b.space_id || b.spaceId);
    await client.query('BEGIN');
    await assertSpaceOwnerIfSet(client, member, spaceId);
    const templates=await client.query('SELECT template_id, creator_member_id, image_count FROM gm_smartfit_template WHERE template_id = ANY($1::bigint[]) FOR UPDATE',[ids]);
    if(templates.rowCount !== ids.length) throw new Error('template not found');
    for(const t of templates.rows){ if(!(await isOwnerOrAdmin(client, member, t.creator_member_id))) throw new Error('permission denied'); }
    const r=await client.query('UPDATE gm_smartfit_template SET space_id=$1, updated_at=CURRENT_TIMESTAMP WHERE template_id = ANY($2::bigint[]) RETURNING *',[spaceId,ids]);
    await client.query('COMMIT');
    ok(res,{ items:r.rows.map(x=>addImageUrls(Object.assign({},x,{ title:coalesceTitle(x), author:displayAuthor(x) }),'template')), count:r.rowCount, space_id:spaceId });
  }catch(e){ try{await client.query('ROLLBACK');}catch(_){} fail(res,400,'template move failed',{ detail:String(e.message||e) }); }
  finally{ client.release(); }
});

router.post('/api/gm/smartfit/space/trash', async (req,res)=>{
  const pool=db(req); const client=await pool.connect();
  try{
    const b=req.body||{}; const member=s(b.member_id || b.memberId || ''); const spaceId=i(b.space_id || b.spaceId,0);
    if(!member) return fail(res,401,'login required'); if(!spaceId) return fail(res,400,'space_id required');
    await client.query('BEGIN');
    const old=(await client.query('SELECT * FROM gm_smartfit_space WHERE space_id=$1 FOR UPDATE',[spaceId])).rows[0];
    if(!old) throw new Error('space not found');
    if(!(await isOwnerOrAdmin(client, member, old.owner_member_id || old.creator_member_id))) throw new Error('permission denied');
    const trash=boolFlag(b.trash_yn || b.trash || b.on,'T');
    const r=await client.query("UPDATE gm_smartfit_space SET is_deleted=$1, deleted_at=CASE WHEN $1='T' THEN CURRENT_TIMESTAMP ELSE NULL END, deleted_by=CASE WHEN $1='T' THEN $2 ELSE NULL END, updated_at=CURRENT_TIMESTAMP WHERE space_id=$3 RETURNING *",[trash,member,spaceId]);
    if(trash==='T') await client.query('UPDATE gm_smartfit_template SET space_id=NULL, updated_at=CURRENT_TIMESTAMP WHERE space_id=$1',[spaceId]);
    await client.query('COMMIT');
    ok(res,{ space:r.rows[0], detached_templates:trash==='T' });
  }catch(e){ try{await client.query('ROLLBACK');}catch(_){} fail(res,400,'space trash failed',{ detail:String(e.message||e) }); }
  finally{ client.release(); }
});

router.post('/api/gm/smartfit/template/trash', async (req,res)=>{
  try{
    const pool=db(req); const b=req.body||{}; const member=s(b.member_id || b.memberId || ''); const templateId=i(b.template_id || b.templateId,0);
    if(!member) return fail(res,401,'login required'); if(!templateId) return fail(res,400,'template_id required');
    const old=(await pool.query('SELECT * FROM gm_smartfit_template WHERE template_id=$1 LIMIT 1',[templateId])).rows[0];
    if(!old) return fail(res,404,'template not found');
    if(!(await isOwnerOrAdmin(pool, member, old.creator_member_id))) return fail(res,403,'permission denied');
    const trash=boolFlag(b.trash_yn || b.trash || b.on,'T');
    const r=await pool.query("UPDATE gm_smartfit_template SET is_deleted=$1, deleted_at=CASE WHEN $1='T' THEN CURRENT_TIMESTAMP ELSE NULL END, deleted_by=CASE WHEN $1='T' THEN $2 ELSE NULL END, updated_at=CURRENT_TIMESTAMP WHERE template_id=$3 RETURNING *",[trash,member,templateId]);
    ok(res,{ template:r.rows[0] });
  }catch(e){ fail(res,400,'template trash failed',{ detail:String(e.message||e) }); }
});

router.post('/api/gm/smartfit/space/delete', async (req,res)=>{
  const pool=db(req); const client=await pool.connect();
  try{
    const b=req.body||{}; const member=s(b.member_id || b.memberId || ''); const spaceId=i(b.space_id || b.spaceId,0);
    if(!member) return fail(res,401,'login required'); if(!spaceId) return fail(res,400,'space_id required');
    await client.query('BEGIN');
    const old=(await client.query('SELECT * FROM gm_smartfit_space WHERE space_id=$1 FOR UPDATE',[spaceId])).rows[0];
    if(!old) throw new Error('space not found');
    if(!(await isOwnerOrAdmin(client, member, old.owner_member_id || old.creator_member_id))) throw new Error('permission denied');
    await client.query('UPDATE gm_smartfit_template SET space_id=NULL, updated_at=CURRENT_TIMESTAMP WHERE space_id=$1',[spaceId]);
    await client.query('DELETE FROM gm_smartfit_space WHERE space_id=$1',[spaceId]);
    await client.query('COMMIT');
    ok(res,{ deleted:true, space_id:spaceId, detached_templates:true });
  }catch(e){ try{await client.query('ROLLBACK');}catch(_){} fail(res,400,'space delete failed',{ detail:String(e.message||e) }); }
  finally{ client.release(); }
});

router.post('/api/gm/smartfit/template/delete', async (req,res)=>{
  const pool=db(req); const client=await pool.connect();
  try{
    const b=req.body||{}; const member=s(b.member_id || b.memberId || ''); const templateId=i(b.template_id || b.templateId,0);
    if(!member) return fail(res,401,'login required'); if(!templateId) return fail(res,400,'template_id required');
    await client.query('BEGIN');
    const old=(await client.query('SELECT * FROM gm_smartfit_template WHERE template_id=$1 FOR UPDATE',[templateId])).rows[0];
    if(!old) throw new Error('template not found');
    if(!(await isOwnerOrAdmin(client, member, old.creator_member_id))) throw new Error('permission denied');
    await client.query('DELETE FROM gm_smartfit_item WHERE template_id=$1',[templateId]);
    await client.query('DELETE FROM gm_smartfit_collection WHERE template_id=$1',[templateId]);
    await client.query('DELETE FROM gm_smartfit_template WHERE template_id=$1',[templateId]);
    await client.query('COMMIT');
    ok(res,{ deleted:true, template_id:templateId });
  }catch(e){ try{await client.query('ROLLBACK');}catch(_){} fail(res,400,'template delete failed',{ detail:String(e.message||e) }); }
  finally{ client.release(); }
});

router.get('/api/gm/smartfit/product/search', async (req,res)=>{
  try{
    const pool=db(req);
    const q=s(req.query.q || req.query.keyword || '');
    const category=s(req.query.category_code || req.query.category || '');
    const mall=s(req.query.mall_code || req.query.mall || '');
    const limit=Math.min(80, Math.max(1, i(req.query.limit, 30)));
    const offset=Math.max(0, i(req.query.offset, 0));
    const params=[]; const where=[];
    if(q){ params.push('%'+q+'%'); const p='$'+params.length; where.push(`(product_name ILIKE ${p} OR mall_product_name ILIKE ${p} OR option_name ILIKE ${p} OR option_value ILIKE ${p} OR product_uid ILIKE ${p} OR pi_ii_vi ILIKE ${p} OR category_keyword ILIKE ${p})`); }
    if(category){ params.push(category); where.push(`(glomart_code=$${params.length} OR gm_category=$${params.length})`); }
    if(mall){ params.push(mall); where.push(`mall_code=$${params.length}`); }
    params.push(limit); const lim='$'+params.length; params.push(offset); const off='$'+params.length;
    const r=await pool.query(`SELECT product_uid, mall_code, pi_ii_vi, glomart_code, gm_category, product_name, mall_product_name, option_name, option_value, mall_sale_price, final_supply_price, delivery_type, delivery_fee, delivery_eta_text, product_url, thumb_origin_url, thumb_file_name, soldout_yn, hit_count, updated_at FROM gm_product ${where.length?'WHERE '+where.join(' AND '):''} ORDER BY COALESCE(updated_at, created_at) DESC NULLS LAST LIMIT ${lim} OFFSET ${off}`, params);
    ok(res,{ items:r.rows, count:r.rowCount, limit, offset });
  }catch(e){ fail(res,500,'product search failed',{ detail:String(e.message||e) }); }
});

router.post('/api/gm/smartfit/build-cart', async (req,res)=>{
  try{
    const pool=db(req); const member=s(req.body?.member_id || req.body?.memberId || '');
    const templateIds=(Array.isArray(req.body?.template_ids)?req.body.template_ids:Array.isArray(req.body?.templateIds)?req.body.templateIds:[req.body?.template_id || req.body?.templateId]).map(x=>i(x,0)).filter(Boolean);
    if(!templateIds.length) return fail(res,400,'template_ids required');
    const r=await pool.query(`SELECT t.template_id, t.creator_member_id, t.category_no, t.template_title_source, t.template_title_ko, i.item_id, i.item_role, i.mall_code, i.product_uid, i.qty, i.sort_no
      FROM gm_smartfit_template t JOIN gm_smartfit_item i ON i.template_id=t.template_id AND i.is_active='T' AND COALESCE(i.is_deleted,'F')<>'T'
      WHERE t.template_id = ANY($1::bigint[]) AND t.is_active='T' AND COALESCE(t.is_deleted,'F')<>'T'
      ORDER BY array_position($1::bigint[], t.template_id), i.sort_no, i.item_id`, [templateIds]);
    const batchId='SFB_'+Date.now()+'_'+Math.random().toString(16).slice(2,8);
    const items=r.rows.map(row=>({ batch_id:batchId, template_id:row.template_id, creator_member_id:row.creator_member_id, category_no:row.category_no, template_title:s(row.template_title_source || row.template_title_ko), item_id:row.item_id, item_role:row.item_role, mall_code:row.mall_code, product_uid:row.product_uid, original_qty:i(row.qty,1), selected_qty:i(row.qty,1), is_selected:true, sort_no:row.sort_no }));
    ok(res,{ batch_id:batchId, template_ids:templateIds, items, count:items.length, member_id:member, note:'candidate payload only; basket/order tables are not modified' });
  }catch(e){ fail(res,500,'build cart failed',{ detail:String(e.message||e) }); }
});

module.exports = router;
