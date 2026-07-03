(function () {
  'use strict';
  const U = window.GMAO_UTIL;
  const Q = window.GM_AUTO_ORDER_QUEUE;

  const CORE = {
    boot() {
      U.log('core boot', location.href);
      window.GMAO_START = () => CORE.start();
      window.GMAO_SET_ORDER = (order) => { Q.setOrder(order); U.log('payload saved'); };
      window.GMAO_CLEAR = () => { Q.clearOrder(); Q.resetState(); U.log('payload/state cleared'); };
      const order = Q.getOrder();
      if (!order) {
        U.log('no payload. use window.GMAO_SET_ORDER(payload), then window.GMAO_START()');
        return;
      }
      if (order.auto_start === true) CORE.start();
    },
    async start() {
      const order = Q.getOrder();
      if (!order) throw new Error('no GMAO_ORDER_PAYLOAD');
      if (order.source_mall !== 'CPKR') throw new Error('unsupported source_mall: ' + order.source_mall);
      if (!window.GM_AUTO_ORDER_CPKR) throw new Error('CPKR controller missing');
      Q.setState({ phase: 'start', order_id: order.order_id || '' });
      await window.GM_AUTO_ORDER_CPKR.run(order);
    }
  };

  window.GM_AUTO_ORDER_CORE = CORE;
})();
