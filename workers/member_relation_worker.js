
'use strict';

let started=false;
function kstParts(d=new Date()){
  const x=new Date(d.getTime()+9*60*60*1000);
  return {date:x.toISOString().slice(0,10),hour:x.getUTCHours(),minute:x.getUTCMinutes()};
}

async function processPending(pool,eventService){
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const rows=await client.query(`SELECT member_id FROM gm_member
      WHERE relation_calculated_yn='N'
        AND recommender_updated_at IS NOT NULL
        AND recommender_updated_at < (date_trunc('day',NOW() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul')
      ORDER BY recommender_updated_at,member_id
      FOR UPDATE SKIP LOCKED`);
    const results=[];
    for(const row of rows.rows){ results.push(await eventService.applyMemberAttach(client,{member_id:row.member_id})); }
    await client.query('COMMIT');
    return {count:rows.rowCount,results};
  }catch(e){ try{await client.query('ROLLBACK');}catch(_e){} throw e; }
  finally{client.release();}
}

function startMemberRelationWorker(pool,eventService){
  if(started) return; started=true;
  let running=false,lastRunDate='';
  const tick=async()=>{
    if(running) return;
    const p=kstParts();
    if(p.hour!==2 || p.minute>9 || lastRunDate===p.date) return;
    running=true;
    try{
      const table=await pool.query(`SELECT to_regclass('public.gm_member') AS member_table,to_regclass('public.gm_member_relation_count') AS relation_table`);
      const r=table.rows[0]||{};
      if(!r.member_table || !r.relation_table){ console.error('[MEMBER_RELATION_WORKER_DISABLED] required table missing'); lastRunDate=p.date; return; }
      const result=await processPending(pool,eventService);
      lastRunDate=p.date;
      console.log('[MEMBER_RELATION_NIGHT_DONE]',JSON.stringify({kst_date:p.date,count:result.count}));
    }catch(e){ console.error('[MEMBER_RELATION_NIGHT_FAIL]',String(e&&e.message||e)); }
    finally{running=false;}
  };
  const timer=setInterval(tick,60000); if(timer.unref) timer.unref(); setTimeout(tick,5000);
  console.log('[MEMBER_RELATION_WORKER] started KST 02:00-02:09');
}
module.exports={startMemberRelationWorker};
