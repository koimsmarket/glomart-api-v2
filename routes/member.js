const express = require('express');
const router = express.Router();
const crypto = require('crypto');
let argon2 = null;
try { argon2 = require('argon2'); } catch (e) { argon2 = null; }
function db(req){ return req.app.locals.db || req.app.locals.pool; }
function s(v,d=''){ return v===undefined||v===null ? d : String(v).trim(); }
function yn(v){ return String(v || '').toUpperCase() === 'Y' || v === true ? 'Y' : 'N'; }
function validDeviceLang(v){
  const x=s(v);
  if(!x || /^(und|unknown|null|undefined|false)$/i.test(x) || x.length>35) return '';
  return /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(x) ? x : '';
}
function validFcmToken(v){
  const x=s(v);
  if(!x || x.length<20 || x.length>4096 || /\s/.test(x)) return '';
  return x;
}
function validDeviceType(v){
  const x=s(v).toUpperCase();
  return /^(PHONE|TABLET|ANDROID|IOS|WEB)$/.test(x) ? x : 'ANDROID';
}
function id(prefix){ return `${prefix}${Date.now()}${Math.random().toString(36).slice(2,8)}`; }
function pick(b, names, d=''){
  for(const n of names){ if(b[n] !== undefined && b[n] !== null && String(b[n]).trim() !== '') return s(b[n]); }
  return d;
}

function pickPasswordPlain(b){
  // Accept only transient password fields from HTTPS request body.
  // Never store these values in raw_json, session storage, logs, or exports.
  const names = [
    'password_plain','plain_password','member_password','passwd','user_passwd','password',
    'new_passwd','new_password','newPassword'
  ];
  for(const n of names){
    if(b[n] !== undefined && b[n] !== null && String(b[n]).trim() !== '') return String(b[n]);
  }
  return '';
}
async function hashPasswordIfPresent(b){
  const plain = pickPasswordPlain(b);
  if(!plain) return null;
  if(!argon2 || !argon2.hash) {
    const crypto = require('crypto');
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(plain, salt, 120000, 64, 'sha512').toString('hex');
    return { password_hash: `pbkdf2_sha512$120000$${salt}$${hash}`, password_algo: 'pbkdf2_sha512', password_updated_at: new Date(), password_migrated: 'Y' };
  }
  const hash = await argon2.hash(plain, { type: argon2.argon2id });
  return { password_hash: hash, password_algo: 'argon2id', password_updated_at: new Date(), password_migrated: 'Y' };
}
function redactMember(row){
  if(!row) return row;
  const x = Object.assign({}, row);
  delete x.password_hash;
  delete x.password_algo;
  delete x.password_updated_at;
  delete x.password_migrated;
  return x;
}
function redactMembers(rows){ return Array.isArray(rows) ? rows.map(redactMember) : rows; }
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
    cs_language: pick(b, ['cs_language','csLanguage','cs_lang','csLang','language_code','languageCode','lang'],'ko'),
    device_lang: validDeviceLang(pick(b, ['device_lang','deviceLang','device_language','deviceLanguage'])),
    recommender_id: pick(b, ['recommender_id','recommenderId','referrer_id','reco_id','recoId']),
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
    delivery_memo: pick(b, ['delivery_memo','deliveryMemo','default_delivery_memo','defaultDeliveryMemo'])
  };
}

function addressFingerprint(a){
  a = a || {};
  const key = [a.member_id, a.receiver_name, a.receiver_mobile || a.receiver_phone, a.zipcode, a.address1, a.address2].map(x=>s(x).toLowerCase()).join('|');
  return crypto.createHash('sha1').update(key).digest('hex').slice(0,24);
}
function stableAddressId(a, memberId){
  const given = s(a && (a.address_id || a.addressId || a.id || a.ma_idx));
  if(given) return given;
  const x = Object.assign({}, a || {}, { member_id: memberId });
  return `CAF24_${memberId}_${addressFingerprint(x)}`;
}
function addressPayload(b, memberId){
  const zipcode = pick(b, ['zipcode','default_zipcode','receiver_zipcode','postcode','zip_code']);
  const address1 = pick(b, ['address1','default_address1','road_address','receiver_address1','addr1']);
  const address2 = pick(b, ['address2','default_address2','detail_address','receiver_address2','addr2']);
  const oldAddress = pick(b, ['address_old','default_address_old','jibun_address','old_address']);
  const addressFull = pick(b, ['address_full','default_address_full','receiver_address_full'], fullAddress(zipcode, address1, address2, oldAddress));
  return {
    address_id: stableAddressId(b, memberId),
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
    delivery_memo: pick(b, ['delivery_memo','deliveryMemo','default_delivery_memo','defaultDeliveryMemo']),
    is_default: yn(b.is_default === undefined ? 'Y' : b.is_default)
  };
}


router.get(['/api/gm/member/recommender/check','/api/member/recommender/check'], async (req,res)=>{
  const pool=db(req);
  if(!pool) return res.status(500).json({ok:false,valid:false,error:'서버 데이터베이스에 연결할 수 없습니다.'});
  const recommenderInput=s(req.query.recommender_id || req.query.reco_id || req.query.id);
  const memberInput=s(req.query.member_id);
  if(!recommenderInput) return res.json({ok:true,valid:true,blank:true});
  try{
    const candidate=(await pool.query(`
      SELECT member_id,cafe24_member_id
      FROM gm_member
      WHERE LOWER(COALESCE(member_id,''))=LOWER($1)
         OR LOWER(COALESCE(cafe24_member_id,''))=LOWER($1)
      ORDER BY CASE WHEN LOWER(COALESCE(member_id,''))=LOWER($1) THEN 0 ELSE 1 END
      LIMIT 1
    `,[recommenderInput])).rows[0] || null;
    if(!candidate) return res.status(400).json({ok:false,valid:false,error:'등록되지 않은 추천인입니다.'});
    const recommenderId=s(candidate.member_id || candidate.cafe24_member_id);
    if(!recommenderId) return res.status(400).json({ok:false,valid:false,error:'등록되지 않은 추천인입니다.'});

    if(memberInput && recommenderId.toLowerCase()===memberInput.toLowerCase()){
      return res.status(400).json({ok:false,valid:false,error:'본인 아이디는 추천인으로 등록할 수 없습니다.'});
    }

    // 가입 화면에서는 아직 회원 행이 없으므로 존재/본인 여부만 검사한다.
    // 수정 화면처럼 현재 회원 행이 있을 때만 최초 추가 조건을 검사한다.
    if(memberInput){
      const current=(await pool.query(`
        SELECT member_id,recommender_id,created_at
        FROM gm_member
        WHERE LOWER(COALESCE(member_id,''))=LOWER($1)
           OR LOWER(COALESCE(cafe24_member_id,''))=LOWER($1)
        LIMIT 1
      `,[memberInput])).rows[0] || null;
      if(current){
        const currentId=s(current.member_id);
        if(s(current.recommender_id)){
          return res.status(400).json({ok:false,valid:false,error:'추천인은 등록 후 수정 불가합니다.'});
        }

        const enforceWindow=String(process.env.GM_RECOMMENDER_ATTACH_WINDOW_ENFORCE||'N').toUpperCase()==='Y';
        const windowDays=Math.max(1,Number(process.env.GM_RECOMMENDER_ATTACH_WINDOW_DAYS||7));
        if(enforceWindow){
          const age=(await pool.query(`SELECT (NOW() <= $1::timestamptz + ($2::text || ' days')::interval) AS allowed`,[current.created_at,String(windowDays)])).rows[0];
          if(!(age&&age.allowed)) return res.status(400).json({ok:false,valid:false,error:`추천인은 가입 후 ${windowDays}일 이내에만 최초 등록할 수 있습니다.`});
        }

        const maxDown=Math.max(1,Number(process.env.GM_RECOMMENDER_ATTACH_MAX_DOWN||100));
        const down=(await pool.query(`WITH RECURSIVE d AS (
          SELECT member_id FROM gm_member WHERE recommender_id=$1
          UNION ALL
          SELECT m.member_id FROM gm_member m JOIN d ON m.recommender_id=d.member_id
        ) SELECT COUNT(*)::int AS n, BOOL_OR(LOWER(member_id)=LOWER($2)) AS has_candidate FROM d`,[currentId,recommenderId])).rows[0] || {n:0,has_candidate:false};
        if(Number(down.n||0)>=maxDown){
          return res.status(400).json({ok:false,valid:false,error:`하위 관계망이 ${maxDown}명 이상인 경우에는 추천인을 추가할 수 없습니다.`});
        }
        if(down.has_candidate){
          return res.status(400).json({ok:false,valid:false,error:'하위 회원은 추천인으로 등록할 수 없습니다.'});
        }
      }
    }
    return res.json({ok:true,valid:true,recommender_id:recommenderId});
  }catch(e){
    console.error('[GM_RECOMMENDER_CHECK_ERROR]',{code:e&&e.code,message:e&&e.message});
    return res.status(500).json({ok:false,valid:false,error:'추천인 아이디를 확인하지 못했습니다.'});
  }
});

router.post(['/api/gm/member/upsert','/api/member/upsert'], async (req,res)=>{
  const pool=db(req), b=req.body||{}; if(!pool) return res.status(500).json({ok:false,error:'서버 데이터베이스에 연결할 수 없습니다.'});
  const p=memberPayload(b); if(!p.member_id) return res.status(400).json({ok:false,error:'회원 정보가 필요합니다.'});
  let passwordMeta=null;
  try{ passwordMeta = await hashPasswordIfPresent(b); }
  catch(e){ return res.status(400).json({ok:false,error:'비밀번호 정보를 처리하지 못했습니다.'}); }
  const client=await pool.connect().catch(()=>null); if(!client) return res.status(500).json({ok:false,error:'서버 데이터베이스에 연결할 수 없습니다.'});
  try{
    await client.query('BEGIN');
    const existing=(await client.query(`SELECT member_id,recommender_id,created_at,recommender_updated_at,relation_calculated_yn FROM gm_member WHERE member_id=$1 FOR UPDATE`,[p.member_id])).rows[0] || null;
    const isNewMember=!existing;
    let requestedRecommender=s(p.recommender_id);
    let attachRecommender=false;
    if(requestedRecommender){
      const recommenderCheck=(await client.query(`
        SELECT member_id,cafe24_member_id
        FROM gm_member
        WHERE LOWER(COALESCE(member_id,''))=LOWER($1)
           OR LOWER(COALESCE(cafe24_member_id,''))=LOWER($1)
        ORDER BY CASE WHEN LOWER(COALESCE(member_id,''))=LOWER($1) THEN 0 ELSE 1 END
        LIMIT 1
      `,[requestedRecommender])).rows[0] || null;
      if(!recommenderCheck){
        await client.query('ROLLBACK');
        return res.status(400).json({ok:false,error:'등록되지 않은 추천인입니다.'});
      }
      requestedRecommender=s(recommenderCheck.member_id || recommenderCheck.cafe24_member_id);
      p.recommender_id=requestedRecommender;
      if(requestedRecommender.toLowerCase()===p.member_id.toLowerCase()){
        await client.query('ROLLBACK');
        return res.status(400).json({ok:false,error:'본인 아이디는 추천인으로 등록할 수 없습니다.'});
      }
    }
    if(!isNewMember && requestedRecommender && !s(existing.recommender_id)){
      const enforceWindow=String(process.env.GM_RECOMMENDER_ATTACH_WINDOW_ENFORCE||'N').toUpperCase()==='Y';
      const windowDays=Math.max(1,Number(process.env.GM_RECOMMENDER_ATTACH_WINDOW_DAYS||7));
      if(enforceWindow){
        const ageCheck=await client.query(`SELECT (NOW() <= $1::timestamptz + ($2::text || ' days')::interval) AS allowed`,[existing.created_at,String(windowDays)]);
        if(!(ageCheck.rows[0] && ageCheck.rows[0].allowed)){
          await client.query('ROLLBACK');
          return res.status(400).json({ok:false,error:`추천인은 가입 후 ${windowDays}일 이내에만 최초 등록할 수 있습니다.`});
        }
      }
      const maxDown=Math.max(1,Number(process.env.GM_RECOMMENDER_ATTACH_MAX_DOWN || 100));
      const downRow=(await client.query(`WITH RECURSIVE down AS (
        SELECT member_id FROM gm_member WHERE recommender_id=$1
        UNION ALL
        SELECT m.member_id FROM gm_member m JOIN down d ON m.recommender_id=d.member_id
      ) SELECT COUNT(*)::int AS n, BOOL_OR(LOWER(member_id)=LOWER($2)) AS has_candidate FROM down`,[p.member_id,requestedRecommender])).rows[0] || {n:0,has_candidate:false};
      if(Number(downRow.n||0)>=maxDown){
        await client.query('ROLLBACK');
        return res.status(400).json({ok:false,error:`하위 관계망이 ${maxDown}명 이상인 경우에는 추천인을 추가할 수 없습니다.`});
      }
      if(downRow.has_candidate){
        await client.query('ROLLBACK');
        return res.status(400).json({ok:false,error:'하위 회원은 추천인으로 등록할 수 없습니다.'});
      }
      attachRecommender=true;
    }
    if(!isNewMember && requestedRecommender && s(existing.recommender_id) && requestedRecommender!==s(existing.recommender_id)){
      await client.query('ROLLBACK');
      return res.status(400).json({ok:false,error:'추천인은 최초 등록 후 변경할 수 없습니다.'});
    }
    const sql=`INSERT INTO gm_member (
      member_id,cafe24_member_id,member_name,member_name_en,email,phone,country_code,nationality,language_code,cs_language,device_lang,
      recommender_id,member_grade,member_status,refund_bank_name,refund_account_no,refund_account_holder,
      default_receiver_name,default_receiver_phone,default_receiver_mobile,default_zipcode,default_address1,default_address2,default_address_old,default_address_full,
      default_sido,default_sigungu,default_eup_myeon_dong,customs_clearance_code,delivery_memo,
      password_hash,password_algo,password_updated_at,password_migrated,recommender_updated_at,relation_calculated_yn,last_sync_at,created_at,updated_at
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,NOW(),NOW(),NOW()
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
      device_lang=COALESCE(NULLIF(EXCLUDED.device_lang,''),gm_member.device_lang),
      recommender_id=CASE WHEN COALESCE(gm_member.recommender_id,'')='' AND COALESCE(EXCLUDED.recommender_id,'')<>'' THEN EXCLUDED.recommender_id ELSE gm_member.recommender_id END,
      recommender_updated_at=CASE WHEN COALESCE(gm_member.recommender_id,'')='' AND COALESCE(EXCLUDED.recommender_id,'')<>'' THEN NOW() ELSE gm_member.recommender_updated_at END,
      relation_calculated_yn=CASE WHEN COALESCE(gm_member.recommender_id,'')='' AND COALESCE(EXCLUDED.recommender_id,'')<>'' THEN 'N' ELSE gm_member.relation_calculated_yn END,
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
      password_hash=COALESCE(EXCLUDED.password_hash,gm_member.password_hash),
      password_algo=COALESCE(NULLIF(EXCLUDED.password_algo,''),gm_member.password_algo),
      password_updated_at=COALESCE(EXCLUDED.password_updated_at,gm_member.password_updated_at),
      password_migrated=CASE WHEN EXCLUDED.password_hash IS NOT NULL THEN 'Y' ELSE gm_member.password_migrated END,
      last_sync_at=NOW(),updated_at=NOW()
    RETURNING *`;
    const vals=[p.member_id,p.cafe24_member_id,p.member_name,p.member_name_en,p.email,p.phone,p.country_code,p.nationality,p.language_code,p.cs_language,p.device_lang||null,
      p.recommender_id,p.member_grade,p.member_status,p.refund_bank_name,p.refund_account_no,p.refund_account_holder,p.default_receiver_name,p.default_receiver_phone,p.default_receiver_mobile,
      p.default_zipcode,p.default_address1,p.default_address2,p.default_address_old,p.default_address_full,p.default_sido,p.default_sigungu,p.default_eup_myeon_dong,p.customs_clearance_code,p.delivery_memo,
      passwordMeta ? passwordMeta.password_hash : null,
      passwordMeta ? passwordMeta.password_algo : null,
      passwordMeta ? passwordMeta.password_updated_at : null,
      passwordMeta ? passwordMeta.password_migrated : 'N',
      requestedRecommender ? new Date() : null,
      requestedRecommender ? 'N' : 'Y'];
    const mr=await client.query(sql, vals);
    if(isNewMember){
      await client.query(`INSERT INTO gm_member_relation_count (member_id,calculated_yn)
        VALUES ($1,'F') ON CONFLICT (member_id) DO NOTHING`,[p.member_id]);
    }
    // 회원 동기화는 gm_member만 갱신한다.
    // 주문서 진입/회원 동기화 과정에서 gm_member_address를 자동 INSERT/UPDATE하지 않는다.
    // 배송지 등록·수정은 전용 address/upsert API에서만 처리한다.
    const ar=await client.query(`SELECT * FROM gm_member_address
      WHERE member_id=$1
      ORDER BY is_default DESC, last_used_at DESC NULLS LAST, updated_at DESC, created_at DESC
      LIMIT 1`, [p.member_id]);
    const address=ar.rows[0] || null;
    await client.query('COMMIT');
    res.json({ok:true,member:redactMember(mr.rows[0]),default_address:address,is_new_member:isNewMember,recommender_attach_pending:attachRecommender});
    if(isNewMember && req.app.locals.eventQueue){
      req.app.locals.eventQueue.enqueueMemberJoin(p.member_id, mr.rows[0] && mr.rows[0].recommender_id)
        .then(x=>console.log('[MEMBER_JOIN_EVENT_QUEUE]',JSON.stringify({member_id:p.member_id,result:x})))
        .catch(e=>console.error('[MEMBER_JOIN_EVENT_QUEUE_SKIP]',String(e&&e.message||e)));
    }
  }catch(e){ await client.query('ROLLBACK').catch(()=>{}); console.error('[GM_MEMBER_API_ERROR]', {code:e&&e.code, message:e&&e.message}); res.status(500).json({ok:false,error:'회원 정보를 처리하지 못했습니다. 다시 시도해 주세요.'}); }
  finally{ client.release(); }
});

/*
========================================================
GM_MEMBER DEVICE LANGUAGE POLICY
========================================================
- device_lang stores the original Android BCP-47 tag (ko-KR, vi-VN, zh-TW...).
- Join/modify/login may send it. Only a valid nonblank value updates the member row.
- null/blank/und/invalid input must never erase the previous value.
- Login-side synchronization is non-blocking; failure must not block login.
- Message language priority: device_lang -> language_code(gm_lang) -> en.
========================================================
*/
router.post(['/api/gm/member/device-language','/api/member/device-language'], async (req,res)=>{
  const pool=db(req), b=req.body||{};
  if(!pool) return res.status(500).json({ok:false,error:'서버 데이터베이스에 연결할 수 없습니다.'});
  const memberId=pick(b,['member_id','memberId']);
  const deviceLang=validDeviceLang(pick(b,['device_lang','deviceLang','device_language','deviceLanguage']));
  if(!memberId) return res.status(400).json({ok:false,error:'회원 정보가 필요합니다.'});
  if(!deviceLang) return res.json({ok:true,skipped:true,reason:'유효한 휴대폰 언어가 없어 기존 값을 유지했습니다.'});
  try{
    const r=await pool.query(`UPDATE gm_member SET device_lang=$2,updated_at=NOW() WHERE member_id=$1 RETURNING member_id,device_lang`,[memberId,deviceLang]);
    if(!r.rowCount) return res.status(404).json({ok:false,error:'회원 정보를 찾을 수 없습니다.'});
    res.json({ok:true,member:r.rows[0]});
  }catch(e){ console.error('[GM_MEMBER_DEVICE_LANG_ERROR]',{code:e&&e.code,message:e&&e.message}); res.status(500).json({ok:false,error:'휴대폰 언어를 저장하지 못했습니다.'}); }
});

/*
========================================================
GM_MEMBER MULTI-DEVICE FCM POLICY
========================================================
- One member may own multiple rows, one row per unique fcm_token.
- fcm_token is the push delivery address; member_id alone cannot receive FCM.
- Re-registration refreshes member/device/language/last_seen and restores ACTIVE.
- Permanent FCM errors mark INVALID. Temporary errors never delete the token.
- Logout does not delete the token/member link; push consent is controlled separately.
========================================================
*/
router.post(['/api/gm/member/device/upsert','/api/member/device/upsert'], async (req,res)=>{
  const pool=db(req), b=req.body||{};
  if(!pool) return res.status(500).json({ok:false,error:'서버 데이터베이스에 연결할 수 없습니다.'});
  const memberId=pick(b,['member_id','memberId']);
  const fcmToken=validFcmToken(pick(b,['fcm_token','fcmToken','push_token','pushToken']));
  const deviceLang=validDeviceLang(pick(b,['device_lang','deviceLang','device_language','deviceLanguage']));
  const deviceType=validDeviceType(pick(b,['device_type','deviceType','platform'],'ANDROID'));
  const pushEnabled=yn(b.push_enabled===undefined ? 'Y' : b.push_enabled);
  if(!memberId) return res.status(400).json({ok:false,error:'회원 정보가 필요합니다.'});
  if(!fcmToken) return res.status(400).json({ok:false,error:'유효한 FCM 토큰이 필요합니다.'});
  try{
    const r=await pool.query(`INSERT INTO gm_member_device (
      member_id,fcm_token,device_type,device_lang,push_enabled,token_status,
      failure_count,last_seen_at,created_at,updated_at
    ) VALUES ($1,$2,$3,$4,$5,'ACTIVE',0,NOW(),NOW(),NOW())
    ON CONFLICT (fcm_token) DO UPDATE SET
      member_id=EXCLUDED.member_id,
      device_type=COALESCE(NULLIF(EXCLUDED.device_type,''),gm_member_device.device_type),
      device_lang=COALESCE(NULLIF(EXCLUDED.device_lang,''),gm_member_device.device_lang),
      push_enabled=EXCLUDED.push_enabled,
      token_status='ACTIVE',
      failure_count=0,
      last_error_code='',
      last_seen_at=NOW(),
      updated_at=NOW()
    RETURNING *`,[memberId,fcmToken,deviceType,deviceLang||null,pushEnabled]);
    res.json({ok:true,device:r.rows[0]});
  }catch(e){
    console.error('[GM_MEMBER_DEVICE_UPSERT_ERROR]',{code:e&&e.code,message:e&&e.message});
    res.status(500).json({ok:false,error:'푸시 기기 정보를 저장하지 못했습니다.'});
  }
});

router.post(['/api/gm/member/device/push-result','/api/member/device/push-result'], async (req,res)=>{
  const pool=db(req), b=req.body||{};
  if(!pool) return res.status(500).json({ok:false,error:'서버 데이터베이스에 연결할 수 없습니다.'});
  const fcmToken=validFcmToken(pick(b,['fcm_token','fcmToken','push_token','pushToken']));
  const ok=yn(b.success_yn===undefined ? b.ok : b.success_yn)==='Y';
  const permanent=yn(b.permanent_error_yn||b.permanentErrorYn)==='Y';
  const errorCode=pick(b,['error_code','errorCode','code']);
  if(!fcmToken) return res.status(400).json({ok:false,error:'유효한 FCM 토큰이 필요합니다.'});
  try{
    const r=await pool.query(`UPDATE gm_member_device SET
      token_status=CASE WHEN $2::boolean THEN 'ACTIVE' WHEN $3::boolean THEN 'INVALID' ELSE token_status END,
      failure_count=CASE WHEN $2::boolean THEN 0 ELSE failure_count+1 END,
      last_success_at=CASE WHEN $2::boolean THEN NOW() ELSE last_success_at END,
      last_failure_at=CASE WHEN $2::boolean THEN last_failure_at ELSE NOW() END,
      last_error_code=CASE WHEN $2::boolean THEN '' ELSE $4 END,
      updated_at=NOW()
      WHERE fcm_token=$1
      RETURNING *`,[fcmToken,ok,permanent,errorCode]);
    res.json({ok:true,found:!!r.rowCount,device:r.rows[0]||null});
  }catch(e){
    console.error('[GM_MEMBER_PUSH_RESULT_ERROR]',{code:e&&e.code,message:e&&e.message});
    res.status(500).json({ok:false,error:'푸시 결과를 저장하지 못했습니다.'});
  }
});


function memberMeResponse(row, addressRows){
  const member = redactMember(row || null);
  const rows = Array.isArray(addressRows) ? addressRows : [];
  const defaultAddress = rows.find(x => x.is_default === 'Y') || rows[0] || null;

  const receiverName = s((defaultAddress && defaultAddress.receiver_name) || (member && member.default_receiver_name) || (member && member.member_name));
  const receiverPhone = s((defaultAddress && defaultAddress.receiver_phone) || (member && member.default_receiver_phone) || (member && member.phone));
  const receiverMobile = s((defaultAddress && defaultAddress.receiver_mobile) || (member && member.default_receiver_mobile) || receiverPhone || (member && member.phone));
  const receiverZipcode = s((defaultAddress && defaultAddress.zipcode) || (member && member.default_zipcode));
  const receiverAddress1 = s((defaultAddress && defaultAddress.address1) || (member && member.default_address1));
  const receiverAddress2 = s((defaultAddress && defaultAddress.address2) || (member && member.default_address2));
  const receiverAddressOld = s((defaultAddress && defaultAddress.address_old) || (member && member.default_address_old));
  const receiverAddressFull = s((defaultAddress && defaultAddress.address_full) || (member && member.default_address_full) || fullAddress(receiverZipcode, receiverAddress1, receiverAddress2, receiverAddressOld));
  const deliveryMemo = s((defaultAddress && defaultAddress.delivery_memo) || (member && member.delivery_memo));

  const flat = {
    ok: true,
    found: !!member,
    member_id: s(member && member.member_id),
    cafe24_member_id: s(member && member.cafe24_member_id),
    member_name: s(member && member.member_name),
    order_name: s(member && member.member_name),
    email: s(member && member.email),
    order_email: s(member && member.email),
    phone: s(member && member.phone),
    mobile: receiverMobile || s(member && member.phone),
    country_code: s(member && member.country_code),
    nationality: s(member && member.nationality),
    language_code: s(member && member.language_code, 'ko'),
    cs_language: s(member && member.cs_language, 'ko'),
    device_lang: s(member && member.device_lang),
    member_grade: s(member && member.member_grade),
    member_grade_code: s(member && member.member_grade_code),
    member_status: s(member && member.member_status),
    deposit_balance: member && member.deposit_balance != null ? member.deposit_balance : 0,
    bonus_balance: member && member.bonus_balance != null ? member.bonus_balance : 0,
    point_balance: member && member.point_balance != null ? member.point_balance : 0,
    usable_balance: member && member.usable_balance != null ? member.usable_balance : 0,

    receiver_name: receiverName,
    receiver_phone: receiverPhone,
    receiver_mobile: receiverMobile,
    receiver_zipcode: receiverZipcode,
    receiver_address1: receiverAddress1,
    receiver_address2: receiverAddress2,
    receiver_address_old: receiverAddressOld,
    receiver_address_full: receiverAddressFull,

    // GM_ORDERFORM older aliases
    zipcode: receiverZipcode,
    addr1: receiverAddress1,
    addr2: receiverAddress2,
    address1: receiverAddress1,
    address2: receiverAddress2,
    address_full: receiverAddressFull,
    delivery_memo: deliveryMemo,
    customs_clearance_code: s((defaultAddress && defaultAddress.customs_clearance_code) || (member && member.customs_clearance_code)),

    member,
    addresses: rows,
    default_address: defaultAddress || (member ? {
      member_id: s(member.member_id),
      address_name: '기본배송지',
      receiver_name: receiverName,
      receiver_phone: receiverPhone,
      receiver_mobile: receiverMobile,
      zipcode: receiverZipcode,
      address1: receiverAddress1,
      address2: receiverAddress2,
      address_old: receiverAddressOld,
      address_full: receiverAddressFull,
      delivery_memo: deliveryMemo,
      is_default: 'Y'
    } : null)
  };
  return flat;
}

router.get(['/api/gm/member/me','/api/member/me','/api/gm/member/list','/api/gm/member/profile'], async (req,res)=>{
  const pool=db(req); if(!pool) return res.status(500).json({ok:false,error:'서버 데이터베이스에 연결할 수 없습니다.'});
  const memberId=s(req.query.member_id || req.query.memberId || req.query.id);
  if(!memberId) return res.status(400).json({ok:false,error:'회원 정보가 필요합니다.'});
  try{
    const m=await pool.query('SELECT * FROM gm_member WHERE member_id=$1',[memberId]);
    const a=await pool.query('SELECT * FROM gm_member_address WHERE member_id=$1 ORDER BY is_default DESC, last_used_at DESC NULLS LAST, updated_at DESC, created_at DESC',[memberId]);
    res.json(memberMeResponse(m.rows[0]||null, a.rows));
  }catch(e){ console.error('[GM_MEMBER_API_ERROR]', {code:e&&e.code, message:e&&e.message}); res.status(500).json({ok:false,error:'회원 정보를 불러오지 못했습니다. 다시 시도해 주세요.'}); }
});

router.post(['/api/gm/member/address/upsert','/api/member/address/upsert'], async (req,res)=>{
  const pool=db(req), b=req.body||{}; if(!pool) return res.status(500).json({ok:false,error:'서버 데이터베이스에 연결할 수 없습니다.'});
  const memberId=pick(b, ['member_id','memberId']); if(!memberId) return res.status(400).json({ok:false,error:'회원 정보가 필요합니다.'});

  const givenAddressId=s(b.address_id || b.addressId || b.id || b.ma_idx);
  const explicitNew = yn(b.new_address_yn || b.newAddressYn || b.direct_input_yn || b.directInputYn) === 'Y';
  const a=addressPayload(b, memberId);
  if(!a.receiver_name || (!a.receiver_mobile && !a.receiver_phone) || !a.zipcode || !a.address1){
    return res.status(400).json({ok:false,error:'받는 사람, 전화번호, 우편번호, 기본 주소를 모두 입력해 주세요.'});
  }
  const client=await pool.connect().catch(()=>null); if(!client) return res.status(500).json({ok:false,error:'서버 데이터베이스에 연결할 수 없습니다.'});
  try{
    await client.query('BEGIN');
    let ar;
    let newAddressExisted=false;

    // 회원당 기본 배송지는 1개만 허용되므로 새 기본값 저장 전에 기존 기본값을 먼저 해제한다.
    if(a.is_default==='Y') {
      await client.query(`UPDATE gm_member_address
        SET is_default='N', updated_at=NOW()
        WHERE member_id=$1 AND is_default='Y'
          AND ($2::text='' OR address_id<>$2)`, [memberId, (givenAddressId&&!explicitNew)?givenAddressId:'']);
    }

    if(givenAddressId && !explicitNew){
      // 기존 배송지 수정: 존재하는 address_id만 UPDATE한다.
      ar=await client.query(`UPDATE gm_member_address SET
        address_name=$3,receiver_name=$4,receiver_phone=$5,receiver_mobile=$6,zipcode=$7,address1=$8,address2=$9,address_old=$10,address_full=$11,
        sido=$12,sigungu=$13,eup_myeon_dong=$14,customs_clearance_code=$15,delivery_memo=$16,is_default=$17,updated_at=NOW()
        WHERE address_id=$1 AND member_id=$2
        RETURNING *`,
        [givenAddressId,memberId,a.address_name,a.receiver_name,a.receiver_phone,a.receiver_mobile,a.zipcode,a.address1,a.address2,a.address_old,a.address_full,a.sido,a.sigungu,a.eup_myeon_dong,a.customs_clearance_code,a.delivery_memo,a.is_default]);
      if(!ar.rowCount){
        await client.query('ROLLBACK');
        return res.status(404).json({ok:false,error:'선택한 배송지를 찾을 수 없습니다. 신규 배송지는 새 배송지로 저장해 주세요.'});
      }
    }else{
      // 직접입력 신규 배송지는 Cafe24 임시 address_id가 함께 와도 새 주소로 처리한다.
      a.address_id = stableAddressId(Object.assign({}, b, {address_id:'',addressId:'',id:'',ma_idx:''}), memberId);
      // 새 배송지 추가: address_id가 없는 명시적 추가 요청에서만 INSERT한다.
      // 동일 주소가 이미 있으면 기존 행을 반환하고 UPDATE/UPSERT하지 않는다.
      const existing=await client.query(`SELECT * FROM gm_member_address WHERE address_id=$1 AND member_id=$2 LIMIT 1`, [a.address_id,memberId]);
      if(existing.rowCount){
        newAddressExisted=true;
        ar=await client.query(`UPDATE gm_member_address SET
          address_name=$3,receiver_name=$4,receiver_phone=$5,receiver_mobile=$6,zipcode=$7,address1=$8,address2=$9,address_old=$10,address_full=$11,
          sido=$12,sigungu=$13,eup_myeon_dong=$14,customs_clearance_code=$15,delivery_memo=$16,is_default=$17,last_used_at=NOW(),updated_at=NOW()
          WHERE address_id=$1 AND member_id=$2 RETURNING *`,
          [a.address_id,memberId,a.address_name,a.receiver_name,a.receiver_phone,a.receiver_mobile,a.zipcode,a.address1,a.address2,a.address_old,a.address_full,a.sido,a.sigungu,a.eup_myeon_dong,a.customs_clearance_code,a.delivery_memo,a.is_default]);
      }else{
        ar=await client.query(`INSERT INTO gm_member_address (address_id,member_id,address_name,receiver_name,receiver_phone,receiver_mobile,zipcode,address1,address2,address_old,address_full,sido,sigungu,eup_myeon_dong,customs_clearance_code,delivery_memo,is_default,created_at,updated_at,last_used_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,NOW(),NOW(),NULL)
          RETURNING *`,
          [a.address_id,a.member_id,a.address_name,a.receiver_name,a.receiver_phone,a.receiver_mobile,a.zipcode,a.address1,a.address2,a.address_old,a.address_full,a.sido,a.sigungu,a.eup_myeon_dong,a.customs_clearance_code,a.delivery_memo,a.is_default]);
      }
    }

    const saved=ar.rows[0];
    if(saved.is_default==='Y'){
      await client.query(`UPDATE gm_member SET default_receiver_name=$2,default_receiver_phone=$3,default_receiver_mobile=$4,default_zipcode=$5,default_address1=$6,default_address2=$7,default_address_old=$8,default_address_full=$9,default_sido=$10,default_sigungu=$11,default_eup_myeon_dong=$12,customs_clearance_code=$13,delivery_memo=$14,updated_at=NOW() WHERE member_id=$1`,
        [memberId,saved.receiver_name,saved.receiver_phone,saved.receiver_mobile,saved.zipcode,saved.address1,saved.address2,saved.address_old,saved.address_full,saved.sido,saved.sigungu,saved.eup_myeon_dong,saved.customs_clearance_code,saved.delivery_memo]);
    }
    await client.query('COMMIT'); res.json({ok:true,address:saved,action:(givenAddressId&&!explicitNew)?'updated':(newAddressExisted?'existing':'created')});
  }catch(e){
    await client.query('ROLLBACK').catch(()=>{});
    console.error('[GM_MEMBER_ADDRESS_SAVE_ERROR]', {code:e&&e.code, constraint:e&&e.constraint, message:e&&e.message});
    const duplicateDefault = e && (e.code==='23505' || String(e.constraint||'').indexOf('uq_gm_member_address_member_default')>=0);
    res.status(500).json({ok:false,error:duplicateDefault?'기본 배송지 지정 중 충돌이 발생했습니다. 다시 시도해 주세요.':'배송지를 저장하지 못했습니다. 다시 시도해 주세요.'});
  }
  finally{ client.release(); }
});


// 기존 배송지 선택: INSERT/UPSERT 없이 선택한 address_id만 기본/최근 사용으로 갱신한다.
router.post(['/api/gm/member/address/select','/api/member/address/select'], async (req,res)=>{
  const pool=db(req), b=req.body||{}; if(!pool) return res.status(500).json({ok:false,error:'서버 데이터베이스에 연결할 수 없습니다.'});
  const memberId=pick(b, ['member_id','memberId']);
  const addressId=pick(b, ['address_id','addressId','id','ma_idx']);
  if(!memberId || !addressId) return res.status(400).json({ok:false,error:'회원 정보와 배송지 정보가 필요합니다.'});
  const client=await pool.connect().catch(()=>null); if(!client) return res.status(500).json({ok:false,error:'서버 데이터베이스에 연결할 수 없습니다.'});
  try{
    await client.query('BEGIN');
    const exists=await client.query(`SELECT address_id FROM gm_member_address WHERE member_id=$1 AND address_id=$2 FOR UPDATE`, [memberId,addressId]);
    if(!exists.rowCount){
      await client.query('ROLLBACK');
      return res.status(404).json({ok:false,error:'선택한 배송지를 찾을 수 없습니다.'});
    }
    await client.query(`UPDATE gm_member_address
      SET is_default='N', updated_at=NOW()
      WHERE member_id=$1 AND address_id<>$2 AND is_default='Y'`, [memberId,addressId]);
    const ar=await client.query(`UPDATE gm_member_address
      SET is_default='Y', last_used_at=NOW(), updated_at=NOW()
      WHERE member_id=$1 AND address_id=$2
      RETURNING *`, [memberId,addressId]);
    const saved=ar.rows[0];
    await client.query(`UPDATE gm_member SET
      default_receiver_name=$2,default_receiver_phone=$3,default_receiver_mobile=$4,
      default_zipcode=$5,default_address1=$6,default_address2=$7,default_address_old=$8,default_address_full=$9,
      default_sido=$10,default_sigungu=$11,default_eup_myeon_dong=$12,customs_clearance_code=$13,delivery_memo=$14,updated_at=NOW()
      WHERE member_id=$1`,
      [memberId,saved.receiver_name,saved.receiver_phone,saved.receiver_mobile,saved.zipcode,saved.address1,saved.address2,saved.address_old,saved.address_full,saved.sido,saved.sigungu,saved.eup_myeon_dong,saved.customs_clearance_code,saved.delivery_memo]);
    await client.query('COMMIT');
    res.json({ok:true,address:saved,action:'selected'});
  }catch(e){
    await client.query('ROLLBACK').catch(()=>{});
    console.error('[GM_MEMBER_ADDRESS_SELECT_ERROR]', {code:e&&e.code, constraint:e&&e.constraint, message:e&&e.message});
    res.status(500).json({ok:false,error:'기본 배송지를 지정하지 못했습니다. 다시 시도해 주세요.'});
  }
  finally{ client.release(); }
});


router.post(['/api/gm/member/address/sync','/api/member/address/sync'], async (req,res)=>{
  const pool=db(req), b=req.body||{}; if(!pool) return res.status(500).json({ok:false,error:'서버 데이터베이스에 연결할 수 없습니다.'});
  const memberId=pick(b, ['member_id','memberId']); if(!memberId) return res.status(400).json({ok:false,error:'회원 정보가 필요합니다.'});

  // 주문서 진입·회원 자동 동기화에서는 주소록을 생성/삭제하지 않는다.
  // 주소록 전체 동기화는 관리 화면에서 명시적으로 address_sync_yn=Y를 보낸 경우에만 허용한다.
  const explicitSync = yn(b.address_sync_yn || b.sync_addresses_yn || b.explicit_sync_yn) === 'Y';
  if(!explicitSync){
    return res.json({ok:true,skipped:true,reason:'배송지 전체 동기화 요청이 없어 처리를 건너뛰었습니다.'});
  }
  const input = Array.isArray(b.addresses) ? b.addresses : [];
  const currentRaw = b.current_address && typeof b.current_address === 'object' ? b.current_address : null;
  const rawList = input.slice();
  if(currentRaw) rawList.unshift(Object.assign({}, currentRaw, {is_default:'Y'}));
  const seen = new Set();
  const addresses = [];
  for(const raw of rawList){
    const a = addressPayload(raw || {}, memberId);
    if(!a.address1 && !a.zipcode && !a.receiver_name && !a.receiver_mobile) continue;
    const key = a.address_id || addressFingerprint(a);
    if(seen.has(key)) continue;
    seen.add(key);
    addresses.push(a);
  }
  if(!addresses.length) return res.status(400).json({ok:false,error:'저장할 수 있는 배송지 정보가 없습니다.'});
  const deleteMissing = yn(b.delete_missing) === 'Y' || b.delete_missing === true;
  const client=await pool.connect().catch(()=>null); if(!client) return res.status(500).json({ok:false,error:'서버 데이터베이스에 연결할 수 없습니다.'});
  try{
    await client.query('BEGIN');
    const keepIds=[]; const upserted=[];
    if(addresses.some(a=>a.is_default==='Y')) await client.query(`UPDATE gm_member_address SET is_default='N', updated_at=NOW() WHERE member_id=$1`, [memberId]);
    for(let i=0;i<addresses.length;i++){
      const a = addresses[i];
      if(i===0 && !addresses.some(x=>x.is_default==='Y')) a.is_default='Y';
      const ar=await client.query(`INSERT INTO gm_member_address (address_id,member_id,address_name,receiver_name,receiver_phone,receiver_mobile,zipcode,address1,address2,address_old,address_full,sido,sigungu,eup_myeon_dong,customs_clearance_code,delivery_memo,is_default,created_at,updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,NOW(),NOW())
        ON CONFLICT (address_id) DO UPDATE SET address_name=EXCLUDED.address_name,receiver_name=EXCLUDED.receiver_name,receiver_phone=EXCLUDED.receiver_phone,receiver_mobile=EXCLUDED.receiver_mobile,zipcode=EXCLUDED.zipcode,address1=EXCLUDED.address1,address2=EXCLUDED.address2,address_old=EXCLUDED.address_old,address_full=EXCLUDED.address_full,sido=EXCLUDED.sido,sigungu=EXCLUDED.sigungu,eup_myeon_dong=EXCLUDED.eup_myeon_dong,customs_clearance_code=EXCLUDED.customs_clearance_code,delivery_memo=EXCLUDED.delivery_memo,is_default=EXCLUDED.is_default,updated_at=NOW() RETURNING *`,
        [a.address_id,a.member_id,a.address_name,a.receiver_name,a.receiver_phone,a.receiver_mobile,a.zipcode,a.address1,a.address2,a.address_old,a.address_full,a.sido,a.sigungu,a.eup_myeon_dong,a.customs_clearance_code,a.delivery_memo,a.is_default]);
      keepIds.push(a.address_id); upserted.push(ar.rows[0]);
    }
    let deleted=[];
    if(deleteMissing && keepIds.length){
      const dr = await client.query(`DELETE FROM gm_member_address WHERE member_id=$1 AND NOT (address_id = ANY($2::text[])) RETURNING address_id`, [memberId, keepIds]);
      deleted = dr.rows || [];
    }
    const def = upserted.find(a=>a.is_default==='Y') || upserted[0];
    if(def){
      await client.query(`UPDATE gm_member SET default_receiver_name=$2,default_receiver_phone=$3,default_receiver_mobile=$4,default_zipcode=$5,default_address1=$6,default_address2=$7,default_address_old=$8,default_address_full=$9,default_sido=$10,default_sigungu=$11,default_eup_myeon_dong=$12,customs_clearance_code=$13,delivery_memo=$14,updated_at=NOW() WHERE member_id=$1`,
        [memberId,def.receiver_name,def.receiver_phone,def.receiver_mobile,def.zipcode,def.address1,def.address2,def.address_old,def.address_full,def.sido,def.sigungu,def.eup_myeon_dong,def.customs_clearance_code,def.delivery_memo]);
    }
    await client.query('COMMIT');
    res.json({ok:true,upserted_count:upserted.length,deleted_count:deleted.length,items:upserted,deleted});
  }catch(e){ await client.query('ROLLBACK').catch(()=>{}); console.error('[GM_MEMBER_API_ERROR]', {code:e&&e.code, message:e&&e.message}); res.status(500).json({ok:false,error:'회원 정보를 처리하지 못했습니다. 다시 시도해 주세요.'}); }
  finally{ client.release(); }
});

router.get(['/api/gm/member/address/list','/api/member/address/list'], async (req,res)=>{
  const pool=db(req); if(!pool) return res.status(500).json({ok:false,error:'서버 데이터베이스에 연결할 수 없습니다.'});
  const memberId=s(req.query.member_id || req.query.memberId); if(!memberId) return res.status(400).json({ok:false,error:'회원 정보가 필요합니다.'});
  try{
    const a=await pool.query('SELECT * FROM gm_member_address WHERE member_id=$1 ORDER BY is_default DESC, last_used_at DESC NULLS LAST, updated_at DESC, created_at DESC',[memberId]);
    res.json({ok:true,items:a.rows,default_address:a.rows.find(x=>x.is_default==='Y')||a.rows[0]||null});
  }catch(e){ console.error('[GM_MEMBER_API_ERROR]', {code:e&&e.code, message:e&&e.message}); res.status(500).json({ok:false,error:'회원 정보를 불러오지 못했습니다. 다시 시도해 주세요.'}); }
});

router.get(['/api/gm/member/address/default','/api/member/address/default'], async (req,res)=>{
  const pool=db(req); if(!pool) return res.status(500).json({ok:false,error:'서버 데이터베이스에 연결할 수 없습니다.'});
  const memberId=s(req.query.member_id || req.query.memberId); if(!memberId) return res.status(400).json({ok:false,error:'회원 정보가 필요합니다.'});
  try{
    const a=await pool.query(`
      SELECT *
      FROM gm_member_address
      WHERE member_id=$1
      ORDER BY is_default DESC, last_used_at DESC NULLS LAST, updated_at DESC, created_at DESC
      LIMIT 1
    `,[memberId]);
    res.json({ok:true,address:a.rows[0]||null});
  }catch(e){ console.error('[GM_MEMBER_API_ERROR]', {code:e&&e.code, message:e&&e.message}); res.status(500).json({ok:false,error:'회원 정보를 불러오지 못했습니다. 다시 시도해 주세요.'}); }
});

module.exports=router;
