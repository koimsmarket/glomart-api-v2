(function () {
  'use strict';
  const U = window.GMAO_UTIL;

  const DOM = {
    addressChangeButton() {
      return U.findByText('button, span, div', '배송지 변경');
    },
    addressSearchInput() {
      return U.qsAll('input').find(i => U.visible(i) && (i.placeholder || '').includes('도로명')) ||
             U.qsAll('input').find(i => U.visible(i));
    },
    addressSearchButton() {
      return U.qsAll('button').find(b => U.visible(b) && (U.txt(b).includes('검색') || b.innerHTML.includes('search')));
    },
    addressRows() {
      return U.qsAll('li, tr, div').filter(el => U.visible(el) && /도로명|지번|\[\d{5}\]/.test(U.txt(el)));
    },
    detailInput() {
      return U.qsAll('input, textarea').find(i => U.visible(i) && /상세|나머지|주소/.test((i.placeholder || '') + ' ' + (i.name || '') + ' ' + (i.id || '')));
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
      return U.qsAll('button').find(b => U.visible(b) && /저장|선택|확인|완료/.test(U.txt(b)));
    },
    paymentRadios() {
      return U.qsAll('label, button, div').filter(el => U.visible(el) && /계좌이체|쿠페이 머니|카드/.test(U.txt(el)));
    },
    payButton() {
      return U.findByText('button', '결제하기');
    }
  };

  function addressQuery(receiver) {
    return receiver.road_query || receiver.road_keyword || receiver.road_address || receiver.address || '';
  }

  async function fillAddress(receiver) {
    const btn = await U.waitFor(() => DOM.addressChangeButton(), { timeout: 10000, label: '배송지 변경' });
    U.click(btn, '배송지 변경');
    const input = await U.waitFor(() => DOM.addressSearchInput(), { timeout: 8000, label: '주소검색 input' });
    U.input(input, addressQuery(receiver), '주소검색');
    await U.tick();
    const sbtn = DOM.addressSearchButton();
    if (sbtn) U.click(sbtn, '주소검색');
    const rows = await U.waitFor(() => DOM.addressRows().length ? DOM.addressRows() : null, { timeout: 8000, label: '주소 결과' });
    const road = U.norm(receiver.road_address || '');
    const jibun = U.norm(receiver.jibun_address || '');
    const zip = U.digits(receiver.zipcode || '');
    const picked = rows.find(r => {
      const t = U.txt(r);
      return (road && t.includes(road)) || (jibun && t.includes(jibun)) || (zip && t.includes(zip));
    }) || rows[0];
    U.click(picked, '주소 결과 선택');
    await U.tick();

    const detail = DOM.detailInput();
    if (detail && receiver.detail_address) U.input(detail, receiver.detail_address, '상세주소');
    const recv = DOM.receiverInput();
    if (recv && receiver.name) U.input(recv, receiver.name, '수령인');
    const phone = DOM.phoneInput();
    if (phone && receiver.phone) U.input(phone, receiver.phone, '연락처');
    const save = DOM.saveAddressButton();
    if (save) U.click(save, '배송지 저장/확인');
    await U.sleep(400);
  }

  const MOD = {
    async fillAndStop(order) {
      if (!/checkout\.coupang\.com/.test(location.hostname)) {
        throw new Error('not checkout page');
      }
      await U.waitFor(() => DOM.payButton() || DOM.addressChangeButton(), { timeout: 12000, label: 'checkout ready' });
      const receiver = order.receiver || order.shipping || {};
      if (addressQuery(receiver)) await fillAddress(receiver);

      const memo = DOM.memoInput();
      if (memo && receiver.memo) U.input(memo, receiver.memo, '배송메모');

      if (order.payment_text) {
        const pay = DOM.paymentRadios().find(el => U.txt(el).includes(order.payment_text));
        if (pay) U.click(pay, '결제수단');
      }

      const finalBtn = await U.waitFor(() => DOM.payButton(), { timeout: 8000, label: '결제하기 button' });
      finalBtn.style.outline = '4px solid red';
      U.warn('결제하기 직전 정지. 자동 클릭하지 않음. 확인 후 사람이 결제하세요.');
      return { ok: true, stopped: true };
    }
  };

  window.CPKR_CHECKOUT = MOD;
})();
