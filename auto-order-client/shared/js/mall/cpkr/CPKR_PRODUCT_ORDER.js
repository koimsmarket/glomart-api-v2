/* CPKR_PRODUCT_ORDER_V001
 * Product-page action module. Runner decides SINGLE vs MULTI.
 */
(function(W,D){
  'use strict';
  if(W.CPKR_PRODUCT_ORDER) return;

  function visible(el){
    if(!el||!el.getBoundingClientRect) return false;
    var r=el.getBoundingClientRect(); return r.width>0&&r.height>0;
  }
  function findByText(re){
    var list=Array.prototype.slice.call(D.querySelectorAll('button,a,[role="button"]'));
    return list.find(function(el){return visible(el)&&re.test(String(el.textContent||'').replace(/\s+/g,' ').trim());})||null;
  }
  function buyNowButton(){
    return D.querySelector('button.prod-buy-btn,a.prod-buy-btn,[class*="buy-now"],[data-button-name="buyNow"]') || findByText(/^바로\s*구매$/);
  }
  async function addToCart(){
    if(!W.GMAO_CPKR_CART_MANAGER || typeof W.GMAO_CPKR_CART_MANAGER.addToCart!=='function') throw new Error('CART_MANAGER_NOT_READY');
    return W.GMAO_CPKR_CART_MANAGER.addToCart();
  }
  async function buyNow(){
    var b=buyNowButton(); if(!b) throw new Error('BUY_NOW_NODE_NOT_FOUND');
    if(typeof b.click==='function'){ b.click(); return {ok:true,method:'native-click'}; }
    var href=b.getAttribute&&b.getAttribute('href');
    if(href){ location.href=new URL(href,location.href).href; return {ok:true,method:'href'}; }
    throw new Error('BUY_NOW_EXEC_FAILED');
  }
  W.CPKR_PRODUCT_ORDER={version:'001',addToCart:addToCart,buyNow:buyNow,buyNowButton:buyNowButton};
})(window,document);
