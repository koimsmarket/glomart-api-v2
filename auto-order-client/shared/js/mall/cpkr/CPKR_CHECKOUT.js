(function () {
  'use strict';
  const U = window.GMAO_UTIL;
  const VERSION = '016';

  function docs() {
    const out = [document];
    const seen = new Set(out);
    let changed = true;
    while (changed) {
      changed = false;
      for (const d of out.slice()) {
        for (const f of Array.from(d.querySelectorAll('iframe'))) {
          try {
            const cd = f.contentDocument;
            if (cd && !seen.has(cd)) {
              seen.add(cd);
              out.push(cd);
              changed = true;
            }
          } catch (_) {}
        }
      }
    }
    return out;
  }

  function all(sel) {
    return docs().flatMap(d => Array.from(d.querySelectorAll(sel)));
  }

  function visible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect();
    let st;
    try { st = (el.ownerDocument.defaultView || window).getComputedStyle(el); }
    catch (_) { st = null; }
    return r.width > 0 && r.height > 0 && (!st || (st.display !== 'none' && st.visibility !== 'hidden' && st.opacity !== '0'));
  }

  function txt(el) { return U.norm(el && el.textContent || ''); }
  function firstVisible(sel) { return all(sel).find(visible) || null; }
  function buttonByText(texts) {
    const pats = Array.isArray(texts) ? texts : [texts];
    for (const el of all('button,a,[role="button"],span')) {
      if (!visible(el) || !pats.some(t => txt(el).includes(t))) continue;
      const btn = el.closest && el.closest('button,a,[role="button"]');
      if (btn && visible(btn)) return btn;
      if (visible(el)) return el;
    }
    return null;
  }

  const DOM = {
    addressChangeButton() {
      return buttonByText('배송지 변경');
    },
    addressForm() {
      const forms = all('form._addressBookSaveForm,form.addressBookSaveForm');
      // 쿠팡 배송지 modal의 form 자체는 layout box가 0으로 계산될 수 있다.
      // form의 visible()만으로 버리지 말고, 실제 보이는 입력/버튼 자식이 있으면 유효한 폼으로 인정한다.
      for (const form of forms) {
        if (visible(form)) return form;
        const child = form.querySelector(
          '#addressbookRecipient,input[name="recipientName"],a.addressBookZipcodeTrigger,' +
          'button.addressbook__button--save,button._addressBookFormSubmit'
        );
        if (child && visible(child)) return form;
      }
      return forms[0] || null;
    },
    recipientInput() {
      return firstVisible('#addressbookRecipient,input[name="recipientName"]');
    },
    zipcodeTrigger() {
      return firstVisible('a.addressBookZipcodeTrigger,[title="우편번호 찾기"],a[href*="zipcode"]');
    },
    zipcodeSearchInput() {
      return firstVisible('input.zipcode__keyword-input,input[name="searchKey"]');
    },
    zipcodeSearchButton() {
      return firstVisible('button.zipcodeSearchTrigger,button.zipcode__button--search') || buttonByText('검색');
    },
    roadResults() {
      return all('[data-result-item-road],._zipcodeResultSendTrigger,.zipcode__result-item--road')
        .filter(visible);
    },
    detailInput() {
      return firstVisible('#addressbookAddressDetail,input[name="addressDetail"]');
    },
    phoneInput() {
      return firstVisible('#addressBookCellphone,input[name="recipientCellphone"]');
    },
    deliveryPreferenceTrigger() {
      return firstVisible('.addressBookDeliveryPreferencesTrigger,[title="배송 요청사항"]');
    },
    saveButton() {
      return firstVisible('button._addressBookFormSubmit,button.addressbook__button--save');
    },
    defaultCheckbox() {
      const labels = all('label').filter(el => visible(el) && /기본\s*배송지/.test(txt(el)));
      for (const label of labels) {
        const input = label.querySelector('input[type="checkbox"],input[type="radio"]');
        if (input) return { input, label };
      }
      return null;
    },
    payButton() { return buttonByText('결제하기'); }
  };

  function receiverOf(order) { return order.receiver || order.shipping || order.address || {}; }
  function roadAddressOf(r) { return U.norm(r.road_address || r.roadAddress || r.address || ''); }
  function zipcodeOf(r) { return U.digits(r.zipcode || r.zip || r.postcode || ''); }

  function conciseRoadQuery(r) {
    const explicit = U.norm(r.road_query || r.road_keyword || r.road_address_short || '');
    if (explicit) return explicit;
    const road = roadAddressOf(r);
    const m = road.match(/([가-힣A-Za-z0-9·._-]+(?:대로|로|길)\s*\d+(?:-\d+)?)/);
    return m ? m[1] : road;
  }

  function resultData(el) {
    const holder = el.closest && el.closest('[data-result-item-road]') || el;
    const raw = holder && holder.getAttribute && holder.getAttribute('data-result-item-road');
    if (!raw) return {};
    try { return JSON.parse(raw); } catch (_) { return {}; }
  }

  function resultMatches(el, r) {
    const targetRoad = roadAddressOf(r);
    const targetZip = zipcodeOf(r);
    const data = resultData(el);
    const road = U.norm(data.roadAddress || data.road_address || txt(el));
    const zip = U.digits(data.zipcode || txt(el));
    if (targetRoad && (road === targetRoad || targetRoad.includes(road) || road.includes(targetRoad))) return true;
    if (targetZip && zip.includes(targetZip)) return true;
    return false;
  }

  async function openAddressForm() {
    let form = DOM.addressForm();
    if (form) return form;
    const btn = await U.waitFor(() => DOM.addressChangeButton(), { timeout: 10000, label: '배송지 변경' });
    U.click(btn, '배송지 변경');
    return U.waitFor(() => DOM.addressForm(), { timeout: 10000, label: '신규 배송지 form' });
  }

  async function selectRoadAddress(receiver) {
    const trigger = await U.waitFor(() => DOM.zipcodeTrigger(), { timeout: 8000, label: '우편번호 찾기' });
    U.click(trigger, '우편번호 찾기');

    const input = await U.waitFor(() => DOM.zipcodeSearchInput(), { timeout: 10000, label: '우편번호 검색 input' });
    const query = conciseRoadQuery(receiver);
    if (!query) throw new Error('CHECKOUT_ADDRESS_QUERY_EMPTY');
    U.input(input, query, '우편번호 검색어');
    await U.tick();

    const search = DOM.zipcodeSearchButton();
    if (!search) throw new Error('CHECKOUT_ZIPCODE_SEARCH_BUTTON_NOT_FOUND');
    U.click(search, '우편번호 검색');

    const rows = await U.waitFor(() => {
      const list = DOM.roadResults();
      return list.length ? list : null;
    }, { timeout: 12000, label: '우편번호 검색 결과' });

    const picked = rows.find(el => resultMatches(el, receiver));
    if (!picked) {
      throw new Error('CHECKOUT_ADDRESS_EXACT_MATCH_NOT_FOUND: ' + roadAddressOf(receiver) + ' [' + zipcodeOf(receiver) + ']');
    }
    U.click(picked, '도로명주소 선택');

    await U.waitFor(() => DOM.addressForm() && DOM.detailInput(), { timeout: 10000, label: '주소 선택 후 배송지 form 복귀' });
  }

  function ensureDefaultAddressOff() {
    const c = DOM.defaultCheckbox();
    if (c && c.input.checked) {
      U.click(c.label || c.input, '기본 배송지 선택 해제');
    }
    const hidden = all('input[name="defaultAddress"]').find(el => String(el.type).toLowerCase() === 'hidden');
    if (hidden && String(hidden.value).toLowerCase() !== 'false') hidden.value = 'false';
  }

  async function fillAddress(receiver) {
    await openAddressForm();

    const recv = await U.waitFor(() => DOM.recipientInput(), { timeout: 8000, label: '받는 사람' });
    U.input(recv, receiver.name || receiver.receiver_name || '', '수령인');

    await selectRoadAddress(receiver);

    const detail = await U.waitFor(() => DOM.detailInput(), { timeout: 5000, label: '상세주소' });
    U.input(detail, receiver.detail_address || receiver.detailAddress || '', '상세주소');

    const phone = await U.waitFor(() => DOM.phoneInput(), { timeout: 5000, label: '휴대폰 번호' });
    U.input(phone, receiver.phone || receiver.mobile || '', '연락처');

    ensureDefaultAddressOff();
    await U.tick();

    const save = await U.waitFor(() => DOM.saveButton(), { timeout: 5000, label: '배송지 저장' });
    if (U.isDisabled(save)) throw new Error('CHECKOUT_ADDRESS_SAVE_DISABLED');
    U.click(save, '배송지 저장/적용');

    await U.waitFor(() => {
      const form = DOM.addressForm();
      const bodyText = U.norm(document.body && document.body.textContent || '');
      return !form || !/선택해\s*주세요/.test(bodyText);
    }, { timeout: 12000, label: '배송지 적용 완료' });

    return { ok: true, address_persisted: true, default_address: false };
  }

  const MOD = {
    VERSION,
    async fillAndStop(order) {
      if (!/checkout\.coupang\.com/.test(location.hostname)) throw new Error('not checkout page');
      await U.waitFor(() => DOM.payButton() || DOM.addressChangeButton(), { timeout: 12000, label: 'checkout ready' });
      const receiver = receiverOf(order);
      let addressResult = null;
      if (roadAddressOf(receiver)) addressResult = await fillAddress(receiver);

      /*
       * 결제수단/결제버튼 자동 클릭은 아직 하지 않는다.
       * 배송지 저장/적용 후 최종 결제 버튼을 눈으로 확인할 수 있게 표시하고 정지한다.
       */
      const finalBtn = await U.waitFor(() => DOM.payButton(), { timeout: 10000, label: '결제하기 button' });
      finalBtn.style.outline = '4px solid red';
      finalBtn.style.boxShadow = '0 0 0 4px rgba(255,0,0,.25)';
      U.warn('배송지 적용 완료. 결제하기 직전 정지. 결제하기는 자동 클릭하지 않음.');
      return { ok: true, stopped: true, address_result: addressResult };
    },
    DOM
  };

  window.CPKR_CHECKOUT = MOD;
})();
