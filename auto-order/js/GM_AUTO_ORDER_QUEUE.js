(function () {
  'use strict';
  const KEY = 'GMAO_ORDER_PAYLOAD';
  const STATE = 'GMAO_ORDER_STATE';

  const Q = {
    getOrder() {
      const raw = localStorage.getItem(KEY) || sessionStorage.getItem(KEY);
      if (!raw) return null;
      try { return JSON.parse(raw); } catch (e) { console.error('[GMAO] bad payload', e); return null; }
    },
    setOrder(order) { localStorage.setItem(KEY, JSON.stringify(order || {})); },
    clearOrder() { localStorage.removeItem(KEY); sessionStorage.removeItem(KEY); },
    getState() {
      try { return JSON.parse(sessionStorage.getItem(STATE) || '{}'); } catch { return {}; }
    },
    setState(patch) {
      const next = Object.assign({}, Q.getState(), patch || {}, { updated_at: new Date().toISOString() });
      sessionStorage.setItem(STATE, JSON.stringify(next));
      return next;
    },
    resetState() { sessionStorage.removeItem(STATE); },
    demo() {
      return {
        source_mall: 'CPKR',
        order_id: 'TEST_ORDER',
        stop_before_payment: true,
        receiver: {
          name: '', phone: '', zipcode: '', road_address: '', jibun_address: '', detail_address: '', memo: ''
        },
        items: []
      };
    }
  };

  window.GM_AUTO_ORDER_QUEUE = Q;
})();
