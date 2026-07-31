'use strict';

/*
 * GM_AUTO_ORDER_CONTROL_TOWER_SERVICE_V004
 *
 * Source of truth:
 *   gm_order + gm_order_item
 *
 * Control tower:
 *   gm_auto_order + gm_auto_order_item + gm_auto_order_work
 *
 * Rules:
 * - GMKR/internal items ALSO create auto-order work.
 *   Until suppliers are directly registered, GMKR is treated as an order destination
 *   and remains in the same control tower flow as CPKR/ALKR.
 * - One auto_order row per order_no + order destination (GMKR/CPKR/ALKR).
 * - New work starts WAIT_PAYMENT unless the order is already paid.
 * - A later sync promotes WAIT_PAYMENT -> READY after payment confirmation.
 * - Existing work that already started/finished is never reset by reconciliation.
 */

function clean(v){
  return String(v == null ? '' : v).trim();
}
function upper(v){ return clean(v).toUpperCase(); }
function num(v){
  const n = Number(String(v == null ? '' : v).replace(/,/g,''));
  return Number.isFinite(n) ? n : 0;
}
function int(v, def){
  const n = Number.parseInt(String(v == null ? '' : v),10);
  return Number.isFinite(n) ? n : (def == null ? 0 : def);
}
function sourceMall(row){
  const direct = upper(row && (row.source_mall || row.mall_code || row.source_code));
  if(['GMKR','CPKR','ALKR'].includes(direct)) return direct;

  const uid = upper(row && (row.source_uid || row.product_uid));
  if(uid.startsWith('GMKR_')) return 'GMKR';
  if(uid.startsWith('CPKR_')) return 'CPKR';
  if(uid.startsWith('ALKR_')) return 'ALKR';

  const url = clean(row && (row.product_url || row.source_url || row.url)).toLowerCase();
  if(url.includes('coupang.com') || url.includes('link.coupang.com')) return 'CPKR';
  if(url.includes('aliexpress.com')) return 'ALKR';
  return '';
}
function isPaid(status){
  const s = upper(status).replace(/[\s-]+/g,'_');
  return [
    'PAID','PAYMENT_COMPLETE','PAYMENT_COMPLETED','COMPLETED',
    'COMPLETE','DONE','SUCCESS','SETTLED'
  ].includes(s);
}
function autoOrderNo(orderNo, mall){
  return clean(orderNo) + ':' + upper(mall);
}
function itemPrice(row){
  const qty = Math.max(1,int(row.quantity,1));
  const explicit = num(row.product_amount || row.total_price || row.line_amount);
  if(explicit > 0) return explicit;
  const unit = num(
    row.final_supply_price ||
    row.mall_sale_price ||
    row.customer_order_price ||
    row.final_supply_price ||
    row.final_price
  );
  return unit * qty;
}

async function tableExists(pool, name){
  const r = await pool.query(`
    SELECT EXISTS(
      SELECT 1 FROM information_schema.tables
      WHERE table_schema='public' AND table_name=$1
    ) AS ok
  `,[name]);
  return !!(r.rows[0] && r.rows[0].ok);
}

async function ensureTables(pool){
  const names = ['gm_order','gm_order_item','gm_auto_order','gm_auto_order_item','gm_auto_order_work'];
  const out = {};
  for(const name of names) out[name] = await tableExists(pool,name);
  const missing = names.filter(n=>!out[n]);
  if(missing.length) throw new Error('missing control tower tables: ' + missing.join(','));
  return out;
}

async function loadOrder(pool, orderNo){
  const o = await pool.query(`SELECT * FROM gm_order WHERE order_no=$1 LIMIT 1`,[orderNo]);
  if(!o.rows.length) return null;

  const items = await pool.query(
    `SELECT * FROM gm_order_item WHERE order_no=$1 ORDER BY created_at ASC NULLS LAST, pi_ii_vi ASC NULLS LAST`,
    [orderNo]
  ).catch(()=>pool.query(`SELECT * FROM gm_order_item WHERE order_no=$1`,[orderNo]));

  return { order:o.rows[0], items:items.rows || [] };
}

function groupOrderTargets(items, order){
  const groups = new Map();
  for(const row of items || []){
    let mall = sourceMall(row);

    // Current gm_order schema may not contain order_mode.
    // If an item is not identifiable as Coupang/Ali from its mall/source/url,
    // keep it actionable as GMKR. At the present stage internal merchandise
    // also requires automatic follow-up ordering.
    if(!mall) mall = 'GMKR';

    if(!mall) continue;
    if(!groups.has(mall)) groups.set(mall,[]);
    groups.get(mall).push(row);
  }
  return groups;
}

async function existingWork(client, aoNo){
  const r = await client.query(`
    SELECT *
    FROM gm_auto_order_work
    WHERE auto_order_no=$1 AND work_type='ORDER'
    ORDER BY work_id DESC
    LIMIT 1
  `,[aoNo]);
  return r.rows[0] || null;
}

async function ingestOrder(pool, orderNo, meta){
  const loaded = await loadOrder(pool,orderNo);
  if(!loaded) return { order_no:orderNo, created:0, works:0, reason:'order_not_found' };

  const order = loaded.order;
  const groups = groupOrderTargets(loaded.items, order);
  if(!groups.size){
    return { order_no:orderNo, created:0, works:0, skipped_unroutable:true, reason:'no_order_target' };
  }

  const paid = isPaid(order.payment_status);
  const workTarget = paid ? 'READY' : 'WAIT_PAYMENT';
  const client = await pool.connect();

  let autoOrders = 0;
  let works = 0;
  let itemsWritten = 0;

  try{
    await client.query('BEGIN');

    for(const [mall, items] of groups.entries()){
      const aoNo = autoOrderNo(orderNo,mall);
      const previousWork = await existingWork(client,aoNo);
      const protectedWork = previousWork && !['WAIT_PAYMENT','READY','PENDING'].includes(upper(previousWork.work_status));

      const productTotal = items.reduce((sum,row)=>sum+itemPrice(row),0);
      const itemDelivery = items.reduce((sum,row)=>sum + num(row.delivery_fee || row.total_delivery_fee),0);
      const singleMall = groups.size === 1;
      const deliveryFee = itemDelivery > 0
        ? itemDelivery
        : (singleMall ? num(order.total_delivery_fee) : 0);
      const extraFee = singleMall ? num(order.extra_area_delivery_fee) : 0;
      const actualPayment = singleMall
        ? num(order.actual_payment_amount || order.total_payment_price)
        : productTotal + deliveryFee + extraFee;

      await client.query(`
        INSERT INTO gm_auto_order (
          auto_order_no,order_no,ordered_at,member_id,mall_code,mode,
          received_item_count,ordered_item_count,
          order_status,process_status,
          total_product_price,total_delivery_fee,extra_area_delivery_fee,
          actual_payment_amount,payment_method,payment_completed_at,
          created_at,updated_at
        ) VALUES (
          $1,$2,COALESCE($3::date,CURRENT_DATE),$4,$5,'SEMI_AUTO',
          $6,0,'NOT_ORDERED',$7,
          $8,$9,$10,$11,$12,
          CASE WHEN $13::boolean THEN COALESCE($14::timestamp,now()) ELSE NULL END,
          now(),now()
        )
        ON CONFLICT (auto_order_no) DO UPDATE SET
          member_id=EXCLUDED.member_id,
          received_item_count=EXCLUDED.received_item_count,
          total_product_price=EXCLUDED.total_product_price,
          total_delivery_fee=EXCLUDED.total_delivery_fee,
          extra_area_delivery_fee=EXCLUDED.extra_area_delivery_fee,
          actual_payment_amount=EXCLUDED.actual_payment_amount,
          payment_method=EXCLUDED.payment_method,
          payment_completed_at=CASE
            WHEN gm_auto_order.payment_completed_at IS NOT NULL THEN gm_auto_order.payment_completed_at
            ELSE EXCLUDED.payment_completed_at
          END,
          process_status=CASE
            WHEN gm_auto_order.process_status IN ('COMPLETED','RUNNING','ORDERED','FAILED')
              THEN gm_auto_order.process_status
            ELSE EXCLUDED.process_status
          END,
          updated_at=now()
      `,[
        aoNo,
        clean(orderNo),
        order.ordered_at || order.created_at || null,
        clean(order.member_id || order.guest_key || 'GUEST'),
        mall,
        items.length,
        workTarget,
        productTotal,
        deliveryFee,
        extraFee,
        actualPayment,
        clean(order.payment_method || order.payment_method_display),
        paid,
        order.payment_completed_at || order.updated_at || null
      ]);
      autoOrders += 1;

      if(!protectedWork){
        // Before execution starts, item snapshot may safely follow gm_order_item.
        await client.query(`DELETE FROM gm_auto_order_item WHERE auto_order_no=$1`,[aoNo]);
        for(const row of items){
          const qty = Math.max(1,int(row.quantity,1));
          await client.query(`
            INSERT INTO gm_auto_order_item (
              auto_order_no,order_no,pi_ii_vi,mall_code,source_uid,
              product_name,option_name,option_value,
              quantity,ordered_quantity,mall_sale_price,product_amount,
              item_order_status,process_status,created_at,updated_at
            ) VALUES (
              $1,$2,$3,$4,$5,$6,$7,$8,$9,0,$10,$11,
              'NOT_ORDERED',$12,now(),now()
            )
          `,[
            aoNo,
            clean(orderNo),
            clean(row.pi_ii_vi),
            mall,
            clean(row.source_uid || row.product_uid),
            clean(row.product_name),
            clean(row.option_name),
            clean(row.option_value),
            qty,
            num(row.mall_sale_price || row.final_supply_price || row.customer_order_price),
            itemPrice(row),
            workTarget
          ]);
          itemsWritten += 1;
        }
      }

      if(!previousWork){
        await client.query(`
          INSERT INTO gm_auto_order_work (
            auto_order_no,work_type,work_status,priority,requested_at,created_at,updated_at
          ) VALUES ($1,'ORDER',$2,100,now(),now(),now())
        `,[aoNo,workTarget]);
        works += 1;
      }else if(['WAIT_PAYMENT','READY','PENDING'].includes(upper(previousWork.work_status))){
        await client.query(`
          UPDATE gm_auto_order_work
          SET work_status=$2,updated_at=now()
          WHERE work_id=$1
        `,[previousWork.work_id,workTarget]);
      }

      await client.query(`
        INSERT INTO gm_auto_order_log (
          auto_order_no,work_id,action_type,status_before,status_after,message,detail_json,created_at
        )
        SELECT
          $1,
          w.work_id,
          'CONTROL_TOWER_SYNC',
          NULL,
          w.work_status,
          $2,
          $3::jsonb,
          now()
        FROM gm_auto_order_work w
        WHERE w.auto_order_no=$1 AND w.work_type='ORDER'
        ORDER BY w.work_id DESC
        LIMIT 1
      `,[
        aoNo,
        'gm_order -> control tower sync',
        JSON.stringify({ source:meta && meta.source || 'reconcile', payment_status:order.payment_status || '', mall })
      ]).catch(()=>{});
    }

    await client.query('COMMIT');
    return {
      order_no:orderNo,
      order_targets:[...groups.keys()],
      external_malls:[...groups.keys()],
      auto_orders:autoOrders,
      works,
      items:itemsWritten,
      paid,
      target_status:workTarget
    };
  }catch(e){
    await client.query('ROLLBACK').catch(()=>{});
    throw e;
  }finally{
    client.release();
  }
}

async function syncRecentOrders(pool, opts){
  await ensureTables(pool);
  opts = opts || {};
  const limit = Math.max(1,Math.min(1000,int(opts.limit,200)));

  const r = await pool.query(`
    SELECT order_no,ordered_at,created_at
    FROM gm_order
    ORDER BY COALESCE(ordered_at,created_at) DESC NULLS LAST, order_no DESC
    LIMIT $1
  `,[limit]);

  const result = {
    scanned:r.rows.length,
    actionable_orders:0,
    external_orders:0,
    auto_orders:0,
    works:0,
    items:0,
    wait_payment:0,
    ready:0,
    skipped_internal:0,
    skipped_unroutable:0,
    errors:[]
  };

  for(const row of r.rows){
    try{
      const one = await ingestOrder(pool,row.order_no,{ source:'control-tower-reconcile' });
      if(one.skipped_unroutable){
        result.skipped_unroutable += 1;
        continue;
      }
      if(one.auto_orders){
        result.actionable_orders += 1;
        if((one.external_malls || []).some(m => m !== 'GMKR')) result.external_orders += 1;
        result.auto_orders += one.auto_orders || 0;
        result.works += one.works || 0;
        result.items += one.items || 0;
        if(one.target_status === 'READY') result.ready += one.auto_orders || 0;
        else result.wait_payment += one.auto_orders || 0;
      }
    }catch(e){
      result.errors.push({ order_no:row.order_no, error:String(e && e.message || e) });
    }
  }
  return result;
}

async function listControlTower(pool, opts){
  await ensureTables(pool);
  opts = opts || {};
  const q = clean(opts.q);
  const workStatus = upper(opts.work_status);
  const mallCode = upper(opts.mall_code);
  const limit = Math.max(1,Math.min(500,int(opts.limit,200)));
  const offset = Math.max(0,int(opts.offset,0));

  const where = [];
  const params = [];
  const add = v => { params.push(v); return '$'+params.length; };

  if(q){
    const p = add('%'+q+'%');
    where.push(`(
      a.order_no ILIKE ${p}
      OR a.auto_order_no ILIKE ${p}
      OR a.member_id ILIKE ${p}
    )`);
  }
  if(workStatus){
    const p = add(workStatus);
    where.push(`upper(COALESCE(w.work_status,''))=${p}`);
  }
  if(mallCode){
    const p = add(mallCode);
    where.push(`upper(COALESCE(a.mall_code,''))=${p}`);
  }
  const whereSql = where.length ? 'WHERE '+where.join(' AND ') : '';

  const count = await pool.query(`
    SELECT COUNT(*)::int AS total
    FROM gm_auto_order a
    LEFT JOIN LATERAL (
      SELECT *
      FROM gm_auto_order_work x
      WHERE x.auto_order_no=a.auto_order_no AND x.work_type='ORDER'
      ORDER BY x.work_id DESC
      LIMIT 1
    ) w ON TRUE
    ${whereSql}
  `,params);

  const lp = add(limit);
  const op = add(offset);

  const list = await pool.query(`
    SELECT
      a.auto_order_no,
      a.order_no,
      a.ordered_at,
      a.member_id,
      a.mall_code,
      a.mode,
      a.received_item_count,
      a.ordered_item_count,
      a.order_status,
      a.process_status,
      a.total_product_price,
      a.total_delivery_fee,
      a.extra_area_delivery_fee,
      a.actual_payment_amount,
      a.payment_method,
      a.payment_completed_at,
      a.mall_order_no,
      a.last_error_code,
      a.last_error_message,
      w.work_id,
      w.work_type,
      w.work_status,
      w.priority,
      w.admin_id,
      w.mall_account_id,
      w.lock_admin_id,
      w.lock_mall_account_id,
      w.lock_at,
      w.lock_expires_at,
      w.requested_at,
      w.started_at,
      w.completed_at,
      COALESCE(i.product_names,'') AS product_names
    FROM gm_auto_order a
    LEFT JOIN LATERAL (
      SELECT *
      FROM gm_auto_order_work x
      WHERE x.auto_order_no=a.auto_order_no AND x.work_type='ORDER'
      ORDER BY x.work_id DESC
      LIMIT 1
    ) w ON TRUE
    LEFT JOIN LATERAL (
      SELECT string_agg(NULLIF(product_name,''),' / ' ORDER BY auto_order_item_id) AS product_names
      FROM gm_auto_order_item ai
      WHERE ai.auto_order_no=a.auto_order_no
    ) i ON TRUE
    ${whereSql}
    ORDER BY
      CASE upper(COALESCE(w.work_status,''))
        WHEN 'READY' THEN 1
        WHEN 'WAIT_PAYMENT' THEN 2
        WHEN 'RUNNING' THEN 3
        WHEN 'FAILED' THEN 4
        ELSE 5
      END,
      w.priority DESC NULLS LAST,
      w.requested_at ASC NULLS LAST,
      a.ordered_at DESC,
      a.auto_order_no DESC
    LIMIT ${lp} OFFSET ${op}
  `,params);

  const counts = {};
  let assignedVisible = 0;
  let unassignedVisible = 0;
  for(const row of list.rows){
    const s = upper(row.work_status || 'NONE');
    counts[s] = (counts[s] || 0) + 1;
    if(s === 'READY'){
      if(clean(row.admin_id) || clean(row.mall_account_id)) assignedVisible += 1;
      else unassignedVisible += 1;
    }
  }

  return {
    rows:list.rows || [],
    total:Number(count.rows[0] && count.rows[0].total || 0),
    limit,
    offset,
    visible_status_counts:counts,
    assigned_visible:assignedVisible,
    unassigned_visible:unassignedVisible
  };
}

module.exports = {
  VERSION:'GM_AUTO_ORDER_CONTROL_TOWER_SERVICE_V004',
  ingestOrder,
  syncRecentOrders,
  listControlTower,
  isPaid
};
