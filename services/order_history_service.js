/* services/order_history_service.js
 * GM_ORDER_HISTORY_SERVICE_V001
 * 주문 생성/처리와 분리된 주문조회 전용 서비스.
 */
'use strict';

function text(v){ return String(v == null ? '' : v).trim(); }
function int(v,d){ const n=Number(v); return Number.isFinite(n)?Math.trunc(n):(d||0); }
function dateOnly(v){
  const s=text(v);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}
function sourceType(items){
  if(!Array.isArray(items) || !items.length) return 'CAFE24';
  const external=items.some((it)=>{
    const mall=text(it.mall_code).toUpperCase();
    const src=text(it.source_mall).toUpperCase();
    return !!src || (mall && !['CAFE24','INTERNAL','GM_INTERNAL'].includes(mall));
  });
  return external ? 'EXTERNAL' : 'CAFE24';
}
function displayStatus(o){
  const customer=text(o.customer_status).toUpperCase();
  if(customer === 'PURCHASE_CONFIRMED') return '구매확정';
  const cs=text(o.cs_status || o.cancel_status).toUpperCase();
  const csMap={
    CANCEL_REQUESTED:'취소신청',CANCEL_PROCESSING:'취소처리중',CANCEL_COMPLETED:'취소완료',CANCEL_REJECTED:'취소거절',CANCEL_WITHDRAWN:'취소철회',
    EXCHANGE_REQUESTED:'교환신청',EXCHANGE_PROCESSING:'교환처리중',EXCHANGE_COMPLETED:'교환완료',EXCHANGE_REJECTED:'교환거절',EXCHANGE_WITHDRAWN:'교환철회',
    RETURN_REQUESTED:'반품신청',RETURN_PROCESSING:'반품처리중',RETURN_COMPLETED:'반품완료',RETURN_REJECTED:'반품거절',RETURN_WITHDRAWN:'반품철회'
  };
  if(csMap[cs]) return csMap[cs];
  const seller=text(o.seller_status || o.shipping_status || o.order_status).toUpperCase();
  const map={
    READY_TO_ORDER:'주문대기',ORDERED:'주문완료',PREPARING:'상품준비중',SHIPPING:'배송중',DELIVERED:'배송완료',CANCELLED:'취소완료',
    PENDING:'처리대기',PAID:'결제완료',PAYMENT_COMPLETE:'결제완료',COMPLETE:'완료',COMPLETED:'완료',CANCEL:'취소완료',CANCELED:'취소완료'
  };
  return map[seller] || text(o.shipping_status || o.order_status) || '주문완료';
}
function groupKey(o){
  if(text(o.order_group_key)) return text(o.order_group_key);
  const tracking=(o.items||[]).map(x=>text(x.tracking_number)).find(Boolean);
  if(/^\d{8}_/.test(tracking)) return tracking.split('_').slice(0,2).join('_');
  const no=text(o.cafe24_order_no || o.order_no);
  const m=no.match(/(\d{8})/);
  return m ? m[1] : no;
}

async function columnSet(pool, table){
  const r=await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=$1`,[table]);
  return new Set(r.rows.map(x=>x.column_name));
}
function selectOptional(cols,name,fallback){
  return cols.has(name) ? `o.${name}` : `${fallback} AS ${name}`;
}

async function listOrders(pool, input){
  const memberId=text(input.member_id);
  if(!memberId) throw Object.assign(new Error('member_id required'),{statusCode:400});
  const page=Math.max(1,int(input.page,1));
  const pageSize=Math.min(50,Math.max(5,int(input.page_size,20)));
  const start=dateOnly(input.start_date);
  const end=dateOnly(input.end_date);
  const csOnly=text(input.cs_only)==='1';
  const orderCols=await columnSet(pool,'gm_order');

  const where=['o.member_id=$1'];
  const params=[memberId];
  if(start){ params.push(start); where.push(`o.ordered_at >= $${params.length}::date`); }
  if(end){ params.push(end); where.push(`o.ordered_at < ($${params.length}::date + INTERVAL '1 day')`); }
  if(csOnly){
    const clauses=[];
    if(orderCols.has('cs_status')) clauses.push(`COALESCE(o.cs_status,'')<>''`);
    if(orderCols.has('cancel_status')) clauses.push(`COALESCE(o.cancel_status,'')<>''`);
    if(orderCols.has('seller_status')) clauses.push(`o.seller_status='CANCELLED'`);
    where.push(clauses.length ? `(${clauses.join(' OR ')})` : 'FALSE');
  }

  const count=await pool.query(`SELECT COUNT(*)::int AS total FROM gm_order o WHERE ${where.join(' AND ')}`,params);
  const total=int(count.rows[0]&&count.rows[0].total,0);
  params.push(pageSize,(page-1)*pageSize);
  const limitPos=params.length-1, offsetPos=params.length;

  const sql=`
    SELECT
      o.order_no,o.cafe24_order_no,o.member_id,o.ordered_at,o.total_product_price,o.total_delivery_fee,o.total_payment_price,
      o.order_status,o.payment_status,o.shipping_status,o.cs_status,o.cancel_status,o.purchase_confirmed_yn,
      ${selectOptional(orderCols,'seller_status','NULL::text')},
      ${selectOptional(orderCols,'customer_status','NULL::text')},
      ${selectOptional(orderCols,'order_group_key','NULL::text')},
      COALESCE(json_agg(json_build_object(
        'pi_ii_vi',i.pi_ii_vi,'product_name',i.product_name,'option_name',i.option_name,'option_value',i.option_value,
        'quantity',i.quantity,'customer_order_price',i.customer_order_price,'product_amount',i.product_amount,
        'mall_code',i.mall_code,'source_mall',i.source_mall,'product_url',i.product_url,'thumb_file_name',i.thumb_file_name,
        'carrier_name',i.carrier_name,'tracking_number',i.tracking_number,'item_order_status',i.item_order_status,'item_shipping_status',i.item_shipping_status
      ) ORDER BY i.created_at ASC,i.pi_ii_vi ASC) FILTER (WHERE i.order_no IS NOT NULL),'[]'::json) AS items
    FROM gm_order o
    LEFT JOIN gm_order_item i ON i.order_no=o.order_no
    WHERE ${where.join(' AND ')}
    GROUP BY o.order_no
    ORDER BY o.ordered_at DESC,o.order_no DESC
    LIMIT $${limitPos} OFFSET $${offsetPos}`;
  const r=await pool.query(sql,params);
  const orders=r.rows.map(o=>{
    o.items=Array.isArray(o.items)?o.items:[];
    o.source_type=sourceType(o.items);
    o.display_status=displayStatus(o);
    o.order_group_key=groupKey(o);
    o.can_cafe24_action=o.source_type==='CAFE24' && !!text(o.cafe24_order_no);
    return o;
  });
  return {orders,total,page,page_size:pageSize,total_pages:Math.max(1,Math.ceil(total/pageSize))};
}

module.exports={listOrders};
