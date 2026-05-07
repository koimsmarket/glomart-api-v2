GLOMART USER DEVICE COLLECT TEST V1.1

수정 핵심:
- 외부 JS 로드 방식 제거
- 북마클릿 안에 수집 코드 직접 포함
- fetch 전송 대신 form POST 전송
- 쿠팡 CSP에 막힐 가능성 줄임

업로드:
1. ZIP 압축 해제
2. GitHub glomart-api-v2 루트 전체 덮어쓰기
3. Cloudtype Dockerfile 재배포

확인:
https://port-0-glomart-api-v2-mordwrnh222b6c36.sel3.cloudtype.app/

북마클릿:
https://port-0-glomart-api-v2-mordwrnh222b6c36.sel3.cloudtype.app/public/collector_bookmarklet.html

PC 테스트:
1. Ctrl+Shift+B
2. "Glomart 쿠팡 수집 V1.1" 버튼을 즐겨찾기바로 드래그
3. https://www.coupang.com/np/search?q=떡볶이
4. 페이지가 완전히 뜬 뒤 북마클릿 클릭
5. "Glomart 전송 시도: N개" 알림 확인
6. 새 탭에 수집 완료 페이지 확인

저장 확인:
https://port-0-glomart-api-v2-mordwrnh222b6c36.sel3.cloudtype.app/module/scrap/api/cache/search?q=떡볶이&page=1

우리 폼:
https://port-0-glomart-api-v2-mordwrnh222b6c36.sel3.cloudtype.app/public/glomart_cache_order_form.html

주문 목록:
https://port-0-glomart-api-v2-mordwrnh222b6c36.sel3.cloudtype.app/module/scrap/api/order/list
