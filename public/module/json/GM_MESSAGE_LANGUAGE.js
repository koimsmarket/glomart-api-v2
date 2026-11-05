/* GM_MESSAGE_LANGUAGE_V002 -- shared system notice display adapter
 * Reuses already loaded GM_CONTENT_TRANSLATE.translateText(text, source, target).
 * No own translation engine, no MutationObserver, no DOM scans, no side effects.
 * Explicit caller invocation only; NOT a native Android FCM intercept.
 */
(function(w){
  'use strict';
  var VERSION='V002';
  if(w.GM_MESSAGE_LANGUAGE && w.GM_MESSAGE_LANGUAGE.version===VERSION) return;
  function clean(v){return v==null?'':String(v).trim();}
  function lang(v){
    var x=clean(v).toLowerCase().replace(/_/g,'-');
    if(!x || /^(und|unknown|null|undefined|false)$/.test(x)) return '';
    var alias={kr:'ko',jp:'ja',cn:'zh',vn:'vi','zh-tw':'tw','zh-hk':'tw','zh-cn':'zh'};
    return alias[x] || x.split('-')[0];
  }
  function gmLang(){
    var x='';
    try{x=w.GM_LANG||w.gm_lang||w.localStorage.getItem('gm_lang')||'';}catch(_){}
    return lang(x);
  }
  function deviceLang(){
    var x='';
    try{x=w.GM_DEVICE_LANG||w.DEVICE_LANG||w.localStorage.getItem('device_lang')||'';}catch(_){}
    return lang(x);
  }
  function languageOrder(m){
    var list=[lang(m.gm_lang||m.gmLang||gmLang()),lang(m.device_lang||m.deviceLang||deviceLang())];
    return list.filter(function(v,i){return v && list.indexOf(v)===i;});
  }
  /* Protect opaque transaction identifiers and amounts. For lines 'label: value',
   * translate only the label; preserve the exact order/payment value. */
  function isOpaque(s){
    s=clean(s);
    return /^(?:https?:\/\/\S+|\d[\d, .:\-/₩원KRW$€¥G]*|[A-Z0-9][A-Z0-9_\-]{7,})$/i.test(s);
  }
  function splitLines(raw){
    return String(raw).split(/(\r?\n)/);
  }
  async function translateField(raw,src,dst,engine){
    if(!raw || dst===src) return raw;
    var parts=splitLines(raw), out=[];
    for(var i=0;i<parts.length;i++){
      var line=parts[i];
      if(/^\r?\n$/.test(line) || !clean(line) || isOpaque(line)){out.push(line);continue;}
      var label=line, tail='';
      var m=line.match(/^([^:\n：]{1,45})([:：]\s*)(.+)$/);
      if(m && (isOpaque(m[3]) || /(?:\d{2,}|https?:\/\/|₩|원|KRW|\bG\b)/i.test(m[3]))){label=m[1];tail=m[2]+m[3];}
      var translated=await engine.translateText(label,src,dst);
      if(typeof translated!=='string' || !clean(translated) || (translated===label && /[\p{L}]/u.test(label))) return null;
      out.push(translated+tail);
    }
    return out.join('');
  }
  async function translate(msg){
    msg=msg||{};
    var title=String(msg.title==null?'':msg.title);
    var body=String(msg.message==null?(msg.body==null?'':msg.body):msg.message);
    var src=lang(msg.source_lang||msg.sourceLang);
    var fallback={title:title,body:body,source_lang:src,display_lang:src,translated:false,status:'ORIGINAL'};
    // The caller must supply source_lang (typically 'ko' for system notices).
    // Never guess input language from recipient settings or force Korean/English.
    if(!src) return Object.assign({},fallback,{status:'SOURCE_LANGUAGE_REQUIRED'});
    if(!title && !body) return Object.assign({},fallback,{status:'EMPTY'});
    var choices=languageOrder(msg);
    var engine=w.GM_CONTENT_TRANSLATE;
    if(!engine || typeof engine.translateText!=='function') return Object.assign({},fallback,{status:'ENGINE_UNAVAILABLE'});
    for(var i=0;i<choices.length;i++){
      var dst=choices[i];
      if(dst===src) return Object.assign({},fallback,{status:'SOURCE_LANGUAGE'});
      try{
        var t=title?await translateField(title,src,dst,engine):'';
        var b=body?await translateField(body,src,dst,engine):'';
        if(t!==null && b!==null){
          return {title:t,body:b,source_lang:src,display_lang:dst,translated:true,status:'TRANSLATED'};
        }
      }catch(_e){}
    }
    return Object.assign({},fallback,{status:'ORIGINAL_FALLBACK'});
  }
  w.GM_MESSAGE_LANGUAGE={version:VERSION,translate:translate,languageOrder:languageOrder};
})(window);
