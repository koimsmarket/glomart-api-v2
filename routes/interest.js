const express = require('express');
const router = express.Router();

function db(req){ return req.app.locals.db || req.app.locals.pool; }
function s(v,d=null){ return v===undefined||v===null||v==='' ? d : String(v).trim(); }
function b(v){ return v === true || v === 'true' || v === 'Y' || v === 'y' || v === '1' || v === 1; }
function ownerWhere(input){
  const member=s(input.member_id || input.memberId);
  const guest=s(input.guest_key || input.guestKey);
  if(member) return { col:'member_id', val:member };
  if(guest) return { col:'guest_key', val:guest };
  return null;
}
function itemKey(input){
  const mall=s(input.mall_code || input.mallCode, 'CPKR');
  const pi=s(input.pi_ii_vi || input.piIiVi || input.pi);
  return { mall_code:mall, pi_ii_vi:pi };
}
function productUid(row){ return row ? Object.assign({}, row, { product_uid: `${row.mall_code}_${row.pi_ii_vi}` }) : row; }

async function touchProductInterest(pool, key, eventType){
  if(!key || !key.mall_code || !key.pi_ii_vi) return;
  if(eventType === 'wish') {
    await pool.query(`
      UPDATE gm_product
      SET wish_count=COALESCE(wish_count,0)+1,
          last_wish_at=NOW(),
          expire_at=GREATEST(COALESCE(expire_at, NOW()), NOW() + INTERVAL '180 days'),
          updated_at=NOW()
      WHERE mall_code=$1 AND pi_ii_vi=$2
    `, [key.mall_code, key.pi_ii_vi]).catch(()=>{});
  }
  if(eventType === 'detail') {
    await pool.query(`
      UPDATE gm_product
      SET detail_view_count=COALESCE(detail_view_count,0)+1,
          expire_at=GREATEST(COALESCE(expire_at, NOW()), NOW() + INTERVAL '90 days'),
          updated_at=NOW()
      WHERE mall_code=$1 AND pi_ii_vi=$2
    `, [key.mall_code, key.pi_ii_vi]).catch(()=>{});
  }
}

async function findOne(pool, owner, key){
  const r=await pool.query(
    `SELECT * FROM gm_product_interest WHERE ${owner.col}=$1 AND mall_code=$2 AND pi_ii_vi=$3 LIMIT 1`,
    [owner.val, key.mall_code, key.pi_ii_vi]
  );
  return r.rows[0] || null;
}
async function insertVisit(pool, input, owner, key){
  const r=await pool.query(
    `INSERT INTO gm_product_interest (member_id, guest_key, mall_code, pi_ii_vi, is_wish, visit_count, last_visited_at)
     VALUES ($1,$2,$3,$4,$5,1,NOW())
     RETURNING *`,
    [s(input.member_id || input.memberId), s(input.guest_key || input.guestKey), key.mall_code, key.pi_ii_vi, b(input.is_wish || input.isWish)]
  );
  return r.rows[0];
}
async function recordVisit(pool, input){
  const owner=ownerWhere(input), key=itemKey(input);
  if(!owner) throw new Error('member_id or guest_key is required');
  if(!key.mall_code || !key.pi_ii_vi) throw new Error('mall_code and pi_ii_vi are required');
  const existing=await findOne(pool, owner, key);
  if(existing){
    const r=await pool.query(
      `UPDATE gm_product_interest
       SET visit_count=visit_count+1, last_visited_at=NOW()
       WHERE ${owner.col}=$1 AND mall_code=$2 AND pi_ii_vi=$3
       RETURNING *`,
      [owner.val, key.mall_code, key.pi_ii_vi]
    );
    return r.rows[0];
  }
  return insertVisit(pool, input, owner, key);
}
async function setWish(pool, input, wish){
  const owner=ownerWhere(input), key=itemKey(input);
  if(!owner) throw new Error('member_id or guest_key is required');
  if(!key.mall_code || !key.pi_ii_vi) throw new Error('mall_code and pi_ii_vi are required');
  const existing=await findOne(pool, owner, key);
  if(existing){
    const r=await pool.query(
      `UPDATE gm_product_interest
       SET is_wish=$1, last_visited_at=COALESCE(last_visited_at,NOW())
       WHERE ${owner.col}=$2 AND mall_code=$3 AND pi_ii_vi=$4
       RETURNING *`,
      [wish, owner.val, key.mall_code, key.pi_ii_vi]
    );
    return r.rows[0];
  }
  const r=await pool.query(
    `INSERT INTO gm_product_interest (member_id, guest_key, mall_code, pi_ii_vi, is_wish, visit_count, last_visited_at)
     VALUES ($1,$2,$3,$4,$5,0,NOW())
     RETURNING *`,
    [s(input.member_id || input.memberId), s(input.guest_key || input.guestKey), key.mall_code, key.pi_ii_vi, wish]
  );
  return r.rows[0];
}

router.post('/api/interest/visit', async (req,res)=>{
  const pool=db(req); if(!pool) return res.status(500).json({ok:false,error:'DB pool is not attached'});
  try{ const row=await recordVisit(pool, req.body || {}); await touchProductInterest(pool,itemKey(req.body||{}),'detail'); res.json({ok:true,item:productUid(row)}); }
  catch(e){ res.status(500).json({ok:false,error:e.message}); }
});
router.post('/api/gm/interest/visit', async (req,res)=>{
  const pool=db(req); if(!pool) return res.status(500).json({ok:false,error:'DB pool is not attached'});
  try{ const row=await recordVisit(pool, req.body || {}); await touchProductInterest(pool,itemKey(req.body||{}),'detail'); res.json({ok:true,item:productUid(row)}); }
  catch(e){ res.status(500).json({ok:false,error:e.message}); }
});
router.post('/api/interest/wish', async (req,res)=>{
  const pool=db(req); if(!pool) return res.status(500).json({ok:false,error:'DB pool is not attached'});
  try{ const row=await setWish(pool, req.body || {}, true); await touchProductInterest(pool,itemKey(req.body||{}),'wish'); res.json({ok:true,item:productUid(row)}); }
  catch(e){ res.status(500).json({ok:false,error:e.message}); }
});
router.post('/api/gm/interest/wish', async (req,res)=>{
  const pool=db(req); if(!pool) return res.status(500).json({ok:false,error:'DB pool is not attached'});
  try{ const row=await setWish(pool, req.body || {}, true); await touchProductInterest(pool,itemKey(req.body||{}),'wish'); res.json({ok:true,item:productUid(row)}); }
  catch(e){ res.status(500).json({ok:false,error:e.message}); }
});
router.post('/api/interest/unwish', async (req,res)=>{
  const pool=db(req); if(!pool) return res.status(500).json({ok:false,error:'DB pool is not attached'});
  try{ const row=await setWish(pool, req.body || {}, false); res.json({ok:true,item:productUid(row)}); }
  catch(e){ res.status(500).json({ok:false,error:e.message}); }
});
router.post('/api/gm/interest/unwish', async (req,res)=>{
  const pool=db(req); if(!pool) return res.status(500).json({ok:false,error:'DB pool is not attached'});
  try{ const row=await setWish(pool, req.body || {}, false); res.json({ok:true,item:productUid(row)}); }
  catch(e){ res.status(500).json({ok:false,error:e.message}); }
});

async function list(req,res, wishOnly){
  const pool=db(req), owner=ownerWhere(req.query || {});
  if(!pool) return res.status(500).json({ok:false,error:'DB pool is not attached'});
  if(!owner) return res.status(400).json({ok:false,error:'member_id or guest_key is required'});
  const limit=Math.min(100, Math.max(1, parseInt(req.query.limit || '30', 10) || 30));
  try{
    const where = wishOnly ? `WHERE ${owner.col}=$1 AND is_wish=TRUE` : `WHERE ${owner.col}=$1`;
    const r=await pool.query(
      `SELECT *, (mall_code || '_' || pi_ii_vi) AS product_uid
       FROM gm_product_interest
       ${where}
       ORDER BY is_wish DESC, visit_count DESC, last_visited_at DESC
       LIMIT $2`,
      [owner.val, limit]
    );
    res.json({ok:true,items:r.rows});
  }catch(e){ res.status(500).json({ok:false,error:e.message}); }
}
router.get('/api/interest/recent', (req,res)=>list(req,res,false));
router.get('/api/gm/interest/recent', (req,res)=>list(req,res,false));
router.get('/api/interest/wishlist', (req,res)=>list(req,res,true));
router.get('/api/gm/interest/wishlist', (req,res)=>list(req,res,true));

module.exports=router;
