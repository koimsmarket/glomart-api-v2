(function () {
  'use strict';
  const U = window.GMAO_UTIL;
  const Q = window.GM_AUTO_ORDER_QUEUE;

  const CORE = {
    boot() {
      U.log('core boot V' + U.VERSION, location.href);
      window.GMAO_START = () => CORE.start();
      window.GMAO_SET_ORDER = (order) => { Q.setOrder(order); U.log('payload saved'); };
      window.GMAO_CLEAR = () => { Q.clearOrder(); Q.resetState(); U.log('payload/state cleared'); };
      window.GMAO_STATE = () => Q.getState();
      window.GMAO_ORDER = () => Q.getOrder();
      window.GMAO_NEXT_BLANK = () => window.GM_AUTO_ORDER_CPKR && window.GM_AUTO_ORDER_CPKR.finishAndBlank();

      const order = Q.getOrder();
      if (!order) {
        U.log('no payload. use window.GMAO_SET_ORDER(payload), then window.GMAO_START()');
        return;
      }
      if (order.auto_start === true) CORE.start().catch(e => U.err(e));
    },
    async start() {
      const order = Q.getOrder();
      if (!order) throw new Error('no GMAO_ORDER_PAYLOAD');
      if (order.source_mall !== 'CPKR') throw new Error('unsupported source_mall: ' + order.source_mall);
      if (!window.GM_AUTO_ORDER_CPKR) throw new Error('CPKR controller missing');
      Q.setState({ phase: 'start', order_id: order.order_id || '', started_at: new Date().toISOString() });
      try {
        return await window.GM_AUTO_ORDER_CPKR.run(order);
      } catch (e) {
        Q.setState({ phase: 'error', error: String(e && e.message || e) });
        U.err('process failed', e);
        throw e;
      }
    }
  };

  window.GM_AUTO_ORDER_CORE = CORE;
})();
