(function () {
  'use strict';
  const U = window.GMAO_UTIL;
  const Q = window.GM_AUTO_ORDER_QUEUE;

  const CPKR = {
    async run(order) {
      U.log('CPKR start', order.order_id || '');
      const items = Array.isArray(order.items) ? order.items.filter(x => (x.source_mall || order.source_mall) === 'CPKR') : [];
      if (!items.length) throw new Error('CPKR items empty');

      Q.setState({ phase: 'cart_clear' });
      await window.CPKR_CART_CLEAR.run(order);

      for (let i = 0; i < items.length; i++) {
        Q.setState({ phase: 'product_add', item_index: i, source_key: items[i].source_key || '' });
        await window.CPKR_PRODUCT.addItem(items[i], order, i);
      }

      Q.setState({ phase: 'cart_order' });
      await window.CPKR_CART.verifyAndOrder(items, order);

      Q.setState({ phase: 'checkout' });
      await window.CPKR_CHECKOUT.fillAndStop(order);

      Q.setState({ phase: 'stopped_before_payment' });
      U.log('CPKR stopped before payment');
    }
  };

  window.GM_AUTO_ORDER_CPKR = CPKR;
})();
