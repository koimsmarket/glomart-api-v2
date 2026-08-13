/* GM_ORDER_MAP_ADDRESS_ROUTE_V002
 * Google Maps is used only to let the user find/select a coordinate.
 * This server route converts that WGS84 coordinate with Kakao Local API
 * and returns the Korean road/lot address used by the order form.
 * Secrets: KAKAO_REST_API_KEY stays server-side.
 * Public browser key: GOOGLE_MAPS_BROWSER_KEY is returned to the Cafe24 page;
 * restrict it in Google Cloud Console to the Glomart Cafe24 origins.
 */
const express = require('express');
const router = express.Router();

function C(v){ return String(v == null ? '' : v).trim(); }
function coord(v){ const n=Number(v); return Number.isFinite(n) ? n : null; }
function inKorea(lat,lng){ return lat>=32.5 && lat<=39.8 && lng>=123.5 && lng<=132.5; }

router.get('/api/gm/address-map/config',(req,res)=>{
  const googleKey=C(process.env.GOOGLE_MAPS_BROWSER_KEY || process.env.GOOGLE_MAPS_API_KEY || '');
  const kakaoJsKey=C(process.env.KAKAO_MAP_JAVASCRIPT_KEY || process.env.KAKAO_JAVASCRIPT_KEY || '');
  return res.json({
    ok:true,
    google_maps_browser_key:googleKey,
    google_enabled:!!googleKey,
    kakao_maps_javascript_key:kakaoJsKey,
    kakao_enabled:!!kakaoJsKey,
    enabled:!!(googleKey||kakaoJsKey),
    region:'KR'
  });
});

router.get('/api/gm/address-map/kakao',async(req,res)=>{
  const lat=coord(req.query.lat), lng=coord(req.query.lng);
  const kakaoKey=C(process.env.KAKAO_REST_API_KEY || process.env.KAKAO_LOCAL_REST_API_KEY || '');
  if(lat===null||lng===null) return res.status(400).json({ok:false,error:'lat/lng required'});
  if(!inKorea(lat,lng)) return res.status(400).json({ok:false,error:'coordinate outside Korea'});
  if(!kakaoKey) return res.status(503).json({ok:false,error:'KAKAO_REST_API_KEY not configured'});
  try{
    const url='https://dapi.kakao.com/v2/local/geo/coord2address.json?x='+encodeURIComponent(lng)+'&y='+encodeURIComponent(lat)+'&input_coord=WGS84';
    const r=await fetch(url,{headers:{Authorization:'KakaoAK '+kakaoKey,Accept:'application/json'}});
    const j=await r.json().catch(()=>({}));
    if(!r.ok) return res.status(502).json({ok:false,error:'kakao coord2address failed',status:r.status,detail:C(j&&j.message)});
    const doc=Array.isArray(j&&j.documents)&&j.documents.length?j.documents[0]:null;
    if(!doc) return res.status(404).json({ok:false,error:'kakao address not found',lat,lng});
    const road=doc.road_address||null, lot=doc.address||null;
    const address1=C((road&&road.address_name)||(lot&&lot.address_name));
    const zipcode=C(road&&road.zone_no);
    return res.json({
      ok:true,lat,lng,
      zipcode,
      address1,
      road_address:road?{
        address_name:C(road.address_name),region_1depth_name:C(road.region_1depth_name),region_2depth_name:C(road.region_2depth_name),region_3depth_name:C(road.region_3depth_name),road_name:C(road.road_name),underground_yn:C(road.underground_yn),main_building_no:C(road.main_building_no),sub_building_no:C(road.sub_building_no),building_name:C(road.building_name),zone_no:C(road.zone_no)
      }:null,
      lot_address:lot?{
        address_name:C(lot.address_name),region_1depth_name:C(lot.region_1depth_name),region_2depth_name:C(lot.region_2depth_name),region_3depth_name:C(lot.region_3depth_name),mountain_yn:C(lot.mountain_yn),main_address_no:C(lot.main_address_no),sub_address_no:C(lot.sub_address_no)
      }:null
    });
  }catch(e){
    console.error('[GM_ORDER_MAP_ADDRESS_KAKAO_ERROR]',C(e&&e.message||e));
    return res.status(500).json({ok:false,error:C(e&&e.message||e)});
  }
});

module.exports=router;
