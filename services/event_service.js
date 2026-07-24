// EVENT_SERVICE_V016_COUNTER_LIGHTWEIGHT_NO_LEDGER
'use strict';

const networkEngine = require('./GM_NETWORK_INCENTIVE_ENGINE');

module.exports = function createEventService(deps){
  const { pool, tableExists, cleanText, currentYyyymm, currentYyyy } = deps;
  const LANGS = new Set(['ko','en','zh','vi','ja','tw','th','uz','ne','km','id','tl','mn','my','kk','si','ru','bn','ur','lo','hi','tr','fa','es','fr']);

  function n0(v){ const n=Number(v); return Number.isFinite(n)?Math.round(n):0; }
  function langColumn(v){ const value=cleanText(v||'').toLowerCase(); return LANGS.has(value)?`${value}_count`:''; }
  function categoryIdentity(row){ return [cleanText(row&&row.category_no),cleanText(row&&row.mall_code),cleanText(row&&(row.ui_lang_code||row.lang_code||row.country_code))].join('|'); }
  function productUid(row){
    const explicit=cleanText(row&&(row.product_uid||row.productUid||row.source_uid||row.sourceUid));
    if(explicit) return explicit;
    const mall=cleanText(row&&(row.mall_code||row.mallCode||row.source_mall||row.sourceMall)).toUpperCase();
    const pi=cleanText(row&&(row.pi_ii_vi||row.piIiVi));
    return mall&&pi?`${mall}_${pi}`:pi;
  }
  let networkReadyKey='';
  function kstParts(baseDate=new Date()){
    const d=new Date(baseDate.getTime()+9*60*60*1000);
    return { year:String(d.getUTCFullYear()), month:String(d.getUTCMonth()+1).padStart(2,'0'), day:String(d.getUTCDate()).padStart(2,'0'), yyyymm:String(d.getUTCFullYear())+String(d.getUTCMonth()+1).padStart(2,'0'), ym:String(d.getUTCFullYear())+'_'+String(d.getUTCMonth()+1).padStart(2,'0') };
  }

  async function changeCategoryPeriod(client,table,periodCol,periodVal,row,delta){
    if(!row||!row.category_no||!(await tableExists(table))) return;
    const countCol=langColumn(row.ui_lang_code||row.lang_code||row.country_code);
    const params=[periodVal,cleanText(row.category_no),cleanText(row.category_code),cleanText(row.category_name),cleanText(row.mall_code||'')];
    const langDec=countCol?`,${countCol}=GREATEST(0,COALESCE(${countCol},0)-1)`:'';
    const langInc=countCol?`,${countCol}=COALESCE(${countCol},0)+1`:'';
    if(delta<0){
      await client.query(`UPDATE ${table} SET total_count=GREATEST(0,COALESCE(total_count,0)-1)${langDec},updated_at=now() WHERE ${periodCol}=$1 AND category_no=$2 AND COALESCE(mall_code,'')=COALESCE($5,'')`,params);
      return;
    }
    const updated=await client.query(`UPDATE ${table} SET category_code=$3,category_name=$4,mall_code=$5,total_count=COALESCE(total_count,0)+1${langInc},last_search_at=now(),updated_at=now() WHERE ${periodCol}=$1 AND category_no=$2 AND COALESCE(mall_code,'')=COALESCE($5,'')`,params);
    if(!updated.rowCount){
      const cols=countCol?`,${countCol}`:'';
      const vals=countCol?',1':'';
      await client.query(`INSERT INTO ${table} (${periodCol},category_no,category_code,category_name,mall_code,total_count${cols},first_search_at,last_search_at,updated_at) VALUES ($1,$2,$3,$4,$5,1${vals},now(),now(),now())`,params);
    }
  }
  async function changeCategoryTotal(client,row,delta){
    if(!row||!row.category_no||!(await tableExists('gm_category'))) return;
    if(delta<0) await client.query(`UPDATE gm_category SET search_count=GREATEST(0,COALESCE(search_count,0)-1),updated_at=now() WHERE gm_code=$1 OR cp_code=$1`,[cleanText(row.category_no)]);
    else await client.query(`UPDATE gm_category SET search_count=COALESCE(search_count,0)+1,last_search_at=now()::text,updated_at=now() WHERE gm_code=$1 OR cp_code=$1`,[cleanText(row.category_no)]);
  }
  async function applySearch(row,previousRow){
    if(!row||!row.search_event_id) return {applied:false,reason:'search_row_missing'};
    const isNew=!previousRow;
    const categoryChanged=!!(previousRow&&categoryIdentity(previousRow)!==categoryIdentity(row));
    if(!isNew&&!categoryChanged) return {applied:false,reason:'same_search_update'};
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      if(categoryChanged){
        await changeCategoryTotal(client,previousRow,-1);
        await changeCategoryPeriod(client,'gm_category_search_monthly','yyyymm',currentYyyymm(),previousRow,-1);
        await changeCategoryPeriod(client,'gm_category_search_yearly','yyyy',currentYyyy(),previousRow,-1);
      }
      await changeCategoryTotal(client,row,1);
      await changeCategoryPeriod(client,'gm_category_search_monthly','yyyymm',currentYyyymm(),row,1);
      await changeCategoryPeriod(client,'gm_category_search_yearly','yyyy',currentYyyy(),row,1);
      await client.query('COMMIT');
      return {applied:true,moved:categoryChanged,search_event_id:row.search_event_id};
    }catch(error){ try{await client.query('ROLLBACK');}catch(_e){} throw error; }
    finally{ client.release(); }
  }

  // 조회·장바구니 카운터는 통계값이며 영구 이벤트 원장을 만들지 않는다.
  // DB/서버 재시작 경계의 극소수 중복·누락은 허용하고, 서버 메모리 캐시도 사용하지 않는다.
  // 장바구니는 gm_basket 최초 INSERT 여부를 호출부에서 판정해 전달한다.

  function detailIdentity(p){
    p=p||{};
    const mall=cleanText(p.mall_code||p.mallCode||'').toUpperCase();
    const explicitUid=cleanText(p.product_uid||p.productUid||p.uid||'');
    const rawKey=cleanText(p.pi_ii_vi||p.piIiVi||p.pi||p.key||p.gm_key||'');
    const productId=cleanText(p.product_id||p.productId||'');
    const itemId=cleanText(p.item_id||p.itemId||'');
    const vendorItemId=cleanText(p.vendor_item_id||p.vendorItemId||'');
    const prefix=mall?`${mall}_`:'';
    const keyIsUid=!!(prefix&&rawKey.toUpperCase().startsWith(prefix));
    const keyUid=keyIsUid?rawKey:'';
    const keyPi=keyIsUid?rawKey.slice(prefix.length):rawKey;
    const pi=keyPi||[productId,itemId,vendorItemId].filter(Boolean).join('_');
    const uid=explicitUid||keyUid||(mall&&pi?`${mall}_${pi}`:'');
    const candidates=[];
    for(const value of [explicitUid,keyUid,uid,mall&&keyPi?`${mall}_${keyPi}`:'',mall&&productId?`${mall}_${productId}`:'']) if(value&&!candidates.includes(value)) candidates.push(value);
    return {mall,uid,pi,productId,itemId,vendorItemId,candidates};
  }
  async function applyDetail(clientOrPayload,maybePayload){
    const externalClient=!!(clientOrPayload&&typeof clientOrPayload.query==='function');
    const payload=externalClient?(maybePayload||{}):(clientOrPayload||{});
    const id=detailIdentity(payload);
    if(!id.uid&&!(id.mall&&(id.pi||id.productId))) return {updated:0,reason:'product_key_missing'};
    const client=externalClient?clientOrPayload:await pool.connect();
    try{
      if(!externalClient) await client.query('BEGIN');
      const r=await client.query(`WITH target AS (SELECT product_uid FROM gm_product WHERE (cardinality($1::text[])>0 AND product_uid=ANY($1::text[])) OR ($2<>'' AND $3<>'' AND mall_code=$2 AND pi_ii_vi=$3) OR ($2<>'' AND $4<>'' AND mall_code=$2 AND product_id=$4 AND ($5='' OR item_id=$5) AND ($6='' OR vendor_item_id=$6)) ORDER BY CASE WHEN product_uid=ANY($1::text[]) THEN 0 ELSE 1 END,updated_at DESC NULLS LAST LIMIT 1 FOR UPDATE) UPDATE gm_product p SET detail_view_count=COALESCE(p.detail_view_count,0)+1,view_count=COALESCE(p.view_count,0)+1,last_view_at=now(),expire_at=GREATEST(COALESCE(p.expire_at,now()),now()+INTERVAL '90 days'),updated_at=now() FROM target t WHERE p.product_uid=t.product_uid RETURNING p.product_uid,p.detail_view_count,p.view_count,p.cp_fix_code,p.cp_selected_code,p.category_code`,[id.candidates,id.mall,id.pi,id.productId,id.itemId,id.vendorItemId]);
      const row=r.rows[0];
      if(!row){ if(!externalClient) await client.query('ROLLBACK'); return {updated:0,reason:'product_not_found',identity:id}; }
      const categoryCode=cleanText(row.cp_fix_code||row.cp_selected_code||row.category_code||'');
      let categoryUpdated=0;
      if(categoryCode&&await tableExists('gm_category')){
        const cr=await client.query(`UPDATE gm_category SET view_count=COALESCE(view_count,0)+1,last_view_at=now(),updated_at=now() WHERE gm_code=$1 OR cp_code=$1`,[categoryCode]);
        categoryUpdated=cr.rowCount||0;
      }
      if(!externalClient) await client.query('COMMIT');
      return {updated:1,counted:true,category_updated:categoryUpdated,product_uid:row.product_uid,detail_view_count:Number(row.detail_view_count||0),view_count:Number(row.view_count||0)};
    }catch(error){ if(!externalClient){try{await client.query('ROLLBACK');}catch(_e){}} throw error; }
    finally{ if(!externalClient) client.release(); }
  }

  async function applyBasketAdd(clientOrPool,row){
    if(!row) return {updated:0,reason:'basket_row_missing'};
    const externalClient=!!(clientOrPool&&typeof clientOrPool.release==='function');
    const client=externalClient?clientOrPool:await pool.connect();
    const uid=productUid(row);
    const mall=cleanText(row.mall_code||row.mallCode).toUpperCase();
    const pi=cleanText(row.pi_ii_vi||row.piIiVi);
    if(!uid&&!mall&&!pi){ if(!externalClient) client.release(); return {updated:0,reason:'product_key_missing'}; }
    try{
      if(!externalClient) await client.query('BEGIN');
      const r=await client.query(`UPDATE gm_product SET cart_count=COALESCE(cart_count,0)+1,last_cart_at=now(),expire_at=GREATEST(COALESCE(expire_at,now()),now()+INTERVAL '180 days'),updated_at=now() WHERE ($1<>'' AND product_uid=$1) OR ($2<>'' AND $3<>'' AND mall_code=$2 AND pi_ii_vi=$3) RETURNING product_uid,cart_count,cp_fix_code,cp_selected_code,category_code`,[uid,mall,pi]);
      const p=r.rows[0];
      if(!p){ if(!externalClient) await client.query('ROLLBACK'); return {updated:0,reason:'product_not_found'}; }
      const categoryCode=cleanText(p.cp_fix_code||p.cp_selected_code||p.category_code||'');
      if(categoryCode&&await tableExists('gm_category')) await client.query(`UPDATE gm_category SET cart_count=COALESCE(cart_count,0)+1,updated_at=now() WHERE gm_code=$1 OR cp_code=$1`,[categoryCode]);
      if(!externalClient) await client.query('COMMIT');
      return {updated:1,counted:true,product_uid:p.product_uid,cart_count:Number(p.cart_count||0)};
    }catch(error){ if(!externalClient){try{await client.query('ROLLBACK');}catch(_e){}} throw error; }
    finally{ if(!externalClient) client.release(); }
  }

  async function reserveSalesEvent(client,order,item){
    if(!(await tableExists('gm_sales_aggregate_event'))) throw new Error('gm_sales_aggregate_event_table_missing');
    const uid=productUid(item);
    const key=cleanText(item.pi_ii_vi||item.source_uid||item.sourceUid||uid);
    const qty=Math.max(1,n0(item.quantity||1));
    const sales=n0(item.product_amount||n0(item.customer_order_price||item.mall_sale_price)*qty);
    const purchase=n0(item.purchase_amount||n0(item.final_supply_price)*qty);
    const r=await client.query(`INSERT INTO gm_sales_aggregate_event (order_no,item_key,pi_ii_vi,product_uid,sales_qty,sales_amount,purchase_amount,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,now()) ON CONFLICT (order_no,item_key) DO NOTHING RETURNING id`,[cleanText(order.order_no),key,cleanText(item.pi_ii_vi),uid,qty,sales,purchase]);
    return !!r.rowCount;
  }
  async function updateOperationalSales(client,order,item){
    const uid=productUid(item); if(!uid) return;
    const qty=Math.max(1,n0(item.quantity||1));
    const sales=n0(item.product_amount||n0(item.customer_order_price||item.mall_sale_price)*qty);
    const purchase=n0(item.purchase_amount||n0(item.final_supply_price)*qty);
    const isAd=!!(item.ad_yn==='Y'||item.adYn==='Y'||item.is_ad||item.isAd||item.ad_source||item.adSource);
    await client.query(`UPDATE gm_product SET order_count=COALESCE(order_count,0)+1,sales_qty=COALESCE(sales_qty,0)+$2,sales_amount=COALESCE(sales_amount,0)+$3,purchase_amount=COALESCE(purchase_amount,0)+$4,gross_profit=COALESCE(gross_profit,0)+($3-$4),ad_order_count=COALESCE(ad_order_count,0)+$5,ad_sales_qty=COALESCE(ad_sales_qty,0)+$6,ad_sales_amount=COALESCE(ad_sales_amount,0)+$7,last_order_at=now(),last_ad_order_at=CASE WHEN $5>0 THEN now() ELSE last_ad_order_at END,updated_at=now() WHERE product_uid=$1`,[uid,qty,sales,purchase,isAd?1:0,isAd?qty:0,isAd?sales:0]);
    const pr=await client.query(`SELECT cp_fix_code,cp_selected_code,category_code FROM gm_product WHERE product_uid=$1 LIMIT 1`,[uid]);
    const cat=cleanText(item.category_no||item.category_code||order.category_no||order.category_code||(pr.rows[0]&&(pr.rows[0].cp_fix_code||pr.rows[0].cp_selected_code||pr.rows[0].category_code))||'');
    if(cat&&await tableExists('gm_category')) await client.query(`UPDATE gm_category SET order_count=COALESCE(order_count,0)+1,sales_qty=COALESCE(sales_qty,0)+$2,sales_amount=COALESCE(sales_amount,0)+$3,purchase_amount=COALESCE(purchase_amount,0)+$4,gross_profit=COALESCE(gross_profit,0)+($3-$4),last_order_at=now(),updated_at=now() WHERE gm_code=$1 OR cp_code=$1`,[cat,qty,sales,purchase]);
  }
  async function upsertSalesPeriods(client,order,item){
    const k=kstParts();
    const uid=productUid(item); if(!uid) return;
    const qty=Math.max(1,n0(item.quantity||1));
    const sales=n0(item.product_amount||n0(item.customer_order_price||item.mall_sale_price)*qty);
    const purchase=n0(item.purchase_amount||n0(item.final_supply_price)*qty);
    const pi=cleanText(item.pi_ii_vi);
    const mall=cleanText(item.mall_code||item.source_mall).toUpperCase();
    const pname=cleanText(item.product_name);
    const country=cleanText(order.country_code||order.member_country_code||order.receiver_country_code||order.lang_code||order.ui_lang_code||'');
    let cat=cleanText(item.category_no||item.category_code||order.category_no||order.category_code||'');
    if(!cat){ const pr=await client.query(`SELECT cp_fix_code,cp_selected_code,category_code FROM gm_product WHERE product_uid=$1 LIMIT 1`,[uid]); cat=cleanText(pr.rows[0]&&(pr.rows[0].cp_fix_code||pr.rows[0].cp_selected_code||pr.rows[0].category_code)); }
    const gross=sales-purchase;
    async function upProduct(table,col,val){ if(!(await tableExists(table))) return; await client.query(`INSERT INTO ${table} (${col},product_uid,pi_ii_vi,mall_code,product_name,category_no,category_code,sales_qty,sales_amount,purchase_amount,gross_profit,margin_rate,first_order_at,last_order_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$6,$7,$8,$9,$10,CASE WHEN $8>0 THEN ROUND(($10/$8)*100,4) ELSE 0 END,now(),now(),now()) ON CONFLICT (${col},product_uid) DO UPDATE SET product_name=EXCLUDED.product_name,category_no=EXCLUDED.category_no,category_code=EXCLUDED.category_code,sales_qty=${table}.sales_qty+EXCLUDED.sales_qty,sales_amount=${table}.sales_amount+EXCLUDED.sales_amount,purchase_amount=${table}.purchase_amount+EXCLUDED.purchase_amount,gross_profit=(${table}.sales_amount+EXCLUDED.sales_amount)-(${table}.purchase_amount+EXCLUDED.purchase_amount),margin_rate=CASE WHEN (${table}.sales_amount+EXCLUDED.sales_amount)>0 THEN ROUND((((${table}.sales_amount+EXCLUDED.sales_amount)-(${table}.purchase_amount+EXCLUDED.purchase_amount))/(${table}.sales_amount+EXCLUDED.sales_amount))*100,4) ELSE 0 END,last_order_at=now(),updated_at=now()`,[val,uid,pi,mall,pname,cat,qty,sales,purchase,gross]); }
    async function upCategory(table,col,val){ if(!cat||!(await tableExists(table))) return; await client.query(`INSERT INTO ${table} (${col},category_no,category_code,category_name,sales_qty,sales_amount,purchase_amount,gross_profit,margin_rate,first_order_at,last_order_at,updated_at) VALUES ($1,$2,$2,'',$3,$4,$5,$6,CASE WHEN $4>0 THEN ROUND(($6/$4)*100,4) ELSE 0 END,now(),now(),now()) ON CONFLICT (${col},category_no) DO UPDATE SET sales_qty=${table}.sales_qty+EXCLUDED.sales_qty,sales_amount=${table}.sales_amount+EXCLUDED.sales_amount,purchase_amount=${table}.purchase_amount+EXCLUDED.purchase_amount,gross_profit=(${table}.sales_amount+EXCLUDED.sales_amount)-(${table}.purchase_amount+EXCLUDED.purchase_amount),margin_rate=CASE WHEN (${table}.sales_amount+EXCLUDED.sales_amount)>0 THEN ROUND((((${table}.sales_amount+EXCLUDED.sales_amount)-(${table}.purchase_amount+EXCLUDED.purchase_amount))/(${table}.sales_amount+EXCLUDED.sales_amount))*100,4) ELSE 0 END,last_order_at=now(),updated_at=now()`,[val,cat,qty,sales,purchase,gross]); }
    async function upProductCountry(table,col,val){ if(!country||!(await tableExists(table))) return; await client.query(`INSERT INTO ${table} (${col},product_uid,country_code,mall_code,sales_qty,sales_amount,purchase_amount,first_order_at,last_order_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,now(),now(),now()) ON CONFLICT (${col},product_uid,country_code) DO UPDATE SET sales_qty=${table}.sales_qty+EXCLUDED.sales_qty,sales_amount=${table}.sales_amount+EXCLUDED.sales_amount,purchase_amount=${table}.purchase_amount+EXCLUDED.purchase_amount,last_order_at=now(),updated_at=now()`,[val,uid,country,mall,qty,sales,purchase]); }
    async function upCategoryCountry(table,col,val){ if(!cat||!country||!(await tableExists(table))) return; await client.query(`INSERT INTO ${table} (${col},category_no,country_code,sales_qty,sales_amount,purchase_amount,first_order_at,last_order_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,now(),now(),now()) ON CONFLICT (${col},category_no,country_code) DO UPDATE SET sales_qty=${table}.sales_qty+EXCLUDED.sales_qty,sales_amount=${table}.sales_amount+EXCLUDED.sales_amount,purchase_amount=${table}.purchase_amount+EXCLUDED.purchase_amount,last_order_at=now(),updated_at=now()`,[val,cat,country,qty,sales,purchase]); }
    await upProduct('gm_product_sales_monthly','yyyymm',k.yyyymm); await upProduct('gm_product_sales_yearly','yyyy',k.year);
    await upCategory('gm_category_sales_monthly','yyyymm',k.yyyymm); await upCategory('gm_category_sales_yearly','yyyy',k.year);
    await upProductCountry('gm_product_country_sales_monthly','yyyymm',k.yyyymm); await upProductCountry('gm_product_country_sales_yearly','yyyy',k.year);
    await upCategoryCountry('gm_category_country_sales_monthly','yyyymm',k.yyyymm); await upCategoryCountry('gm_category_country_sales_yearly','yyyy',k.year);
  }
  async function loadUpstream(client,buyerId){
    if(!buyerId) return [];
    const r=await client.query(`WITH RECURSIVE up AS (SELECT member_id,recommender_id,1 AS step_no FROM gm_member WHERE member_id=$1 UNION ALL SELECT m.member_id,m.recommender_id,up.step_no+1 FROM gm_member m JOIN up ON m.member_id=up.recommender_id WHERE up.step_no<5 AND COALESCE(up.recommender_id,'')<>'') SELECT recommender_id AS member_id,step_no FROM up WHERE COALESCE(recommender_id,'')<>'' ORDER BY step_no`,[buyerId]);
    const seen=new Set(); const out=[];
    for(const row of r.rows){ const id=cleanText(row.member_id); if(id&&!seen.has(id)){seen.add(id);out.push({member_id:id,step_no:Number(row.step_no)});} }
    return out;
  }
  async function activeRates(client){
    const map=new Map([[1,0.5],[2,0.4],[3,0.3],[4,0.2],[5,0.1]]);
    if(!(await tableExists('gm_network_incentive_rate'))) return map;
    const r=await client.query(`SELECT DISTINCT ON (step_no) step_no,rate_percent FROM gm_network_incentive_rate WHERE active_yn='Y' AND effective_from<=CURRENT_DATE AND (effective_to IS NULL OR effective_to>=CURRENT_DATE) ORDER BY step_no,effective_from DESC`);
    for(const row of r.rows) map.set(Number(row.step_no),Number(row.rate_percent||0));
    return map;
  }
  async function applyNetworkSales(client,order,amount){
    const buyer=cleanText(order.member_id); if(!buyer||amount<=0) return {updated:0};
    const p=networkEngine.periodNames();
    const readyKey=p.currentYm+'|'+p.currentYear;
    if(networkReadyKey!==readyKey){
      await networkEngine.ensureNetworkTables(client);
      networkReadyKey=readyKey;
    }
    const upstream=await loadUpstream(client,buyer);
    const rates=await activeRates(client);
    const monthOrder=networkEngine.monthlyOrderTable(p.currentYm);
    const yearOrder=networkEngine.yearlyOrderTable(p.currentYear);
    const monthNet=networkEngine.monthlyNetworkTable(p.currentYm);
    const yearNet=networkEngine.yearlyNetworkTable(p.currentYear);
    await client.query(`INSERT INTO "${monthNet}" (member_id,self_purchase_amount) VALUES ($1,$2) ON CONFLICT (member_id) DO UPDATE SET self_purchase_amount="${monthNet}".self_purchase_amount+EXCLUDED.self_purchase_amount,updated_at=now()`,[buyer,amount]);
    for(const u of upstream){
      await networkEngine.addMonthlyAmount(client,{tableName:monthOrder,prefix:'order',memberId:u.member_id,stepNo:u.step_no,day:Number(p.day),amount});
      await networkEngine.addYearlyAmount(client,{tableName:yearOrder,prefix:'order',memberId:u.member_id,stepNo:u.step_no,month:Number(p.month),amount});
      const rate=Number(rates.get(u.step_no)||0);
      const incentive=Math.round(amount*rate/100);
      const step=u.step_no;
      await client.query(`INSERT INTO "${monthNet}" (member_id,step${step}_sales_amount,step${step}_rate,step${step}_incentive_amount,total_sales_amount,gross_incentive_amount,qualified_incentive_amount,cash_amount,point_amount,net_cash_amount) VALUES ($1,$2,$3,$4,$2,$4,$4,ROUND($4*0.8),ROUND($4*0.2),ROUND($4*0.8)) ON CONFLICT (member_id) DO UPDATE SET step${step}_sales_amount="${monthNet}".step${step}_sales_amount+EXCLUDED.step${step}_sales_amount,step${step}_rate=EXCLUDED.step${step}_rate,step${step}_incentive_amount="${monthNet}".step${step}_incentive_amount+EXCLUDED.step${step}_incentive_amount,total_sales_amount="${monthNet}".total_sales_amount+EXCLUDED.total_sales_amount,gross_incentive_amount="${monthNet}".gross_incentive_amount+EXCLUDED.gross_incentive_amount,qualified_incentive_amount="${monthNet}".qualified_incentive_amount+EXCLUDED.qualified_incentive_amount,cash_amount="${monthNet}".cash_amount+EXCLUDED.cash_amount,point_amount="${monthNet}".point_amount+EXCLUDED.point_amount,net_cash_amount="${monthNet}".net_cash_amount+EXCLUDED.net_cash_amount,updated_at=now()`,[u.member_id,amount,rate,incentive]);
      await client.query(`INSERT INTO "${yearNet}" (member_id,sales_${p.month},sales_total,incentive_${p.month},incentive_total,cash_total,point_total) VALUES ($1,$2,$2,$3,$3,ROUND($3*0.8),ROUND($3*0.2)) ON CONFLICT (member_id) DO UPDATE SET sales_${p.month}="${yearNet}".sales_${p.month}+EXCLUDED.sales_${p.month},sales_total="${yearNet}".sales_total+EXCLUDED.sales_total,incentive_${p.month}="${yearNet}".incentive_${p.month}+EXCLUDED.incentive_${p.month},incentive_total="${yearNet}".incentive_total+EXCLUDED.incentive_total,cash_total="${yearNet}".cash_total+EXCLUDED.cash_total,point_total="${yearNet}".point_total+EXCLUDED.point_total,updated_at=now()`,[u.member_id,amount,incentive]);
    }
    return {updated:upstream.length,upstream};
  }
  async function applyMemberJoin(client,payload){
    const memberId=cleanText(payload && (payload.member_id||payload.memberId));
    if(!memberId) throw new Error('member_id_missing');

    const memberRow=(await client.query(
      `SELECT member_id,recommender_id FROM gm_member WHERE member_id=$1 LIMIT 1`,
      [memberId]
    )).rows[0];
    if(!memberRow) throw new Error(`member_not_found:${memberId}`);

    let ancestorId=cleanText(memberRow.recommender_id || (payload && payload.recommender_id));
    const ancestors=[];
    const seen=new Set([memberId]);
    for(let depth=1; depth<=5 && ancestorId; depth++){
      if(seen.has(ancestorId)) throw new Error(`member_relation_cycle:${memberId}:${ancestorId}`);
      seen.add(ancestorId);
      const row=(await client.query(
        `SELECT member_id,recommender_id FROM gm_member WHERE member_id=$1 LIMIT 1`,
        [ancestorId]
      )).rows[0];
      if(!row) break;
      ancestors.push({member_id:cleanText(row.member_id),depth});
      ancestorId=cleanText(row.recommender_id);
    }

    const up=[0,0,0,0,0];
    for(const a of ancestors) up[a.depth-1]=1;
    await client.query(
      `INSERT INTO gm_member_relation_count (
         member_id,up_1_count,up_2_count,up_3_count,up_4_count,up_5_count,up_total_count,
         down_1_count,down_2_count,down_3_count,down_4_count,down_5_count,down_total_count,
         calculated_yn
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,0,0,0,0,0,0,'T')
       ON CONFLICT (member_id) DO UPDATE SET
         up_1_count=EXCLUDED.up_1_count,
         up_2_count=EXCLUDED.up_2_count,
         up_3_count=EXCLUDED.up_3_count,
         up_4_count=EXCLUDED.up_4_count,
         up_5_count=EXCLUDED.up_5_count,
         up_total_count=EXCLUDED.up_total_count,
         calculated_yn='T'`,
      [memberId,up[0],up[1],up[2],up[3],up[4],ancestors.length]
    );

    for(const a of ancestors){
      const col=`down_${a.depth}_count`;
      await client.query(
        `INSERT INTO gm_member_relation_count (
           member_id,${col},down_total_count,calculated_yn
         ) VALUES ($1,1,1,'F')
         ON CONFLICT (member_id) DO UPDATE SET
           ${col}=gm_member_relation_count.${col}+1,
           down_total_count=gm_member_relation_count.down_total_count+1`,
        [a.member_id]
      );
    }

    await client.query(`UPDATE gm_member SET relation_calculated_yn='Y',updated_at=NOW() WHERE member_id=$1`,[memberId]);
    return {applied:true,member_id:memberId,upline_count:ancestors.length,ancestors};
  }

  async function applyMemberAttach(client,payload){
    const memberId=cleanText(payload && (payload.member_id||payload.memberId));
    if(!memberId) throw new Error('member_id_missing');
    const member=(await client.query(`SELECT member_id,recommender_id,relation_calculated_yn,recommender_updated_at FROM gm_member WHERE member_id=$1 FOR UPDATE`,[memberId])).rows[0];
    if(!member) throw new Error(`member_not_found:${memberId}`);
    if(cleanText(member.relation_calculated_yn)==='Y') return {skipped:true,reason:'already_calculated',member_id:memberId};
    const recommenderId=cleanText(member.recommender_id);
    if(!recommenderId) throw new Error(`recommender_missing:${memberId}`);

    /*
     * 사후 추천인 연결 카운터의 기준 시점 정책
     * -----------------------------------------
     * 1) gm_member_relation_count 저장값은 이벤트 지연/과거 누락 가능성이 있어 계산 원본으로 쓰지 않는다.
     * 2) 실제 gm_member.recommender_id 트리를 직접 조회한다.
     * 3) 다만 추천인 연결 후 새로 가입한 하위 회원은 applyMemberJoin()이 새 업라인에 이미 반영한다.
     *    야간 attach 작업에서 그 회원까지 다시 더하면 이중 카운트가 되므로,
     *    owner.recommender_updated_at 이전에 현재 추천인 관계가 이미 성립한 하위 회원만 '이동 대상 스냅샷'으로 포함한다.
     * 4) 스냅샷 안에 기존 하위 4단계가 한 명이라도 있으면 정책 위반 데이터이므로 카운터를 적용하지 않는다.
     * 5) 현재 전체 하위 회원의 up 카운터 재계산은 별도 작업이며, 이는 값을 덮어쓰는 방식이라 이중 증가가 없다.
     */
    const attachBoundary=member.recommender_updated_at;
    if(!attachBoundary) throw new Error(`recommender_updated_at_missing:${memberId}`);
    const actualDownResult=await client.query(`WITH RECURSIVE tree AS (
      SELECT m.member_id,1 AS depth,ARRAY[$1::text,m.member_id::text] AS path
      FROM gm_member m
      WHERE LOWER(COALESCE(m.recommender_id,''))=LOWER($1)
        AND COALESCE(m.recommender_updated_at,m.created_at) <= $2
      UNION ALL
      SELECT m.member_id,t.depth+1,t.path||m.member_id::text
      FROM gm_member m
      JOIN tree t ON LOWER(COALESCE(m.recommender_id,''))=LOWER(t.member_id)
      WHERE t.depth<4
        AND COALESCE(m.recommender_updated_at,m.created_at) <= $2
        AND NOT (m.member_id::text=ANY(t.path))
    )
    SELECT depth,COUNT(*)::bigint AS cnt
    FROM tree
    GROUP BY depth
    ORDER BY depth`,[memberId,attachBoundary]);
    const actualDown=[0,0,0,0];
    for(const row of actualDownResult.rows){
      const depth=Number(row.depth||0);
      if(depth>=1&&depth<=4) actualDown[depth-1]=Number(row.cnt||0);
    }
    if(actualDown[3]>0){
      throw new Error(`late_recommender_blocked_depth_4:${memberId}:${actualDown[3]}`);
    }
    const down=[1,actualDown[0],actualDown[1],actualDown[2],actualDown[3]];

    const ancestors=[]; let current=recommenderId; const seen=new Set([memberId]);
    for(let depth=1; depth<=5 && current; depth++){
      if(seen.has(current)) throw new Error(`member_relation_cycle:${memberId}:${current}`);
      seen.add(current);
      const row=(await client.query(`SELECT member_id,recommender_id FROM gm_member WHERE member_id=$1 FOR UPDATE`,[current])).rows[0];
      if(!row) break;
      ancestors.push({member_id:cleanText(row.member_id),depth});
      current=cleanText(row.recommender_id);
    }

    // 대상 회원과 기존 하위 4촌까지의 업라인 존재 카운트를 최신 추천인 체인으로 다시 계산한다.
    const affected=await client.query(`WITH RECURSIVE tree AS (
      SELECT member_id,0 AS depth,ARRAY[member_id::text] AS path
      FROM gm_member
      WHERE member_id=$1
      UNION ALL
      SELECT m.member_id,t.depth+1,t.path||m.member_id::text
      FROM gm_member m
      JOIN tree t ON LOWER(COALESCE(m.recommender_id,''))=LOWER(t.member_id)
      WHERE t.depth<4
        AND NOT (m.member_id::text=ANY(t.path))
    )
    SELECT member_id,depth
    FROM tree
    ORDER BY depth DESC,member_id`,[memberId]);
    for(const row of affected.rows){
      const id=cleanText(row.member_id);
      let upId=id; const ups=[0,0,0,0,0]; const localSeen=new Set([id]);
      for(let depth=1; depth<=5; depth++){
        const q=(await client.query(`SELECT recommender_id FROM gm_member WHERE member_id=$1 LIMIT 1`,[upId])).rows[0];
        const next=cleanText(q&&q.recommender_id);
        if(!next) break;
        if(localSeen.has(next)) throw new Error(`member_relation_cycle:${id}:${next}`);
        localSeen.add(next); ups[depth-1]=1; upId=next;
      }
      await client.query(`INSERT INTO gm_member_relation_count(member_id,up_1_count,up_2_count,up_3_count,up_4_count,up_5_count,up_total_count,calculated_yn)
        VALUES($1,$2,$3,$4,$5,$6,$7,'T') ON CONFLICT(member_id) DO UPDATE SET
        up_1_count=EXCLUDED.up_1_count,up_2_count=EXCLUDED.up_2_count,up_3_count=EXCLUDED.up_3_count,up_4_count=EXCLUDED.up_4_count,up_5_count=EXCLUDED.up_5_count,up_total_count=EXCLUDED.up_total_count,calculated_yn='T'`,
        [id,ups[0],ups[1],ups[2],ups[3],ups[4],ups.reduce((a,b)=>a+b,0)]);
    }

    // 새 업라인 최대 5명의 하위 카운터에 대상 회원의 기존 하위 묶음을 촌수 이동해 더한다.
    for(const a of ancestors){
      const inc=[0,0,0,0,0];
      for(let d=0; d<down.length; d++){ const target=a.depth+d; if(target<=5) inc[target-1]+=down[d]; }
      const total=inc.reduce((x,y)=>x+y,0);
      await client.query(`INSERT INTO gm_member_relation_count(member_id,down_1_count,down_2_count,down_3_count,down_4_count,down_5_count,down_total_count,calculated_yn)
        VALUES($1,$2,$3,$4,$5,$6,$7,'T') ON CONFLICT(member_id) DO UPDATE SET
        down_1_count=gm_member_relation_count.down_1_count+EXCLUDED.down_1_count,
        down_2_count=gm_member_relation_count.down_2_count+EXCLUDED.down_2_count,
        down_3_count=gm_member_relation_count.down_3_count+EXCLUDED.down_3_count,
        down_4_count=gm_member_relation_count.down_4_count+EXCLUDED.down_4_count,
        down_5_count=gm_member_relation_count.down_5_count+EXCLUDED.down_5_count,
        down_total_count=gm_member_relation_count.down_total_count+EXCLUDED.down_total_count`,
        [a.member_id,inc[0],inc[1],inc[2],inc[3],inc[4],total]);
    }
    await client.query(`UPDATE gm_member SET relation_calculated_yn='Y',updated_at=NOW() WHERE member_id=$1`,[memberId]);
    return {
      applied:true,
      member_id:memberId,
      upline_count:ancestors.length,
      affected_member_count:affected.rowCount,
      down_snapshot:down,
      down_source:'gm_member_actual_tree_at_attach_boundary',
      attach_boundary:attachBoundary
    };
  }

  async function applyOrderCreate(client,order,items){
    let accepted=0,totalSales=0,totalQty=0;
    for(const item of items||[]){
      if(!(await reserveSalesEvent(client,order,item))) continue;
      const qty=Math.max(1,n0(item.quantity||1));
      const sales=n0(item.product_amount||n0(item.customer_order_price||item.mall_sale_price)*qty);
      await updateOperationalSales(client,order,item);
      await upsertSalesPeriods(client,order,item);
      accepted++; totalSales+=sales; totalQty+=qty;
    }
    let network={updated:0};
    if(totalSales>0) network=await applyNetworkSales(client,order,totalSales);
    return {applied:accepted>0,accepted_items:accepted,sales_qty:totalQty,sales_amount:totalSales,network_updated:network.updated||0};
  }

  return { applySearch, applyDetail, applyBasketAdd, applyMemberJoin, applyMemberAttach, applyOrderCreate };
};
