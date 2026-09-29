'use strict';
const express = require('express');
const router = express.Router();
function pool(req){ return req.app.locals.pool || req.app.locals.db; }
function s(v){ return v === undefined || v === null ? '' : String(v).trim(); }

// G-PAY 전용 최소 회원정보 읽기 API.
// 금액/비밀번호/연락처/주문정보 등은 절대 반환하지 않는다.
router.get('/api/gm/gpay/member-profile', async (req, res) => {
  const memberId = s(req.query.member_id || req.query.id);
  if(!memberId) return res.status(400).json({ok:false,error:'MEMBER_ID_REQUIRED'});
  const p = pool(req);
  if(!p) return res.status(500).json({ok:false,error:'DB_NOT_READY'});
  try{
    const mr = await p.query(`
      SELECT member_id,cafe24_member_id,country_code,nationality,recommender_id,
             default_sido,default_sigungu,default_eup_myeon_dong,default_address_full
        FROM gm_member
       WHERE member_id=$1 OR cafe24_member_id=$1
       ORDER BY CASE WHEN member_id=$1 THEN 0 ELSE 1 END
       LIMIT 1`, [memberId]);
    if(!mr.rowCount) return res.status(404).json({ok:false,error:'MEMBER_NOT_FOUND',member_id:memberId});
    const m = mr.rows[0];
    let a = null;
    try{
      const ar = await p.query(`
        SELECT sido,sigungu,eup_myeon_dong,address_full
          FROM gm_member_address
         WHERE member_id=$1
         ORDER BY CASE WHEN is_default='Y' THEN 0 ELSE 1 END, updated_at DESC NULLS LAST, created_at DESC NULLS LAST
         LIMIT 1`, [m.member_id]);
      a = ar.rows[0] || null;
    }catch(_e){}
    res.json({
      ok:true,
      member_id:s(m.member_id),
      country_code:s(m.country_code).toUpperCase(),
      nationality:s(m.nationality),
      recommender_id:s(m.recommender_id),
      address:{
        sido:s((a&&a.sido)||m.default_sido),
        sigungu:s((a&&a.sigungu)||m.default_sigungu),
        eup_myeon_dong:s((a&&a.eup_myeon_dong)||m.default_eup_myeon_dong),
        full:s((a&&a.address_full)||m.default_address_full)
      }
    });
  }catch(e){
    console.error('[GM_GPAY_MEMBER_PROFILE_V001] failed', e && e.message || e);
    res.status(500).json({ok:false,error:'MEMBER_PROFILE_READ_FAILED'});
  }
});
module.exports = router;
