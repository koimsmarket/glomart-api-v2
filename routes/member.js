const express = require('express');
const router = express.Router();
function db(req){ return req.app.locals.db || req.app.locals.pool; }
function s(v,d=''){ return v===undefined||v===null ? d : String(v).trim(); }
function yn(v){ return String(v || '').toUpperCase() === 'Y' || v === true ? 'Y' : 'N'; }
function id(prefix){ return `${prefix}${Date.now()}${Math.random().toString(36).slice(2,8)}`; }
function pick(b, names, d=''){
  for(const n of names){ if(b[n] !== undefined && b[n] !== null && String(b[n]).trim() !== '') return s(b[n]); }
  return d;
}
function fullAddress(zip, a1, a2, old){
  const first = [zip ? `[${zip}]` : '', a1, a2].filter(Boolean).join(' ').trim();
  return old ? `${first} (${old})`.trim() : first;
}
function memberPayload(b){
  const zipcode = pick(b, ['default_zipcode','zipcode','receiver_zipcode','postcode','zip_code']);
  const address1 = pick(b, ['default_address1','address1','road_address','receiver_address1','addr1']);
  const address2 = pick(b, ['default_address2','address2','detail_address','receiver_address2','addr2']);
  const oldAddress = pick(b, ['default_address_old','address_old','jibun_address','old_address']);
  const addressFull = pick(b, ['default_address_full','address_full','receiver_address_full'], fullAddress(zipcode, address1, address2, oldAddress));
  return {
    member_id: pick(b, ['member_id','memberId','id']),
    cafe24_member_id: pick(b, ['cafe24_member_id','cafe24MemberId']),
    member_name: pick(b, ['member_name','memberName','name']),
    member_name_en: pick(b, ['member_name_en','memberNameEn','name_en']),
    email: pick(b, ['email','member_email']),
    phone: pick(b, ['phone','mobile','cellphone','member_phone']),
    country_code: pick(b, ['country_code','countryCode','country']),
    nationality: pick(b, ['nationality','citizenship']),
    language_code: pick(b, ['language_code','languageCode','lang'],'ko'),
    cs_language: pick(b, ['cs_language','csLanguage','language_code','languageCode','lang'],'ko'),
    recommender_id: pick(b, ['recommender_id','recommenderId','referrer_id']),
    member_grade: pick(b, ['member_grade','memberGrade']),
    member_status: pick(b, ['member_status','memberStatus'],'active'),
    refund_bank_name: pick(b, ['refund_bank_name','refundBankName','bank_name']),
    refund_account_no: pick(b, ['refund_account_no','refundAccountNo','account_no']),
    refund_account_holder: pick(b, ['refund_account_holder','refundAccountHolder','account_holder']),
    default_receiver_name: pick(b, ['default_receiver_name','receiver_name','receiverName'], pick(b, ['member_name','name'])),
    default_receiver_phone: pick(b, ['default_receiver_phone','receiver_phone','receiver_tel','receiverPhone','tel','phone1']),
    default_receiver_mobile: pick(b, ['default_receiver_mobile','receiver_mobile','receiver_cellphone','receiverMobile','mobile','cellphone'], pick(b, ['phone','member_phone'])),
    default_zipcode: zipcode,
    default_address1: address1,
    default_address2: address2,
    default_address_old: oldAddress,
    default_address_full: addressFull,
    default_sido: pick(b, ['default_sido','sido']),
    default_sigungu: pick(b, ['default_sigungu','sigungu']),
    default_eup_myeon_dong: pick(b, ['default_eup_myeon_dong','eup_myeon_dong','dong']),
    customs_clearance_code: pick(b, ['customs_clearance_code','customsClearanceCode','pccc']),
    delivery_memo: pick(b, ['delivery_memo','deliveryMemo'])
  };
}
function addressPayload(b, memberId){
  const zipcode = pick(b, ['zipcode','default_zipcode','receiver_zipcode','postcode','zip_code']);
  const address1 = pick(b, ['address1','default_address1','road_address','receiver_address1','addr1']);
  const address2 = pick(b, ['address2','default_address2','detail_address','receiver_address2','addr2']);
  const oldAddress = pick(b, ['address_old','default_address_old','jibun_address','old_address']);
  const addressFull = pick(b, ['address_full','default_address_full','receiver_address_full'], fullAddress(zipcode, address1, address2, oldAddress));
  return {
    address_id: pick(b, ['address_id','addressId'], id('GMA')),
    member_id: memberId,
    address_name: pick(b, ['address_name','addressName'],'기본배송지'),
    receiver_name: pick(b, ['receiver_name','default_receiver_name','receiverName']),
    receiver_phone: pick(b, ['receiver_phone','receiver_tel','default_receiver_phone','receiverPhone','tel','phone1']),
    receiver_mobile: pick(b, ['receiver_mobile','receiver_cellphone','default_receiver_mobile','receiverMobile','mobile','cellphone'], pick(b, ['default_receiver_phone'])),
    zipcode,
    address1,
    address2,
    address_old: oldAddress,
    address_full: addressFull,
    sido: pick(b, ['sido','default_sido']),
    sigungu: pick(b, ['sigungu','default_sigungu']),
    eup_myeon_dong: pick(b, ['eup_myeon_dong','default_eup_myeon_dong','dong']),
    customs_clearance_code: pick(b, ['customs_clearance_code','customsClearanceCode','pccc']),
    delivery_memo: pick(b, ['delivery_memo','deliveryMemo']),
    is_default: yn(b.is_default === undefined ? 'Y' : b.is_default)
  };
}

router.post(['/api/gm/member/upsert','/api/member/upsert'], async (req,res)=>{
  const pool=db(req), b=req.body||{}; if(!pool) return res.status(500).json({ok:false,error:'DB pool is not attached'});
  const p=memberPayload(b); if(!p.member_id) return res.status(400).json({ok:false,error:'member_id is required'});
  const client=await pool.connect().catch(()=>null); if(!client) return res.status(500).json({ok:false,error:'DB client connect failed'});
  try{
    await client.query('BEGIN');
    const sql=`INSERT INTO gm_member (
      member_id,cafe24_member_id,member_name,member_name_en,email,phone,country_code,nationality,language_code,cs_language,
      recommender_id,member_grade,member_status,refund_bank_name,refund_account_no,refund_account_holder,
      default_receiver_name,default_receiver_phone,default_receiver_mobile,default_zipcode,default_address1,default_address2,default_address_old,default_address_full,
      default_sido,default_sigungu,default_eup_myeon_dong,customs_clearance_code,delivery_memo,last_sync_at,created_at,updated_at
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,NOW(),NOW(),NOW()
    ) ON CONFLICT (member_id) DO UPDATE SET
      cafe24_member_id=COALESCE(NULLIF(EXCLUDED.cafe24_member_id,''),gm_member.cafe24_member_id),
      member_name=COALESCE(NULLIF(EXCLUDED.member_name,''),gm_member.member_name),
      member_name_en=COALESCE(NULLIF(EXCLUDED.member_name_en,''),gm_member.member_name_en),
      email=COALESCE(NULLIF(EXCLUDED.email,''),gm_member.email),
      phone=COALESCE(NULLIF(EXCLUDED.phone,''),gm_member.phone),
      country_code=COALESCE(NULLIF(EXCLUDED.country_code,''),gm_member.country_code),
      nationality=COALESCE(NULLIF(EXCLUDED.nationality,''),gm_member.nationality),
      language_code=COALESCE(NULLIF(EXCLUDED.language_code,''),gm_member.language_code),
      cs_language=COALESCE(NULLIF(EXCLUDED.cs_language,''),gm_member.cs_language),
      recommender_id=COALESCE(NULLIF(EXCLUDED.recommender_id,''),gm_member.recommender_id),
      member_grade=COALESCE(NULLIF(EXCLUDED.member_grade,''),gm_member.member_grade),
      member_status=COALESCE(NULLIF(EXCLUDED.member_status,''),gm_member.member_status),
      refund_bank_name=COALESCE(NULLIF(EXCLUDED.refund_bank_name,''),gm_member.refund_bank_name),
      refund_account_no=COALESCE(NULLIF(EXCLUDED.refund_account_no,''),gm_member.refund_account_no),
      refund_account_holder=COALESCE(NULLIF(EXCLUDED.refund_account_holder,''),gm_member.refund_account_holder),
      default_receiver_name=COALESCE(NULLIF(EXCLUDED.default_receiver_name,''),gm_member.default_receiver_name),
      default_receiver_phone=COALESCE(NULLIF(EXCLUDED.default_receiver_phone,''),gm_member.default_receiver_phone),
      default_receiver_mobile=COALESCE(NULLIF(EXCLUDED.default_receiver_mobile,''),gm_member.default_receiver_mobile),
      default_zipcode=COALESCE(NULLIF(EXCLUDED.default_zipcode,''),gm_member.default_zipcode),
      default_address1=COALESCE(NULLIF(EXCLUDED.default_address1,''),gm_member.default_address1),
      default_address2=COALESCE(NULLIF(EXCLUDED.default_address2,''),gm_member.default_address2),
      default_address_old=COALESCE(NULLIF(EXCLUDED.default_address_old,''),gm_member.default_address_old),
      default_address_full=COALESCE(NULLIF(EXCLUDED.default_address_full,''),gm_member.default_address_full),
      default_sido=COALESCE(NULLIF(EXCLUDED.default_sido,''),gm_member.default_sido),
      default_sigungu=COALESCE(NULLIF(EXCLUDED.default_sigungu,''),gm_member.default_sigungu),
      default_eup_myeon_dong=COALESCE(NULLIF(EXCLUDED.default_eup_myeon_dong,''),gm_member.default_eup_myeon_dong),
      customs_clearance_code=COALESCE(NULLIF(EXCLUDED.customs_clearance_code,''),gm_member.customs_clearance_code),
      delivery_memo=COALESCE(NULLIF(EXCLUDED.delivery_memo,''),gm_member.delivery_memo),
      last_sync_at=NOW(),updated_at=NOW()
    RETURNING *`;
    const vals=[p.member_id,p.cafe24_member_id,p.member_name,p.member_name_en,p.email,p.phone,p.country_code,p.nationality,p.language_code,p.cs_language,
      p.recommender_id,p.member_grade,p.member_status,p.refund_bank_name,p.refund_account_no,p.refund_account_holder,p.default_receiver_name,p.default_receiver_phone,p.default_receiver_mobile,
      p.default_zipcode,p.default_address1,p.default_address2,p.default_address_old,p.default_address_full,p.default_sido,p.default_sigungu,p.default_eup_myeon_dong,p.customs_clearance_code,p.delivery_memo];
    const mr=await client.query(sql, vals);
    let address=null;
    if(p.default_zipcode || p.default_address1 || p.default_address2){
      const a=addressPayload(Object.assign({}, b, {
        receiver_name:p.default_receiver_name, receiver_phone:p.default_receiver_phone, receiver_mobile:p.default_receiver_mobile, zipcode:p.default_zipcode,
        address1:p.default_address1, address2:p.default_address2, address_old:p.default_address_old, address_full:p.default_address_full,
        sido:p.default_sido, sigungu:p.default_sigungu, eup_myeon_dong:p.default_eup_myeon_dong,
        customs_clearance_code:p.customs_clearance_code, delivery_memo:p.delivery_memo, is_default:'Y'
      }), p.member_id);
      await client.query(`UPDATE gm_member_address SET is_default='N', updated_at=NOW() WHERE member_id=$1`, [p.member_id]);
      const ar=await client.query(`INSERT INTO gm_member_address (address_id,member_id,address_name,receiver_name,receiver_phone,receiver_mobile,zipcode,address1,address2,address_old,address_full,sido,sigungu,eup_myeon_dong,customs_clearance_code,delivery_memo,is_default,created_at,updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,NOW(),NOW())
        ON CONFLICT (address_id) DO UPDATE SET address_name=EXCLUDED.address_name,receiver_name=EXCLUDED.receiver_name,receiver_phone=EXCLUDED.receiver_phone,receiver_mobile=EXCLUDED.receiver_mobile,zipcode=EXCLUDED.zipcode,address1=EXCLUDED.address1,address2=EXCLUDED.address2,address_old=EXCLUDED.address_old,address_full=EXCLUDED.address_full,sido=EXCLUDED.sido,sigungu=EXCLUDED.sigungu,eup_myeon_dong=EXCLUDED.eup_myeon_dong,customs_clearance_code=EXCLUDED.customs_clearance_code,delivery_memo=EXCLUDED.delivery_memo,is_default=EXCLUDED.is_default,updated_at=NOW() RETURNING *`,
        [a.address_id,a.member_id,a.address_name,a.receiver_name,a.receiver_phone,a.receiver_mobile,a.zipcode,a.address1,a.address2,a.address_old,a.address_full,a.sido,a.sigungu,a.eup_myeon_dong,a.customs_clearance_code,a.delivery_memo,a.is_default]);
      address=ar.rows[0];
    }
    await client.query('COMMIT');
    res.json({ok:true,member:mr.rows[0],default_address:address});
  }catch(e){ await client.query('ROLLBACK').catch(()=>{}); res.status(500).json({ok:false,error:e.message}); }
  finally{ client.release(); }
});

router.get(['/api/gm/member/me','/api/member/me'], async (req,res)=>{
  const pool=db(req); if(!pool) return res.status(500).json({ok:false,error:'DB pool is not attached'});
  const memberId=s(req.query.member_id || req.query.memberId); if(!memberId) return res.status(400).json({ok:false,error:'member_id is required'});
  try{
    const m=await pool.query('SELECT * FROM gm_member WHERE member_id=$1',[memberId]);
    const a=await pool.query('SELECT * FROM gm_member_address WHERE member_id=$1 ORDER BY is_default DESC, updated_at DESC',[memberId]);
    res.json({ok:true,member:m.rows[0]||null,addresses:a.rows,default_address:a.rows.find(x=>x.is_default==='Y')||a.rows[0]||null});
  }catch(e){ res.status(500).json({ok:false,error:e.message}); }
});

router.post(['/api/gm/member/address/upsert','/api/member/address/upsert'], async (req,res)=>{
  const pool=db(req), b=req.body||{}; if(!pool) return res.status(500).json({ok:false,error:'DB pool is not attached'});
  const memberId=pick(b, ['member_id','memberId']); if(!memberId) return res.status(400).json({ok:false,error:'member_id is required'});
  const a=addressPayload(b, memberId);
  const client=await pool.connect().catch(()=>null); if(!client) return res.status(500).json({ok:false,error:'DB client connect failed'});
  try{
    await client.query('BEGIN');
    if(a.is_default==='Y') await client.query(`UPDATE gm_member_address SET is_default='N', updated_at=NOW() WHERE member_id=$1`, [memberId]);
    const ar=await client.query(`INSERT INTO gm_member_address (address_id,member_id,address_name,receiver_name,receiver_phone,receiver_mobile,zipcode,address1,address2,address_old,address_full,sido,sigungu,eup_myeon_dong,customs_clearance_code,delivery_memo,is_default,created_at,updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,NOW(),NOW())
      ON CONFLICT (address_id) DO UPDATE SET address_name=EXCLUDED.address_name,receiver_name=EXCLUDED.receiver_name,receiver_phone=EXCLUDED.receiver_phone,receiver_mobile=EXCLUDED.receiver_mobile,zipcode=EXCLUDED.zipcode,address1=EXCLUDED.address1,address2=EXCLUDED.address2,address_old=EXCLUDED.address_old,address_full=EXCLUDED.address_full,sido=EXCLUDED.sido,sigungu=EXCLUDED.sigungu,eup_myeon_dong=EXCLUDED.eup_myeon_dong,customs_clearance_code=EXCLUDED.customs_clearance_code,delivery_memo=EXCLUDED.delivery_memo,is_default=EXCLUDED.is_default,updated_at=NOW() RETURNING *`,
      [a.address_id,a.member_id,a.address_name,a.receiver_name,a.receiver_phone,a.receiver_mobile,a.zipcode,a.address1,a.address2,a.address_old,a.address_full,a.sido,a.sigungu,a.eup_myeon_dong,a.customs_clearance_code,a.delivery_memo,a.is_default]);
    if(a.is_default==='Y'){
      await client.query(`UPDATE gm_member SET default_receiver_name=$2,default_receiver_phone=$3,default_receiver_mobile=$4,default_zipcode=$5,default_address1=$6,default_address2=$7,default_address_old=$8,default_address_full=$9,default_sido=$10,default_sigungu=$11,default_eup_myeon_dong=$12,customs_clearance_code=$13,delivery_memo=$14,updated_at=NOW() WHERE member_id=$1`,
        [memberId,a.receiver_name,a.receiver_phone,a.receiver_mobile,a.zipcode,a.address1,a.address2,a.address_old,a.address_full,a.sido,a.sigungu,a.eup_myeon_dong,a.customs_clearance_code,a.delivery_memo]);
    }
    await client.query('COMMIT'); res.json({ok:true,address:ar.rows[0]});
  }catch(e){ await client.query('ROLLBACK').catch(()=>{}); res.status(500).json({ok:false,error:e.message}); }
  finally{ client.release(); }
});
module.exports=router;
