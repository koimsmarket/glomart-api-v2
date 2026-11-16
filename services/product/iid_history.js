'use strict';
// GM_CPKR_IID_HISTORY_V001: append-only observed PID + VID + IID identities.
// A missing manually-applied migration must never break ordinary product UPSERT.
const {cleanText}=require('./shared');
let missingSchemaWarned=false;
async function recordCoupangIids(pool,values,source){
  const seen=new Set();
  const rows=[];
  for(const row of (values||[])){
    const pid=cleanText(row&&row.product_id);
    const vid=cleanText(row&&row.vendor_item_id);
    const iid=cleanText(row&&row.item_id);
    if(!/^\d+$/.test(pid)||!/^\d+$/.test(vid)||!/^\d+$/.test(iid))continue;
    const key=pid+'|'+vid+'|'+iid;
    if(seen.has(key))continue;
    seen.add(key);rows.push([pid,vid,iid]);
  }
  if(!rows.length)return {ok:true,recorded:0};
  const params=[];
  const tuples=rows.map((r,i)=>{
    params.push(...r);
    return '('+[1,2,3].map(n=>'$'+(3*i+n)).join(',')+')';
  });
  params.push(cleanText(source).slice(0,40)||'unknown');
  try{
    await pool.query(`INSERT INTO gm_coupang_iid_history
      (product_id,vendor_item_id,item_id,first_seen_at,last_seen_at,seen_count,last_source)
      SELECT v.pid,v.vid,v.iid,now(),now(),1,$${params.length}
      FROM (VALUES ${tuples.join(',')}) AS v(pid,vid,iid)
      ON CONFLICT (product_id,vendor_item_id,item_id) DO UPDATE SET
        last_seen_at=now(),seen_count=gm_coupang_iid_history.seen_count+1,
        last_source=EXCLUDED.last_source`,params);
    return {ok:true,recorded:rows.length};
  }catch(e){
    if(e&&e.code==='42P01'){
      if(!missingSchemaWarned){
        missingSchemaWarned=true;
        console.warn('[GM_CPKR_IID_HISTORY_MIGRATION_REQUIRED] table=gm_coupang_iid_history');
      }
    }else console.warn('[GM_CPKR_IID_HISTORY_SAVE_WARN]',{code:e&&e.code||'ERROR',source:cleanText(source)});
    return {ok:false,recorded:0};
  }
}
module.exports={recordCoupangIids};
