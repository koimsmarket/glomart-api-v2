/* GM_CATEGORY_INDEXEDDB_V001
 * User-side category cache. Load from Glomart page/app and call GMCategoryCache.sync().
 * Unsupported languages receive Korean packs; UI may translate on device/client separately.
 */
(function(w){'use strict';
const DB='gm_category_cache_v1',STORE='category',META='meta';
function lang(v){let s=String(v||'').trim().toLowerCase().replace('_','-');const supported=['kr','en','vi','zh','ja','tw','th','uz','ne','km','id','tl','mn','my','kk','si','ru','bn','ur','lo','hi','tr','fa','es','fr'];if(s==='ko')s='kr';if(s==='jp')s='ja';if(s==='cn')s='zh';if(s==='vn')s='vi';if(s==='zh-tw')s='tw';if(s.includes('-')&&supported.includes(s.split('-')[0]))s=s.split('-')[0];return supported.includes(s)?s:'kr';}
function openDb(){return new Promise((ok,bad)=>{const r=indexedDB.open(DB,1);r.onupgradeneeded=()=>{const d=r.result;if(!d.objectStoreNames.contains(STORE)){const s=d.createObjectStore(STORE,{keyPath:'gm_code'});s.createIndex('depth','depth');s.createIndex('parent_code','parent_code');}if(!d.objectStoreNames.contains(META))d.createObjectStore(META);};r.onsuccess=()=>ok(r.result);r.onerror=()=>bad(r.error);});}
function tx(db,store,mode='readonly'){return db.transaction(store,mode).objectStore(store);}
function req(r){return new Promise((ok,bad)=>{r.onsuccess=()=>ok(r.result);r.onerror=()=>bad(r.error);});}
async function getMeta(db,k){return req(tx(db,META).get(k));}async function setMeta(db,k,v){return req(tx(db,META,'readwrite').put(v,k));}
async function applyItems(db,items){const os=tx(db,STORE,'readwrite');for(const x of items||[]){if(x&&x.op==='delete')os.delete(x.gm_code);else{const it=x&&x.op==='upsert'?x.item:x;if(it&&it.gm_code)os.put(it);}}return new Promise((ok,bad)=>{os.transaction.oncomplete=ok;os.transaction.onerror=()=>bad(os.transaction.error);});}
async function fetchJson(url){const r=await fetch(url,{cache:'no-store'});if(!r.ok)throw new Error('HTTP_'+r.status+' '+url);return r.json();}
async function sync(opt){opt=opt||{};const base=String(opt.apiBase||'').replace(/\/+$/,'');const wanted=String(opt.lang||w.GM_LANG||navigator.language||'ko');const useLang=lang(wanted);const db=await openDb();const remote=await fetchJson(base+'/api/gm/category-pack/meta');const localBase=Number(await getMeta(db,'base_version')||0);let localDelta=Number(await getMeta(db,'delta_version')||0);const localLang=String(await getMeta(db,'lang')||'');if(localBase!==Number(remote.base_version)||localLang!==useLang){const p=await fetchJson(base+'/api/gm/category-pack/base/'+remote.base_version+'/'+useLang);await new Promise((ok,bad)=>{const clear=tx(db,STORE,'readwrite').clear();clear.onsuccess=ok;clear.onerror=()=>bad(clear.error);});await applyItems(db,p.items||[]);await setMeta(db,'base_version',Number(remote.base_version));await setMeta(db,'delta_version',0);await setMeta(db,'lang',useLang);localDelta=0;}
for(const v0 of remote.delta_versions||[]){const v=Number(v0);if(v<=localDelta)continue;const p=await fetchJson(base+'/api/gm/category-pack/delta/'+v+'/'+useLang);await applyItems(db,p.items||[]);localDelta=v;await setMeta(db,'delta_version',v);}return {ok:true,requested_lang:wanted,pack_lang:useLang,base_version:Number(remote.base_version),delta_version:localDelta};}
async function list(opt){opt=opt||{};const db=await openDb(),all=await req(tx(db,STORE).getAll());return all.filter(x=>(opt.depth==null||Number(x.depth)===Number(opt.depth))&&(!opt.parent_code||String(x.parent_code||'')===String(opt.parent_code)));}
w.GMCategoryCache={sync,list};
})(window);
