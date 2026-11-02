'use strict';
// GM_UI_AUTO_V008: read-only preflight before either legacy publisher is invoked.
// Existing manual BASE/DELTA and UI distribution remain authoritative.
const {snapshot}=require('./dictionary_fingerprint');
const ui=require('./ui'),category=require('./category');
const uiLangs=require('./ui/ui_dictionary_v2').LANGS;
const categoryLangs=require('../asset_pack_manager').LANGS;
function countLanguages(){
 if(uiLangs.length!==25||new Set(uiLangs).size!==25)throw Error('UI_LANGUAGE_COUNT_NOT_25');
 if(categoryLangs.length!==25||new Set(categoryLangs).size!==25)throw Error('CATEGORY_LANGUAGE_COUNT_NOT_25');
 if(uiLangs.some(l=>!categoryLangs.includes(l)))throw Error('LANGUAGE_PACK_MISMATCH');
}
async function check(db){
 countLanguages();
 const before=await snapshot(db);
 const [missingUI,missingCategory]=await Promise.all([ui.missing(db),category.inspect(db)]);
 if(missingUI.length||missingCategory)throw Error('TRANSLATIONS_INCOMPLETE ui='+missingUI.length+' category='+missingCategory);
 // Source text cannot be silently discarded from a published 25-language asset.
 const u=await db.query("SELECT COUNT(*)::int AS n FROM gm_ui_dictionary WHERE active_yn='Y' AND NULLIF(BTRIM(kr),'') IS NULL");
 const c=await db.query("SELECT COUNT(*)::int AS n FROM gm_category WHERE NULLIF(BTRIM(name_ko),'') IS NULL");
 if(Number(u.rows[0].n)||Number(c.rows[0].n))throw Error('DICTIONARY_SOURCE_TEXT_MISSING');
 const after=await snapshot(db);
 if(before!==after)throw Error('DICTIONARY_CHANGED_DURING_PREFLIGHT');
 return {fingerprint:after,uiLanguages:uiLangs.length,categoryLanguages:categoryLangs.length};
}
module.exports={check};
