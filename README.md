# GLOMART Cloudtype Scrap Switch Server V4 Docker

## 목적

Cloudtype 일반 Node 실행에서 Chromium 실행 라이브러리가 부족한 문제 해결.

V4는 Dockerfile에서 Chromium 실행에 필요한 Linux 라이브러리를 설치합니다.

## 파일

- Dockerfile
- index.js
- package.json
- .dockerignore
- README.md

## Cloudtype 설정

배포 방식은 Dockerfile 기준으로 선택합니다.

Start Command는 Dockerfile의 CMD를 사용하므로 별도 지정이 필요 없으면 비워둡니다.
지정해야 하면:

```text
npm start
```

## 테스트

```text
/health
/module/scrap/api/search?q=떡볶이&page=1
```

성공 버전:

```text
GLOMART_CLOUDTYPE_SCRAP_SWITCH_V4_DOCKER_PLAYWRIGHT_20260506
```
