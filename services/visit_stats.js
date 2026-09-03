'use strict';

function normLang(v){
  let x=String(v||'').trim().toLowerCase().replace(/_/g,'-');
  if(!x) return '';
  if(/^zh-(tw|hant)/.test(x)) return 'tw';
  x=x.split('-')[0];
  if(x==='ko') x='kr';
  if(x==='in') x='id';
  if(x==='fil') x='tl';
  if(x==='jp') x='ja';
  if(x==='cn') x='zh';
  if(x==='vn') x='vi';
  return /^[a-z]{2,3}$/.test(x)?x:'';
}
function normCountry(v){ const x=String(v||'').trim().toUpperCase(); return /^[A-Z]{2}$/.test(x)?x:''; }

async function rollover(client){
  await client.query(`
    INSERT INTO gm_visit_rollover_state(state_id,last_day,last_month,last_year)
    VALUES(1,(now() AT TIME ZONE 'Asia/Seoul')::date,
             date_trunc('month',now() AT TIME ZONE 'Asia/Seoul')::date,
             EXTRACT(YEAR FROM now() AT TIME ZONE 'Asia/Seoul')::int)
    ON CONFLICT(state_id) DO NOTHING
  `);
  const sr=await client.query(`SELECT
    to_char(last_day,'YYYY-MM-DD') AS last_day,
    to_char(last_month,'YYYY-MM-DD') AS last_month,
    last_year
    FROM gm_visit_rollover_state WHERE state_id=1 FOR UPDATE`);
  const s=sr.rows[0];
  const nowr=(await client.query(`SELECT
    to_char((now() AT TIME ZONE 'Asia/Seoul')::date,'YYYY-MM-DD') AS today,
    to_char(date_trunc('month',now() AT TIME ZONE 'Asia/Seoul')::date,'YYYY-MM-DD') AS this_month,
    EXTRACT(YEAR FROM now() AT TIME ZONE 'Asia/Seoul')::int AS this_year,
    to_char(((now() AT TIME ZONE 'Asia/Seoul')::date - 1),'YYYY-MM-DD') AS yesterday,
    to_char((date_trunc('month',now() AT TIME ZONE 'Asia/Seoul')::date - interval '1 month')::date,'YYYY-MM-DD') AS prev_month,
    (EXTRACT(YEAR FROM now() AT TIME ZONE 'Asia/Seoul')::int - 1) AS prev_year
  `)).rows[0];
  const dayChanged=s.last_day!==nowr.today;
  const monthChanged=s.last_month!==nowr.this_month;
  const yearChanged=Number(s.last_year)!==Number(nowr.this_year);

  if(dayChanged){
    const carry=s.last_day===nowr.yesterday;
    for(const table of ['gm_device_language','gm_country_stat']){
      await client.query(`UPDATE ${table} SET
        visit_yesterday_count=${carry?'visit_day_count':'0'},
        visit_day_count=0`);
    }
  }
  if(monthChanged){
    const carry=s.last_month===nowr.prev_month;
    for(const table of ['gm_device_language','gm_country_stat']){
      await client.query(`UPDATE ${table} SET
        visit_last_month_count=${carry?'visit_month_count':'0'},
        visit_month_count=0`);
    }
  }
  if(yearChanged){
    const carry=Number(s.last_year)===Number(nowr.prev_year);
    for(const table of ['gm_device_language','gm_country_stat']){
      await client.query(`UPDATE ${table} SET
        visit_last_year_count=${carry?'visit_year_count':'0'},
        visit_year_count=0`);
    }
  }
  if(dayChanged||monthChanged||yearChanged){
    await client.query(`UPDATE gm_visit_rollover_state SET
      last_day=$1::date,last_month=$2::date,last_year=$3,updated_at=now() WHERE state_id=1`,
      [nowr.today,nowr.this_month,nowr.this_year]);
  }
}

async function countVisit(db,langCode,countryCode,builtin){
  const lang=normLang(langCode), country=normCountry(countryCode);
  const client=await db.connect();
  try{
    await client.query('BEGIN');
    await rollover(client);
    let langRow=null;
    if(lang){
      const status=builtin?'BUILTIN':'NEW';
      const r=await client.query(`
        INSERT INTO gm_device_language(
          lang_code,status,visit_day_count,visit_month_count,visit_year_count,visit_total_count,first_seen_at,updated_at
        ) VALUES($1,$2,1,1,1,1,now(),now())
        ON CONFLICT(lang_code) DO UPDATE SET
          visit_day_count=gm_device_language.visit_day_count+1,
          visit_month_count=gm_device_language.visit_month_count+1,
          visit_year_count=gm_device_language.visit_year_count+1,
          visit_total_count=gm_device_language.visit_total_count+1,
          updated_at=now()
        RETURNING lang_code,status,pack_version,pack_url,download_count,
          visit_day_count,visit_yesterday_count,visit_month_count,visit_last_month_count,
          visit_year_count,visit_last_year_count,visit_total_count,first_seen_at,updated_at
      `,[lang,status]);
      langRow=r.rows[0];
    }
    if(country){
      await client.query(`
        INSERT INTO gm_country_stat(
          country_code,visit_day_count,visit_month_count,visit_year_count,visit_total_count,first_seen_at,updated_at
        ) VALUES($1,1,1,1,1,now(),now())
        ON CONFLICT(country_code) DO UPDATE SET
          visit_day_count=gm_country_stat.visit_day_count+1,
          visit_month_count=gm_country_stat.visit_month_count+1,
          visit_year_count=gm_country_stat.visit_year_count+1,
          visit_total_count=gm_country_stat.visit_total_count+1,
          updated_at=now()
      `,[country]);
    }
    await client.query('COMMIT');
    return {lang:langRow,country_code:country};
  }catch(e){
    try{await client.query('ROLLBACK');}catch(_e){}
    throw e;
  }finally{client.release();}
}

async function incrementMemberCountry(client,countryCode){
  const c=normCountry(countryCode); if(!c) return;
  await client.query(`
    INSERT INTO gm_country_stat(country_code,member_count,first_seen_at,updated_at)
    VALUES($1,1,now(),now())
    ON CONFLICT(country_code) DO UPDATE SET
      member_count=gm_country_stat.member_count+1,updated_at=now()
  `,[c]);
}

module.exports={normLang,normCountry,rollover,countVisit,incrementMemberCountry};
