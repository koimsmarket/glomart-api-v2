'use strict';
// GM_PRODUCT_I18N_V003: DB-only translation repository / leased queues.
// No translation engines, no changes to source product or option records.
const crypto = require('crypto');
const LANGS = Object.freeze(['ko','en','zh','vi','ja','tw','th','uz','ne','km','id','tl','mn','my','kk','si','ru','bn','ur','lo','hi','tr','fa','es','fr']);
const LANG_SET = new Set(LANGS);
const kinds = Object.freeze({product:{table:'gm_product_translation',queue:'gm_product_translation_queue',key:'product_id'},option:{table:'gm_option_translation',queue:'gm_option_translation_queue',key:'pi_vi'}});
const text = (v) => typeof v === 'string' ? v.trim() : '';
const lang = (v) => { const s=text(v).toLowerCase(); return s === 'cn' ? 'zh' : s === 'jp' ? 'ja' : (LANG_SET.has(s) ? s : ''); };
const kind = (v) => kinds[v] ? kinds[v] : null;
const hash = (v) => crypto.createHash('sha256').update(v, 'utf8').digest('hex');
function keys(body){
  const k=kind(body.kind); const mall=text(body.mall_code).toUpperCase();
  const value=k ? text(body[k.key]) : '';
  if(!k || !/^[A-Z0-9_]{2,16}$/.test(mall) || !value || value.length>240) throw Object.assign(new Error('INVALID_KEY'),{status:400});
  return {k,mall,value};
}
async function source(db, kindName, mall, value){
  if(kindName==='product'){
    const r=await db.query('SELECT DISTINCT product_name FROM public.gm_product WHERE mall_code=$1 AND product_id=$2 LIMIT 2',[mall,value]);
    if(r.rows.length!==1) throw Object.assign(new Error(r.rows.length?'AMBIGUOUS_SOURCE':'SOURCE_NOT_FOUND'),{status:r.rows.length?409:404});
    return text(r.rows[0].product_name);
  }
  // pi_vi = PID_VID. Resolve ONLY when it identifies exactly one current option row.
  const r=await db.query("SELECT DISTINCT option_name FROM public.gm_product_option WHERE mall_code=$1 AND product_id || '_' || vendor_item_id = $2 LIMIT 2",[mall,value]);
  if(r.rows.length!==1) throw Object.assign(new Error(r.rows.length?'AMBIGUOUS_OPTION':'OPTION_NOT_FOUND'),{status:r.rows.length?409:404});
  return text(r.rows[0].option_name);
}
async function lookup(db, body){
  const {k,mall,value}=keys(body); const target=lang(body.lang);if(!target) throw Object.assign(new Error('INVALID_LANG'),{status:400});
  const src=await source(db,body.kind,mall,value);
  if(!src) throw Object.assign(new Error('EMPTY_SOURCE'),{status:409});
  const qr=await db.query(`SELECT source_hash FROM public.${k.queue} WHERE mall_code=$1 AND ${k.key}=$2`,[mall,value]);
  if(qr.rows[0]&&qr.rows[0].source_hash.trim()!==hash(src))return {found:false,source_text:src,source_hash:hash(src),translated_text:null,lang:target,reason:'SOURCE_CHANGED'};
  const r=await db.query(`SELECT ${target} AS translated FROM public.${k.table} WHERE mall_code=$1 AND ${k.key}=$2`,[mall,value]);
  return {found:!!(r.rows[0]&&text(r.rows[0].translated)),source_text:src,source_hash:hash(src),translated_text:r.rows[0]?.translated||null,lang:target};
}
async function register(db, body){
  const {k,mall,value}=keys(body);
  const raw=Array.isArray(body.langs)?body.langs:[];
  const requested=[...new Set(raw.map(lang).filter(Boolean))];
  if(!requested.length||requested.length>25)throw Object.assign(new Error('INVALID_LANGS'),{status:400});
  const client=await db.connect();
  try{
    await client.query('BEGIN');
    // Serialize source-version changes and concurrent registrations for the same key.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))',[body.kind,mall+'|'+value]);
    const s=await source(client,body.kind,mall,value);
    if(!s)throw Object.assign(new Error('EMPTY_SOURCE'),{status:409});
    const h=hash(s);
    const prev=await client.query(`SELECT source_hash FROM public.${k.queue} WHERE mall_code=$1 AND ${k.key}=$2`,[mall,value]);
    if(prev.rows[0]&&prev.rows[0].source_hash.trim()!==h){
      // Translation rows have only 27 columns, so their source version lives in queue.
      // Discard stale translations only when a changed original is positively verified.
      await client.query(`DELETE FROM public.${k.table} WHERE mall_code=$1 AND ${k.key}=$2`,[mall,value]);
    }
    const r=await client.query(`SELECT ${LANGS.join(',')} FROM public.${k.table} WHERE mall_code=$1 AND ${k.key}=$2`,[mall,value]);
    const missing=requested.filter(l=>!text(r.rows[0]?.[l]));
    if(!missing.length){await client.query('COMMIT');return {queued:false,missing:[]};}
    const q=await client.query(`INSERT INTO public.${k.queue} (mall_code,${k.key},source_hash,source_lang,pending_langs,status,next_retry_at)
      VALUES ($1,$2,$3,$4,$5::jsonb,'PENDING',now())
      ON CONFLICT (mall_code,${k.key}) DO UPDATE SET
        source_hash=EXCLUDED.source_hash,
        source_lang=COALESCE(EXCLUDED.source_lang,public.${k.queue}.source_lang),
        pending_langs=(SELECT COALESCE(jsonb_agg(DISTINCT val), '[]'::jsonb)
          FROM jsonb_array_elements_text((CASE WHEN public.${k.queue}.source_hash=EXCLUDED.source_hash THEN public.${k.queue}.pending_langs ELSE '[]'::jsonb END) || EXCLUDED.pending_langs) AS j(val)),
        status=CASE WHEN public.${k.queue}.status='CLAIMED' AND public.${k.queue}.lease_until>now() AND public.${k.queue}.source_hash=EXCLUDED.source_hash THEN 'CLAIMED' ELSE 'PENDING' END,
        owner_token=CASE WHEN public.${k.queue}.status='CLAIMED' AND public.${k.queue}.lease_until>now() AND public.${k.queue}.source_hash=EXCLUDED.source_hash THEN public.${k.queue}.owner_token ELSE NULL END,
        lease_until=CASE WHEN public.${k.queue}.status='CLAIMED' AND public.${k.queue}.lease_until>now() AND public.${k.queue}.source_hash=EXCLUDED.source_hash THEN public.${k.queue}.lease_until ELSE NULL END,
        next_retry_at=now(),updated_at=now()
      RETURNING pending_langs`,[mall,value,h,lang(body.source_lang)||null,JSON.stringify(missing)]);
    await client.query('COMMIT');
    return {queued:true,missing:q.rows[0]?.pending_langs||missing};
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}

async function claim(db, body){
  const k=kind(body.kind);if(!k)throw Object.assign(new Error('INVALID_KIND'),{status:400});
  const owner=text(body.owner_token);if(owner.length<16||owner.length>160)throw Object.assign(new Error('INVALID_OWNER_TOKEN'),{status:400});
  // SKIP LOCKED avoids concurrent claim. Lease must expire before another worker can take it.
  const r=await db.query(`WITH pick AS (
    SELECT mall_code,${k.key} FROM public.${k.queue} q WHERE
      (status IN ('PENDING','RETRY_WAIT') AND next_retry_at<=now() OR status='CLAIMED' AND lease_until<now())
      AND jsonb_array_length(pending_langs)>0
    ORDER BY next_retry_at,created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
    UPDATE public.${k.queue} q SET status='CLAIMED',owner_token=$1,lease_until=now()+interval '90 seconds',attempt_count=attempt_count+1,updated_at=now()
    FROM pick WHERE q.mall_code=pick.mall_code AND q.${k.key}=pick.${k.key}
    RETURNING q.mall_code,q.${k.key},q.source_hash,q.pending_langs,q.lease_until,q.attempt_count`,[owner]);
  if(!r.rows[0])return {task:null};
  const t=r.rows[0];
  try {const s=await source(db,body.kind,t.mall_code,t[k.key]);if(hash(s)!==t.source_hash){
    await db.query(`UPDATE public.${k.queue} SET status='RETRY_WAIT',owner_token=NULL,lease_until=NULL,last_error_code='SOURCE_CHANGED',next_retry_at=now()+interval '5 minutes' WHERE mall_code=$1 AND ${k.key}=$2 AND owner_token=$3`,[t.mall_code,t[k.key],owner]);
    return {task:null,skipped:'SOURCE_CHANGED'};
  } t.source_text=s; } catch(e) {return {task:null,skipped:e.message};}
  return {task:t};
}
async function complete(db, body){
  const {k,mall,value}=keys(body);const target=lang(body.lang); const translated=text(body.translated_text);const owner=text(body.owner_token);
  if(!target||!translated||translated.length>12000||owner.length<16)throw Object.assign(new Error('INVALID_RESULT'),{status:400});
  const client=await db.connect();
  try{
    await client.query('BEGIN');
    const qr=await client.query(`SELECT * FROM public.${k.queue} WHERE mall_code=$1 AND ${k.key}=$2 FOR UPDATE`,[mall,value]);
    const task=qr.rows[0];
    if(!task||task.status!=='CLAIMED'||task.owner_token!==owner||!task.lease_until||new Date(task.lease_until).getTime()<Date.now())throw Object.assign(new Error('LEASE_REQUIRED'),{status:409});
    const s=await source(client,body.kind,mall,value);
    if(hash(s)!==task.source_hash)throw Object.assign(new Error('SOURCE_CHANGED'),{status:409});
    if(!Array.isArray(task.pending_langs)||!task.pending_langs.includes(target))throw Object.assign(new Error('LANG_NOT_PENDING'),{status:409});
    const r=await client.query(`INSERT INTO public.${k.table} (mall_code,${k.key},${target}) VALUES ($1,$2,$3)
      ON CONFLICT (mall_code,${k.key}) DO UPDATE SET ${target}=COALESCE(NULLIF(public.${k.table}.${target},''),EXCLUDED.${target})
      RETURNING ${target} AS value`,[mall,value,translated]);
    const pending=(task.pending_langs||[]).filter(v=>v!==target);
    // Trace persisted in queue's engine_meta; no extra log table.
    const provenance={engine:text(body.engine_used).slice(0,48),stage:text(body.translated_by).slice(0,40),at:new Date().toISOString()};
    if(!['ONLINE_GOOGLE','OFFLINE_MLKIT','ORIGINAL_SAME_LANGUAGE'].includes(provenance.engine)||!['COLLECTOR','RUNTIME'].includes(provenance.stage))throw Object.assign(new Error('INVALID_PROVENANCE'),{status:400});
    await client.query(`UPDATE public.${k.queue} SET pending_langs=$3::jsonb,status=$4,owner_token=NULL,lease_until=NULL,engine_meta=jsonb_set(engine_meta,$5::text[],$6::jsonb,true),completed_at=CASE WHEN $4='COMPLETED' THEN now() ELSE NULL END,updated_at=now() WHERE mall_code=$1 AND ${k.key}=$2`,[mall,value,JSON.stringify(pending),pending.length?'PENDING':'COMPLETED',[target],JSON.stringify(provenance)]);
    await client.query('COMMIT');
    return {saved:true,lang:target,text:r.rows[0].value,remaining:pending.length,already_saved:r.rows[0].value!==translated};
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}
async function fail(db, body){
  const {k,mall,value}=keys(body);const owner=text(body.owner_token);if(owner.length<16)throw Object.assign(new Error('INVALID_OWNER'),{status:400});
  const seconds=Math.min(3600,Math.max(60,Math.floor(Number(body.retry_after_seconds)||300)));
  const error=text(body.error_code).slice(0,100)||'TRANSLATE_FAILED';
  const r=await db.query(`UPDATE public.${k.queue} SET status='RETRY_WAIT',owner_token=NULL,lease_until=NULL,last_error_code=$4,next_retry_at=now()+$5*interval '1 second',updated_at=now() WHERE mall_code=$1 AND ${k.key}=$2 AND owner_token=$3 AND status='CLAIMED' RETURNING pending_langs`,[mall,value,owner,error,seconds]);
  if(!r.rowCount)throw Object.assign(new Error('LEASE_REQUIRED'),{status:409});
  return {waiting:true,pending:r.rows[0].pending_langs,retry_after_seconds:seconds};
}
module.exports={LANGS,lookup,register,claim,complete,fail};
