// EVENT_SERVICE_V005_SEARCH_FIRST
'use strict';

module.exports = function createEventService(deps){
  const { pool, tableExists, cleanText, currentYyyymm, currentYyyy } = deps;
  const LANGS = new Set(['ko','en','zh','vi','ja','tw','th','uz','ne','km','id','tl','mn','my','kk','si','ru','bn','ur','lo','hi','tr','fa','es','fr']);

  function langColumn(v){
    const value = cleanText(v || '').toLowerCase();
    return LANGS.has(value) ? `${value}_count` : 'total_count';
  }

  async function upsertCategoryPeriod(client, table, periodCol, periodVal, row){
    if(!row.category_no || !(await tableExists(table))) return;
    const countCol = langColumn(row.ui_lang_code || row.lang_code || row.country_code);
    const params = [
      periodVal,
      cleanText(row.category_no),
      cleanText(row.category_code),
      cleanText(row.category_name),
      cleanText(row.mall_code || '')
    ];

    const updated = await client.query(
      `UPDATE ${table}
       SET category_code=$3, category_name=$4, mall_code=$5,
           total_count=COALESCE(total_count,0)+1,
           ${countCol}=COALESCE(${countCol},0)+1,
           last_search_at=now(), updated_at=now()
       WHERE ${periodCol}=$1
         AND category_no=$2
         AND COALESCE(mall_code,'')=COALESCE($5,'')`,
      params
    );

    if(!updated.rowCount){
      await client.query(
        `INSERT INTO ${table}
          (${periodCol},category_no,category_code,category_name,mall_code,
           total_count,${countCol},first_search_at,last_search_at,updated_at)
         VALUES ($1,$2,$3,$4,$5,1,1,now(),now(),now())`,
        params
      );
    }
  }

  // Called only after a NEW gm_search_log row is inserted.
  // Repeated CPKR/ALKR updates with the same search_event_id do not call this again.
  async function applySearch(row){
    if(!row || !row.search_event_id) return { applied:false, reason:'search_row_missing' };

    const client = await pool.connect();
    try{
      await client.query('BEGIN');

      if(row.category_no && await tableExists('gm_category')){
        await client.query(
          `UPDATE gm_category
           SET search_count=COALESCE(search_count,0)+1,
               last_search_at=now()::text,
               updated_at=now()
           WHERE gm_code=$1 OR cp_code=$1`,
          [cleanText(row.category_no)]
        );
      }

      await upsertCategoryPeriod(client, 'gm_category_search_monthly', 'yyyymm', currentYyyymm(), row);
      await upsertCategoryPeriod(client, 'gm_category_search_yearly', 'yyyy', currentYyyy(), row);

      await client.query('COMMIT');
      return { applied:true, search_event_id:row.search_event_id };
    }catch(error){
      try{ await client.query('ROLLBACK'); }catch(_rollbackError){}
      throw error;
    }finally{
      client.release();
    }
  }

  return { applySearch };
};
