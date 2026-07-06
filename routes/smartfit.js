'use strict';
const express = require('express');
const router = express.Router();

const VERSION = 'GM_SMARTFIT_SERVER_V004_V003_SCHEMA';
console.log('[GM_SMARTFIT_ROUTE] loaded ' + VERSION);

const STAT_TYPES = new Set(['view','visit','collection','use','reuse','build_cart','item_add','review','rating']);
const LANGS = new Set(['ko','en','zh','vi','ja','tw','th','uz','ne','km','id','tl','mn','my','kk','si','ru','bn','ur','lo','hi','tr','fa','es','fr','ot']);

function db(req){ return req.app.locals.db || req.app.locals.pool; }
function s(v){ return v === undefined || v === null ? '' : String(v).replace(/[\u00A0\u200B-\u200D\uFEFF]/g,' ').replace(/\s+/g,' ').trim(); }
function n(v, d=0){ const x = Number(String(v ?? '').replace(/,/g,'')); return Number.isFinite(x) ? x : d; }
function i(v, d=0){ const x = Math.round(n(v, d)); return Number.isFinite(x) ? x : d; }
function ok(res, data={}){ res.json({ ok:true, version:VERSION, ...data }); }
function fail(res, status, error, extra={}){ res.status(status).json({ ok:false, version:VERSION, error, ...extra }); }
function pad2(x){ return String(x).padStart(2,'0'); }
function qident(name){ return '"' + String(name).replace(/"/g,'""') + '"'; }
function yn(v, def='F'){
  const x=s(v).toUpperCase();
  if(['T','Y','YES','TRUE','1','PUBLIC'].includes(x)) return 'T';
  if(['F','N','NO','FALSE','0','PRIVATE','DRAFT','HIDDEN'].includes(x)) return 'F';
  return def;
}
function normLang(x){ x=s(x).toLowerCase(); if(!x) return 'ko'; if(x==='kr') return 'ko'; if(x==='jp') return 'ja'; if(x==='cn') return 'zh'; if(x==='vn') return 'vi'; if(x==='zh-cn') return 'zh'; if(x==='zh-tw'||x==='zh_tw') return 'tw'; return LANGS.has(x) ? x : 'ot'; }
function limit5(v){ return Math.max(0, Math.min(5, i(v,0))); }
function publicOf(b){ return yn(b.is_public ?? b.public_yn ?? b.publicYn ?? b.visibility, 'F'); }
function keywordCount(v){ return s(v).split(',').map(s).filter(Boolean).slice(0,10).length; }
function kstParts(date = new Date()){
  const d = new Date(date.getTime() + 9*60*60*1000);
  return { y:d.getUTCFullYear(), m:d.getUTCMonth()+1, d:d.getUTCDate(), ym:`${d.getUTCFullYear()}_${pad2(d.getUTCMonth()+1)}`, day:pad2(d.getUTCDate()) };
}
function safeYm(ym){ if(!/^\d{4}_\d{2}$/.test(String(ym||''))) throw new Error('invalid ym'); return String(ym); }
function monthlyTemplateTable(ym){ return 'gm_smartfit_template_' + safeYm(ym); }
function monthlyCategoryTable(ym){ return 'gm_smartfit_category_' + safeYm(ym); }
function dayColumns(){ return Array.from({length:31}, (_,k)=>`day_${pad2(k+1)} NUMERIC(18,2) NOT NULL DEFAULT 0`).join(',\n    '); }

function searchWhere(prefix='t'){
  const p = prefix ? prefix + '.' : '';
  return `(${p}template_title_source ILIKE $1 OR ${p}template_title_ko ILIKE $1 OR ${p}description ILIKE $1 OR ${p}search_source ILIKE $1 OR ${p}search_ko ILIKE $1)`;
}
function spaceSearchWhere(prefix='sp'){
  const p = prefix ? prefix + '.' : '';
  return `(${p}space_title_source ILIKE $1 OR ${p}space_title_ko ILIKE $1 OR ${p}description ILIKE $1)`;
}
function displayAuthor(row){
  row=row||{};
  return { member_id:s(row.owner_member_id || row.creator_member_id || row.member_id), nickname:s(row.author_nickname || row.member_nickname || ''), real_name:s(row.member_name || '') };
}
function isAdminMember(row){
  const code = s(row && (row.member_grade_code || row.grade_code)).toUpperCase();
  const grade = s(row && (row.member_grade || row.grade)).toUpperCase();
  return code === '9' || code === '09' || code === 'ADMIN' || code === 'MANAGER' || /관리자|ADMIN|MANAGER/.test(grade);
}
async function getMember(pool, memberId){
  const id=s(memberId); if(!id) return null;
  try{ const r=await pool.query('SELECT member_id, member_name, member_nickname, member_grade, member_grade_code FROM gm_member WHERE member_id=$1 LIMIT 1',[id]); return r.rows[0] || null; }
  catch(e){ return null; }
}
async function isOwnerOrAdmin(pool, memberId, ownerId){
  if(s(memberId) && s(memberId)===s(ownerId)) return true;
  const mem=await getMember(pool, memberId);
  return isAdminMember(mem);
}
async function memberNickname(pool, memberId){
  const m=await getMember(pool, memberId);
  return s(m && (m.member_nickname || m.member_name || m.member_id));
}

function r2Base(){ return s(process.env.R2_PUBLIC_BASE || process.env.GM_R2_PUBLIC_BASE || process.env.SMARTFIT_R2_PUBLIC_BASE || '').replace(/\/$/,''); }
function folderStart(no){ const v=Math.max(1, i(no,1)); return Math.floor((v-1)/200)*200 + 1; }
function folderName(no){ return 'A' + String(folderStart(no)).padStart(8,'0'); }
function localIndex(no){ const v=Math.max(1, i(no,1)); return ((v-1)%200)+1; }
function imageFile(type, no, idx){ const prefix = type === 'space' ? 'I' : 'T'; const suffix = 'ABCDE'.charAt(Math.max(0, Math.min(4, idx-1))); return prefix + String(localIndex(no)).padStart(4,'0') + suffix + '.webp'; }
function imagePath(type, no, kind, idx){ return `${type}/${folderName(no)}/${kind}/${imageFile(type,no,idx)}`; }
function imageUrls(type, no, count){
  count=limit5(count); const base=r2Base(); const arr=[];
  for(let k=1;k<=count;k++){
    const image=imagePath(type,no,'image',k); const small=imagePath(type,no,'small',k);
    arr.push({ index:k, image_path:image, small_path:small, image_url:base?base+'/'+image:'', small_url:base?base+'/'+small:'' });
  }
  return arr;
}
function withImageMeta(type, row){
  const id = type==='space' ? row.space_id : row.template_id;
  const images=imageUrls(type, id, row.image_count);
  return Object.assign({}, row, { images, image_url: images[0] ? images[0].small_url : '', image_path: images[0] ? images[0].small_path : '' });
}

async function ensureMonthlyTable(pool, tableName, keyCol){
  await pool.query(`CREATE TABLE IF NOT EXISTS ${qident(tableName)} (
    ${keyCol} VARCHAR(80) NOT NULL,
    stat_type VARCHAR(40) NOT NULL,
    lang_code VARCHAR(10) NOT NULL DEFAULT 'ko',
    creator_member_id VARCHAR(80) NOT NULL DEFAULT '',
    ${dayColumns()},
    total NUMERIC(18,2) NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (${keyCol}, stat_type, lang_code, creator_member_id)
  )`);
}
async function addMonthly(pool, tableName, keyCol, keyVal, statType, langCode, creatorMemberId, amount, day){
  await ensureMonthlyTable(pool, tableName, keyCol);
  const dayCol = 'day_' + pad2(day);
  const lang = LANGS.has(s(langCode)) ? s(langCode) : 'ot';
  const sql = `INSERT INTO ${qident(tableName)} (${keyCol}, stat_type, lang_code, creator_member_id, ${dayCol}, total)
    VALUES ($1,$2,$3,$4,$5,$5)
    ON CONFLICT (${keyCol}, stat_type, lang_code, creator_member_id)
    DO UPDATE SET ${dayCol}=${qident(tableName)}.${dayCol}+EXCLUDED.${dayCol}, total=${qident(tableName)}.total+EXCLUDED.total, updated_at=CURRENT_TIMESTAMP`;
  await pool.query(sql, [s(keyVal), statType, lang, s(creatorMemberId), n(amount,1)]);
}
async function refreshTemplateItemCount(client, templateId){
  await client.query(`UPDATE gm_smartfit_template SET item_count=(SELECT COUNT(*)::int FROM gm_smartfit_item WHERE template_id=$1 AND is_active='T' AND COALESCE(is_deleted,'F')<>'T'), updated_at=CURRENT_TIMESTAMP WHERE template_id=$1`, [templateId]);
}
async function incrementCounters(pool, templateId, statType, amount){
  if(!templateId) return;
  const a=n(amount,1);
  const map={view:'view_count',visit:'visit_count',collection:'collection_count',use:'use_count',reuse:'reuse_count',build_cart:'build_cart_count',item_add:'item_add_count',review:'review_count',rating:'rating_sum'};
  const col=map[statType]; if(!col) return;
  await pool.query(`UPDATE gm_smartfit_template SET ${col}=${col}+$1, updated_at=CURRENT_TIMESTAMP WHERE template_id=$2`, [a, templateId]);
  if(statType==='rating') await pool.query('UPDATE gm_smartfit_template SET rating_avg=CASE WHEN review_count>0 THEN rating_sum/review_count ELSE 0 END WHERE template_id=$1', [templateId]);
}

router.get('/api/gm/smartfit/health', (req,res)=> ok(res, { service:'smartfit', route:req.path, image_storage:'R2_RULE_BASED', r2_public_base: r2Base() ? 'configured' : 'not_configured' }));

router.get('/api/gm/smartfit/category/list', async (req,res)=>{
  try{
    const pool=db(req); const parent=s(req.query.parent_category_no || req.query.parent_code || req.query.parent || '');
    const params=[]; const where=[`is_active='T'`];
    if(parent){ params.push(parent); where.push(`parent_category_no=$${params.length}`); }
    const r=await pool.query(`SELECT * FROM gm_smartfit_category WHERE ${where.join(' AND ')} ORDER BY depth, sort_no, category_no`, params);
    ok(res,{ items:r.rows, count:r.rowCount });
  }catch(e){ fail(res,500,'category list failed',{ detail:String(e.message||e) }); }
});
router.get('/api/gm/smartfit/category/search', async (req,res)=>{
  try{
    const pool=db(req); const q=s(req.query.q || req.query.keyword || '');
    if(!q) return ok(res,{ items:[], count:0 });
    const r=await pool.query(`SELECT * FROM gm_smartfit_category WHERE is_active='T' AND (category_no ILIKE $1 OR category_name ILIKE $1) ORDER BY depth, sort_no LIMIT 100`, ['%'+q+'%']);
    ok(res,{ items:r.rows, count:r.rowCount });
  }catch(e){ fail(res,500,'category search failed',{ detail:String(e.message||e) }); }
});

router.get('/api/gm/smartfit/space/list', async (req,res)=>{
  try{
    const pool=db(req); const member=s(req.query.member_id || req.query.memberId || ''); const publicOnly=yn(req.query.public_only || req.query.publicOnly,'F')==='T'; const mine=s(req.query.mine || '')==='1' || s(req.query.scope)==='mine' || (!!member && !publicOnly);
    const q=s(req.query.q || req.query.keyword || ''); const category=s(req.query.category_no || req.query.category_code || req.query.category || '');
    const limit=Math.min(200, Math.max(1, i(req.query.limit, 80))); const offset=Math.max(0, i(req.query.offset,0));
    const params=[]; const where=[`sp.is_active='T'`, `COALESCE(sp.is_deleted,'F')<>'T'`];
    if(q){ params.push('%'+q+'%'); where.push(spaceSearchWhere('sp').replace(/\$1/g, '$'+params.length)); }
    if(category){ params.push(category); where.push(`sp.category_no=$${params.length}`); }
    if(mine && member){ params.push(member); where.push(`sp.owner_member_id=$${params.length}`); }
    else { where.push(`sp.is_public='T'`); where.push(`COALESCE(sp.search_visible,'F')='T'`); }
    params.push(limit); const lim='$'+params.length; params.push(offset); const off='$'+params.length;
    const r=await pool.query(`SELECT sp.*, m.member_name, m.member_nickname,
        (SELECT COUNT(*)::int FROM gm_smartfit_template t WHERE t.space_id=sp.space_id AND t.is_active='T' AND COALESCE(t.is_deleted,'F')<>'T') AS template_count,
        (SELECT COALESCE(SUM(t.item_count),0)::int FROM gm_smartfit_template t WHERE t.space_id=sp.space_id AND t.is_active='T' AND COALESCE(t.is_deleted,'F')<>'T') AS item_count
      FROM gm_smartfit_space sp LEFT JOIN gm_member m ON m.member_id=sp.owner_member_id
      WHERE ${where.join(' AND ')} ORDER BY sp.updated_at DESC LIMIT ${lim} OFFSET ${off}`, params);
    ok(res,{ items:r.rows.map(x=>Object.assign(withImageMeta('space',x), { author:displayAuthor(x) })), count:r.rowCount, limit, offset });
  }catch(e){ fail(res,500,'space list failed',{ detail:String(e.message||e) }); }
});
router.get('/api/gm/smartfit/space/public-list', async (req,res)=>{
  try{
    const pool=db(req); const q=s(req.query.q || req.query.keyword || ''); const category=s(req.query.category_no || req.query.category_code || req.query.category || '');
    const limit=Math.min(200, Math.max(1, i(req.query.limit,80))); const offset=Math.max(0, i(req.query.offset,0));
    const params=[]; const where=[`sp.is_active='T'`, `COALESCE(sp.is_deleted,'F')<>'T'`, `sp.is_public='T'`, `COALESCE(sp.search_visible,'F')='T'`];
    if(q){ params.push('%'+q+'%'); where.push(spaceSearchWhere('sp').replace(/\$1/g, '$'+params.length)); }
    if(category){ params.push(category); where.push(`sp.category_no=$${params.length}`); }
    params.push(limit); const lim='$'+params.length; params.push(offset); const off='$'+params.length;
    const r=await pool.query(`SELECT sp.*, m.member_name, m.member_nickname,
        (SELECT COUNT(*)::int FROM gm_smartfit_template t WHERE t.space_id=sp.space_id AND t.is_active='T' AND COALESCE(t.is_deleted,'F')<>'T') AS template_count,
        (SELECT COALESCE(SUM(t.item_count),0)::int FROM gm_smartfit_template t WHERE t.space_id=sp.space_id AND t.is_active='T' AND COALESCE(t.is_deleted,'F')<>'T') AS item_count
      FROM gm_smartfit_space sp LEFT JOIN gm_member m ON m.member_id=sp.owner_member_id
      WHERE ${where.join(' AND ')} ORDER BY sp.updated_at DESC LIMIT ${lim} OFFSET ${off}`, params);
    ok(res,{ items:r.rows.map(x=>Object.assign(withImageMeta('space',x), { author:displayAuthor(x) })), count:r.rowCount, limit, offset });
  }catch(e){ fail(res,500,'space public list failed',{ detail:String(e.message||e) }); }
});

router.post('/api/gm/smartfit/space/save', async (req,res)=>{
  const client=await db(req).connect();
  try{
    const b=req.body||{}; const member=s(b.member_id || b.memberId || b.creator_member_id || b.owner_member_id);
    if(!member) return fail(res,400,'member_id required');
    const spaceId=i(b.space_id || b.spaceId,0);
    const isPublic=publicOf(b); const searchVisible=isPublic;
    const sourceLang=normLang(b.source_lang || b.sourceLang || b.gm_lang || b.gmLang || 'ko');
    const titleSource=s(b.space_title_source || b.spaceTitleSource || b.space_title || b.spaceTitle || b.space_name || b.spaceName || '');
    if(!titleSource) return fail(res,400,'space_title_source required');
    const titleKo=s(b.space_title_ko || b.title_ko || b.titleKo || (sourceLang==='ko'?titleSource:''));
    const desc=s(b.description || b.space_description || b.space_desc || '');
    const nick=s(b.author_nickname || b.authorNickname || '') || await memberNickname(client, member);
    const links=[1,2,3,4,5,6].map(k=>s(b['link0'+k] || ''));
    await client.query('BEGIN');
    let saved;
    if(spaceId){
      const old=(await client.query('SELECT * FROM gm_smartfit_space WHERE space_id=$1 FOR UPDATE',[spaceId])).rows[0];
      if(!old) throw new Error('space not found');
      if(!(await isOwnerOrAdmin(client, member, old.owner_member_id || old.creator_member_id))) throw new Error('permission denied');
      const r=await client.query(`UPDATE gm_smartfit_space SET owner_member_id=$1, creator_member_id=COALESCE(NULLIF(creator_member_id,''),$1), source_lang=$2, space_title_source=$3, space_title_ko=$4, author_nickname=$5, category_no=$6, image_count=$7, link01=$8, link02=$9, link03=$10, link04=$11, link05=$12, link06=$13, description=$14, is_public=$15, search_visible=$16, is_deleted='F', deleted_at=NULL, deleted_by='', updated_at=CURRENT_TIMESTAMP WHERE space_id=$17 RETURNING *`,
        [member, sourceLang, titleSource, titleKo, nick, s(b.category_no || b.categoryNo || 'ROOT') || 'ROOT', limit5(b.image_count), ...links, desc, isPublic, searchVisible, spaceId]);
      saved=r.rows[0];
    }else{
      const r=await client.query(`INSERT INTO gm_smartfit_space (owner_member_id,creator_member_id,source_lang,space_title_source,space_title_ko,author_nickname,category_no,image_count,link01,link02,link03,link04,link05,link06,description,is_public,search_visible) VALUES ($1,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
        [member, sourceLang, titleSource, titleKo, nick, s(b.category_no || b.categoryNo || 'ROOT') || 'ROOT', limit5(b.image_count), ...links, desc, isPublic, searchVisible]);
      saved=r.rows[0];
    }
    await client.query('COMMIT');
    ok(res,{ space:Object.assign(withImageMeta('space',saved), { author:displayAuthor(saved) }) });
  }catch(e){ try{await client.query('ROLLBACK');}catch(_){} fail(res,400,'space save failed',{ detail:String(e.message||e) }); }
  finally{ client.release(); }
});

router.get('/api/gm/smartfit/template/list', async (req,res)=>{
  try{
    const pool=db(req); const q=s(req.query.q || req.query.keyword || ''); const category=s(req.query.category_no || req.query.category_code || req.query.category || '');
    const memberId=s(req.query.member_id || req.query.memberId || ''); const publicOnly=yn(req.query.public_only || req.query.publicOnly,'F')==='T'; const mine=s(req.query.mine || '')==='1' || s(req.query.scope)==='mine' || (!!memberId && !publicOnly);
    const root=s(req.query.root || '')==='1'; const spaceId=req.query.space_id || req.query.spaceId || '';
    const limit=Math.min(100, Math.max(1, i(req.query.limit, 30))); const offset=Math.max(0, i(req.query.offset,0));
    const params=[]; const where=[`t.is_active='T'`, `COALESCE(t.is_deleted,'F')<>'T'`];
    if(q){ params.push('%'+q+'%'); where.push(searchWhere('t').replace(/\$1/g, '$'+params.length)); }
    if(category){ params.push(category); where.push(`t.category_no=$${params.length}`); }
    if(spaceId){ params.push(spaceId); where.push(`t.space_id=$${params.length}`); }
    else if(root){ where.push(`t.space_id IS NULL`); }
    if(mine && memberId){ params.push(memberId); where.push(`t.owner_member_id=$${params.length}`); }
    else { where.push(`t.is_public='T'`); where.push(`COALESCE(t.search_visible,'F')='T'`); }
    params.push(limit); const lim='$'+params.length; params.push(offset); const off='$'+params.length;
    const sql=`SELECT t.*, c.category_name, sp.space_title_source, sp.author_nickname, m.member_name, m.member_nickname
      FROM gm_smartfit_template t
      LEFT JOIN gm_smartfit_category c ON c.category_no=t.category_no
      LEFT JOIN gm_smartfit_space sp ON sp.space_id=t.space_id
      LEFT JOIN gm_member m ON m.member_id=t.owner_member_id
      WHERE ${where.join(' AND ')} ORDER BY t.updated_at DESC LIMIT ${lim} OFFSET ${off}`;
    const r=await pool.query(sql, params);
    ok(res,{ items:r.rows.map(x=>Object.assign(withImageMeta('template',x), { author:displayAuthor(x), space_name:x.space_title_source || 'ROOT' })), count:r.rowCount, limit, offset });
  }catch(e){ fail(res,500,'template list failed',{ detail:String(e.message||e) }); }
});

router.get('/api/gm/smartfit/template/:template_id', async (req,res)=>{
  try{
    const pool=db(req); const id=i(req.params.template_id,0);
    const r=await pool.query("SELECT * FROM gm_smartfit_template WHERE template_id=$1 AND is_active='T' AND COALESCE(is_deleted,'F')<>'T'", [id]);
    const template=r.rows[0]; if(!template) return fail(res,404,'template not found');
    const items=await pool.query("SELECT * FROM gm_smartfit_item WHERE template_id=$1 AND is_active='T' AND COALESCE(is_deleted,'F')<>'T' ORDER BY sort_no,item_id", [id]);
    ok(res,{ template:withImageMeta('template',template), items:items.rows, images:imageUrls('template', id, template.image_count) });
  }catch(e){ fail(res,500,'template detail failed',{ detail:String(e.message||e) }); }
});

router.post('/api/gm/smartfit/template/save', async (req,res)=>{
  const client=await db(req).connect();
  try{
    const b=req.body||{}; const templateId=i(b.template_id || b.templateId,0); const creator=s(b.creator_member_id || b.creatorMemberId || b.member_id || b.memberId || b.owner_member_id);
    if(!creator) return fail(res,400,'creator_member_id required');
    const sourceLang=normLang(b.source_lang || b.sourceLang || b.gm_lang || b.gmLang || 'ko');
    const titleSource=s(b.template_title_source || b.templateTitleSource || b.template_title || b.templateTitle || b.title || '');
    if(!titleSource) return fail(res,400,'template_title_source required');
    const titleKo=s(b.template_title_ko || b.title_ko || b.titleKo || (sourceLang==='ko'?titleSource:''));
    const searchSource=s(b.search_source || b.searchSource || '');
    const searchKo=s(b.search_ko || b.searchKo || (sourceLang==='ko'?searchSource:''));
    const isPublic=publicOf(b); const searchVisible=isPublic;
    const links=[1,2,3,4,5,6].map(k=>s(b['link0'+k] || ''));
    let spaceId = b.space_id || b.spaceId || null; if(s(spaceId)==='' || s(spaceId).toUpperCase()==='ROOT') spaceId=null;
    await client.query('BEGIN');
    let existing=null;
    if(templateId){
      existing=(await client.query('SELECT * FROM gm_smartfit_template WHERE template_id=$1 FOR UPDATE',[templateId])).rows[0]||null;
      if(!existing) throw new Error('template not found');
      if(!(await isOwnerOrAdmin(client, creator, existing.owner_member_id || existing.creator_member_id))) throw new Error('permission denied');
    }
    let saved;
    const vals=[creator, sourceLang, titleSource, titleKo, s(b.category_no || b.categoryNo || 'ROOT') || 'ROOT', limit5(b.image_count), ...links, s(b.description || b.template_description || b.template_desc || ''), searchSource, searchKo, keywordCount(searchSource), isPublic, searchVisible, spaceId];
    if(templateId){
      const r=await client.query(`UPDATE gm_smartfit_template SET owner_member_id=$1, creator_member_id=COALESCE(NULLIF(creator_member_id,''),$1), source_lang=$2, template_title_source=$3, template_title_ko=$4, category_no=$5, image_count=$6, link01=$7, link02=$8, link03=$9, link04=$10, link05=$11, link06=$12, description=$13, search_source=$14, search_ko=$15, keyword_count=$16, is_public=$17, search_visible=$18, space_id=$19, is_deleted='F', deleted_at=NULL, deleted_by='', updated_at=CURRENT_TIMESTAMP WHERE template_id=$20 RETURNING *`, [...vals, templateId]);
      saved=r.rows[0];
    }else{
      const r=await client.query(`INSERT INTO gm_smartfit_template (owner_member_id,creator_member_id,source_lang,template_title_source,template_title_ko,category_no,image_count,link01,link02,link03,link04,link05,link06,description,search_source,search_ko,keyword_count,is_public,search_visible,space_id) VALUES ($1,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING *`, vals);
      saved=r.rows[0];
    }
    const items=Array.isArray(b.items) ? b.items : [];
    if(items.length){
      let order=0;
      for(const it of items){
        const productUid=s(it.product_uid || it.productUid || it.pi_ii_vi || ''); if(!productUid) continue;
        await client.query(`INSERT INTO gm_smartfit_item (template_id,mall_code,product_uid,qty,sort_no,is_active,is_deleted,deleted_at,deleted_by)
          VALUES ($1,$2,$3,$4,$5,'T','F',NULL,'')
          ON CONFLICT (template_id,mall_code,product_uid) DO UPDATE SET qty=EXCLUDED.qty, sort_no=EXCLUDED.sort_no, is_active='T', is_deleted='F', deleted_at=NULL, deleted_by='', updated_at=CURRENT_TIMESTAMP`, [saved.template_id, s(it.mall_code || it.mallCode || ''), productUid, Math.max(1,i(it.qty,1)), i(it.sort_no || it.sortOrder, ++order)]);
      }
      await refreshTemplateItemCount(client, saved.template_id);
      saved=(await client.query('SELECT * FROM gm_smartfit_template WHERE template_id=$1',[saved.template_id])).rows[0];
    }
    await client.query('COMMIT');
    ok(res,{ template:withImageMeta('template',saved) });
  }catch(e){ try{await client.query('ROLLBACK');}catch(_){} fail(res,400,'template save failed',{ detail:String(e.message||e) }); }
  finally{ client.release(); }
});

router.post('/api/gm/smartfit/template/public', async (req,res)=>{
  try{
    const pool=db(req); const templateId=i(req.body?.template_id || req.body?.templateId,0); const member=s(req.body?.member_id || req.body?.memberId || req.body?.creator_member_id);
    const r=await pool.query('SELECT * FROM gm_smartfit_template WHERE template_id=$1', [templateId]); const t=r.rows[0]; if(!t) return fail(res,404,'template not found');
    if(!(await isOwnerOrAdmin(pool, member, t.owner_member_id || t.creator_member_id))) return fail(res,403,'permission denied');
    const rr=await pool.query("UPDATE gm_smartfit_template SET is_public='T', search_visible='T', updated_at=CURRENT_TIMESTAMP WHERE template_id=$1 RETURNING *", [templateId]);
    ok(res,{ template:withImageMeta('template',rr.rows[0]) });
  }catch(e){ fail(res,500,'public failed',{ detail:String(e.message||e) }); }
});

router.get('/api/gm/smartfit/product/search', async (req,res)=>{
  try{
    const pool=db(req); const q=s(req.query.q || req.query.keyword || ''); const category=s(req.query.category_no || req.query.category_code || req.query.category || ''); const mall=s(req.query.mall_code || req.query.mall || '');
    const limit=Math.min(80, Math.max(1, i(req.query.limit,30))); const offset=Math.max(0, i(req.query.offset,0));
    const params=[]; const where=[];
    if(q){ params.push('%'+q+'%'); const pn='$'+params.length; where.push(`(product_name ILIKE ${pn} OR mall_product_name ILIKE ${pn} OR option_name ILIKE ${pn} OR option_value ILIKE ${pn} OR product_uid ILIKE ${pn} OR pi_ii_vi ILIKE ${pn} OR category_keyword ILIKE ${pn})`); }
    if(category){ params.push(category); where.push(`(glomart_code=$${params.length} OR gm_category=$${params.length})`); }
    if(mall){ params.push(mall); where.push(`mall_code=$${params.length}`); }
    params.push(limit); const lim='$'+params.length; params.push(offset); const off='$'+params.length;
    const sql=`SELECT product_uid, mall_code, pi_ii_vi, glomart_code, gm_category, product_name, mall_product_name, option_name, option_value, mall_sale_price, final_supply_price, delivery_type, delivery_fee, delivery_eta_text, product_url, thumb_origin_url, thumb_file_name, soldout_yn, hit_count, updated_at FROM gm_product ${where.length?'WHERE '+where.join(' AND '):''} ORDER BY COALESCE(updated_at, created_at) DESC NULLS LAST LIMIT ${lim} OFFSET ${off}`;
    const r=await pool.query(sql, params); ok(res,{ items:r.rows, count:r.rowCount, limit, offset });
  }catch(e){ fail(res,500,'product search failed',{ detail:String(e.message||e) }); }
});

router.get('/api/gm/smartfit/item/list', async (req,res)=>{
  try{
    const pool=db(req); const templateId=i(req.query.template_id || req.query.templateId,0); const q=s(req.query.q || req.query.keyword || '');
    if(!templateId) return ok(res,{ items:[], count:0 });
    const params=[templateId]; const where=[`i.template_id=$1`, `i.is_active='T'`, `COALESCE(i.is_deleted,'F')<>'T'`];
    if(q){ params.push('%'+q+'%'); where.push(`(i.product_uid ILIKE $${params.length} OR p.product_name ILIKE $${params.length} OR p.mall_product_name ILIKE $${params.length})`); }
    const r=await pool.query(`SELECT i.*, p.product_name, p.mall_product_name, p.option_name, p.option_value, p.mall_sale_price AS price, p.final_supply_price AS sale_price, p.product_url, p.thumb_origin_url AS thumb_url FROM gm_smartfit_item i LEFT JOIN gm_product p ON p.product_uid=i.product_uid WHERE ${where.join(' AND ')} ORDER BY i.sort_no, i.item_id`, params);
    ok(res,{ items:r.rows, count:r.rowCount });
  }catch(e){ fail(res,500,'item list failed',{ detail:String(e.message||e) }); }
});

router.post('/api/gm/smartfit/collection/add', async (req,res)=>{
  try{
    const pool=db(req); const member=s(req.body?.member_id || req.body?.memberId); const tid=i(req.body?.template_id || req.body?.templateId,0);
    if(!member || !tid) return fail(res,400,'member_id/template_id required');
    const r=await pool.query(`INSERT INTO gm_smartfit_collection (member_id,template_id,is_active,is_deleted,deleted_at,deleted_by,collected_at) VALUES ($1,$2,'T','F',NULL,'',CURRENT_TIMESTAMP)
      ON CONFLICT(member_id,template_id) DO UPDATE SET is_active='T', is_deleted='F', deleted_at=NULL, deleted_by='', updated_at=CURRENT_TIMESTAMP RETURNING *`, [member, tid]);
    await recordEventInternal(pool, { template_id:tid, member_id:member, stat_type:'collection', amount:1, source:'collection' });
    ok(res,{ collection:r.rows[0] });
  }catch(e){ fail(res,500,'collection add failed',{ detail:String(e.message||e) }); }
});
router.get('/api/gm/smartfit/collection/list', async (req,res)=>{
  try{
    const pool=db(req); const member=s(req.query.member_id || req.query.memberId); if(!member) return fail(res,400,'member_id required');
    const r=await pool.query(`SELECT c.*, t.template_title_source, t.template_title_ko, t.source_lang, t.category_no, t.owner_member_id, t.image_count
      FROM gm_smartfit_collection c JOIN gm_smartfit_template t ON t.template_id=c.template_id
      WHERE c.member_id=$1 AND c.is_active='T' AND COALESCE(c.is_deleted,'F')<>'T' AND t.is_active='T' ORDER BY c.updated_at DESC`, [member]);
    ok(res,{ items:r.rows.map(x=>withImageMeta('template',x)), count:r.rowCount });
  }catch(e){ fail(res,500,'collection list failed',{ detail:String(e.message||e) }); }
});

router.post('/api/gm/smartfit/build-cart', async (req,res)=>{
  try{
    const pool=db(req); const member=s(req.body?.member_id || req.body?.memberId || '');
    const templateIds=(Array.isArray(req.body?.template_ids)?req.body.template_ids:Array.isArray(req.body?.templateIds)?req.body.templateIds:[req.body?.template_id || req.body?.templateId]).map(x=>i(x,0)).filter(Boolean);
    if(!templateIds.length) return fail(res,400,'template_ids required');
    const r=await pool.query(`SELECT t.template_id, t.owner_member_id, t.category_no, t.template_title_source, t.template_title_ko, t.source_lang, i.item_id, i.mall_code, i.product_uid, i.qty, i.sort_no
      FROM gm_smartfit_template t JOIN gm_smartfit_item i ON i.template_id=t.template_id AND i.is_active='T' AND COALESCE(i.is_deleted,'F')<>'T'
      WHERE t.template_id = ANY($1::bigint[]) AND t.is_active='T'
      ORDER BY array_position($1::bigint[], t.template_id), i.sort_no, i.item_id`, [templateIds]);
    const now=new Date();
    const batchId='SFB_' + now.getFullYear() + pad2(now.getMonth()+1) + pad2(now.getDate()) + '_' + Math.random().toString(16).slice(2,8);
    const items=r.rows.map(row=>({ batch_id:batchId, template_id:row.template_id, owner_member_id:row.owner_member_id, category_no:row.category_no, template_title:row.template_title_source || row.template_title_ko, source_lang:row.source_lang, item_id:row.item_id, mall_code:row.mall_code, product_uid:row.product_uid, original_qty:i(row.qty,1), selected_qty:i(row.qty,1), is_selected:true, sort_no:row.sort_no }));
    for(const tid of templateIds){
      const itemCount=items.filter(x=>Number(x.template_id)===Number(tid)).length;
      await recordEventInternal(pool,{ template_id:tid, member_id:member, stat_type:'build_cart', amount:1, source:'build-cart' });
      if(itemCount>0) await recordEventInternal(pool,{ template_id:tid, member_id:member, stat_type:'item_add', amount:itemCount, source:'build-cart' });
    }
    ok(res,{ batch_id:batchId, template_ids:templateIds, items, count:items.length, note:'SmartFit only builds cart candidates; gm_basket/gm_orders are not modified.' });
  }catch(e){ fail(res,500,'build cart failed',{ detail:String(e.message||e) }); }
});

router.get('/api/gm/smartfit/media/list', async (req,res)=>{
  try{
    const pool=db(req); const targetType=s(req.query.target_type || req.query.targetType || 'template'); const id=i(req.query.target_id || req.query.targetId || req.query.template_id || req.query.space_id,0);
    if(!id) return fail(res,400,'target_id required');
    const table=targetType==='space'?'gm_smartfit_space':'gm_smartfit_template'; const col=targetType==='space'?'space_id':'template_id';
    const r=await pool.query(`SELECT ${col} AS id, image_count FROM ${table} WHERE ${col}=$1`, [id]);
    const row=r.rows[0]; if(!row) return ok(res,{ items:[], count:0 });
    const items=imageUrls(targetType==='space'?'space':'template', id, row.image_count);
    ok(res,{ items, count:items.length, rule_based:true });
  }catch(e){ fail(res,500,'media list failed',{ detail:String(e.message||e) }); }
});
router.post('/api/gm/smartfit/media/save', async (req,res)=>{
  fail(res,400,'media URL save disabled', { detail:'SmartFit V003 stores image_count only. Upload/R2 object write is handled separately; URLs are generated by rule.' });
});

router.get('/api/gm/smartfit/comment/list', async (req,res)=>{
  try{
    const pool=db(req); const templateId=i(req.query.template_id || req.query.templateId,0); if(!templateId) return fail(res,400,'template_id required');
    const r=await pool.query("SELECT * FROM gm_smartfit_comment WHERE template_id=$1 AND is_active='T' AND COALESCE(is_deleted,'F')<>'T' ORDER BY created_at DESC LIMIT 200", [templateId]);
    ok(res,{ items:r.rows, count:r.rowCount });
  }catch(e){ fail(res,500,'comment list failed',{ detail:String(e.message||e) }); }
});
router.post('/api/gm/smartfit/comment/add', async (req,res)=>{
  try{
    const pool=db(req); const b=req.body||{}; const templateId=i(b.template_id || b.templateId,0); const member=s(b.member_id || b.memberId || '');
    if(!templateId) return fail(res,400,'template_id required');
    const ratingRaw=b.rating === undefined || b.rating === null || b.rating === '' ? null : n(b.rating,0);
    const r=await pool.query(`INSERT INTO gm_smartfit_comment (template_id,member_id,parent_id,rating,source_lang,body,is_creator_reply) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [templateId, member, b.parent_id || b.parentId || null, ratingRaw, normLang(b.source_lang || b.sourceLang || 'ko'), s(b.body || b.comment || ''), yn(b.is_creator_reply || b.isCreatorReply,'F')]);
    if(ratingRaw !== null){ await recordEventInternal(pool,{ template_id:templateId, member_id:member, stat_type:'review', amount:1, source:'comment' }); await recordEventInternal(pool,{ template_id:templateId, member_id:member, stat_type:'rating', amount:ratingRaw, source:'comment' }); }
    ok(res,{ comment:r.rows[0] });
  }catch(e){ fail(res,500,'comment add failed',{ detail:String(e.message||e) }); }
});

async function recordEventInternal(pool, body){
  const templateId=i(body.template_id || body.templateId,0) || null;
  let categoryNo=s(body.category_no || body.categoryNo || body.category_code || body.categoryCode || ''); let creator=s(body.creator_member_id || body.creatorMemberId || ''); let spaceId=body.space_id || body.spaceId || null;
  if(templateId && (!categoryNo || !creator || !spaceId)){
    const tr=await pool.query('SELECT template_id,space_id,category_no,owner_member_id,creator_member_id FROM gm_smartfit_template WHERE template_id=$1', [templateId]);
    const t=tr.rows[0]||{}; categoryNo=categoryNo || s(t.category_no); creator=creator || s(t.owner_member_id || t.creator_member_id); spaceId=spaceId || t.space_id || null;
  }
  const statType=s(body.stat_type || body.statType || body.type); if(!STAT_TYPES.has(statType)) throw new Error('invalid stat_type');
  const amount=n(body.amount,1); const lang=LANGS.has(s(body.lang_code || body.langCode)) ? s(body.lang_code || body.langCode) : 'ot';
  const member=s(body.member_id || body.memberId || ''); const orderId=s(body.order_id || body.orderId || ''); const source=s(body.source || '');
  const now=body.created_at ? new Date(body.created_at) : new Date(); const k=kstParts(now);
  await pool.query(`INSERT INTO gm_smartfit_event (space_id,template_id,category_no,creator_member_id,member_id,stat_type,amount,lang_code,order_id,source,meta_json) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [spaceId, templateId, categoryNo, creator, member, statType, amount, lang, orderId, source, body.meta_json || body.meta || null]);
  if(templateId) await addMonthly(pool, monthlyTemplateTable(k.ym), 'template_id', String(templateId), statType, lang, creator, amount, k.day);
  if(categoryNo) await addMonthly(pool, monthlyCategoryTable(k.ym), 'category_no', categoryNo, statType, lang, creator, amount, k.day);
  await incrementCounters(pool, templateId, statType, amount);
  return { template_id:templateId, category_no:categoryNo, stat_type:statType, amount, lang_code:lang, ym:k.ym, day:k.day };
}
router.post('/api/gm/smartfit/event', async (req,res)=>{ try{ const data=await recordEventInternal(db(req), req.body||{}); ok(res,{ event:data }); } catch(e){ fail(res,400,'event failed',{ detail:String(e.message||e) }); } });
router.get('/api/gm/smartfit/stat/monthly', async (req,res)=>{
  try{
    const pool=db(req); const ym=safeYm(req.query.ym || kstParts().ym); const target=s(req.query.target || 'template'); const id=s(req.query.id || req.query.template_id || req.query.category_no || req.query.category_code || '');
    const table=target==='category'?monthlyCategoryTable(ym):monthlyTemplateTable(ym); const key=target==='category'?'category_no':'template_id';
    await ensureMonthlyTable(pool, table, key);
    const params=[]; let where=''; if(id){ params.push(id); where=`WHERE ${key}=$1`; }
    const r=await pool.query(`SELECT * FROM ${qident(table)} ${where} ORDER BY total DESC LIMIT 500`, params);
    ok(res,{ ym, target, items:r.rows, count:r.rowCount });
  }catch(e){ fail(res,500,'monthly stat failed',{ detail:String(e.message||e) }); }
});

async function referenceCount(client, type, id, owner){
  if(type==='template'){ const r=await client.query(`SELECT COUNT(*)::int AS cnt FROM gm_smartfit_collection WHERE template_id=$1 AND member_id<>$2 AND is_active='T' AND COALESCE(is_deleted,'F')<>'T'`, [id, owner]); return i(r.rows[0] && r.rows[0].cnt,0); }
  if(type==='space'){ const r=await client.query(`SELECT COUNT(*)::int AS cnt FROM gm_smartfit_collection c JOIN gm_smartfit_template t ON t.template_id=c.template_id WHERE t.space_id=$1 AND c.member_id<>$2 AND c.is_active='T' AND COALESCE(c.is_deleted,'F')<>'T'`, [id, owner]); return i(r.rows[0] && r.rows[0].cnt,0); }
  if(type==='item'){ const r=await client.query(`SELECT COUNT(*)::int AS cnt FROM gm_smartfit_collection c JOIN gm_smartfit_item i ON i.template_id=c.template_id JOIN gm_smartfit_template t ON t.template_id=i.template_id WHERE i.item_id=$1 AND c.member_id<>$2 AND c.is_active='T' AND COALESCE(c.is_deleted,'F')<>'T'`, [id, owner]); return i(r.rows[0] && r.rows[0].cnt,0); }
  return 0;
}
async function trashTarget(client, type, id){
  if(type==='space') return (await client.query('SELECT space_id AS id, owner_member_id AS owner_id, creator_member_id FROM gm_smartfit_space WHERE space_id=$1',[id])).rows[0];
  if(type==='template') return (await client.query('SELECT template_id AS id, owner_member_id AS owner_id, creator_member_id FROM gm_smartfit_template WHERE template_id=$1',[id])).rows[0];
  if(type==='item') return (await client.query('SELECT i.item_id AS id, t.owner_member_id AS owner_id, i.template_id FROM gm_smartfit_item i JOIN gm_smartfit_template t ON t.template_id=i.template_id WHERE i.item_id=$1',[id])).rows[0];
  return null;
}
async function updateTrashState(client, type, id, member, deleted){
  if(deleted){
    if(type==='space') return client.query(`UPDATE gm_smartfit_space SET is_deleted='T', deleted_at=CURRENT_TIMESTAMP, deleted_by=$1, search_visible='F', updated_at=CURRENT_TIMESTAMP WHERE space_id=$2 RETURNING *`, [member,id]);
    if(type==='template') return client.query(`UPDATE gm_smartfit_template SET is_deleted='T', deleted_at=CURRENT_TIMESTAMP, deleted_by=$1, search_visible='F', updated_at=CURRENT_TIMESTAMP WHERE template_id=$2 RETURNING *`, [member,id]);
    if(type==='item') return client.query(`UPDATE gm_smartfit_item SET is_deleted='T', deleted_at=CURRENT_TIMESTAMP, deleted_by=$1, updated_at=CURRENT_TIMESTAMP WHERE item_id=$2 RETURNING *`, [member,id]);
  }else{
    if(type==='space') return client.query(`UPDATE gm_smartfit_space SET is_deleted='F', deleted_at=NULL, deleted_by='', updated_at=CURRENT_TIMESTAMP WHERE space_id=$1 RETURNING *`, [id]);
    if(type==='template') return client.query(`UPDATE gm_smartfit_template SET is_deleted='F', deleted_at=NULL, deleted_by='', updated_at=CURRENT_TIMESTAMP WHERE template_id=$1 RETURNING *`, [id]);
    if(type==='item') return client.query(`UPDATE gm_smartfit_item SET is_deleted='F', deleted_at=NULL, deleted_by='', updated_at=CURRENT_TIMESTAMP WHERE item_id=$1 RETURNING *`, [id]);
  }
  throw new Error('invalid target_type');
}
router.post('/api/gm/smartfit/trash/move', async (req,res)=>{
  const client=await db(req).connect();
  try{
    const type=s(req.body?.target_type || req.body?.type); const id=i(req.body?.target_id || req.body?.id,0); const member=s(req.body?.member_id || req.body?.memberId);
    if(!type || !id || !member) return fail(res,400,'target_type/target_id/member_id required');
    await client.query('BEGIN'); const target=await trashTarget(client,type,id); if(!target) throw new Error('target not found'); if(!(await isOwnerOrAdmin(client, member, target.owner_id))) throw new Error('permission denied');
    const r=await updateTrashState(client,type,id,member,true); await client.query('COMMIT'); ok(res,{ item:r.rows[0], message:'삭제되었습니다. 추후 복원 메뉴에서 복원할 수 있습니다.' });
  }catch(e){ try{await client.query('ROLLBACK');}catch(_){} fail(res,400,'trash move failed',{ detail:String(e.message||e) }); } finally{ client.release(); }
});
router.post('/api/gm/smartfit/trash/restore', async (req,res)=>{
  const client=await db(req).connect();
  try{
    const type=s(req.body?.target_type || req.body?.type); const ids=(Array.isArray(req.body?.target_ids)?req.body.target_ids:[req.body?.target_id || req.body?.id]).map(x=>i(x,0)).filter(Boolean); const member=s(req.body?.member_id || req.body?.memberId);
    if(!type || !ids.length || !member) return fail(res,400,'target_type/target_ids/member_id required');
    await client.query('BEGIN'); const out=[];
    for(const id of ids){ const target=await trashTarget(client,type,id); if(!target) continue; if(!(await isOwnerOrAdmin(client, member, target.owner_id))) throw new Error('permission denied'); const r=await updateTrashState(client,type,id,member,false); out.push(r.rows[0]); }
    await client.query('COMMIT'); ok(res,{ items:out, count:out.length });
  }catch(e){ try{await client.query('ROLLBACK');}catch(_){} fail(res,400,'trash restore failed',{ detail:String(e.message||e) }); } finally{ client.release(); }
});
router.post('/api/gm/smartfit/trash/permanent-delete', async (req,res)=>{
  const client=await db(req).connect();
  try{
    const type=s(req.body?.target_type || req.body?.type); const ids=(Array.isArray(req.body?.target_ids)?req.body.target_ids:[req.body?.target_id || req.body?.id]).map(x=>i(x,0)).filter(Boolean); const member=s(req.body?.member_id || req.body?.memberId);
    if(!type || !ids.length || !member) return fail(res,400,'target_type/target_ids/member_id required');
    await client.query('BEGIN'); const deleted=[]; const blocked=[];
    for(const id of ids){ const target=await trashTarget(client,type,id); if(!target) continue; if(!(await isOwnerOrAdmin(client, member, target.owner_id))) throw new Error('permission denied'); const refs=await referenceCount(client,type,id,target.owner_id); if(refs>0){ blocked.push({id, refs, reason:'used_by_other_member'}); continue; }
      if(type==='space'){ await client.query('DELETE FROM gm_smartfit_item WHERE template_id IN (SELECT template_id FROM gm_smartfit_template WHERE space_id=$1)',[id]); await client.query('DELETE FROM gm_smartfit_template WHERE space_id=$1',[id]); await client.query('DELETE FROM gm_smartfit_space WHERE space_id=$1',[id]); }
      else if(type==='template'){ await client.query('DELETE FROM gm_smartfit_item WHERE template_id=$1',[id]); await client.query('DELETE FROM gm_smartfit_template WHERE template_id=$1',[id]); }
      else if(type==='item'){ await client.query('DELETE FROM gm_smartfit_item WHERE item_id=$1',[id]); }
      deleted.push(id); }
    await client.query('COMMIT'); ok(res,{ deleted, blocked, message:blocked.length?'다른 사용자가 사용 중인 항목은 영구삭제하지 않았습니다.':'' });
  }catch(e){ try{await client.query('ROLLBACK');}catch(_){} fail(res,400,'permanent delete failed',{ detail:String(e.message||e) }); } finally{ client.release(); }
});
router.get('/api/gm/smartfit/trash/list', async (req,res)=>{
  try{
    const pool=db(req); const member=s(req.query.member_id || req.query.memberId); const type=s(req.query.target_type || req.query.type || 'template'); if(!member) return fail(res,400,'member_id required');
    let sql, params=[member];
    if(type==='space') sql="SELECT * FROM gm_smartfit_space WHERE owner_member_id=$1 AND COALESCE(is_deleted,'F')='T' ORDER BY deleted_at DESC";
    else if(type==='item') sql="SELECT i.* FROM gm_smartfit_item i JOIN gm_smartfit_template t ON t.template_id=i.template_id WHERE t.owner_member_id=$1 AND COALESCE(i.is_deleted,'F')='T' ORDER BY i.deleted_at DESC";
    else sql="SELECT * FROM gm_smartfit_template WHERE owner_member_id=$1 AND COALESCE(is_deleted,'F')='T' ORDER BY deleted_at DESC";
    const r=await pool.query(sql, params); ok(res,{ items:r.rows, count:r.rowCount, target_type:type });
  }catch(e){ fail(res,500,'trash list failed',{ detail:String(e.message||e) }); }
});

module.exports = router;
