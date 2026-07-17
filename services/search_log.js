// GM_SEARCH_LOG_SERVICE_V001
'use strict';

module.exports = function installSearchLogService(deps){
  const {
    app,pool,dbQuery,tableExists,cleanText,toInt,ok,fail,
    normalizeKeywordForStat,findCategoryKeywordMatch,
    incrementCategoryPeriodCounter,currentYyyymm,currentYyyy,
    keywordRelationService
  } = deps;

  function b(v){
    if(v===true||v===1) return true;
    const s=cleanText(v).toLowerCase();
    return s==='1'||s==='true'||s==='y'||s==='yes'||s==='t';
  }
  function deviceType(v){
    const s=cleanText(v).toUpperCase();
    if(s==='TABLET'||s==='PC') return s;
    return 'PHONE';
  }
  function cacheFlag(v){ return b(v)?'T':'F'; }
  function totalResult(row){
    return Number(row.gmkr_result_count||0)+Number(row.cpkr_result_count||0)+Number(row.alkr_result_count||0)+Number(row.smartfit_result_count||0);
  }
  async function latestIdentity(memberId,guestKey,keyword){
    const out={id_search:0,id_keyword:0,id_detail:0,guest_search:0,guest_keyword:0,guest_detail:0,merged_search:0,merged_keyword:0,merged_detail:0};
    if(memberId){
      const a=await dbQuery(`SELECT id_search_count,merged_search_count,merged_keyword_count,merged_detail_count FROM gm_search_log WHERE member_id=$1 ORDER BY search_id DESC LIMIT 1`,[memberId]);
      if(a.rows[0]){
        out.id_search=toInt(a.rows[0].id_search_count,0);
        out.merged_search=toInt(a.rows[0].merged_search_count,0);
        out.merged_keyword=toInt(a.rows[0].merged_keyword_count,0);
        out.merged_detail=toInt(a.rows[0].merged_detail_count,0);
      }
      const k=await dbQuery(`SELECT id_keyword_count,id_detail_count FROM gm_search_log WHERE member_id=$1 AND keyword_normalized=$2 ORDER BY search_id DESC LIMIT 1`,[memberId,keyword]);
      if(k.rows[0]){ out.id_keyword=toInt(k.rows[0].id_keyword_count,0); out.id_detail=toInt(k.rows[0].id_detail_count,0); }
    }
    if(guestKey){
      const a=await dbQuery(`SELECT guest_search_count FROM gm_search_log WHERE guest_key=$1 ORDER BY search_id DESC LIMIT 1`,[guestKey]);
      if(a.rows[0]) out.guest_search=toInt(a.rows[0].guest_search_count,0);
      const k=await dbQuery(`SELECT guest_keyword_count,guest_detail_count FROM gm_search_log WHERE guest_key=$1 AND keyword_normalized=$2 ORDER BY search_id DESC LIMIT 1`,[guestKey,keyword]);
      if(k.rows[0]){ out.guest_keyword=toInt(k.rows[0].guest_keyword_count,0); out.guest_detail=toInt(k.rows[0].guest_detail_count,0); }
    }
    return out;
  }
  async function linkMobileGuest(memberId,guestKey,dev,counts){
    if(!memberId||!guestKey||dev==='PC') return counts;
    const linked=await dbQuery(`SELECT member_id FROM gm_guest_member_link WHERE guest_key=$1 LIMIT 1`,[guestKey]);
    if(linked.rows[0]) return counts;
    await dbQuery(`INSERT INTO gm_guest_member_link (guest_key,member_id,created_at) VALUES ($1,$2,now()) ON CONFLICT (guest_key) DO NOTHING`,[guestKey,memberId]);
    counts.merged_search += counts.guest_search;
    counts.merged_keyword += counts.guest_keyword;
    counts.merged_detail += counts.guest_detail;
    return counts;
  }
  async function updateLegacyStats(row,isNew,deltas){
    const mall='ALL';
    if(await tableExists('gm_search_keyword_stat')){
      if(isNew){
        await dbQuery(`INSERT INTO gm_search_keyword_stat (keyword_original,keyword_normalized,keyword_canonical,country_code,lang_code,member_country_code,category_no,category_code,category_name,mall_code,search_count,cache_used_count,cache_miss_count,result_count_sum,db_insert_count_sum,queue_send_count_sum,first_search_at,last_search_at,updated_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13,$14,$15,now(),now(),now())
          ON CONFLICT (keyword_normalized,country_code,lang_code,category_no,mall_code) DO UPDATE SET search_count=gm_search_keyword_stat.search_count+1,last_search_at=now(),updated_at=now()`,
          [row.keyword_original,row.keyword_normalized,row.keyword_canonical,row.country_code,row.lang_code,row.member_country_code,row.category_no,row.category_code,row.category_name,mall,row.cache_used==='T'?1:0,row.cache_used==='T'?0:1,totalResult(row),row.db_insert_count,row.queue_send_count]);
      }else if(deltas.result||deltas.db||deltas.queue){
        await dbQuery(`UPDATE gm_search_keyword_stat SET result_count_sum=COALESCE(result_count_sum,0)+$1,db_insert_count_sum=COALESCE(db_insert_count_sum,0)+$2,queue_send_count_sum=COALESCE(queue_send_count_sum,0)+$3,last_search_at=now(),updated_at=now() WHERE keyword_normalized=$4 AND country_code=$5 AND lang_code=$6 AND category_no=$7 AND mall_code=$8`,[deltas.result,deltas.db,deltas.queue,row.keyword_normalized,row.country_code,row.lang_code,row.category_no,mall]);
      }
    }
  }

  const handleSearchEvent = async (req,res)=>{
    try{
      if(!(await tableExists('gm_search_log'))) return fail(res,500,'gm_search_log table not found');
      const p=req.body||{};
      const eventId=cleanText(p.search_event_id||p.searchEventId||p.request_id||p.requestId||'');
      if(!eventId) return fail(res,400,'search_event_id is required');
      const existing=await dbQuery(`SELECT * FROM gm_search_log WHERE search_event_id=$1 LIMIT 1`,[eventId]);
      const old=existing.rows[0]||null;
      const original=cleanText(p.keyword_original||p.keyword||p.origin||(old&&old.keyword_original)||'');
      const normalized=normalizeKeywordForStat(p.keyword_normalized||p.normalizedKeyword||original||(old&&old.keyword_normalized)||'');
      const uiLang=cleanText(p.ui_lang_code||p.uiLangCode||p.lang_code||p.langCode||(old&&old.ui_lang_code)||'');
      const keywordLang=cleanText(p.keyword_lang_code||p.keywordLangCode||(old&&old.keyword_lang_code)||uiLang);
      let canonical=cleanText(p.keyword_canonical||p.keywordCanonical||(old&&old.keyword_canonical)||'');
      let categoryNo=cleanText(p.category_no||p.categoryNo||(old&&old.category_no)||'');
      let categoryCode=cleanText(p.category_code||p.categoryCode||(old&&old.category_code)||'');
      let categoryName=cleanText(p.category_name||p.categoryName||(old&&old.category_name)||'');
      const match=await findCategoryKeywordMatch(normalized,uiLang);
      if(match){
        if(!canonical) canonical=cleanText(match.keyword_canonical||match.keyword_normalized||normalized);
        if(!categoryNo) categoryNo=cleanText(match.category_no||'');
        if(!categoryCode) categoryCode=cleanText(match.category_code||'');
        if(!categoryName) categoryName=cleanText(match.category_name||'');
      }
      if(!canonical) canonical=normalized;
      const mall=cleanText(p.mall_code||p.mallCode||'').toUpperCase();
      const counts={
        gmkr:toInt(p.gmkr_result_count||p.gmkrResultCount, old?old.gmkr_result_count:0),
        cpkr:toInt(p.cpkr_result_count||p.cpkrResultCount, old?old.cpkr_result_count:0),
        alkr:toInt(p.alkr_result_count||p.alkrResultCount, old?old.alkr_result_count:0),
        smartfit:toInt(p.smartfit_result_count||p.smartfitResultCount, old?old.smartfit_result_count:0)
      };
      const resultCount=toInt(p.result_count||p.resultCount,0);
      if(mall==='CPKR') counts.cpkr=resultCount;
      if(mall==='ALKR'||mall==='ALI') counts.alkr=resultCount;
      if(mall==='GMKR') counts.gmkr=resultCount;
      if(mall==='SMARTFIT') counts.smartfit=resultCount;
      const dbInsert=old?toInt(old.db_insert_count,0):toInt(p.db_insert_count||p.dbInsertCount,0);
      const queueSend=old?toInt(old.queue_send_count,0)+toInt(p.queue_send_count||p.queueSendCount,0):toInt(p.queue_send_count||p.queueSendCount,0);
      const memberId=cleanText(p.member_id||p.memberId||(old&&old.member_id)||'');
      const guestKey=cleanText(p.guest_key||p.guestKey||(old&&old.guest_key)||'');
      const dev=deviceType(p.device_type||p.deviceType||(old&&old.device_type)||'PHONE');
      const memberArrivedLate=!!(old && !cleanText(old.member_id||'') && memberId);
      const guestArrivedLate=!!(old && !cleanText(old.guest_key||'') && guestKey);
      let identity=(!old || memberArrivedLate || guestArrivedLate)?await latestIdentity(memberId,guestKey,normalized):null;
      if(identity) identity=await linkMobileGuest(memberId,guestKey,dev,identity);
      const row={keyword_original:original,keyword_normalized:normalized,keyword_canonical:canonical,lang_code:uiLang,country_code:cleanText(p.country_code||p.countryCode||(old&&old.country_code)||''),member_country_code:cleanText(p.member_country_code||p.memberCountryCode||(old&&old.member_country_code)||''),category_no:categoryNo,category_code:categoryCode,category_name:categoryName,cache_used:cacheFlag(p.cache_used||p.cacheUsed||(old&&old.cache_used)),gmkr_result_count:counts.gmkr,cpkr_result_count:counts.cpkr,alkr_result_count:counts.alkr,smartfit_result_count:counts.smartfit,db_insert_count:dbInsert,queue_send_count:queueSend};
      let saved;
      if(!old){
        // 같은 사용자 직전 검색에 후속 검색 정보를 기록한다.
        const ownerSql=memberId?`member_id=$1`:`guest_key=$1 AND COALESCE(member_id,'')=''`;
        const ownerVal=memberId||guestKey;
        if(ownerVal){
          const prev=await dbQuery(`SELECT search_id,result_rendered_at,search_at FROM gm_search_log WHERE ${ownerSql} ORDER BY search_id DESC LIMIT 1`,[ownerVal]);
          if(prev.rows[0]){
            const base=prev.rows[0].result_rendered_at||prev.rows[0].search_at;
            await dbQuery(`UPDATE gm_search_log SET next_search_event_id=$1,next_keyword_normalized=$2,next_search_delay_ms=GREATEST(0,FLOOR(EXTRACT(EPOCH FROM (now()-$3::timestamp))*1000)::integer),updated_at=now() WHERE search_id=$4`,[eventId,normalized,base,prev.rows[0].search_id]);
          }
        }
        saved=await dbQuery(`INSERT INTO gm_search_log (search_event_id,search_at,keyword_original,keyword_normalized,keyword_canonical,lang_code,ui_lang_code,keyword_lang_code,country_code,member_country_code,category_code,category_no,category_name,gmkr_result_count,cpkr_result_count,alkr_result_count,smartfit_result_count,db_insert_count,queue_send_count,cache_used,cache_key,search_source,member_id,guest_key,device_type,client_app,id_search_count,id_keyword_count,id_detail_count,guest_search_count,guest_keyword_count,guest_detail_count,merged_search_count,merged_keyword_count,merged_detail_count,created_at,updated_at)
          VALUES ($1,now(),$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,now(),now()) RETURNING *`,
          [eventId,original,normalized,canonical,uiLang,uiLang,keywordLang,row.country_code,row.member_country_code,categoryCode,categoryNo,categoryName,counts.gmkr,counts.cpkr,counts.alkr,counts.smartfit,dbInsert,queueSend,row.cache_used,cleanText(p.cache_key||p.cacheKey||''),cleanText(p.search_source||p.searchSource||'search'),memberId,guestKey,dev,cleanText(p.client_app||p.clientApp||'GLOMART_MOBILE'),memberId?identity.id_search+1:0,memberId?identity.id_keyword+1:0,identity.id_detail,(!memberId&&guestKey)?identity.guest_search+1:identity.guest_search,(!memberId&&guestKey)?identity.guest_keyword+1:identity.guest_keyword,identity.guest_detail,identity.merged_search,identity.merged_keyword,identity.merged_detail]);
      }else{
        const lateIdSearch=memberArrivedLate&&identity?identity.id_search+1:toInt(old.id_search_count,0);
        const lateIdKeyword=memberArrivedLate&&identity?identity.id_keyword+1:toInt(old.id_keyword_count,0);
        const lateGuestSearch=guestArrivedLate&&!memberId&&identity?identity.guest_search+1:toInt(old.guest_search_count,0);
        const lateGuestKeyword=guestArrivedLate&&!memberId&&identity?identity.guest_keyword+1:toInt(old.guest_keyword_count,0);
        const lateMergedSearch=(memberArrivedLate||guestArrivedLate)&&identity?identity.merged_search:toInt(old.merged_search_count,0);
        const lateMergedKeyword=(memberArrivedLate||guestArrivedLate)&&identity?identity.merged_keyword:toInt(old.merged_keyword_count,0);
        const lateMergedDetail=(memberArrivedLate||guestArrivedLate)&&identity?identity.merged_detail:toInt(old.merged_detail_count,0);
        saved=await dbQuery(`UPDATE gm_search_log SET keyword_original=$2,keyword_normalized=$3,keyword_canonical=$4,lang_code=$5,ui_lang_code=$5,keyword_lang_code=$6,country_code=$7,member_country_code=$8,category_code=$9,category_no=$10,category_name=$11,gmkr_result_count=$12,cpkr_result_count=$13,alkr_result_count=$14,smartfit_result_count=$15,db_insert_count=$16,queue_send_count=$17,cache_used=$18,member_id=$19,guest_key=$20,device_type=$21,id_search_count=$22,id_keyword_count=$23,guest_search_count=$24,guest_keyword_count=$25,merged_search_count=$26,merged_keyword_count=$27,merged_detail_count=$28,updated_at=now() WHERE search_event_id=$1 RETURNING *`,[eventId,original,normalized,canonical,uiLang,keywordLang,row.country_code,row.member_country_code,categoryCode,categoryNo,categoryName,counts.gmkr,counts.cpkr,counts.alkr,counts.smartfit,dbInsert,queueSend,row.cache_used,memberId,guestKey,dev,lateIdSearch,lateIdKeyword,lateGuestSearch,lateGuestKeyword,lateMergedSearch,lateMergedKeyword,lateMergedDetail]);
      }
      const nowRow=saved.rows[0];
      const oldTotal=old?Number(old.gmkr_result_count||0)+Number(old.cpkr_result_count||0)+Number(old.alkr_result_count||0)+Number(old.smartfit_result_count||0):0;
      await updateLegacyStats(nowRow,!old,{result:totalResult(nowRow)-oldTotal,db:0,queue:toInt(p.queue_send_count||p.queueSendCount,0)});
      let relationResult=null;
      try{ relationResult=await keywordRelationService.saveRelations(pool,{gm_lang:keywordLang||uiLang||'ko',keyword_ko:cleanText(p.keyword_ko||p.keywordKo||canonical||normalized||original),relatedKeywords:p.related_keywords||p.relatedKeywords||[]}); }catch(e){ console.error('[GM_KEYWORD_RELATION_SAVE_ERROR]',String(e&&e.message||e)); }
      ok(res,{action:'search.log',inserted:!old,updated:!!old,search_id:nowRow.search_id,search_event_id:eventId,keyword_relation:relationResult});
    }catch(e){ fail(res,500,'search log failed',{detail:String(e&&e.message||e)}); }
  };

  app.locals.gmEventHandlers = app.locals.gmEventHandlers || {};
  app.locals.gmEventHandlers.SEARCH = handleSearchEvent;
  app.locals.gmEventHandlers.SEARCH_COMPLETE = handleSearchEvent;
  app.post('/api/gm/search/log', handleSearchEvent);

  app.post('/api/gm/search/log/detail', async (req,res)=>{
    try{
      const p=req.body||{};
      const eventId=cleanText(p.search_event_id||p.searchEventId||p.request_id||p.requestId||'');
      if(!eventId) return fail(res,400,'search_event_id is required');
      const r=await dbQuery(`UPDATE gm_search_log SET detail_enter_count=COALESCE(detail_enter_count,0)+1,detail_entry_no=nextval('gm_detail_entry_seq'),id_detail_count=CASE WHEN COALESCE(member_id,'')<>'' THEN COALESCE(id_detail_count,0)+1 ELSE id_detail_count END,guest_detail_count=CASE WHEN COALESCE(member_id,'')='' AND COALESCE(guest_key,'')<>'' THEN COALESCE(guest_detail_count,0)+1 ELSE guest_detail_count END,updated_at=now() WHERE search_event_id=$1 RETURNING search_id,detail_enter_count,detail_entry_no,id_detail_count,guest_detail_count,merged_detail_count`,[eventId]);
      if(!r.rows[0]) return fail(res,404,'search_event_id not found');
      ok(res,{action:'search.log.detail',...r.rows[0]});
    }catch(e){ fail(res,500,'search detail count failed',{detail:String(e&&e.message||e)}); }
  });

  app.get('/api/gm/search/summary', async (req,res)=>{
    try{
      const limit=Math.max(1,Math.min(100,toInt(req.query.limit,20)));
      const r=await dbQuery(`SELECT keyword_canonical,keyword_normalized,SUM(1) AS search_count,SUM(detail_enter_count) AS detail_count,MAX(search_at) AS last_search_at FROM gm_search_log GROUP BY keyword_canonical,keyword_normalized ORDER BY search_count DESC,last_search_at DESC LIMIT $1`,[limit]);
      ok(res,{action:'search.summary',top_keywords:r.rows});
    }catch(e){ fail(res,500,'search summary failed',{detail:String(e&&e.message||e)}); }
  });

  app.get('/api/gm/search/monthly', async (req,res)=>{
    try{
      const limit=Math.max(1,Math.min(500,toInt(req.query.limit,100)));
      const yyyymm=cleanText(req.query.yyyymm||req.query.month||'');
      const r=await dbQuery(`SELECT TO_CHAR(search_at,'YYYYMM') AS yyyymm,category_no,category_code,category_name,country_code,lang_code,COUNT(*) AS search_count,SUM(gmkr_result_count+cpkr_result_count+alkr_result_count+smartfit_result_count) AS result_count_sum,SUM(db_insert_count) AS db_insert_count_sum,SUM(queue_send_count) AS queue_send_count_sum,MIN(search_at) AS first_search_at,MAX(search_at) AS last_search_at FROM gm_search_log WHERE ($2='' OR TO_CHAR(search_at,'YYYYMM')=$2) GROUP BY TO_CHAR(search_at,'YYYYMM'),category_no,category_code,category_name,country_code,lang_code ORDER BY yyyymm DESC,search_count DESC LIMIT $1`,[limit,yyyymm]);
      ok(res,{action:'search.monthly',rows:r.rows});
    }catch(e){ fail(res,500,'search monthly failed',{detail:String(e&&e.message||e)}); }
  });
};
