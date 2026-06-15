# GM_NETWORK_FINAL_SERVER_V001

## 기준
- 셀러 정산 제외. 셀러는 Cafe24 시스템 사용.
- 네트워크 사업자 인센티브 관리만 포함.
- 회원 구조는 `gm_member.member_id + gm_member.recommender_id`만 사용.
- 회원 레코드에 하위 회원 ID를 저장하지 않는다.
- 일간 주문/환불은 거래 원장이 아니라 월별 Summary 테이블에 일자별 합계만 누적한다.
- 확정 인센티브는 월정산 테이블에서 회원 1명당 1행, STEP1~STEP5는 컬럼형으로 저장한다.

## 추가 파일
- `migrations/22_gm_network_incentive_final.sql`
- `services/GM_NETWORK_INCENTIVE_ENGINE.js`
- `jobs/GM_NETWORK_INCENTIVE_DAILY_JOB.js`
- `routes/network.js`
- `mobile/account/gm_account.html`
- `module/account/GM_ACCOUNT.js`
- `module/account/GM_ACCOUNT.css`
- `schema_review/GM_NETWORK_SCHEMA_FINAL_V4.xlsx`

## 자동 생성되는 테이블명
KST 기준으로 현재월/차월, 현재년/차년을 생성한다.

예: 2026년 7월 기준
- `gm_network_order_2026_07`
- `gm_network_return_2026_07`
- `gm_network_2026_07`
- `gm_network_order_2026_08`
- `gm_network_return_2026_08`
- `gm_network_2026_08`
- `gm_network_order_2026`
- `gm_network_return_2026`
- `gm_network_2026`
- `gm_network_order_2027`
- `gm_network_return_2027`
- `gm_network_2027`

## 월별 주문/환불 Summary
- PK: `member_id + step_no`
- 거래 발생 시 해당 사업자의 step1~5 레코드만 생성
- `order_01~order_31`, `return_01~return_31`은 해당 일자의 합계금액
- `order_total`, `return_total`은 월간 합계

## 지급정보
- `gm_member_payment_info`: 회원의 현재 지급 프로필
- `gm_network_payment_snapshot`: 실제 지급 시점 스냅샷
- 지급 스냅샷에는 `transfer_day`, `exchange_rate`, `transfer_amount` 포함

## 서버 라우트
- `POST /api/gm/network/ensure-tables`
- `GET /api/gm/network/periods`
- `GET /api/gm/network/monthly/:ym/:member_id`
- `GET /api/gm/network/yearly/:year/:member_id`

## 검증
- JS 문법검사 완료:
  - `services/GM_NETWORK_INCENTIVE_ENGINE.js`
  - `jobs/GM_NETWORK_INCENTIVE_DAILY_JOB.js`
  - `routes/network.js`
  - `server.js`
- 이전 제안에서 있던 seller settlement, daily step summary, tree current 중심 설계는 이번 최종안에서 제외했다.
