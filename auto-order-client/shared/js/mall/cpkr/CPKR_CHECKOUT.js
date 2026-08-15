(function () {
  'use strict';
  const U = window.GMAO_UTIL;
  const VERSION = '021';

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
      // form 클래스명에 의존하지 않는다. 현재 열린 신규 배송지의 수령인 input을 기준으로
      // 실제 소속 form을 역으로 확정한다. 쿠팡이 form class를 바꿔도 이 필드가 유지되면 동작한다.
      const recipient = all('#addressBookRecipient,#addressbookRecipient,input[name="recipientName"]')
        .find(el => el && el.isConnected && String(el.type || '').toLowerCase() !== 'hidden');
      if (recipient) {
        const owner = recipient.closest && recipient.closest('form');
        if (owner) return owner;
      }
      const forms = all('form._addressBookSaveForm,form.addressBookSaveForm,form[action*="addressbook/save"]');
      for (const form of forms) {
        const child = form.querySelector(
          '#addressBookRecipient,#addressbookRecipient,input[name="recipientName"],a.addressBookZipcodeTrigger,' +
          'button.addressbook__button--save,button._addressBookFormSubmit'
        );
        if (child && visible(child)) return form;
      }
      return null;
    },
    recipientInput(form) {
      const el = form && form.querySelector('#addressBookRecipient,#addressbookRecipient,input[name="recipientName"]');
      return el || firstVisible('#addressBookRecipient,#addressbookRecipient,input[name="recipientName"]');
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
      return all('[data-result],[data-result-item-road],._zipcodeResultSendTrigger,.zipcode__result-item--road')
        .filter(el => el && el.isConnected && visible(el));
    },
    detailInput(form) {
      const el = form && form.querySelector('#addressBookAddressDetail,#addressbookAddressDetail,input[name="addressDetail"]');
      return el || firstVisible('#addressBookAddressDetail,#addressbookAddressDetail,input[name="addressDetail"]');
    },
    phoneInput(form) {
      const el = form && form.querySelector('#addressBookCellphone,input[name="recipientCellphone"]');
      return el || firstVisible('#addressBookCellphone,input[name="recipientCellphone"]');
    },
    deliveryPreferenceTrigger() {
      return firstVisible('.addressBookDeliveryPreferencesTrigger,[title="배송 요청사항"]');
    },
    saveButton(form) {
      const el = form && form.querySelector('button._addressBookFormSubmit,button.addressbook__button--save');
      return el || firstVisible('button._addressBookFormSubmit,button.addressbook__button--save');
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

  function setNativeValue(el, value, label) {
    if (!el) throw new Error('CHECKOUT_INPUT_NOT_FOUND: ' + label);
    const v = String(value == null ? '' : value);
    const win = el.ownerDocument && el.ownerDocument.defaultView;
    const proto = win && win.HTMLInputElement && win.HTMLInputElement.prototype;
    const desc = proto && Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && typeof desc.set === 'function') desc.set.call(el, v);
    else el.value = v;
    const EventCtor = win && win.Event ? win.Event : Event;
    el.dispatchEvent(new EventCtor('input', { bubbles: true }));
    el.dispatchEvent(new EventCtor('change', { bubbles: true }));
    try { el.focus(); el.blur(); } catch (_) {}
    if (U.norm(el.value) !== U.norm(v)) {
      throw new Error('CHECKOUT_INPUT_VALUE_NOT_APPLIED: ' + label);
    }
    return el.value;
  }

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
    const holder = (el.closest && el.closest('[data-result],[data-result-item-road]')) || el;
    const raw = holder && holder.getAttribute && (holder.getAttribute('data-result') || holder.getAttribute('data-result-item-road'));
    if (!raw) return {};
    try { return JSON.parse(raw); } catch (_) { return {}; }
  }

  function normalizeRoadForMatch(v) {
    return U.norm(v).replace(/^경기도\s+/, '경기 ').replace(/\s+/g, ' ').trim();
  }

  function resultMatches(el, r) {
    const targetRoad = normalizeRoadForMatch(roadAddressOf(r));
    const targetZip = zipcodeOf(r);
    const query = normalizeRoadForMatch(conciseRoadQuery(r));
    const data = resultData(el);
    const road = normalizeRoadForMatch(data.roadAddress || data.road_address || txt(el));
    const zip = U.digits(data.zipcode || txt(el));

    // 쿠팡 검색결과는 아파트명/동호수 같은 상세주소를 포함하지 않는다.
    // 우편번호 + 검색한 도로명/건물번호를 기본주소 매칭 기준으로 사용한다.
    if (targetZip && zip && targetZip === zip && query && road.includes(query)) return true;
    if (query && road.includes(query)) return true;
    if (targetZip && zip && targetZip === zip && targetRoad && targetRoad.includes(road)) return true;
    return false;
  }


  function gmAddressDiagSnapshot(receiver, detailValue, detailInput, saveButton) {
    try {
      const r = receiver || {};
      return {
        raddr1: r.raddr1 ?? null,
        raddr2: r.raddr2 ?? null,
        address1: r.address1 ?? null,
        address2: r.address2 ?? null,
        receiver_address2: r.receiver_address2 ?? null,
        receiverAddress2: r.receiverAddress2 ?? null,
        detailAddressOf: detailValue ?? '',
        detailInputFound: !!detailInput,
        detailInputValue: detailInput ? String(detailInput.value || '') : null,
        saveDisabled:
          !!saveButton &&
          (
            saveButton.disabled === true ||
            saveButton.getAttribute('aria-disabled') === 'true' ||
            saveButton.classList.contains('addressbook__button--disabled')
          )
      };
    } catch (e) {
      return { diag_error: String(e && e.message || e) };
    }
  }

  function gmPublishAddressDiag(diag) {
    try { window.__GM_ADDRESS_DEBUG__ = diag; } catch (_) {}
    try {
      window.postMessage(
        { type: 'GM_AUTO_ORDER_ADDRESS_DEBUG', payload: diag },
        '*'
      );
    } catch (_) {}
    try { console.log('[GM_AUTO_ORDER_ADDRESS_DEBUG]', diag); } catch (_) {}
  }

  function detailAddressOf(r, selectedRoad) {
    const explicit = U.norm(
      r.raddr2 ||
      r.address2 ||
      r.receiver_address2 ||
      r.receiverAddress2 ||
      r.detail_address ||
      r.detailAddress ||
      r.address_detail ||
      r.addressDetail ||
      ''
    );
    if (explicit) return explicit;
    const full = U.norm(r.road_address || r.roadAddress || r.address || '');
    const base = U.norm(selectedRoad || '');
    if (!full || !base) return '';
    const variants = [base, base.replace(/^경기도\s+/, '경기 '), base.replace(/^경기\s+/, '경기도 ')];
    for (const v of variants) {
      if (v && full.startsWith(v)) return U.norm(full.slice(v.length));
    }
    const q = U.norm(conciseRoadQuery(r));
    const idx = q ? full.indexOf(q) : -1;
    if (idx >= 0) return U.norm(full.slice(idx + q.length));
    return '';
  }

  async function openAddressForm() {
    let form = DOM.addressForm();
    if (form) return form;
    const btn = await U.waitFor(() => DOM.addressChangeButton(), { timeout: 10000, label: '배송지 변경' });
    U.click(btn, '배송지 변경');
    // 쿠팡 신규 배송지의 수령인 input은 화면에 보이더라도 rect/offset 계산이 0으로 잡히는 경우가 있다.
    // 따라서 visible()로 거르지 않고, 실제 DOM에 연결된 non-hidden input 존재 자체를 기준으로 한다.
    const recipient = await U.waitFor(() => {
      return all('#addressBookRecipient,#addressbookRecipient,input[name="recipientName"]')
        .find(el => el && el.isConnected && String(el.type || '').toLowerCase() !== 'hidden') || null;
    }, { timeout: 10000, label: '신규 배송지 수령인 input' });
    return (recipient.closest && recipient.closest('form')) || DOM.addressForm();
  }

  async function selectRoadAddress(receiver, progress) {
    progress && progress('우편번호 찾기 열기');
    const trigger = await U.waitFor(() => DOM.zipcodeTrigger(), { timeout: 8000, label: '우편번호 찾기' });
    U.click(trigger, '우편번호 찾기');

    progress && progress('우편번호 검색창 확인');
    const input = await U.waitFor(() => DOM.zipcodeSearchInput(), { timeout: 10000, label: '우편번호 검색 input' });
    const query = conciseRoadQuery(receiver);
    if (!query) throw new Error('CHECKOUT_ADDRESS_QUERY_EMPTY');
    U.input(input, query, '우편번호 검색어');
    await U.tick();

    const search = DOM.zipcodeSearchButton();
    if (!search) throw new Error('CHECKOUT_ZIPCODE_SEARCH_BUTTON_NOT_FOUND');
    progress && progress('우편번호 검색: ' + query);
    U.click(search, '우편번호 검색');

    const rows = await U.waitFor(() => {
      const list = DOM.roadResults();
      return list.length ? list : null;
    }, { timeout: 12000, label: '우편번호 검색 결과' });

    const picked = rows.find(el => resultMatches(el, receiver));
    if (!picked) {
      throw new Error('CHECKOUT_ADDRESS_BASE_MATCH_NOT_FOUND: ' + conciseRoadQuery(receiver) + ' [' + zipcodeOf(receiver) + ']');
    }
    const selected = resultData(picked);
    const selectedRoad = U.norm(selected.roadAddress || selected.road_address || txt(picked));
    progress && progress('도로명주소 선택: ' + selectedRoad);
    U.click(picked, '도로명주소 선택');

    await U.waitFor(() => {
      const form = DOM.addressForm();
      return form && DOM.detailInput(form) ? form : null;
    }, { timeout: 10000, label: '주소 선택 후 배송지 form 복귀' });
    return { selectedRoad, zipcode: U.digits(selected.zipcode || '') };
  }

  function ensureDefaultAddressOff() {
    const c = DOM.defaultCheckbox();
    if (c && c.input.checked) {
      U.click(c.label || c.input, '기본 배송지 선택 해제');
    }
    const hidden = all('input[name="defaultAddress"]').find(el => String(el.type).toLowerCase() === 'hidden');
    if (hidden && String(hidden.value).toLowerCase() !== 'false') hidden.value = 'false';
  }


  async function waitAddressFormStable(progress) {
    let lastForm = null;
    let lastDetail = null;
    let lastPhone = null;
    let stableSince = 0;

    const stableForm = await U.waitFor(() => {
      const form = DOM.addressForm();
      if (!form || !form.isConnected) {
        lastForm = lastDetail = lastPhone = null;
        stableSince = 0;
        return null;
      }

      const detail = DOM.detailInput(form);
      const phone = DOM.phoneInput(form);
      if (!detail || !phone || !detail.isConnected || !phone.isConnected) {
        lastForm = lastDetail = lastPhone = null;
        stableSince = 0;
        return null;
      }

      const now = Date.now();
      if (form !== lastForm || detail !== lastDetail || phone !== lastPhone) {
        lastForm = form;
        lastDetail = detail;
        lastPhone = phone;
        stableSince = now;
        return null;
      }

      if (!stableSince) stableSince = now;
      return (now - stableSince >= 900) ? form : null;
    }, { timeout: 12000, label: '주소 선택 후 배송지 form 안정화' });

    progress && progress('배송지 form 안정화 완료');
    return stableForm;
  }

  function commitTextWithKeyup(el, value, label) {
    if (!el) throw new Error('CHECKOUT_INPUT_NOT_FOUND: ' + label);
    const v = String(value == null ? '' : value);
    const win = el.ownerDocument && el.ownerDocument.defaultView;
    const proto = win && win.HTMLInputElement && win.HTMLInputElement.prototype;
    const desc = proto && Object.getOwnPropertyDescriptor(proto, 'value');

    try { el.focus(); } catch (_) {}

    if (desc && typeof desc.set === 'function') desc.set.call(el, v);
    else el.value = v;

    const EventCtor = win && win.Event ? win.Event : Event;
    try {
      const InputEventCtor = win && win.InputEvent ? win.InputEvent : InputEvent;
      el.dispatchEvent(new InputEventCtor('input', {
        bubbles: true,
        inputType: 'insertText',
        data: v
      }));
    } catch (_) {
      el.dispatchEvent(new EventCtor('input', { bubbles: true }));
    }

    try {
      const KeyboardEventCtor = win && win.KeyboardEvent ? win.KeyboardEvent : KeyboardEvent;
      el.dispatchEvent(new KeyboardEventCtor('keyup', {
        bubbles: true,
        key: v.slice(-1) || ' ',
        code: ''
      }));
    } catch (_) {}

    el.dispatchEvent(new EventCtor('change', { bubbles: true }));
    try { el.blur(); } catch (_) {}
  }

  async function fillAddress(receiver, progress) {
    progress && progress('신규 배송지 폼 확인');
    let form = await openAddressForm();

    progress && progress('수령인 입력');
    const recv = await U.waitFor(() => DOM.recipientInput(form), { timeout: 8000, label: '받는 사람' });
    setNativeValue(recv, receiver.name || receiver.receiver_name || '', '수령인');
    progress && progress('수령인 입력 확인: ' + U.norm(recv.value));

    const selectedAddress = await selectRoadAddress(receiver, progress);

    progress && progress('주소 선택 후 폼 복귀/안정화 대기');
    form = await waitAddressFormStable(progress);

    // 주소검색 결과를 선택하면 쿠팡이 배송지 form을 한 번 다시 그릴 수 있다.
    // 따라서 안정화가 끝난 뒤 수령인/상세주소/전화번호를 최종 입력한다.
    progress && progress('수령인 최종 입력');
    const recvFinal = await U.waitFor(() => DOM.recipientInput(form), { timeout: 5000, label: '받는 사람 최종 input' });
    setNativeValue(recvFinal, receiver.name || receiver.receiver_name || '', '수령인');

    progress && progress('상세주소 입력');
    let detail = await U.waitFor(() => DOM.detailInput(form), { timeout: 5000, label: '상세주소' });
    const detailValue = detailAddressOf(receiver, selectedAddress && selectedAddress.selectedRoad);

    commitTextWithKeyup(detail, detailValue, '상세주소');
    await U.sleep(500);

    // 반드시 현재 DOM을 다시 조회한다. 재렌더링 전 노드의 value는 성공 판정에 사용하지 않는다.
    form = DOM.addressForm() || form;
    detail = DOM.detailInput(form);
    progress && progress('상세주소 입력 확인: ' + U.norm(detail && detail.value));

    if (!detail || U.norm(detail.value) !== U.norm(detailValue)) {
      // 주소 form이 한 번 더 교체된 경우 1회만 안정화 후 재입력한다.
      progress && progress('상세주소 재렌더링 감지 - 1회 재입력');
      form = await waitAddressFormStable(progress);
      detail = await U.waitFor(() => DOM.detailInput(form), { timeout: 5000, label: '상세주소 재입력' });
      commitTextWithKeyup(detail, detailValue, '상세주소');
      await U.sleep(500);
      form = DOM.addressForm() || form;
      detail = DOM.detailInput(form);
    }

    progress && progress('휴대폰 번호 입력');
    let phone = await U.waitFor(() => DOM.phoneInput(form), { timeout: 5000, label: '휴대폰 번호' });
    const phoneValue = receiver.phone || receiver.mobile || receiver.receiver_mobile || '';
    setNativeValue(phone, phoneValue, '연락처');
    await U.sleep(400);

    form = DOM.addressForm() || form;
    detail = DOM.detailInput(form);
    phone = DOM.phoneInput(form);

    try {
      const __gmSaveAfter =
        document.querySelector('button.addressbook__button--save') ||
        document.querySelector('.addressbook__button--save');
      const __gmDiag = gmAddressDiagSnapshot(
        receiver || {},
        detailValue,
        detail,
        __gmSaveAfter
      );
      __gmDiag.phoneInputFound = !!phone;
      __gmDiag.phoneInputValue = phone ? String(phone.value || '') : null;
      gmPublishAddressDiag(__gmDiag);
    } catch (_) {}

    if (!detail || U.norm(detail.value) !== U.norm(detailValue)) {
      throw new Error('CHECKOUT_ADDRESS_DETAIL_NOT_COMMITTED');
    }
    if (!phone || U.digits(phone.value) !== U.digits(phoneValue)) {
      throw new Error('CHECKOUT_ADDRESS_PHONE_NOT_COMMITTED');
    }

    progress && progress('기본배송지 미선택 확인');
    ensureDefaultAddressOff();
    await U.tick();

    progress && progress('배송지 저장/적용');
    const save = await U.waitFor(() => DOM.saveButton(form), { timeout: 5000, label: '배송지 저장' });
    if (U.isDisabled(save)) throw new Error('CHECKOUT_ADDRESS_SAVE_DISABLED');
    // 쿠팡 배송지 저장 버튼은 합성 U.click()보다 native DOM click()에 정상 반응한다.
    save.click();

    await U.waitFor(() => {
      const activeForm = DOM.addressForm();
      const bodyText = U.norm(document.body && document.body.textContent || '');
      return !activeForm || !/선택해\s*주세요/.test(bodyText);
    }, { timeout: 12000, label: '배송지 적용 완료' });

    progress && progress('배송지 적용 완료');
    return { ok: true, address_persisted: true, default_address: false };
  }

  const MOD = {
    VERSION,
    async fillAddressOnly(receiver, progress) {
      if (!/id\.coupang\.com/.test(location.hostname)) throw new Error('not address iframe');
      return fillAddress(receiver || {}, progress);
    },
    async fillAndStop(order, options) {
      const progress = options && typeof options.onProgress === 'function' ? options.onProgress : null;
      if (!/checkout\.coupang\.com/.test(location.hostname)) throw new Error('not checkout page');
      await U.waitFor(() => DOM.payButton() || DOM.addressChangeButton(), { timeout: 12000, label: 'checkout ready' });
      const receiver = receiverOf(order);
      let addressResult = null;
      if (roadAddressOf(receiver)) {
        if (options && typeof options.waitForAddressBridge === 'function') {
          progress && progress('배송지 변경 열기');
          const change = await U.waitFor(() => DOM.addressChangeButton(), { timeout: 10000, label: '배송지 변경' });
          U.click(change, '배송지 변경');
          progress && progress('id.coupang.com 배송지 iframe 처리 대기');
          addressResult = await options.waitForAddressBridge();
          progress && progress('배송지 iframe 처리 완료');
        } else {
          addressResult = await fillAddress(receiver, progress);
        }
      }

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
