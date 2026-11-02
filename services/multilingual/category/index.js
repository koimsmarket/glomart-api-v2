'use strict';
// Stage 1 validates category cells only. Existing category asset publisher remains the owner.
const LANGS=require('../../ui_dictionary_v2').FOREIGN;
const quote=s=>'"'+s.replace(/"/g,'""')+'"';
async function inspect(db){
 const cols=new Set((await db.query("SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='gm_category'")).rows.map(x=>x.column_name));
 if(!cols.has('name_ko'))throw Error('CATEGORY_SOURCE_COLUMN_MISSING');
 const pairs=LANGS.map(l=>'name_'+l);if(pairs.some(c=>!cols.has(c)))throw Error('CATEGORY_LANGUAGE_COLUMNS_MISSING');
 const cond=pairs.map(c=>`NULLIF(BTRIM(${quote(c)}::text),'') IS NULL`).join(' OR ');
 const q=await db.query(`SELECT COUNT(*)::int AS n FROM gm_category WHERE NULLIF(BTRIM(name_ko),'') IS NOT NULL AND (${cond})`);
 return Number(q.rows[0].n||0);
}
module.exports={inspect,LANGS};
