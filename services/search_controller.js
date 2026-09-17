'use strict';
// GM_SEARCH_CONTROLLER_V002
// Central controller for external-search interval and product-queue allowed concurrency.

const os = require('os');

function C(v){ return String(v==null?'':v).replace(/[\u00A0\u200B-\u200D\uFEFF]/g,' ').replace(/\s+/g,' ').trim(); }
function num(v,d){ const x=Number(v); return Number.isFinite(x)?x:d; }
let cfgCache={at:0,values:{}};
let lastConcurrencyLog={value:null,at:0};

async function loadConfig(pool){
  const now=Date.now();
  if(now-cfgCache.at<5000) return cfgCache.values;
  const keys=['external_search_interval_hours','product_queue_concurrency_min','product_queue_concurrency_max'];
  const r=await pool.query(`SELECT config_key,config_value FROM gm_runtime_config WHERE enabled=TRUE AND config_key = ANY($1::text[])`,[keys]);
  const values={};
  for(const row of r.rows||[]) values[row.config_key]=row.config_value;
  cfgCache={at:now,values};
  return values;
}

async function externalSearchDecision(pool, normalized){
  const normalizeOk=!!normalized && normalized.ok!==false && !!normalized.matched && !normalized.fallback && !normalized.need_dictionary_save;
  const keyword=C(normalized && (normalized.keyword_canonical||normalized.normalized_keyword||normalized.search_keyword_ko||normalized.keyword_ko));
  const cfg=await loadConfig(pool);
  const intervalHours=Math.max(0,num(cfg.external_search_interval_hours,24));

  if(!normalizeOk || !keyword){
    return {external_search_required:true,reason:'NORMALIZE_MISS',interval_hours:intervalHours,db_count:0,db_groups:{CPKR:0,ALKR:0},last_success_at:null};
  }

  // "DB 검색키 연결 성공"은 상품명 유사검색이 아니라 저장된 검색키의 정확 일치로 확인한다.
  const dbq=await pool.query(`
    SELECT mall_code, COUNT(*)::int AS c
    FROM gm_product
    WHERE mall_code IN ('CPKR','ALKR')
      AND COALESCE(sale_status,'active')='active'
      AND COALESCE(soldout_yn,'N')<>'Y'
      AND (BTRIM(COALESCE(keyword,''))=$1 OR BTRIM(COALESCE(category_keyword,''))=$1)
    GROUP BY mall_code`,[keyword]);
  const groups={CPKR:0,ALKR:0};
  for(const row of dbq.rows||[]) if(Object.prototype.hasOwnProperty.call(groups,row.mall_code)) groups[row.mall_code]=Number(row.c||0);
  const dbCount=groups.CPKR+groups.ALKR;

  // 둘 중 하나라도 DB 결과가 없으면 두 외부몰을 공통 인터벌로 다시 검색한다.
  if(groups.CPKR<=0 || groups.ALKR<=0){
    return {external_search_required:true,reason:'DB_RESULT_INCOMPLETE',interval_hours:intervalHours,db_count:dbCount,db_groups:groups,last_success_at:null};
  }
  if(intervalHours<=0){
    return {external_search_required:true,reason:'INTERVAL_DISABLED',interval_hours:intervalHours,db_count:dbCount,db_groups:groups,last_success_at:null};
  }

  // 기존 검색로그를 재사용한다. 양쪽 결과가 모두 1건 이상인 검색만 정상 외부검색으로 인정한다.
  // 실패/403/timeout으로 결과가 들어오지 않은 이벤트는 이 조건을 만족하지 않아 성공시간을 갱신하지 않는다.
  const logq=await pool.query(`
    SELECT MAX(search_at) AS last_success_at
    FROM gm_search_log
    WHERE (keyword_normalized=$1 OR keyword_canonical=$1)
      AND COALESCE(cpkr_result_count,0)>0
      AND COALESCE(alkr_result_count,0)>0`,[keyword]);
  const last=logq.rows[0]&&logq.rows[0].last_success_at;
  if(!last){
    return {external_search_required:true,reason:'NO_SUCCESS_LOG',interval_hours:intervalHours,db_count:dbCount,db_groups:groups,last_success_at:null};
  }
  const ageMs=Date.now()-new Date(last).getTime();
  const valid=Number.isFinite(ageMs) && ageMs>=0 && ageMs<(intervalHours*3600000);
  return {external_search_required:!valid,reason:valid?'INTERVAL_VALID':'INTERVAL_EXPIRED',interval_hours:intervalHours,db_count:dbCount,db_groups:groups,last_success_at:last};
}

async function allowedConcurrency(pool, active){
  const cfg=await loadConfig(pool);
  const min=Math.max(1,Math.round(num(cfg.product_queue_concurrency_min,2)));
  const cpuCount=Math.max(1,(os.cpus()||[]).length||1);
  const poolMax=Math.max(2,Number(pool&&pool.options&&pool.options.max||10));
  const configuredMax=Math.round(num(cfg.product_queue_concurrency_max,0));
  const autoMax=Math.max(min,Math.min(cpuCount*2,Math.max(1,poolMax-2)));
  const max=configuredMax>0?Math.max(min,configuredMax):autoMax;

  const q=await pool.query(`SELECT COUNT(*) FILTER (WHERE status='pending')::int AS pending FROM gm_product_upsert_queue WHERE status='pending'`);
  const pending=Number(q.rows[0]&&q.rows[0].pending||0);
  const activeNow=Math.max(0,Number(active)||0);
  if(pending<=0 && activeNow<=0) return min;

  const load1=(os.loadavg&&os.loadavg()[0])||0;
  const cpuRatio=load1/cpuCount;
  const totalMem=Math.max(1,Number(os.totalmem&&os.totalmem()||1));
  const freeMem=Math.max(0,Number(os.freemem&&os.freemem()||0));
  const memUsedRatio=1-(freeMem/totalMem);
  const poolWaiting=Math.max(0,Number(pool&&pool.waitingCount||0));
  const poolTotal=Math.max(0,Number(pool&&pool.totalCount||0));
  const poolIdle=Math.max(0,Number(pool&&pool.idleCount||0));
  const dbBusyRatio=poolMax>0?Math.max(0,Math.min(1,(poolTotal-poolIdle)/poolMax)):0;

  let allowed=Math.min(max,Math.max(min,pending+activeNow));
  if(poolWaiting>0 || dbBusyRatio>=0.90 || cpuRatio>=0.95 || memUsedRatio>=0.90){
    allowed=Math.max(min,Math.min(allowed,Math.max(activeNow,min)));
  }else if(dbBusyRatio>=0.75 || cpuRatio>=0.80 || memUsedRatio>=0.82){
    allowed=Math.max(min,Math.min(allowed,Math.max(min,Math.ceil(max/2))));
  }

  const now=Date.now();
  if(lastConcurrencyLog.value!==allowed || now-lastConcurrencyLog.at>=15000){
    lastConcurrencyLog={value:allowed,at:now};
    console.log('[GM_PRODUCT_QUEUE_CONCURRENCY]',{
      allowedConcurrency:allowed,min,max,pending,active:activeNow,
      cpu_count:cpuCount,cpu_load_ratio:Number(cpuRatio.toFixed(3)),
      memory_used_ratio:Number(memUsedRatio.toFixed(3)),
      db_pool_max:poolMax,db_pool_total:poolTotal,db_pool_idle:poolIdle,db_pool_waiting:poolWaiting,db_busy_ratio:Number(dbBusyRatio.toFixed(3))
    });
  }
  return allowed;
}

module.exports={externalSearchDecision,allowedConcurrency};
