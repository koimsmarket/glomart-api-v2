'use strict';
// GM_UI_AUTO_V007: content fingerprint for close-time change detection.
// Read-only DB scans; never mutate existing translations.
const crypto=require('crypto');
const LANGS=require('../ui_dictionary_v2').LANGS;
const FOREIGN=require('../ui_dictionary_v2').FOREIGN;
function quote(s){return '"'+String(s).replace(/"/g,'""')+'"';}
function feed(hash,domain,rows,fields){
 hash.update(domain+'\n');
 for(const row of rows){hash.update(JSON.stringify(fields.map(f=>row[f]===null?null:String(row[f]??'')))+'\n');}
}
async function snapshot(db){
 const hash=crypto.createHash('sha256');
 const uiCols=['gm_code',...LANGS];
 const u=await db.query(`SELECT ${uiCols.map(quote).join(',')} FROM gm_ui_dictionary WHERE active_yn='Y' ORDER BY gm_code`);
 feed(hash,'ui',u.rows,uiCols);
 const cols=['name_ko',...FOREIGN.map(l=>'name_'+l)];
 const present=new Set((await db.query("SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='gm_category'")).rows.map(r=>r.column_name));
 if(cols.some(c=>!present.has(c)))throw Error('CATEGORY_FINGERPRINT_COLUMNS_MISSING');
 // Stable order includes all source/translated values. Order by all selected columns
 // avoids reliance on physical ctid, which can change after maintenance.
 const c=await db.query(`SELECT ${cols.map(quote).join(',')} FROM gm_category WHERE NULLIF(BTRIM(name_ko),'') IS NOT NULL ORDER BY ${cols.map(quote).join(',')}`);
 feed(hash,'category',c.rows,cols);
 return hash.digest('hex');
}
module.exports={snapshot};
