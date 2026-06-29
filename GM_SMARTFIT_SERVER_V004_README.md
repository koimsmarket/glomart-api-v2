# GM_SMARTFIT_SERVER_V004

## 목적
SmartFit 라우트 등록 확인 문제만 수정한 패치입니다.

## 수정 파일(ROOT)
- index.js
- server.js
- routes/smartfit.js
- GM_SMARTFIT_SERVER_V004_README.md

## 수정 내용
1. `routes/smartfit.js` 로드 시 로그 추가
   - `[GM_SMARTFIT_ROUTE] loaded`
2. `index.js`, `server.js`에서 SmartFit 라우트 등록 후 로그 추가
   - `[GM_SMARTFIT_ROUTE_V001] routes/smartfit registered`
3. `/` 응답 routes 배열에 SmartFit API 목록 추가
   - `GET /api/gm/smartfit/health`
   - `GET /api/gm/smartfit/category/list`
   - `GET /api/gm/smartfit/category/search`
   - `GET /api/gm/smartfit/template/list`
   - `GET /api/gm/smartfit/template/:template_id`
   - `POST /api/gm/smartfit/template/save`
   - `POST /api/gm/smartfit/template/public`
   - `POST /api/gm/smartfit/collection/add`
   - `GET /api/gm/smartfit/collection/list`
   - `POST /api/gm/smartfit/build-cart`
   - `POST /api/gm/smartfit/event`
   - `GET /api/gm/smartfit/stat/monthly`

## 배포 후 확인
1. Cloudtype 로그에서 아래 2개 확인
   - `[GM_SMARTFIT_ROUTE] loaded`
   - `[GM_SMARTFIT_ROUTE_V001] routes/smartfit registered`
2. 브라우저에서 확인
   - `/api/gm/smartfit/health`
   - `/` routes 배열에 `/api/gm/smartfit/...` 표시
