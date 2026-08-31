'use strict';
/* GM_IMAGE_VECTOR_DISTRIBUTOR_V001
 * VECTOR allocation policy only. Search/runtime/collector code is not involved.
 * Operational policy can be changed here without changing category control.
 */
const POLICY={
  normal:{server_weight:0,phone_weight:100},
  special:{server_weight:80,phone_weight:20,phone_remaining_next_search:5}
};
function n(v,d){v=Number(v);return Number.isFinite(v)?v:d;}
function policy(mode='special',override={}){
  const base=Object.assign({},POLICY[mode]||POLICY.special,override||{});
  const sw=Math.max(0,n(base.server_weight,80)), pw=Math.max(0,n(base.phone_weight,20));
  const sum=sw+pw;
  base.server_weight=sw;base.phone_weight=pw;
  base.server_ratio=sum>0?sw/sum:0;
  base.phone_ratio=sum>0?pw/sum:0;
  base.phone_remaining_next_search=Math.max(0,Math.floor(n(base.phone_remaining_next_search,5)));
  return base;
}
function split(items,mode='special',override={}){
  const a=Array.isArray(items)?items:[],p=policy(mode,override);
  let serverCount=Math.round(a.length*p.server_ratio);
  serverCount=Math.max(0,Math.min(a.length,serverCount));
  return {policy:p,server:a.slice(0,serverCount),phone:a.slice(serverCount)};
}
module.exports={version:'GM_IMAGE_VECTOR_DISTRIBUTOR_V001',POLICY,policy,split};
