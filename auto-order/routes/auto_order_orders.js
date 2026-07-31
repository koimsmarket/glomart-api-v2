'use strict';

const express = require('express');
const router = express.Router();

const VERSION = 'GM_AUTO_ORDER_LIST_API_V001';

function poolFrom(req){
  return req && req.app && req.app.locals ? req.app.locals.pool : null;
}
function clean(v){ return String(v == null ? '' : v).trim(); }
function paid(v){
  return ['paid','overpaid','refunded'].includes(clean(v).toLowerCase());
}
function mall(row){
  row = row || {};
  const direct = clean(row.source_mall || row.mall_code).toUpperCase();
  if(direct === 'CPKR' || direct === 'ALKR') return direct;

  const uid = clean(row.source_uid || row.pi_ii_vi).toUpperCase();
  if(uid.startsWith('CPKR_')) return 'CPKR';
  if(uid.startsWith('ALKR_')) return 'ALKR';

  const url = clean(row.product_url).toLowerCase();
  if(url.includes('coupang.com') || url.includes('link.coupang.com')) return 'CPKR';
  if(url.includes('aliexpress.com')) return 'ALKR';
  return '';
}
function amount(v){
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

router.post('/api/auto-order/orders/sync', async (req,res)=>{
  const pool = poolFrom(req);
  if(!pool) return res.status(503).json({ok:false,version:VERSION,error:'database pool not ready'});

  const db = await pool.connect();
  let createdOrders=0, createdItems=0, createdWorks=0;

  try{
    const or = await db.query(`
      SELECT o.*
      FROM gm_order o
      WHERE EXISTS (
        SELECT 1
        FROM gm_order_item i
        WHERE i.order_no=o.order_no
          AND (
            upper(COALESCE(i.source_mall,'')) IN ('CPKR','ALKR')
            OR upper(COALESCE(i.mall_code,'')) IN ('CPKR','ALKR')
            OR upper(COALESCE(i.source_uid,'')) LIKE 'CPKR_%'
            OR upper(COALESCE(i.source_uid,'')) LIKE 'ALKR_%'
            OR lower(COALESCE(i.product_url,'')) LIKE '%coupang.com%'
            OR lower(COALESCE(i.product_url,'')) LIKE '%aliexpress.com%'
          )
      )
      ORDER BY o.ordered_at ASC NULLS LAST, o.created_at ASC NULLS LAST
      LIMIT 500
    `);

    for(const o of or.rows){
      const ir = await db.query(
        `SELECT * FROM gm_order_item WHERE order_no=$1 ORDER BY created_at ASC NULLS LAST`,
        [o.order_no]
      );

      const groups = {};
      for(const item of ir.rows){
        const m = mall(item);
        if(!m) continue;
        (groups[m] ||= []).push(item);
      }

      for(const [mallCode,items] of Object.entries(groups)){
        const autoOrderNo = `${o.order_no}-${mallCode}`;
        const isPaid = paid(o.payment_status);
        const workStatus = isPaid ? 'PENDING' : 'WAIT_PAYMENT';
        const productTotal = items.reduce((s,x)=>s+amount(x.product_amount),0);
        const deliveryTotal = items.reduce((s,x)=>s+amount(x.delivery_fee),0);
        const areaDeliveryTotal = items.reduce((s,x)=>s+amount(x.extra_area_delivery_fee),0);

        await db.query('BEGIN');
        try{
          const hr = await db.query(`
            INSERT INTO gm_auto_order (
              auto_order_no,order_no,ordered_at,member_id,mall_code,mode,
              received_item_count,ordered_item_count,
              order_status,cancel_status,exchange_status,return_status,process_status,
              total_product_price,discount_amount,total_delivery_fee,extra_area_delivery_fee,
              actual_payment_amount,
              created_at,updated_at
            ) VALUES (
              $1,$2,COALESCE($3::date,(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul')::date),
              COALESCE($4,''),$5,'SEMI_AUTO',
              $6,0,
              'NOT_ORDERED','NONE','NONE','NONE',$7,
              $8,0,$9,$10,0,
              now(),now()
            )
            ON CONFLICT (auto_order_no) DO UPDATE SET
              member_id=EXCLUDED.member_id,
              received_item_count=EXCLUDED.received_item_count,
              total_product_price=EXCLUDED.total_product_price,
              total_delivery_fee=EXCLUDED.total_delivery_fee,
              extra_area_delivery_fee=EXCLUDED.extra_area_delivery_fee,
              process_status=CASE
                WHEN gm_auto_order.order_status='ORDERED' THEN gm_auto_order.process_status
                ELSE EXCLUDED.process_status
              END,
              updated_at=now()
            RETURNING (xmax=0) AS inserted
          `,[
            autoOrderNo,o.order_no,o.ordered_at||o.created_at,o.member_id,mallCode,
            items.length,workStatus,productTotal,deliveryTotal,areaDeliveryTotal
          ]);
          if(hr.rows[0] && hr.rows[0].inserted) createdOrders++;

          for(const item of items){
            const exists = await db.query(`
              SELECT 1
              FROM gm_auto_order_item
              WHERE auto_order_no=$1
                AND COALESCE(pi_ii_vi,'')=COALESCE($2,'')
                AND COALESCE(source_uid,'')=COALESCE($3,'')
                AND COALESCE(option_name,'')=COALESCE($4,'')
                AND COALESCE(option_value,'')=COALESCE($5,'')
              LIMIT 1
            `,[autoOrderNo,item.pi_ii_vi,item.source_uid,item.option_name,item.option_value]);

            if(!exists.rows.length){
              await db.query(`
                INSERT INTO gm_auto_order_item (
                  auto_order_no,order_no,pi_ii_vi,mall_code,source_uid,
                  product_name,option_name,option_value,quantity,ordered_quantity,
                  mall_sale_price,product_amount,item_order_status,process_status,
                  created_at,updated_at
                ) VALUES (
                  $1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9,1),0,
                  COALESCE($10,0),COALESCE($11,0),'NOT_ORDERED',$12,
                  now(),now()
                )
              `,[
                autoOrderNo,o.order_no,item.pi_ii_vi,mallCode,item.source_uid,
                item.product_name,item.option_name,item.option_value,item.quantity,
                item.mall_sale_price,item.product_amount,workStatus
              ]);
              createdItems++;
            }
          }

          const wr = await db.query(`
            INSERT INTO gm_auto_order_work (
              auto_order_no,work_type,work_status,priority,requested_at,created_at,updated_at
            )
            SELECT $1,'ORDER',$2,100,now(),now(),now()
            WHERE NOT EXISTS (
              SELECT 1 FROM gm_auto_order_work
              WHERE auto_order_no=$1 AND work_type='ORDER'
            )
            RETURNING work_id
          `,[autoOrderNo,workStatus]);
          if(wr.rows.length) createdWorks++;

          if(isPaid){
            await db.query(`
              UPDATE gm_auto_order_work
              SET work_status='PENDING',updated_at=now()
              WHERE auto_order_no=$1
                AND work_type='ORDER'
                AND work_status='WAIT_PAYMENT'
            `,[autoOrderNo]);
          }

          await db.query('COMMIT');
        }catch(e){
          await db.query('ROLLBACK');
          throw e;
        }
      }
    }

    return res.json({
      ok:true,version:VERSION,
      scanned_orders:or.rows.length,
      created_orders:createdOrders,
      created_items:createdItems,
      created_works:createdWorks
    });
  }catch(e){
    console.error('[GM_AUTO_ORDER_SYNC_V001]',String(e && e.stack || e));
    return res.status(500).json({ok:false,version:VERSION,error:'auto-order sync failed',detail:String(e && e.message || e)});
  }finally{
    db.release();
  }
});

router.get('/api/auto-order/orders', async (req,res)=>{
  const pool = poolFrom(req);
  if(!pool) return res.status(503).json({ok:false,version:VERSION,error:'database pool not ready'});

  try{
    const r = await pool.query(`
      SELECT
        a.auto_order_no,a.order_no,a.ordered_at,a.member_id,a.mall_code,
        a.received_item_count,a.ordered_item_count,
        a.total_product_price,a.total_delivery_fee,a.extra_area_delivery_fee,
        a.actual_payment_amount,a.order_status,a.process_status,
        a.admin_id,a.mall_account_id,a.mall_order_no,
        o.orderer_name,o.receiver_name,o.payment_status,
        w.work_id,w.work_status,w.priority,w.requested_at,w.started_at,w.completed_at,
        w.error_code,w.error_message
      FROM gm_auto_order a
      LEFT JOIN gm_order o ON o.order_no=a.order_no
      LEFT JOIN LATERAL (
        SELECT x.*
        FROM gm_auto_order_work x
        WHERE x.auto_order_no=a.auto_order_no AND x.work_type='ORDER'
        ORDER BY x.work_id DESC
        LIMIT 1
      ) w ON TRUE
      ORDER BY
        CASE w.work_status
          WHEN 'PENDING' THEN 0
          WHEN 'ASSIGNED' THEN 1
          WHEN 'RUNNING' THEN 2
          WHEN 'WAIT_PAYMENT' THEN 3
          WHEN 'WAITING_ADMIN' THEN 4
          WHEN 'FAILED' THEN 5
          WHEN 'COMPLETED' THEN 9
          ELSE 8
        END,
        w.priority DESC NULLS LAST,
        w.requested_at ASC NULLS LAST,
        a.created_at ASC
      LIMIT 300
    `);

    return res.json({ok:true,version:VERSION,data:r.rows});
  }catch(e){
    console.error('[GM_AUTO_ORDER_LIST_V001]',String(e && e.stack || e));
    return res.status(500).json({ok:false,version:VERSION,error:'auto-order list failed',detail:String(e && e.message || e)});
  }
});

module.exports = router;
