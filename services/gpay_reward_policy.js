'use strict';
// GM_GPAY_REWARD_POLICY_V002: gm_runtime_config is the only mutable reward percentage.
const KEY='gpay_reward_rate_pct';
const DEFAULT_PERCENT=2.5; // Used only before the policy row is migrated; never silently on DB failure.
function validate(v){
 const n=Number(v);
 if(!Number.isFinite(n)||n<0||n>100||!/^\d+(?:\.\d{1,2})?$/.test(String(v).trim()))throw Error('GPAY_REWARD_RATE_INVALID');
 return n;
}
async function getPercent(db){
 const r=await db.query('SELECT config_value,enabled FROM gm_runtime_config WHERE config_key=$1',[KEY]);
 if(!r.rows.length)return DEFAULT_PERCENT;
 if(r.rows[0].enabled!==true)throw Error('GPAY_REWARD_POLICY_DISABLED');
 return validate(r.rows[0].config_value);
}
async function getRate(db){return (await getPercent(db))/100;}
function floor10(v){return Math.floor(Math.max(0,Number(v)||0)/10)*10;}
function rewardForPaidProduct(paid,rate){
 if(!Number.isFinite(rate)||rate<0||rate>1)throw Error('GPAY_REWARD_RATE_INVALID');
 return floor10(Math.max(0,Number(paid)||0)*rate);
}
module.exports={KEY,DEFAULT_PERCENT,validate,getPercent,getRate,rewardForPaidProduct};
