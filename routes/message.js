'use strict';
const express = require('express');
const router = express.Router();
const VERSION = 'GM_MESSAGE_API_V002_SHARE_RECEIVER_DEDUP_SPACE_SUBSCRIBE';
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
    const status=s(b.status||'active').toLowerCase();
    const r=await pool.query(`INSERT INTO gm_message_broadcast(broadcast_no,message_type,title,message,target_rule_json,move_type,move_value,action_json,track_receive,track_read,track_click,status,start_at,end_at,created_by)
      VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8::jsonb,$9,$10,$11,$12,COALESCE($13::timestamp,CURRENT_TIMESTAMP),$14::timestamp,$15) RETURNING *`,
      [no,mt,s(b.title),s(b.message),JSON.stringify(jsonb(b.target_rule_json||b.target_rule,{})),s(b.move_type),s(b.move_value),JSON.stringify(jsonb(b.action_json,{})),trackReceive,trackRead,trackClick,status,b.start_at||null,b.end_at||null,s(b.created_by||b.admin_id)]);
    ok(res,{ item:r.rows[0] });
  }catch(e){ fail(res,500,'broadcast create failed',{ detail:String(e.message||e) }); }
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
    UNION ALL
      SELECT m.member_id, d.chon_depth + 1
      FROM gm_member m
      JOIN downline d ON m.recommender_id=d.member_id
      WHERE d.chon_depth < $2 AND COALESCE(m.allow_message_share,'Y')='Y'
    )
    SELECT member_id, chon_depth FROM downline WHERE member_id <> $1 ORDER BY chon_depth, member_id`;
  const r = await pool.query(q, [sender, depth]);
  return r.rows || [];
}

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

module.exports = router;
