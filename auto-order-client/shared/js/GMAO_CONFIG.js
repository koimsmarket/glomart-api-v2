(function(){
  'use strict';
  const defaults={
    apiBase:'https://port-0-glomart-api-v2-mordwrnh222b6c36.sel3.cloudtype.app',
    assetBase:'https://port-0-glomart-api-v2-mordwrnh222b6c36.sel3.cloudtype.app/auto-order-client/shared/js',
    pollMs:5000,
    heartbeatMs:15000,
    mallCode:'CPKR',
    stopBeforePayment:true
  };
  window.GMAO_CONFIG=Object.assign({},defaults,window.GMAO_CONFIG||{});
})();
