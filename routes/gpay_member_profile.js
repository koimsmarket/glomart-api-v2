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

// GM_GPAY_SINGLE_V031: exact-match recipient resolution, restricted to trusted LIFE bridge.
router.get('/api/gm/gpay/recipient-lookup', async (req,res) => {
 res.set('Cache-Control','no-store');
 const secret=s(process.env.GPAY_TRUSTED_CALLER_KEY);
 const provided=s(req.get('x-gpay-trusted-caller'));
 const crypto=require('crypto');
 if(secret.length<32 || provided.length!==secret.length || !crypto.timingSafeEqual(Buffer.from(secret),Buffer.from(provided))){console.warn('[GM_GPAY_RECIPIENT_V036] stage=AUTH_REJECT configured='+(secret.length>=32)+' provided='+(provided.length>0));return res.status(403).json({ok:false,error:'TRUSTED_LOOKUP_REQUIRED'});}
 const query=s(req.query.q);
 const phone=/^[+0-9() .-]{9,25}$/.test(query)&&query.replace(/\D/g,'').length>=9;
 const id=/^[a-zA-Z0-9_.@-]{2,64}$/.test(query);
 if(!phone&&!id)return res.status(400).json({ok:false,error:'INVALID_LOOKUP'});
 const db=pool(req);if(!db)return res.status(503).json({ok:false,error:'DB_UNAVAILABLE'});
 try{
  const v=phone?query.replace(/\D/g,''):query;
  const sql=phone?`SELECT member_id,member_name,phone FROM gm_member WHERE regexp_replace(COALESCE(phone,''),'[^0-9]','','g')=$1 ORDER BY member_id LIMIT 51`:`SELECT member_id,member_name,phone FROM gm_member WHERE LOWER(member_id)=LOWER($1) ORDER BY member_id LIMIT 51`;
  const result=await db.query(sql,[v]);
  if(result.rows.length>50)return res.status(409).json({ok:false,error:'TOO_MANY_MATCHES_USE_MEMBER_ID'});
  const recipients=result.rows.map(m=>{const digits=s(m.phone).replace(/\D/g,'');const name=s(m.member_name);return {member_id:s(m.member_id),masked_name:name.length>1?name[0]+'*'.repeat(Math.min(name.length-1,3)):name||'회원',masked_phone:digits.length>=10?digits.slice(0,3)+'-****-'+digits.slice(-4):''};});
  console.info('[GM_GPAY_RECIPIENT_V035] lookup match_count='+recipients.length+' mode='+(phone?'PHONE':'ID'));
  return res.json({ok:true,found:recipients.length>0,recipients,recipient:recipients.length===1?recipients[0]:null});
 }catch(e){console.error('[GM_GPAY_RECIPIENT_V036] stage=DB_ERROR code='+String(e&&e.code||'UNKNOWN'));return res.status(503).json({ok:false,error:'LOOKUP_FAILED'});}
});

module.exports = router;
