GM_NETWORK_V002_ACCOUNT_FINAL_PATCH

적용 파일:
- migrations/07_gm_member_wallet.sql
- routes/account.js
- server.js
- index.js

내용:
1) gm_member 기존 테이블에 cafe24_raw_json / wallet 컬럼이 없을 때 ALTER TABLE로 보강.
2) /api/gm/account/summary, /api/gm/account/ledger 라우트 추가.
3) 루트(/) routes 목록에 account API 표시 추가.

주의:
- 기존 데이터 삭제 없음.
- 네트워크 집계 엔진은 테이블 생성/조회 기반이며 실제 정산 계산 고도화는 다음 패치에서 진행.
