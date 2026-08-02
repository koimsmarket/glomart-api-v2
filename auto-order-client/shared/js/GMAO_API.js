(function(){
  'use strict';
  const C=window.GMAO_CONFIG;
  const P=window.GMAO_PLATFORM;
  async function req(path,opt={}){
    const r=await fetch(C.apiBase+path,Object.assign({credentials:'include',headers:{'Content-Type':'application/json'}},opt));
    const t=await r.text(); let j; try{j=JSON.parse(t);}catch{throw new Error('non-json '+r.status+': '+t.slice(0,200));}
    if(!r.ok||j.ok===false)throw new Error(j.error||j.message||('HTTP '+r.status)); return j;
  }
  window.GMAO_API={
    async register(){return req('/api/auto-order/runtime/register',{method:'POST',body:JSON.stringify({client_id:P.clientId,mall_code:C.mallCode,platform:P.kind,device:P.deviceInfo()})});},
    async heartbeat(state){return req('/api/auto-order/runtime/heartbeat',{method:'POST',body:JSON.stringify({client_id:P.clientId,state:state||{}})});},
    async claim(){return req('/api/auto-order/runtime/claim',{method:'POST',body:JSON.stringify({client_id:P.clientId,mall_code:C.mallCode})});},
    async update(workId,state,extra){return req('/api/auto-order/runtime/work/'+encodeURIComponent(workId)+'/state',{method:'POST',body:JSON.stringify(Object.assign({client_id:P.clientId,state},extra||{}))});}
  };
})();
