(function(){
  'use strict';

  function text(node){
    return String(node && node.textContent || '').replace(/\s+/g,' ').trim();
  }

  function visible(node){
    if(!node) return false;
    const style=getComputedStyle(node);
    const rect=node.getBoundingClientRect();
    return style.display!=='none' &&
      style.visibility!=='hidden' &&
      Number(style.opacity||1)!==0 &&
      rect.width>0 &&
      rect.height>0;
  }

  function disabled(node){
    return Boolean(
      node &&
      (
        node.disabled ||
        node.getAttribute('aria-disabled')==='true' ||
        /disabled|soldout|out-of-stock/i.test(String(node.className||''))
      )
    );
  }

  function findCartButton(){
    const selectors=[
      'button.prod-cart-btn',
      'button[class*="prod-cart"]',
      'button[class*="cart"]',
      '[data-item-id] button',
      '.prod-buy-footer button',
      '.prod-buy-header button'
    ];

    for(const selector of selectors){
      for(const node of document.querySelectorAll(selector)){
        if(!visible(node)||disabled(node)) continue;
        const haystack=[
          text(node),
          node.getAttribute('aria-label')||'',
          node.getAttribute('title')||'',
          String(node.className||'')
        ].join(' ');

        if(/장바구니|담기|cart/i.test(haystack)) return node;
      }
    }

    for(const node of document.querySelectorAll('button')){
      if(!visible(node)||disabled(node)) continue;
      if(/장바구니\s*담기|장바구니|담기/.test(text(node))) return node;
    }

    return null;
  }

  function productIdFromUrl(value){
    const match=String(value||'').match(/\/vp\/products\/(\d+)/);
    return match?match[1]:'';
  }

  function cartItemCandidates(){
    const selectors=[
      '.cart-unit-item',
      '[class*="cart-item"]',
      '[class*="cartUnit"]',
      '[data-item-id]',
      'li[class*="cart"]'
    ];
    const result=[];
    const seen=new Set();

    for(const selector of selectors){
      for(const node of document.querySelectorAll(selector)){
        if(!visible(node)||seen.has(node)) continue;
        seen.add(node);
        result.push(node);
      }
    }

    return result;
  }

  function inspectCart(expected){
    expected=expected||{};
    const expectedId=productIdFromUrl(
      expected.product_url ||
      expected.mall_product_url ||
      expected.external_product_url ||
      ''
    );
    const expectedName=String(
      expected.product_name ||
      expected.name ||
      expected.item_name ||
      ''
    ).trim();

    const candidates=cartItemCandidates();
    const matches=candidates.filter(node=>{
      const nodeText=text(node);
      const links=[...node.querySelectorAll('a[href]')].map(a=>a.href);
      const idMatched=!expectedId ||
        links.some(link=>productIdFromUrl(link)===expectedId);
      const nameMatched=!expectedName ||
        nodeText.includes(expectedName) ||
        expectedName.includes(nodeText.slice(0,80));

      return idMatched && nameMatched;
    });

    return {
      ok:matches.length>0,
      expected_product_id:expectedId,
      expected_name:expectedName,
      cart_item_count:candidates.length,
      matched_count:matches.length,
      matched_samples:matches.slice(0,3).map(node=>text(node).slice(0,220)),
      checked_at:new Date().toISOString()
    };
  }

  async function waitFor(predicate,timeoutMs,intervalMs){
    const started=Date.now();
    let value=null;

    while(Date.now()-started<timeoutMs){
      value=predicate();
      if(value) return value;
      await new Promise(resolve=>setTimeout(resolve,intervalMs));
    }

    return value;
  }

  function headerCartCount(){
    const node=document.querySelector('#headerCartCount');
    if(!node) return null;
    const raw=String(node.textContent||'').replace(/[^0-9]/g,'');
    if(!raw) return 0;
    const n=Number(raw);
    return Number.isFinite(n)?n:null;
  }

  function coupangCartError(){
    const bodyText=text(document.body);
    if(/서버에서\s*오류가\s*발생하였습니다/.test(bodyText)){
      return 'COUPANG_SERVER_ERROR';
    }
    if(/일시적으로\s*오류가\s*발생했습니다/.test(bodyText)){
      return 'COUPANG_TEMPORARY_ERROR';
    }
    return '';
  }

  async function waitForStableCartButton(timeoutMs){
    const started=Date.now();
    let last=null;
    let stableSince=0;

    while(Date.now()-started<timeoutMs){
      const button=findCartButton();
      if(button && !disabled(button)){
        if(button===last){
          if(!stableSince) stableSince=Date.now();
          if(Date.now()-stableSince>=700) return button;
        }else{
          last=button;
          stableSince=Date.now();
        }
      }
      await new Promise(resolve=>setTimeout(resolve,120));
    }
    return last && !disabled(last) ? last : null;
  }

  async function addToCart(){
    if(!/\/vp\/products\//.test(location.pathname)){
      throw new Error('쿠팡 상품 상세 페이지가 아닙니다.');
    }

    /*
     * Do not click as soon as the button merely appears. Coupang's product
     * DOM can be visible before its cart action state is fully attached.
     * Require the same enabled cart button to stay stable briefly.
     */
    let button=await waitForStableCartButton(4000);
    if(!button) throw new Error('장바구니 버튼을 찾지 못했습니다.');
    if(disabled(button)) throw new Error('장바구니 버튼이 비활성화되어 있습니다.');

    const beforeUrl=location.href;
    const beforeText=text(button);
    const beforeCount=headerCartCount();

    // Re-resolve once immediately before the one permitted click.
    button=findCartButton() || button;
    if(disabled(button)) throw new Error('장바구니 버튼이 클릭 직전에 비활성화되었습니다.');

    button.click();

    const result=await waitFor(()=>{
      const error=coupangCartError();
      if(error) return {type:'error',code:error};

      const afterCount=headerCartCount();
      if(
        beforeCount!==null &&
        afterCount!==null &&
        afterCount>beforeCount
      ){
        return {
          type:'success',
          method:'header-cart-count',
          before_count:beforeCount,
          after_count:afterCount
        };
      }

      const bodyText=text(document.body);
      if(/장바구니에\s*담겼|장바구니에\s*추가/.test(bodyText)){
        return {type:'success',method:'message'};
      }

      if(location.hostname==='cart.coupang.com' || /\/cart/.test(location.pathname)){
        return {type:'success',method:'cart-navigation'};
      }

      return null;
    },5500,150);

    if(result && result.type==='error'){
      throw new Error('CART_ADD_' + result.code);
    }

    if(!result || result.type!=='success'){
      throw new Error(
        'CART_ADD_NOT_CONFIRMED' +
        ':before=' + String(beforeCount) +
        ':after=' + String(headerCartCount())
      );
    }

    return {
      ok:true,
      method:result.method,
      button_text:beforeText,
      before_count:beforeCount,
      after_count:result.after_count==null?headerCartCount():result.after_count,
      before_url:beforeUrl,
      after_url:location.href,
      clicked_at:new Date().toISOString()
    };
  }

  function openCart(){
    location.href='https://cart.coupang.com/cartView.pang';
  }

  window.GMAO_CPKR_CART_MANAGER={
    version:'057',
    addToCart,
    inspectCart,
    openCart,
    findCartButton,
    productIdFromUrl
  };
})();
