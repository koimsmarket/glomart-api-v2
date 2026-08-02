(function(){
  'use strict';
  const base=(window.GMAO_CONFIG&&window.GMAO_CONFIG.assetBase)||'https://port-0-glomart-api-v2-mordwrnh222b6c36.sel3.cloudtype.app/auto-order-client/shared/js';
  const files=['GMAO_CONFIG.js','platform/GMAO_PLATFORM.js','GM_AUTO_ORDER_UTIL.js','GM_AUTO_ORDER_QUEUE.js','GM_AUTO_ORDER_CORE.js','GMAO_API.js','GMAO_RUNTIME.js','cpkr/GM_AUTO_ORDER_CPKR.js','cpkr/CPKR_CART_CLEAR.js','cpkr/CPKR_PRODUCT.js','cpkr/CPKR_CART.js','cpkr/CPKR_CHECKOUT.js'];
  (async()=>{for(const f of files){await new Promise((ok,fail)=>{const s=document.createElement('script');s.src=base+'/'+f+'?v=001';s.onload=ok;s.onerror=fail;document.documentElement.appendChild(s);});} window.GM_AUTO_ORDER_CORE.boot(); window.GMAO_RUNTIME.start();})().catch(e=>console.error('[GMAO loader]',e));
})();
