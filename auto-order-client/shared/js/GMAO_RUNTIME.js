(function(){
  'use strict';
  const A=window.GMAO_API,Q=window.GM_AUTO_ORDER_QUEUE,P=window.GMAO_PLATFORM,C=window.GMAO_CONFIG;
  let running=false,timer=null;
  async function cycle(){
    if(running)return; running=true;
    try{
      await A.register().catch(()=>null);
      const current=Q.getOrder();
      if(!current){
        const claimed=await A.claim();
        const job=claimed.job||claimed.work||claimed.data;
        if(job){Q.setOrder(job.payload||job);P.notify('자동주문 작업 배정',job.auto_order_no||job.work_id||'새 작업');window.GMAO_START();}
      }
      await A.heartbeat(Q.getState()).catch(()=>null);
    }catch(e){console.warn('[GMAO_RUNTIME]',e.message||e);}finally{running=false;}
  }
  window.GMAO_RUNTIME={start(){if(timer)return;cycle();timer=setInterval(cycle,C.pollMs);},stop(){clearInterval(timer);timer=null;},cycle};
})();
