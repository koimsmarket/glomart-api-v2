// ==UserScript==
// @name Glomart Auto Order Unified Runner
// @namespace https://koims.market/auto-order
// @version 0.002
// @match https://www.coupang.com/*
// @match https://cart.coupang.com/*
// @match https://checkout.coupang.com/*
// @run-at document-idle
// @grant none
// ==/UserScript==
(function(){'use strict';const o='https://port-0-glomart-api-v2-mordwrnh222b6c36.sel3.cloudtype.app';window.GMAO_CONFIG={apiBase:o,assetBase:o+'/auto-order-client/shared/js',version:'0.002'};const s=document.createElement('script');s.src=window.GMAO_CONFIG.assetBase+'/loader.js?v=002';document.documentElement.appendChild(s)})();
