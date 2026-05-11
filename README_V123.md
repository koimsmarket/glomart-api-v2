# GLOMART V123 Cloudtype Server

V123 = 실제 저장/조회/CSV/백업 API 추가 버전.

## GitHub에 올릴 파일
- server.js
- schema.sql
- package.json
- README_V123.md

## 확인
- GET /health
- GET /db/status

## 저장 API
- POST /scrap/save
- POST /scrap/save-batch
- POST /images/save
- POST /stats/log

## 조회 API
- GET /products/list
- GET /images/list?product_id=PRODUCT_ID
- GET /stats/top

## CSV 다운로드
- GET /export/products.csv
- GET /export/images.csv
- GET /export/stats.csv

## 백업
- POST /backup/create
- GET /backup/list
- GET /backup/download-latest
- GET /backup/download/파일명.db

## 가격 표시 기준
- display_price = Math.round((real_price * 1.2) / 10) * 10

## DB 경로
- /data 가 쓰기 가능하면 /data/glomart.db 사용
- 디스크가 없으면 /tmp/glomart-data/glomart.db 사용. 이 경우 테스트용이며 재시작/재배포 시 유실 가능성 있음.
