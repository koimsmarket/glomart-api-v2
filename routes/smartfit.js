'use strict';
const express = require('express');
const router = express.Router();

const VERSION = 'GM_SMARTFIT_SERVER_V009';
console.log('[GM_SMARTFIT_ROUTE] loaded');
const STAT_TYPES = new Set([
  'view','visit','collection','use','reuse','order','sales',
  'cancel','cancel_amount','return','return_amount',
  'incentive_confirm','incentive_cancel','review','rating'
]);
const LANGS = new Set(['ko','en','zh','vi','ja','tw','th','uz','ne','km','id','tl','mn','my','kk','si','ru','bn','ur','lo','hi','tr','fa','es','fr','ot']);
const VIS = new Set(['draft','private','public']);

function db(req){ return req.app.locals.db || req.app.locals.pool; }
function s(v){ return v === undefined || v === null ? '' : String(v).replace(/[\u00A0\u200B-\u200D\uFEFF]/g,' ').replace(/\s+/g,' ').trim(); }
function n(v, d=0){ const x = Number(String(v ?? '').replace(/,/g,'')); return Number.isFinite(x) ? x : d; }
function i(v, d=0){ const x = Math.round(n(v, d)); return Number.isFinite(x) ? x : d; }
function ok(res, data={}){ res.json({ ok:true, version:VERSION, ...data }); }
function fail(res, status, error, extra={}){ res.status(status).json({ ok:false, version:VERSION, error, ...extra }); }
function pad2(x){ return String(x).padStart(2,'0'); }
function qident(name){ return '"' + String(name).replace(/"/g,'""') + '"'; }
function isAdminMember(row){
  const code = s(row && (row.member_grade_code || row.grade_code)).toUpperCase();
  const grade = s(row && (row.member_grade || row.grade)).toUpperCase();
  return code === '9' || code === '09' || code === 'ADMIN' || code === 'MANAGER' || /관리자|ADMIN|MANAGER/.test(grade);
}
function kstParts(date = new Date()){
  const d = new Date(date.getTime() + 9*60*60*1000);
  return { y:d.getUTCFullYear(), m:d.getUTCMonth()+1, d:d.getUTCDate(), ym:`${d.getUTCFullYear()}_${pad2(d.getUTCMonth()+1)}`, day:pad2(d.getUTCDate()) };
}
function safeYm(ym){ if(!/^\d{4}_\d{2}$/.test(String(ym||''))) throw new Error('invalid ym'); return String(ym); }
function monthlyTemplateTable(ym){ return 'gm_smartfit_template_' + safeYm(ym); }
function monthlyCategoryTable(ym){ return 'gm_smartfit_category_' + safeYm(ym); }
function dayColumns(){ return Array.from({length:31}, (_,k)=>`day_${pad2(k+1)} NUMERIC(18,2) NOT NULL DEFAULT 0`).join(',\n    '); }
function searchWhere(q, prefix=''){
  const p = prefix ? prefix + '.' : '';
  return `(
    ${p}template_title_ko ILIKE $1 OR ${p}template_title_en ILIKE $1 OR ${p}template_title_gm_lang ILIKE $1 OR
    ${p}template_desc_ko ILIKE $1 OR ${p}template_desc_en ILIKE $1 OR ${p}template_desc_gm_lang ILIKE $1 OR
    ${p}search_ko ILIKE $1 OR ${p}search_en ILIKE $1 OR ${p}search_gm_lang ILIKE $1 OR
    ${p}search_ru ILIKE $1 OR ${p}search_hi ILIKE $1 OR ${p}search_fr ILIKE $1 OR ${p}search_es ILIKE $1
  )`;
}
function categorySearchWhere(prefix=''){
  const p = prefix ? prefix + '.' : '';
  return `(
    ${p}category_name_ko ILIKE $1 OR ${p}category_name_en ILIKE $1 OR ${p}category_name_gm_lang ILIKE $1 OR
    ${p}category_desc_ko ILIKE $1 OR ${p}category_desc_en ILIKE $1 OR ${p}category_desc_gm_lang ILIKE $1 OR
    ${p}search_ko ILIKE $1 OR ${p}search_en ILIKE $1 OR ${p}search_gm_lang ILIKE $1 OR
    ${p}search_ru ILIKE $1 OR ${p}search_hi ILIKE $1 OR ${p}search_fr ILIKE $1 OR ${p}search_es ILIKE $1
  )`;
}

async function getMember(pool, memberId){
  const id = s(memberId);
  if(!id) return null;
  try{
    const r = await pool.query('SELECT member_id, member_name, member_name_en, member_nickname, member_grade, member_grade_code, member_status FROM gm_member WHERE member_id=$1 LIMIT 1', [id]);
    return r.rows[0] || null;
  }catch(e){ return null; }
}
async function canPublic(pool, memberId, template){
  const mem = await getMember(pool, memberId);
  if(isAdminMember(mem)) return { ok:true, admin:true, reason:'admin' };
  const purchaseCount = i(template && template.purchase_count, 0);
  if(purchaseCount >= 1) return { ok:true, admin:false, reason:'purchase_verified' };
  return { ok:false, admin:false, reason:'purchase_count_required' };
}
function yn(v, def='F'){
  const x=s(v || '').toUpperCase();
  if(['T','Y','YES','TRUE','1','PUBLIC'].includes(x)) return 'T';
  if(['F','N','NO','FALSE','0','PRIVATE','HIDDEN'].includes(x)) return 'F';
  return def;
}
function visibilityOf(v, def='private'){
  const x=s(v || def).toLowerCase();
  return VIS.has(x) ? x : def;
}
function publicVisibility(v){ return visibilityOf(v, 'private') === 'public' ? 'T' : 'F'; }
function displayAuthor(row){
  row=row||{};
  return {
    member_id:s(row.creator_member_id || row.owner_member_id || row.member_id),
    nickname:s(row.author_nickname || row.member_nickname || ''),
    real_name_public:s(row.real_name_public)==='T'?'T':'F',
    real_name:s(row.real_name_public)==='T' ? s(row.member_name || '') : ''
  };
}
async function memberNickname(pool, memberId){
  const m=await getMember(pool, memberId);
  return s(m && (m.member_nickname || m.member_name_en || m.member_name || m.member_id));
}
async function isOwnerOrAdmin(pool, memberId, ownerId){
  if(s(memberId) && s(memberId)===s(ownerId)) return true;
  const mem=await getMember(pool, memberId);
  return isAdminMember(mem);
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
async function incrementCounters(pool, templateId, statType, amount){
  if(!templateId) return;
  const a = n(amount, 1);
  const map = {
    view:'view_count', visit:'visit_count', collection:'collection_count', use:'use_count', reuse:'reuse_count',
    order:'order_count', sales:'sales_amount', cancel:'cancel_count', cancel_amount:'cancel_amount',
    return:'return_count', return_amount:'return_amount', incentive_confirm:'incentive_confirm_amount', incentive_cancel:'incentive_cancel_amount',
    review:'review_count', rating:'rating_sum'
  };
  const col = map[statType];
  if(!col) return;
  await pool.query(`UPDATE gm_smartfit_template SET ${col}=${col}+$1, updated_at=CURRENT_TIMESTAMP WHERE template_id=$2`, [a, templateId]);
  if(statType === 'order') await pool.query('UPDATE gm_smartfit_template SET purchase_count=purchase_count+1, updated_at=CURRENT_TIMESTAMP WHERE template_id=$1', [templateId]);
  if(statType === 'rating') await pool.query('UPDATE gm_smartfit_template SET rating_avg = CASE WHEN review_count > 0 THEN rating_sum / review_count ELSE 0 END WHERE template_id=$1', [templateId]);
}

router.get('/api/gm/smartfit/health', (req,res)=> ok(res, { service:'smartfit', route:req.path }));

router.get('/api/gm/smartfit/category/list', async (req,res)=>{
  try{
    const pool = db(req);
    const parent = s(req.query.parent_code || req.query.parent || '');
    const active = s(req.query.active || 'T');
    const params=[]; const where=[];
    if(parent){ params.push(parent); where.push(`parent_code=$${params.length}`); }
    if(active){ params.push(active); where.push(`is_active=$${params.length}`); }
    const sql = `SELECT * FROM gm_smartfit_category ${where.length?'WHERE '+where.join(' AND '):''} ORDER BY depth, display_order, category_code`;
    const r = await pool.query(sql, params);
    ok(res, { items:r.rows, count:r.rowCount });
  }catch(e){ fail(res,500,'category list failed',{ detail:String(e.message||e) }); }
});

router.get('/api/gm/smartfit/category/search', async (req,res)=>{
  try{
    const pool=db(req); const q=s(req.query.q || req.query.keyword || '');
    if(!q) return ok(res,{ items:[], count:0 });
    const r = await pool.query(`SELECT * FROM gm_smartfit_category WHERE is_active='T' AND ${categorySearchWhere()} ORDER BY is_hot DESC, depth, display_order LIMIT 100`, ['%'+q+'%']);
    ok(res,{ items:r.rows, count:r.rowCount });
  }catch(e){ fail(res,500,'category search failed',{ detail:String(e.message||e) }); }
});

router.get('/api/gm/smartfit/template/list', async (req,res)=>{
  try{
    const pool=db(req);
    const q=s(req.query.q || req.query.keyword || '');
    const category=s(req.query.category_code || req.query.category || '');
    const memberId=s(req.query.member_id || req.query.memberId || '');
    const mine = s(req.query.mine || '') === '1' || s(req.query.scope) === 'mine';
    const limit=Math.min(100, Math.max(1, i(req.query.limit, 30)));
    const offset=Math.max(0, i(req.query.offset, 0));
    const params=[]; const where=[`t.is_active='T'`, `COALESCE(t.is_deleted,'F')<>'T'`];
    if(q){ params.push('%'+q+'%'); where.push(searchWhere('q','t').replace(/\$1/g, '$'+params.length)); }
    if(category){ params.push(category); where.push(`t.category_code=$${params.length}`); }
    if(mine && memberId){ params.push(memberId); where.push(`t.creator_member_id=$${params.length}`); }
    else { where.push(`t.visibility='public'`); where.push(`COALESCE(t.search_visible,'T')='T'`); }
    params.push(limit); const lim='$'+params.length; params.push(offset); const off='$'+params.length;
    const sql = `SELECT t.*, c.category_name_ko, c.category_name_en, sp.space_title, sp.author_nickname, sp.real_name_public, m.member_name, m.member_nickname FROM gm_smartfit_template t
      LEFT JOIN gm_smartfit_category c ON c.category_code=t.category_code
      LEFT JOIN gm_smartfit_space sp ON sp.space_id=t.space_id
      LEFT JOIN gm_member m ON m.member_id=t.creator_member_id
      WHERE ${where.join(' AND ')} ORDER BY t.updated_at DESC LIMIT ${lim} OFFSET ${off}`;
    const r=await pool.query(sql, params);
    ok(res,{ items:r.rows.map(x=>Object.assign({}, x, { author:displayAuthor(x) })), count:r.rowCount, limit, offset });
  }catch(e){ fail(res,500,'template list failed',{ detail:String(e.message||e) }); }
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
    if(q){
      params.push('%'+q+'%');
      const pn='$'+params.length;
      where.push(`(product_name ILIKE ${pn} OR mall_product_name ILIKE ${pn} OR option_name ILIKE ${pn} OR option_value ILIKE ${pn} OR product_uid ILIKE ${pn} OR pi_ii_vi ILIKE ${pn} OR category_keyword ILIKE ${pn})`);
    }
    if(category){ params.push(category); where.push(`(glomart_code=$${params.length} OR gm_category=$${params.length})`); }
    if(mall){ params.push(mall); where.push(`mall_code=$${params.length}`); }
    params.push(limit); const lim='$'+params.length;
    params.push(offset); const off='$'+params.length;
    const sql = `SELECT product_uid, mall_code, pi_ii_vi, glomart_code, gm_category, product_name, mall_product_name,
        option_name, option_value, mall_sale_price, final_supply_price, delivery_type, delivery_fee,
        delivery_eta_text, product_url, thumb_origin_url, thumb_file_name, soldout_yn, hit_count, updated_at
      FROM gm_product
      ${where.length?'WHERE '+where.join(' AND '):''}
      ORDER BY COALESCE(updated_at, created_at) DESC NULLS LAST
      LIMIT ${lim} OFFSET ${off}`;
    const r=await pool.query(sql, params);
    ok(res,{ items:r.rows, count:r.rowCount, limit, offset });
  }catch(e){ fail(res,500,'product search failed',{ detail:String(e.message||e) }); }
});

router.get('/api/gm/smartfit/template/:template_id', async (req,res)=>{
  try{
    const pool=db(req); const id=i(req.params.template_id,0);
    const r=await pool.query('SELECT * FROM gm_smartfit_template WHERE template_id=$1 AND is_active=$2', [id,'T']);
    const template=r.rows[0]; if(!template) return fail(res,404,'template not found');
    const items=await pool.query("SELECT * FROM gm_smartfit_item WHERE template_id=$1 AND is_active=$2 AND COALESCE(is_deleted,'F')<>'T' ORDER BY sort_order,item_id", [id,'T']);
    const media=await pool.query("SELECT * FROM gm_smartfit_media WHERE target_type='template' AND target_id=$1 AND is_active='T' ORDER BY sort_order, media_id", [String(id)]);
    ok(res,{ template, items:items.rows, media:media.rows });
  }catch(e){ fail(res,500,'template detail failed',{ detail:String(e.message||e) }); }
});

router.post('/api/gm/smartfit/template/save', async (req,res)=>{
  const pool=db(req); const client = await pool.connect();
  try{
    const b=req.body||{};
    const templateId=i(b.template_id || b.templateId, 0);
    const creator=s(b.creator_member_id || b.creatorMemberId || b.member_id || b.memberId);
    if(!creator) return fail(res,400,'creator_member_id required');
    let visibility=visibilityOf(b.visibility || 'draft', 'draft');
    await client.query('BEGIN');
    let existing=null;
    if(templateId){
      const rr=await client.query('SELECT * FROM gm_smartfit_template WHERE template_id=$1 FOR UPDATE', [templateId]);
      existing=rr.rows[0]||null;
      if(!existing) throw new Error('template not found');
      if(existing.creator_member_id !== creator){
        const mem = await getMember(client, creator);
        if(!isAdminMember(mem)) throw new Error('permission denied');
      }
    }
    if(visibility === 'public'){
      const base = existing || { purchase_count:0 };
      const pub = await canPublic(client, creator, base);
      if(!pub.ok) throw new Error('public requires purchase_count >= 1 or admin');
    }
    let spaceId = b.space_id || b.spaceId || null;
    const spaceName = s(b.space_name || b.spaceName || b.space_title || b.spaceTitle || '');
    if(!spaceId && spaceName){
      const nick = s(b.author_nickname || b.authorNickname || '') || await memberNickname(client, creator);
      const sr = await client.query(`INSERT INTO gm_smartfit_space (creator_member_id, owner_member_id, author_nickname, real_name_public, space_title, visibility, search_visible)
        VALUES ($1,$1,$2,$3,$4,$5,$6) RETURNING *`, [creator, nick, yn(b.real_name_public || b.realNamePublic, 'F'), spaceName, visibilityOf(b.space_visibility || b.spaceVisibility || 'private','private'), publicVisibility(b.space_visibility || b.spaceVisibility || 'private')]);
      spaceId = sr.rows[0].space_id;
    }
    const vals = {
      space_id: spaceId,
      creator_member_id: creator,
      category_code: s(b.category_code || b.categoryCode || ''),
      template_title_ko: s(b.template_title_ko || b.title_ko || b.title || ''),
      template_title_en: s(b.template_title_en || b.title_en || ''),
      template_title_gm_lang: s(b.template_title_gm_lang || b.title_gm_lang || ''),
      template_desc_ko: s(b.template_desc_ko || b.desc_ko || b.description || ''),
      template_desc_en: s(b.template_desc_en || b.desc_en || ''),
      template_desc_gm_lang: s(b.template_desc_gm_lang || b.desc_gm_lang || ''),
      creator_intro_ko: s(b.creator_intro_ko || ''),
      creator_intro_en: s(b.creator_intro_en || ''),
      creator_intro_gm_lang: s(b.creator_intro_gm_lang || ''),
      search_ko: s(b.search_ko || ''), search_en: s(b.search_en || ''), search_gm_lang: s(b.search_gm_lang || ''),
      search_ru: s(b.search_ru || ''), search_hi: s(b.search_hi || ''), search_fr: s(b.search_fr || ''), search_es: s(b.search_es || ''),
      visibility,
      search_visible: publicVisibility(visibility)
    };
    let saved;
    if(templateId){
      const r=await client.query(`UPDATE gm_smartfit_template SET
        space_id=$1, category_code=$2, template_title_ko=$3, template_title_en=$4, template_title_gm_lang=$5,
        template_desc_ko=$6, template_desc_en=$7, template_desc_gm_lang=$8, creator_intro_ko=$9, creator_intro_en=$10, creator_intro_gm_lang=$11,
        search_ko=$12, search_en=$13, search_gm_lang=$14, search_ru=$15, search_hi=$16, search_fr=$17, search_es=$18,
        visibility=$19, search_visible=$20, updated_at=CURRENT_TIMESTAMP WHERE template_id=$21 RETURNING *`,
        [vals.space_id, vals.category_code, vals.template_title_ko, vals.template_title_en, vals.template_title_gm_lang,
         vals.template_desc_ko, vals.template_desc_en, vals.template_desc_gm_lang, vals.creator_intro_ko, vals.creator_intro_en, vals.creator_intro_gm_lang,
         vals.search_ko, vals.search_en, vals.search_gm_lang, vals.search_ru, vals.search_hi, vals.search_fr, vals.search_es, vals.visibility, vals.search_visible, templateId]);
      saved=r.rows[0];
    }else{
      const r=await client.query(`INSERT INTO gm_smartfit_template (
        space_id, creator_member_id, category_code, template_title_ko, template_title_en, template_title_gm_lang,
        template_desc_ko, template_desc_en, template_desc_gm_lang, creator_intro_ko, creator_intro_en, creator_intro_gm_lang,
        search_ko, search_en, search_gm_lang, search_ru, search_hi, search_fr, search_es, visibility, search_visible
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING *`,
        [vals.space_id, vals.creator_member_id, vals.category_code, vals.template_title_ko, vals.template_title_en, vals.template_title_gm_lang,
         vals.template_desc_ko, vals.template_desc_en, vals.template_desc_gm_lang, vals.creator_intro_ko, vals.creator_intro_en, vals.creator_intro_gm_lang,
         vals.search_ko, vals.search_en, vals.search_gm_lang, vals.search_ru, vals.search_hi, vals.search_fr, vals.search_es, vals.visibility, vals.search_visible]);
      saved=r.rows[0];
    }
    if(Array.isArray(b.items)){
      // Creator editing soft-removes absent items. User selection qty=0 is NOT stored here.
      await client.query("UPDATE gm_smartfit_item SET is_deleted='T', deleted_at=CURRENT_TIMESTAMP, deleted_by=$1, updated_at=CURRENT_TIMESTAMP WHERE template_id=$2", [creator, saved.template_id]);
      let order=0;
      for(const it of b.items){
        const productUid=s(it.product_uid || it.productUid); if(!productUid) continue;
        await client.query(`INSERT INTO gm_smartfit_item (template_id,item_role,mall_code,product_uid,qty,default_checked,required_yn,creator_tip,sort_order,is_deleted,deleted_at,deleted_by)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'F',NULL,NULL)
          ON CONFLICT (template_id,mall_code,product_uid) DO UPDATE SET item_role=EXCLUDED.item_role, qty=EXCLUDED.qty, default_checked=EXCLUDED.default_checked, required_yn=EXCLUDED.required_yn, creator_tip=EXCLUDED.creator_tip, sort_order=EXCLUDED.sort_order, is_deleted='F', deleted_at=NULL, deleted_by=NULL, is_active='T', updated_at=CURRENT_TIMESTAMP`, [saved.template_id, s(it.item_role || it.role || 'ETC'), s(it.mall_code || it.mallCode || ''), productUid, Math.max(1,i(it.qty,1)), s(it.default_checked || it.defaultChecked || 'T') === 'F'?'F':'T', s(it.required_yn || it.requiredYn || 'F') === 'T'?'T':'F', s(it.creator_tip || it.tip || ''), i(it.sort_order, ++order)]);
      }
    }
    await client.query('COMMIT');
    ok(res,{ template:saved });
  }catch(e){ try{ await client.query('ROLLBACK'); }catch(_){} fail(res,400,'template save failed',{ detail:String(e.message||e) }); }
  finally{ client.release(); }
});

router.post('/api/gm/smartfit/template/public', async (req,res)=>{
  try{
    const pool=db(req); const templateId=i(req.body?.template_id || req.body?.templateId,0); const memberId=s(req.body?.member_id || req.body?.memberId || req.body?.creator_member_id);
    const r=await pool.query('SELECT * FROM gm_smartfit_template WHERE template_id=$1', [templateId]);
    const t=r.rows[0]; if(!t) return fail(res,404,'template not found');
    if(t.creator_member_id !== memberId){ const mem=await getMember(pool, memberId); if(!isAdminMember(mem)) return fail(res,403,'permission denied'); }
    const pub=await canPublic(pool, memberId, t); if(!pub.ok) return fail(res,403,'public not allowed',{ reason:pub.reason, purchase_count:t.purchase_count });
    const rr=await pool.query("UPDATE gm_smartfit_template SET visibility='public', search_visible='T', updated_at=CURRENT_TIMESTAMP WHERE template_id=$1 RETURNING *", [templateId]);
    ok(res,{ template:rr.rows[0], reason:pub.reason });
  }catch(e){ fail(res,500,'public failed',{ detail:String(e.message||e) }); }
});

router.post('/api/gm/smartfit/collection/add', async (req,res)=>{
  try{
    const pool=db(req); const member=s(req.body?.member_id || req.body?.memberId); const tid=i(req.body?.template_id || req.body?.templateId,0);
    if(!member || !tid) return fail(res,400,'member_id/template_id required');
    const r=await pool.query(`INSERT INTO gm_smartfit_collection (member_id,template_id,is_active,is_deleted,deleted_at,deleted_by) VALUES ($1,$2,'T','F',NULL,NULL)
      ON CONFLICT(member_id,template_id) DO UPDATE SET is_active='T', is_deleted='F', deleted_at=NULL, deleted_by=NULL, updated_at=CURRENT_TIMESTAMP RETURNING *`, [member, tid]);
    await recordEventInternal(pool, { template_id:tid, member_id:member, stat_type:'collection', amount:1, source:'collection' });
    ok(res,{ collection:r.rows[0] });
  }catch(e){ fail(res,500,'collection add failed',{ detail:String(e.message||e) }); }
});

router.get('/api/gm/smartfit/collection/list', async (req,res)=>{
  try{
    const pool=db(req); const member=s(req.query.member_id || req.query.memberId); if(!member) return fail(res,400,'member_id required');
    const r=await pool.query(`SELECT c.*, t.template_title_ko, t.template_title_en, t.template_title_gm_lang, t.category_code, t.creator_member_id
      FROM gm_smartfit_collection c JOIN gm_smartfit_template t ON t.template_id=c.template_id
      WHERE c.member_id=$1 AND c.is_active='T' AND COALESCE(c.is_deleted,'F')<>'T' AND t.is_active='T' ORDER BY c.updated_at DESC`, [member]);
    ok(res,{ items:r.rows, count:r.rowCount });
  }catch(e){ fail(res,500,'collection list failed',{ detail:String(e.message||e) }); }
});

router.post('/api/gm/smartfit/build-cart', async (req,res)=>{
  try{
    const pool=db(req); const member=s(req.body?.member_id || req.body?.memberId || '');
    const templateIds = (Array.isArray(req.body?.template_ids) ? req.body.template_ids : Array.isArray(req.body?.templateIds) ? req.body.templateIds : [req.body?.template_id || req.body?.templateId]).map(x=>i(x,0)).filter(Boolean);
    if(!templateIds.length) return fail(res,400,'template_ids required');
    const r=await pool.query(`SELECT t.template_id, t.creator_member_id, t.category_code, t.template_title_ko, i.item_id, i.item_role, i.mall_code, i.product_uid, i.qty, i.default_checked, i.required_yn, i.creator_tip, i.sort_order
      FROM gm_smartfit_template t JOIN gm_smartfit_item i ON i.template_id=t.template_id AND i.is_active='T' AND COALESCE(i.is_deleted,'F')<>'T'
      WHERE t.template_id = ANY($1::bigint[]) AND t.is_active='T'
      ORDER BY array_position($1::bigint[], t.template_id), i.sort_order, i.item_id`, [templateIds]);
    const batchId = 'SFB_' + Date.now() + '_' + Math.random().toString(16).slice(2,8);
    const items = r.rows.map(row=>({
      batch_id:batchId,
      template_id:row.template_id,
      creator_member_id:row.creator_member_id,
      category_code:row.category_code,
      template_title:row.template_title_ko,
      item_id:row.item_id,
      item_role:row.item_role,
      mall_code:row.mall_code,
      product_uid:row.product_uid,
      original_qty:i(row.qty,1),
      selected_qty:row.default_checked === 'F' ? 0 : i(row.qty,1),
      is_selected:row.default_checked !== 'F',
      required_yn:row.required_yn,
      creator_tip:row.creator_tip,
      sort_order:row.sort_order
    }));
    // No UID merge here. JS/order page may set selected_qty=0 before final order.
    for(const tid of templateIds){ await recordEventInternal(pool, { template_id:tid, member_id:member, stat_type:'use', amount:1, source:'build-cart' }); }
    ok(res,{ batch_id:batchId, template_ids:templateIds, items, count:items.length, note:'no automatic merge; keep template ownership' });
  }catch(e){ fail(res,500,'build cart failed',{ detail:String(e.message||e) }); }
});


router.get('/api/gm/smartfit/media/list', async (req,res)=>{
  try{
    const pool=db(req); const targetType=s(req.query.target_type || req.query.targetType || 'template'); const targetId=s(req.query.target_id || req.query.targetId || req.query.template_id || '');
    if(!targetId) return fail(res,400,'target_id required');
    const r=await pool.query(`SELECT * FROM gm_smartfit_media WHERE target_type=$1 AND target_id=$2 AND is_active='T' AND COALESCE(is_deleted,'F')<>'T' ORDER BY sort_order, media_id`, [targetType, targetId]);
    ok(res,{ items:r.rows, count:r.rowCount });
  }catch(e){ fail(res,500,'media list failed',{ detail:String(e.message||e) }); }
});

router.post('/api/gm/smartfit/media/save', async (req,res)=>{
  const pool=db(req); const client=await pool.connect();
  try{
    const b=req.body||{}; const targetType=s(b.target_type || b.targetType || 'template'); const targetId=s(b.target_id || b.targetId || b.template_id || '');
    if(!targetId) return fail(res,400,'target_id required');
    const list=Array.isArray(b.media) ? b.media : Array.isArray(b.items) ? b.items : [];
    await client.query('BEGIN');
    if(b.replace !== false){ await client.query("UPDATE gm_smartfit_media SET is_active='F', updated_at=CURRENT_TIMESTAMP WHERE target_type=$1 AND target_id=$2", [targetType, targetId]); }
    const saved=[]; let order=0;
    for(const m of list){
      const url=s(m.url); if(!url) continue;
      const r=await client.query(`INSERT INTO gm_smartfit_media (target_type,target_id,media_type,url,thumbnail_url,title,sort_order)
        VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [targetType, targetId, s(m.media_type || m.mediaType || 'image'), url, s(m.thumbnail_url || m.thumbnailUrl || ''), s(m.title || ''), i(m.sort_order, ++order)]);
      saved.push(r.rows[0]);
    }
    await client.query('COMMIT');
    ok(res,{ items:saved, count:saved.length });
  }catch(e){ try{ await client.query('ROLLBACK'); }catch(_){} fail(res,500,'media save failed',{ detail:String(e.message||e) }); }
  finally{ client.release(); }
});

router.get('/api/gm/smartfit/comment/list', async (req,res)=>{
  try{
    const pool=db(req); const templateId=i(req.query.template_id || req.query.templateId,0); if(!templateId) return fail(res,400,'template_id required');
    const r=await pool.query(`SELECT * FROM gm_smartfit_comment WHERE template_id=$1 AND is_active='T' AND COALESCE(is_deleted,'F')<>'T' ORDER BY created_at DESC LIMIT 200`, [templateId]);
    ok(res,{ items:r.rows, count:r.rowCount });
  }catch(e){ fail(res,500,'comment list failed',{ detail:String(e.message||e) }); }
});

router.post('/api/gm/smartfit/comment/add', async (req,res)=>{
  try{
    const pool=db(req); const b=req.body||{}; const templateId=i(b.template_id || b.templateId,0); const member=s(b.member_id || b.memberId || '');
    if(!templateId) return fail(res,400,'template_id required');
    const ratingRaw=b.rating === undefined || b.rating === null || b.rating === '' ? null : n(b.rating,0);
    const r=await pool.query(`INSERT INTO gm_smartfit_comment (template_id,member_id,parent_id,rating,body,is_creator_reply)
      VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [templateId, member, b.parent_id || b.parentId || null, ratingRaw, s(b.body || b.comment || ''), s(b.is_creator_reply || b.isCreatorReply || 'F') === 'T'?'T':'F']);
    if(ratingRaw !== null){
      await recordEventInternal(pool, { template_id:templateId, member_id:member, stat_type:'review', amount:1, source:'comment' });
      await recordEventInternal(pool, { template_id:templateId, member_id:member, stat_type:'rating', amount:ratingRaw, source:'comment' });
    }
    ok(res,{ comment:r.rows[0] });
  }catch(e){ fail(res,500,'comment add failed',{ detail:String(e.message||e) }); }
});

async function recordEventInternal(pool, body){
  const templateId = i(body.template_id || body.templateId,0) || null;
  let categoryCode=s(body.category_code || body.categoryCode || '');
  let creator=s(body.creator_member_id || body.creatorMemberId || '');
  let spaceId=body.space_id || body.spaceId || null;
  if(templateId && (!categoryCode || !creator || !spaceId)){
    const tr=await pool.query('SELECT template_id,space_id,category_code,creator_member_id FROM gm_smartfit_template WHERE template_id=$1', [templateId]);
    const t=tr.rows[0]||{};
    categoryCode = categoryCode || s(t.category_code);
    creator = creator || s(t.creator_member_id);
    spaceId = spaceId || t.space_id || null;
  }
  let statType=s(body.stat_type || body.statType || body.type); if(!STAT_TYPES.has(statType)) throw new Error('invalid stat_type');
  const amount=n(body.amount,1);
  const lang=LANGS.has(s(body.lang_code || body.langCode)) ? s(body.lang_code || body.langCode) : 'ot';
  const member=s(body.member_id || body.memberId || '');
  const orderId=s(body.order_id || body.orderId || '');
  const source=s(body.source || '');
  const now = body.created_at ? new Date(body.created_at) : new Date();
  const k=kstParts(now);
  await pool.query(`INSERT INTO gm_smartfit_event (space_id,template_id,category_code,creator_member_id,member_id,stat_type,amount,lang_code,order_id,source,meta_json)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [spaceId, templateId, categoryCode, creator, member, statType, amount, lang, orderId, source, body.meta_json || body.meta || null]);
  if(templateId) await addMonthly(pool, monthlyTemplateTable(k.ym), 'template_id', String(templateId), statType, lang, creator, amount, k.day);
  if(categoryCode) await addMonthly(pool, monthlyCategoryTable(k.ym), 'category_code', categoryCode, statType, lang, creator, amount, k.day);
  await incrementCounters(pool, templateId, statType, amount);
  return { template_id:templateId, category_code:categoryCode, stat_type:statType, amount, lang_code:lang, ym:k.ym, day:k.day };
}
router.post('/api/gm/smartfit/event', async (req,res)=>{
  try{ const data = await recordEventInternal(db(req), req.body||{}); ok(res,{ event:data }); }
  catch(e){ fail(res,400,'event failed',{ detail:String(e.message||e) }); }
});

router.get('/api/gm/smartfit/stat/monthly', async (req,res)=>{
  try{
    const pool=db(req); const ym=safeYm(req.query.ym || kstParts().ym); const target=s(req.query.target || 'template');
    const id=s(req.query.id || req.query.template_id || req.query.category_code || '');
    const table = target === 'category' ? monthlyCategoryTable(ym) : monthlyTemplateTable(ym);
    const key = target === 'category' ? 'category_code' : 'template_id';
    await ensureMonthlyTable(pool, table, key);
    const params=[]; let where='';
    if(id){ params.push(id); where=`WHERE ${key}=$1`; }
    const r=await pool.query(`SELECT * FROM ${qident(table)} ${where} ORDER BY total DESC LIMIT 500`, params);
    ok(res,{ ym, target, items:r.rows, count:r.rowCount });
  }catch(e){ fail(res,500,'monthly stat failed',{ detail:String(e.message||e) }); }
});


router.post('/api/gm/smartfit/space/save', async (req,res)=>{
  const pool=db(req); const client=await pool.connect();
  try{
    const b=req.body||{}; const member=s(b.member_id || b.memberId || b.creator_member_id || b.owner_member_id);
    if(!member) return fail(res,400,'member_id required');
    const spaceId=i(b.space_id || b.spaceId,0);
    const visibility=visibilityOf(b.visibility || 'private','private');
    const nick=s(b.author_nickname || b.authorNickname || '') || await memberNickname(client, member);
    await client.query('BEGIN');
    let saved;
    if(spaceId){
      const old=(await client.query('SELECT * FROM gm_smartfit_space WHERE space_id=$1 FOR UPDATE',[spaceId])).rows[0];
      if(!old) throw new Error('space not found');
      if(!(await isOwnerOrAdmin(client, member, old.owner_member_id || old.creator_member_id))) throw new Error('permission denied');
      const r=await client.query(`UPDATE gm_smartfit_space SET author_nickname=$1, real_name_public=$2, space_title=$3, space_title_en=$4, space_title_gm_lang=$5,
        space_desc=$6, space_desc_en=$7, space_desc_gm_lang=$8, youtube_url=$9, image_url=$10, visibility=$11, search_visible=$12, is_deleted='F', deleted_at=NULL, deleted_by=NULL, updated_at=CURRENT_TIMESTAMP
        WHERE space_id=$13 RETURNING *`, [nick, yn(b.real_name_public || b.realNamePublic,'F'), s(b.space_title || b.spaceTitle || b.space_name || b.spaceName || ''), s(b.space_title_en || b.spaceTitleEn || ''), s(b.space_title_gm_lang || b.spaceTitleGmLang || ''), s(b.space_desc || b.description || ''), s(b.space_desc_en || ''), s(b.space_desc_gm_lang || ''), s(b.youtube_url || b.youtubeUrl || ''), s(b.image_url || b.imageUrl || ''), visibility, publicVisibility(visibility), spaceId]);
      saved=r.rows[0];
    }else{
      const r=await client.query(`INSERT INTO gm_smartfit_space (creator_member_id,owner_member_id,author_nickname,real_name_public,space_title,space_title_en,space_title_gm_lang,space_desc,space_desc_en,space_desc_gm_lang,youtube_url,image_url,visibility,search_visible)
        VALUES ($1,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`, [member, nick, yn(b.real_name_public || b.realNamePublic,'F'), s(b.space_title || b.spaceTitle || b.space_name || b.spaceName || ''), s(b.space_title_en || b.spaceTitleEn || ''), s(b.space_title_gm_lang || b.spaceTitleGmLang || ''), s(b.space_desc || b.description || ''), s(b.space_desc_en || ''), s(b.space_desc_gm_lang || ''), s(b.youtube_url || b.youtubeUrl || ''), s(b.image_url || b.imageUrl || ''), visibility, publicVisibility(visibility)]);
      saved=r.rows[0];
    }
    await client.query('COMMIT');
    ok(res,{ space:saved, author:displayAuthor(saved) });
  }catch(e){ try{await client.query('ROLLBACK');}catch(_){} fail(res,400,'space save failed',{ detail:String(e.message||e) }); }
  finally{ client.release(); }
});

router.get('/api/gm/smartfit/space/list', async (req,res)=>{
  try{
    const pool=db(req); const member=s(req.query.member_id || req.query.memberId || ''); const mine=s(req.query.mine || '')==='1' || s(req.query.scope)==='mine';
    const params=[]; const where=[`sp.is_active='T'`, `COALESCE(sp.is_deleted,'F')<>'T'`];
    if(mine && member){ params.push(member); where.push(`sp.owner_member_id=$${params.length}`); }
    else { where.push(`sp.visibility='public'`); where.push(`COALESCE(sp.search_visible,'T')='T'`); }
    const r=await pool.query(`SELECT sp.*, m.member_name, m.member_nickname FROM gm_smartfit_space sp LEFT JOIN gm_member m ON m.member_id=sp.owner_member_id WHERE ${where.join(' AND ')} ORDER BY sp.updated_at DESC LIMIT 200`, params);
    ok(res,{ items:r.rows.map(x=>Object.assign({}, x, { author:displayAuthor(x) })), count:r.rowCount });
  }catch(e){ fail(res,500,'space list failed',{ detail:String(e.message||e) }); }
});

async function referenceCount(client, type, id, owner){
  if(type==='template'){
    const r=await client.query(`SELECT COUNT(*)::int AS cnt FROM gm_smartfit_collection WHERE template_id=$1 AND member_id<>$2 AND is_active='T' AND COALESCE(is_deleted,'F')<>'T'`, [id, owner]);
    return i(r.rows[0] && r.rows[0].cnt,0);
  }
  if(type==='space'){
    const r=await client.query(`SELECT COUNT(*)::int AS cnt FROM gm_smartfit_collection c JOIN gm_smartfit_template t ON t.template_id=c.template_id WHERE t.space_id=$1 AND c.member_id<>$2 AND c.is_active='T' AND COALESCE(c.is_deleted,'F')<>'T'`, [id, owner]);
    return i(r.rows[0] && r.rows[0].cnt,0);
  }
  if(type==='item'){
    const r=await client.query(`SELECT COUNT(*)::int AS cnt FROM gm_smartfit_collection c JOIN gm_smartfit_item i ON i.template_id=c.template_id JOIN gm_smartfit_template t ON t.template_id=i.template_id WHERE i.item_id=$1 AND c.member_id<>$2 AND c.is_active='T' AND COALESCE(c.is_deleted,'F')<>'T'`, [id, owner]);
    return i(r.rows[0] && r.rows[0].cnt,0);
  }
  return 0;
}
async function trashTarget(client, type, id){
  if(type==='space') return (await client.query('SELECT space_id AS id, owner_member_id AS owner_id, creator_member_id FROM gm_smartfit_space WHERE space_id=$1',[id])).rows[0];
  if(type==='template') return (await client.query('SELECT template_id AS id, creator_member_id AS owner_id FROM gm_smartfit_template WHERE template_id=$1',[id])).rows[0];
  if(type==='item') return (await client.query('SELECT i.item_id AS id, t.creator_member_id AS owner_id, i.template_id FROM gm_smartfit_item i JOIN gm_smartfit_template t ON t.template_id=i.template_id WHERE i.item_id=$1',[id])).rows[0];
  return null;
}
async function updateTrashState(client, type, id, member, deleted){
  if(deleted){
    if(type==='space') return client.query(`UPDATE gm_smartfit_space SET is_deleted='T', deleted_at=CURRENT_TIMESTAMP, deleted_by=$1, search_visible='F', updated_at=CURRENT_TIMESTAMP WHERE space_id=$2 RETURNING *`, [member, id]);
    if(type==='template') return client.query(`UPDATE gm_smartfit_template SET is_deleted='T', deleted_at=CURRENT_TIMESTAMP, deleted_by=$1, search_visible='F', updated_at=CURRENT_TIMESTAMP WHERE template_id=$2 RETURNING *`, [member, id]);
    if(type==='item') return client.query(`UPDATE gm_smartfit_item SET is_deleted='T', deleted_at=CURRENT_TIMESTAMP, deleted_by=$1, updated_at=CURRENT_TIMESTAMP WHERE item_id=$2 RETURNING *`, [member, id]);
  }else{
    if(type==='space') return client.query(`UPDATE gm_smartfit_space SET is_deleted='F', deleted_at=NULL, deleted_by=NULL, updated_at=CURRENT_TIMESTAMP WHERE space_id=$1 RETURNING *`, [id]);
    if(type==='template') return client.query(`UPDATE gm_smartfit_template SET is_deleted='F', deleted_at=NULL, deleted_by=NULL, updated_at=CURRENT_TIMESTAMP WHERE template_id=$1 RETURNING *`, [id]);
    if(type==='item') return client.query(`UPDATE gm_smartfit_item SET is_deleted='F', deleted_at=NULL, deleted_by=NULL, updated_at=CURRENT_TIMESTAMP WHERE item_id=$1 RETURNING *`, [id]);
  }
  throw new Error('invalid target_type');
}
router.post('/api/gm/smartfit/trash/move', async (req,res)=>{
  const client=await db(req).connect();
  try{
    const type=s(req.body?.target_type || req.body?.type); const id=i(req.body?.target_id || req.body?.id,0); const member=s(req.body?.member_id || req.body?.memberId);
    if(!type || !id || !member) return fail(res,400,'target_type/target_id/member_id required');
    await client.query('BEGIN');
    const target=await trashTarget(client,type,id); if(!target) throw new Error('target not found');
    if(!(await isOwnerOrAdmin(client, member, target.owner_id))) throw new Error('permission denied');
    const r=await updateTrashState(client,type,id,member,true);
    await client.query('COMMIT');
    ok(res,{ item:r.rows[0], message:'삭제되었습니다. 추후 복원 메뉴에서 복원할 수 있습니다.' });
  }catch(e){ try{await client.query('ROLLBACK');}catch(_){} fail(res,400,'trash move failed',{ detail:String(e.message||e) }); }
  finally{ client.release(); }
});
router.post('/api/gm/smartfit/trash/restore', async (req,res)=>{
  const client=await db(req).connect();
  try{
    const type=s(req.body?.target_type || req.body?.type); const ids=(Array.isArray(req.body?.target_ids)?req.body.target_ids:[req.body?.target_id || req.body?.id]).map(x=>i(x,0)).filter(Boolean); const member=s(req.body?.member_id || req.body?.memberId);
    if(!type || !ids.length || !member) return fail(res,400,'target_type/target_ids/member_id required');
    await client.query('BEGIN'); const out=[];
    for(const id of ids){ const target=await trashTarget(client,type,id); if(!target) continue; if(!(await isOwnerOrAdmin(client, member, target.owner_id))) throw new Error('permission denied'); const r=await updateTrashState(client,type,id,member,false); out.push(r.rows[0]); }
    await client.query('COMMIT'); ok(res,{ items:out, count:out.length });
  }catch(e){ try{await client.query('ROLLBACK');}catch(_){} fail(res,400,'trash restore failed',{ detail:String(e.message||e) }); }
  finally{ client.release(); }
});
router.post('/api/gm/smartfit/trash/permanent-delete', async (req,res)=>{
  const client=await db(req).connect();
  try{
    const type=s(req.body?.target_type || req.body?.type); const ids=(Array.isArray(req.body?.target_ids)?req.body.target_ids:[req.body?.target_id || req.body?.id]).map(x=>i(x,0)).filter(Boolean); const member=s(req.body?.member_id || req.body?.memberId);
    if(!type || !ids.length || !member) return fail(res,400,'target_type/target_ids/member_id required');
    await client.query('BEGIN'); const deleted=[]; const blocked=[];
    for(const id of ids){
      const target=await trashTarget(client,type,id); if(!target) continue;
      if(!(await isOwnerOrAdmin(client, member, target.owner_id))) throw new Error('permission denied');
      const refs=await referenceCount(client,type,id,target.owner_id);
      if(refs>0){ blocked.push({id, refs, reason:'used_by_other_member'}); continue; }
      if(type==='space'){ await client.query('DELETE FROM gm_smartfit_item WHERE template_id IN (SELECT template_id FROM gm_smartfit_template WHERE space_id=$1)',[id]); await client.query('DELETE FROM gm_smartfit_template WHERE space_id=$1',[id]); await client.query('DELETE FROM gm_smartfit_space WHERE space_id=$1',[id]); }
      else if(type==='template'){ await client.query('DELETE FROM gm_smartfit_item WHERE template_id=$1',[id]); await client.query('DELETE FROM gm_smartfit_template WHERE template_id=$1',[id]); }
      else if(type==='item'){ await client.query('DELETE FROM gm_smartfit_item WHERE item_id=$1',[id]); }
      deleted.push(id);
    }
    await client.query('COMMIT'); ok(res,{ deleted, blocked, message:blocked.length?'다른 사용자가 사용 중인 항목은 영구삭제하지 않았습니다.':'' });
  }catch(e){ try{await client.query('ROLLBACK');}catch(_){} fail(res,400,'permanent delete failed',{ detail:String(e.message||e) }); }
  finally{ client.release(); }
});
router.get('/api/gm/smartfit/trash/list', async (req,res)=>{
  try{
    const pool=db(req); const member=s(req.query.member_id || req.query.memberId); const type=s(req.query.target_type || req.query.type || 'template');
    if(!member) return fail(res,400,'member_id required');
    let sql, params=[member];
    if(type==='space') sql="SELECT * FROM gm_smartfit_space WHERE owner_member_id=$1 AND COALESCE(is_deleted,'F')='T' ORDER BY deleted_at DESC";
    else if(type==='item') sql="SELECT i.* FROM gm_smartfit_item i JOIN gm_smartfit_template t ON t.template_id=i.template_id WHERE t.creator_member_id=$1 AND COALESCE(i.is_deleted,'F')='T' ORDER BY i.deleted_at DESC";
    else sql="SELECT * FROM gm_smartfit_template WHERE creator_member_id=$1 AND COALESCE(is_deleted,'F')='T' ORDER BY deleted_at DESC";
    const r=await pool.query(sql, params); ok(res,{ items:r.rows, count:r.rowCount, target_type:type });
  }catch(e){ fail(res,500,'trash list failed',{ detail:String(e.message||e) }); }
});

module.exports = router;
