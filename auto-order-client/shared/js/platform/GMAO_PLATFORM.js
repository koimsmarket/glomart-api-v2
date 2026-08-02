(function(){
  'use strict';
  function id(){
    let v=localStorage.getItem('GMAO_CLIENT_ID');
    if(!v){v='gmao-'+Date.now()+'-'+Math.random().toString(36).slice(2,10);localStorage.setItem('GMAO_CLIENT_ID',v);}
    return v;
  }
  const bridge=window.GMAO_ANDROID||null;
  window.GMAO_PLATFORM={
    kind:bridge?'android-webview':(/Tampermonkey|Userscript/i.test(navigator.userAgent)?'pc-userscript':'browser'),
    clientId:id(),
    notify(title,body){
      if(bridge&&bridge.notify){bridge.notify(String(title||''),String(body||''));return;}
      if('Notification' in window&&Notification.permission==='granted') new Notification(title,{body});
      else console.log('[GMAO][notify]',title,body);
    },
    deviceInfo(){
      if(bridge&&bridge.deviceInfo){try{return JSON.parse(bridge.deviceInfo());}catch{}}
      return {platform:navigator.platform,userAgent:navigator.userAgent,clientId:id()};
    },
    open(url){location.href=url;},
    close(){if(bridge&&bridge.close)bridge.close();}
  };
})();
