const express = require('express');
const router = express.Router();
const { LIMITS, CAFE24_MEMBER_HEADERS, dbFrom, fail, parseCsv, getColumns, mapCafe24Member, cafe24ImportResultRow, upsertObject, toCsv, parseRawJson, rawOrFallback, refundJoin } = require('./core');

router.post('/api/gm/builder/cafe24-member-import', express.text({ type:['text/*','application/csv'], limit:'50mb' }), async (req,res)=>{
  const apply = String(req.query.apply || '').toUpperCase() === 'YES';
  const db = dbFrom(req);
  let rows = parseCsv(req.body);
  if (rows.length > LIMITS.MAX_ROWS) rows = rows.slice(0, LIMITS.MAX_ROWS);
  const result = [];
  let processed=0, insertedOrUpdated=0, skipped=0, invalid=0;
  const cols = ['row_no','member_id','result','member_action','address_action','name','email','phone','mobile','zipcode','address1','address2','member_grade','member_grade_code','deposit_balance','point_balance','refund_account_info','total_order_count','total_purchase_amount','last_login_at','joined_at','reason'];
  try {
    const memberCols = new Set(await getColumns(db, 'gm_member'));
    const addressCols = new Set(await getColumns(db, 'gm_member_address'));
    const client = apply ? await db.connect() : null;
    try {
      if (client) await client.query('BEGIN');
      for (const row of rows) {
        processed++;
        const mapped = mapCafe24Member(row);
        const m = mapped.member;
        const a = mapped.address;
        if (!m.member_id) {
          invalid++; skipped++;
          result.push(cafe24ImportResultRow(row, m, 'SKIP', '', '', 'MISSING_MEMBER_ID'));
          continue;
        }
        const mObj = {};
        for (const [k,v] of Object.entries(m)) if (memberCols.has(k)) mObj[k]=v;
        const aObj = {};
        for (const [k,v] of Object.entries(a)) if (addressCols.has(k)) aObj[k]=v;
        let memberAction = 'VALID_MEMBER';
        let addressAction = (a.zipcode || a.address1 || a.address2) ? 'VALID_ADDRESS' : 'NO_ADDRESS';
        if (apply) {
          const mr = await upsertObject(client, 'gm_member', mObj, ['member_id']);
          memberAction = mr.action;
          if (addressAction !== 'NO_ADDRESS') {
            // keep only one default address per member
            if (addressCols.has('is_default')) await client.query(`UPDATE gm_member_address SET is_default='N', updated_at=NOW() WHERE member_id=$1`, [m.member_id]);
            const ar = await upsertObject(client, 'gm_member_address', aObj, ['address_id']);
            addressAction = ar.action;
          }
        }
        insertedOrUpdated++;
        result.push(cafe24ImportResultRow(row, m, apply?'APPLIED':'VALID', memberAction, addressAction, apply?'APPLIED':'DRY_RUN'));
      }
      if (client) await client.query('COMMIT');
    } catch(e) {
      if (client) await client.query('ROLLBACK').catch(()=>{});
      throw e;
    } finally {
      if (client) client.release();
    }
    const csv = toCsv(result, cols);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="cafe24_member_import_${apply?'apply':'dryrun'}_${Date.now()}.csv"`);
    res.end(csv);
  } catch(e) {
    fail(res, 500, 'cafe24 member import failed', { detail:String(e && e.message || e), processed, insertedOrUpdated, skipped, invalid });
  }
});


router.get('/api/gm/builder/cafe24-member-export', async (req,res)=>{
  const db = dbFrom(req);
  const limit = Math.min(Math.max(Number(req.query.limit || 50000), 1), 100000);
  try{
    const memberCols = new Set(await getColumns(db, 'gm_member'));
    const addressCols = new Set(await getColumns(db, 'gm_member_address').catch(()=>[]));
    const rawExpr = memberCols.has('cafe24_raw_json') ? 'm.cafe24_raw_json' : "'{}'::jsonb";
    const addrSelect = addressCols.has('address_id') ? `
      LEFT JOIN LATERAL (
        SELECT * FROM gm_member_address a
        WHERE a.member_id=m.member_id
        ORDER BY CASE WHEN a.is_default='Y' THEN 0 ELSE 1 END, a.updated_at DESC NULLS LAST
        LIMIT 1
      ) a ON TRUE` : '';
    const r = await db.query(`
      SELECT m.*, ${rawExpr} AS cafe24_raw,
        ${addressCols.has('address_id') ? `a.zipcode AS addr_zipcode, a.address1 AS addr_address1, a.address2 AS addr_address2, a.sido AS addr_sido, a.sigungu AS addr_sigungu, a.receiver_phone AS addr_phone, a.receiver_mobile AS addr_mobile, a.receiver_name AS addr_receiver_name` : `'' AS addr_zipcode, '' AS addr_address1, '' AS addr_address2, '' AS addr_sido, '' AS addr_sigungu, '' AS addr_phone, '' AS addr_mobile, '' AS addr_receiver_name`}
      FROM gm_member m
      ${addrSelect}
      ORDER BY m.updated_at DESC NULLS LAST, m.created_at DESC NULLS LAST
      LIMIT $1`, [limit]);
    const rows = r.rows.map(x=>{
      const raw = parseRawJson(x.cafe24_raw);
      const fallback = {
        '아이디':x.member_id,
        '이름':x.member_name || x.addr_receiver_name,
        '영문이름':x.member_name_en,
        '이메일':x.email,
        '휴대폰번호':x.default_receiver_mobile || x.addr_mobile || x.phone,
        '전화번호':x.default_receiver_phone || x.addr_phone,
        '국가':x.country_code,
        '국적':x.nationality,
        '우편번호':x.default_zipcode || x.addr_zipcode,
        '주소1':x.default_address1 || x.addr_address1,
        '주소2':x.default_address2 || x.addr_address2,
        '주 (State/Province)':x.default_sido || x.addr_sido,
        '도시 (City)':x.default_sigungu || x.addr_sigungu,
        '추천인 아이디':x.recommender_id,
        '회원등급':x.member_grade,
        '회원등급코드':x.member_grade_code,
        '사용가능 적립금':x.point_balance,
        '총예치금':x.deposit_balance,
        '환불계좌정보(은행/계좌/예금주)':refundJoin(x.refund_bank_name,x.refund_account_no,x.refund_account_holder),
        '누적주문건수':'',
        '총 실주문건수':'',
        '총구매금액':'',
        '총 방문횟수(1년 내)':'',
        '총 사용 적립금':'',
        '총적립금':'',
        '미가용 적립금':'',
        '최종접속일':'',
        '최종주문일':'',
        '회원 가입일':'',
        '가입시간':'',
        '회원구분':'',
        '회원 가입경로':'',
        'e메일 수신여부':'',
        '모바일 메시지 수신여부':'',
        '탈퇴여부':'',
        '탈퇴일':'',
        '휴면처리일':''
      };
      const out = {};
      for (const h of CAFE24_MEMBER_HEADERS) out[h] = rawOrFallback(raw, h, fallback[h] ?? '');
      return out;
    });
    const csv = toCsv(rows, CAFE24_MEMBER_HEADERS);
    res.setHeader('Content-Type','text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="cafe24_member_export_${Date.now()}.csv"`);
    res.end(csv);
  }catch(e){
    fail(res, 500, 'cafe24 member export failed', { detail:String(e && e.message || e) });
  }
});


router.get('/api/gm/builder/cafe24-member-template', (req,res)=>{
  const headers = CAFE24_MEMBER_HEADERS;
  const csv = headers.join(',') + '\n';
  res.setHeader('Content-Type','text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="cafe24_member_import_template.csv"`);
  res.end('\ufeff' + csv);
});

module.exports = router;
