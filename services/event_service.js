// EVENT_SERVICE_V008_SEARCH_AND_DETAIL
'use strict';

module.exports = function createEventService(deps){
  const { pool, tableExists, cleanText, currentYyyymm, currentYyyy } = deps;
  const LANGS = new Set(['ko','en','zh','vi','ja','tw','th','uz','ne','km','id','tl','mn','my','kk','si','ru','bn','ur','lo','hi','tr','fa','es','fr']);

  function langColumn(v){
    const value = cleanText(v || '').toLowerCase();
    return LANGS.has(value) ? `${value}_count` : 'total_count';
  }
  function categoryIdentity(row){
    return [cleanText(row&&row.category_no),cleanText(row&&row.mall_code),cleanText(row&&(row.ui_lang_code||row.lang_code||row.country_code))].join('|');
  }

  async function changeCategoryPeriod(client, table, periodCol, periodVal, row, delta){
    if(!row || !row.category_no || !(await tableExists(table))) return;
    const countCol = langColumn(row.ui_lang_code || row.lang_code || row.country_code);
    const params = [periodVal,cleanText(row.category_no),cleanText(row.category_code),cleanText(row.category_name),cleanText(row.mall_code || '')];

    if(delta < 0){
      await client.query(
        `UPDATE ${table}
         SET total_count=GREATEST(0,COALESCE(total_count,0)-1),
             ${countCol}=GREATEST(0,COALESCE(${countCol},0)-1),
             updated_at=now()
         WHERE ${periodCol}=$1 AND category_no=$2
           AND COALESCE(mall_code,'')=COALESCE($5,'')`,params);
      return;
    }

    const updated = await client.query(
      `UPDATE ${table}
       SET category_code=$3, category_name=$4, mall_code=$5,
           total_count=COALESCE(total_count,0)+1,
           ${countCol}=COALESCE(${countCol},0)+1,
           last_search_at=now(), updated_at=now()
       WHERE ${periodCol}=$1 AND category_no=$2
         AND COALESCE(mall_code,'')=COALESCE($5,'')`,params);
    if(!updated.rowCount){
      await client.query(
        `INSERT INTO ${table}
          (${periodCol},category_no,category_code,category_name,mall_code,total_count,${countCol},first_search_at,last_search_at,updated_at)
         VALUES ($1,$2,$3,$4,$5,1,1,now(),now(),now())`,params);
    }
  }

  async function changeCategoryTotal(client,row,delta){
    if(!row || !row.category_no || !(await tableExists('gm_category'))) return;
    if(delta < 0){
      await client.query(
        `UPDATE gm_category SET search_count=GREATEST(0,COALESCE(search_count,0)-1),updated_at=now()
         WHERE gm_code=$1 OR cp_code=$1`,[cleanText(row.category_no)]);
    }else{
      await client.query(
        `UPDATE gm_category SET search_count=COALESCE(search_count,0)+1,last_search_at=now()::text,updated_at=now()
         WHERE gm_code=$1 OR cp_code=$1`,[cleanText(row.category_no)]);
    }
  }

  // 한 search_event_id는 1회만 집계한다. 후속 단계에서 정제어/카테고리가 확정되면
  // 검색수를 추가하지 않고 기존 집계 위치를 원문 기준에서 정제어 기준으로 이동한다.
  async function applySearch(row, previousRow){
    if(!row || !row.search_event_id) return { applied:false, reason:'search_row_missing' };
    const isNew=!previousRow;
    const categoryChanged=!!(previousRow && categoryIdentity(previousRow)!==categoryIdentity(row));
    if(!isNew && !categoryChanged) return { applied:false, reason:'same_search_update' };

    const client = await pool.connect();
    try{
      await client.query('BEGIN');
      const yyyymm=currentYyyymm();
      const yyyy=currentYyyy();

      if(categoryChanged){
        await changeCategoryTotal(client,previousRow,-1);
        await changeCategoryPeriod(client,'gm_category_search_monthly','yyyymm',yyyymm,previousRow,-1);
        await changeCategoryPeriod(client,'gm_category_search_yearly','yyyy',yyyy,previousRow,-1);
      }

      await changeCategoryTotal(client,row,1);
      await changeCategoryPeriod(client,'gm_category_search_monthly','yyyymm',yyyymm,row,1);
      await changeCategoryPeriod(client,'gm_category_search_yearly','yyyy',yyyy,row,1);

      await client.query('COMMIT');
      return { applied:true, moved:categoryChanged, search_event_id:row.search_event_id };
    }catch(error){
      try{ await client.query('ROLLBACK'); }catch(_rollbackError){}
      throw error;
    }finally{
      client.release();
    }
  }


  function detailIdentity(p){
    p=p||{};
    const mall=cleanText(p.mall_code||p.mallCode||'').toUpperCase();
    const explicitUid=cleanText(p.product_uid||p.productUid||p.uid||'');
    const key=cleanText(p.pi_ii_vi||p.piIiVi||p.pi||p.key||p.gm_key||'');
    const productId=cleanText(p.product_id||p.productId||'');
    const itemId=cleanText(p.item_id||p.itemId||'');
    const vendorItemId=cleanText(p.vendor_item_id||p.vendorItemId||'');
    const pi=key || [productId,itemId,vendorItemId].filter(Boolean).join('_');
    const uid=explicitUid || (mall && pi ? `${mall}_${pi}` : '');
    const candidates=[];
    for(const value of [uid, mall&&key?`${mall}_${key}`:'', mall&&productId?`${mall}_${productId}`:'']){
      if(value && !candidates.includes(value)) candidates.push(value);
    }
    return { mall, uid, pi, productId, itemId, vendorItemId, candidates };
  }

  async function applyDetail(payload){
    const id=detailIdentity(payload);
    if(!id.uid && !(id.mall && (id.pi || id.productId))){
      return { updated:0, reason:'product_key_missing' };
    }
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      const r=await client.query(`
        WITH target AS (
          SELECT product_uid
          FROM gm_product
          WHERE
            (cardinality($1::text[]) > 0 AND product_uid = ANY($1::text[]))
            OR ($2 <> '' AND $3 <> '' AND mall_code=$2 AND pi_ii_vi=$3)
            OR ($2 <> '' AND $4 <> '' AND mall_code=$2 AND product_id=$4
                AND ($5='' OR item_id=$5)
                AND ($6='' OR vendor_item_id=$6))
          ORDER BY
            CASE WHEN product_uid = ANY($1::text[]) THEN 0 ELSE 1 END,
            updated_at DESC NULLS LAST
          LIMIT 1
          FOR UPDATE
        )
        UPDATE gm_product p
        SET detail_view_count=COALESCE(p.detail_view_count,0)+1,
            view_count=COALESCE(p.view_count,0)+1,
            last_view_at=now(),
            expire_at=GREATEST(COALESCE(p.expire_at,now()),now()+INTERVAL '90 days'),
            updated_at=now()
        FROM target t
        WHERE p.product_uid=t.product_uid
        RETURNING p.product_uid,p.mall_code,p.pi_ii_vi,p.product_id,p.item_id,p.vendor_item_id,
                  p.detail_view_count,p.view_count,p.cp_fix_code,p.cp_selected_code,p.category_code
      `,[id.candidates,id.mall,id.pi,id.productId,id.itemId,id.vendorItemId]);
      const row=r.rows[0];
      if(!row){
        await client.query('ROLLBACK');
        return { updated:0, reason:'product_not_found', identity:id };
      }

      const categoryCode=cleanText(row.cp_fix_code||row.cp_selected_code||row.category_code||'');
      let categoryUpdated=0;
      if(categoryCode && await tableExists('gm_category')){
        const cr=await client.query(`
          UPDATE gm_category
          SET view_count=COALESCE(view_count,0)+1,last_view_at=now(),updated_at=now()
          WHERE gm_code=$1 OR cp_code=$1
        `,[categoryCode]);
        categoryUpdated=cr.rowCount||0;
      }
      await client.query('COMMIT');
      return {
        updated:1,
        category_updated:categoryUpdated,
        product_uid:row.product_uid,
        detail_view_count:Number(row.detail_view_count||0),
        view_count:Number(row.view_count||0)
      };
    }catch(error){
      try{ await client.query('ROLLBACK'); }catch(_rollbackError){}
      throw error;
    }finally{
      client.release();
    }
  }

  return { applySearch, applyDetail };
};
