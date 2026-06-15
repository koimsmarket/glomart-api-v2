# GM_NETWORK_V002_ACCOUNT_API_PATCH

업로드 위치:
- `routes/account.js` → 서버 `routes/` 폴더
- `server.js` → 루트 교체
- `index.js` → 루트 교체(보조 엔트리 보호용)

추가/수정 내용:
- `/api/gm/account/summary` 추가
- `/api/gm/account/ledger` 추가
- `GM_ACCOUNT.js`가 호출하던 API 404 문제 보완
- 현재월 `gm_network_YYYY_MM` 테이블이 있으면 STEP1~5 요약을 계정 페이지 형식으로 반환
- 네트워크 집계 데이터가 아직 없으면 빈 배열 반환하므로 계정 페이지는 깨지지 않음

주의:
- 이 패치는 계정조회 API 보완 패치다.
- 주문/반품 누적 및 월정산 계산 엔진은 별도 확정 후 추가한다.
