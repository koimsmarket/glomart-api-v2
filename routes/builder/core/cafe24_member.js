const { clean } = require('./csv');
const { qIdent } = require('./common');
const CAFE24_MEMBER_HEADERS = [
  'SNS ID 연동일시','SSO 연동 서비스명','e메일 수신여부','e메일 최근 수신 동의 일자','가입시간','개인인증방법','개인정보 수집 및 이용 동의 여부(주문서 간단 회원가입 시)','개인정보 수집 및 이용 동의 일자(주문서 간단 회원가입 시)','개인정보 제3자 제공 동의 여부','개인정보 제3자 제공 동의 일자','개인정보 처리 위탁 동의 여부','개인정보 처리 위탁 동의 일자','결혼기념일','결혼여부','관심분야','국가','국적','국제면허번호','나이','누적주문건수','답변','도시 (City)','마케팅 목적의 개인정보 수집 및 이용 동의 여부','마케팅 목적의 개인정보 수집 및 이용 동의 일자','모바일 메시지 수신여부','모바일 메시지 최근 수신 동의 일자','모바일앱 이용여부','미가용 적립금','배우자생일','별명','불량회원','사업자구분(P:개인사업자/C:법인사업자)','사업자번호','사용가능 적립금','상호','생년월일','성별','실결제금액','실명인증여부','아이디','양력(T)/음력(F)','업태','여권번호','연동중인 SNS','연소득','영문이름','우편번호','이름','이름(발음)','이메일','인터넷이용장소','자녀','자동차','전화번호','접속 IP','종목','주 (State/Province)','주소1','주소2','지역','직업','직종','총 방문횟수(1년 내)','총 사용 적립금','총 실주문건수','총구매금액','총예치금','총적립금','최종접속일','최종주문일','최종학력','추가사항1','추가사항2','추가사항3','추가사항4','추천인 아이디','탈퇴구분','탈퇴사유','탈퇴여부','탈퇴일','특별회원','평생회원','평생회원 전환일','확인질문','환불계좌정보(은행/계좌/예금주)','회원 가입경로','회원 가입일','회원구분','회원등급','회원등급적용형태','회원등급코드','회원인증여부','휴대폰번호','휴면안내(대량메일) 발송일','휴면처리일','휴면회원 해제일'
];
function isBlankCafe24(v) {
  const x = clean(v);
  return !x || /^(BLANK|NULL|N\/A|-|없음)$/i.test(x);
}
function pickKorRaw(row, names, d='') {
  for (const n of names) if (row[n] !== undefined && row[n] !== null) return clean(row[n]);
  return d;
}
function moneyOrBlank(v) {
  if (isBlankCafe24(v)) return '';
  const n = Number(clean(v).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? Math.round(n) : '';
}
function intOrBlank(v) { return moneyOrBlank(v); }
function languageFromCafe24(nationality, country) {
  const x = (clean(nationality) || clean(country)).toLowerCase();
  if (!x) return '';
  const rules = [
    [/베트남|vietnam|viet/, 'vi'], [/중국|china|chinese|cn/, 'zh'], [/대만|taiwan|tw/, 'tw'], [/일본|japan|jp/, 'ja'],
    [/태국|thailand|thai/, 'th'], [/우즈베키스탄|uzbek/, 'uz'], [/네팔|nepal/, 'ne'], [/캄보디아|cambodia|khmer/, 'km'],
    [/인도네시아|indonesia/, 'id'], [/필리핀|philippines|filipino/, 'tl'], [/몽골|mongol/, 'mn'], [/미얀마|myanmar|burma/, 'my'],
    [/카자흐|kazakh/, 'kk'], [/스리랑카|sri\s*lanka/, 'si'], [/러시아|russia/, 'ru'], [/방글라데시|bangladesh/, 'bn'],
    [/파키스탄|pakistan|urdu/, 'ur'], [/라오스|laos/, 'lo'], [/인도|india|hindi/, 'hi'], [/튀르키|터키|turkey/, 'tr'],
    [/이란|iran|persia/, 'fa'], [/스페인|spain|spanish/, 'es'], [/프랑스|france|french/, 'fr'], [/한국|대한민국|korea|kr/, 'ko']
  ];
  for (const [re, lang] of rules) if (re.test(x)) return lang;
  return 'ko';
}
function parseRawJson(v){
  try { if (!v) return {}; if (typeof v === 'object') return v; return JSON.parse(v); } catch(e){ return {}; }
}
function rawOrFallback(raw, header, fallback='') {
  const v = raw && Object.prototype.hasOwnProperty.call(raw, header) ? raw[header] : '';
  return isBlankCafe24(v) ? fallback : clean(v);
}

function pickKor(row, names, d='') {
  for (const n of names) {
    if (row[n] !== undefined && row[n] !== null && !isBlankCafe24(row[n])) return clean(row[n]);
  }
  return d;
}
function digits(v) {
  return clean(v).replace(/[^0-9]/g, '');
}
function money(v) {
  const n = Number(clean(v).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? Math.round(n) : 0;
}
function splitRefundInfo(v) {
  const raw = clean(v);
  const out = { bank:'', account:'', holder:'' };
  if (!raw) return out;
  // Cafe24 export is usually "은행/계좌/예금주", but tolerate spaces, pipes and commas.
  const parts = raw.split(/[\/|,]/).map(x=>clean(x)).filter(Boolean);
  if (parts.length >= 3) {
    out.bank = parts[0]; out.account = parts[1]; out.holder = parts.slice(2).join(' ');
  } else if (parts.length === 2) {
    out.bank = parts[0]; out.account = parts[1];
  } else {
    out.account = raw;
  }
  return out;
}

function ynCafe24(v) {
  const x = clean(v).toUpperCase();
  if (!x) return '';
  if (['T','Y','YES','TRUE','1','동의','수신'].includes(x)) return 'Y';
  if (['F','N','NO','FALSE','0','거부','미수신'].includes(x)) return 'N';
  return clean(v);
}
function intMoney(v) { return money(v); }
function intMoneyOrBlank(v) { return intOrBlank(v); }
function dateText(v) { return clean(v); }
function rawJsonText(row) {
  try { return JSON.stringify(row || {}); } catch(e) { return '{}'; }
}
function refundJoin(bank, account, holder) {
  return [clean(bank), clean(account), clean(holder)].filter(Boolean).join('/');
}
function cafe24Status(row) {
  const withdrawn = pickKor(row, ['탈퇴여부']);
  const dormant = pickKor(row, ['휴면처리일','휴면안내(대량메일) 발송일']);
  const bad = pickKor(row, ['불량회원']);
  if (/^(T|Y|1|TRUE|탈퇴)$/i.test(withdrawn)) return 'withdrawn';
  if (dormant) return 'dormant';
  if (/^(T|Y|1|TRUE)$/i.test(bad)) return 'blocked';
  return 'active';
}
function compactAddress(zip, a1, a2, old) {
  return [zip ? '[' + zip + ']' : '', a1, a2, old ? '(' + old + ')' : ''].filter(Boolean).join(' ').trim();
}
function mapCafe24Member(row) {
  const memberId = pickKor(row, ['아이디','ID','회원아이디','member_id']);
  const name = pickKor(row, ['이름','회원명']);
  const phone = pickKor(row, ['전화번호']);
  const mobile = pickKor(row, ['휴대폰번호']);
  const zip = pickKor(row, ['우편번호']);
  const addr1 = pickKor(row, ['주소1']);
  const addr2 = pickKor(row, ['주소2']);
  const sido = pickKor(row, ['주 (State/Province)','지역']);
  const city = pickKor(row, ['도시 (City)']);
  const refund = splitRefundInfo(pickKor(row, ['환불계좌정보(은행/계좌/예금주)']));
  const pointUsable = moneyOrBlank(pickKorRaw(row, ['사용가능 적립금']));
  const pointTotal = moneyOrBlank(pickKorRaw(row, ['총적립금']));
  const nationality = pickKor(row, ['국적']);
  const country = pickKor(row, ['국가']);
  const lang = languageFromCafe24(nationality, country);
  const member = {
    member_id: memberId,
    cafe24_member_id: memberId,
    member_name: name,
    member_name_en: pickKor(row, ['영문이름']),
    email: pickKor(row, ['이메일','이메일주소']),
    phone: mobile || phone,
    country_code: country,
    nationality: nationality,
    language_code: lang,
    cs_language: lang,
    recommender_id: pickKor(row, ['추천인 아이디']),
    member_grade: pickKor(row, ['회원등급']),
    member_grade_code: pickKor(row, ['회원등급코드']),
    member_status: cafe24Status(row),
    deposit_balance: moneyOrBlank(pickKorRaw(row, ['총예치금'])),
    point_balance: pointUsable !== '' ? pointUsable : pointTotal,
    refund_bank_name: refund.bank,
    refund_account_no: refund.account,
    refund_account_holder: refund.holder,
    default_receiver_name: name,
    default_receiver_phone: phone,
    default_receiver_mobile: mobile,
    default_zipcode: zip,
    default_address1: addr1,
    default_address2: addr2,
    default_address_old: '',
    default_address_full: compactAddress(zip, addr1, addr2, ''),
    default_sido: sido,
    default_sigungu: city,
    default_eup_myeon_dong: '',
    delivery_memo: '',
    // Cafe24 원본 96개 컬럼은 실제 DB 컬럼을 늘리지 않고 cafe24_raw_json 하나에 100% 보존한다.
    // gm_member에는 주문/로그인/배송에 바로 필요한 핵심 컬럼만 저장한다.
    cafe24_raw_json: rawJsonText(row)
  };
  const address = {
    address_id: memberId ? memberId + '_default' : '',
    member_id: memberId,
    address_name: '기본배송지',
    receiver_name: name,
    receiver_phone: phone,
    receiver_mobile: mobile,
    zipcode: zip,
    address1: addr1,
    address2: addr2,
    address_old: '',
    address_full: compactAddress(zip, addr1, addr2, ''),
    sido: sido,
    sigungu: city,
    eup_myeon_dong: '',
    delivery_memo: '',
    is_default: 'Y'
  };
  return { member, address };
}

function cafe24ImportResultRow(row, m, action, memberAction, addressAction, reason) {
  return {
    row_no: row.__row_no,
    member_id: m.member_id || '',
    result: action,
    member_action: memberAction || '',
    address_action: addressAction || '',
    name: m.member_name || '',
    email: m.email || '',
    phone: m.default_receiver_phone || '',
    mobile: m.default_receiver_mobile || '',
    zipcode: m.default_zipcode || '',
    address1: m.default_address1 || '',
    address2: m.default_address2 || '',
    member_grade: m.member_grade || '',
    member_grade_code: m.member_grade_code || '',
    deposit_balance: m.deposit_balance === undefined ? '' : m.deposit_balance,
    point_balance: m.point_balance === undefined ? '' : m.point_balance,
    refund_account_info: refundJoin(m.refund_bank_name, m.refund_account_no, m.refund_account_holder),
    total_order_count: intMoneyOrBlank(pickKorRaw(row, ['누적주문건수'])),
    total_purchase_amount: moneyOrBlank(pickKorRaw(row, ['총구매금액','실결제금액'])),
    last_login_at: pickKorRaw(row, ['최종접속일']),
    joined_at: pickKorRaw(row, ['회원 가입일']),
    reason: reason || ''
  };
}

async function upsertObject(client, table, obj, keyCols, allowBlank=false) {
  const cols = Object.keys(obj).filter(k => obj[k] !== undefined && obj[k] !== null && (allowBlank || clean(obj[k]) !== ''));
  if (!cols.length) return { action:'SKIP', reason:'NO_COLUMNS' };
  const vals = cols.map(k => obj[k]);
  const setCols = cols.filter(c => !keyCols.includes(c));
  const sql = `INSERT INTO ${qIdent(table)} (${cols.map(qIdent).join(',')}) VALUES (${cols.map((_,i)=>'$'+(i+1)).join(',')}) ON CONFLICT (${keyCols.map(qIdent).join(',')}) DO UPDATE SET ${setCols.map(c => `${qIdent(c)}=COALESCE(NULLIF(EXCLUDED.${qIdent(c)}::text,'')::${qIdent(table)}.${qIdent(c)}%TYPE,${qIdent(table)}.${qIdent(c)})`).join(',') || keyCols.map(c=>`${qIdent(c)}=EXCLUDED.${qIdent(c)}`).join(',')}, updated_at=NOW()`;
  // PostgreSQL cannot use table.column%TYPE in prepared SQL expression. Build a simpler blank-preserving query below.
  const updateSql = `INSERT INTO ${qIdent(table)} (${cols.map(qIdent).join(',')}) VALUES (${cols.map((_,i)=>'$'+(i+1)).join(',')}) ON CONFLICT (${keyCols.map(qIdent).join(',')}) DO UPDATE SET ${setCols.map(c => `${qIdent(c)}=CASE WHEN EXCLUDED.${qIdent(c)} IS NULL OR EXCLUDED.${qIdent(c)}::text='' THEN ${qIdent(table)}.${qIdent(c)} ELSE EXCLUDED.${qIdent(c)} END`).join(',') || keyCols.map(c=>`${qIdent(c)}=EXCLUDED.${qIdent(c)}`).join(',')}${cols.includes('updated_at') || setCols.includes('updated_at') ? '' : ', updated_at=NOW()'}`;
  await client.query(updateSql, vals);
  return { action:'UPSERT' };
}

// GM_CATEGORY_BATCH_IMPORT_V001
// 카테고리처럼 1만 행 이상 대량 CSV는 전체를 한 트랜잭션으로 처리하지 않는다.
// - 300건 단위 트랜잭션
// - 행 단위 SAVEPOINT로 일부 실패만 기록
// - CP_CODE 우선 개발키 유지(keyAny: cp_code -> gm_code)
// - 결과 CSV에 batch_no/action/reason을 남긴다.

module.exports = { CAFE24_MEMBER_HEADERS, parseRawJson, rawOrFallback, refundJoin, mapCafe24Member, cafe24ImportResultRow, upsertObject };
