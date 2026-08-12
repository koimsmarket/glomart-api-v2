/* GM_BARCODE_ROUTE_V001
 * UPC/EAN/GTIN lookup cache + UPCitemdb trial provider.
 * API key is intentionally not exposed to the mobile page.
 */
const express = require('express');
const router = express.Router();

const PROVIDER = 'UPCITEMDB';
const UPC_TRIAL_URL = 'https://api.upcitemdb.com/prod/trial/lookup';

function C(v){ return String(v == null ? '' : v).trim(); }
function barcode(v){ return C(v).replace(/\D/g,'').slice(0,32); }
function n(v){ const x=Number(v); return Number.isFinite(x)?x:null; }
function first(v){ return Array.isArray(v)&&v.length?v[0]:null; }
function productPayload(row, cache){
  if(!row) return null;
  return {
    barcode:C(row.barcode), product_original:C(row.product_original), product_ko:C(row.product_ko),
    brand:C(row.brand), category:C(row.category), keyword:C(row.keyword), image_url:C(row.image_url),
    price_low:row.price_low==null?null:Number(row.price_low), price_high:row.price_high==null?null:Number(row.price_high),
    source:C(row.source||PROVIDER), country:C(row.country), source_url:C(row.source_url), product_url:C(row.product_url),
    search_count:Number(row.search_count||0), cache:!!cache
  };
}

router.get('/api/gm/barcode/lookup', async (req,res)=>{
  const pool=req.app.locals.pool;
  const code=barcode(req.query.barcode||req.query.gtin||req.query.ean||req.query.upc);
  if(!pool) return res.status(503).json({ok:false,error:'db unavailable'});
  if(code.length<8) return res.status(400).json({ok:false,error:'invalid barcode'});
  try{
    const hit=await pool.query(`UPDATE gm_barcode_product SET search_count=search_count+1,updated_at=now() WHERE barcode=$1 RETURNING *`,[code]);
    if(hit.rows[0]) return res.json({ok:true,found:true,provider:PROVIDER,product:productPayload(hit.rows[0],true)});

    const url=UPC_TRIAL_URL+'?upc='+encodeURIComponent(code);
    const started=Date.now();
    const r=await fetch(url,{headers:{'Accept':'application/json','User-Agent':'Glomart-Barcode/1.0'}});
    let j={}; try{j=await r.json();}catch(_e){}
    const rate={limit:r.headers.get('x-ratelimit-limit')||'',remaining:r.headers.get('x-ratelimit-remaining')||'',reset:r.headers.get('x-ratelimit-reset')||''};
    if(!r.ok){
      return res.status(r.status===404?404:502).json({ok:false,found:false,provider:PROVIDER,status:r.status,error:C(j&&j.message||j&&j.code||'provider lookup failed'),response_ms:Date.now()-started,rate});
    }
    const item=first(j&&j.items);
    if(!item) return res.status(404).json({ok:false,found:false,provider:PROVIDER,response_ms:Date.now()-started,rate});
    const offers=Array.isArray(item.offers)?item.offers:[];
    const offer=offers.find(x=>C(x&&x.link))||offers[0]||{};
    const original=C(item.title||item.name||'');
    const row={
      barcode:code, product_original:original, product_ko:'', brand:C(item.brand), category:C(item.category),
      keyword:original, image_url:C(first(item.images)||''), price_low:n(item.lowest_recorded_price), price_high:n(item.highest_recorded_price),
      source:PROVIDER, country:C(item.country||item.country_code||''),
      source_url:'https://www.upcitemdb.com/upc/'+encodeURIComponent(C(item.ean||item.upc||code)), product_url:C(offer.link||'')
    };
    const ins=await pool.query(`
      INSERT INTO gm_barcode_product
      (barcode,product_original,product_ko,brand,category,keyword,image_url,price_low,price_high,source,country,source_url,product_url,search_count,created_at,updated_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,1,now(),now())
      ON CONFLICT (barcode) DO UPDATE SET
        product_original=EXCLUDED.product_original, brand=EXCLUDED.brand, category=EXCLUDED.category,
        keyword=CASE WHEN COALESCE(gm_barcode_product.keyword,'')='' THEN EXCLUDED.keyword ELSE gm_barcode_product.keyword END,
        image_url=EXCLUDED.image_url, price_low=EXCLUDED.price_low, price_high=EXCLUDED.price_high,
        source=EXCLUDED.source, country=EXCLUDED.country, source_url=EXCLUDED.source_url, product_url=EXCLUDED.product_url,
        search_count=gm_barcode_product.search_count+1, updated_at=now()
      RETURNING *`,[
      row.barcode,row.product_original,row.product_ko,row.brand,row.category,row.keyword,row.image_url,row.price_low,row.price_high,row.source,row.country,row.source_url,row.product_url
    ]);
    return res.json({ok:true,found:true,provider:PROVIDER,product:productPayload(ins.rows[0],false),response_ms:Date.now()-started,offer_count:offers.length,rate});
  }catch(e){
    console.error('[GM_BARCODE_LOOKUP_ERROR]',C(e&&e.message||e));
    return res.status(500).json({ok:false,error:C(e&&e.message||e)});
  }
});

router.post('/api/gm/barcode/enrich', async (req,res)=>{
  const pool=req.app.locals.pool; const code=barcode(req.body&&req.body.barcode);
  if(!pool) return res.status(503).json({ok:false,error:'db unavailable'});
  if(code.length<8) return res.status(400).json({ok:false,error:'invalid barcode'});
  const productKo=C(req.body&&req.body.product_ko); const keyword=C(req.body&&req.body.keyword||productKo);
  try{
    const q=await pool.query(`UPDATE gm_barcode_product SET product_ko=CASE WHEN $2='' THEN product_ko ELSE $2 END, keyword=CASE WHEN $3='' THEN keyword ELSE $3 END, updated_at=now() WHERE barcode=$1 RETURNING *`,[code,productKo,keyword]);
    return res.json({ok:true,product:productPayload(q.rows[0],true)});
  }catch(e){ return res.status(500).json({ok:false,error:C(e&&e.message||e)}); }
});

module.exports=router;
