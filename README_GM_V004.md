# GM_API_DB_READY_V004

업로드 파일:
- `server.js`
- `index.js`
- `package.json`
- `gm_tables.sql`
- `gm_reset_tables.sql`

적용:
1. GitHub 저장소에 위 파일 업로드/교체
2. Commit changes
3. Cloudtype 자동 재배포 대기
4. 확인 URL:
   - `/health`
   - `/api/gm/health`
   - `/api/gm/db/status`

주의:
- DB 비밀번호/환경변수가 없으면 서버는 떠도 DB 연결은 실패할 수 있습니다.
- 이 경우 Cloudtype에서 `DATABASE_URL` 또는 `PGPASSWORD`를 glomart-api-v2 서비스 환경변수로 연결해야 합니다.
- 테이블은 서버 시작 시 `gm_tables.sql`을 자동 적용합니다.
