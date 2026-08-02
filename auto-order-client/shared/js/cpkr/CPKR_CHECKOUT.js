(function () {
  'use strict';
  const U = window.GMAO_UTIL;

  const DOM = {
    addressChangeButton() {
      // 캡처 확정 DOM: button 내부 span “배송지 변경”
      return U.findButtonByText('배송지 변경');
    },
    addressSearchInput() {
      return U.qsAll('input').find(i => U.visible(i) && /도로명|건물명|번지|주소/.test(i.placeholder || '')) ||
        U.qsAll('input').find(i => U.visible(i));
    },
    addressSearchButton() {
      return U.qsAll('button').find(b => U.visible(b) && (U.txt(b).includes('검색') || /search|magnifier/.test(b.innerHTML))) ||
        U.findButtonByText('검색');
    },
    addressRows() {
      // 검색 결과 캡처: 도로명/지번/우편번호 [16485]
      return U.qsAll('li,tr,div').filter(el => U.visible(el) && /도로명|지번|\[\d{5}\]|\d{5}/.test(U.txt(el)));
    },
    detailInput() {
      return U.qsAll('input,textarea').find(i => U.visible(i) && /상세|나머지|동호|호수/.test((i.placeholder || '') + ' ' + (i.name || '') + ' ' + (i.id || '')));
    },
    receiverInput() {
      return U.qsAll('input').find(i => U.visible(i) && /받는|수령|이름|recipient|receiver/.test((i.placeholder || '') + ' ' + (i.name || '') + ' ' + (i.id || '')));
    },
    phoneInput() {
      return U.qsAll('input').find(i => U.visible(i) && /휴대|전화|연락|phone|mobile/.test((i.placeholder || '') + ' ' + (i.name || '') + ' ' + (i.id || '')));
    },
    memoInput() {
      return U.qsAll('textarea,input').find(i => U.visible(i) && /배송.*메모|요청|memo|message/.test((i.placeholder || '') + ' ' + (i.name || '') + ' ' + (i.id || '')));
    },
    saveAddressButton() {
      return U.findButtonByText(['저장', '선택', '확인', '완료', '사용']);
    },
    paymentTarget(text) {
      if (!text) return null;
      return U.qsAll('label,button,div,span').find(el => U.visible(el) && U.txt(el).includes(text));
    },
    payButton() { return U.findButtonByText('결제하기'); }
  };

  function receiverOf(order) { return order.receiver || order.shipping || order.address || {}; }
  function addressQuery(r) { return r.road_query || r.road_keyword || r.road_address_short || r.road_address || r.address || ''; }

  async function fillAddress(receiver) {
    const btn = await U.waitFor(() => DOM.addressChangeButton(), { timeout: 10000, label: '배송지 변경' });
    U.click(btn, '배송지 변경');

    const input = await U.waitFor(() => DOM.addressSearchInput(), { timeout: 8000, label: '주소검색 input' });
    U.input(input, addressQuery(receiver), '주소검색');
    await U.tick();
    const sbtn = DOM.addressSearchButton();
    if (sbtn) U.click(sbtn, '주소검색');

    const rows = await U.waitFor(() => {
      const r = DOM.addressRows();
      return r.length ? r : null;
    }, { timeout: 10000, label: '주소 검색 결과' });

    const road = U.norm(receiver.road_address || '');
    const jibun = U.norm(receiver.jibun_address || '');
    const zip = U.digits(receiver.zipcode || receiver.zip || '');
    const picked = rows.find(r => {
      const t = U.norm(U.txt(r));
      return (road && t.includes(road)) || (jibun && t.includes(jibun)) || (zip && t.includes(zip));
    }) || rows[0];
    U.click(picked, '주소 결과 선택');
    await U.tick();

    const detail = DOM.detailInput();
    if (detail && receiver.detail_address) U.input(detail, receiver.detail_address, '상세주소');
    const recv = DOM.receiverInput();
    if (recv && (receiver.name || receiver.receiver_name)) U.input(recv, receiver.name || receiver.receiver_name, '수령인');
    const phone = DOM.phoneInput();
    if (phone && receiver.phone) U.input(phone, receiver.phone, '연락처');
    const save = DOM.saveAddressButton();
    if (save) U.click(save, '배송지 저장/확인');
    await U.sleep(300);
  }

  const MOD = {
    async fillAndStop(order) {
      if (!/checkout\.coupang\.com/.test(location.hostname)) throw new Error('not checkout page');
      await U.waitFor(() => DOM.payButton() || DOM.addressChangeButton(), { timeout: 12000, label: 'checkout ready' });
      const receiver = receiverOf(order);
      if (addressQuery(receiver)) await fillAddress(receiver);

      const memo = DOM.memoInput();
      if (memo && receiver.memo) U.input(memo, receiver.memo, '배송메모');

      if (order.payment_text) {
        const pay = DOM.paymentTarget(order.payment_text);
        if (pay) U.click(U.closest(pay, 'label,button,[role="button"]') || pay, '결제수단');
      }

      const finalBtn = await U.waitFor(() => DOM.payButton(), { timeout: 8000, label: '결제하기 button' });
      finalBtn.style.outline = '4px solid red';
      finalBtn.style.boxShadow = '0 0 0 4px rgba(255,0,0,.25)';
      U.warn('결제하기 직전 정지. 결제하기는 자동 클릭하지 않음.');
      return { ok: true, stopped: true };
    },
    DOM
  };

  window.CPKR_CHECKOUT = MOD;
})();
