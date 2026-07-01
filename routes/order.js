const express = require('express');
const router = express.Router();
function db(req){ return req.app.locals.db || req.app.locals.pool; }
function s(v,d=null){ return v===undefined||v===null||v==='' ? d : String(v).trim(); }
function n(v,d=0){ if(v===undefined||v===null||v==='') return d; const x=Number(String(v).replace(/[^0-9.-]/g,'')); return Number.isFinite(x)?x:d; }
function ord(){ const d=new Date(); const p=x=>String(x).padStart(2,'0'); return `GM${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`; }
function cafe24No(o){ return s(o.cafe24_order_no || o.cafe24OrderNo || o.cafe24_order_id || o.cafe24OrderId || o.internal_order_no || o.internalOrderNo, ''); }
function sourceMall(it){
  const direct = s(it.source_mall || it.sourceMall || it.source_code || it.sourceCode, '').toUpperCase();
  if(direct) return direct;
  const uid = s(it.source_uid || it.sourceUid, '').toUpperCase();
  if(uid.indexOf('_') > 0) return uid.split('_')[0];
  const url = String(it.product_url || it.source_url || it.url || '').toLowerCase();
  if(url.includes('coupang.com') || url.includes('link.coupang.com')) return 'CPKR';
  if(url.includes('aliexpress.com')) return 'ALKR';
  if(url.includes('temu.com')) return 'TEMU';
  if(url.includes('shopping.naver.com') || url.includes('smartstore.naver.com')) return 'NPKR';
  const mall = s(it.mall_code || it.mallCode, '').toUpperCase();
  return (mall === 'CAFE24' || mall === 'INTERNAL') ? '' : mall;
}
function sourceUid(it, sm){
  const direct = s(it.source_uid || it.sourceUid, '');
  if(direct) return direct;
  const key = s(it.source_key || it.sourceKey || it.source_id || it.sourceId, '');
  return key && sm && key.indexOf(sm + '_') !== 0 ? sm + '_' + key : key;
}
router.post(['/api/order/create','/api/gm/order/create'], async (req,res)=>{
  const pool=db(req), b=req.body||{}, items=Array.isArray(b.items)?b.items:[];
  if(!pool) return res.status(500).json({ok:false,error:'DB pool is not attached'});
  const client=await pool.connect().catch(()=>null); if(!client) return res.status(500).json({ok:false,error:'DB client connect failed'});
  const order_no=s(b.gm_order_no || b.order_no, ord());
  const cafe24_order_no = cafe24No(b);
  try{
    await client.query('BEGIN');
    const osql=`INSERT INTO gm_order (
      order_no,cafe24_order_no,member_id,guest_key,orderer_name,orderer_phone,orderer_mobile,orderer_email,
      receiver_name,receiver_phone,receiver_mobile,receiver_safe_phone,receiver_zipcode,receiver_address1,receiver_address2,delivery_memo,
      customs_required_yn,customs_clearance_code,customs_name,customs_mobile,payment_method,payment_method_display,payment_bank_name,payment_account_number,
      depositor_name,depositor_phone,expected_payment_amount,actual_payment_amount,payment_difference_amount,total_product_price,total_delivery_fee,
      extra_area_delivery_fee,estimated_customs_fee,estimated_import_vat,total_payment_price,order_status,payment_status,shipping_status,cs_status,
      ordered_at,payment_requested_at,payment_completed_at,payment_confirmed_at,created_at,updated_at,cancel_status,cancel_requested_at,cancel_completed_at,
      purchase_confirmed_yn,purchase_confirmed_at,delivered_at
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
      $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,
      COALESCE($40,NOW()),$41,$42,$43,NOW(),NOW(),$44,$45,$46,$47,$48,$49
    ) RETURNING *`;
    const op=[order_no,cafe24_order_no || null,s(b.member_id),s(b.guest_key),s(b.orderer_name,''),s(b.orderer_phone),s(b.orderer_mobile,''),s(b.orderer_email),
      s(b.receiver_name,''),s(b.receiver_phone),s(b.receiver_mobile,''),s(b.receiver_safe_phone),s(b.receiver_zipcode,''),s(b.receiver_address1,''),s(b.receiver_address2),s(b.delivery_memo),
      s(b.customs_required_yn,'N'),s(b.customs_clearance_code),s(b.customs_name),s(b.customs_mobile),s(b.payment_method,'bank_transfer'),s(b.payment_method_display,'무통장입금'),s(b.payment_bank_name),s(b.payment_account_number),
      s(b.depositor_name),s(b.depositor_phone),n(b.expected_payment_amount),n(b.actual_payment_amount,null),n(b.payment_difference_amount),n(b.total_product_price),n(b.total_delivery_fee),
      n(b.extra_area_delivery_fee),n(b.estimated_customs_fee),n(b.estimated_import_vat),n(b.total_payment_price),s(b.order_status,'ordered'),s(b.payment_status,'pending'),s(b.shipping_status,'pending'),s(b.cs_status,'none'),
      b.ordered_at||null,b.payment_requested_at||null,b.payment_completed_at||null,b.payment_confirmed_at||null,s(b.cancel_status,'none'),b.cancel_requested_at||null,b.cancel_completed_at||null,
      s(b.purchase_confirmed_yn,'N'),b.purchase_confirmed_at||null,b.delivered_at||null];
    const or=await client.query(osql,op);
    await client.query(`UPDATE gm_order
      SET receiver_address_old=$2,
          receiver_address_full=$3,
          receiver_sido=$4,
          receiver_sigungu=$5,
          receiver_eup_myeon_dong=$6,
          updated_at=NOW()
      WHERE order_no=$1`, [
        order_no,
        s(b.receiver_address_old || b.address_old || b.jibun_address),
        s(b.receiver_address_full || b.address_full),
        s(b.receiver_sido || b.sido),
        s(b.receiver_sigungu || b.sigungu),
        s(b.receiver_eup_myeon_dong || b.eup_myeon_dong || b.dong)
      ]).catch(()=>{});
    const saved=[];
    for(const it of items){
      const sm = sourceMall(it);
      const su = sourceUid(it, sm);
      const r=await client.query(`INSERT INTO gm_order_item (
          order_no,cafe24_order_no,pi_ii_vi,product_name,option_name,option_value,quantity,
          mall_sale_price,customer_order_price,final_supply_price,product_amount,delivery_type,delivery_fee,extra_area_delivery_fee,
          mall_code,source_mall,source_uid,supplier_id,supplier_name,product_url,thumb_file_name,hs_code,origin_country,carrier_name,tracking_number,
          item_order_status,item_shipping_status,created_at,updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,NOW(),NOW()) RETURNING *`,
        [order_no,s(it.cafe24_order_no || it.cafe24OrderNo || cafe24_order_no,null),s(it.pi_ii_vi,''),s(it.product_name,''),s(it.option_name),s(it.option_value),n(it.quantity,1),
         n(it.mall_sale_price),n(it.customer_order_price),n(it.final_supply_price,null),n(it.product_amount),s(it.delivery_type),n(it.delivery_fee),n(it.extra_area_delivery_fee),
         s(it.mall_code || it.mallCode),sm,su,s(it.supplier_id),s(it.supplier_name),s(it.product_url || it.source_url || it.url,''),s(it.thumb_file_name),s(it.hs_code),s(it.origin_country),s(it.carrier_name),s(it.tracking_number),
         s(it.item_order_status || it.item_status,'ordered'),s(it.item_shipping_status,'pending')]);
      saved.push(r.rows[0]);
      const mallCode=s(it.mall_code || it.mallCode);
      const pi=s(it.pi_ii_vi,'');
      const qty=n(it.quantity,1);
      if(mallCode && pi){
        await client.query(`
          UPDATE gm_product
          SET order_count=COALESCE(order_count,0)+1,
              order_qty_total=COALESCE(order_qty_total,0)+$3,
              last_order_at=NOW(),
              expire_at=GREATEST(COALESCE(expire_at, NOW()), NOW() + INTERVAL '730 days'),
              updated_at=NOW()
          WHERE mall_code=$1 AND pi_ii_vi=$2
        `,[mallCode,pi,qty]).catch(()=>{});
      }
    }
    await client.query('COMMIT'); res.json({ok:true,order:or.rows[0],items:saved,order_no,cafe24_order_no});
  }catch(e){ await client.query('ROLLBACK').catch(()=>{}); res.status(500).json({ok:false,error:e.message}); }
  finally{ client.release(); }
});
router.get('/api/order/:order_no', async (req,res)=>{
  const pool=db(req); if(!pool) return res.status(500).json({ok:false,error:'DB pool is not attached'});
  try{ const o=await pool.query('SELECT * FROM gm_order WHERE order_no=$1',[req.params.order_no]); const i=await pool.query('SELECT * FROM gm_order_item WHERE order_no=$1',[req.params.order_no]); res.json({ok:true,order:o.rows[0]||null,items:i.rows}); }
  catch(e){ res.status(500).json({ok:false,error:e.message}); }
});
module.exports=router;
