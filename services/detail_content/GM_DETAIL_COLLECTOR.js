/* GM_DETAIL_COLLECTOR.js
 * BUILD: GM_DETAIL_COLLECTOR_FAST_PRODUCTID_JSON
 * 역할: 쿠팡 상세 2번탭에서 현재 productId 기준으로 기본정보 + 이미지 + 배송/공급사 + 옵션 UID를 1회 파싱한다.
 * 핵심 원칙:
 *  1) 검증 모드에서는 상세 수집 완료 후에도 2번탭을 about:blank로 비우지 않는다.
 *  2) 옵션 타입별 클릭 순회를 기본으로 하지 않는다.
 *  3) 현재 productId와 같은 itemId/vendorItemId 후보를 페이지에 이미 내려온 HTML/Next hydration에서 빠르게 추출한다.
 *  4) DOM은 옵션값/표시가격/이미지/배송 보정 기준이고, JSON은 UID/가격 보강 사전이다.
 *  5) API 재호출/fetch 금지. 이미 로드된 페이지 안의 데이터만 읽는다.
 */
(function(){
'use strict';
var BUILD_ID='GM_DETAIL_COLLECTOR_V055_TEMP_SOLDOUT_3D';
if(window.__GM_DETAIL_COLLECTOR_BUILD__===BUILD_ID) return;
window.__GM_DETAIL_COLLECTOR_BUILD__=BUILD_ID;
var W=window;

var DETAIL_QUERY_KEY='GM_LAST_GLOMART_DETAIL_QUERY';
var DETAIL_RESULT_KEY='GM_LAST_DETAIL_RESULT';

function gmDetailTrace(step,obj){try{obj=obj||{}; obj.time=Date.now(); obj.url=location.href; console.log('[GM_TRACE_DETAIL_'+step+']',obj); if(window.AndroidGM&&window.AndroidGM.log)window.AndroidGM.log('[GM_TRACE_DETAIL_'+step+'] '+JSON.stringify(obj));}catch(_e){}}
function C(v){var s=String(v==null?'':v).replace(/&quot;/g,'"').replace(/&amp;/g,'&').replace(/[\u00A0\u200B-\u200D\uFEFF]/g,' ').replace(/\s+/g,' ').trim();return /^(null|undefined|nan)$/i.test(s)?'':s;}
function N(v){return Number(String(v||'').replace(/[^\d]/g,''))||0;}
function GMID(v){v=C(v);return /^\d{5,}$/.test(v)?v:'';}
function Q(s,p){try{return (p||document).querySelector(s);}catch(e){return null;}}
function QA(s,p){try{return Array.prototype.slice.call((p||document).querySelectorAll(s));}catch(e){return [];}}
function T(el){return C(el&&((el.innerText||el.textContent)||''));}
function sleep(ms){return new Promise(function(resolve){setTimeout(resolve,ms);});}
function isCoupang(){return /(^|\.)coupang\.com$/i.test(location.hostname||'');}
function log(msg){msg='[DETAIL_COLLECTOR] '+C(msg);try{console.log(msg);}catch(e){}try{if(window.AndroidGM&&window.AndroidGM.log) window.AndroidGM.log(msg);}catch(e){}}
function formatWon(v){var n=N(v);return n>0?n.toLocaleString('ko-KR')+'원':'';}
function marginPrice(v){var n=N(v);if(!n)return 0;var rate=n<2000?1.35:(n<5000?1.30:(n<10000?1.25:1.20));return Math.round((n*rate)/10)*10;}
function marginPriceText(v){var n=marginPrice(v);return n?formatWon(n):'';}
function gmMarginPolicyVersion(){return 'GM_MARGIN_POLICY_20260628_COLLECTOR_V1';}
function gmMarginRate(v){var n=N(v);return n<2000?1.35:(n<5000?1.30:(n<10000?1.25:1.20));}
function gmCoupangMallDiscountRaw(row){
  row=row||{};
  var keys=[
    'wow_price','wowPrice','wow_member_price','wowMemberPrice','wow_discount_price','wowDiscountPrice','wowPriceText','wow_member_price_text','wowMemberPriceText',
    'card_discount_price','cardDiscountPrice','card_price','cardPrice','card_member_price','cardMemberPrice','cardDiscountPriceText','card_price_text','cardPriceText'
  ];
  var vals=[];
  keys.forEach(function(k){var n=N(row[k]);if(n>0)vals.push(n);});
  var groups=[row.wowPrices,row.cardPrices,row.cardDiscountPrices,row.discountPrices];
  groups.forEach(function(g){
    if(Array.isArray(g))g.forEach(function(v){var n=N(v&&typeof v==='object'?(v.price||v.amount||v.value||v.priceText):v);if(n>0)vals.push(n);});
  });
  return vals.length?Math.min.apply(Math,vals):0;
}
function gmCoupangDiscountFieldsFromObject(obj){
  var out={wowPrices:[],cardPrices:[]},seen=[];
  function add(kind,v){var n=N(v&&typeof v==='object'?(v.amount||v.price||v.value||v.priceText||v.text):v);if(n>0)out[kind].push(n);}
  function walk(o,path,depth){
    if(!o||depth>7)return;
    if(typeof o!=='object')return;
    for(var si=0;si<seen.length;si++){if(seen[si]===o)return;}seen.push(o);
    Object.keys(o).forEach(function(k){
      var v=o[k], p=(path?path+'.':'')+k, low=p.toLowerCase();
      if(/wow|와우/.test(low) && /price|amount|discount|member/.test(low))add('wowPrices',v);
      if(/card|카드/.test(low) && /price|amount|discount/.test(low))add('cardPrices',v);
      if(v&&typeof v==='object'&&!/url|image|html/.test(low))walk(v,p,depth+1);
    });
  }
  walk(obj,'',0);
  return out;
}
function gmApplyCoupangMallDiscount(row,mallSalePrice){
  row=row||{};
  var raw=gmCoupangMallDiscountRaw(row);
  var sale=raw>0?marginPrice(raw):0;
  if(sale>0 && (!mallSalePrice || sale<mallSalePrice)){
    row.mall_discount_price=sale;
    row.mallDiscountPrice=sale;
    row.mall_discount_price_text=formatWon(sale);
    row.mallDiscountPriceText=formatWon(sale);
    row.mall_discount_raw_price=raw;
    row.mallDiscountRawPrice=raw;
    row.mall_discount_source='CPKR_MIN_WOW_CARD';
  }else{
    row.mall_discount_price=null;
    row.mallDiscountPrice=null;
  }
  return row;
}

function applyCoupangSalePrice(row,collectedPrice,source){
  row=row||{};
  var raw=C(collectedPrice||row.rawCoupangOptionPrice||row.rawOptionPrice||row.coupangPrice||row.salePrice||row.basePrice||row.optionPriceText||row.priceText||row.price||'');
  if(!raw) return row;
  var sale=marginPriceText(raw);
  var saleNum=marginPrice(raw);
  if(!sale) return row;
  /* 쿠팡 가격 정책:
   * - collector가 수집한 쿠팡 실제 가격은 rawCoupangOptionPrice/rawOptionPrice/coupangPrice/salePrice에 보존한다.
   * - 사용자에게 보이는 가격 필드(priceText/price/optionPriceText/optionPrice)는 반드시 Glomart 판매가로 승격한다.
   * - 공식: 0~1999 x1.35, 2000~4999 x1.30, 5000~9999 x1.25, 10000 이상 x1.20, 10원 단위 반올림.
   */
  row.raw_price=N(raw);
  row.raw_price_text=raw;
  row.rawPrice=N(raw);
  row.rawPriceText=raw;
  row.sell_price=saleNum;
  row.sell_price_text=sale;
  row.mall_sale_price=saleNum;
  row.mallSalePrice=saleNum;
  row.mall_sale_price_text=sale;
  row.mallSalePriceText=sale;
  row.sellPrice=saleNum;
  row.sellPriceText=sale;
  row.margin_rate=gmMarginRate(raw);
  row.marginPolicyVersion=gmMarginPolicyVersion();
  row.margin_policy_version=gmMarginPolicyVersion();
  row.rawOptionPrice=row.rawOptionPrice||raw;
  row.rawCoupangOptionPrice=row.rawCoupangOptionPrice||raw;
  row.coupangPrice=row.coupangPrice||raw;
  row.salePrice=row.salePrice||raw;
  row.baseCollectedPrice=row.baseCollectedPrice||raw;
  row.priceText=sale;
  row.price=sale;
  row.optionPriceText=sale;
  row.optionPrice=sale;
  row.displayPrice=sale;
  row.displayPriceText=sale;
  row.finalPrice=sale;
  row.finalPriceText=sale;
  row.finalDisplayPriceText=sale;
  row.calculatedPrice=saleNum;
  row.calculatedPriceText=sale;
  row.priceSource=source||row.priceSource||'margin-from-collected-price';
  row.optionPriceMissing=false;
  gmApplyCoupangMallDiscount(row,saleNum);
  return row;
}

function forceCoupangCollectedPrice(row,collectedPrice,source){
  row=row||{};
  var raw=C(collectedPrice||'');
  if(!raw) return row;
  /* V027: 모든옵션보기 popup DOM에서 보이는 실제 옵션가를 최우선 가격으로 확정한다.
   * 기존 attr/addToCartUrl 가격은 일부 상품에서 다른 계산값이 섞일 수 있으므로,
   * popup 가격이 있으면 raw/판매가 필드를 강제로 덮어쓴다. */
  row.rawOptionPrice=raw;
  row.rawCoupangOptionPrice=raw;
  row.coupangPrice=raw;
  row.salePrice=raw;
  row.baseCollectedPrice=raw;
  row.raw_price=N(raw);
  row.raw_price_text=raw;
  row.rawPrice=N(raw);
  row.rawPriceText=raw;
  row.priceSource=source||'popupDom.optionPrice';
  row.optionPriceSource=source||'popupDom.optionPrice';
  return applyCoupangSalePrice(row,raw,source||'popupDom.optionPrice');
}

function urlParam(k){try{return new URL(location.href).searchParams.get(k)||'';}catch(e){return '';}}
function pageProductId(){try{return GMID((location.pathname.match(/\/products\/(\d{5,})/)||[])[1]||urlParam('gm_productId')||urlParam('productId')||'');}catch(e){return '';}}
function pageIds(){var pid=pageProductId();var iid=GMID(urlParam('itemId')||urlParam('gm_itemId')||'');var vid=GMID(urlParam('vendorItemId')||urlParam('gm_vendorItemId')||urlParam('venderItemId')||'');return {productId:pid,itemId:iid,vendorItemId:vid,venderItemId:vid,key:[pid,iid,vid].filter(Boolean).join('_')};}
function readJob(){var u=pageIds(), job=null, raw='';try{raw=GM_getValue(DETAIL_QUERY_KEY,'')||'';}catch(e){}if(raw){try{job=JSON.parse(raw);}catch(e){job=null;}}job=job||{};if(!job.productId&&u.productId)job.productId=u.productId;if(!job.itemId&&u.itemId)job.itemId=u.itemId;if(!job.vendorItemId&&u.vendorItemId)job.vendorItemId=u.vendorItemId;if(!job.key)job.key=[job.productId,job.itemId,job.vendorItemId].filter(Boolean).join('_');return job.productId?job:null;}
function isExpectedPage(job){if(!job||!job.productId)return false;if(!/\/v[mp]\/products\/\d+|\/products\/\d+/i.test(location.pathname||''))return false;var pid=pageProductId();return !pid||C(pid)===C(job.productId);}
function statusUpdate(stage,text,extra){var payload={scope:'detail',stage:C(stage),text:C(text),at:Date.now()};if(extra){Object.keys(extra).forEach(function(k){payload[k]=extra[k];});}try{GM_setValue('GM_STATUS_LAST',JSON.stringify(payload));}catch(e){}try{GM_setValue('GM_DETAIL_STATUS_LAST',JSON.stringify(payload));}catch(e){}try{window.dispatchEvent(new CustomEvent('GM_STATUS_UPDATE',{detail:payload}));}catch(e){}log('DETAIL_STATUS stage='+payload.stage+' text='+payload.text);}
function visible(el){try{if(!el)return false;if(el.closest&&el.closest('#gmCafe24OptionMount'))return false;return true;}catch(e){return true;}}
function priceFromText(t){t=C(t);var m=t.match(/([1-9]\d{0,2}(?:,\d{3})+|[1-9]\d{3,8})\s*원/);return m?formatWon(m[1]):'';}
function cleanText(v){return C(v).replace(/옵션\s*선택/g,' ').replace(/선택됨|selected\s*:\s*(true|false)/ig,' ').replace(/품절임박|일시품절|품절|다른\s*구성\s*보기|쿠폰할인|할인종료임박/g,' ').replace(/(?:[1-9]\d{0,2}(?:,\d{3})+|[1-9]\d{3,8})\s*원/g,' ').replace(/\(?\s*(?:100g|10g|1개|kg|g|ml|mL|L)\s*당\s*[\d,]+\s*원\s*\)?/ig,' ').replace(/무료배송|판매자배송|로켓배송|로켓프레시/g,' ').replace(/오늘|내일|모레|[월화수목금토일]요일|도착|예정/g,' ').replace(/할인/g,' ').replace(/\s+/g,' ').trim();}
function badOptionValue(v){v=C(v);if(!v)return true;if(v.length>180)return true;if(/^[-+0-9,원%\s]+$/.test(v))return true;if(/^(선택|선택하세요|옵션|옵션선택|상품선택|장바구니|구매하기|바로구매|더보기|닫기)$/i.test(v))return true;if(/[{}\[\]"']|schema|beacons|redirect|viewType|linkedVendor|Android|WEB_PRODUCT|shipping|pcsRedirect|delayedPdd|chunk|polyfill|stylesheet/i.test(v))return true;if(/없는\s*색상|없는\s*사이즈|선택할\s*수\s*없|구매\s*불가/i.test(v))return true;if(/배송비|무료배송|도착|쿠폰|할인|적립|카드|혜택|리뷰|문의|공유|찜하기/i.test(v))return true;return false;}
function unescapeLoose(v){var x=String(v==null?'':v);for(var i=0;i<5;i++){x=x.replace(/\\u([0-9a-fA-F]{4})/g,function(_,h){try{return String.fromCharCode(parseInt(h,16));}catch(e){return _;}}).replace(/\\\//g,'/').replace(/\\"/g,'"').replace(/\\'/g,"'").replace(/&quot;/g,'"').replace(/&amp;/g,'&');}return C(x);}
function exactKeyRe(key){return new RegExp('(?:"|\\\\")'+key+'(?:"|\\\\")\\s*:\\s*(?:"|\\\\")?([^,"}\\\\]{1,160})','i');}
function exactStringKeyRe(key){return new RegExp('(?:"|\\\\")'+key+'(?:"|\\\\")\\s*:\\s*(?:"|\\\\")((?:\\\\.|[^"\\\\]){1,240})(?:"|\\\\")','i');}
function firstKeyNumber(chunk,keys){for(var i=0;i<keys.length;i++){var re=exactKeyRe(keys[i]);var m=chunk.match(re);if(m){var id=GMID(m[1]);if(id)return id;}}return '';}
function firstKeyString(chunk,keys){for(var i=0;i<keys.length;i++){var re=exactStringKeyRe(keys[i]);var m=chunk.match(re);if(m){var s=unescapeLoose(m[1]);if(s)return s;}}return '';}
function firstPriceInChunk(chunk){var keys=['finalPrice','salePrice','discountPrice','coupangSalePrice','salePriceValue','priceValue','price'];for(var i=0;i<keys.length;i++){var re=new RegExp('(?:"|\\\\")'+keys[i]+'(?:"|\\\\")\\s*:\\s*(?:"|\\\\")?([0-9,]{3,})','i');var m=chunk.match(re);if(m)return formatWon(m[1]);}return '';}

/* 현재 화면에 보이는 실제 판매가 우선: JSON price는 정가일 수 있음. */
function basePriceText(){var sels=[
  '[class*="twc-text-red"]','[class*="twc-text-rose"]','.total-price strong','.prod-price .total-price','.prod-sale-price .total-price','.price-amount.sales-price-amount','.sales-price .price-amount','[class*="sale-price"]','[class*="price"]'
];for(var i=0;i<sels.length;i++){var nodes=QA(sels[i]);for(var j=0;j<nodes.length;j++){var tx=T(nodes[j]);if(/쿠폰|적립|캐시|배송비|원산지|100g당|10g당|1개당|장바구니|구매/i.test(tx))continue;var p=priceFromText(tx);if(p)return p;}}return priceFromText(T(document.body));}
function unitPriceText(){
  try{
    var sels=['.prod-sale-price','.prod-price','.price-amount','.price-info','.total-price','.prod-coupon-price','[class*="price"]'];
    var re=/((?:100|10|1)\s*(?:g|kg|ml|mL|L|개)\s*당\s*[\d,]+\s*원)/i;
    for(var i=0;i<sels.length;i++){
      var nodes=QA(sels[i]);
      for(var j=0;j<nodes.length;j++){
        var tx=T(nodes[j]); var m=tx.match(re); if(m)return C(m[1]).replace(/\s+/g,'');
      }
    }
    var body=C(document.body&&document.body.innerText||''); var bm=body.match(re); if(bm)return C(bm[1]).replace(/\s+/g,'');
  }catch(e){}
  return '';
}
function titleText(){var og=Q('meta[property="og:title"]');return C((Q('h1')&&T(Q('h1'))) || (og&&og.getAttribute('content')) || document.title || '');}
function categoryInfo(){
  function pushNode(arr, seen, id, name, href, source){
    id=GMID(id||''); name=C(name||''); href=C(href||'');
    if(!name || /로그인|회원가입|고객센터|장바구니|검색/i.test(name)) return;
    var sig=(id||'')+'|'+name;
    if(seen[sig]) return; seen[sig]=1;
    arr.push({depth:arr.length,id:id,cp_code:id,cpCode:id,code:id,name:name,name_ko:name,href:href,source:source||'dom'});
  }
  function decodeHtmlLoose(v){return C(v).replace(/\\u003c/ig,'<').replace(/\\u003e/ig,'>').replace(/\\u0026/ig,'&').replace(/\\u002F/ig,'/').replace(/\\"/g,'"').replace(/&quot;/g,'"').replace(/&amp;/g,'&').replace(/\u003c/ig,'<').replace(/\u003e/ig,'>').replace(/\u0026/ig,'&').replace(/\u002F/ig,'/');}
  var arr=[]; var seen={};
  var nodes=QA('ul.breadcrumb li a, .breadcrumb a, nav[aria-label*="breadcrumb" i] a');
  if(!nodes.length){
    nodes=QA('[class*="breadcrumb" i] a[href*="/np/categories/"], [class*="breadcrumb" i] a');
  }
  nodes.forEach(function(a){
    var name=C((a.getAttribute&&a.getAttribute('title'))||T(a));
    var href=C((a.getAttribute&&a.getAttribute('href'))||'');
    var m=href.match(/\/np\/categories\/(\d+)/i);
    pushNode(arr, seen, m&&m[1]||'', name, href, 'dom_breadcrumb');
  });
  // V039: script 전체의 /np/categories/ 링크는 breadcrumb가 아니라 형제/추천 카테고리까지 섞인다.
  // DOM breadcrumb가 전혀 없을 때만 최후 보조로 script anchor를 사용한다.
  if(!arr.length){
    try{
      var allScripts=QA('script').map(function(sc){return decodeHtmlLoose(sc.textContent||'');}).join('\n');
      var re=/<a[^>]+href=["']([^"']*\/np\/categories\/(\d+)[^"']*)["'][^>]*>([\s\S]{0,120}?)<\/a>/ig;
      var m;
      while((m=re.exec(allScripts))){
        var nm=decodeHtmlLoose(m[3]).replace(/<[^>]+>/g,' ');
        pushNode(arr, seen, m[2], nm, m[1], 'script_anchor_fallback');
        if(arr.length>=5) break;
      }
    }catch(e){}
  }
  // 번호가 없는 path 텍스트라도 leaf 이름 보강용으로 확보한다.
  if(!arr.length){
    var body=T(document.body).replace(/\s+/g,' ');
    var cm=body.match(/쿠팡\s*홈\s*>?\s*([^\n]{5,350}?)(?:상품명|원산지|상품평|가격|$)/);
    if(cm){
      C('쿠팡 홈 > '+cm[1]).split(/\s*>\s*/).forEach(function(n){ pushNode(arr, seen, '', n, '', 'body_text'); });
    }
  }
  // 쿠팡 홈 같은 루트/중복 노드는 서버에서 필요성이 낮으므로 leaf 계산 전 정리한다.
  arr=arr.filter(function(x){return x.name && !/^쿠팡\s*홈$/i.test(x.name);});
  // V039: 현재 breadcrumb는 보통 3~5단계다. 6단계 이상은 script/형제 링크 누적 가능성이 높으므로
  // DOM breadcrumb가 아닌 fallback 결과라면 5단계까지만 방어적으로 제한한다.
  if(arr.length>5 && arr.every(function(x){return /script_anchor_fallback/.test(x.source||'');})){ arr=arr.slice(0,5); }
  arr=arr.map(function(x,i){x.depth=i;return x;});
  var path=arr.map(function(x){return x.name;}).join(' > ');
  var leaf=arr.length?arr[arr.length-1]:null;
  var leafId=leaf?leaf.id:'';
  var leafName=leaf?leaf.name:'';
  var out={
    cp_fix_code:leafId,
    cpFixCode:leafId,
    cp_code:leafId,
    cpCode:leafId,
    cp_category_no:leafId,
    cpCategoryNo:leafId,
    cp_match:leafId?'T':'',
    cpMatch:leafId?'T':'',
    mall_category:leafId,
    mallCategory:leafId,
    mall_category_path:path,
    mallCategoryPath:path,
    cp_category_path:path,
    cpCategoryPath:path,
    mall_category_leaf:leafName,
    mallCategoryLeaf:leafName,
    mall_category_id:leafId,
    mallCategoryId:leafId,
    mall_category_json:arr,
    mallCategoryJson:arr,
    cp_category_tree_json:arr,
    cpCategoryTreeJson:arr,
    categoryInfo:{leaf:leafId,leafCategoryId:leafId,cp_code:leafId,cpFixCode:leafId,leafName:leafName,pathText:path,path:arr}
  };
  if(path) log('CATEGORY_INFO leaf='+leafId+' path='+path);
  if(arr.length) log('CATEGORY_TREE count='+arr.length+' '+arr.map(function(x){return x.depth+':'+(x.id||'')+':'+x.name;}).join(' | '));
  return out;
}
function normalizeBadge(v){
  v=C(v);
  if(!v)return '';
  /* ROCKET_MERCHANT 안에 ROCKET 문자열이 포함되므로 판매자배송을 반드시 먼저 판정한다. */
  if(/ROCKET_MERCHANT|merchant|seller|판매자배송|판매자/i.test(v))return '판매자배송';
  if(/ROCKET_FRESH|rocket[_-]?fresh|fresh|로켓프레시/i.test(v))return '로켓프레시';
  if(/ROCKET|rocket|로켓배송/i.test(v))return '로켓배송';
  return v;
}
function badgeFromRoot(root){
  if(!root)return '';
  var img=Q('[data-testid="wp-ui-biz-badge"] img,[data-testid="wp-ui-biz-badge-item"] img,img[alt*="로켓"],img[src*="rocket"],img[src*="fresh"]',root);
  return normalizeBadge((img&&(img.getAttribute('alt')||(img.closest&&img.closest('[data-badge-id]')&&img.closest('[data-badge-id]').getAttribute('data-badge-id'))||img.src))||'');
}
function feeFromShippingText(tx){
  tx=C(tx);
  var m=tx.match(/(?:배송비|배송\s*비|운반비|운송비)\s*([1-9]\d{0,2}(?:,\d{3})+|[1-9]\d{3,8})\s*원/);
  if(m)return formatWon(m[1]);
  m=tx.match(/([1-9]\d{0,2}(?:,\d{3})+|[1-9]\d{3,8})\s*원\s*(?:배송비|운반비|운송비)/);
  if(m)return formatWon(m[1]);
  if(/무료배송/.test(tx))return '무료배송';
  return '';
}
function gmConditionalFreeText(tx){
  tx=C(tx);
  var m=tx.match(/같은\s*판매자\s*상품\s*([1-9]\d{0,2}(?:,\d{3})+|[1-9]\d{3,8})\s*원\s*이상\s*구매\s*시\s*무료배송/);
  if(!m)m=tx.match(/([1-9]\d{0,2}(?:,\d{3})+|[1-9]\d{3,8})\s*원\s*이상\s*구매\s*시\s*무료배송/);
  if(!m)return '';
  var gm=marginPrice(m[1]);
  if(!gm)return C(m[0]||'');
  return '같은 판매자 상품 '+formatWon(gm)+' 이상 구매 시 무료배송';
}
function deliveryInfo(){
  var feeRoot=Q('.price-shipping-fee-info-container');
  var condRoot=Q('.price-shipping-fee-conditional-msg');
  var delRoot=Q('.delivery-container')||Q('.regular-delivery-container');
  var root=feeRoot||delRoot||Q('.prod-atf-contents')||document.body;
  var tx=C([T(feeRoot),T(condRoot),T(delRoot),T(root)].filter(Boolean).join(' ')).slice(0,4000);
  var badge=badgeFromRoot(root)||badgeFromRoot(delRoot)||badgeFromRoot(feeRoot);
  var type='seller',label='판매자배송';
  if(badge==='로켓프레시'||/로켓\s*프레시|로켓프레시|신선/i.test(tx)){type='fresh';label='로켓프레시';}
  else if(badge==='로켓배송'||/로켓배송|로켓\s*그로스|쿠팡\s*배송|WOW|묶음배송/i.test(tx)){type='bundle';label='로켓배송';}
  var fee=feeRoot?feeFromShippingText(T(feeRoot)):'';
  if(!fee)fee=feeFromShippingText(tx);
  var conditional=gmConditionalFreeText(T(condRoot)||tx);
  if(N(fee)>0){ /* 배송비 금액 우선 */ }
  else if(!fee && /무료배송/.test(T(delRoot)||tx)) fee='무료배송';
  var dm=tx.match(/([0-9]{1,2}\/[0-9]{1,2}|오늘|내일|모레|[월화수목금토일]요일)[^\n]{0,50}도착[^\n]{0,30}/);
  return {
    deliveryType:label,shipType:type,shippingLabel:label,shippingBadge:badge||label,baseShippingBadge:badge||label,
    deliveryText:C(dm&&dm[0]||label),shippingFeeText:fee,baseShippingFeeText:fee,deliveryFeeText:fee,
    conditionalFreeText:conditional,conditional_free_text:conditional,freeShippingConditionText:conditional,baseFreeShippingConditionText:conditional
  };
}
function collectOptionRowShippingRows(){
  var rows=QA('.option-table-list__option').map(function(el,i){
    var name=T(Q('.option-table-list__option-name',el));
    var price=T(Q('.option-table-list__option-price span',el));
    var badge=badgeFromRoot(el);
    var fee=feeFromShippingText(T(el));
    var shipType=shipTypeFromBadge(badge||T(el));
    /* 쿠팡 옵션행에서 로켓/프레시 표시가 없는 행은 판매자배송이다.
       빈 badge를 그대로 두면 이후 route/base 배송값(bundle/fresh)이 상속되어
       20개처럼 판매자배송 옵션이 묶음배송으로 바뀐다. */
    if(!shipType && (name||price||fee)){shipType='seller';badge='판매자배송';}
    return {i:i,name:name,price:price,badge:badge,fee:fee,shipType:shipType};
  }).filter(function(r){return r.name||r.price||r.badge||r.fee;});
  if(rows.length)log('OPTION_SHIP_ROWS count='+rows.length+' sample='+rows.slice(0,4).map(function(r){return r.name+'|'+r.price+'|'+r.badge+'|'+r.fee+'|'+r.shipType;}).join(' / '));
  return rows;
}
function shipTypeFromBadge(v){
  v=C(v);
  if(!v)return '';
  /* ROCKET_MERCHANT/merchant는 ROCKET보다 먼저 처리해야 한다. */
  if(/ROCKET_MERCHANT|SELLER|판매자|seller|merchant/i.test(v))return 'seller';
  if(/ROCKET_FRESH|rocket[_-]?fresh|로켓\s*프레시|로켓프레시|fresh/i.test(v))return 'fresh';
  if(/ROCKET|rocket|로켓배송|로켓\s*그로스|쿠팡\s*배송|WOW|bundle|묶음/i.test(v))return 'bundle';
  return '';
}
function shipLabelFromType(type){
  type=C(type);
  if(type==='fresh')return '로켓프레시';
  if(type==='bundle')return '로켓배송';
  if(type==='seller')return '판매자배송';
  return '';
}
function routeShipType(){
  var v=C(urlParam('gm_ship_type')||urlParam('ship_type')||urlParam('shipping_type')||'');
  if(/^fresh$/i.test(v))return 'fresh';
  if(/^(bundle|rocket)$/i.test(v))return 'bundle';
  if(/^seller$/i.test(v))return 'seller';
  return shipTypeFromBadge(v);
}
function optionShipSummary(rows){
  var c={fresh:0,bundle:0,seller:0,known:0};
  (rows||[]).forEach(function(r){
    var t=shipTypeFromBadge((r&&r.shipType)||'')||shipTypeFromBadge((r&&r.badge)||'');
    if(t&&c.hasOwnProperty(t)){c[t]++;c.known++;}
  });
  c.type=c.fresh?'fresh':(c.bundle?'bundle':(c.seller?'seller':''));
  c.label=shipLabelFromType(c.type);
  return c;
}
function applyOptionShipInheritance(rows,shipRows){
  rows=Array.isArray(rows)?rows:[];
  shipRows=Array.isArray(shipRows)?shipRows:[];
  var routeType=routeShipType();
  var sum=optionShipSummary(shipRows);
  /* 옵션 배송행이 하나라도 있으면 옵션행 판정이 최우선이다.
     URL/base의 gm_ship_type=bundle/fresh를 빈 옵션에 일괄 상속하지 않는다.
     판매자배송(무표시) 행이 bundle로 덮이는 문제 방지. */
  var type=(!shipRows.length && (routeType==='fresh'||routeType==='bundle'))?routeType:sum.type;
  if(type!=='fresh'&&type!=='bundle')return rows;
  /* 혼합 옵션(예: 1개 seller, 5개 bundle, 20개 seller)은 일괄 상속 금지. */
  if(shipRows.length && sum.known && ((sum.fresh?1:0)+(sum.bundle?1:0)+(sum.seller?1:0)>1)){
    log('OPTION_SHIP_INHERIT_SKIP mixed counts='+JSON.stringify(sum)+' rows='+rows.length);
    return rows;
  }
  var label=shipLabelFromType(type);
  var applied=0, existing=0;
  rows.forEach(function(row){
    if(!row)return;
    var rowType=shipTypeFromBadge(row.optionShipType||row.shipType||row.optionShippingBadge||row.shippingBadge||'');
    if(row.optionShippingBadge||rowType){existing++;}
    if(!row.optionShippingBadge){row.optionShippingBadge=label;applied++;}
    if(!row.shippingBadge)row.shippingBadge=label;
    if(!row.deliveryBadge)row.deliveryBadge=label;
    if(!row.optionShipType)row.optionShipType=type;
    if(!row.shipType)row.shipType=type;
    if(!row.deliveryType)row.deliveryType=label;
  });
  if(applied||existing)log('OPTION_SHIP_INHERIT_APPLY type='+type+' label='+label+' route='+(routeType||'')+' counts='+JSON.stringify(sum)+' rows='+rows.length+' existing='+existing+' applied='+applied);
  return rows;
}

/* 
 * CLEAN IMAGE CORE
 *
 * 삭제된 legacy:
 *  - 과거 이미지 삭제/합치기/중복제거 함수 일체
 *  - 광범위 HTML fallback 수집기
 *
 * 삭제 이유:
 * 과거에는 상세/추천/마크/중복 이미지가 한꺼번에 들어와서 삭제/합치기 필터가 필요했다.
 * 현재는 PROCESS-A/B가 상세 컨테이너의 정확한 노드만 집기 때문에 legacy 삭제/합치기 필터가 오히려
 * vendor_inventory, image11, 롱이미지 같은 정상 상세 이미지를 버리는 원인이 된다.
 *
 * 원칙:
 *  - 쿠팡 DOM 이미지 노드의 src/srcset/data-* 속성은 절대 수정하지 않는다.
 *  - 읽기만 한다.
 *  - 렌더링 상태(w/h/naturalWidth)에 의존해 URL을 버리지 않는다.
 *  - detail 이미지는 PROCESS-A/B에서만 확정한다.
 */
function gmImageSrc(v){
  v=C(v).replace(/\\u002F/g,'/').replace(/\\\//g,'/').replace(/&amp;/g,'&').trim();
  if(!v)return '';
  if(v.indexOf('//')===0)v='https:'+v;
  if(v.indexOf('/')===0&&!/^\/\//.test(v))v=location.protocol+'//'+location.host+v;
  if(/^http:\/\/image/i.test(v))v=v.replace(/^http:/i,'https:');
  if(!/^https?:\/\//i.test(v))return '';
  if(!/coupangcdn/i.test(v))return '';
  return v;
}
function gmImagePickSrc(el){
  if(!el)return '';
  /*
   * lazy 원본 후보를 먼저 본다.
   * currentSrc/src는 WebView에서 placeholder/깨진값일 수 있으므로 후순위.
   */
  var attrs=['data-origin','data-original','data-src','data-lazy-src','data-url','data-img-src','data-full-src','srcset','data-srcset','src','currentSrc'];
  for(var i=0;i<attrs.length;i++){
    var a=attrs[i], x='';
    try{
      if(a==='currentSrc')x=el.currentSrc||'';
      else x=el.getAttribute&&el.getAttribute(a)||'';
    }catch(_a){x='';}
    if(!x)continue;
    if(/srcset/i.test(a))x=String(x).split(',').map(function(t){return C(t).split(/\s+/)[0];}).filter(Boolean)[0]||'';
    x=gmImageSrc(x); if(x)return x;
  }
  return '';
}
/*
 * 2026-06 CLEAN IMAGE POLICY
 * - 과거 이미지 합치기/중복제거/삭제/선별 필터는 폐기한다.
 * - 지금은 콘솔테스트로 확인한 정확한 노드만 읽는다.
 * - 쿠팡 DOM(img/src/srcset/data-src/loading 등)은 절대 수정하지 않는다.
 * - 썸네일: 상단 swiper 노드에서 보이는 순서대로 최대 7장만 읽는다.
 * - 상세: PROCESS-A/B가 정한 detailBlocks만 읽는다.
 */
function collectTopSwiperImagesOnce(label){
  /* V176 TOP_THUMB_TEST direct selector - one attempt
   * - PC/모바일 콘솔에서 확인된 직접 img selector 방식만 사용한다.
   * - roots/raw/unique 방식 사용 금지.
   */
  var out=[];

  function clean(u){
    return C(u).replace(/\\u002F/g,'/').replace(/\\\//g,'/');
  }

  function add(u){
    u=clean(u);
    if(!u)return;
    if(u.indexOf('//')===0)u='https:'+u;
    if(!/^https?:\/\//i.test(u))return;
    if(!/coupangcdn/i.test(u))return;
    if(out.indexOf(u)>=0)return;
    out.push(u);
  }

  try{
    QA(
      '.swiper-slide img,'+
      '[class*="swiper-slide"] img,'+
      '[class*="prod-image"] img,'+
      '[class*="product-image"] img,'+
      '[class*="main-image"] img'
    ).forEach(function(img){
      add(img&&img.currentSrc);
      add(img&&img.src);
      try{add(img&&img.getAttribute&&img.getAttribute('src'));}catch(_s){}
      try{add(img&&img.getAttribute&&img.getAttribute('data-src'));}catch(_d){}
      try{add(img&&img.getAttribute&&img.getAttribute('data-original'));}catch(_o){}
    });
  }catch(e){
    log('TOP_THUMB_TEST_FAIL '+(label||'')+' '+(e&&e.message||e));
  }

  log('TOP_THUMB_TEST '+(label||'single')+' count='+out.length);
  try{
    out.slice(0,8).forEach(function(u,i){log('TOP_THUMB_TEST_SAMPLE['+i+'] '+String(u).slice(0,140));});
  }catch(_e){}
  return out;
}

function collectTopSwiperImages(){
  /* V176: timed pre-collection이 있으면 그 best 결과만 사용한다. */
  try{
    if(W.__GM_TOP_THUMB_BEST && W.__GM_TOP_THUMB_BEST.length){
      var cached=W.__GM_TOP_THUMB_BEST.slice(0);
      log('TOP_THUMB_USE_BEST count='+cached.length);
      log('THUMB_TOP_ACTUAL count='+cached.length);
      return cached;
    }
  }catch(_c){}
  var out=collectTopSwiperImagesOnce('single');
  log('THUMB_TOP_ACTUAL count='+out.length);
  return out;
}

async function collectTopSwiperImagesTimed(){
  /* V050: 대표 썸네일 1장만 보이는 초기 상태는 완료로 확정하지 않는다.
   * - count=1은 대표 이미지 선렌더로 간주하고 최대 3.0초까지 후속 갤러리를 기다린다.
   * - count>=2가 처음 확인되면 다음 attempt 1회까지 확인하고 best를 채택한다.
   * - count>=10이면 쿠팡 상단 최대치에 도달한 것으로 보고 즉시 종료한다.
   * - 끝까지 1장뿐인 실제 단일이미지 상품은 최대 대기 후 그 1장을 사용한다.
   * - MutationObserver/상시 타이머는 사용하지 않는다.
   */
  var offsets=[0,300,700,1200,1800,2400,3000];
  var prev=0,best=[],firstMultiAt=-1,stopReason='max';
  for(var i=0;i<offsets.length;i++){
    var wait=offsets[i]-prev;
    if(wait>0)await sleep(wait);
    prev=offsets[i];
    var cur=[];
    try{cur=collectTopSwiperImagesOnce('early-attempt='+(i+1)+' delay='+offsets[i]);}catch(e){log('TOP_THUMB_EARLY_FAIL attempt='+(i+1)+' '+(e&&e.message||e));cur=[];}
    if(cur.length>best.length)best=cur.slice(0);

    if(cur.length===1){
      log('TOP_THUMB_EARLY_ONE_WAIT attempt='+(i+1)+' delay='+offsets[i]+' reason=representative-only');
      continue;
    }

    if(cur.length>=10){
      stopReason='max10-'+offsets[i];
      log('TOP_THUMB_EARLY_MAX10_DONE attempt='+(i+1)+' count='+cur.length);
      break;
    }

    if(firstMultiAt<0 && cur.length>=2){
      firstMultiAt=i;
      log('TOP_THUMB_EARLY_MULTI_FIRST attempt='+(i+1)+' count='+cur.length+' next_confirm='+(i+2));
      if(i===offsets.length-1){
        stopReason='multi-first-last-'+offsets[i];
        break;
      }
      continue;
    }

    if(firstMultiAt>=0 && i===firstMultiAt+1){
      stopReason='multi-confirmed-'+offsets[i];
      log('TOP_THUMB_EARLY_CONFIRM_DONE first_attempt='+(firstMultiAt+1)+' confirm_attempt='+(i+1)+' confirm_count='+cur.length+' best='+best.length);
      break;
    }
  }
  try{W.__GM_TOP_THUMB_BEST=best.slice(0);}catch(_s){}
  log('TOP_THUMB_EARLY_BEST count='+best.length+' reason='+stopReason);
  try{best.slice(0,8).forEach(function(u,i){log('TOP_THUMB_EARLY_BEST_SAMPLE['+i+'] '+String(u).slice(0,140));});}catch(_e){}
  return best;
}

/*
 * V172 LEGACY THUMBNAIL COLLECTOR - DISABLED ONLY
 * - 삭제하지 않고 보관한다.
 * - 호출 금지: active collectTopSwiperImages()는 위의 TOP_THUMB_TEST 직접 selector 방식만 사용한다.
 * - 필요 시 비교용으로만 남긴다.
 */
function collectTopSwiperImages_LEGACY_DISABLED(){
  var out=[];
  var diag={slides:0,imgNodes:0,sourceNodes:0,withUrl:0,withoutUrl:0,samples:[]};

  function shortChain(el){
    var a=[];
    try{
      var cur=el;
      for(var i=0;cur&&i<4;i++,cur=cur.parentElement){
        var tag=C(cur.tagName||'');
        var cls=C(cur.className||'').slice(0,50);
        a.push(tag+(cls?'.'+cls:''));
      }
    }catch(_){}
    return a.join(' < ');
  }

  function readAttr(el,a){
    try{
      if(a==='currentSrc')return C(el.currentSrc||'');
      return C(el.getAttribute&&el.getAttribute(a)||'');
    }catch(_){return '';}
  }

  function addSample(el,u){
    if(diag.samples.length>=8)return;
    var r={};
    try{
      var b=el&&el.getBoundingClientRect&&el.getBoundingClientRect();
      r.w=Math.round((b&&b.width)||0);
      r.h=Math.round((b&&b.height)||0);
    }catch(_r){r.w=0;r.h=0;}
    diag.samples.push({
      tag:C(el&&el.tagName||''),
      ok:!!u,
      w:r.w,
      h:r.h,
      nw:Number((el&&(el.naturalWidth||0))||0)||0,
      nh:Number((el&&(el.naturalHeight||0))||0)||0,
      src:readAttr(el,'src').slice(0,90),
      currentSrc:readAttr(el,'currentSrc').slice(0,90),
      dataSrc:readAttr(el,'data-src').slice(0,90),
      lazy:readAttr(el,'data-lazy-src').slice(0,90),
      srcset:readAttr(el,'srcset').slice(0,90),
      dataSrcset:readAttr(el,'data-srcset').slice(0,90),
      chain:shortChain(el).slice(0,180)
    });
  }

  function pushFromEl(el){
    var u='';
    try{u=gmImagePickSrc(el);}catch(_e){u='';}
    if(u){diag.withUrl++; out.push(u);}
    else diag.withoutUrl++;
    addSample(el,u);
  }

  try{
    diag.slides=QA('.swiper-slide,[class*="swiper-slide"]').length;
    diag.imgNodes=QA('.swiper-slide img,[class*="swiper-slide"] img').length;
    diag.sourceNodes=QA('.swiper-slide source,[class*="swiper-slide"] source').length;
  }catch(_d){}

  try{
    QA('.swiper-slide img,[class*="swiper-slide"] img').forEach(function(el){
      if(out.length>=7)return;
      pushFromEl(el);
    });
  }catch(e){log('THUMB_TOP_ACTUAL_DOM_FAIL '+(e&&e.message||e));}

  /*
   * V169 TOP_THUMB_TEST 정확 반영
   * - 콘솔에서 5장/6장 확인된 selector를 항상 실행해서 기존 out에 합친다.
   * - 기존 대표 1장이 먼저 잡혀도 보강 경로가 막히면 안 된다.
   * - 전체 img/source 스캔, CDN 광역 fallback, displayitem/brandLogo/icon 혼입 경로는 사용하지 않는다.
   * - out 배열/기존 payload 키는 그대로 유지한다.
   */
  try{
    QA('.swiper-slide img,[class*="swiper-slide"] img,[class*="prod-image"] img,[class*="product-image"] img,[class*="main-image"] img').forEach(function(img){
      if(out.length>=7)return;
      var vals=[];
      try{
        vals=[
          (img&&img.currentSrc)||'',
          (img&&img.src)||'',
          (img&&img.getAttribute&&img.getAttribute('src'))||'',
          (img&&img.getAttribute&&img.getAttribute('data-src'))||'',
          (img&&img.getAttribute&&img.getAttribute('data-original'))||''
        ];
      }catch(_t){vals=[];}
      var added=false;
      for(var vi=0;vi<vals.length;vi++){
        if(out.length>=7)break;
        var u=gmImageSrc(vals[vi]||'');
        if(!u)continue;
        if(out.indexOf(u)<0){out.push(u);added=true;}
      }
      if(added)diag.withUrl++; else diag.withoutUrl++;
      addSample(img,added?'TOP_THUMB_TEST_ADDED':'');
    });
  }catch(e2){log('THUMB_TOP_TEST_PATH_FAIL '+(e2&&e2.message||e2));}

  /*
   * V170 APP_WEBVIEW_THUMB_HTML_492
   * - 앱 WebView에서 상단 DOM selector가 대표 1장만 제공하는 케이스가 있다.
   * - PC/모바일 콘솔에서 보인 나머지 썸네일 URL은 HTML/script 문자열의 492x492 후보에 존재한다.
   * - DOM 결과가 3장 미만일 때만, 썸네일 전용 492x492 경로만 제한적으로 보강한다.
   * - 전체 img/source 스캔, displayitem/brandLogo/icon 경로는 사용하지 않는다.
   */
  if(out.length<3){
    try{
      var beforeHtml=out.length;
      var html=C(document.documentElement&&document.documentElement.innerHTML||'')
        .replace(/\\u002F/g,'/')
        .replace(/\\\//g,'/')
        .replace(/&amp;/g,'&');
      var re=/(?:https?:)?\/\/thumbnail\.coupangcdn\.com\/thumbnails\/remote\/492x492(?:ex)?\/(?:image\/vendor_inventory|retail\/images)\/[^"'\s\\<>()]+?\.(?:jpg|jpeg|png|webp)(?:\?[^"'\s\\<>()]*)?/gi;
      var m;
      while(out.length<7 && (m=re.exec(html))){
        var hu=gmImageSrc(m[0]||'');
        if(!hu)continue;
        if(out.indexOf(hu)<0)out.push(hu);
      }
      if(out.length>beforeHtml)log('THUMB_HTML_492_ADD before='+beforeHtml+' after='+out.length);
      else log('THUMB_HTML_492_ADD none before='+beforeHtml);
    }catch(eh){
      log('THUMB_HTML_492_FAIL '+(eh&&eh.message||eh));
    }
  }

  /*
   * V159 THUMB_DIAG
   * 목적:
   * - 일부 상품에서 썸네일이 0개/1개만 들어오는 원인을 확인한다.
   * - 현재 단계에서는 source/srcset fallback을 복원하지 않고 로그만 찍는다.
   * - 쿠팡 DOM은 절대 수정하지 않는다.
   */
  log('THUMB_DIAG slides='+diag.slides+' imgNodes='+diag.imgNodes+' sourceNodes='+diag.sourceNodes+' withUrl='+diag.withUrl+' noUrl='+diag.withoutUrl+' out='+out.length);
  try{
    diag.samples.forEach(function(x,i){
      log('THUMB_SAMPLE['+i+'] tag='+x.tag+' ok='+x.ok+' box='+x.w+'x'+x.h+' natural='+x.nw+'x'+x.nh+' src='+x.src+' dataSrc='+x.dataSrc+' lazy='+x.lazy+' srcset='+x.srcset+' chain='+x.chain);
    });
  }catch(_s){}

  /* V155: 썸네일 script/html fallback 삭제.
   * 이유: 상단 swiper img 노드만 읽는다.
   * 쿠팡 hydration/script를 뒤져 후보를 합치거나 보정하지 않는다.
   */

  log('THUMB_TOP_ACTUAL count='+out.length);
  return out;
}

function gmDetailTextLevel(t){
  t=C(t);
  if(!t)return 'body';
  if(t.length<=18 || /^(체크\s*포인트|브랜드\s*이야기|포장\s*정보|사이즈|구성|보관|원산지|상품\s*정보)$/i.test(t))return 'title';
  if(/^체크\s*포인트/.test(t))return 'bullet';
  return 'body';
}

/*****************************************************************
 LEGACY IMAGE CLEANUP CODE DISABLED/NOT USED

 과거 접근:
  - 많은 이미지를 전부 수집한 뒤 합치기/중복제거/삭제/선별
  - 마크/배너/추천/리뷰/중복 이미지를 후처리로 제거

 폐기 사유:
  - 현재는 콘솔테스트로 확인한 정확한 노드만 수집한다.
  - 후처리 삭제기가 vendor_inventory / image11 / 롱이미지 / 정상 상세이미지를
    다시 버리는 문제가 있었다.
  - 현재 실행 경로에서는 쓰지 않고, 비교/롤백용으로만 보관한다.

 현재 원칙:
  - PROCESS-A/B가 수집한 블럭을 그대로 payload로 보낸다.
  - 이미지 합치기/중복제거/삭제/정렬 fallback을 사용하지 않는다.
*****************************************************************/

/*****************************************************************
 PROCESS-A
 DETAIL_BLOCK_PRIORITY

 목적:
 상세페이지의 subType-IMAGE / subType-TEXT 블럭 수집

 결과:
 image + text 순서 보존

 장점:
  - 이미지/텍스트 순서 보존
  - 롱이미지 대응 가능
  - 숏이미지 대응 가능
  - 브랜드스토리형 상세 대응
  - 텍스트 번역(translate) 적용 가능

 사용조건:
  - text block 이 1개 이상이면 우선 사용
  - 또는 image block 3개 이상이면 우선 사용

 예:
 콩나물
 브랜드스토리
 체크포인트 설명형
 롱이미지 + 텍스트 혼합형

 주의:
 일부 상품은 subType 블럭이 부족하거나
 이미지 블럭만 1~2개 존재할 수 있으므로
 PROCESS-B fallback 필요
*****************************************************************/
function gmDetailImageSrc(el){
  return gmImagePickSrc(el);
}
function gmDetailIsThumbNode(el){
  try{return !!(el&&el.closest&&el.closest('.swiper,.swiper-slide,.swiper-wrapper'));}catch(e){return false;}
}

/*
 * PROCESS-A/B SMALL MARK FILTER
 * 2026-06 추가.
 * 목적:
 *  - 콘솔테스트에서 확인한 작은 인증마크/스티커성 이미지를 제외한다.
 *  - 단, 롱이미지/숏 상세이미지는 모두 허용한다.
 * 원칙:
 *  - 쿠팡 img 노드는 절대 수정하지 않고 크기값만 읽는다.
 *  - w/h가 0이면 아직 렌더 전일 수 있으므로 버리지 않는다.
 *  - 상세 이미지로 볼 수 없는 작은 이미지일 때만 제외한다.
 */

function gmDetailIsUiCheckOrIcon(img,src){
  src=C(src||'');
  var chain='';
  try{
    var cur=img;
    for(var i=0;cur&&i<6;i++,cur=cur.parentElement){
      chain+=' '+C(cur.className||'')+' '+C(cur.id||'')+' '+C(cur.getAttribute&&cur.getAttribute('role')||'');
    }
  }catch(_c){}
  var alt='';
  try{alt=C((img&&img.alt)||img.getAttribute&&img.getAttribute('aria-label')||'');}catch(_a){alt='';}
  var text=(chain+' '+alt+' '+src).toLowerCase();
  if(/(checkbox|check[-_ ]?mark|checkmark|success|complete|confirm|done|sprite|ico|icon|badge|logo|banner|payment|delivery)/i.test(text))return true;
  if(/\/(?:assets|asset|static|common|img|images)\/.*(?:check|checkbox|success|complete|confirm|done|ico|icon|sprite|badge|logo)/i.test(src))return true;
  return false;
}
function gmDetailShouldSkipSmallMark(img){
  var src='';
  try{src=String(gmDetailImageSrc(img)||'');}catch(_src){src='';}
  if(gmDetailIsUiCheckOrIcon(img,src))return true;

  /*
   * V177: vendor_inventory / retail/images 는 정상 상세이미지 URL로 확정.
   * WebView에서 일시적으로 16x16 깨진 아이콘처럼 렌더되어도 URL 기준으로 상세이미지는 버리지 않는다.
   * 과거 vendor_inventory 전체 차단은 document.images 광범위 수집 때의 오염 제거용이었고,
   * 현재 PROCESS-A/B는 상세 컨테이너 안에서만 수집하므로 여기서는 허용한다.
   */
  if(/\/image\/vendor_inventory\//i.test(src)||/\/image\/retail\/images\//i.test(src))return false;

  var w=0,h=0;
  try{
    var r=img&&img.getBoundingClientRect&&img.getBoundingClientRect();
    w=Math.round((r&&r.width)||0);
    h=Math.round((r&&r.height)||0);
  }catch(_r){}
  try{
    if(!w)w=Number((img&&(img.naturalWidth||img.width))||0)||0;
    if(!h)h=Number((img&&(img.naturalHeight||img.height))||0)||0;
  }catch(_n){}
  if(!w&&!h)return false;
  var normal=(w>=250&&h>=180);
  var longImg=(w>=120&&h>=400&&(h/Math.max(1,w))>=1.6);
  return !(normal||longImg);
}
function gmDetailAddBlockImage(blocks,img,order,source){
  var src=gmDetailImageSrc(img);
  if(!src)return;
  if(gmDetailIsThumbNode(img))return;
  /*
   * 삭제/중복제거/합치기는 하지 않는다.
   * 다만 작은 인증마크/스티커성 이미지는 상세 본문 이미지가 아니므로 제외한다.
   * w/h=0인 렌더 전 이미지는 버리지 않고, 롱이미지는 허용한다.
   */
  if(gmDetailShouldSkipSmallMark(img)){
    try{
      var r=img&&img.getBoundingClientRect&&img.getBoundingClientRect();
      log('SMALL_MARK_SKIP source='+source+' box='+Math.round((r&&r.width)||0)+'x'+Math.round((r&&r.height)||0)+' src='+String(src).slice(0,110));
    }catch(_sm){log('SMALL_MARK_SKIP source='+source+' src='+String(src).slice(0,110));}
    return;
  }
  var __r=null;
  try{__r=img&&img.getBoundingClientRect&&img.getBoundingClientRect();}catch(_r){}
  blocks.push({
    type:'image',
    src:src,
    images:[src],
    order:order,
    source:source,
    naturalWidth:Number((img&&img.naturalWidth)||0),
    naturalHeight:Number((img&&img.naturalHeight)||0),
    boxWidth:Math.round((__r&&__r.width)||0),
    boxHeight:Math.round((__r&&__r.height)||0)
  });
}


/*****************************************************************
 PROCESS-B
 IMAGE_ONLY_FALLBACK

 목적:
 PROCESS-A 결과가 부족할 때 document.images 기준으로
 vendor_inventory / image/retail 상세 이미지를 직접 수집한다.

 사용조건:
  - PROCESS-A text block 없음
  - PROCESS-A image block 3개 미만

 제외:
  - swiper 썸네일
  - review / PRODUCTREVIEW
  - logo / icon / badge / banner / payment / delivery
  - 작은 인증마크/스티커

 허용:
  - vendor_inventory
  - image/retail
  - 롱이미지
  - top 음수 좌표 이미지
*****************************************************************/
function collectDetailImageOnlyFallbackBlocks(){
  var out=[];
  try{
    QA('img').forEach(function(img,idx){
      if(gmDetailIsThumbNode(img))return;
      var chain='';
      try{
        var cur=img;
        for(var i=0;cur&&i<6;i++,cur=cur.parentElement)chain+=' '+C(cur.className||cur.tagName||'');
      }catch(_){}
      var inDetail=/product-detail-content|product-detail-content-inside|vendor-item|type-HTML|subType-IMAGE|type-IMAGE_NO_SPACE|subType-TEXT/i.test(chain);
      if(!inDetail)return;
      gmDetailAddBlockImage(out,img,idx,'PROCESS-B imageOnlyFallback');
    });
  }catch(e){log('PROCESS_B_FAIL '+(e&&e.message||e));}
  log('PROCESS_B_IMAGE_ONLY blocks='+out.length);
  return out;
}


function gmDetailIsCheckPointTextBlock(block){
  if(!block || block.type!=='text')return false;
  var txt=C(block.text||'').replace(/\s+/g,' ').toLowerCase();
  if(!txt)return false;
  /*
   * CHECK POINT 섹션은 본문 텍스트 앞에 큰 체크 장식 이미지가 반복된다.
   * URL/class/alt로는 일반 상세 이미지와 구분되지 않으므로
   * detailBlocks 조립 후 "image -> CHECK POINT text" 패턴에서 image만 제거한다.
   */
  if(/check\s*point/i.test(txt))return true;
  if(/체크\s*포인트/.test(txt))return true;
  if(/haccp/.test(txt) && /안심/.test(txt))return true;
  return false;
}
function gmDetailIsCheckLikeDecorImageBlock(block){
  if(!block || block.type!=='image')return false;
  var src=C(block.src||'').toLowerCase();

  /*
   * CHECK POINT 장식 이미지는 URL만으로는 일반 상세 이미지와 구분되지 않는다.
   * 따라서 CHECK POINT text block 바로 앞의 image들 중
   * 정사각형에 가까운 대형 장식 이미지만 제거한다.
   */
  if(/check|check[-_ ]?point|haccp|ico_check|icon_check|success|confirm|complete/i.test(src))return true;

  var nw=Number(block.naturalWidth||0);
  var nh=Number(block.naturalHeight||0);
  var bw=Number(block.boxWidth||0);
  var bh=Number(block.boxHeight||0);

  var w=nw||bw;
  var h=nh||bh;
  if(!w || !h)return false;

  var min=Math.min(w,h);
  var max=Math.max(w,h);
  var ratio=min/max;

  /* 대형 체크 장식: 정사각형/준정사각형이고, 너무 작은 마크가 아니라 본문 폭을 크게 차지 */
  if(min>=220 && ratio>=0.72)return true;

  return false;
}

function gmDetailFilterCheckPointIconBlocks(blocks){
  if(!Array.isArray(blocks)||!blocks.length)return blocks||[];

  var removed=0;

  for(var i=0;i<blocks.length;i++){
    var cur=blocks[i];
    if(!gmDetailIsCheckPointTextBlock(cur))continue;

    /*
     * 기존 필터는 image -> CHECK POINT text 1개만 제거했다.
     * 실제 쿠팡 상세는 image image image image -> CHECK POINT text 구조가 있으므로
     * text 앞쪽으로 거슬러 올라가며 연속된 체크 장식 이미지를 모두 제거한다.
     */
    for(var j=i-1;j>=0;j--){
      var prev=blocks[j];
      if(!prev || prev.type!=='image')break;
      if(!gmDetailIsCheckLikeDecorImageBlock(prev))break;
      if(!prev.__gmRemoveCheckPointIcon){
        prev.__gmRemoveCheckPointIcon=true;
        removed++;
      }
    }
  }

  if(!removed)return blocks;

  var out=blocks.filter(function(b){return !(b&&b.__gmRemoveCheckPointIcon);});
  out.forEach(function(b){if(b)delete b.__gmRemoveCheckPointIcon;});
  log('CHECK_POINT_ICON_BLOCK_SKIP removed='+removed+' before='+blocks.length+' after='+out.length);
  return out;
}


function collectDetailBlocks(){
  var blocks=[];
  try{
    QA('.vendor-item [class*="subType"], .product-detail-content-inside [class*="subType"], .product-detail-content [class*="subType"]').forEach(function(el,order){
      var cls=C(el.className||'');
      var text=C((el.innerText||el.textContent)||'');

      /* subType-TEXT 안에도 이미지가 있을 수 있으므로 이미지 먼저 같은 order에 추가한다. */
      QA('img',el).forEach(function(img){gmDetailAddBlockImage(blocks,img,order,/subType-TEXT/i.test(cls)?'PROCESS-A subType-TEXT image':'PROCESS-A subType-IMAGE');});

      if(/subType-TEXT/i.test(cls) && text.replace(/\s+/g,'').length>=10){
        blocks.push({type:'text',text:text,level:gmDetailTextLevel(text),order:order,source:'PROCESS-A subType-TEXT'});
      }
    });
  }catch(e){log('PROCESS_A_FAIL '+(e&&e.message||e));}

  blocks.sort(function(a,b){return (a.order||0)-(b.order||0);});
  var imageCount=blocks.filter(function(b){return b&&b.type==='image';}).length;
  var textCount=blocks.filter(function(b){return b&&b.type==='text'&&b.text;}).length;

  var mode='PROCESS_A';
  if(textCount===0 && imageCount<3){
    var fb=collectDetailImageOnlyFallbackBlocks();
    if(fb.length>imageCount){
      blocks=fb;
      imageCount=blocks.length;
      mode='PROCESS_B';
    }
  }

  blocks=gmDetailFilterCheckPointIconBlocks(blocks);
  imageCount=blocks.filter(function(b){return b&&b.type==='image';}).length;
  textCount=blocks.filter(function(b){return b&&b.type==='text'&&b.text;}).length;

  log('DETAIL_BLOCKS mode='+mode+' count='+blocks.length+' images='+imageCount+' texts='+textCount);
  return blocks;
}


function gmCoupangImageIdentity(u){
  u=C(u).replace(/^https?:/i,'');
  try{u=decodeURIComponent(u);}catch(_d){}
  u=u.split('?')[0].replace(/\/+/g,'/');
  var m=u.match(/\/(?:image\/vendor_inventory|retail\/images)\/(.+)$/i);
  var tail=m?m[1]:u.split('/').slice(-3).join('/');
  tail=tail.replace(/^(?:remote\/)?\d+x\d+(?:ex)?\//i,'');
  tail=tail.replace(/\.(jpg|jpeg|png|webp|avif)$/i,'').toLowerCase();
  return tail;
}
function gmCoupangRemoveSearchThumbDuplicate(arr){
  arr=Array.isArray(arr)?arr.filter(Boolean):[];
  if(arr.length<2)return arr;
  var id0=gmCoupangImageIdentity(arr[0]), id1=gmCoupangImageIdentity(arr[1]);
  if(id0 && id1 && id0===id1){
    log('THUMB_DROP_SEARCH_DUP firstSameAsSecond id='+id0+' before='+arr.length);
    arr=arr.slice(1);
  }
  var seen={},out=[];
  arr.forEach(function(u){var k=gmCoupangImageIdentity(u)||C(u); if(seen[k])return; seen[k]=1; out.push(u);});
  if(out.length!==arr.length)log('THUMB_DEDUP_BY_ID before='+arr.length+' after='+out.length);
  return out;
}

function imageInfo(skipDetailScan){
  /* V151: 이미지 payload는 1:1 pass-through만 허용한다.
   * - 썸네일: collectTopSwiperImages() 결과 그대로
   * - 상세: collectDetailBlocks() 결과 그대로
   */
  var top=[];
  try{top=collectTopSwiperImages();}catch(e){log('THUMB_TOP_ACTUAL_APPLY_FAIL '+(e&&e.message||e));top=[];}
  top=gmCoupangRemoveSearchThumbDuplicate(top).slice(0,10);
  var main=top[0]||'';
  var extraThumbs=top.slice(1,10);
  var thumbPipe=String(extraThumbs.length)+(extraThumbs.length?'|'+extraThumbs.join('|'):'');
  var detailBlocks=[];
  try{detailBlocks=collectDetailBlocks();}catch(e){log('DETAIL_BLOCKS_INITIAL_FAIL '+(e&&e.message||e));detailBlocks=[];}
  var blockImages=detailBlocks.filter(function(b){return b&&b.type==='image';}).length;
  var blockTexts=detailBlocks.filter(function(b){return b&&b.type==='text'&&b.text;}).length;
  log('THUMB_FINAL_SOURCE TOP_ACTUAL count='+top.length);
  log('DETAIL_BLOCKS_PASS_THROUGH blocks='+detailBlocks.length+' images='+blockImages+' texts='+blockTexts);
  log('PAYLOAD_IMAGE_BASE images='+top.length+' thumbnailImages='+top.length+' detailBlocks='+detailBlocks.length);
  return {
    mainImage:main,
    image:main,
    thumbnail:main,
    imageUrl:main,
    thumbnailUrl:main,
    images:top,
    thumbnailImages:top,
    thumb_pipe:thumbPipe,
    thumbPipe:thumbPipe,
    additional_image_count:extraThumbs.length,
    detailBlocks:detailBlocks,
    __gmImageCounts:{thumb:top.length,add:0,blocks:detailBlocks.length,blockImages:blockImages,blockTexts:blockTexts,main:main?1:0}
  };
}
function gmV138FinalizeImagePayload(info){
  /* V155 FINAL IMAGE PASS-THROUGH ONLY
   * 이전 버전은 최종 단계에서 collectTopSwiperImages()/collectDetailBlocks()를 다시 호출했다.
   * 그 자체가 중복 수집/재조립 흐름이므로 제거한다.
   * imageInfo()가 만든 thumbnailImages/detailBlocks를 그대로 통과시킨다.
   */
  info=info||{};
  var top=(Array.isArray(info.thumbnailImages)?info.thumbnailImages:(Array.isArray(info.images)?info.images:[])).slice(0,10);
  var blocks=Array.isArray(info.detailBlocks)?info.detailBlocks:[];
  var blockImages=blocks.filter(function(b){return b&&b.type==='image';}).length;
  var blockTexts=blocks.filter(function(b){return b&&b.type==='text'&&b.text;}).length;
  info.thumbnailImages=top;
  info.images=top;
  info.mainImage=info.mainImage||top[0]||'';
  info.image=info.image||info.mainImage||'';
  info.thumbnail=info.thumbnail||info.mainImage||'';
  info.imageUrl=info.imageUrl||info.mainImage||'';
  info.thumbnailUrl=info.thumbnailUrl||info.mainImage||'';
  var extraThumbs=top.slice(1,10);
  info.thumb_pipe=String(extraThumbs.length)+(extraThumbs.length?'|'+extraThumbs.join('|'):'');
  info.thumbPipe=info.thumb_pipe;
  info.additional_image_count=extraThumbs.length;
  info.detailBlocks=blocks;
  info.__gmImageCounts={thumb:top.length,blocks:blocks.length,blockImages:blockImages,blockTexts:blockTexts,main:info.mainImage?1:0};
  log('FINAL_IMAGE_PASS_THROUGH_NO_RESCAN images='+top.length+' detailBlocks='+blocks.length+' blockImages='+blockImages+' blockTexts='+blockTexts);
  return info;
}
/* 과거 광범위 detail image fallback 삭제됨.
 * 이유: PROCESS-A/B 이전의 광범위 이미지 수집/삭제/합치기 방식은 현재 상세 수집에 불필요하며,
 * vendor_inventory / image11 / 롱이미지를 정상 상세임에도 버릴 수 있어 완전히 제거한다.
 */
/* 공급사 정보는 상세 UI 표시용이 아니라 monitor/server 전송용 보강 데이터다.
 * 스크롤/팝업 클릭 없이 현재 HTML 전체에서 product-seller 테이블 + 키워드 주변을 직접 추출한다.
 */
function htmlPlainText(){try{return C((document.documentElement&&document.documentElement.innerHTML)||'').replace(/<[^>]+>/g,' ');}catch(e){return '';}}
function normEmail(v){var m=C(v).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);return m?m[0]:'';}
function normPhone(v){var m=C(v).match(/(?:\+?82[-\s]?)?0?\d{1,2}[-\s]?\d{3,4}[-\s]?\d{4}|1[568]\d{2}[-\s]?\d{4}/);return m?m[0].replace(/\s+/g,''):'';}
function normBizNo(v){var m=C(v).match(/\d{3}[-\s]?\d{2}[-\s]?\d{5}/);return m?m[0].replace(/\s+/g,''):'';}
function normMailOrder(v){var m=C(v).match(/\d{4}[-\s]*[가-힣A-Za-z]+[-\s]*\d{3,6}/);return m?m[0].replace(/\s+/g,''):'';}
function splitCompanyRep(v){v=C(v);var parts=v.split(/\s*\/\s*/).map(C).filter(Boolean);return {company:parts[0]||v,representative:parts[1]||''};}
function cleanSupplierAddress(v){return C(v).replace(/e-?mail\s+.*$/i,'').replace(/통신판매.*$/,'').replace(/사업자.*$/,'').trim();}
function supplierInfo(){
  var out={sellerName:'',vendorName:'',supplierName:'',supplierPhone:'',supplierEmail:'',supplierRepresentative:'',supplierAddress:'',supplierBizNo:'',supplierMailOrderNo:'',__gmSupplierSource:'html-product-seller',__gmSupplierRows:[]};
  var box=Q('.product-seller')||Q('.product-item__table.product-seller')||Q('[class*="product-seller"]');
  if(!box){
    try{
      var html=(document.documentElement&&document.documentElement.innerHTML)||'';
      var m=html.match(/<div[^>]+class="[^"]*product-seller[^"]*"[\s\S]{0,18000}?<\/table>[\s\S]{0,800}?<\/div>/i);
      if(m){var tmp=document.createElement('div');tmp.innerHTML=m[0];box=tmp;out.__gmSupplierSource='html-product-seller-block';}
    }catch(e){}
  }
  if(box){
    QA('tr',box).forEach(function(tr){
      var th=T(Q('th',tr));var tdEl=Q('td',tr);var td=T(tdEl);var telA=tdEl?Q('a[href^="tel:"]',tdEl):null;var phone=telA?C(telA.getAttribute('href')).replace(/^tel:/,''):normPhone(td);var email=normEmail(td);
      out.__gmSupplierRows.push({th:th,td:td,phone:phone,email:email});
      if(/상호|대표자|판매자/.test(th)){var sr=splitCompanyRep(td.replace(phone,''));out.sellerName=sr.company;out.vendorName=sr.company;out.supplierName=sr.company;if(sr.representative)out.supplierRepresentative=sr.representative;if(phone)out.supplierPhone=phone;}
      if(/e-?mail|이메일/i.test(th)||email)out.supplierEmail=email||td;
      if(/연락처|전화|고객센터/.test(th))out.supplierPhone=phone||td;
      if(/사업자/.test(th))out.supplierBizNo=normBizNo(td)||td;
      if(/통신판매/.test(th))out.supplierMailOrderNo=normMailOrder(td)||td;
      if(/주소|소재지|사업장/.test(th))out.supplierAddress=cleanSupplierAddress(td);
    });
  }
  var full=htmlPlainText();
  function around(k,rad){var arr=[],pos=0;while(full&&true){var p=full.indexOf(k,pos);if(p<0)break;arr.push(full.slice(Math.max(0,p-rad),Math.min(full.length,p+rad)));pos=p+k.length;if(arr.length>=20)break;}return arr;}
  ['상호/대표자','상호','대표자','e-mail','이메일','통신판매업 신고번호','통신판매','사업자등록번호','사업자','사업장 소재지','사업장소재지','주소','연락처','고객센터'].forEach(function(k){
    around(k,650).forEach(function(sn){var s=C(sn);
      if(!out.supplierEmail){var em=normEmail(s);if(em)out.supplierEmail=em;}
      if(!out.supplierPhone&&/연락처|전화|고객센터/.test(s)){var ph=normPhone(s);if(ph)out.supplierPhone=ph;}
      if(!out.supplierBizNo&&/사업자/.test(s)){var bz=normBizNo(s);if(bz)out.supplierBizNo=bz;}
      if(!out.supplierMailOrderNo&&/통신판매/.test(s)){var mo=normMailOrder(s);if(mo)out.supplierMailOrderNo=mo;}
      if(!out.supplierAddress&&/주소|소재지|사업장/.test(s)){var am=s.match(/(?:사업장\s*소재지|사업장소재지|주소)\s*[:：]?\s*([가-힣A-Za-z0-9\s,.\-()]{8,160})/);if(am)out.supplierAddress=cleanSupplierAddress(am[1]);}
    });
  });
  if(out.sellerName&&!out.supplierName)out.supplierName=out.sellerName;if(out.sellerName&&!out.vendorName)out.vendorName=out.sellerName;
  log('SUPPLIER_INFO seller='+out.sellerName+' rep='+out.supplierRepresentative+' phone='+out.supplierPhone+' email='+out.supplierEmail+' biz='+out.supplierBizNo+' mailOrder='+out.supplierMailOrderNo);
  return out;
}




function quantityLimitInfo(){
  var out={buyable_qty:null,buyableQty:null,min_order_qty:null,minOrderQty:null,max_order_qty:null,maxOrderQty:null};
  try{
    var scripts=QA('script').map(function(s){return String(s.textContent||'');});
    var ids=pageIds();
    var keys=[ids.itemId,ids.vendorItemId].filter(Boolean);
    scripts.forEach(function(t){
      keys.forEach(function(k){
        var p=0,n=0;
        while((p=t.indexOf(k,p))>=0 && n<8){
          n++;
          var b=t.slice(Math.max(0,p-2200),Math.min(t.length,p+2200));
          var m=b.match(/(?:\\\"|\"|')buyableQuantity(?:\\\"|\"|')\s*:\s*(\d+)/i);
          if(m && out.buyable_qty==null) out.buyable_qty=Number(m[1]);
          var max=b.match(/(?:maximumBuyForPerson|maxPurchaseQuantity|maximumPurchaseQuantity|maxBuyCount|maximumBuyCount)(?:\\\"|\"|')?\s*:\s*(\d+)/i);
          if(max && out.max_order_qty==null) out.max_order_qty=Number(max[1]);
          var min=b.match(/(?:minimumBuyForPerson|minPurchaseQuantity|minimumPurchaseQuantity)(?:\\\"|\"|')?\s*:\s*(\d+)/i);
          if(min && out.min_order_qty==null) out.min_order_qty=Number(min[1]);
          p+=k.length;
        }
      });
    });
    var full=C(document.body&&document.body.innerText||'');
    if(out.max_order_qty==null){var mm=full.match(/(?:최대|1일 최대|모델 당 1일 최대|구매 가능 수량은)\s*(\d+)\s*개/); if(mm) out.max_order_qty=Number(mm[1]);}
    if(out.min_order_qty==null){var mn=full.match(/(?:최소|최소구매|최소 구매)\s*(\d+)\s*개/); if(mn) out.min_order_qty=Number(mn[1]);}
  }catch(e){}
  out.buyableQty=out.buyable_qty;
  out.minOrderQty=out.min_order_qty;
  out.maxOrderQty=out.max_order_qty;
  log('QTY_LIMIT buyable='+(out.buyable_qty==null?'':out.buyable_qty)+' min='+(out.min_order_qty==null?'':out.min_order_qty)+' max='+(out.max_order_qty==null?'':out.max_order_qty));
  return out;
}

function taxInfo(){
  var out={tax_type:'',taxType:'',vat_type:'',vatType:'',vat_text:'',vatText:'',vat_included:null,vatIncluded:null,vat_source:'not_found',vatSource:'not_found'};
  try{
    var full=htmlPlainText ? htmlPlainText() : C(document.body&&document.body.innerText||'');
    var snippets=[];
    ['부가세','과세','면세','영세','VAT','vat'].forEach(function(k){var pos=0;while(full){var p=full.indexOf(k,pos);if(p<0)break;snippets.push(C(full.slice(Math.max(0,p-120),Math.min(full.length,p+220))));pos=p+k.length;if(snippets.length>=20)break;} });
    var blob=C(snippets.join(' | '));
    if(/면세/.test(blob)){out.tax_type='EXEMPT';out.vat_type='EXEMPT';out.vat_text=blob||'면세';out.vat_included=false;out.vat_source='coupang_dom';}
    else if(/영세/.test(blob)){out.tax_type='ZERO';out.vat_type='ZERO';out.vat_text=blob||'영세';out.vat_included=false;out.vat_source='coupang_dom';}
    else if(/부가세\s*포함|VAT\s*included|과세/.test(blob)){out.tax_type='TAXABLE';out.vat_type='TAXABLE';out.vat_text=blob||'과세';out.vat_included=true;out.vat_source='coupang_dom';}
    out.taxType=out.tax_type;out.vatType=out.vat_type;out.vatText=out.vat_text;out.vatIncluded=out.vat_included;out.vatSource=out.vat_source;
    log('VAT_INFO type='+(out.tax_type||'')+' source='+out.vat_source+' text='+(out.vat_text||'').slice(0,120));
  }catch(e){log('VAT_INFO_FAIL '+(e&&e.message||e));}
  return out;
}

function collectPolicyInfo(){
  var out={
    originCountry:'상세페이지 참조',
    remoteAreaText:'',remoteAreaUnavailable:false,
    jeju_delivery_yn:null,jejuDeliveryYn:null,jeju_extra_delivery_fee:null,jejuExtraDeliveryFee:null,
    island_delivery_yn:null,islandDeliveryYn:null,island_extra_delivery_fee:null,islandExtraDeliveryFee:null,
    returnFeeText:'',exchangeReturnFeeText:'',return_shipping_fee:0,returnShippingFee:0
  };
  function valFromRow(tr){var tds=QA('td',tr);return C((tds[tds.length-1]&&tds[tds.length-1].innerText)||'');}
  function policyRoots(){
    var roots=[];
    ['#sdpEtc','#prod-delivery-return-policy-3p','#prod-delivery-return-policy-retail','.prod-delivery-return-policy-table'].forEach(function(sel){
      QA(sel).forEach(function(el){if(el&&roots.indexOf(el)<0)roots.push(el);});
    });
    return roots;
  }
  function explicitFee(text,area){
    text=C(text||'');
    var areaRe=area==='jeju'?'제주(?:도)?(?:\\s*지역)?':'(?:도서\\s*산간|도서산간|산간\\s*지역|산간지역|섬\\s*지역|섬지역)';
    var patterns=[
      new RegExp(areaRe+'\\s*[:：-]?\\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)\\s*원','i'),
      new RegExp(areaRe+'[\\s\\S]{0,45}?(?:추가\\s*배송비|추가\\s*비용|배송비)\\s*[:：-]?\\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)\\s*원','i'),
      new RegExp('(?:추가\\s*배송비|추가\\s*비용|배송비)[\\s\\S]{0,35}?'+areaRe+'\\s*[:：-]?\\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)\\s*원','i')
    ];
    for(var i=0;i<patterns.length;i++){var m=text.match(patterns[i]);if(m&&N(m[1])>0)return N(m[1]);}
    return 0;
  }
  function combinedFee(text){
    text=C(text||'');
    var m=text.match(/제주(?:도)?\s*(?:및|\/|·|,|와|과)\s*(?:도서\s*산간|도서산간)[\s\S]{0,80}?(?:추가\s*배송비|추가\s*비용|배송비)?\s*[:：-]?\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)\s*원/i);
    return m?N(m[1]):0;
  }
  function explicitUnavailable(text,area){
    text=C(text||'');
    if(area==='jeju')return /제주(?:도)?(?:\s*지역)?[\s\S]{0,45}?(?:배송\s*불가|배송하지\s*않|배송\s*제외)|제주(?:도)?\s*(?:및|\/|·|,|와|과)\s*(?:도서\s*산간|도서산간)[\s\S]{0,45}?배송\s*불가/i.test(text);
    return /(?:도서\s*산간|도서산간|산간\s*지역|산간지역|섬\s*지역|섬지역)[\s\S]{0,45}?(?:배송\s*불가|배송하지\s*않|배송\s*제외)|제주(?:도)?\s*(?:및|\/|·|,|와|과)\s*(?:도서\s*산간|도서산간)[\s\S]{0,45}?배송\s*불가/i.test(text);
  }
  function explicitFree(text,area){
    text=C(text||'');
    var areaRe=area==='jeju'?'제주(?:도)?(?:\\s*지역)?':'(?:도서\\s*산간|도서산간|산간\\s*지역|산간지역|섬\\s*지역|섬지역)';
    return new RegExp(areaRe+'[\\s\\S]{0,55}?(?:추가\\s*배송비|추가\\s*비용)[\\s\\S]{0,25}?(?:없음|없습니다|무료|0\\s*원)','i').test(text)
      || new RegExp('(?:추가\\s*배송비|추가\\s*비용)[\\s\\S]{0,35}?'+areaRe+'[\\s\\S]{0,25}?(?:없음|없습니다|무료|0\\s*원)','i').test(text);
  }
  function collectActualReturnFee(){
    function feeFromText(text){
      text=C(text||'');
      if(!text)return 0;
      var values=[];
      var re=/(?:반품\s*(?:배송)?\s*비|왕복\s*(?:배송)?\s*비|교환\s*\/\s*반품\s*비용)?\s*[:：-]?\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)\s*원/gi;
      var m;
      while((m=re.exec(text))){
        var n=N(m[1]);
        if(n>0&&n<1000000)values.push(n);
      }
      return values.length?Math.max.apply(Math,values):0;
    }
    var roots=[];
    var exact=document.querySelector('#prod-delivery-return-policy-3p,#prod-delivery-return-policy-retail');
    if(exact) roots.push(exact);
    QA('.prod-delivery-return-policy-table,[id*="prod-delivery-return-policy"]').forEach(function(x){if(roots.indexOf(x)<0)roots.push(x);});
    if(!roots.length) roots=[document];
    for(var ri=0;ri<roots.length;ri++){
      var rows=QA('tr',roots[ri]);
      for(var i=0;i<rows.length;i++){
        var th=rows[i].querySelector('th');
        var td=rows[i].querySelector('td');
        if(!th||!td)continue;
        var label=C(th.innerText||th.textContent||'');
        if(!/(?:교환\s*\/\s*반품|교환\/반품|반품)\s*비용|왕복비용/.test(label))continue;
        var fee=feeFromText(td.innerText||td.textContent||rows[i].innerText||rows[i].textContent||'');
        if(fee>0)return fee;
      }
    }
    // 쿠팡 DOM 변형으로 th/td 구조가 달라진 경우 전체 정책 영역에서 문맥 기반으로 재검색한다.
    for(var rj=0;rj<roots.length;rj++){
      var rootText=C(roots[rj]&&((roots[rj].innerText||roots[rj].textContent)||''));
      var block=rootText.match(/(?:교환\s*\/\s*반품|교환\/반품|반품)\s*비용[\s\S]{0,500}/i);
      var fallbackFee=feeFromText(block?block[0]:'');
      if(fallbackFee>0)return fallbackFee;
    }
    return 0;
  }
  try{
    var roots=policyRoots();
    var policyTexts=[];
    roots.forEach(function(root){
      var tx=C(root&&root.innerText||root&&root.textContent||'');
      if(tx)policyTexts.push(tx);
      QA('tr',root).forEach(function(tr){
        var txt=C(tr.innerText||'');
        if(!txt)return;
        if(/원산지/.test(txt)&&out.originCountry==='상세페이지 참조'){
          var v=valFromRow(tr).replace(/^원산지\s*[:：]?\s*/,'');
          if(v && !/상품\s*상세페이지\s*참조/.test(v)) out.originCountry=v;
        }
      });
    });
    if(!roots.length){
      QA('tr').forEach(function(tr){
        var txt=C(tr.innerText||'');
        if(/제주|도서\s*산간|도서산간|산간지역|섬지역|추가\s*배송비|배송\s*불가/.test(txt))policyTexts.push(txt);
      });
    }
    if(out.originCountry==='상세페이지 참조'){
      QA('*').some(function(el){
        var tx=C(el.innerText||'');
        if(!tx||tx.length>120||!/원산지/.test(tx))return false;
        var m=tx.match(/원산지\s*[:：]?\s*([^\n\r·|/]{2,30})/);
        if(m){var v=C(m[1]).replace(/상품평|별점|무료배송.*$/,''); if(v){out.originCountry=v;return true;}}
        return false;
      });
    }
    var policyText=C(policyTexts.join(' | '));
    var jejuFee=explicitFee(policyText,'jeju');
    var islandFee=explicitFee(policyText,'island');
    var bothFee=combinedFee(policyText);
    if(!jejuFee&&bothFee)jejuFee=bothFee;
    if(!islandFee&&bothFee)islandFee=bothFee;

    /* 배송유형별 지역배송 정책
     * 1) 상세에 제주/도서산간 고정 추가비가 명시되면 배송유형과 무관하게 Y/금액이 최우선이다.
     * 2) BUNDLE/FRESH는 고정 금액이 없으면 제한/불가/무료 문구와 관계없이 null/null로 보낸다.
     *    - 주문서에서 그룹합계 30,000원 기준과 Cafe24 지역배송비를 계산한다.
     *    - FRESH 실제 배송 가능 여부는 자동주문 단계에서 최종 확인한다.
     * 3) SELLER/FREE만 명시적인 배송불가(N) 또는 지역 추가비 없음(F)을 반영한다.
     */
    var policyShipType=routeShipType();
    if(!policyShipType){
      try{policyShipType=C(deliveryInfo().shipType||'');}catch(_pst){}
    }
    var deferRegional=(policyShipType==='bundle'||policyShipType==='fresh');

    if(jejuFee>0){
      out.jeju_delivery_yn='Y';out.jeju_extra_delivery_fee=jejuFee;
    }else if(!deferRegional && explicitUnavailable(policyText,'jeju')){
      out.jeju_delivery_yn='N';out.jeju_extra_delivery_fee=null;
    }else if(!deferRegional && explicitFree(policyText,'jeju')){
      out.jeju_delivery_yn='F';out.jeju_extra_delivery_fee=0;
    }

    if(islandFee>0){
      out.island_delivery_yn='Y';out.island_extra_delivery_fee=islandFee;
    }else if(!deferRegional && explicitUnavailable(policyText,'island')){
      out.island_delivery_yn='N';out.island_extra_delivery_fee=null;
    }else if(!deferRegional && explicitFree(policyText,'island')){
      out.island_delivery_yn='F';out.island_extra_delivery_fee=0;
    }

    if(deferRegional && !jejuFee && !islandFee){
      log('REMOTE_DELIVERY_DEFER type='+policyShipType+' rule=group_30000_and_auto_order jeju=null island=null');
    }

    /* 일반 '무료배송'은 기본배송비만 뜻한다. 지역비 명시가 없으면 null 유지.
       BUNDLE/FRESH 30,000원 그룹 판정은 주문서가 수행한다. */
    out.jejuDeliveryYn=out.jeju_delivery_yn;
    out.jejuExtraDeliveryFee=out.jeju_extra_delivery_fee;
    out.islandDeliveryYn=out.island_delivery_yn;
    out.islandExtraDeliveryFee=out.island_extra_delivery_fee;
    out.remoteAreaUnavailable=(out.jeju_delivery_yn==='N'||out.island_delivery_yn==='N');
    out.remoteAreaText=[out.jeju_delivery_yn==='N'?'제주 지역 배송불가':'',out.island_delivery_yn==='N'?'도서산간 지역 배송불가':''].filter(Boolean).join(' / ');

    // 쿠팡 교환/반품 안내 표의 실제 왕복 반품비를 수집한다.
    // 상세 표를 찾지 못한 경우에만 기존 안전 기본값 5,000원을 사용한다.
    var actualReturnFee=collectActualReturnFee();
    var finalReturnFee=actualReturnFee>0?actualReturnFee:5000;
    out.return_shipping_fee=finalReturnFee;
    out.returnShippingFee=finalReturnFee;
    out.returnFeeText=String(finalReturnFee);
    out.exchangeReturnFeeText=String(finalReturnFee);
    log('REMOTE_DELIVERY_SOURCE roots='+roots.length+' text='+policyText.slice(0,260));
    log('RETURN_SHIPPING_FEE value='+finalReturnFee+' source='+(actualReturnFee>0?'coupang-policy-table':'fallback-5000'));
  }catch(e){log('POLICY_INFO_FAIL '+(e&&e.message||e));}
  if(!out.originCountry)out.originCountry='상세페이지 참조';
  log('REMOTE_DELIVERY_POLICY jeju='+out.jeju_delivery_yn+' fee='+out.jeju_extra_delivery_fee+' island='+out.island_delivery_yn+' fee='+out.island_extra_delivery_fee);
  log('POLICY_INFO origin='+out.originCountry+' remote='+(out.remoteAreaText||'')+' returnFee='+(out.return_shipping_fee||''));
  return out;
}

function supplierReadyScore(sup){
  sup=sup||{};
  var score=0;
  if(C(sup.sellerName||sup.supplierName))score++;
  if(C(sup.supplierRepresentative))score++;
  if(C(sup.supplierPhone))score++;
  if(C(sup.supplierEmail))score++;
  if(C(sup.supplierBizNo))score++;
  if(C(sup.supplierMailOrderNo))score++;
  if(C(sup.supplierAddress))score++;
  return score;
}
async function waitSupplierInfo(maxMs){
  var start=Date.now(), sup=supplierInfo(), best=sup, bestScore=supplierReadyScore(sup);
  while(Date.now()-start<maxMs){
    if(bestScore>=3 && C(best.sellerName||best.supplierName))break;
    await sleep(220);
    sup=supplierInfo();
    var sc=supplierReadyScore(sup);
    if(sc>bestScore){best=sup;bestScore=sc;}
  }
  log('SUPPLIER_WAIT score='+bestScore+' seller='+(best&&best.sellerName||''));
  return best||{};
}


/* DOM은 옵션 표시값/개수 기준. 클래스명보다 구조와 값 중심으로 후보를 모은다. */
function domOptionValues(){var out=[],seen={};function add(v,src){v=cleanText(v);v=C(v).replace(/^[·•\-\s]+/,'');if(badOptionValue(v))return;var k=v.replace(/\s+/g,'').toLowerCase();if(seen[k])return;seen[k]=1;out.push({name:v,value:v,source:src||'dom'});}QA('.option-table-list__option,[class*="option-table-list__option"],[class*="option-table__popup__option-item"],[class*="option-picker"] [role="option"],[class*="option-picker"] li').forEach(function(el){if(!visible(el))return;add(T(el),'dom.optionList');});QA('section ul li, [class*="fashion"] li, [class*="swatch"] li, [class*="thumbnail"] li').forEach(function(li){if(!visible(li))return;var tx=T(li);var p=priceFromText(tx);var name=tx;if(p)name=tx.replace(p,' ');if(name)add(name,'dom.li');QA('img',li).forEach(function(img){add(img.getAttribute('alt')||img.getAttribute('title')||'','dom.img');});});QA('button,[role="button"]').forEach(function(btn){if(!visible(btn))return;var tx=C((btn.getAttribute('aria-label')||'')+' '+(btn.getAttribute('title')||'')+' '+T(btn));if(/장바구니|구매하기|찜하기|공유|리뷰|문의/i.test(tx))return;add(tx,'dom.button');});return out.slice(0,120);}
function makeRowBase(name,price,ids,source,idx){name=C(name)||('옵션 '+(idx+1));price=price||'';ids=ids||{};var pid=ids.productId||pageIds().productId||'',iid=ids.itemId||'',vid=ids.vendorItemId||ids.venderItemId||'';var key=[pid,iid,vid].filter(Boolean).join('_');var row={name:name,value:name,fullOptionName:name,displayOptionName:name,productId:pid,itemId:iid,vendorItemId:vid,venderItemId:vid,key:key,source:source,domIndex:idx,optionPriceMissing:!price,gmOrderable:!!(pid&&iid&&vid),soldout:false};if(price)applyCoupangSalePrice(row,price,'margin-from-collected-price');if(pid&&iid&&vid){row.optionUrl='https://www.coupang.com/vp/products/'+encodeURIComponent(pid)+'?itemId='+encodeURIComponent(iid)+'&vendorItemId='+encodeURIComponent(vid);row.gmOptionVerifyUrl=row.optionUrl;}return row;}

/* productId 기반 빠른 UID 후보 추출: API 호출 없이 현재 페이지 HTML/Next hydration만 스캔한다. */
function collectProductIdJsonRows(domVals){
  /* UID/옵션수는 팝업 버튼과 무관하게 HTML/Next hydration에서 먼저 확정한다.
   * 중요: price/name이 비어 있어도 vendorItemId+itemId가 있으면 버리지 않는다.
   * 이전 버그: if(!price) continue; 때문에 실제 옵션 3개가 productJson=1로 줄어듦.
   */
  var ids=pageIds(),pid=ids.productId;
  if(!pid)return [];
  var html='';try{html=document.documentElement.innerHTML||'';}catch(e){html='';}
  var rows=[],seen={};
  var rePid=new RegExp(pid,'g'),m;
  while((m=rePid.exec(html))){
    var block=html.slice(Math.max(0,m.index-4000),Math.min(html.length,m.index+10000));
    if(!/vendorItemId/i.test(block))continue;
    var reVid=/(?:"|\\")vendorItemId(?:"|\\")\s*:\s*(?:"|\\")?(\d{5,})/gi;
    var vm;
    while((vm=reVid.exec(block))){
      var vendorItemId=GMID(vm[1]);
      if(!vendorItemId||seen[vendorItemId])continue;
      var around=block.slice(Math.max(0,vm.index-2500),Math.min(block.length,vm.index+3500));
      if(around.indexOf(pid)<0)continue;
      var itemId=firstKeyNumber(around,['itemId','vendorItemIdAttributesItemId','selectedItemId']);
      if(!itemId&&vendorItemId===ids.vendorItemId)itemId=ids.itemId;
      var price=firstPriceInChunk(around);
      var name=firstKeyString(around,['itemName','optionName','displayName','name','title']);
      name=cleanNameForPopup(name);
      if(badOptionValue(name))name='';
      /* UID 기준 row는 name/price가 없어도 유지한다. */
      seen[vendorItemId]=1;
      rows.push(makeRowBase(name,price,{productId:pid,itemId:itemId,vendorItemId:vendorItemId},'productIdJsonRows',rows.length));
    }
  }
  log('UID_ROWS_FIRST count='+rows.length);
  return rows;
}


/* OPTION BRANCH: fashion script extractor
 * 쿠팡 패션형은 화면 DOM에는 현재 선택값만 있고, 전체 옵션명/UID는 script optionRows + attributeVendorItemMap에 있다.
 * 정확한 흐름: optionRows(사이즈/색상 이름) + attributeVendorItemMap(itemId/vendorItemId/price) 병합.
 * fetch/API 호출 금지. 현재 로드된 script만 읽는다.
 */
function scriptTextForOptions(){
  var txt='';
  try{txt=QA('script').map(function(s){return s.textContent||'';}).join('\n');}catch(e){txt='';}
  return String(txt||'').replace(/\\"/g,'"').replace(/\\u0026/g,'&').replace(/\\n/g,'').trim();
}
function cutJsonAfter(text,keyText){
  var p=String(text||'').indexOf(keyText);
  if(p<0)return null;
  var ps=text.indexOf('[',p), po=text.indexOf('{',p);
  var start=-1;
  if(ps>=0&&po>=0)start=Math.min(ps,po); else start=ps>=0?ps:po;
  if(start<0)return null;
  var depth=0,quote=false,esc=false;
  for(var i=start;i<text.length;i++){
    var ch=text[i];
    if(esc){esc=false;continue;}
    if(ch==='\\'){esc=true;continue;}
    if(ch==='"')quote=!quote;
    if(quote)continue;
    if(ch==='['||ch==='{')depth++;
    if(ch===']'||ch==='}')depth--;
    if(depth===0)return text.slice(start,i+1);
  }
  return null;
}
function objectImageUrl(v){
  if(!v)return '';
  if(typeof v==='string')return C(v);
  if(typeof v==='object'){
    return C(v.origin||v.original||v.url||v.src||v.detailImage||v.preloadImage||v.thumbnail||'');
  }
  return '';
}
function collectFashionOptionRows(){
  var text=scriptTextForOptions();
  if(!text||text.indexOf('optionRows')<0||text.indexOf('attributeVendorItemMap')<0)return [];
  var optionRowsJson=cutJsonAfter(text,'"optionRows":');
  var attrMapJson=cutJsonAfter(text,'"attributeVendorItemMap":');
  if(!optionRowsJson||!attrMapJson)return [];
  var optionRows=null, attrMap=null;
  try{optionRows=JSON.parse(optionRowsJson);attrMap=JSON.parse(attrMapJson);}catch(e){log('FASHION_PARSE_FAIL '+(e&&e.message||e));return [];}
  if(!Array.isArray(optionRows)||!attrMap)return [];
  var sizeRow=optionRows.filter(function(r){return C(r&&r.name)==='사이즈';})[0];
  var colorRow=optionRows.filter(function(r){return C(r&&r.name)==='색상';})[0];
  if(!sizeRow||!colorRow||!Array.isArray(sizeRow.attributes)||!Array.isArray(colorRow.attributes))return [];
  var size=sizeRow.attributes[0]||{};
  if(!size||!size.valueId)return [];
  var base=basePriceText();
  var rows=[];
  colorRow.attributes.forEach(function(c,i){
    c=c||{};
    if(!c.valueId||!c.name)return;
    var key=C(size.valueId)+':'+C(c.valueId);
    var inv=attrMap[key]||attrMap[C(c.valueId)+':'+C(size.valueId)]||{};
    var itemId=GMID(inv.itemId||'');
    var vendorItemId=GMID(inv.vendorItemId||'');
    if(!itemId||!vendorItemId)return;
    var price=inv.price?formatWon(inv.price):base;
    var name=C(size.name)+' × '+C(c.name);
    var row=makeRowBase(name,price,{productId:pageIds().productId,itemId:itemId,vendorItemId:vendorItemId},'fashionOptionRows',i);
    row.sizeValueId=C(size.valueId);row.colorValueId=C(c.valueId);
    row.sizeName=C(size.name);row.colorName=C(c.name);
    row.optionType='fashion';row.selected=!!c.selected;
    row.optionImage=objectImageUrl(c.image)||objectImageUrl(c.detailImage)||objectImageUrl(c.preloadImage)||'';
    if(row.optionImage){row.image=row.optionImage;row.thumbnail=row.optionImage;}
    rows.push(row);
  });
  log('FASHION_OPTION_ROWS count='+rows.length+' size='+C(size.name));
  return uniqueRows(rows);
}

/* OPTION BRANCH: electronic card DOM extractor
 * 모든옵션보기/패션 script가 없을 때만 사용한다.
 * 보증/보험 라디오는 구매옵션이 아니므로 제외한다.
 */
function collectPcCardOptionRows(expectedCount){
  /* PC/전자제품 카드형은 .instant-option DOM이 기준이다.
   * 예: 다른 구성 보기 > 저장용량 > 128GB/256GB/384GB/640GB.
   * 주의: expectedCount가 1이어도 slice 금지. productIdJsonRows가 대표 UID 1개만 주는 경우가 많다.
   */
  var roots=[];
  QA('.instant-option,[class*="instant-option"],section,ul').forEach(function(el){
    if(!visible(el))return;
    var tx=T(el);
    if(!tx||tx.length>800)return;
    if(/무상보증|보증|보험|쿠팡안심케어/i.test(tx))return;
    if(/다른\s*구성\s*보기|저장용량|용량|색상|구성|GB|TB|RAM|SSD/i.test(tx)){
      var liCount=QA('li',el).filter(visible).length;
      if(liCount>=2 || /[1-9]\d{0,2}(?:,\d{3})+\s*원|[1-9]\d{3,8}\s*원/.test(tx)) roots.push(el);
    }
  });
  var rows=[],seen={};
  function addFromNode(el,rootIndex,nodeIndex){
    if(!visible(el))return;
    var tx=T(el);
    if(!tx||tx.length>180)return;
    if(/무상보증|보증|보험|쿠팡안심케어|장바구니|바로구매|구매하기|혜택보기|판매자|상품평|리뷰/i.test(tx))return;
    if(!(/[1-9]\d{0,2}(?:,\d{3})+\s*원|[1-9]\d{3,8}\s*원/.test(tx)))return;
    if(!(/GB|TB|색상|용량|RAM|SSD|FREE|블랙|화이트|그레이|실버|핑크|개|세트|kg|g|ml|L/i.test(tx)))return;
    var price=priceFromText(tx);
    var name=cleanNameForPopup(tx);
    name=C(name).replace(/^다른\s*구성\s*보기\s*/,'').replace(/^저장용량\s*:?\s*/,'').trim();
    if(!name||badOptionValue(name))return;
    var k=name.replace(/\s+/g,'').toLowerCase()+'|'+C(price);
    if(seen[k])return;seen[k]=1;
    rows.push({name:name,value:name,fullOptionName:name,displayOptionName:name,price:price,priceText:price,coupangPrice:price,optionPriceText:price,source:'pcCardOptionRows',text:tx,rootIndex:rootIndex,nodeIndex:nodeIndex});
  }
  roots.forEach(function(root,ri){
    var direct=QA('li',root).filter(visible);
    if(direct.length<2) direct=QA('button,[role="button"]',root).filter(visible);
    if(direct.length<2){
      /* 최후 보조: instant-option 내부의 작은 카드 div만 탐색 */
      direct=QA('div',root).filter(function(el){
        if(!visible(el))return false;
        var r;try{r=el.getBoundingClientRect();}catch(e){r={width:0,height:0};}
        var tx=T(el);
        return r.width>=40&&r.width<=220&&r.height>=30&&r.height<=120&&/[1-9]\d{0,2}(?:,\d{3})+\s*원|[1-9]\d{3,8}\s*원/.test(tx);
      });
    }
    direct.forEach(function(el,ni){addFromNode(el,ri,ni);});
  });
  log('PC_CARD_OPTION_ROWS count='+rows.length+' expected='+(expectedCount||0));
  return rows;
}

async function waitPcCardOptionRows(maxMs){
  var start=Date.now(), rows=[];
  while(Date.now()-start<maxMs){
    rows=collectPcCardOptionRows(0);
    if(rows.length>=2)return rows;
    await sleep(180);
  }
  return rows||[];
}


/* OPTION BRANCH: unified script extractor
 * 모든옵션보기/라디오형/패션형 공통 1순위.
 * 버튼 클릭 금지. 이미 내려온 optionRows + attributeVendorItemMap + vendorItemId 객체에서
 * 옵션명/UID/가격을 직접 확정한다.
 */
function gmOptionBigText(){
  var txt='';
  try{txt=QA('script').map(function(s){return s.textContent||'';}).join('\n')+'\n<!--HTML-->\n'+(document.documentElement.innerHTML||'');}catch(e){txt='';}
  return String(txt||'').replace(/\\"/g,'"').replace(/\\u0026/g,'&').replace(/\\\//g,'/').replace(/&quot;/g,'"').replace(/&amp;/g,'&');
}
function flattenOptionAttrs(optionRows){
  var attrs=[];
  (optionRows||[]).forEach(function(row,rowIndex){
    row=row||{};
    var groupName=C(row.name||row.displayName||row.title||row.label||('group'+rowIndex));
    var arr=Array.isArray(row.attributes)?row.attributes:[];
    arr.forEach(function(a,attrIndex){
      a=a||{};
      attrs.push({
        rowIndex:rowIndex,
        attrIndex:attrIndex,
        groupName:groupName,
        valueId:C(a.valueId||a.id||a.attributeValueId||a.value||''),
        name:C(a.name||a.displayName||a.valueName||a.title||a.label||''),
        selected:!!a.selected,
        raw:a
      });
    });
  });
  return attrs;
}
function findJsonObjectAround(text,pos){
  var start=-1;
  for(var i=pos;i>=0;i--){
    if(text[i]==='{'){start=i;break;}
    if(pos-i>12000)break;
  }
  if(start<0)return null;
  var depth=0,quote=false,esc=false;
  for(var j=start;j<text.length;j++){
    var ch=text[j];
    if(esc){esc=false;continue;}
    if(ch==='\\'){esc=true;continue;}
    if(ch==='"')quote=!quote;
    if(quote)continue;
    if(ch==='{')depth++;
    if(ch==='}')depth--;
    if(depth===0)return text.slice(start,j+1);
    if(j-start>30000)break;
  }
  return null;
}
function priceFromObjectText(objText){
  var keys=['vendorItemPrice','finalPrice','displayPrice','salePrice','discountPrice','coupangSalePrice','price'];
  for(var i=0;i<keys.length;i++){
    var key=keys[i];
    var re=new RegExp('(?:"|\\\\")?'+key+'(?:"|\\\\")?\\s*:\\s*(?:"|\\\\")?([0-9]{3,9}|[0-9]{1,3}(?:,[0-9]{3})+)','i');
    var m=String(objText||'').match(re);
    if(m)return {price:formatWon(m[1]),key:key,raw:m[1]};
  }
  return {price:'',key:'',raw:''};
}
function exactPriceByVendorItemId(vendorItemId){
  vendorItemId=GMID(vendorItemId);
  if(!vendorItemId)return {price:'',key:'',raw:'',candidateCount:0};
  var text=gmOptionBigText(),pos=0,candidates=[];
  while(true){
    var p=text.indexOf(vendorItemId,pos);
    if(p<0)break;
    var obj=findJsonObjectAround(text,p);
    if(obj&&obj.indexOf(vendorItemId)>=0){
      var pr=priceFromObjectText(obj);
      candidates.push({price:pr.price,key:pr.key,raw:pr.raw,len:obj.length});
    }
    pos=p+vendorItemId.length;
    if(candidates.length>=20)break;
  }
  var hit=candidates.filter(function(c){return !!c.price;})[0]||{};
  return {price:hit.price||'',key:hit.key||'',raw:hit.raw||'',candidateCount:candidates.length};
}

/* CPKR_REACT_OPTION_TABLE_MAP
 * 쿠팡 React payload의 option comparison table에는 vendorItemId/price/deliveryType/qty가 한 줄로 이미 확정되어 있다.
 * 예: listVendorItemId=option1:947...,option2:926...,option3:854...
 *     listVendorItemPrice=option1:3000,option2:5000,option3:7500
 *     listDeliveryType=option1:ROCKET_MERCHANT_V3_TMR,option2:ROCKET_V3_TMR
 * DOM 뱃지/텍스트 매칭은 이 값이 없을 때만 fallback으로 사용한다.
 */
function parseReactOptionKvList(v){
  v=unescapeLoose(v).replace(/^"|"$/g,'');
  var out={};
  if(!v)return out;
  /* 값 안에 천단위 콤마(10,720)가 들어오므로 단순 split(',') 금지.
     optionN: 다음 option key 전까지를 값으로 잡는다. */
  var re=/(option\d+)\s*:\s*([\s\S]*?)(?=\s*,\s*option\d+\s*:|$)/gi,m;
  while((m=re.exec(v))){out[m[1]]=C(m[2]);}
  return out;
}
function findReactOptionTableMeta(){
  var text=gmOptionBigText();
  var maps=[];
  function grab(block,key){
    var re=new RegExp('"'+key+'"\\s*:\\s*"([^"\\n\\r]{1,3000})"','i');
    var m=block.match(re); return m?unescapeLoose(m[1]):'';
  }
  var pos=0;
  while(true){
    var p=text.indexOf('listVendorItemId',pos);
    if(p<0)break;
    var block=text.slice(Math.max(0,p-2500),Math.min(text.length,p+7000));
    var ids=parseReactOptionKvList(grab(block,'listVendorItemId'));
    var prices=parseReactOptionKvList(grab(block,'listVendorItemPrice'));
    var deliveries=parseReactOptionKvList(grab(block,'listDeliveryType'));
    var qtys=parseReactOptionKvList(grab(block,'listQty'));
    var units=parseReactOptionKvList(grab(block,'listUnitPrice'));
    Object.keys(ids).forEach(function(optKey){
      var vid=GMID(ids[optKey]); if(!vid)return;
      maps.push({optionKey:optKey,vendorItemId:vid,price:formatWon(prices[optKey]||''),deliveryTypeRaw:C(deliveries[optKey]||''),qty:C(qtys[optKey]||''),unitPrice:C(units[optKey]||''),source:'react.listVendorItem'});
    });
    pos=p+16;
    if(maps.length>200)break;
  }
  var byVid={};
  maps.forEach(function(r){
    if(!r||!r.vendorItemId)return;
    var t=shipTypeFromBadge(r.deliveryTypeRaw);
    var badge=shipLabelFromType(t);
    byVid[r.vendorItemId]={vendorItemId:r.vendorItemId,price:r.price,deliveryTypeRaw:r.deliveryTypeRaw,shipType:t,shippingBadge:badge,qty:r.qty,unitPrice:r.unitPrice,optionKey:r.optionKey,source:r.source};
  });
  var sample=Object.keys(byVid).slice(0,8).map(function(v){var r=byVid[v];return v+'='+C(r.price)+'/'+C(r.deliveryTypeRaw)+'/'+C(r.shippingBadge);}).join('|');
  if(sample)log('REACT_OPTION_TABLE_MAP count='+Object.keys(byVid).length+' sample='+sample);
  return byVid;
}

function attrMapAddToCartPrice(inv){
  inv=inv||{};
  var url=C((inv.apiUrlMap&&inv.apiUrlMap.addToCartUrl)||inv.addToCartUrl||'');
  if(!url)return '';
  var m=url.match(/[?&]price=([0-9]{1,12})/i);
  return m?formatWon(m[1]):'';
}
function attrMapPrice(inv){
  inv=inv||{};
  function pick(obj,keys){
    obj=obj||{};
    for(var i=0;i<keys.length;i++){
      var v=obj[keys[i]];
      if(v!=null&&v!=='')return v;
    }
    return '';
  }
  /* 쿠팡 attributeVendorItemMap의 quantityBase 가격은 표시가/할인전가가 섞인다.
     addToCartUrl의 price가 실제 선택 SKU 결제가와 일치하므로 최우선. */
  var cart=attrMapAddToCartPrice(inv);
  if(cart)return cart;
  var p=(inv.quantityBase&&inv.quantityBase[0]&&inv.quantityBase[0].price)||{};
  var v=pick(p,['couponPrice','finalPrice','salePrice','discountedPrice','priceAmount']);
  if(!v&&p.i18nCouponPrice)v=p.i18nCouponPrice.amount||p.i18nCouponPrice.value||p.i18nCouponPrice.price||'';
  if(!v&&p.i18nFinalPrice)v=p.i18nFinalPrice.amount||p.i18nFinalPrice.value||p.i18nFinalPrice.price||'';
  if(!v&&p.i18nSalePrice)v=p.i18nSalePrice.amount||p.i18nSalePrice.value||p.i18nSalePrice.price||'';
  if(!v)v=pick(inv,['vendorItemPrice','finalPrice','displayPrice','salePrice','discountPrice','coupangSalePrice','price']);
  return formatWon(v);
}
function attrMapPriceSource(inv){
  inv=inv||{};
  if(attrMapAddToCartPrice(inv))return 'apiUrlMap.addToCartUrl.price';
  var p=(inv.quantityBase&&inv.quantityBase[0]&&inv.quantityBase[0].price)||{};
  if(p.couponPrice)return 'quantityBase[0].price.couponPrice';
  if(p.finalPrice)return 'quantityBase[0].price.finalPrice';
  if(p.salePrice)return 'quantityBase[0].price.salePrice';
  if(p.i18nCouponPrice&&p.i18nCouponPrice.amount)return 'quantityBase[0].price.i18nCouponPrice.amount';
  if(p.i18nFinalPrice&&p.i18nFinalPrice.amount)return 'quantityBase[0].price.i18nFinalPrice.amount';
  if(p.i18nSalePrice&&p.i18nSalePrice.amount)return 'quantityBase[0].price.i18nSalePrice.amount';
  var keys=['vendorItemPrice','finalPrice','displayPrice','salePrice','discountPrice','coupangSalePrice','price'];
  for(var i=0;i<keys.length;i++){if(inv[keys[i]])return 'attrMap.'+keys[i];}
  return '';
}
function attrMapShipMeta(inv){
  inv=inv||{};
  var found=[];
  var seen=[];
  function push(v,src){
    v=C(v); if(!v)return;
    if(/ROCKET_MERCHANT|ROCKET_FRESH|ROCKET|SELLER|MERCHANT|FRESH|로켓프레시|로켓배송|판매자배송/i.test(v)){
      found.push({raw:v,src:src||''});
    }
  }
  function scan(o,path,depth){
    if(!o||depth>8||found.length>8)return;
    if(typeof o==='string'){push(o,path);return;}
    if(typeof o!=='object')return;
    for(var si=0;si<seen.length;si++){if(seen[si]===o)return;}
    seen.push(o);
    var ks=[];try{ks=Object.keys(o);}catch(e){return;}
    var priority=/^(deliveryUnificationBadgeType|shippingType|deliveryType|shippingDeliveryType|deliveryBadgeType|logisticsType|fulfillmentType|badgeType)$/i;
    ks.forEach(function(k){if(priority.test(k))push(o[k],path+'.'+k);});
    ks.forEach(function(k){
      if(/url|image|html|description|message|title/i.test(k))return;
      if(/shipping|delivery|badge|rocket|merchant|fresh|logistic|fulfill|quantityBase/i.test(k)){
        try{scan(o[k],path+'.'+k,depth+1);}catch(e){}
      }
    });
  }
  scan(inv,'attrMap',0);
  var best=null;
  for(var i=0;i<found.length;i++){
    var t=shipTypeFromBadge(found[i].raw);
    if(!t)continue;
    var score=(/deliveryUnificationBadgeType|shippingType|deliveryType/i.test(found[i].src)?10:0)+(t==='seller'?3:(t==='fresh'?2:1));
    if(!best||score>best.score)best={raw:found[i].raw,src:found[i].src,type:t,score:score};
  }
  if(!best)return null;
  return {deliveryTypeRaw:best.raw,shipType:best.type,shippingBadge:shipLabelFromType(best.type),source:best.src};
}
function optionExpectedCount(optionRows){
  var n=1,has=false;
  (optionRows||[]).forEach(function(row){
    var c=(row&&Array.isArray(row.attributes))?row.attributes.length:0;
    if(c>0){n*=c;has=true;}
  });
  return has?n:0;
}
function findReactOptionModel(){
  var out=[],seen=[];
  function seenHas(o){for(var i=0;i<seen.length;i++){if(seen[i]===o)return true;}return false;}
  function scan(obj,path,depth){
    if(!obj||typeof obj!=='object'||depth>14||seenHas(obj))return;
    seen.push(obj);
    var ks=[];try{ks=Object.keys(obj);}catch(e){return;}
    if(ks.indexOf('attributeVendorItemMap')>=0&&ks.indexOf('optionRows')>=0&&Array.isArray(obj.optionRows)&&obj.attributeVendorItemMap){
      out.push({path:path,obj:obj});
      return;
    }
    for(var i=0;i<ks.length;i++){
      var k=ks[i];
      if(k==='return'||k==='child'||k==='sibling'||k==='stateNode'||k==='alternate'||k==='ownerDocument')continue;
      try{scan(obj[k],path+'.'+k,depth+1);}catch(e){}
      if(out.length>=3)return;
    }
  }
  var els=QA('*');
  for(var ei=0;ei<els.length;ei++){
    var el=els[ei];
    for(var k in el){
      if(k.indexOf('__reactFiber$')===0||k.indexOf('__reactProps$')===0){
        try{scan(el[k],'el['+ei+'].'+k,0);}catch(e){}
        if(out.length)return out[0];
      }
    }
  }
  return null;
}
function findUnifiedOptionModel(){
  var text=gmOptionBigText();
  if(text&&text.indexOf('optionRows')>=0&&text.indexOf('attributeVendorItemMap')>=0){
    var optionRowsJson=cutJsonAfter(text,'"optionRows":')||cutJsonAfter(text,'optionRows:');
    var attrMapJson=cutJsonAfter(text,'"attributeVendorItemMap":')||cutJsonAfter(text,'attributeVendorItemMap:');
    if(optionRowsJson&&attrMapJson){
      try{
        var optionRows=JSON.parse(optionRowsJson), attrMap=JSON.parse(attrMapJson);
        if(Array.isArray(optionRows)&&attrMap)return {optionRows:optionRows,attrMap:attrMap,modelSource:'script.attributeVendorItemMap'};
      }catch(e){log('ATTRMAP_SCRIPT_PARSE_FAIL '+(e&&e.message||e));}
    }
  }
  var hit=findReactOptionModel();
  if(hit&&hit.obj)return {optionRows:hit.obj.optionRows||[],attrMap:hit.obj.attributeVendorItemMap||{},modelSource:'react.attributeVendorItemMap',reactPath:hit.path};
  return null;
}

function collectUnifiedScriptOptionRows(){
  var model=findUnifiedOptionModel();
  if(!model||!Array.isArray(model.optionRows)||!model.attrMap)return [];
  var optionRows=model.optionRows, attrMap=model.attrMap;
  var attrs=flattenOptionAttrs(optionRows);
  var pid=pageIds().productId;
  var keys=Object.keys(attrMap||{});
  var rows=[];
  var optionShipRows=collectOptionRowShippingRows();
  var reactOptionMeta=findReactOptionTableMeta();
  var optionDepth=optionRows.length;
  var expectedCount=optionExpectedCount(optionRows);
  var groupNamesAll=(optionRows||[]).map(function(r,i){return C(r&& (r.name||r.displayName||r.title||r.label))||('group'+i);});
  var groupSizes=(optionRows||[]).map(function(r){return (r&&Array.isArray(r.attributes))?r.attributes.length:0;});
  var attrByValue={};
  attrs.forEach(function(a){if(a&&a.valueId)attrByValue[C(a.valueId)]=a;});
  function comboVector(mapKey){
    var vec=[];
    for(var gi=0;gi<optionDepth;gi++)vec[gi]=9999;
    String(mapKey||'').split(':').map(C).filter(Boolean).forEach(function(part){
      var a=attrByValue[part];
      if(a)vec[a.rowIndex]=a.attrIndex;
    });
    return vec;
  }
  function comboNames(mapKey){
    var namesByGroup=[], groupNamesByGroup=[];
    String(mapKey||'').split(':').map(C).filter(Boolean).forEach(function(part){
      var a=attrByValue[part];
      if(a){namesByGroup[a.rowIndex]=a.name; groupNamesByGroup[a.rowIndex]=a.groupName;}
    });
    return {
      names:namesByGroup.filter(Boolean),
      groupNames:groupNamesByGroup.filter(Boolean),
      sortKey:comboVector(mapKey).join('-')
    };
  }
  keys.sort(function(a,b){
    var av=comboVector(a), bv=comboVector(b);
    var len=Math.max(av.length,bv.length);
    for(var i=0;i<len;i++){
      var ai=(av[i]==null?9999:av[i]), bi=(bv[i]==null?9999:bv[i]);
      if(ai!==bi)return ai-bi;
    }
    return 0;
  });

  keys.forEach(function(mapKey,index){
    var inv=attrMap[mapKey]||{};
    var cn=comboNames(mapKey);
    var names=cn.names, groupNames=cn.groupNames;
    var itemId=GMID(inv.itemId||inv.vendorItemIdAttributesItemId||'');
    var vendorItemId=GMID(inv.vendorItemId||'');
    if(!itemId||!vendorItemId)return;
    var name=C(names.join(' × '))||C(inv.itemName||inv.itemTitle||inv.title||'');
    if(!name||badOptionValue(name))return;
    var reactMeta=reactOptionMeta&&vendorItemId?reactOptionMeta[vendorItemId]:null;
    var attrDirect=attrMapPrice(inv);
    var reactDirect=reactMeta&&reactMeta.price?reactMeta.price:'';
    var reactShipType=reactMeta?shipTypeFromBadge(reactMeta.deliveryTypeRaw||reactMeta.shipType||''):'';
    /* V024: listVendorItemPrice는 '배송비 포함' 옵션표 가격일 수 있다.
       판매자배송/배송타입 빈값에서는 apiUrlMap.price(상품가)를 우선해야 한다.
       예: 1개 3,490원=990+배송비2,500 이므로 옵션 상품가는 990원. */
    /* V026: 가격은 모든옵션보기 클릭 전 attributeVendorItemMap/apiUrlMap 가격을 기준으로 고정한다.
       listVendorItemPrice / popup row 가격은 배송비 포함가 또는 화면 표시가가 섞이므로
       attrDirect가 없을 때만 보조로 사용한다. */
    var useReactPrice=!!(reactDirect && !attrDirect);
    var direct=attrDirect||reactDirect;
    var sourceKey=attrDirect?attrMapPriceSource(inv):(useReactPrice?'react.listVendorItemPrice':'');
    var found=direct?{price:direct,key:sourceKey||'attributeVendorItemMap.price'}:exactPriceByVendorItemId(vendorItemId);
    var price=found.price||'';
    var row=makeRowBase(name,price,{productId:pid,itemId:itemId,vendorItemId:vendorItemId},'attributeVendorItemMapRows',index);
    var discountFields=gmCoupangDiscountFieldsFromObject(inv);
    row.wowPrices=discountFields.wowPrices;
    row.cardPrices=discountFields.cardPrices;
    gmApplyCoupangMallDiscount(row,row.mall_sale_price||row.sell_price||0);
    if(reactMeta){
      var rt=shipTypeFromBadge(reactMeta.deliveryTypeRaw||reactMeta.shipType||'');
      var rb=shipLabelFromType(rt)||reactMeta.shippingBadge||'';
      if(rb){
        row.optionShippingBadge=rb;
        row.shippingBadge=rb;
        row.deliveryBadge=rb;
        row.optionShipType=rt;
        row.shipType=rt;
        row.deliveryType=rt;
        row.shippingType=rt;
        row.optionShippingType=rt;
        row.reactDeliveryType=reactMeta.deliveryTypeRaw||'';
        row.optionShippingSource='react.listDeliveryType';
      }
      if(reactMeta.qty)row.reactOptionQty=reactMeta.qty;
      if(reactMeta.unitPrice)row.reactUnitPrice=reactMeta.unitPrice;
      if(reactMeta.optionKey)row.reactOptionKey=reactMeta.optionKey;
    }
    if(!row.optionShippingBadge){
      var attrShip=attrMapShipMeta(inv);
      if(attrShip&&attrShip.shipType){
        var ab=attrShip.shippingBadge||shipLabelFromType(attrShip.shipType);
        row.optionShippingBadge=ab;
        row.shippingBadge=ab;
        row.deliveryBadge=ab;
        row.optionShipType=attrShip.shipType;
        row.shipType=attrShip.shipType;
        row.deliveryType=attrShip.shipType;
        row.shippingType=attrShip.shipType;
        row.optionShippingType=attrShip.shipType;
        row.reactDeliveryType=attrShip.deliveryTypeRaw||'';
        row.optionShippingSource='attributeVendorItemMap.'+(attrShip.source||'delivery');
      }
    }
    var sh=null;
    /* V014: 기본 화면 옵션 배송행(OPTION_SHIP_ROWS)은 React/attr 배송보다 우선한다.
       가격은 Glomart 보정가와 쿠팡 원가가 달라질 수 있으므로, 옵션명이 유일하면 옵션명으로 매칭한다.
       예: 1개는 화면상 판매자배송인데 URL/base가 bundle이면 묶음배송으로 오염되던 문제 방지. */
    if(optionShipRows.length===keys.length)sh=optionShipRows[index];
    else if(optionShipRows.length){
      var exactNameMatches=optionShipRows.filter(function(x){return C(x.name) && C(x.name)===name;});
      var looseNameMatches=optionShipRows.filter(function(x){return C(x.name) && (name.indexOf(C(x.name))>=0||C(x.name).indexOf(name)>=0);});
      var priceNameMatches=optionShipRows.filter(function(x){return (!price||!x.price||N(x.price)===N(price)) && (!x.name||name.indexOf(x.name)>=0||x.name.indexOf(name)>=0);});
      sh=(exactNameMatches.length===1?exactNameMatches[0]:null) ||
         (priceNameMatches.length?priceNameMatches[0]:null) ||
         (looseNameMatches.length===1?looseNameMatches[0]:null) || null;
    }
    if(sh){
      var shType=shipTypeFromBadge(sh.shipType||sh.badge||'')||(sh.name||sh.price||sh.fee?'seller':'');
      var shBadge=(shType==='fresh'||shType==='bundle')?(shipLabelFromType(shType)||sh.badge||''):'';
      row.optionShippingBadge=shBadge;
      row.shippingBadge=shBadge;
      row.deliveryBadge=shBadge;
      row.optionShipType=shType;
      row.shipType=shType;
      row.deliveryType=(shType==='fresh'||shType==='bundle')?shBadge:'';
      row.shippingType=shType;
      row.optionShippingType=shType;
      row.optionShippingFeeText=sh.fee||'';row.optionShippingName=sh.name||'';row.optionShippingPrice=sh.price||'';
      row.optionShippingSource='dom.optionShipRows.override';
    }
    row.mapKey=mapKey;
    row.groupNames=groupNames.join(' × ')||groupNamesAll.join(' × ');
    row.optionGroupNames=groupNamesAll.join(' × ');
    row.optionGroupSizes=groupSizes.join(' × ');
    row.optionDepth=optionDepth;
    row.optionGroupCount=optionDepth;
    row.optionCombinationCount=keys.length;
    row.expectedCombinationCount=expectedCount;
    row.optionType='attributeVendorItemMap';
    row.optionSortKey=cn.sortKey||'';
    row.priceSource=found.key||'';
    row.priceFound=!!price;
    row.modelSource=model.modelSource||'';
    if(model.reactPath)row.modelPath=model.reactPath;
    row.soldout=!!(inv.soldOut||inv.soldout||inv.outOfStock);
    row.gmOrderable=!!(pid&&itemId&&vendorItemId);
    rows.push(row);
  });
  rows=uniqueRows(rows);
  rows=applyOptionShipInheritance(rows,optionShipRows);
  log('ATTRMAP_ORDER_SAMPLE '+rows.slice(0,8).map(function(r){return C(r.name||r.value)+'='+C(r.priceText||r.price);}).join('|'));
  log('ATTRMAP_OPTION_ROWS depth='+optionDepth+' groups='+groupSizes.join('x')+' expected='+expectedCount+' actual='+keys.length+' rows='+rows.length+' priced='+rows.filter(function(r){return !!(r.priceText||r.price);}).length+' source='+(model.modelSource||''));
  return rows;
}

function cleanNameForPopup(t){
  return C(t)
    .replace(/옵션\s*선택/g,' ')
    .replace(/선택됨|selected\s*:\s*(true|false)/ig,' ')
    .replace(/([1-9]\d{0,2}(?:,\d{3})+|[1-9]\d{3,8})\s*원/g,' ')
    .replace(/\(?\s*(?:100g|10g|1개|kg|g|ml|mL|L)\s*당\s*[\d,]+\s*원\s*\)?/ig,' ')
    .replace(/무료배송|판매자배송|로켓배송|로켓프레시/g,' ')
    .replace(/오늘|내일|모레|[월화수목금토일]요일|도착|예정/g,' ')
    .replace(/품절임박.*$/g,' ')
    .replace(/할인/g,' ')
    .replace(/\s+/g,' ')
    .trim();
}
function scoreRowText(t){
  t=C(t);
  var s=0;
  if(/[1-9]\d{0,2}(?:,\d{3})+\s*원|[1-9]\d{3,8}\s*원/.test(t)) s+=3;
  if(/×|x|X|\d+\s*(g|kg|개|마리|팩|세트|GB|TB|mm|cm|호|M|L|XL|XXL)/i.test(t)) s+=2;
  if(/무료배송|판매자배송|로켓|도착|품절|할인/.test(t)) s+=1;
  if(t.length>=2&&t.length<=160) s+=1;
  return s;
}
function rowFromEl(el,source){
  var txt=C(el&&(el.innerText||el.textContent||''));
  if(!txt) return null;
  if(/옵션\s*선택$|닫기|장바구니|바로구매|구매하기/i.test(txt)) return null;
  var name=cleanNameForPopup(txt);
  if(!name||name.length>120) return null;
  return {
    name:name,
    price:priceFromText(txt),
    deliveryText:((txt.match(/무료배송|판매자배송|로켓배송|로켓프레시|[월화수목금토일]요일[^\n]{0,30}도착[^\n]{0,30}/g)||[]).join(' · ')),
    soldoutText:((txt.match(/품절임박[^\n]{0,20}|일시품절|품절/g)||[]).join(' · ')),
    text:txt,
    cls:String(el&&el.className||''),
    source:source||''
  };
}
function extractDomRows(expectedCount){
  /* 옵션 row가 부모/자식 2중으로 잡혀 절반만 맞춰지는 문제 방지.
   * 원칙: 한 그룹 안에서 같은 옵션을 대표하는 반복 row만 고른다.
   * li/button/a/[class*=row/item/opt] 전체 혼합 금지.
   */
  function rowKey(row){return (C(row.name).replace(/\s+/g,'').toLowerCase()+'|'+C(row.price));}
  function addGroup(groups,label,nodes){
    var rows=[],seen={};
    (nodes||[]).filter(function(el){return visible(el);}).forEach(function(el){
      var txt=C(el.innerText||el.textContent||'');
      if(scoreRowText(txt)<3) return;
      var row=rowFromEl(el,label+' '+String(el.className||''));
      if(!row) return;
      var k=rowKey(row);
      if(seen[k]) return;
      seen[k]=1;
      rows.push(row);
    });
    if(rows.length){
      groups.push({
        label:label,
        count:rows.length,
        diff:Math.abs(rows.length-(expectedCount||0)),
        score:rows.reduce(function(a,r){return a+scoreRowText(r.text);},0),
        rows:rows
      });
    }
  }
  var groups=[];

  /* 1순위: 팝업/본문 option-table의 실제 반복 row 클래스만 직접 수집 */
  addGroup(groups,'option-table-list__option',QA('[class*="option-table-list__option"]'));
  addGroup(groups,'option-table_popup_option-row',QA('[class*="option-table_popup_option-row"], [class*="option-table__popup__option-row"]'));
  addGroup(groups,'option-table_popup_option-item',QA('[class*="option-table_popup_option-item"], [class*="option-table__popup__option-item"]'));
  addGroup(groups,'option-table-v2-li',QA('[class*="option-table-v2"] li'));

  /* 2순위: 패션/버튼형은 직계 버튼/라벨만. 내부 span/div까지 혼합하지 않는다. */
  addGroup(groups,'fashion-option-label-item',QA('[class*="fashion-option_label-item"], [class*="fashion-option-label-item"]'));
  addGroup(groups,'fashion-option-button-li',QA('[class*="fashion-option_button-list"] li, [class*="fashion-option-button-list"] li'));
  addGroup(groups,'fashion-option-select',QA('[class*="fashion-option-select"]'));

  /* 3순위: 컨테이너별 직계 자식만. 기존처럼 모든 descendants를 섞지 않는다. */
  QA('[class*="option-table"], [class*="option-list"], [class*="option-picker"], [class*="fashion-option"]').filter(function(el){return visible(el);}).forEach(function(box,bi){
    var direct=[];
    try{direct=Array.prototype.slice.call(box.children||[]);}catch(e){direct=[];}
    direct=direct.filter(function(el){
      var tag=(el.tagName||'').toLowerCase();
      var cls=String(el.className||'');
      if(/price|container|aside|title|header|body|close|mask|content|selected/i.test(cls)) return false;
      return /^(li|button|a|div|section)$/i.test(tag) || /row|item|opt|option/i.test(cls);
    });
    addGroup(groups,'directChildren#'+bi,direct);
  });

  /* 후보 선택: expectedCount와 같은 그룹을 우선, 2배/절반으로 중첩된 그룹은 배제 */
  groups=groups.filter(function(g){
    if(!expectedCount) return true;
    if(g.count===expectedCount) return true;
    /* 정확히 2배는 부모/자식 중첩 가능성이 높으므로 같은 개수 후보가 있으면 후순위 */
    return true;
  });
  groups.sort(function(a,b){
    var exactA=(expectedCount&&a.count===expectedCount)?0:1;
    var exactB=(expectedCount&&b.count===expectedCount)?0:1;
    return (exactA-exactB)||(a.diff-b.diff)||(b.score-a.score);
  });
  log('POPUP_DOM_GROUPS '+groups.map(function(g){return 'label='+g.label+' count='+g.count+' diff='+g.diff+' score='+g.score;}).join(' || '));
  return groups[0]?groups[0].rows:[];
}



/* OPTION FLOW STEP 2
 * 옵션 UI 타입 분기 위치.
 * A: 모든옵션보기 팝업형 - 버튼 클릭 후 popup extractor 실행
 * B: 드롭다운형 옵션보기 - 버튼/셀렉트 클릭 후 dropdown/popup extractor 실행
 * C: 이미 펼쳐진 옵션형 - A/B가 없을 때만 expanded extractor 실행
 * D: 추후 신규 타입은 반드시 여기에서만 추가한다.
 */
function clickLike(el){
  if(!el)return false;
  var target=el;
  try{
    if(!(target.matches&&target.matches('button,a,[role="button"],select'))){
      var child=Array.prototype.slice.call(target.querySelectorAll&&target.querySelectorAll('button,a,[role="button"],select')||[]).filter(function(c){return /모든\s*옵션\s*보기|전체\s*옵션|옵션\s*전체|옵션\s*더보기|옵션을\s*선택|옵션\s*선택|선택하세요/i.test(optionOpenButtonText(c));})[0];
      if(child)target=child;
    }
  }catch(e){}
  // V038: CPKR 상세에서 스크롤은 모든옵션보기/드롭다운 버튼 클릭 직전 1회만 수행한다.
  try{target.scrollIntoView({block:'center',inline:'center'});}catch(e){}
  try{target.focus&&target.focus();}catch(e){}
  try{
    ['pointerdown','mousedown','touchstart','pointerup','mouseup','touchend'].forEach(function(type){
      try{target.dispatchEvent(new Event(type,{bubbles:true,cancelable:true}));}catch(e){}
    });
  }catch(e){}
  try{target.click();return true;}catch(e){}
  try{target.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window}));return true;}catch(e){}
  return false;
}
function optionOpenButtonText(el){
  return C((el&&el.getAttribute&&((el.getAttribute('aria-label')||'')+' '+(el.getAttribute('title')||'')+' '+(el.getAttribute('value')||'')))+' '+T(el));
}
function findOptionOpenButton(kind){
  /* V023: querySelector 순서상 option-table 큰 컨테이너가 먼저 잡히면 click이 무효가 된다.
   * 텍스트가 “모든 옵션 보기”인 실제 button/a/[role=button] 또는 가장 작은 텍스트 부모를 우선한다.
   */
  var reAll=/(모든\s*옵션\s*보기|전체\s*옵션|옵션\s*전체|옵션\s*더보기)/i;
  var reDrop=/(옵션을\s*선택|옵션\s*선택|선택하세요|선택\s*옵션|드롭다운)/i;
  var re=(kind==='all')?reAll:reDrop;
  var bad=/장바구니|바로구매|구매하기|관심상품|찜하기|공유|리뷰|문의|검색|신고하기|앱\s*열기/i;
  var cand=[];
  function add(el,src){
    if(!el||cand.some(function(x){return x.el===el;}))return;
    var tx=optionOpenButtonText(el);
    if(!tx||bad.test(tx))return;
    if(kind==='dropdown' && (el.tagName||'').toLowerCase()==='select'){
      cand.push({el:el,tx:tx,src:src||'select'});return;
    }
    if(!re.test(tx))return;
    cand.push({el:el,tx:tx,src:src||''});
  }
  QA('button,a,[role="button"],select').forEach(function(el){add(el,'clickable');});
  QA('[class*="see"],[class*="all"],[class*="more"],[class*="option"],[class*="select"] ,div,span').forEach(function(el){add(el,'text');});
  try{
    var tw=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT,{acceptNode:function(n){return re.test(C(n.nodeValue||''))?NodeFilter.FILTER_ACCEPT:NodeFilter.FILTER_SKIP;}});
    var n,limit=0;
    while((n=tw.nextNode())&&limit++<20){
      var p=n.parentElement;
      var click=null;
      for(var d=0;p&&d<6;d++,p=p.parentElement){
        if(p.matches&&p.matches('button,a,[role="button"],select')){click=p;break;}
      }
      add(click||n.parentElement,'textNode');
    }
  }catch(e){}
  if(!cand.length)return null;
  cand.forEach(function(c){
    var el=c.el,tx=C(c.tx),tag=(el.tagName||'').toLowerCase(),role=C(el.getAttribute&&el.getAttribute('role')||'');
    var prices=(tx.match(/\d{1,3}(?:,\d{3})+\s*원/g)||[]).length;
    var exact=(kind==='all'?/^(모든\s*옵션\s*보기|전체\s*옵션|옵션\s*전체|옵션\s*더보기)\s*[>›»]?$/i:/^(옵션을\s*선택|옵션\s*선택|선택하세요|선택\s*옵션|드롭다운)/i).test(tx);
    var rect={width:999999,height:999999}; try{rect=el.getBoundingClientRect();}catch(e){}
    c.score=0;
    if(tag==='button'||tag==='a'||role==='button')c.score+=300;
    if(c.src==='textNode')c.score+=120;
    if(exact)c.score+=220;
    if(tx.length<=60)c.score+=80;
    if(/보기\s*[>›»]?$/.test(tx))c.score+=40;
    c.score-=Math.min(250,prices*45);
    c.score-=Math.min(180,Math.floor(tx.length/20));
    c.score-=Math.min(80,Math.floor(((rect.width||0)*(rect.height||0))/50000));
  });
  cand.sort(function(a,b){return b.score-a.score;});
  try{log('OPTION_OPEN_BUTTON_CAND kind='+kind+' pickScore='+cand[0].score+' pickText='+C(cand[0].tx).slice(0,100)+' all='+cand.slice(0,5).map(function(c){return '['+c.score+']'+C(c.tx).slice(0,50);}).join(' || '));}catch(e){}
  return cand[0].el;
}
function countPopupCandidateRows(expectedCount){
  /* V014: wait 기준도 실제 배송 보강 수집기와 동일 selector를 사용한다.
     구형 extractDomRows(option-table-list__option)만 보며 popupShipRows를 놓치는 문제 방지. */
  var shipRows=[];
  try{shipRows=collectPopupOptionShipRows()||[];}catch(e){shipRows=[];}
  if(shipRows.length)return shipRows.length;
  var rows=extractDomRows(expectedCount||0)||[];
  return rows.length;
}
async function openOptionUiByBranch(uidCount){
  var btnAll=findOptionOpenButton('all');
  if(btnAll){
    var before=countPopupCandidateRows(0);
    var ok=clickLike(btnAll);
    log('OPTION_BRANCH type=ALL_OPTIONS clicked='+(ok?'Y':'N')+' beforeRows='+before+' buttonText='+optionOpenButtonText(btnAll).slice(0,120));
    /* V057: 모든옵션보기 팝업형은 React/ATTR 예상 개수(uidCount)를 기준으로 조기 종료하지 않는다.
     * 실제 화면에 생성된 .option-table__popup__option-item 개수가 안정화된 뒤 수집한다.
     * 이유: scriptRows/compareRows 개수가 4개 등으로 잘못 잡히면 팝업 7개 중 일부만 열린 순간 진행되어 가격이 섞인다.
     */
    var last=-1, stable=0, best=0;
    for(var i=0;i<10;i++){
      await sleep(i===0?180:220);
      var c=countPopupCandidateRows(0);
      if(c>best)best=c;
      stable=(c>0 && c===last)?(stable+1):0;
      last=c;
      log('OPTION_BRANCH_SAFE_WAIT type=ALL_OPTIONS try='+(i+1)+' rows='+c+' before='+before+' expected=popupDomStable stable='+stable);
      if(c>0 && stable>=2)return {type:'allOptions',clicked:true,rows:c,stable:true};
    }
    return {type:'allOptions',clicked:true,rows:countPopupCandidateRows(0)||best,notReady:!(best>0)};
  }
  var btnDrop=findOptionOpenButton('dropdown');
  if(btnDrop){
    var dbefore=countPopupCandidateRows(uidCount);
    var dok=clickLike(btnDrop);
    log('OPTION_BRANCH type=DROPDOWN clicked='+(dok?'Y':'N')+' beforeRows='+dbefore+' buttonText='+optionOpenButtonText(btnDrop).slice(0,120));
    for(var j=0;j<6;j++){
      await sleep(j===0?120:160);
      var dc=countPopupCandidateRows(uidCount);
      log('OPTION_BRANCH_SAFE_WAIT type=DROPDOWN try='+(j+1)+' rows='+dc+' before='+dbefore+' expected='+uidCount);
      if(uidCount>0 && dc>=uidCount)return {type:'dropdown',clicked:true,rows:dc};
      if(!uidCount && dc>0)return {type:'dropdown',clicked:true,rows:dc};
    }
    return {type:'dropdown',clicked:true,rows:countPopupCandidateRows(uidCount),notReady:true};
  }
  log('OPTION_BRANCH type=EXPANDED no_open_button');
  return {type:'expanded',clicked:false,rows:countPopupCandidateRows(uidCount)};
}


/* V016: 모든옵션보기 팝업 DOM을 최종 수집 원본으로 사용한다.
 * scriptRows는 조합 수 검증 로그 및 popup row ID 보조에만 사용한다. */
function collectPopupOptionShipRows(strictPopupOnly){
  /* V022: 모든옵션보기 popup/list의 실제 표시 row를 배송 확정 소스로 사용한다.
   * - .option-table__popup__option-item / .option-table-list__option 만 읽는다.
   * - 광고/절약 안내 row는 제외한다.
   * - 현재 선택 row와 popup list row가 중복될 수 있으므로 optionName+price 기준으로 dedupe한다.
   * - vendorItemId는 popup DOM에 없을 수 있으므로 여기서는 배송/배송비/품절 보강 전용 row를 만든다.
   * - 최종 ID는 attributeVendorItemMap rows와 merge할 때 붙는다.
   */
  function txt(el){try{return C((el&&el.innerText)||el&&el.textContent||'');}catch(e){return '';}}
  function norm(t){return C(t).replace(/\s+/g,' ').trim();}
  function digitsOnly(v){return C(v).replace(/[^0-9]/g,'');}
  function rowText(row){return norm(txt(row));}
  function textOf(row,sel){try{var el=Q(sel,row);return norm(txt(el));}catch(e){return '';}}
  function titleFromText(t){
    t=norm(t);
    var m=t.match(/^(\d+\s*개|\d+\s*박스|\d+\s*세트|1\s*박스|1\s*세트)(?=\s|$)/);
    if(m)return C(m[1]).replace(/\s+/g,'');
    m=t.match(/(?:^|\s)(\d+\s*개|\d+\s*박스|\d+\s*세트|1\s*박스|1\s*세트)(?=\s|$)/);
    if(m)return C(m[1]).replace(/\s+/g,'');
    return '';
  }
  function priceFromText(t){
    t=norm(t);
    var m=t.match(/(\d{1,3}(?:,\d{3})+|\d{3,9})\s*원/);
    return m?formatWon(m[1]):'';
  }
  function rowTitle(row){
    return C(textOf(row,'.option-table__popup__option-title') ||
      textOf(row,'.option-table-list__option-name') ||
      textOf(row,'[class*="popup__option-title"]') ||
      textOf(row,'[class*="popup_option-title"]') ||
      textOf(row,'[class*="option-title"]') ||
      textOf(row,'[class*="option-name"]') ||
      titleFromText(rowText(row)));
  }
  function rowPrice(row){
    return C(textOf(row,'.option-table__popup__option-price') ||
      textOf(row,'.option-table-list__option-price span') ||
      textOf(row,'.option-table-list__option-price') ||
      textOf(row,'[class*="popup__option-price"]') ||
      textOf(row,'[class*="popup_option-price"]') ||
      textOf(row,'[class*="option-price"]') ||
      priceFromText(rowText(row)));
  }
  function rowUnitPrice(row){return C(textOf(row,'.option-table__popup__option-unit-price')||textOf(row,'.option-table-list__option-unit-price')||textOf(row,'[class*="unit-price"]'));}
  function rowPriceLabel(row){return C(textOf(row,'.option-table__popup__option-price-label')||textOf(row,'.option-table-list__option-price-label')||textOf(row,'[class*="price-label"]'));}
  function rowDeliveryText(row,t){
    var v=C(textOf(row,'.option-table__popup__option-pdd')||textOf(row,'.option-table__popup__option-delivery-description')||textOf(row,'.option-table-list__option-pdd')||textOf(row,'.option-table-list__option-delivery-description')||textOf(row,'[class*="option-pdd"]')||textOf(row,'[class*="delivery-description"]'));
    if(v)return v;
    var m=norm(t).match(/(?:오늘|내일|모레|[월화수목금토일]요일|\d{1,2}\/\d{1,2})[^\n]{0,80}도착[^\n]{0,80}/);
    return m?C(m[0]):'';
  }
  function rowFeeText(t){
    t=norm(t);
    var m=t.match(/(?:\d{1,3}(?:,\d{3})+|\d{3,9})\s*원\s*이상\s*무료배송/);
    if(m)return C(m[0]);
    m=t.match(/배송비\s*(?:\d{1,3}(?:,\d{3})+|\d{3,9})\s*원|(?:\d{1,3}(?:,\d{3})+|\d{3,9})\s*원\s*배송비/);
    if(m)return C(m[0]);
    if(/배송비\s*포함됨|배송비\s*포함/i.test(t))return '배송비 포함됨';
    if(/무료배송/.test(t))return '무료배송';
    return '';
  }
  function rowStock(row,t){return C(textOf(row,'.option-table__popup__option-stock-label')||textOf(row,'.option-table-list__option-stock-label')||textOf(row,'[class*="stock-label"]')||((C(t).match(/품절\s*임박[^\n]{0,40}|품절임박[^\n]{0,40}|\d+\s*개\s*남음|일시\s*품절|품절/g)||[]).join(' ')));}
  function shipFromText(t,rootBadge){
    t=norm((rootBadge||'')+' '+(t||''));
    if(/판매자로켓|판매자배송|\(판매자배송\)|ROCKET_MERCHANT|rocket[_-]?merchant|merchant_xlarge|seller/i.test(t))return 'seller';
    if(/FALCON_FRESH|RDS_LOGO_FRESH|ROCKET_FRESH|rocket[_-]?fresh|로켓\s*프레시|로켓프레시|fresh|신선/i.test(t))return 'fresh';
    if(/RDS_LOGO_ROCKET|ROCKET|TOMORROW|로켓|묶음배송|쿠팡\s*배송|내일/i.test(t))return 'bundle';
    return '';
  }
  function isAdRow(t){
    t=norm(t);
    return /사면\s*[\d,]+원\s*절약|절약\s*금액\s*기준/.test(t) && !/(도착|로켓|판매자배송|무료배송|배송비)/.test(t);
  }
  /* V058: 모든옵션보기 팝업형은 열린 popup 컨테이너 내부 row만 수집한다.
   * document 전체에서 option-table-list__option까지 함께 긁으면 접힌 기본 row(예: "1개")나
   * 기존 리스트/숨은 row가 섞여 실제 팝업과 다른 옵션이 생성된다.
   */
  function popupRootOf(el){
    try{return el&&el.closest&&el.closest('.option-table__popup.option-table__popup--visible');}catch(e){return null;}
  }
  /* V021: 콘솔에서 검증된 쿠팡 실제 popup 구조를 그대로 사용한다.
   * popup body 안의 아래쪽 옵션은 화면 viewport 밖에 있어도 DOM에는 이미 렌더링되어 있으므로
   * getBoundingClientRect 기반 viewport 필터를 절대 적용하지 않는다. */
  var popupRoot=Q('.option-table__popup.option-table__popup--visible');
  var popupRaw=popupRoot?QA('.option-table__popup__option-item',popupRoot).filter(function(el){return !!el;}):[];
  var listRaw=QA('.option-table-list__option, [class*="option-table-list__option"]')
    .filter(function(el){return el&&visible(el);});
  var raw=strictPopupOnly?popupRaw:(popupRaw.length?popupRaw:listRaw);
  var cand=[], seenEl=[];
  raw.forEach(function(el){
    if(!el||seenEl.indexOf(el)>=0)return;
    if(!visible(el))return;
    seenEl.push(el); cand.push(el);
  });
  var popupCnt=popupRaw.length;
  var listCnt=listRaw.length;
  log('POPUP_SHIP_CANDIDATES count='+cand.length+' popup='+popupCnt+' list='+listCnt+' source='+(strictPopupOnly?'strictPopupOnly':(popupRaw.length?'popupOnly':'listFallback')));

  var all=[];
  cand.forEach(function(row,i){
    var text=rowText(row), option=rowTitle(row), price=rowPrice(row);
    if(!option||!price)return;
    var st=null; try{st=getComputedStyle(row);}catch(e){}
    if(row.hasAttribute&&row.hasAttribute('disabled'))return;
    if(row.getAttribute&&row.getAttribute('aria-disabled')==='true')return;
    if(st&&st.pointerEvents==='none')return;
    var rootBadge=badgeFromRoot(row);
    var deliveryText=rowDeliveryText(row,text), fee=rowFeeText(text), stock=rowStock(row,text);
    var badgeIds=QA('[data-badge-id]',row).map(function(el){return C(el.getAttribute('data-badge-id')||'');}).filter(Boolean);
    var imgBadges=QA('img',row).map(function(img){return C((img.getAttribute('data-badge-id')||'')+' '+(img.getAttribute('alt')||'')+' '+(img.getAttribute('src')||''));}).filter(Boolean);
    var evidence=badgeIds.join('|')+' '+imgBadges.join('|')+' '+rootBadge+' '+text;
    var shipType=shipFromText(evidence,rootBadge);
    if(!shipType && option && price)shipType='seller';
    all.push({
      name:option, option:option, price:price, priceText:price, unitPrice:rowUnitPrice(row), priceLabel:rowPriceLabel(row),
      vendorItemId:'',
      deliveryText:deliveryText, stockText:stockTextFromOption(stock)||stock, soldoutText:stock,
      soldout:hardSoldoutText(stock||text), disabled:false,
      badgeIds:badgeIds, optionShipType:shipType, shipType:shipType,
      optionShippingBadge:(shipType==='fresh'||shipType==='bundle')?shipLabelFromType(shipType):'',
      shippingBadge:(shipType==='fresh'||shipType==='bundle')?shipLabelFromType(shipType):'',
      deliveryBadge:(shipType==='fresh'||shipType==='bundle')?shipLabelFromType(shipType):'',
      optionShippingFeeText:fee, shippingFeeText:fee, deliveryFeeText:fee,
      shippingFeeIncluded:/배송비\s*포함됨|배송비\s*포함/i.test(text),
      optionShippingSource:'popupDom.optionRows', selected:String(row.className||'').indexOf('--selected')>=0,
      source:'popupDomOptionRows', domIndex:i, rowClass:String(row.className||''), isAd:isAdRow(text),
      badgeEvidence:C(evidence).slice(0,260), rawText:text
    });
  });

  var hasFullOptionName=all.some(function(r){return r&&!r.isAd&&/[×xX*]/.test(C(r.name))&&digitsOnly(r.price);});
  var byKey={}, out=[];
  all.forEach(function(r){
    if(!r||r.isAd)return;
    var nm=C(r.name);
    if(hasFullOptionName && /^\d+\s*(?:개|박스|세트)$/.test(nm)){r.isDefaultShortRow=true;return;}
    var k=C(r.name).replace(/\s+/g,'').toLowerCase()+'|'+digitsOnly(r.price);
    if(!k||k==='|')return;
    var old=byKey[k];
    var score=function(x){return (x.shipType?100:0)+(x.optionShippingFeeText?40:0)+(x.deliveryText?25:0)+(x.stockText?10:0)+(x.selected?1:0);};
    if(!old||score(r)>score(old))byKey[k]=r;
  });
  Object.keys(byKey).forEach(function(k){out.push(byKey[k]);});
  out.sort(function(a,b){return (parseInt(C(a.name),10)||999999)-(parseInt(C(b.name),10)||999999);});
  log('POPUP_SHIP_ROWS raw='+all.length+' optionRows='+out.length+' sample='+out.slice(0,20).map(function(r){return C(r.name)+'|'+C(r.price)+'|'+C(r.shipType)+'|fee='+C(r.optionShippingFeeText)+'|'+C(r.deliveryText);}).join(' / '));
  try{out.slice(0,30).forEach(function(r,i){log('POPUP_SHIP_ROW['+i+'] name='+C(r.name)+' price='+C(r.price)+' ship='+C(r.shipType)+' fee='+C(r.optionShippingFeeText)+' badge='+C(r.optionShippingBadge)+' raw='+C(r.rawText).slice(0,200));});}catch(e){}
  return out;
}


function collectDropdownOptionShipRows(){
  /* V037: 드롭다운형 옵션은 모든옵션보기 팝업이 없어도 option-picker DOM 안에
   * 옵션명/가격/도착일/(판매자배송) 텍스트가 이미 들어온다. 클릭/순회 없이 이 텍스트를 배송 보강 row로 사용한다.
   */
  function norm(t){return C(t).replace(/\s+/g,' ').trim();}
  function priceFromText(t){var m=norm(t).match(/(\d{1,3}(?:,\d{3})+|\d{3,9})\s*원/);return m?formatWon(m[1]):'';}
  function shipFromText(t){
    t=norm(t);
    if(/로켓\s*프레시|로켓프레시|ROCKET_FRESH|fresh|신선/i.test(t))return 'fresh';
    if(/묶음배송|로켓배송|로켓\s*그로스|쿠팡\s*배송|ROCKET|WOW/i.test(t))return 'bundle';
    if(/판매자배송|\(판매자배송\)|seller|merchant/i.test(t))return 'seller';
    return '';
  }
  function deliveryFromText(t){var m=norm(t).match(/(?:오늘|내일|모레|[월화수목금토일]요일|\d{1,2}\/\d{1,2})[^\n]{0,80}도착[^\n]{0,80}/);return m?C(m[0]):'';}
  function feeFromRowText(t){var f=feeFromShippingText(t); return N(f)>0?f:'';}
  var root=Q('.option-picker-container')||Q('.option-picker-select')||Q('[class*="option-picker"]');
  if(!root)return [];
  var raw=norm(T(root));
  if(!raw)return [];
  var body=raw.replace(/^(색상|옵션|수량|사이즈)\s+/,'');
  var parts=body.split(/(?=\s*\d{1,3}\s*-)/).map(norm).filter(Boolean);
  var rows=[];
  parts.forEach(function(part,i){
    var price=priceFromText(part);
    if(!price)return;
    var name=norm(part.replace(/\s*(?:\d{1,3}(?:,\d{3})+|\d{3,9})\s*원[\s\S]*$/,''));
    if(!name)return;
    var shipType=shipFromText(part)||'seller';
    var fee=feeFromRowText(part);
    var deliveryText=deliveryFromText(part);
    rows.push({
      name:name, option:name, price:price, priceText:price, vendorItemId:'',
      deliveryText:deliveryText,
      badgeIds:[], optionShipType:shipType, shipType:shipType,
      optionShippingBadge:(shipType==='fresh'||shipType==='bundle')?shipLabelFromType(shipType):'',
      shippingBadge:(shipType==='fresh'||shipType==='bundle')?shipLabelFromType(shipType):'',
      deliveryBadge:(shipType==='fresh'||shipType==='bundle')?shipLabelFromType(shipType):'',
      optionShippingFeeText:fee, shippingFeeText:fee, deliveryFeeText:fee,
      shippingFeeIncluded:/배송비\s*포함됨|배송비\s*포함/i.test(part),
      optionShippingSource:'dropdownDom.optionPickerText', selected:i===0,
      source:'dropdownDomOptionRows', domIndex:i, rawText:part
    });
  });
  log('DROPDOWN_SHIP_ROWS rawParts='+parts.length+' optionRows='+rows.length+' sample='+rows.slice(0,20).map(function(r){return C(r.name)+'|'+C(r.price)+'|'+C(r.shipType)+'|fee='+C(r.optionShippingFeeText)+'|'+C(r.deliveryText);}).join(' / '));
  return rows;
}

function mergePopupShipIntoScriptRows(scriptRows,popupRows){
  scriptRows=Array.isArray(scriptRows)?scriptRows:[]; popupRows=Array.isArray(popupRows)?popupRows:[];
  if(!scriptRows.length||!popupRows.length) return scriptRows;

  function nameKey(v){return C(v).replace(/\s+/g,'').toLowerCase();}
  function priceDigits(v){return C(v).replace(/[^0-9]/g,'');}
  function rowName(r){return C(r&& (r.name||r.value||r.optionName||r.fullOptionName||r.displayOptionName) || '');}
  function rowPrice(r){return C(r&& (r.rawCoupangOptionPrice||r.rawOptionPrice||r.coupangPrice||r.salePrice||r.priceText||r.price) || '');}
  function popScore(p){return (p&&p.shipType?100:0)+(p&&p.optionShippingFeeText?40:0)+(p&&p.deliveryText?25:0)+(p&&p.stockText?10:0);}

  var byVid={}, byNamePrice={}, byName={}, skippedNoKey=0, dupKey=0;
  popupRows.forEach(function(p){
    if(!p)return;
    var vid=GMID(p.vendorItemId||p.venderItemId||'');
    if(vid){ if(!byVid[vid]||popScore(p)>popScore(byVid[vid]))byVid[vid]=p; }
    var nk=nameKey(p.name||p.option||''), pk=priceDigits(p.price||p.priceText||'');
    if(nk&&pk){
      var k=nk+'|'+pk;
      if(byNamePrice[k])dupKey++;
      if(!byNamePrice[k]||popScore(p)>popScore(byNamePrice[k]))byNamePrice[k]=p;
    }else if(nk){
      if(!byName[nk]||popScore(p)>popScore(byName[nk]))byName[nk]=p;
    }else skippedNoKey++;
  });

  var usedPopup=[], applied=0, miss=0;
  function alreadyUsed(p){return usedPopup.indexOf(p)>=0;}
  function markUsed(p){if(p&&!alreadyUsed(p))usedPopup.push(p);}
  function pickPopup(r,idx){
    var rv=GMID(r.vendorItemId||r.venderItemId||'');
    if(rv&&byVid[rv]&&!alreadyUsed(byVid[rv]))return byVid[rv];
    var nk=nameKey(rowName(r)), pk=priceDigits(rowPrice(r));
    if(nk&&pk&&byNamePrice[nk+'|'+pk]&&!alreadyUsed(byNamePrice[nk+'|'+pk]))return byNamePrice[nk+'|'+pk];
    if(nk&&byName[nk]&&!alreadyUsed(byName[nk]))return byName[nk];
    /* 모든옵션보기 popup optionRows와 ATTR_ROWS가 동일 개수면 최후에만 순서 병합.
       옵션명/가격 병합이 우선이며, 순서 병합은 popup 강제 오픈 후 표시 row가 1:1일 때만 허용한다. */
    if(popupRows.length===scriptRows.length && popupRows[idx]&&!alreadyUsed(popupRows[idx]))return popupRows[idx];
    return null;
  }

  scriptRows.forEach(function(r,idx){
    if(!r)return;
    var p=pickPopup(r,idx);
    if(!p){miss++;return;}
    markUsed(p);

    if(p.deliveryText){ r.optionDeliveryText=p.deliveryText; r.deliveryText=p.deliveryText; }
    if(p.stockText) r.stockText=p.stockText;
    if(p.soldoutText) r.soldoutText=p.soldoutText;
    if(p.priceLabel) r.optionPriceLabel=p.priceLabel;
    if(p.unitPrice){ r.reactUnitPrice=r.reactUnitPrice||p.unitPrice; r.optionUnitPrice=p.unitPrice; }
    if(p.badgeIds) r.optionBadgeIds=p.badgeIds.join('|');
    var popupRaw=N(p.price||p.priceText||'');
    var baseRaw=N(r.rawCoupangOptionPrice||r.rawOptionPrice||r.coupangPrice||r.salePrice||r.baseCollectedPrice||'');
    var feeText=C(p.optionShippingFeeText||'');
    var feeRaw=N(feeText);
    var pShip=C(p.shipType||'');
    var popupIncluded=!!p.shippingFeeIncluded || /배송비\s*포함됨|배송비\s*포함/i.test(C(p.rawText||''));

    if(popupRaw){
      r.optionPopupPrice=p.price||p.priceText||'';
      r.optionPopupRawPrice=popupRaw;
      r.optionPopupDisplayPrice=formatWon(popupRaw);
      r.optionPopupDisplayRawPrice=popupRaw;
      /* V027: 가격은 모든옵션보기 popup DOM의 실제 옵션가를 최우선으로 한다.
         배송비/배송뱃지 보강과 동일한 popup row에서 직접 보이는 가격이므로
         attr/addToCartUrl/listVendorItemPrice 값이 다르면 popup 가격으로 덮어쓴다. */
      forceCoupangCollectedPrice(r, p.price||p.priceText||popupRaw, 'popupDom.optionPrice');
      if(pShip==='seller'){
        r.optionPriceWithShipping=formatWon(popupRaw);
        r.rawOptionPriceWithShipping=popupRaw;
        /* V051: 쿠팡 옵션영역의 '배송비 포함'은 현재 표시 옵션가에 배송비가 이미 포함됐다는 뜻이다.
         * popup가-base가 차액을 별도 배송비로 추정하면 주문에서 배송비가 이중 가산되므로 절대 추정하지 않는다. */
        if(popupIncluded){
          feeRaw=0;
          feeText='';
          r.shippingFeeIncluded=true;
          r.optionShippingFeeIncluded=true;
          r.optionShippingFeeEstimated=false;
        }
      }
    }
    /* V031: 판매자배송은 배송비가 실제 금액일 때만 옵션 아래에 표시한다.
     * 무료배송/조건부 무료배송/0원은 모두 표시 금지. 기존 attr/base fee 값도 같이 제거한다.
     */
    if(pShip==='seller'){
      if(popupIncluded){ feeRaw=0; feeText=''; }
      else if(feeText==='배송비 포함됨' && feeRaw) feeText=formatWon(feeRaw);
      if(!feeRaw || /무료배송|조건부\s*무료배송|무료|free/i.test(feeText)) feeText='';
      if(feeText){
        r.optionShippingFeeText=feeText;
        r.shippingFeeText=feeText;
        r.deliveryFeeText=feeText;
        r.optionShippingFeeRaw=feeRaw;
        r.shippingFeeRaw=feeRaw;
      }else{
        delete r.optionShippingFeeText;
        delete r.shippingFeeText;
        delete r.deliveryFeeText;
        delete r.optionShippingFeeRaw;
        delete r.shippingFeeRaw;
      }
    }else if(feeText){
      if(feeText==='배송비 포함됨' && feeRaw) feeText=formatWon(feeRaw);
      r.optionShippingFeeText=feeText;
      r.shippingFeeText=feeText;
      r.deliveryFeeText=feeText;
      if(feeRaw){r.optionShippingFeeRaw=feeRaw;r.shippingFeeRaw=feeRaw;}
    }
    r.optionPopupName=p.name||p.option||'';
    r.optionPopupDomIndex=p.domIndex;

    if(p.shipType){
      r.optionShipType=p.shipType; r.shipType=p.shipType; r.shippingType=p.shipType; r.optionShippingType=p.shipType;
      r.optionShippingSource='popupDom.optionRows.namePrice';
      if(p.shipType==='fresh'||p.shipType==='bundle'){
        var lab=shipLabelFromType(p.shipType);
        r.optionShippingBadge=lab; r.shippingBadge=lab; r.deliveryBadge=lab; r.deliveryType=lab;
      }else if(p.shipType==='seller'){
        r.optionShippingBadge=''; r.shippingBadge=''; r.deliveryBadge=''; r.deliveryType='';
      }
    }
    if(p.soldout){r.soldout=true;r.disabled=true;r.gmDisabled=true;r.isSelectable=false;r.gmOrderable=false;}
    applied++;
  });

  try{log('OPTION_RESULT rows='+scriptRows.length+' sample='+scriptRows.slice(0,30).map(function(r){return C(r.name||r.value||r.optionName)+'|vid='+C(r.vendorItemId)+'|price='+C(r.priceText||r.price||r.rawOptionPrice||r.rawCoupangOptionPrice)+'|ship='+C(r.optionShipType||r.shipType||r.shippingType)+'|badge='+C(r.optionShippingBadge||r.shippingBadge||r.deliveryBadge)+'|fee='+C(r.optionShippingFeeText||r.shippingFeeText)+'|src='+C(r.optionShippingSource);}).join(' / '));}catch(e){}
  log('POPUP_SHIP_MERGE applied='+applied+' miss='+miss+' skippedNoKey='+skippedNoKey+' dupKey='+dupKey+' popupRows='+popupRows.length+' scriptRows='+scriptRows.length+' usedPopup='+usedPopup.length);
  return scriptRows;
}

function uniqueRows(rows){var seen={};return (rows||[]).filter(function(r,i){var k=C(r.vendorItemId||'')||((C(r.name||r.value).replace(/\s+/g,'').toLowerCase())+'|'+N(r.priceText||r.price)+'|'+i);if(!k||seen[k])return false;seen[k]=1;return true;});}

function hardSoldoutText(txt){
  txt=C(txt||'');
  if(!txt) return false;
  if(/품절\s*임박|품절임박|\d+\s*개\s*남음/.test(txt)) return false;
  return /일시\s*품절|판매\s*중지|구매\s*불가|(?:^|[^임])품절(?!임박)|sold\s*out|outOfStock|unavailable/i.test(txt);
}
function stockTextFromOption(txt){
  txt=C(txt||'');
  var m=txt.match(/품절\s*임박[^\n\r]{0,40}|품절임박[^\n\r]{0,40}|\d+\s*개\s*남음/);
  return m?C(m[0]):'';
}
function optionHasPrice(row){
  row=row||{};
  return !!(C(row.priceText)||C(row.optionPriceText)||C(row.rawOptionPrice)||C(row.rawCoupangOptionPrice)||C(row.coupangPrice)||C(row.salePrice)||C(row.price)||C(row.displayPrice)||C(row.finalPrice));
}
function setOptionPrice(row,price,source){
  price=C(price||'');
  if(!row||!price) return row;
  return applyCoupangSalePrice(row,price,source||'margin-from-collected-price');
}
function normalizeOptionSaleState(row){
  row=row||{};
  var st=C([row.soldoutText,row.stockText,row.statusText,row.text,row.rawText,row.name].join(' '));
  if(stockTextFromOption(st)) row.stockText=row.stockText||stockTextFromOption(st);
  var hard=!!(row.soldout===true||row.isSoldOut===true||row.outOfStock===true||row.disabled===true||row.gmDisabled===true||hardSoldoutText(st));
  if(hard){
    row.soldout=true;
    row.disabled=true;
    row.gmDisabled=true;
    row.isSelectable=false;
    row.gmOrderable=false;
    row.excludeReason=row.excludeReason||'soldoutDisabled';
  }else{
    row.soldout=false;
    row.disabled=false;
    row.gmDisabled=false;
    if(row.isSelectable===undefined) row.isSelectable=true;
  }
  return row;
}
function validateFinalOptionRows(rows,optionPagePrice){
  /* V051: 옵션은 가격/UID 일부 누락을 이유로 삭제하지 않는다.
   * 쿠팡의 현재 페이지는 PID+IID+VID 옵션 링크이며, 다른 옵션 가격이 현재 옵션가와 다른 것은 정상이다.
   * ID/가격이 덜 붙은 row는 상태만 표시하고 목록에는 유지한다. */
  rows=uniqueRows(rows||[]).map(function(r){return normalizeOptionSaleState(Object.assign({},r));});
  var excluded=[];
  var active=[];
  rows.forEach(function(r){
    var name=C(r.name||r.displayOptionName||r.fullOptionName||r.optionName||r.value||r.label||'');
    var vid=C(r.vendorItemId||r.venderItemId||'');
    if(!name || /^옵션\s*\d+$/i.test(name)){
      r.gmExcluded=true; r.excludeReason='optionNameEmpty'; excluded.push(r); return;
    }
    if(!vid){
      r.gmIdMissing=true;
      r.gmOrderable=false;
      r.validationWarning='vendorItemIdEmpty';
    }
    if(!optionHasPrice(r)){
      r.gmPriceMissing=true;
      r.validationWarning=r.validationWarning||'optionPriceMissing';
    }else{
      applyCoupangSalePrice(r,null,r.priceSource||'margin-from-collected-price');
    }
    active.push(r);
  });
  var total=active.length;
  var priced=active.filter(optionHasPrice).length;
  /* 단일상품 fallback만 현재 옵션가를 사용할 수 있다. 다중옵션에는 현재 옵션가를 복사하지 않는다. */
  if(total===1 && priced===0 && C(optionPagePrice)){
    active[0]=setOptionPrice(active[0],optionPagePrice,'currentOptionPagePrice');
    priced=1;
  }
  return {rows:active,excluded:excluded,counts:{before:rows.length,after:active.length,excluded:excluded.length,priced:priced,total:total}};
}

function mergeDisplayRowsWithIds(displayRows,jsonRows,source){
  /* DOM 표시 row가 실제 옵션수의 기준이다.
   * productIdJsonRows가 추천/리뷰/하단 영역까지 긁어 uidCount가 커지는 경우가 있어
   * DOM 옵션명이 있으면 DOM 개수로 최종 rows를 확정한다.
   */
  displayRows=displayRows||[];jsonRows=jsonRows||[];source=source||'domDisplayRows';
  var used={};
  function priceKey(v){return String(N(v||'')||'');}
  function pickByPrice(d,idx){
    var pk=priceKey(d.price||d.priceText);
    if(pk){
      for(var i=0;i<jsonRows.length;i++){
        if(used[i])continue;
        var r=jsonRows[i]||{};
        if(priceKey(r.rawCoupangOptionPrice||r.rawOptionPrice||r.coupangPrice||r.salePrice||r.priceText||r.price)===pk){used[i]=1;return r;}
      }
    }
    if(jsonRows.length===displayRows.length && jsonRows[idx]&&!used[idx]){used[idx]=1;return jsonRows[idx];}
    return null;
  }
  return displayRows.map(function(d,i){
    d=d||{};
    var idr=pickByPrice(d,i)||{};
    var ids={
      productId: idr.productId||pageIds().productId,
      itemId: idr.itemId||'',
      vendorItemId: idr.vendorItemId||idr.venderItemId||''
    };
    var row=makeRowBase(d.name||d.value||('옵션 '+(i+1)),d.price||d.priceText||'',ids,source,i);
    if(d.deliveryText) row.deliveryText=d.deliveryText;
    if(d.soldoutText){row.soldoutText=d.soldoutText;row.stockText=stockTextFromOption(d.soldoutText);row.soldout=hardSoldoutText(d.soldoutText);row.disabled=!!row.soldout;row.gmDisabled=!!row.soldout;row.isSelectable=!row.soldout;}
    row.nameSource=d.source||source;
    row.domSource=d.source||source;
    row.domIndex=i;
    row.uidMatched=!!(ids.itemId&&ids.vendorItemId);
    return row;
  });
}
function collectFallbackSingle(){var ids=pageIds(),p=basePriceText(),del=deliveryInfo();var r=makeRowBase('기본상품',p,{productId:ids.productId,itemId:ids.itemId,vendorItemId:ids.vendorItemId},'singleProduct',0);try{r.shipType=del.shipType||'';r.shippingType=del.shipType||'';r.deliveryText=del.deliveryText||'';r.optionDeliveryText=del.deliveryText||'';if(del.shipType==='fresh'||del.shipType==='bundle'){r.optionShippingBadge=shipLabelFromType(del.shipType);r.shippingBadge=r.optionShippingBadge;r.deliveryBadge=r.optionShippingBadge;}else{r.optionShippingBadge='';r.shippingBadge='';r.deliveryBadge='';}if(N(del.shippingFeeText)>0){r.optionShippingFeeText=del.shippingFeeText;r.shippingFeeText=del.shippingFeeText;r.deliveryFeeText=del.shippingFeeText;r.optionShippingFeeRaw=N(del.shippingFeeText);r.shippingFeeRaw=N(del.shippingFeeText);}r.conditionalFreeText=del.conditionalFreeText||'';r.freeShippingConditionText=del.freeShippingConditionText||'';}catch(_e){}return [r];}
function optionDiagSample(rows,limit){
  rows=rows||[];limit=limit||3;
  return rows.slice(0,limit).map(function(r,i){
    r=r||{};
    return '#'+i+' name='+C(r.name||r.displayOptionName||r.fullOptionName||r.optionName||r.value||r.label||'').slice(0,45)+' vid='+C(r.vendorItemId||r.venderItemId||'')+' item='+C(r.itemId||'')+' price='+C(r.priceText||r.price||r.coupangPrice||r.salePrice||'')+' src='+C(r.source||r.nameSource||r.domSource||'');
  }).join(' || ');
}

function mergePopupOptionRowsAsFinal(popupRows,idRows){
  /* V058: 모든옵션보기 팝업형 최종 기준.
   * 옵션명/가격/배송/옵션수는 화면에 보이는 popup DOM 값을 사용하고,
   * itemId/vendorItemId만 기존 script/json row에서 보조로 붙인다.
   */
  popupRows=Array.isArray(popupRows)?popupRows:[];
  idRows=Array.isArray(idRows)?idRows:[];
  var used={};
  function priceKey(v){return String(N(v||'')||'');}
  function pickIdRow(p,idx){
    /* V051: popup 가격은 '배송비 포함' 표시가일 수 있으므로 ID 연결의 1순위를 가격으로 두면 안 된다.
     * 옵션명(예: 500g × 1개)을 먼저 맞추고, 그 다음 가격, 마지막으로 동일 개수일 때 순서를 사용한다. */
    var pn=C(p&& (p.name||p.option||p.value) || '').replace(/\s+/g,'').toLowerCase();
    if(pn){
      for(var ni=0;ni<idRows.length;ni++){
        if(used[ni])continue;
        var nr=idRows[ni]||{};
        var nn=C(nr.name||nr.value||nr.optionName||nr.fullOptionName||nr.displayOptionName||'').replace(/\s+/g,'').toLowerCase();
        if(nn && nn===pn){used[ni]=1;return nr;}
      }
    }
    var pk=priceKey(p&&((p.price)||(p.priceText)||(p.optionPopupDisplayPrice)));
    if(pk){
      for(var i=0;i<idRows.length;i++){
        if(used[i])continue;
        var r=idRows[i]||{};
        var rk=priceKey(r.rawCoupangOptionPrice||r.rawOptionPrice||r.coupangPrice||r.salePrice||r.priceText||r.price);
        if(rk && rk===pk){used[i]=1;return r;}
      }
    }
    if(idRows.length===popupRows.length && idRows[idx]&&!used[idx]){used[idx]=1;return idRows[idx];}
    if(idRows[idx]&&!used[idx]){used[idx]=1;return idRows[idx];}
    return {};
  }
  return popupRows.map(function(p,idx){
    p=p||{};
    var idr=pickIdRow(p,idx)||{};
    var ids={productId:idr.productId||pageIds().productId,itemId:idr.itemId||'',vendorItemId:idr.vendorItemId||idr.venderItemId||''};
    var row=makeRowBase(p.name||p.option||p.value||('옵션 '+(idx+1)),p.price||p.priceText||'',ids,'popupDomOptionRowsFinal',idx);
    forceCoupangCollectedPrice(row,p.price||p.priceText||'', 'popupDom.optionPrice.final');
    ['unitPrice','priceLabel','deliveryText','stockText','soldoutText','optionShipType','shipType','optionShippingBadge','shippingBadge','deliveryBadge','optionShippingFeeText','shippingFeeText','deliveryFeeText','shippingFeeIncluded','optionShippingSource','selected','badgeEvidence','rawText','rowClass'].forEach(function(k){if(p[k]!=null&&p[k]!=='' )row[k]=p[k];});
    row.nameSource='popupDom.optionTitle';
    row.domSource='popupDom.optionRows';
    row.domIndex=idx;
    row.uidMatched=!!(ids.itemId&&ids.vendorItemId);
    return row;
  });
}

function optionDiagDomState(stage){
  try{
    var ids=pageIds();
    var allBtn=findOptionOpenButton('all');
    var dropBtn=findOptionOpenButton('dropdown');
    log('OPTION_DIAG_DOM stage='+stage+' title='+C(titleText()).slice(0,70)+' pid='+C(ids.productId)+' item='+C(ids.itemId)+' vid='+C(ids.vendorItemId)+' optionPrice='+C(basePriceText())+' detailUrl='+isDetailUrl());
    log('OPTION_DIAG_BUTTONS stage='+stage+' all='+(allBtn?C(optionOpenButtonText(allBtn)).slice(0,80):'NONE')+' dropdown='+(dropBtn?C(optionOpenButtonText(dropBtn)).slice(0,80):'NONE')+' visibleOptionLike='+QA('button,a,[role="button"],select,[class*="option"],[class*="select"]').filter(function(el){return visible(el);}).length);
    log('OPTION_DIAG_SELECTORS stage='+stage+' optionTable='+QA('[class*="option-table"], [class*="option-list"], [class*="option-picker"], [class*="fashion-option"]').filter(function(el){return visible(el);}).length+' instantCard='+QA('[class*="instant-option"], [class*="prod-option"], [class*="option-card"], [class*="fashion-option"]').filter(function(el){return visible(el);}).length+' scripts='+QA('script').length);
  }catch(e){log('OPTION_DIAG_DOM_ERR stage='+stage+' '+(e&&e.message||e));}
}
async function collectOptions(){
  /* 최종 분기 원칙:
   * 1) "모든옵션보기" 버튼이 있으면 popup DOM을 최우선으로 사용한다.
   * 2) popup DOM이 0건이어도 검증 완료된 scriptRows가 있으면 그 값을 복구한다.
   *    팝업 셀렉터 실패가 상품 전체 옵션/배송정보 손실로 이어지면 안 된다.
   * 3) 버튼이 없는 상품은 기존 V058 흐름을 유지한다.
   */
  var source='none',rows=[];
  var optStart=Date.now();
  optionDiagDomState('enter');
  log('OPTION_DIAG_ENTER url='+C(location.href).slice(0,180));

  /* 검증 자료는 먼저 만들되 절대로 분기 조건으로 사용하지 않는다. */
  var scriptRows=collectUnifiedScriptOptionRows();
  log('OPTION_DIAG_SCRIPT_VERIFY_ONLY rows='+scriptRows.length+' ms='+(Date.now()-optStart)+' sample='+optionDiagSample(scriptRows,4));

  var jsonRows=[];
  var cardRows=[];
  var popupRows=[];
  var allBtn=findOptionOpenButton('all');
  var allButtonFound=!!allBtn;
  var branch={type:'none',clicked:false,rows:0};

  if(allButtonFound){
    /* V018: 모든옵션보기 버튼이 현재 DOM에 있으면 반드시 클릭한다.
     * alreadyOpen/preopened/본문 row 추정으로 클릭을 생략하지 않는다.
     * 버튼 클릭 후 실제 popup 전용 row만 기다리고 수집한다. */
    branch={
      type:'allOptionsOnly',
      clicked:false,
      rows:0,
      buttonFound:true
    };
    log('OPTION_ROUTE_LOCK type=ALL_OPTIONS_ONLY buttonNow=Y scriptRowsVerify='+scriptRows.length+' fallbackBlocked=Y clickRequired=Y');

    var preClickRows=0;
    try{preClickRows=(collectPopupOptionShipRows(true)||[]).length;}catch(e){preClickRows=0;}
    var clickOk=clickLike(allBtn);
    branch.clicked=!!clickOk;
    log('OPTION_ALL_POPUP_CLICK_REQUIRED clicked='+(clickOk?'Y':'N')+' beforeStrictPopupRows='+preClickRows+' buttonText='+optionOpenButtonText(allBtn).slice(0,120));

    /* V020: strict popupOptionRows가 실제 옵션 수(scriptRows)에 도달할 때까지만
     * 최대 1000ms 대기한다. 충족하는 즉시 종료하며 안정화 횟수로 조기 종료하지 않는다. */
    var expectedPopupRows=scriptRows.length;
    var popupWaitStart=Date.now();
    var popupWaitTry=0;
    var best=0;
    while((Date.now()-popupWaitStart)<1000){
      popupWaitTry++;
      var ac=0;
      try{ac=(collectPopupOptionShipRows(true)||[]).length;}catch(e){ac=0;}
      if(ac>best)best=ac;
      log('OPTION_ALL_POPUP_WAIT try='+popupWaitTry+' rows='+ac+' expected='+expectedPopupRows+' elapsed='+(Date.now()-popupWaitStart));
      if(expectedPopupRows>0 && ac>=expectedPopupRows){
        branch.rows=ac;
        branch.expectedReached=true;
        break;
      }
      await sleep(50);
    }
    if(!branch.rows){
      var strictFinal=0;
      try{strictFinal=(collectPopupOptionShipRows(true)||[]).length;}catch(e){strictFinal=0;}
      branch.rows=strictFinal||best;
    }
    log('OPTION_ALL_POPUP_WAIT_DONE expected='+expectedPopupRows+' actual='+branch.rows+' waitMs='+(Date.now()-popupWaitStart)+' reached='+(expectedPopupRows>0&&branch.rows>=expectedPopupRows?'Y':'N'));

    popupRows=collectPopupOptionShipRows(true);
    if(popupRows.length){
      /* 실제 값은 popup row가 기준이며 scriptRows는 ID 연결 보조로만 사용한다. */
      rows=mergePopupOptionRowsAsFinal(popupRows,scriptRows);
      source='popupDomOptionRowsFinal';
      branch.type='allOptionsPopupFinal';
      branch.rows=popupRows.length;
      log('OPTION_ALL_VERIFY popupRows='+popupRows.length+' scriptRows='+scriptRows.length+' match='+(popupRows.length===scriptRows.length?'Y':'N')+' use=POPUP_ONLY');
      log('OPTION_DIAG_BRANCH choose=popupDomFinal rows='+rows.length+' sample='+optionDiagSample(rows,4));
    }else if(scriptRows.length){
      /* 팝업은 열렸지만 strict popup 셀렉터가 0건인 경우,
       * 이미 가격/ID 검증이 끝난 scriptRows를 최종 옵션으로 복구한다. */
      rows=scriptRows;
      source='attributeVendorItemMapRowsPopupFallback';
      branch.type='allOptionsPopupFallbackScriptRows';
      branch.fallbackBlocked=false;
      branch.fallbackReason='popup_rows_zero';
      log('OPTION_ALL_VERIFY popupRows=0 scriptRows='+scriptRows.length+' match=N use=SCRIPT_FALLBACK fallbackBlocked=N');
      log('OPTION_DIAG_BRANCH choose=scriptRowsAfterPopupFail rows='+rows.length+' sample='+optionDiagSample(rows,4));
    }else{
      rows=[];
      source='allOptionsPopupCollectFailed';
      branch.type='allOptionsPopupCollectFailed';
      branch.fallbackBlocked=true;
      log('OPTION_ALL_VERIFY popupRows=0 scriptRows=0 match=N use=NONE fallbackBlocked=Y');
      log('OPTION_DIAG_BRANCH choose=allOptionsPopupCollectFailed rows=0');
    }
  }else{
    /* 모든옵션보기 버튼이 없는 상품은 V058 흐름으로 복원한다.
     * scriptRows가 있으면 그것을 최종 옵션 원본으로 확정하고,
     * dropdown DOM은 배송정보 보완에만 사용한다.
     * scriptRows가 없을 때만 카드형/JSON/단일상품 fallback을 사용한다. */
    log('OPTION_ROUTE_LOCK type=NO_ALL_OPTIONS_V058 buttonNow=N scriptRows='+scriptRows.length);

    if(scriptRows.length>=1){
      rows=scriptRows;
      source='attributeVendorItemMapRows';
      branch={type:'attrMapScriptRows',clicked:false,rows:scriptRows.length};
      log('OPTION_DIAG_BRANCH choose=scriptRows rows='+rows.length+' sample='+optionDiagSample(rows,4));

      popupRows=collectDropdownOptionShipRows();
      if(popupRows.length){
        rows=mergePopupShipIntoScriptRows(rows,popupRows);
        branch.type='attrMapPlusDropdownShip';
        log('OPTION_DIAG_BRANCH choose=scriptRows+dropdownShip rows='+rows.length+' dropdownRows='+popupRows.length+' sample='+optionDiagSample(rows,4));
      }
    }else{
      log('OPTION_DIAG_CARD_WAIT_START ms='+(Date.now()-optStart));
      cardRows=await waitPcCardOptionRows(2200);
      log('OPTION_DIAG_CARD rows='+cardRows.length+' ms='+(Date.now()-optStart)+' sample='+optionDiagSample(cardRows,4));
      jsonRows=uniqueRows(collectProductIdJsonRows());
      log('UID_ROWS_LOCKED count='+jsonRows.length);
      log('OPTION_DIAG_JSON rows='+jsonRows.length+' ms='+(Date.now()-optStart)+' sample='+optionDiagSample(jsonRows,4));

      if(cardRows.length>=2){
        rows=mergeDisplayRowsWithIds(cardRows,jsonRows,'pcCardOptionRows');
        source='pcCardOptionRows';
        branch={type:'pcCard',clicked:false,rows:cardRows.length};
        log('OPTION_DIAG_BRANCH choose=pcCard rows='+rows.length+' sample='+optionDiagSample(rows,4));
      }else if(jsonRows.length>=1){
        rows=jsonRows;
        source='productIdJsonRows';
        branch={type:'productIdJson',clicked:false,rows:jsonRows.length};
        log('OPTION_DIAG_BRANCH choose=productIdJson rows='+rows.length+' sample='+optionDiagSample(rows,4));
      }else{
        rows=collectFallbackSingle();
        source='singleProduct';
        branch={type:'singleProduct',clicked:false,rows:rows.length};
        log('OPTION_DIAG_BRANCH choose=singleFallback rows='+rows.length+' sample='+optionDiagSample(rows,4));
      }
    }
  }

  log('OPTION_DIAG_BEFORE_VALIDATE source='+source+' rows='+rows.length+' sample='+optionDiagSample(rows,5));
  var validated=validateFinalOptionRows(rows,basePriceText());
  rows=validated.rows;
  log('OPTION_VALIDATE before='+validated.counts.before+' after='+validated.counts.after+' excluded='+validated.counts.excluded+' priced='+validated.counts.priced+'/'+validated.counts.total);
  log('OPTION_DIAG_EXCLUDED count='+(validated.excluded&&validated.excluded.length||0)+' sample='+optionDiagSample(validated.excluded||[],5));
  log('OPTION_SUMMARY finalRows='+rows.length+' source='+source+' branch='+(branch&&branch.type||'')+' allButtonFound='+(allButtonFound?'Y':'N')+' fallbackBlocked='+(branch&&branch.fallbackBlocked?'Y':'N')+' scriptRows='+scriptRows.length+' uidRows='+jsonRows.length+' popupRows='+popupRows.length+' cardRows='+cardRows.length+' fashionRows=IN_SCRIPT domValues=REMOVED productJson='+jsonRows.length+' ms='+(Date.now()-optStart)+' sample='+optionDiagSample(rows,5));
  return {rows:rows,excludedRows:validated.excluded,source:source,branch:branch,counts:{scriptRows:scriptRows.length,uidRows:jsonRows.length,popupRows:popupRows.length,cardRows:cardRows.length,fashionRows:'IN_SCRIPT',domValues:0,productJson:jsonRows.length,finalRows:rows.length,excludedRows:validated.excluded.length,pricedRows:validated.counts.priced},idRowCount:jsonRows.length||scriptRows.length};
}

function basicInfo(){var ids=pageIds(),price=basePriceText(),unit=unitPriceText(),del=deliveryInfo();var calc=marginPrice(price),sale=calc?formatWon(calc):'';var info=Object.assign({source:'connector-detail-tab-fast-productid-json',collectVersion:BUILD_ID,title:titleText(),productName:titleText(),priceText:sale||price,price:sale||price,displayPriceText:sale||price,finalDisplayPriceText:sale||price,finalPriceText:sale||price,unit_price_text:unit,unitPriceText:unit,unit_price_display:unit,unitPriceDisplay:unit,price_per_unit_text:unit,pricePerUnitText:unit,per_unit_price_text:unit,perUnitPriceText:unit,mall_sale_price:calc||N(sale),mallSalePrice:calc||N(sale),mall_sale_price_text:sale||'',mallSalePriceText:sale||'',mall_discount_price:null,mallDiscountPrice:null,normal_price:calc||N(sale),normalPrice:calc||N(sale),normal_price_text:sale||'',normalPriceText:sale||'',sell_price:calc||N(price),sell_price_text:sale||price,sellPrice:calc||N(price),sellPriceText:sale||price,margin_rate:gmMarginRate(price),marginPolicyVersion:gmMarginPolicyVersion(),margin_policy_version:gmMarginPolicyVersion(),optionPrice:price,optionPriceText:price,currentOptionPrice:price,currentOptionPriceText:price,basePrice:price,raw_price:N(price),raw_price_text:price,rawPrice:N(price),rawPriceText:price,rawCoupangPrice:price,rawCoupangOptionPrice:price,coupangPrice:price,salePrice:price,calculatedPrice:calc,calculatedPriceText:sale,productId:ids.productId,itemId:ids.itemId,vendorItemId:ids.vendorItemId,venderItemId:ids.vendorItemId,key:ids.key,pageUrl:location.href,ts:Date.now()},del,imageInfo(true),collectPolicyInfo(),taxInfo(),categoryInfo(),quantityLimitInfo());return info;}
function applySelectedOptionToInfo(info,rows){
  info=info||{}; rows=Array.isArray(rows)?rows:[];
  var ids=pageIds();
  var row=rows.filter(function(r){return ids.vendorItemId&&C(r&&r.vendorItemId)===ids.vendorItemId;})[0]||rows.filter(function(r){return ids.itemId&&C(r&&r.itemId)===ids.itemId;})[0]||null;
  var identitySource='URL_ID_MATCH';
  /* PID-only fallback 또는 오래된 IID/VID로 진입한 경우 쿠팡이 다른 실제 옵션을 선택할 수 있다.
   * URL ID가 현재 옵션행과 맞지 않으면 popup/DOM이 표시한 selected 옵션을 현재 대표 후보 ID로 승격한다. */
  if(!row){
    row=rows.filter(function(r){return !!(r&&r.selected)&&!r.soldout&&!r.disabled;})[0]||rows.filter(function(r){return !!(r&&r.selected);})[0]||null;
    identitySource=row?'SELECTED_OPTION_FALLBACK':'NO_SELECTED_OPTION';
  }
  if(!row)return info;
  var rowPid=C(row.productId||row.product_id||ids.productId||info.productId||'');
  var rowIid=C(row.itemId||row.item_id||'');
  var rowVid=C(row.vendorItemId||row.vendor_item_id||row.venderItemId||'');
  if(rowPid&&rowIid&&rowVid){
    if(C(info.itemId)!==rowIid||C(info.vendorItemId)!==rowVid){
      log('SELECTED_OPTION_ID_REFRESH source='+identitySource+' old='+[C(info.productId),C(info.itemId),C(info.vendorItemId)].join('_')+' new='+[rowPid,rowIid,rowVid].join('_'));
    }
    info.productId=rowPid;info.itemId=rowIid;info.vendorItemId=rowVid;info.venderItemId=rowVid;info.key=[rowPid,rowIid,rowVid].join('_');
    info.selectedOptionIdentitySource=identitySource;
  }
  var raw=C(row.rawCoupangOptionPrice||row.rawOptionPrice||row.coupangPrice||row.salePrice||row.rawPriceText||row.baseCollectedPrice||'');
  var sale=C(row.priceText||row.price||row.finalPriceText||'');
  if(raw&&sale){
    /* V051: PID+IID+VID 현재 선택 옵션의 원가. basePrice는 과거 소비자 호환용 별칭으로만 유지한다. */
    info.optionPrice=raw; info.optionPriceText=raw; info.currentOptionPrice=raw; info.currentOptionPriceText=raw;
    info.basePrice=raw; info.raw_price=N(raw); info.raw_price_text=raw; info.rawPrice=N(raw); info.rawPriceText=raw;
    info.rawCoupangPrice=raw; info.rawCoupangOptionPrice=raw; info.coupangPrice=raw; info.salePrice=raw;
    info.priceText=sale; info.price=sale; info.displayPriceText=sale; info.finalDisplayPriceText=sale; info.finalPriceText=sale;
    info.sell_price=N(row.sell_price||row.sellPrice||row.calculatedPrice||sale); info.sell_price_text=sale; info.sellPrice=info.sell_price; info.sellPriceText=sale;
    info.mall_sale_price=N(row.mall_sale_price||row.mallSalePrice||info.sell_price); info.mallSalePrice=info.mall_sale_price; info.mall_sale_price_text=sale; info.mallSalePriceText=sale;
    info.mall_discount_price=(N(row.mall_discount_price||row.mallDiscountPrice)>0?N(row.mall_discount_price||row.mallDiscountPrice):null); info.mallDiscountPrice=info.mall_discount_price;
    info.normal_price=info.sell_price; info.normalPrice=info.sell_price; info.normal_price_text=sale; info.normalPriceText=sale;
    info.calculatedPrice=info.sell_price; info.calculatedPriceText=sale;
    info.selectedOptionPriceSource=row.priceSource||'';
  }
  var st=shipTypeFromBadge(row.optionShipType||row.shipType||row.shippingType||row.optionShippingBadge||row.shippingBadge||row.deliveryBadge||'');
  /* V052: 선택된 PID+IID+VID 옵션의 실제 배송일을 상단 기본정보로 승격한다.
   * SERVER_FAST의 과거 ETA가 먼저 표시되더라도, 쿠팡에서 방금 수집한 옵션 배송일이 도착하면 반드시 최신값이 이긴다. */
  var selectedDelivery=C(row.optionDeliveryText||row.deliveryText||row.exactDeliveryText||row.arrivalText||'');
  if(selectedDelivery){
    info.deliveryDateText=selectedDelivery;
    info.exactDeliveryText=selectedDelivery;
    info.arrivalText=selectedDelivery;
    info.deliveryText=selectedDelivery;
    info.selectedOptionDeliveryText=selectedDelivery;
    info.deliveryEtaSource='SELECTED_OPTION_FRESH';
  }
  if(st){
    var lab=shipLabelFromType(st);
    info.shipType=st; info.deliveryType=lab; info.shippingLabel=lab; info.shippingBadge=lab; info.baseShippingBadge=lab;
    info.optionShippingBadge=lab; info.selectedOptionShippingBadge=lab; info.selectedOptionShipType=st; info.selectedOptionShippingSource=row.optionShippingSource||'';
    if(row.shippingFeeIncluded||row.optionShippingFeeIncluded){
      /* 현재 옵션가는 배송비 포함가이므로 별도 배송비를 절대 남기지 않는다. */
      info.shippingFeeText=''; info.baseShippingFeeText=''; info.deliveryFeeText='';
      info.shippingFee=0; info.deliveryFee=0; info.baseShippingFee=0; info.shippingFeeRaw=0; info.deliveryFeeRaw=0;
      info.shippingFeeIncluded=true; info.optionShippingFeeIncluded=true;
    }else if(row.optionShippingFeeText){
      info.shippingFeeText=row.optionShippingFeeText;info.baseShippingFeeText=row.optionShippingFeeText;info.deliveryFeeText=row.optionShippingFeeText;
    }
  }
  log('SELECTED_OPTION_APPLY vid='+ids.vendorItemId+' name='+C(row.name||row.value||'')+' optionRaw='+raw+' optionSale='+sale+' ship='+(info.shipType||'')+' delivery='+selectedDelivery+' shipSource='+(row.optionShippingSource||''));
  return info;
}
function saveResult(payload){try{GM_setValue(DETAIL_RESULT_KEY,JSON.stringify(payload));return true;}catch(e){log('GM_setValue failed '+(e&&e.message||e));try{localStorage.setItem(DETAIL_RESULT_KEY,JSON.stringify(payload));return true;}catch(_e){return false;}}}
function isDetailUrl(){try{return /\/v[mp]\/products\/\d+|\/products\/\d+/i.test(location.pathname||'');}catch(e){return false;}}
function cleanupToBlank(reason){
  reason=C(reason||'EXIT_SAVE_THEN_BLANK');
  if(!isDetailUrl()) return false;
  log('MOVE_ABOUT_BLANK reason='+reason);
  try{location.replace('about:blank');return true;}catch(e){try{location.href='about:blank';return true;}catch(_e){}}
  return false;
}
var LAST_DETAIL_DRAFT=null;
var EXIT_BLANK_LOCK=false;
function rememberDraft(payload){try{LAST_DETAIL_DRAFT=payload||LAST_DETAIL_DRAFT;}catch(e){} return payload;}
function saveDraftOnExit(reason){
  if(EXIT_BLANK_LOCK) return false;
  if(!isDetailUrl()) return false;
  EXIT_BLANK_LOCK=true;
  try{
    var payload=LAST_DETAIL_DRAFT;
    if(!payload){
      var info=basicInfo();
      var opt={rows:[],source:"disabled-exit",counts:{}};
      /* 개발 검증 중 이벤트 비활성 상태. 운영 배포 전 활성화 시 async collectOptions 처리 필요. */
      info.flatOptionRows=opt.rows;info.optionRows=opt.rows;info.visibleOptions=opt.rows;info.options=opt.rows;info.vendorItemOptions=opt.rows;
      info.__gmStrictOptionSource=opt.source;info.__gmOptionSourceCounts=opt.counts;info.__gmOptionIdRowCount=opt.idRowCount;
      payload={type:'GM_CONNECTOR_DETAIL_RESULT',ok:true,key:info.key||'',item:info,phase:'exit-draft',partial:true,final:false,ts:Date.now(),pageUrl:location.href,exitReason:C(reason||'EXIT')};
    }
    saveResult(payload);
    log('EXIT_DRAFT_SAVED reason='+C(reason||'EXIT'));
  }catch(e){log('EXIT_DRAFT_SAVE_FAILED '+(e&&e.message||e));}
  cleanupToBlank(reason||'EXIT');
  return true;
}
/* 개발 검증 중 비활성화: 자동 about:blank 이동 금지.
 * 운영 배포 전 활성화 검토 대상:
 * - 수집 완료 후 일정 시간 뒤 about:blank 이동
 * - pagehide / beforeunload / visibilitychange 이탈 저장 후 blank 이동
 * 현재는 2번탭 상세/팝업 검증을 위해 collector가 스스로 blank를 실행하지 않는다.
try{window.addEventListener('pagehide',function(){saveDraftOnExit('PAGEHIDE');},false);}catch(e){}
try{window.addEventListener('beforeunload',function(){saveDraftOnExit('BEFOREUNLOAD');},false);}catch(e){}
try{document.addEventListener('visibilitychange',function(){if(document.visibilityState==='hidden') saveDraftOnExit('VISIBILITY_HIDDEN');},false);}catch(e){}
 */

function gmCoupangUnavailableText(){
  try{
    var unknown=document.querySelector('.prod-not-find-unknown,[class*="prod-not-find-unknown"]');
    var unknownText=C(unknown&&unknown.textContent||'');
    var bodyText=C(document.body&&document.body.innerText||'');
    var routeRe=/상품을\s*찾을\s*수\s*없습니다|주소가\s*잘못\s*입력되었거나|판매종료\s*또는\s*중지되어\s*해당\s*상품을\s*찾을\s*수\s*없습니다|입력하신\s*주소가\s*정확한지\s*확인|요청하신\s*페이지를\s*찾을\s*수\s*없/i;
    if((unknown&&routeRe.test(unknownText||bodyText)) || routeRe.test(bodyText)){
      return 'ROUTE_NOT_FOUND::'+C(unknownText||bodyText).slice(0,240);
    }
    var selectors=[
      '.prod-not-find-known__buy__info__txt',
      '.prod-not-find-known__buy__info',
      '.prod-not-find-known__buy__button',
      '[class*="prod-not-find-known"]'
    ];
    for(var i=0;i<selectors.length;i++){
      var nodes=document.querySelectorAll(selectors[i]);
      for(var j=0;j<nodes.length;j++){
        var txt=C(nodes[j]&&nodes[j].textContent||'');
        /* V054: 품절은 전역 문자열로 잡지 않는다. 옵션 일부 품절 오판 방지를 위해
         * Coupang prod-not-find-known 판매중단 컨테이너 내부에서만 STOPPED로 인정한다. */
        if(/현재\s*판매\s*중인\s*상품이\s*아닙니다|판매\s*중인\s*상품이\s*아닙니다|^품절$/i.test(txt)){
          return 'STOPPED::'+(txt||'현재 판매 중인 상품이 아닙니다.');
        }
      }
    }
  }catch(e){}
  return '';
}
/* GM_CPKR_403_GUARD_V001: Error pages are never valid product payloads.
 * No cookies, external URLs, product status or existing snapshots are changed here. */
function gmCp403DeniedPage(){
  try{
    var title=C(document.title||'').slice(0,400);
    var body=C(document.body&&document.body.innerText||'').slice(0,4000);
    var text=title+' '+body;
    var englishDenied=/Access\s*Denied|403\s*Forbidden|You\s+don[’']?t\s+have\s+permission\s+to\s+access|errors\.edgesuite\.net|The\s+request\s+could\s+not\s+be\s+satisfied|Request\s+blocked/i.test(text);
    var coupangServiceError=/쿠팡을\s*찾아주신\s*고객님/.test(text) &&
      (/입력하신\s*주소가\s*정확한지/.test(text)||/현재\s*서비스\s*제공이\s*원활하지/.test(text));
    return englishDenied||coupangServiceError;
  }catch(_e){return false;}
}
function gmCp403RejectPage(job,stage,reason){
  log('CPKR_PAGE_REJECT stage='+stage+' reason='+reason+' url='+C(location.href));
  statusUpdate('CODE_ERROR','쿠팡 상세페이지 접근 오류',{result:'FAIL',reason:reason,disablePurchase:true,noSave:true,key:C(job&&job.key||'')});
  /* Important: do not call saveResult/rememberDraft or mark the product sold out. */
  return true;
}
function gmCp403InvalidFinalInfo(info){
  try{
    var thumbs=(info.thumbnailImages&&info.thumbnailImages.length)||(info.images&&info.images.length)||0;
    var name=C(info.title||info.productName||info.name||'');
    var price=N(info.price||info.priceText||info.salePrice||0);
    /* Empty errors often create a synthetic fallback option; that does not prove a product exists. */
    return !thumbs && (!name || !price);
  }catch(_e){return true;}
}
function gmCpUnavailableKind(v){v=C(v);return /^ROUTE_NOT_FOUND::/i.test(v)?'ROUTE_NOT_FOUND':(/^STOPPED::/i.test(v)?'STOPPED':'');}
function gmCpUnavailableMessage(v){return C(v).replace(/^(?:ROUTE_NOT_FOUND|STOPPED)::/i,'')||'쿠팡 상세 페이지를 열 수 없습니다.';}
/* GM_CPKR_IDENTITY_V001: Missing/stopped product is terminal.
 * Never retry as PID+VID or PID-only after a definitive unavailable page. */

async function gmWaitCoupangUnavailable(maxMs){
  var started=Date.now(), text='';
  while(Date.now()-started<=maxMs){
    text=gmCoupangUnavailableText();
    if(text)return text;
    await sleep(100);
  }
  return '';
}
function gmStopUnavailable(job,message){
  var ids=pageIds();
  var key=C(job.key||ids.key||'');
  var info={
    source:'connector-detail-coupang-unavailable',
    collectVersion:BUILD_ID,
    mall_code:'CPKR',
    mallCode:'CPKR',
    key:key,
    productId:C(ids.productId||job.productId||''),
    itemId:C(ids.itemId||job.itemId||''),
    vendorItemId:C(ids.vendorItemId||job.vendorItemId||''),
    venderItemId:C(ids.vendorItemId||job.vendorItemId||''),
    title:titleText(),
    productName:titleText(),
    pageUrl:location.href,
    status:'STOPPED',
    /* GM_CPKR_IDENTITY_V001: first verified unavailable page is terminal. */
    sale_status:'inactive',
    saleStatus:'inactive',
    unavailable:true,
    unavailable_yn:'Y',
    purchaseUnavailable:true,
    temporarySoldout:false,
    temp_soldout_yn:'N',
    product_removed:'N',
    productRemoved:'N',
    active_yn:'N',
    activeYn:'N',
    soldout_yn:'N',
    soldoutYn:'N',
    stopReason:message,
    reason:message,
    statusText:message,
    detailStatus:'STOPPED',
    images:[],
    thumbnailImages:[],
    detailBlocks:[],
    flatOptionRows:[],
    optionRows:[],
    visibleOptions:[],
    options:[],
    vendorItemOptions:[],
    ts:Date.now()
  };
  var payload={
    type:'GM_CONNECTOR_DETAIL_RESULT',
    ok:true,
    key:key,
    item:info,
    phase:'coupang-sale-stopped',
    partial:false,
    final:true,
    ts:Date.now(),
    pageUrl:location.href
  };
  rememberDraft(payload);
  saveResult(payload);
  try{window.__GM_DETAIL_DONE__=true;}catch(e){}
  statusUpdate('STOPPED',message,{
    result:'STOPPED',
    reason:'CPKR_SALE_STOPPED', temporarySoldout:false, soldout_yn:'N',
    disablePurchase:true,
    key:key,
    productId:info.productId,
    vendorItemId:info.vendorItemId
  });
  log('CPKR_SALE_STOPPED_FINAL_V013 key='+key+' status=inactive text='+message);
  return true;
}

async function run(){
  if(!isCoupang())return false;
  if(!isDetailUrl()){log('DETAIL_SKIP_NON_DETAIL_URL href='+C(location.href));return false;}
  statusUpdate('BOOT','상품정보 확인중');
  var job=readJob()||{};
  if(gmCp403DeniedPage())return gmCp403RejectPage(job,'boot','CPKR_ACCESS_DENIED');
  log('start key='+(job.key||job.productId||pageIds().key||pageProductId()||''));
  statusUpdate('COLLECT_START','상품정보 수집중');
  try{
    /* 쿠팡 판매중지 화면은 React 렌더 후 노드가 나타날 수 있으므로
     * 상세 수집 전에 짧게 확인하고 발견 즉시 모든 후속 수집을 중단한다. */
    var gmUnavailableText=await gmWaitCoupangUnavailable(1200);
    if(gmCp403DeniedPage())return gmCp403RejectPage(job,'after-wait','CPKR_ACCESS_DENIED');
    if(gmUnavailableText){
      var gmUnavailableKind=gmCpUnavailableKind(gmUnavailableText);
      var gmUnavailableMessage=gmCpUnavailableMessage(gmUnavailableText);
      // Confirmed unavailable/stopped: one URL only, persist terminal state.
      // HTTP 403 is handled by gmCp403DeniedPage() above and never deactivates.
      log('CPKR_UNAVAILABLE_TERMINAL_V001 kind='+gmUnavailableKind+' key='+C(job.key||''));
      gmStopUnavailable(job,gmUnavailableMessage);
      return true;
    }
    /* V013: Successful detail collection clears the old retry stage on the next request. */
    // V018: 초기 preopen은 폐기한다. 실제 옵션 수집 시점에 현재 모든옵션보기 버튼을 반드시 클릭한다.
    // V176: 상단 썸네일은 0/300/700/1200/1800/3000ms 총 6회 수집 후 best 사용.
    log('V031_TOP_THUMB_SAFE_FAST_COLLECT_START');
    await collectTopSwiperImagesTimed();
    var info=basicInfo();
    /* 옵션 수집과 무관한 상품 단위 배송/반품 정책을 먼저 잠근다.
     * 이후 popup 옵션 수집이 실패해도 이 값들은 절대 0/빈값으로 초기화하지 않는다. */
    var gmPolicyLock={
      jeju_delivery_yn:info.jeju_delivery_yn, jejuDeliveryYn:info.jejuDeliveryYn,
      jeju_extra_delivery_fee:info.jeju_extra_delivery_fee, jejuExtraDeliveryFee:info.jejuExtraDeliveryFee,
      island_delivery_yn:info.island_delivery_yn, islandDeliveryYn:info.islandDeliveryYn,
      island_extra_delivery_fee:info.island_extra_delivery_fee, islandExtraDeliveryFee:info.islandExtraDeliveryFee,
      return_shipping_fee:info.return_shipping_fee, returnShippingFee:info.returnShippingFee,
      returnFeeText:info.returnFeeText, exchangeReturnFeeText:info.exchangeReturnFeeText,
      remoteAreaText:info.remoteAreaText, remoteAreaUnavailable:info.remoteAreaUnavailable
    };
    function gmNullableFeeLog(v){return v==null?'null':String(N(v));}
    log('POLICY_LOCK jeju='+gmPolicyLock.jeju_delivery_yn+'/'+gmNullableFeeLog(gmPolicyLock.jeju_extra_delivery_fee)+' island='+gmPolicyLock.island_delivery_yn+'/'+gmNullableFeeLog(gmPolicyLock.island_extra_delivery_fee)+' returnFee='+N(gmPolicyLock.return_shipping_fee));
    ['productId','itemId','vendorItemId','key','cp_id','cpId','categoryId','searchCategoryId'].forEach(function(k){if(job[k]&&!info[k])info[k]=job[k];});
    if(!info.cp_id) info.cp_id=C(info.cpId||info.categoryId||info.searchCategoryId||urlParam('cp_id')||urlParam('cpId')||urlParam('categoryId')||'');
    if(info.cp_id && !info.cpId) info.cpId=info.cp_id;
    if(info.cp_code && info.cp_id && !info.cp_match){ info.cp_match='T'; info.cpMatch='T'; }
    // V151: 상세이미지는 basicInfo/imageInfo 단계의 PROCESS-A/B detailBlocks만 사용한다. late 재스캔/재조립 금지.
    log('OPTION_DIAG_RUN_BEFORE_COLLECT key='+(info.key||job.key||'')+' title='+C(info.title||'').slice(0,80));
    var opt=await collectOptions();
    log('OPTION_DIAG_RUN_AFTER_COLLECT rows='+(opt.rows&&opt.rows.length||0)+' source='+(opt.source||'')+' counts='+JSON.stringify(opt.counts||{}));
    info.flatOptionRows=opt.rows;info.optionRows=opt.rows;info.visibleOptions=opt.rows;info.options=opt.rows;info.vendorItemOptions=opt.rows;info.itemOptions=opt.rows;info.excludedOptionRows=opt.excludedRows||[];info.selectedOptions=opt.rows;
    info=applySelectedOptionToInfo(info,opt.rows);
    // A popup can be partially loaded. Never mark incomplete option rows authoritative.
    var gmCountSource=C(opt.source||'');
    var gmRows=Array.isArray(opt.rows)?opt.rows:[];
    var gmExcluded=(opt.excludedRows||[]).length;
    var gmIdsComplete=gmRows.length>0 && gmRows.every(function(r){return C(r.productId||info.productId)&&C(r.itemId)&&C(r.vendorItemId||r.venderItemId);});
    var gmScriptCount=N((opt.counts||{}).scriptRows);
    var gmPopupVerified=(opt.branch||{}).type==='allOptionsPopupFinal'
      && opt.branch.clicked===true && gmScriptCount>0
      && N((opt.counts||{}).popupRows)>=gmScriptCount && gmRows.length===gmScriptCount;
    var gmScriptVerified=!((opt.branch||{}).buttonFound || (opt.branch||{}).type==='allOptionsOnly')
      && (gmCountSource==='attributeVendorItemMapRows'||gmCountSource==='attributeVendorItemMapRowsPopupFallback')
      && gmScriptCount>0 && gmRows.length===gmScriptCount;
    var gmSingleVerified=gmCountSource==='singleProduct' && gmRows.length===1
      && !(opt.branch||{}).buttonFound && gmScriptCount===0;
    // No count is verified from a failed popup, partial validation, or unmatched IDs.
    var gmComplete=gmIdsComplete && gmExcluded===0 && (gmPopupVerified||gmScriptVerified||gmSingleVerified);
    // Retain existing UI flags; use a separate, stricter field for database totals.
    info.productPageValid=true; info.optionCollectionComplete=true; info.optionAuthoritative=true;
    info.optionTotalCountVerified=gmComplete?gmRows.length:null;
    /* 상품 단위 지역배송/반품 정책은 옵션 결과와 분리하여 잠금값을 복원한다. */
    Object.keys(gmPolicyLock).forEach(function(k){if(gmPolicyLock[k]!==undefined)info[k]=gmPolicyLock[k];});
    if(!N(info.return_shipping_fee||info.returnShippingFee)) { info.return_shipping_fee=5000; info.returnShippingFee=5000; info.returnFeeText='5000'; info.exchangeReturnFeeText='5000'; }
    log('POLICY_LOCK_RESTORE options='+opt.rows.length+' source='+opt.source+' jeju='+info.jeju_delivery_yn+'/'+gmNullableFeeLog(info.jeju_extra_delivery_fee)+' island='+info.island_delivery_yn+'/'+gmNullableFeeLog(info.island_extra_delivery_fee)+' returnFee='+N(info.return_shipping_fee));
    info.optionTexts=opt.rows.map(function(x){return x&&x.name||'';}).filter(Boolean);
    info.optionGroups=opt.rows.length?[{name:'상품선택',values:opt.rows,source:opt.source}]:[];
    info.__gmStrictOptionSource=opt.source;info.__gmOptionSourceCounts=opt.counts;info.__gmOptionIdRowCount=opt.idRowCount;
    if(gmCp403DeniedPage())return gmCp403RejectPage(job,'before-basic','CPKR_ACCESS_DENIED');
    if(gmCp403InvalidFinalInfo(info))return gmCp403RejectPage(job,'before-basic','CPKR_INVALID_EMPTY_PAGE');
    statusUpdate('BASIC_READY','기본정보 수집 완료',{result:'BASIC',options:(opt.rows&&opt.rows.length)||0,thumbs:((info.thumbnailImages||info.images||[]).length)||0,source:opt.source,key:(info.key||job.key||'')});
    var sup=await waitSupplierInfo(2600);
    Object.keys(sup||{}).forEach(function(k){info[k]=sup[k];});
    info.__gmSupplierInfo=sup;
    info=gmV138FinalizeImagePayload(info);
    /* 제주/도서산간 가능 여부와 실제 왕복 반품비를 최종 payload 직전에 숫자/T/F로 고정한다. */
    function gmRemoteMode(v,fee){v=C(v).toUpperCase(); if(v==='N'||v==='Y'||v==='F')return v; return fee>0?'Y':null;}
    function gmNullableRemoteFee(v){return v==null||v===''?null:Math.max(0,N(v));}
    var jejuFeeRaw=(info.jeju_extra_delivery_fee!=null?info.jeju_extra_delivery_fee:info.jejuExtraDeliveryFee);
    info.jeju_extra_delivery_fee=gmNullableRemoteFee(jejuFeeRaw);
    info.jeju_delivery_yn=gmRemoteMode(info.jeju_delivery_yn!=null?info.jeju_delivery_yn:info.jejuDeliveryYn,info.jeju_extra_delivery_fee);
    if(info.jeju_delivery_yn==='F')info.jeju_extra_delivery_fee=0; else if(info.jeju_delivery_yn!=='Y')info.jeju_extra_delivery_fee=null;
    var islandFeeRaw=(info.island_extra_delivery_fee!=null?info.island_extra_delivery_fee:info.islandExtraDeliveryFee);
    info.island_extra_delivery_fee=gmNullableRemoteFee(islandFeeRaw);
    info.island_delivery_yn=gmRemoteMode(info.island_delivery_yn!=null?info.island_delivery_yn:info.islandDeliveryYn,info.island_extra_delivery_fee);
    if(info.island_delivery_yn==='F')info.island_extra_delivery_fee=0; else if(info.island_delivery_yn!=='Y')info.island_extra_delivery_fee=null;
    info.jejuDeliveryYn=info.jeju_delivery_yn; info.jejuExtraDeliveryFee=info.jeju_extra_delivery_fee;
    info.islandDeliveryYn=info.island_delivery_yn; info.islandExtraDeliveryFee=info.island_extra_delivery_fee;
    info.return_shipping_fee=Math.max(0,N(info.return_shipping_fee||info.returnShippingFee||0));
    info.returnShippingFee=info.return_shipping_fee;
    info.returnFeeText=info.return_shipping_fee>0?String(info.return_shipping_fee):'';
    info.exchangeReturnFeeText=info.returnFeeText;
    log('REMOTE_DELIVERY_FINAL jeju='+info.jeju_delivery_yn+' fee='+gmNullableFeeLog(info.jeju_extra_delivery_fee)+' island='+info.island_delivery_yn+' fee='+gmNullableFeeLog(info.island_extra_delivery_fee));
    if(gmCp403DeniedPage())return gmCp403RejectPage(job,'before-save','CPKR_ACCESS_DENIED');
    if(gmCp403InvalidFinalInfo(info))return gmCp403RejectPage(job,'before-save','CPKR_INVALID_EMPTY_PAGE');
    var payloadKey=C(job.key||info.key||''); var payload={type:'GM_CONNECTOR_DETAIL_RESULT',ok:true,key:payloadKey,item:info,phase:'final-fast-productid-json',partial:false,final:true,ts:Date.now(),pageUrl:location.href};
    rememberDraft(payload);
    log('BASE_SHIP badge='+(info.baseShippingBadge||info.shippingBadge||info.deliveryType||'')+' fee='+(info.baseShippingFeeText||info.shippingFeeText||info.deliveryFeeText||'')+' type='+(info.shipType||''));
    log('SHIP_FINAL badge='+(info.baseShippingBadge||info.shippingBadge||info.deliveryType||'')+' fee='+(info.baseShippingFeeText||info.shippingFeeText||info.deliveryFeeText||'')+' returnFee='+(info.return_shipping_fee||info.returnFeeText||'')+' type='+(info.shipType||''));
    gmDetailTrace('10_PAYLOAD_READY',{mall_code:'CPKR',key:info.key||job.key||'',images:(info.images&&info.images.length)||0,thumbnailImages:(info.thumbnailImages&&info.thumbnailImages.length)||0,detailBlocks:(info.detailBlocks&&info.detailBlocks.length)||0,optionRows:opt.rows.length,cp_fix_code:info.cp_fix_code||info.cpCode||info.cp_code||''});
    log('PAYLOAD_FINAL images='+(info.images&&info.images.length||0)+' thumbnailImages='+(info.thumbnailImages&&info.thumbnailImages.length||0)+' detailBlocks='+(info.detailBlocks&&info.detailBlocks.length||0));
    log('FINAL optionRows='+opt.rows.length+' source='+opt.source+' price='+info.priceText+' images='+(info.images&&info.images.length||0)+' blocks='+(info.detailBlocks&&info.detailBlocks.length||0)+' ship='+info.shipType);
    saveResult(payload);
    try{window.__GM_DETAIL_DONE__=true;}catch(e){}
    statusUpdate('DONE','상품정보 확인 완료',{result:'OK',options:opt.rows.length,source:opt.source,key:(info.key||job.key||''),productId:C(pageIds().productId||job.productId||'')});
    log('DONE_KEEP_DETAIL_OPEN');
    return true;
  }catch(e){
    log('run failed '+(e&&e.stack||e&&e.message||e));
    statusUpdate('CODE_ERROR','상품정보 확인 중 오류가 발생했습니다',{result:'FAIL',reason:'CODE_ERROR',disablePurchase:true});
    /* 개발 검증 중 blank 방지: 운영 배포 전 필요 시 saveDraftOnExit('CODE_ERROR') 복구 */
    return false;
  }
}

// [GLOMART] CPKR collector에서는 DETAIL_TAP_NODE_DIAG.js를 로드하지 않는다. ALKR 연결은 별도 파일에서 유지한다.

try{run().catch(function(e){log('boot failed '+(e&&e.message||e));});}catch(e){log('boot exception '+(e&&e.message||e));}
})();
