'use strict';
const express = require('express');
const router = express.Router();
const VERSION = 'GM_MESSAGE_API_V004_BROADCAST_QUEUE_NIGHT_SEND_SMARTFIT';
console.log('[GM_MESSAGE_ROUTE] loaded', VERSION);

function db(req){ return req.app.locals.db || req.app.locals.pool; }
function s(v,d=''){ return v===undefined || v===null ? d : String(v).replace(/[\u00A0\u200B-\u200D\uFEFF]/g,' ').replace(/\s+/g,' ').trim(); }
function yn(v, def='N'){
  const x=s(v).toUpperCase();
  if(['Y','YES','TRUE','T','1'].includes(x)) return 'Y';
  if(['N','NO','FALSE','F','0'].includes(x)) return 'N';
  return def;
}
function jsonb(v, def={}){ if(v===undefined || v===null || v==='') return def; if(typeof v==='string'){ try{return JSON.parse(v);}catch(e){return def;} } return v; }
function ok(res,data={}){ res.json({ ok:true, version:VERSION, ...data }); }
function fail(res,status,error,extra={}){ res.status(status).json({ ok:false, version:VERSION, error, ...extra }); }
function kstDate(){ const d=new Date(Date.now()+9*60*60*1000); const p=x=>String(x).padStart(2,'0'); return `${d.getUTCFullYear()}${p(d.getUTCMonth()+1)}${p(d.getUTCDate())}`; }
async function nextNo(pool, table, col, prefix){
  const date = kstDate();
  const like = `${date}_%`;
  const q = `SELECT ${col} AS no FROM ${table} WHERE ${col} LIKE $1 ORDER BY ${col} DESC LIMIT 1`;
  const r = await pool.query(q, [like]);
  let n = 1;
  if(r.rows[0] && r.rows[0].no){
    const m = String(r.rows[0].no).match(/_(\d+)$/);
    if(m) n = Number(m[1]) + 1;
  }
  return `${date}_${String(n).padStart(9,'0')}`;
}
async function policy(pool, type){
  const mt=s(type||'NOTICE').toUpperCase();
  const r=await pool.query('SELECT * FROM gm_message_policy WHERE message_type=$1', [mt]);
  return r.rows[0] || { message_type:mt, retention_days:30, track_receive:'N', track_read:'Y', track_click:'N', is_security:'N' };
}
async function bumpDaily(pool, scope, type, field, inc=1){
  const allowed = new Set(['send_count','receive_count','read_count','click_count','save_count']);
  if(!allowed.has(field)) return;
  await pool.query(`INSERT INTO gm_message_counter_daily(counter_date,message_scope,message_type,${field}) VALUES((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul')::date,$1,$2,$3) ON CONFLICT(counter_date,message_scope,message_type) DO UPDATE SET ${field}=gm_message_counter_daily.${field}+EXCLUDED.${field}`,[scope,s(type).toUpperCase(),Number(inc)||1]);
}

const BROADCAST_MIN_DELAY_MINUTES = 30;
const BROADCAST_DEFAULT_CHUNK_SIZE = 1000;
const BROADCAST_MAX_CHUNK_SIZE = 1000;
const BROADCAST_BULK_THRESHOLD = 10000;
const BROADCAST_NIGHT_START_HOUR = 0;
const BROADCAST_NIGHT_END_HOUR = 6;

function kstNow(){ return new Date(Date.now()+9*60*60*1000); }
function kstHour(){ return kstNow().getUTCHours(); }
function isNightKst(){
  const h = kstHour();
  if(BROADCAST_NIGHT_START_HOUR < BROADCAST_NIGHT_END_HOUR) return h >= BROADCAST_NIGHT_START_HOUR && h < BROADCAST_NIGHT_END_HOUR;
  return h >= BROADCAST_NIGHT_START_HOUR || h < BROADCAST_NIGHT_END_HOUR;
}
function urgentFlag(v){ return yn(v,'N') === 'Y'; }
function safeChunkSize(v){ return Math.min(BROADCAST_MAX_CHUNK_SIZE, Math.max(1, Number(v || BROADCAST_DEFAULT_CHUNK_SIZE) || BROADCAST_DEFAULT_CHUNK_SIZE)); }
function delayInfo(row){
  const created = row && row.created_at ? new Date(row.created_at).getTime() : Date.now();
  const availableAt = new Date(created + BROADCAST_MIN_DELAY_MINUTES * 60 * 1000);
  const now = Date.now();
  const waitMs = Math.max(0, availableAt.getTime() - now);
  return { available_at: availableAt.toISOString(), wait_seconds: Math.ceil(waitMs/1000), ready: waitMs <= 0 };
}
function broadcastSendGuard(row, opts={}){
  const urgent = urgentFlag(opts.urgent || opts.is_urgent || row?.is_urgent);
  const targetCount = Number(opts.target_count || row?.target_count || row?.send_count || 0) || 0;
  const d = delayInfo(row || {});
  if(!urgent && !d.ready){
    return { ok:false, reason:'BROADCAST_30_MIN_WAIT', message:'단체메시지는 작성 후 30분 이후 발송 가능합니다.', ...d };
  }
  if(!urgent && targetCount >= BROADCAST_BULK_THRESHOLD && !isNightKst()){
    return { ok:false, reason:'BROADCAST_BULK_NIGHT_ONLY', message:'대량 단체메시지는 긴급을 제외하고 KST 심야 시간대에만 발송 가능합니다.', target_count:targetCount, kst_hour:kstHour(), night_start:BROADCAST_NIGHT_START_HOUR, night_end:BROADCAST_NIGHT_END_HOUR };
  }
  return { ok:true, urgent, target_count:targetCount, ...d, kst_hour:kstHour() };
}


router.get('/api/gm/message/health',(req,res)=>ok(res,{ route:'message' }));

router.get('/api/gm/message/policy', async (req,res)=>{
  try{ const pool=db(req); const r=await pool.query('SELECT * FROM gm_message_policy ORDER BY message_type'); ok(res,{ items:r.rows }); }
  catch(e){ fail(res,500,'policy list failed',{ detail:String(e.message||e) }); }
});

router.post('/api/gm/message/policy/upsert', async (req,res)=>{
  try{
    const pool=db(req), b=req.body||{}; const mt=s(b.message_type).toUpperCase(); if(!mt) return fail(res,400,'message_type required');
    const retention = Math.max(1, Number(b.retention_days||30));
    const r=await pool.query(`INSERT INTO gm_message_policy(message_type,retention_days,track_receive,track_read,track_click,is_security,note,updated_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,CURRENT_TIMESTAMP)
      ON CONFLICT(message_type) DO UPDATE SET retention_days=EXCLUDED.retention_days, track_receive=EXCLUDED.track_receive, track_read=EXCLUDED.track_read, track_click=EXCLUDED.track_click, is_security=EXCLUDED.is_security, note=EXCLUDED.note, updated_at=CURRENT_TIMESTAMP
      RETURNING *`, [mt,retention,yn(b.track_receive,'N'),yn(b.track_read,'Y'),yn(b.track_click,'N'),yn(b.is_security,'N'),s(b.note)]);
    ok(res,{ item:r.rows[0] });
  }catch(e){ fail(res,500,'policy upsert failed',{ detail:String(e.message||e) }); }
});



router.get('/api/gm/message/settings', async (req,res)=>{
  try{
    const pool=db(req), member=s(req.query.member_id||req.query.memberId); if(!member) return fail(res,400,'member_id required');
    const r=await pool.query(`SELECT member_id, allow_message_personal, allow_message_broadcast, allow_message_ad, allow_message_share,
      notification_timezone_code, notification_timezone_label, notification_time_start, notification_time_end
      FROM gm_member WHERE member_id=$1`,[member]);
    if(!r.rowCount) return fail(res,404,'member not found');
    ok(res,{ settings:r.rows[0] });
  }catch(e){ fail(res,500,'settings get failed',{ detail:String(e.message||e) }); }
});

router.post('/api/gm/message/settings/save', async (req,res)=>{
  try{
    const pool=db(req), b=req.body||{}; const member=s(b.member_id||b.memberId); if(!member) return fail(res,400,'member_id required');
    const tzCode=s(b.notification_timezone_code||b.timezone_code||'Asia/Seoul');
    const tzLabel=s(b.notification_timezone_label||b.timezone_label||'KST (UTC+09:00)');
    const start=s(b.notification_time_start||b.notify_start||'09:00');
    const end=s(b.notification_time_end||b.notify_end||'21:00');
    const r=await pool.query(`UPDATE gm_member SET
      allow_message_personal=$2,
      allow_message_broadcast=$3,
      allow_message_ad=$4,
      allow_message_share=$5,
      notification_timezone_code=$6,
      notification_timezone_label=$7,
      notification_time_start=$8::time,
      notification_time_end=$9::time,
      updated_at=CURRENT_TIMESTAMP
      WHERE member_id=$1
      RETURNING member_id, allow_message_personal, allow_message_broadcast, allow_message_ad, allow_message_share, notification_timezone_code, notification_timezone_label, notification_time_start, notification_time_end`,
      [member,yn(b.allow_message_personal,'Y'),yn(b.allow_message_broadcast,'Y'),yn(b.allow_message_ad,'Y'),yn(b.allow_message_share,'Y'),tzCode,tzLabel,start,end]);
    if(!r.rowCount) return fail(res,404,'member not found');
    ok(res,{ settings:r.rows[0] });
  }catch(e){ fail(res,500,'settings save failed',{ detail:String(e.message||e) }); }
});

router.post('/api/gm/message/personal/create', async (req,res)=>{
  try{
    const pool=db(req), b=req.body||{}; const member=s(b.member_id||b.memberId); if(!member) return fail(res,400,'member_id required');
    const mt=s(b.message_type||b.type||'NOTICE').toUpperCase(); const no=s(b.message_no)||await nextNo(pool,'gm_message_personal','message_no');
    const r=await pool.query(`INSERT INTO gm_message_personal(message_no,member_id,message_type,title,message,move_type,move_value,action_json,priority)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9) RETURNING *`, [no,member,mt,s(b.title),s(b.message),s(b.move_type),s(b.move_value),JSON.stringify(jsonb(b.action_json,{})),s(b.priority||'NORMAL').toUpperCase()]);
    await bumpDaily(pool,'PERSONAL',mt,'send_count',1);
    ok(res,{ item:r.rows[0] });
  }catch(e){ fail(res,500,'personal create failed',{ detail:String(e.message||e) }); }
});

router.get('/api/gm/message/personal/list', async (req,res)=>{
  try{
    const pool=db(req), member=s(req.query.member_id||req.query.memberId); if(!member) return fail(res,400,'member_id required');
    const limit=Math.min(200,Math.max(1,Number(req.query.limit||50)));
    const r=await pool.query('SELECT * FROM gm_message_personal WHERE member_id=$1 ORDER BY created_at DESC LIMIT $2',[member,limit]);
    const c=await pool.query("SELECT COUNT(*)::int AS unread FROM gm_message_personal WHERE member_id=$1 AND is_read='N'",[member]);
    ok(res,{ items:r.rows, unread_count:c.rows[0].unread });
  }catch(e){ fail(res,500,'personal list failed',{ detail:String(e.message||e) }); }
});

router.post('/api/gm/message/personal/read', async (req,res)=>{
  try{
    const pool=db(req), b=req.body||{}; const member=s(b.member_id||b.memberId); const no=s(b.message_no||b.messageNo);
    if(!member||!no) return fail(res,400,'member_id and message_no required');
    const r=await pool.query("UPDATE gm_message_personal SET is_read='Y', read_at=COALESCE(read_at,CURRENT_TIMESTAMP) WHERE member_id=$1 AND message_no=$2 RETURNING *",[member,no]);
    if(r.rowCount) await bumpDaily(pool,'PERSONAL',r.rows[0].message_type,'read_count',1);
    ok(res,{ updated:r.rowCount, item:r.rows[0]||null });
  }catch(e){ fail(res,500,'personal read failed',{ detail:String(e.message||e) }); }
});

router.post('/api/gm/message/broadcast/create', async (req,res)=>{
  try{
    const pool=db(req), b=req.body||{}; const mt=s(b.message_type||b.type||'NOTICE').toUpperCase(); const p=await policy(pool,mt);
    const no=s(b.broadcast_no)||await nextNo(pool,'gm_message_broadcast','broadcast_no');
    const trackReceive = b.track_receive===undefined ? p.track_receive : yn(b.track_receive,'N');
    const trackRead = b.track_read===undefined ? p.track_read : yn(b.track_read,'N');
    const trackClick = b.track_click===undefined ? p.track_click : yn(b.track_click,'N');
    let status=s(b.status||'waiting').toLowerCase();
    const r=await pool.query(`INSERT INTO gm_message_broadcast(broadcast_no,message_type,title,message,target_rule_json,move_type,move_value,action_json,track_receive,track_read,track_click,status,start_at,end_at,created_by)
      VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8::jsonb,$9,$10,$11,$12,COALESCE($13::timestamp,CURRENT_TIMESTAMP),$14::timestamp,$15) RETURNING *`,
      [no,mt,s(b.title),s(b.message),JSON.stringify(jsonb(b.target_rule_json||b.target_rule,{})),s(b.move_type),s(b.move_value),JSON.stringify(jsonb(b.action_json,{})),trackReceive,trackRead,trackClick,status,b.start_at||null,b.end_at||null,s(b.created_by||b.admin_id)]);
    const d=delayInfo(r.rows[0]);
    ok(res,{ item:r.rows[0], min_send_delay_minutes:BROADCAST_MIN_DELAY_MINUTES, send_available_at:d.available_at, wait_seconds:d.wait_seconds });
  }catch(e){ fail(res,500,'broadcast create failed',{ detail:String(e.message||e) }); }
});


router.get('/api/gm/message/broadcast/send-check', async (req,res)=>{
  try{
    const pool=db(req); const no=s(req.query.broadcast_no||req.query.broadcastNo); if(!no) return fail(res,400,'broadcast_no required');
    const br=await pool.query('SELECT * FROM gm_message_broadcast WHERE broadcast_no=$1',[no]); if(!br.rowCount) return fail(res,404,'broadcast not found');
    const targetCount = Number(req.query.target_count || br.rows[0].target_count || br.rows[0].send_count || 0) || 0;
    const guard=broadcastSendGuard(br.rows[0], { urgent:req.query.urgent||req.query.is_urgent, target_count:targetCount });
    ok(res,{ broadcast_no:no, can_send:guard.ok, guard });
  }catch(e){ fail(res,500,'broadcast send check failed',{ detail:String(e.message||e) }); }
});

router.post('/api/gm/message/broadcast/activate', async (req,res)=>{
  try{
    const pool=db(req), b=req.body||{}; const no=s(b.broadcast_no||b.broadcastNo); if(!no) return fail(res,400,'broadcast_no required');
    const br=await pool.query('SELECT * FROM gm_message_broadcast WHERE broadcast_no=$1',[no]); if(!br.rowCount) return fail(res,404,'broadcast not found');
    const targetCount = Number(b.target_count || br.rows[0].target_count || br.rows[0].send_count || 0) || 0;
    const guard=broadcastSendGuard(br.rows[0], { urgent:b.urgent||b.is_urgent, target_count:targetCount });
    if(!guard.ok) return fail(res,409,guard.reason,{ guard });
    const r=await pool.query("UPDATE gm_message_broadcast SET status='active', start_at=COALESCE(start_at,CURRENT_TIMESTAMP) WHERE broadcast_no=$1 RETURNING *",[no]);
    ok(res,{ item:r.rows[0], guard });
  }catch(e){ fail(res,500,'broadcast activate failed',{ detail:String(e.message||e) }); }
});

router.post('/api/gm/message/broadcast/job/create', async (req,res)=>{
  try{
    const pool=db(req), b=req.body||{}; const no=s(b.broadcast_no||b.broadcastNo); if(!no) return fail(res,400,'broadcast_no required');
    const br=await pool.query('SELECT * FROM gm_message_broadcast WHERE broadcast_no=$1',[no]); if(!br.rowCount) return fail(res,404,'broadcast not found');
    const targetCount = Math.max(0, Number(b.target_count || b.total_target_count || br.rows[0].target_count || 0) || 0);
    if(targetCount <= 0) return fail(res,400,'target_count required');
    const guard=broadcastSendGuard(br.rows[0], { urgent:b.urgent||b.is_urgent, target_count:targetCount });
    if(!guard.ok) return fail(res,409,guard.reason,{ guard });
    const chunkSize=safeChunkSize(b.chunk_size);
    const chunkTotal=Math.ceil(targetCount/chunkSize);
    const existing=await pool.query("SELECT COUNT(*)::int AS cnt FROM gm_message_broadcast_job WHERE broadcast_no=$1 AND status IN ('READY','RUNNING','DONE')",[no]);
    if((existing.rows[0]?.cnt||0)>0 && yn(b.recreate,'N')!=='Y') return fail(res,409,'broadcast jobs already exist',{ existing_count:existing.rows[0].cnt });
    if(yn(b.recreate,'N')==='Y') await pool.query("DELETE FROM gm_message_broadcast_job WHERE broadcast_no=$1 AND status<>'DONE'",[no]);
    let inserted=0;
    for(let i=1;i<=chunkTotal;i++){
      const startOffset=(i-1)*chunkSize;
      const cnt=Math.min(chunkSize, targetCount-startOffset);
      const jobNo=`${no}_${String(i).padStart(6,'0')}`;
      const ir=await pool.query(`INSERT INTO gm_message_broadcast_job(job_no,broadcast_no,chunk_no,status,target_count,chunk_size,start_offset)
        VALUES($1,$2,$3,'READY',$4,$5,$6) ON CONFLICT(job_no) DO NOTHING`,[jobNo,no,i,cnt,chunkSize,startOffset]);
      inserted += ir.rowCount;
    }
    await pool.query("UPDATE gm_message_broadcast SET status='sending', send_count=$2 WHERE broadcast_no=$1",[no,targetCount]);
    ok(res,{ broadcast_no:no, target_count:targetCount, chunk_size:chunkSize, chunk_total:chunkTotal, inserted_jobs:inserted, guard });
  }catch(e){ fail(res,500,'broadcast job create failed',{ detail:String(e.message||e) }); }
});

router.post('/api/gm/message/broadcast/job/claim', async (req,res)=>{
  try{
    const pool=db(req), b=req.body||{}; const no=s(b.broadcast_no||b.broadcastNo);
    const params=[]; let where="status='READY'";
    if(no){ params.push(no); where += ` AND broadcast_no=$${params.length}`; }
    const q=`WITH picked AS (SELECT job_no FROM gm_message_broadcast_job WHERE ${where} ORDER BY broadcast_no, chunk_no LIMIT 1 FOR UPDATE SKIP LOCKED)
      UPDATE gm_message_broadcast_job j SET status='RUNNING', started_at=CURRENT_TIMESTAMP, attempt_count=attempt_count+1
      FROM picked WHERE j.job_no=picked.job_no RETURNING j.*`;
    const r=await pool.query(q,params);
    ok(res,{ item:r.rows[0]||null, claimed:r.rowCount });
  }catch(e){ fail(res,500,'broadcast job claim failed',{ detail:String(e.message||e) }); }
});

router.post('/api/gm/message/broadcast/job/done', async (req,res)=>{
  try{
    const pool=db(req), b=req.body||{}; const jobNo=s(b.job_no||b.jobNo); if(!jobNo) return fail(res,400,'job_no required');
    const sent=Math.max(0,Number(b.sent_count||0)||0); const received=Math.max(0,Number(b.receive_count||sent)||0);
    const status=yn(b.failed,'N')==='Y' ? 'FAIL' : 'DONE';
    const r=await pool.query(`UPDATE gm_message_broadcast_job SET status=$2, sent_count=$3, receive_count=$4, error_message=$5, finished_at=CURRENT_TIMESTAMP WHERE job_no=$1 RETURNING *`,[jobNo,status,sent,received,s(b.error_message)]);
    if(!r.rowCount) return fail(res,404,'job not found');
    const brNo=r.rows[0].broadcast_no;
    const br=await pool.query('SELECT message_type FROM gm_message_broadcast WHERE broadcast_no=$1',[brNo]);
    if(br.rowCount && received>0) await bumpDaily(pool,'BROADCAST',br.rows[0].message_type,'receive_count',received);
    const remain=await pool.query("SELECT COUNT(*)::int AS cnt FROM gm_message_broadcast_job WHERE broadcast_no=$1 AND status IN ('READY','RUNNING')",[brNo]);
    if((remain.rows[0]?.cnt||0)===0){
      const failCnt=await pool.query("SELECT COUNT(*)::int AS cnt FROM gm_message_broadcast_job WHERE broadcast_no=$1 AND status='FAIL'",[brNo]);
      await pool.query("UPDATE gm_message_broadcast SET status=$2, receive_count=(SELECT COALESCE(SUM(receive_count),0) FROM gm_message_broadcast_job WHERE broadcast_no=$1) WHERE broadcast_no=$1",[brNo,(failCnt.rows[0]?.cnt||0)>0?'partial':'done']);
    }
    ok(res,{ item:r.rows[0] });
  }catch(e){ fail(res,500,'broadcast job done failed',{ detail:String(e.message||e) }); }
});

router.get('/api/gm/message/broadcast/job/list', async (req,res)=>{
  try{
    const pool=db(req); const no=s(req.query.broadcast_no||req.query.broadcastNo); if(!no) return fail(res,400,'broadcast_no required');
    const r=await pool.query('SELECT * FROM gm_message_broadcast_job WHERE broadcast_no=$1 ORDER BY chunk_no',[no]);
    ok(res,{ items:r.rows });
  }catch(e){ fail(res,500,'broadcast job list failed',{ detail:String(e.message||e) }); }
});

router.post('/api/gm/message/broadcast/receive', async (req,res)=>{
  try{
    const pool=db(req), b=req.body||{}; const no=s(b.broadcast_no||b.broadcastNo); const member=s(b.member_id||b.memberId);
    if(!no||!member) return fail(res,400,'broadcast_no and member_id required');
    const br=await pool.query('SELECT * FROM gm_message_broadcast WHERE broadcast_no=$1',[no]); if(!br.rowCount) return fail(res,404,'broadcast not found');
    const item=br.rows[0];
    if(item.track_receive==='Y'){
      await pool.query('INSERT INTO gm_message_broadcast_receive(broadcast_no,member_id,received_at) VALUES($1,$2,CURRENT_TIMESTAMP) ON CONFLICT(broadcast_no,member_id) DO NOTHING',[no,member]);
      await pool.query('UPDATE gm_message_broadcast SET receive_count=receive_count+1 WHERE broadcast_no=$1',[no]);
      await bumpDaily(pool,'BROADCAST',item.message_type,'receive_count',1);
    }
    ok(res,{ tracked:item.track_receive==='Y' });
  }catch(e){ fail(res,500,'broadcast receive failed',{ detail:String(e.message||e) }); }
});

router.get('/api/gm/message/broadcast/list', async (req,res)=>{
  try{
    const pool=db(req); const limit=Math.min(200,Math.max(1,Number(req.query.limit||50)));
    const r=await pool.query("SELECT * FROM gm_message_broadcast WHERE status='active' AND start_at<=CURRENT_TIMESTAMP AND (end_at IS NULL OR end_at>=CURRENT_TIMESTAMP) ORDER BY start_at DESC LIMIT $1",[limit]);
    ok(res,{ items:r.rows });
  }catch(e){ fail(res,500,'broadcast list failed',{ detail:String(e.message||e) }); }
});

router.post('/api/gm/message/broadcast/action', async (req,res)=>{
  try{
    const pool=db(req), b=req.body||{}; const no=s(b.broadcast_no||b.broadcastNo); const member=s(b.member_id||b.memberId); const action=s(b.action||'read').toLowerCase();
    if(!no||!member) return fail(res,400,'broadcast_no and member_id required');
    const br=await pool.query('SELECT * FROM gm_message_broadcast WHERE broadcast_no=$1',[no]); if(!br.rowCount) return fail(res,404,'broadcast not found');
    const item=br.rows[0];
    if(action==='read' && item.track_read==='Y'){
      await pool.query('INSERT INTO gm_message_broadcast_receive(broadcast_no,member_id,received_at,read_at) VALUES($1,$2,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(broadcast_no,member_id) DO UPDATE SET read_at=COALESCE(gm_message_broadcast_receive.read_at,CURRENT_TIMESTAMP)',[no,member]);
      await pool.query('UPDATE gm_message_broadcast SET read_count=read_count+1 WHERE broadcast_no=$1',[no]);
      await bumpDaily(pool,'BROADCAST',item.message_type,'read_count',1);
    }
    if(action==='click' && item.track_click==='Y'){
      await pool.query('INSERT INTO gm_message_broadcast_receive(broadcast_no,member_id,received_at,clicked_at) VALUES($1,$2,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(broadcast_no,member_id) DO UPDATE SET clicked_at=COALESCE(gm_message_broadcast_receive.clicked_at,CURRENT_TIMESTAMP)',[no,member]);
      await pool.query('UPDATE gm_message_broadcast SET click_count=click_count+1 WHERE broadcast_no=$1',[no]);
      await bumpDaily(pool,'BROADCAST',item.message_type,'click_count',1);
    }
    ok(res,{ action, tracked:true });
  }catch(e){ fail(res,500,'broadcast action failed',{ detail:String(e.message||e) }); }
});


async function getShareReceivers(pool, sender, maxChon){
  const depth = Math.max(1, Math.min(5, Number(maxChon||1)));
  const q = `WITH RECURSIVE downline AS (
      SELECT member_id, 1 AS chon_depth
      FROM gm_member
      WHERE recommender_id=$1 AND COALESCE(allow_message_share,'Y')='Y'
        AND NOT EXISTS (
          SELECT 1 FROM gm_smartfit_subscribe reject_state
          WHERE reject_state.member_id=gm_member.member_id
            AND reject_state.creator_member_id=$1
            AND reject_state.message_accept_yn='N'
        )
    UNION ALL
      SELECT m.member_id, d.chon_depth + 1
      FROM gm_member m
      JOIN downline d ON m.recommender_id=d.member_id
      WHERE d.chon_depth < $2 AND COALESCE(m.allow_message_share,'Y')='Y'
        AND NOT EXISTS (
          SELECT 1 FROM gm_smartfit_subscribe reject_state
          WHERE reject_state.member_id=m.member_id
            AND reject_state.creator_member_id=$1
            AND reject_state.message_accept_yn='N'
        )
    )
    SELECT member_id, chon_depth FROM downline WHERE member_id <> $1 ORDER BY chon_depth, member_id`;
  const r = await pool.query(q, [sender, depth]);
  return r.rows || [];
}


async function getCreatorCollectors(pool, creator){
  creator = s(creator);
  if(!creator) return [];
  const r = await pool.query(`SELECT DISTINCT c.member_id, 0 AS chon_depth
    FROM gm_smartfit_collection c
    JOIN gm_smartfit_template t ON t.template_id=c.template_id
    WHERE t.creator_member_id=$1
      AND c.is_active='T' AND COALESCE(c.is_deleted,'F')<>'T'
      AND c.member_id<>$1
      AND NOT EXISTS (
        SELECT 1 FROM gm_smartfit_subscribe reject_state
        WHERE reject_state.member_id=c.member_id
          AND reject_state.creator_member_id=$1
          AND reject_state.message_accept_yn='N'
      )
    ORDER BY c.member_id`, [creator]);
  return r.rows || [];
}
function dedupeReceivers(rows){
  const map = new Map();
  (rows || []).forEach(function(x){
    const id = s(x.member_id || x.receiver_member_id);
    if(!id) return;
    const depth = Number(x.chon_depth || 0);
    if(!map.has(id) || depth < Number(map.get(id).chon_depth || 99)) map.set(id, { member_id:id, chon_depth:depth });
  });
  return Array.from(map.values());
}

router.post('/api/gm/message/smartfit/template/share-create', async (req,res)=>{
  try{
    const pool=db(req), b=req.body||{};
    const sender=s(b.sender_member_id||b.senderMemberId||b.member_id);
    if(!sender) return fail(res,400,'sender_member_id required');
    const refNo=s(b.ref_no||b.template_id||b.templateId);
    if(!refNo) return fail(res,400,'template_id/ref_no required');
    const spaceNo=s(b.space_no||b.spaceNo||b.space_id||b.spaceId);
    const includeReferral=yn(b.include_referral,'Y')==='Y';
    const includeSubscribers=yn(b.include_subscribers,'Y')==='Y';
    const requestedDepth = Math.max(1, Math.min(5, Number(b.target_chon_max||b.targetChonMax||b.chon_max||1)));

    const mr=await pool.query("SELECT COALESCE(message_send_chon_max,1) AS max_chon FROM gm_member WHERE member_id=$1",[sender]);
    const allowedDepth = Math.max(1, Math.min(5, Number(mr.rows[0]?.max_chon || 1)));
    const targetDepth = Math.min(requestedDepth, allowedDepth);

    const referralRows = includeReferral ? await getShareReceivers(pool, sender, targetDepth) : [];
    const subscriberRows = includeSubscribers ? await getCreatorCollectors(pool, sender) : [];
    const receivers = dedupeReceivers([].concat(referralRows, subscriberRows));

    const no=s(b.share_no)||await nextNo(pool,'gm_message_share','share_no');
    const shareType=s(b.share_type||'SMARTFIT_TEMPLATE').toUpperCase();
    const target={ type:'SMARTFIT_TEMPLATE_MIXED', sender_member_id:sender, ref_no:refNo, space_no:spaceNo||null, include_referral:includeReferral?'Y':'N', include_subscribers:includeSubscribers?'Y':'N', target_chon_max:targetDepth, requested_chon_max:requestedDepth, allowed_chon_max:allowedDepth, referral_candidate_count:referralRows.length, subscriber_candidate_count:subscriberRows.length };
    const r=await pool.query(`INSERT INTO gm_message_share(share_no,sender_member_id,share_type,ref_no,title,message,target_rule_json,move_type,move_value,target_chon_max,target_count,candidate_count,sent_count)
      VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,0) RETURNING *`,
      [no,sender,shareType,refNo,s(b.title),s(b.message),JSON.stringify(target),s(b.move_type||'SMARTFIT_TEMPLATE'),s(b.move_value||refNo),targetDepth,receivers.length,receivers.length]);

    let inserted=0, skippedDup=0;
    for(const rec of receivers){
      const ir=await pool.query(`INSERT INTO gm_message_share_receiver(share_no,sender_member_id,ref_no,receiver_member_id,chon_depth,received_at)
        VALUES($1,$2,$3,$4,$5,CURRENT_TIMESTAMP)
        ON CONFLICT(sender_member_id,ref_no,receiver_member_id) DO NOTHING`,
        [no,sender,refNo,rec.member_id,rec.chon_depth]);
      if(ir.rowCount) inserted += 1; else skippedDup += 1;
    }
    const u=await pool.query('UPDATE gm_message_share SET sent_count=$2 WHERE share_no=$1 RETURNING *',[no,inserted]);
    await bumpDaily(pool,'SHARE',shareType,'send_count',inserted||0);
    ok(res,{ item:u.rows[0]||r.rows[0], candidate_count:receivers.length, referral_candidate_count:referralRows.length, subscriber_candidate_count:subscriberRows.length, sent_count:inserted, skipped_duplicate:skippedDup, target_chon_max:targetDepth, requested_chon_max:requestedDepth, allowed_chon_max:allowedDepth, space_no:spaceNo||null });
  }catch(e){ fail(res,500,'smartfit template share create failed',{ detail:String(e.message||e) }); }
});

router.post('/api/gm/message/share/create', async (req,res)=>{
  try{
    const pool=db(req), b=req.body||{};
    const sender=s(b.sender_member_id||b.senderMemberId||b.member_id);
    if(!sender) return fail(res,400,'sender_member_id required');
    const refNo=s(b.ref_no||b.template_id||b.templateId);
    if(!refNo) return fail(res,400,'ref_no/template_id required');
    const requestedDepth = Math.max(1, Math.min(5, Number(b.target_chon_max||b.targetChonMax||b.chon_max||1)));

    const mr=await pool.query("SELECT COALESCE(message_send_chon_max,1) AS max_chon FROM gm_member WHERE member_id=$1",[sender]);
    const allowedDepth = Math.max(1, Math.min(5, Number(mr.rows[0]?.max_chon || 1)));
    const targetDepth = Math.min(requestedDepth, allowedDepth);

    const no=s(b.share_no)||await nextNo(pool,'gm_message_share','share_no');
    const shareType=s(b.share_type||'SMARTFIT_TEMPLATE').toUpperCase();
    const receivers=await getShareReceivers(pool, sender, targetDepth);
    const target=jsonb(b.target_rule_json||b.target_rule,{ type:'REFERRAL_CHON', sender_member_id:sender, target_chon_max:targetDepth });
    target.type = target.type || 'REFERRAL_CHON';
    target.target_chon_max = targetDepth;
    target.requested_chon_max = requestedDepth;
    target.allowed_chon_max = allowedDepth;

    const r=await pool.query(`INSERT INTO gm_message_share(share_no,sender_member_id,share_type,ref_no,title,message,target_rule_json,move_type,move_value,target_chon_max,target_count,candidate_count,sent_count)
      VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,0) RETURNING *`,
      [no,sender,shareType,refNo,s(b.title),s(b.message),JSON.stringify(target),s(b.move_type||'SMARTFIT_TEMPLATE'),s(b.move_value||refNo),targetDepth,receivers.length,receivers.length]);

    let inserted=0, skippedDup=0;
    for(const rec of receivers){
      const ir=await pool.query(`INSERT INTO gm_message_share_receiver(share_no,sender_member_id,ref_no,receiver_member_id,chon_depth,received_at)
        VALUES($1,$2,$3,$4,$5,CURRENT_TIMESTAMP)
        ON CONFLICT(sender_member_id,ref_no,receiver_member_id) DO NOTHING`,
        [no,sender,refNo,rec.member_id,rec.chon_depth]);
      if(ir.rowCount) inserted += 1; else skippedDup += 1;
    }
    const u=await pool.query('UPDATE gm_message_share SET sent_count=$2 WHERE share_no=$1 RETURNING *',[no,inserted]);
    await bumpDaily(pool,'SHARE',shareType,'send_count',inserted||0);
    ok(res,{ item:u.rows[0]||r.rows[0], candidate_count:receivers.length, sent_count:inserted, skipped_duplicate:skippedDup, target_chon_max:targetDepth, requested_chon_max:requestedDepth, allowed_chon_max:allowedDepth });
  }catch(e){ fail(res,500,'share create failed',{ detail:String(e.message||e) }); }
});

router.get('/api/gm/message/share/list', async (req,res)=>{
  try{
    const pool=db(req), member=s(req.query.member_id||req.query.memberId);
    if(!member) return fail(res,400,'member_id required');
    const box=s(req.query.box||'inbox').toLowerCase();
    const limit=Math.min(100,Math.max(1,Number(req.query.limit||50)));
    let r;
    if(box==='sent' || box==='outbox'){
      r=await pool.query('SELECT * FROM gm_message_share WHERE sender_member_id=$1 ORDER BY created_at DESC LIMIT $2',[member,limit]);
    }else{
      r=await pool.query(`SELECT sh.*, rc.receiver_member_id, rc.chon_depth, rc.received_at, rc.read_at, rc.clicked_at, rc.saved_at
        FROM gm_message_share_receiver rc
        JOIN gm_message_share sh ON sh.share_no=rc.share_no
        WHERE rc.receiver_member_id=$1 AND sh.status='active'
        ORDER BY rc.received_at DESC LIMIT $2`,[member,limit]);
    }
    ok(res,{ items:r.rows, box });
  }catch(e){ fail(res,500,'share list failed',{ detail:String(e.message||e) }); }
});

router.get('/api/gm/message/share/unread-count', async (req,res)=>{
  try{
    const pool=db(req), member=s(req.query.member_id||req.query.memberId);
    if(!member) return fail(res,400,'member_id required');
    const r=await pool.query(`SELECT COUNT(*)::int AS unread_count FROM gm_message_share_receiver rc
      JOIN gm_message_share sh ON sh.share_no=rc.share_no
      WHERE rc.receiver_member_id=$1 AND sh.status='active' AND rc.read_at IS NULL`,[member]);
    ok(res,{ unread_count:r.rows[0]?.unread_count||0 });
  }catch(e){ fail(res,500,'share unread count failed',{ detail:String(e.message||e) }); }
});

router.get('/api/gm/message/share/target-preview', async (req,res)=>{
  try{
    const pool=db(req), sender=s(req.query.sender_member_id||req.query.senderMemberId||req.query.member_id);
    const refNo=s(req.query.ref_no||req.query.template_id||req.query.templateId);
    if(!sender) return fail(res,400,'sender_member_id required');
    const maxDepth=Math.max(1,Math.min(5,Number(req.query.target_chon_max||req.query.chon_max||5)));
    const rows=await getShareReceivers(pool,sender,maxDepth);
    const byDepth={}; rows.forEach(x=>{ byDepth[x.chon_depth]=(byDepth[x.chon_depth]||0)+1; });
    let already=0;
    if(refNo){
      const ar=await pool.query('SELECT COUNT(*)::int AS cnt FROM gm_message_share_receiver WHERE sender_member_id=$1 AND ref_no=$2',[sender,refNo]);
      already=ar.rows[0]?.cnt||0;
    }
    ok(res,{ total:rows.length, by_chon:byDepth, already_sent:already, ref_no:refNo||null });
  }catch(e){ fail(res,500,'share target preview failed',{ detail:String(e.message||e) }); }
});

router.post('/api/gm/message/share/action', async (req,res)=>{
  try{
    const pool=db(req), b=req.body||{};
    const no=s(b.share_no||b.shareNo); const member=s(b.member_id||b.memberId); const action=s(b.action||'read').toLowerCase();
    if(!no||!member) return fail(res,400,'share_no and member_id required');
    const r0=await pool.query('SELECT * FROM gm_message_share WHERE share_no=$1',[no]); if(!r0.rowCount) return fail(res,404,'share not found');
    const share=r0.rows[0];
    const col = action==='save' ? 'saver_json' : action==='click' ? 'clicker_json' : 'reader_json';
    const cnt = action==='save' ? 'save_count' : action==='click' ? 'click_count' : 'read_count';
    const timeCol = action==='save' ? 'saved_at' : action==='click' ? 'clicked_at' : 'read_at';

    const rc=await pool.query(`UPDATE gm_message_share_receiver SET ${timeCol}=COALESCE(${timeCol},CURRENT_TIMESTAMP)
      WHERE share_no=$1 AND receiver_member_id=$2 AND ${timeCol} IS NULL RETURNING *`,[no,member]);
    const first = rc.rowCount > 0;

    const arr=Array.isArray(share[col]) ? share[col] : [];
    const exists=arr.some(x=>s(x.member_id)===member);
    if(!exists) arr.push({ member_id:member, at:new Date().toISOString() });
    const r=await pool.query(`UPDATE gm_message_share SET ${col}=$2::jsonb, ${cnt}=${cnt}+$3 WHERE share_no=$1 RETURNING *`,[no,JSON.stringify(arr),first && !exists ? 1 : first ? 1 : 0]);
    if(first) await bumpDaily(pool,'SHARE',share.share_type, cnt, 1);
    ok(res,{ updated:first, item:r.rows[0] });
  }catch(e){ fail(res,500,'share action failed',{ detail:String(e.message||e) }); }
});



// SmartFit space subscription: visitor requests future template messages from a space.
router.post('/api/gm/message/smartfit/space/subscribe', async (req,res)=>{
  try{
    const pool=db(req), b=req.body||{};
    const spaceNo=s(b.space_no||b.spaceNo||b.space_id||b.spaceId);
    const member=s(b.member_id||b.memberId);
    if(!spaceNo||!member) return fail(res,400,'space_no and member_id required');
    const r=await pool.query(`INSERT INTO gm_smartfit_space_subscriber(space_no,member_id,subscribed_at,unsubscribed_at,active_yn)
      VALUES($1,$2,CURRENT_TIMESTAMP,NULL,'Y')
      ON CONFLICT(space_no,member_id) DO UPDATE SET subscribed_at=CURRENT_TIMESTAMP, unsubscribed_at=NULL, active_yn='Y'
      RETURNING *`,[spaceNo,member]);
    ok(res,{ item:r.rows[0] });
  }catch(e){ fail(res,500,'space subscribe failed',{ detail:String(e.message||e) }); }
});

router.post('/api/gm/message/smartfit/space/unsubscribe', async (req,res)=>{
  try{
    const pool=db(req), b=req.body||{};
    const spaceNo=s(b.space_no||b.spaceNo||b.space_id||b.spaceId);
    const member=s(b.member_id||b.memberId);
    if(!spaceNo||!member) return fail(res,400,'space_no and member_id required');
    const r=await pool.query(`UPDATE gm_smartfit_space_subscriber
      SET active_yn='N', unsubscribed_at=CURRENT_TIMESTAMP
      WHERE space_no=$1 AND member_id=$2 RETURNING *`,[spaceNo,member]);
    ok(res,{ updated:r.rowCount, item:r.rows[0]||null });
  }catch(e){ fail(res,500,'space unsubscribe failed',{ detail:String(e.message||e) }); }
});

router.get('/api/gm/message/smartfit/space/subscribers', async (req,res)=>{
  try{
    const pool=db(req);
    const spaceNo=s(req.query.space_no||req.query.spaceNo||req.query.space_id||req.query.spaceId);
    if(!spaceNo) return fail(res,400,'space_no required');
    const limit=Math.min(1000,Math.max(1,Number(req.query.limit||200)));
    const r=await pool.query(`SELECT space_no, member_id, subscribed_at
      FROM gm_smartfit_space_subscriber
      WHERE space_no=$1 AND active_yn='Y'
      ORDER BY subscribed_at DESC LIMIT $2`,[spaceNo,limit]);
    const c=await pool.query(`SELECT COUNT(*)::int AS cnt FROM gm_smartfit_space_subscriber WHERE space_no=$1 AND active_yn='Y'`,[spaceNo]);
    ok(res,{ space_no:spaceNo, count:c.rows[0]?.cnt||0, items:r.rows });
  }catch(e){ fail(res,500,'space subscribers failed',{ detail:String(e.message||e) }); }
});

router.get('/api/gm/message/smartfit/space/my-subscriptions', async (req,res)=>{
  try{
    const pool=db(req);
    const member=s(req.query.member_id||req.query.memberId);
    if(!member) return fail(res,400,'member_id required');
    const r=await pool.query(`SELECT space_no, member_id, subscribed_at
      FROM gm_smartfit_space_subscriber
      WHERE member_id=$1 AND active_yn='Y'
      ORDER BY subscribed_at DESC`,[member]);
    ok(res,{ items:r.rows });
  }catch(e){ fail(res,500,'my space subscriptions failed',{ detail:String(e.message||e) }); }
});

router.post('/api/gm/message/cleanup', async (req,res)=>{
  try{
    const pool=db(req);
    const p=await pool.query('SELECT message_type, retention_days FROM gm_message_policy');
    const result=[];
    for(const row of p.rows){
      const type=row.message_type, days=Number(row.retention_days||30);
      const a=await pool.query("DELETE FROM gm_message_personal WHERE message_type=$1 AND created_at < CURRENT_TIMESTAMP - ($2::text || ' days')::interval",[type,days]);
      const b=await pool.query("DELETE FROM gm_message_broadcast WHERE message_type=$1 AND created_at < CURRENT_TIMESTAMP - ($2::text || ' days')::interval RETURNING broadcast_no",[type,days]);
      for(const x of b.rows){ await pool.query('DELETE FROM gm_message_broadcast_receive WHERE broadcast_no=$1',[x.broadcast_no]); }
      const c=await pool.query("DELETE FROM gm_message_share WHERE share_type=$1 AND created_at < CURRENT_TIMESTAMP - ($2::text || ' days')::interval RETURNING share_no",[type,days]);
      for(const x of c.rows){ await pool.query('DELETE FROM gm_message_share_receiver WHERE share_no=$1',[x.share_no]); }
      result.push({ message_type:type, retention_days:days, personal:a.rowCount, broadcast:b.rowCount, share:c.rowCount });
    }
    ok(res,{ result });
  }catch(e){ fail(res,500,'cleanup failed',{ detail:String(e.message||e) }); }
});



/* ============================================================================
 * GM_ORDER_MESSAGE_API_V002
 * 주문 결과 페이지에서 주문 접수 완료 후 호출하는 주문 전용 메시지 API.
 * - gm_order_message는 주문 상태 메시지의 단기 보관소이다.
 * - ORDER_RECEIVED는 order_no당 정확히 한 번만 생성한다.
 * - 결과 페이지는 order_no/device_lang만 전달하고, 금액/송금정보는 서버의
 *   gm_order 원장을 다시 읽어 구성한다. DOM 금액을 신뢰하지 않는다.
 * - 실제 FCM 송신기는 아직 서버에 없으므로 여기서는 앱 전달 payload까지 만든다.
 *   앱/FCM 송신부는 이 payload를 소비하고 received_yn ACK를 별도 호출한다.
 * ============================================================================ */
const GM_ORDER_MESSAGE_TYPES = new Set([
  'ORDER_RECEIVED','ORDER_SHIPPED','RETURN_APPROVED','EXCHANGE_APPROVED',
  'RETURN_COMPLETED','EXCHANGE_RESHIPPED','DIRECT'
]);
function validOrderDeviceLang(v){
  const x=s(v).replace(/_/g,'-');
  if(!x || /^(und|unknown|null|undefined|false)$/i.test(x) || x.length>35) return '';
  return /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(x) ? x : '';
}
function orderMessageLangCode(v){
  const x=validOrderDeviceLang(v).toLowerCase();
  if(!x) return '';
  if(/^zh-(tw|hk|mo|hant)(-|$)/.test(x)) return 'tw';
  const b=x.split('-')[0];
  const map={kr:'ko',fil:'tl',ko:'ko',en:'en',zh:'zh',vi:'vi',ja:'ja',th:'th',uz:'uz',ne:'ne',km:'km',id:'id',tl:'tl',mn:'mn',my:'my',kk:'kk',si:'si',ru:'ru',bn:'bn',ur:'ur',lo:'lo',hi:'hi',tr:'tr',fa:'fa',es:'es',fr:'fr'};
  return map[b] || 'en';
}
const ORDER_RECEIVED_TEXT={
  ko:{title:'주문이 접수되었습니다',no:'주문번호',at:'주문일시',amount:'결제금액',bank:'송금정보',detail:'주문 상세보기',confirm:'확인'},
  en:{title:'Your order has been received',no:'Order number',at:'Order date',amount:'Amount',bank:'Bank transfer',detail:'View order details',confirm:'OK'},
  zh:{title:'订单已受理',no:'订单号',at:'下单时间',amount:'支付金额',bank:'汇款信息',detail:'查看订单详情',confirm:'确认'},
  tw:{title:'訂單已受理',no:'訂單編號',at:'訂購時間',amount:'付款金額',bank:'匯款資訊',detail:'查看訂單詳情',confirm:'確認'},
  vi:{title:'Đơn hàng đã được tiếp nhận',no:'Mã đơn hàng',at:'Thời gian đặt hàng',amount:'Số tiền',bank:'Thông tin chuyển khoản',detail:'Xem chi tiết đơn hàng',confirm:'Xác nhận'},
  ja:{title:'ご注文を受け付けました',no:'注文番号',at:'注文日時',amount:'お支払い金額',bank:'振込情報',detail:'注文詳細を見る',confirm:'確認'},
  th:{title:'รับคำสั่งซื้อแล้ว',no:'หมายเลขคำสั่งซื้อ',at:'วันที่สั่งซื้อ',amount:'ยอดชำระ',bank:'ข้อมูลการโอนเงิน',detail:'ดูรายละเอียดคำสั่งซื้อ',confirm:'ตกลง'},
  uz:{title:'Buyurtmangiz qabul qilindi',no:'Buyurtma raqami',at:'Buyurtma vaqti',amount:'To‘lov summasi',bank:'Pul o‘tkazish ma’lumoti',detail:'Buyurtma tafsilotlari',confirm:'Tasdiqlash'},
  ne:{title:'तपाईंको अर्डर प्राप्त भयो',no:'अर्डर नम्बर',at:'अर्डर मिति',amount:'भुक्तानी रकम',bank:'बैंक ट्रान्सफर',detail:'अर्डर विवरण हेर्नुहोस्',confirm:'ठीक छ'},
  km:{title:'ការបញ្ជាទិញរបស់អ្នកត្រូវបានទទួល',no:'លេខបញ្ជាទិញ',at:'ពេលបញ្ជាទិញ',amount:'ចំនួនទឹកប្រាក់',bank:'ព័ត៌មានផ្ទេរប្រាក់',detail:'មើលព័ត៌មានលម្អិត',confirm:'យល់ព្រម'},
  id:{title:'Pesanan Anda telah diterima',no:'Nomor pesanan',at:'Waktu pesanan',amount:'Jumlah pembayaran',bank:'Informasi transfer',detail:'Lihat detail pesanan',confirm:'OK'},
  tl:{title:'Natanggap na ang iyong order',no:'Order number',at:'Oras ng order',amount:'Halaga',bank:'Impormasyon sa bank transfer',detail:'Tingnan ang detalye ng order',confirm:'OK'},
  mn:{title:'Таны захиалгыг хүлээн авлаа',no:'Захиалгын дугаар',at:'Захиалгын огноо',amount:'Төлбөрийн дүн',bank:'Шилжүүлгийн мэдээлэл',detail:'Захиалгын дэлгэрэнгүй',confirm:'OK'},
  my:{title:'သင့်အော်ဒါကို လက်ခံရရှိပါပြီ',no:'အော်ဒါနံပါတ်',at:'အော်ဒါအချိန်',amount:'ငွေပမာဏ',bank:'ငွေလွှဲအချက်အလက်',detail:'အော်ဒါအသေးစိတ်ကြည့်ရန်',confirm:'အတည်ပြု'},
  kk:{title:'Тапсырысыңыз қабылданды',no:'Тапсырыс нөмірі',at:'Тапсырыс уақыты',amount:'Төлем сомасы',bank:'Аударым ақпараты',detail:'Тапсырыс мәліметтері',confirm:'OK'},
  si:{title:'ඔබගේ ඇණවුම ලැබී ඇත',no:'ඇණවුම් අංකය',at:'ඇණවුම් වේලාව',amount:'ගෙවීම් මුදල',bank:'බැංකු මාරු තොරතුරු',detail:'ඇණවුම් විස්තර බලන්න',confirm:'හරි'},
  ru:{title:'Ваш заказ принят',no:'Номер заказа',at:'Дата заказа',amount:'Сумма оплаты',bank:'Банковский перевод',detail:'Посмотреть заказ',confirm:'ОК'},
  bn:{title:'আপনার অর্ডার গ্রহণ করা হয়েছে',no:'অর্ডার নম্বর',at:'অর্ডারের সময়',amount:'পরিশোধের পরিমাণ',bank:'ব্যাংক ট্রান্সফার তথ্য',detail:'অর্ডারের বিস্তারিত দেখুন',confirm:'ঠিক আছে'},
  ur:{title:'آپ کا آرڈر موصول ہو گیا ہے',no:'آرڈر نمبر',at:'آرڈر کا وقت',amount:'ادائیگی کی رقم',bank:'بینک ٹرانسفر کی معلومات',detail:'آرڈر کی تفصیل دیکھیں',confirm:'ٹھیک ہے'},
  lo:{title:'ຮັບຄຳສັ່ງຊື້ຂອງທ່ານແລ້ວ',no:'ເລກຄຳສັ່ງຊື້',at:'ເວລາສັ່ງຊື້',amount:'ຈຳນວນເງິນ',bank:'ຂໍ້ມູນໂອນເງິນ',detail:'ເບິ່ງລາຍລະອຽດ',confirm:'ຕົກລົງ'},
  hi:{title:'आपका ऑर्डर प्राप्त हो गया है',no:'ऑर्डर नंबर',at:'ऑर्डर का समय',amount:'भुगतान राशि',bank:'बैंक ट्रांसफर जानकारी',detail:'ऑर्डर विवरण देखें',confirm:'ठीक है'},
  tr:{title:'Siparişiniz alındı',no:'Sipariş numarası',at:'Sipariş tarihi',amount:'Ödeme tutarı',bank:'Banka havalesi',detail:'Sipariş ayrıntıları',confirm:'Tamam'},
  fa:{title:'سفارش شما دریافت شد',no:'شماره سفارش',at:'زمان سفارش',amount:'مبلغ پرداخت',bank:'اطلاعات انتقال بانکی',detail:'مشاهده جزئیات سفارش',confirm:'تأیید'},
  es:{title:'Pedido recibido',no:'Número de pedido',at:'Fecha del pedido',amount:'Importe',bank:'Transferencia bancaria',detail:'Ver detalles del pedido',confirm:'Aceptar'},
  fr:{title:'Commande reçue',no:'Numéro de commande',at:'Date de commande',amount:'Montant',bank:'Virement bancaire',detail:'Voir le détail de la commande',confirm:'OK'}
}
function orderMessageText(lang){ return ORDER_RECEIVED_TEXT[lang] || ORDER_RECEIVED_TEXT.en; }
function orderMoney(v){
  const n=Number(v||0);
  return Number.isFinite(n) ? Math.round(n) : 0;
}
function orderDateText(v){
  if(!v) return '';
  try{
    const d=new Date(v);
    if(Number.isNaN(d.getTime())) return s(v);
    const parts=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(d);
    const m={}; parts.forEach(x=>{m[x.type]=x.value;});
    return `${m.year}-${m.month}-${m.day} ${m.hour}:${m.minute}`;
  }catch(e){ return s(v); }
}
async function resolveOrderMessageLanguage(pool,order,requested){
  const reqLang=validOrderDeviceLang(requested);
  if(reqLang) return {device_lang:reqLang,lang:orderMessageLangCode(reqLang),source:'REQUEST_DEVICE_LANG'};
  const member=s(order&&order.member_id);
  if(member){
    try{
      const dr=await pool.query(`SELECT device_lang FROM gm_member_device WHERE member_id=$1 AND push_enabled='Y' AND token_status='ACTIVE' AND COALESCE(device_lang,'')<>'' ORDER BY last_seen_at DESC NULLS LAST, updated_at DESC NULLS LAST LIMIT 1`,[member]);
      const dl=validOrderDeviceLang(dr.rows[0]&&dr.rows[0].device_lang);
      if(dl) return {device_lang:dl,lang:orderMessageLangCode(dl),source:'MEMBER_DEVICE'};
    }catch(_e){}
    try{
      const mr=await pool.query(`SELECT device_lang,language_code,cs_language FROM gm_member WHERE member_id=$1 LIMIT 1`,[member]);
      const row=mr.rows[0]||{};
      const dl=validOrderDeviceLang(row.device_lang);
      if(dl) return {device_lang:dl,lang:orderMessageLangCode(dl),source:'MEMBER_DEVICE_LANG'};
      const lc=s(row.language_code||row.cs_language).toLowerCase();
      if(lc) return {device_lang:lc,lang:orderMessageLangCode(lc),source:'MEMBER_LANGUAGE'};
    }catch(_e){}
  }
  return {device_lang:'en',lang:'en',source:'EN_FALLBACK'};
}
function buildOrderReceivedPayload(order,langInfo){
  const lang=langInfo.lang||'en', t=orderMessageText(lang);
  const orderNo=s(order.order_no);
  const orderedAt=s(order.ordered_at_text||order.created_at_text)||orderDateText(order.ordered_at||order.created_at);
  const amount=orderMoney(order.total_payment_price||order.expected_payment_amount||order.actual_payment_amount);
  const currency='KRW';
  const bankName=s(order.payment_bank_name);
  const account=s(order.payment_account_number);
  const depositor=s(order.depositor_name);
  const bank=[bankName,account,depositor].filter(Boolean).join(' · ');
  const detailUrl='/myshop/order/gm_detail.html?order_no='+encodeURIComponent(orderNo);
  const lines=[
    t.title,
    `${t.no}: ${orderNo}`,
    orderedAt?`${t.at}: ${orderedAt}`:'',
    `${t.amount}: ${amount.toLocaleString('en-US')} ${currency}`,
    bank?`${t.bank}: ${bank}`:'',
    `${t.detail}: ${detailUrl}`
  ].filter(Boolean);
  return {
    message_type:'ORDER_RECEIVED', title:t.title, message:lines.join('\n'),
    order_no:orderNo, ordered_at:orderedAt, amount, currency,
    bank_name:bankName, account_number:account, depositor_name:depositor,
    detail_url:detailUrl, detail_label:t.detail, confirm_label:t.confirm||'OK',
    device_lang:langInfo.device_lang, language_code:lang, language_source:langInfo.source
  };
}
async function findOrderForMessage(pool,no){
  const r=await pool.query(`SELECT *, to_char(ordered_at,'YYYY-MM-DD HH24:MI') AS ordered_at_text, to_char(created_at,'YYYY-MM-DD HH24:MI') AS created_at_text FROM gm_order WHERE order_no=$1 OR cafe24_order_no=$1 ORDER BY CASE WHEN order_no=$1 THEN 0 ELSE 1 END, created_at DESC LIMIT 1`,[no]);
  return r.rows[0]||null;
}

router.post('/api/gm/message/order/received', async (req,res)=>{
  const pool=db(req), b=req.body||{};
  if(!pool) return fail(res,500,'DB pool is not attached');
  const requestedNo=s(b.order_no||b.orderNo||b.gm_order_no||b.cafe24_order_no);
  if(!requestedNo) return fail(res,400,'order_no required');
  let client=null;
  try{
    const order=await findOrderForMessage(pool,requestedNo);
    if(!order) return fail(res,404,'order not found',{retryable:true,order_no:requestedNo});
    const langInfo=await resolveOrderMessageLanguage(pool,order,b.device_lang||b.deviceLang||b.language_code||b.gm_lang);
    const payload=buildOrderReceivedPayload(order,langInfo);
    client=await pool.connect();
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[s(order.order_no)]);
    let r=await client.query(`SELECT * FROM gm_order_message WHERE order_no=$1 AND message_type='ORDER_RECEIVED' ORDER BY message_seq ASC LIMIT 1`,[order.order_no]);
    let created=false;
    if(!r.rowCount){
      const seqR=await client.query(`SELECT COALESCE(MAX(message_seq),0)+1 AS next_seq FROM gm_order_message WHERE order_no=$1`,[order.order_no]);
      const seq=Number(seqR.rows[0]&&seqR.rows[0].next_seq)||1;
      r=await client.query(`INSERT INTO gm_order_message(order_no,message_seq,message_type,direct_message,device_lang,received_yn,sent_at) VALUES($1,$2,'ORDER_RECEIVED',NULL,$3,'N',CURRENT_TIMESTAMP) RETURNING *`,[order.order_no,seq,langInfo.device_lang]);
      created=true;
    }
    await client.query('COMMIT');
    return ok(res,{action:'order-message.received',created,item:r.rows[0],app_message:payload});
  }catch(e){
    if(client) await client.query('ROLLBACK').catch(()=>{});
    console.error('[GM_ORDER_MESSAGE_RECEIVED_ERROR]',String(e&&e.stack||e));
    return fail(res,500,'order message create failed',{detail:String(e&&e.message||e)});
  }finally{ if(client) client.release(); }
});

router.post('/api/gm/message/order/ack', async (req,res)=>{
  try{
    const pool=db(req), b=req.body||{};
    const orderNo=s(b.order_no||b.orderNo), seq=Number(b.message_seq||b.messageSeq||0);
    if(!pool) return fail(res,500,'DB pool is not attached');
    if(!orderNo||!seq) return fail(res,400,'order_no and message_seq required');
    const opened=yn(b.opened_yn||b.openedYn,'N')==='Y';
    const r=await pool.query(`UPDATE gm_order_message SET received_yn='Y', opened_at=CASE WHEN $3 THEN COALESCE(opened_at,CURRENT_TIMESTAMP) ELSE opened_at END WHERE order_no=$1 AND message_seq=$2 RETURNING *`,[orderNo,seq,opened]);
    if(!r.rowCount) return fail(res,404,'order message not found');
    return ok(res,{action:'order-message.ack',item:r.rows[0]});
  }catch(e){ return fail(res,500,'order message ack failed',{detail:String(e&&e.message||e)}); }
});

module.exports = router;
