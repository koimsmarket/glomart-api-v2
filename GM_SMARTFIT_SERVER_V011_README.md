# GM_SMARTFIT_SERVER_V011

## 수정 내용
- 기존 SmartFit 테이블이 이미 존재할 때 `search_visible` 인덱스가 ALTER보다 먼저 실행되어 DB init이 실패하던 문제 수정
- template/item/collection/event 호환 ALTER를 각 인덱스 생성보다 앞에 배치
- 수정 파일만 포함

## 포함 파일
- migrations/24_gm_smartfit.sql
