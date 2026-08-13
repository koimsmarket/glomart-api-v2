/* GM_ORDER_MAP_ADDRESS_ROUTE_V003
 * Map search / Korean address bridge.
 * - Google/Kakao browser keys are exposed only through /config as required by each Web SDK.
 * - KAKAO_REST_API_KEY stays server-side.
 * - Kakao coord2address errors are returned as JSON with HTTP 200 so the Cafe24/WebView
 *   bridge can show the real Kakao error instead of collapsing it into "Failed to fetch".
 */
const express = require('express');
const router = express.Router();

function C(v){ return String(v == null ? '' : v).trim(); }
function coord(v){ const n=Number(v); return Number.isFinite(n) ? n : null; }
function inKorea(lat,lng){ return lat>=32.5 && lat<=39.8 && lng>=123.5 && lng<=132.5; }
function safeKakaoError(status, body){
  const msg=C(body && (body.message || body.msg || body.error_description || body.error));
  if(status===401) return 'Kakao REST API 키 인증에 실패했습니다.'+(msg?' '+msg:'');
  if(status===403) return 'Kakao Map API 사용 권한이 없습니다. Kakao Developers에서 [카카오맵 > 사용 설정]을 ON으로 확인해 주세요.'+(msg?' '+msg:'');
  if(status===429) return 'Kakao Map API 무료/사용 쿼터를 초과했습니다.'+(msg?' '+msg:'');
  return 'Kakao 좌표→주소 API 호출 실패 (HTTP '+status+')'+(msg?' '+msg:'');
}

router.get('/api/gm/address-map/config',(req,res)=>{
  const googleKey=C(process.env.GOOGLE_MAPS_BROWSER_KEY || process.env.GOOGLE_MAPS_API_KEY || '');
  const kakaoJsKey=C(process.env.KAKAO_MAP_JAVASCRIPT_KEY || process.env.KAKAO_JAVASCRIPT_KEY || '');
  const kakaoRestKey=C(process.env.KAKAO_REST_API_KEY || process.env.KAKAO_LOCAL_REST_API_KEY || '');
  return res.json({
    ok:true,
    google_maps_browser_key:googleKey,
    google_enabled:!!googleKey,
    kakao_maps_javascript_key:kakaoJsKey,
    kakao_enabled:!!kakaoJsKey,
    kakao_rest_configured:!!kakaoRestKey,
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

  const url='https://dapi.kakao.com/v2/local/geo/coord2address.json?x='+encodeURIComponent(lng)+'&y='+encodeURIComponent(lat)+'&input_coord=WGS84';
  try{
    const r=await fetch(url,{
      method:'GET',
      headers:{
        Authorization:'KakaoAK '+kakaoKey,
        Accept:'application/json'
      }
    });
    const raw=await r.text();
    let j={};
    try{ j=raw ? JSON.parse(raw) : {}; }catch(_e){ j={message:C(raw).slice(0,300)}; }

    if(!r.ok){
      const error=safeKakaoError(r.status,j);
      console.error('[GM_ORDER_MAP_ADDRESS_KAKAO_UPSTREAM_FAIL]',JSON.stringify({status:r.status,lat,lng,error,body:C(raw).slice(0,500)}));
      /* Deliberately 200: GM_SERVER treats non-2xx as a transport failure and hides the
         useful Kakao response. ok:false keeps application failure semantics. */
      return res.status(200).json({ok:false,error,upstream_status:r.status,kakao_detail:C(j&&j.message)});
    }

    const doc=Array.isArray(j&&j.documents)&&j.documents.length?j.documents[0]:null;
    if(!doc){
      console.warn('[GM_ORDER_MAP_ADDRESS_KAKAO_NOT_FOUND]',JSON.stringify({lat,lng}));
      return res.status(200).json({ok:false,error:'선택한 좌표에서 한국 주소를 찾지 못했습니다.',lat,lng});
    }

    const road=doc.road_address||null, lot=doc.address||null;
    const address1=C((road&&road.address_name)||(lot&&lot.address_name));
    const zipcode=C(road&&road.zone_no);
    console.log('[GM_ORDER_MAP_ADDRESS_KAKAO_OK]',JSON.stringify({lat,lng,zipcode,address1}));
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
    const msg=C(e&&e.message||e);
    console.error('[GM_ORDER_MAP_ADDRESS_KAKAO_NETWORK_ERROR]',JSON.stringify({lat,lng,error:msg}));
    /* Same reason as upstream failure: expose the actual message to the WebView. */
    return res.status(200).json({ok:false,error:'Kakao API 네트워크 오류: '+msg});
  }
});

module.exports=router;
