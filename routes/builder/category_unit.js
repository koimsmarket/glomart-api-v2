'use strict';
// GM_CATEGORY_V037_BUILDER_UNIT_RULE_BULK
// Bulk workflow only: rule CSV validate -> apply -> product+option verify/recalc.
// Existing V036 unit calculation engine remains unchanged.
const express=require('express');
const multer=require('multer');
const router=express.Router();
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:8*1024*1024}});
const {recalcCategory,normUnit}=require('../../services/unit_price');
const {parseCsv,toCsv}=require('./core');
const db=req=>req.app.locals.db||req.app.locals.pool;
const clean=v=>String(v==null?'':v).replace(/^\uFEFF/,'').trim();
const ALLOWED_UNITS=new Set(['mg','g','kg','ml','l','개','매','롤','정','캡슐','포','병','캔','켤레','장']);

function normalizeRuleRow(row,rowNo){
  const gmCode=clean(row.gm_code||row.GM_CODE||row.code);
  const qty=Number(String(row.unit_rule_qty==null?'':row.unit_rule_qty).replace(/,/g,''));
  const unit=normUnit(row.unit_rule_unit||'');
  const errors=[];
  if(!gmCode) errors.push('MISSING_GM_CODE');
  if(!Number.isFinite(qty)||qty<=0) errors.push('BAD_QTY');
  if(!unit||!ALLOWED_UNITS.has(unit)) errors.push('BAD_UNIT');
  return {row_no:rowNo,gm_code:gmCode,unit_rule_qty:qty,unit_rule_unit:unit,errors};
}

async function inspectRules(pool,rows){
  const result={input_rows:rows.length,valid:0,invalid:0,missing_category:0,duplicate_code:0,changed:0,unchanged:0,items:[]};
  const seen=new Set();
  for(let i=0;i<rows.length;i++){
    const x=normalizeRuleRow(rows[i],i+2);
    if(x.gm_code&&seen.has(x.gm_code)){
      x.errors.push('DUPLICATE_GM_CODE');
      result.duplicate_code++;
    }
    if(x.gm_code) seen.add(x.gm_code);
    if(!x.errors.length){
      const r=await pool.query(`SELECT gm_code,name_ko,keyword,unit_rule_qty,unit_rule_unit FROM gm_category WHERE gm_code=$1 LIMIT 1`,[x.gm_code]);
      if(!r.rows.length){
        x.errors.push('CATEGORY_NOT_FOUND');
        result.missing_category++;
      }else{
        const cur=r.rows[0];
        x.name_ko=cur.name_ko||'';
        x.keyword=cur.keyword||'';
        x.current_qty=cur.unit_rule_qty;
        x.current_unit=cur.unit_rule_unit||'';
        const same=Number(cur.unit_rule_qty||0)===Number(x.unit_rule_qty)&&normUnit(cur.unit_rule_unit||'')===x.unit_rule_unit;
        x.action=same?'UNCHANGED':'UPDATE';
        if(same) result.unchanged++; else result.changed++;
      }
    }
    if(x.errors.length){result.invalid++;x.action='INVALID';} else result.valid++;
    if(result.items.length<100) result.items.push(x);
  }
  return result;
}

router.post('/api/gm/builder/category-unit/import',upload.single('file'),async(req,res)=>{try{
  if(!req.file||!req.file.buffer)return res.status(400).json({ok:false,error:'CSV_FILE_REQUIRED'});
  const apply=String(req.query.apply||'').toUpperCase()==='YES';
  const rows=parseCsv(req.file.buffer.toString('utf8'));
  if(!rows.length)return res.status(400).json({ok:false,error:'CSV_EMPTY'});
  if(rows.length>20000)return res.status(400).json({ok:false,error:'TOO_MANY_ROWS',limit:20000,input_rows:rows.length});
  const pool=db(req);
  const report=await inspectRules(pool,rows);
  if(!apply)return res.json({ok:true,mode:'VALIDATE',...report});
  if(report.invalid>0)return res.status(409).json({ok:false,mode:'APPLY_BLOCKED',error:'INVALID_ROWS_EXIST',...report});

  const client=await pool.connect();
  let applied=0;
  try{
    await client.query('BEGIN');
    const seen=new Set();
    for(let i=0;i<rows.length;i++){
      const x=normalizeRuleRow(rows[i],i+2);
      if(seen.has(x.gm_code))continue;
      seen.add(x.gm_code);
      const r=await client.query(`UPDATE gm_category SET unit_rule_qty=$2,unit_rule_unit=$3,updated_at=NOW() WHERE gm_code=$1 AND (COALESCE(unit_rule_qty,0)<>$2 OR COALESCE(unit_rule_unit,'')<>$3)`,[x.gm_code,x.unit_rule_qty,x.unit_rule_unit]);
      applied+=r.rowCount||0;
    }
    await client.query('COMMIT');
  }catch(e){
    await client.query('ROLLBACK').catch(()=>{});
    throw e;
  }finally{client.release();}
  res.json({ok:true,mode:'APPLY',applied,...report});
}catch(e){res.status(500).json({ok:false,error:String(e.message||e)});}});

router.get('/api/gm/builder/category-unit/export',async(req,res)=>{try{
  const r=await db(req).query(`SELECT gm_code,name_ko,keyword,unit_rule_qty,unit_rule_unit FROM gm_category WHERE COALESCE(unit_rule_qty,0)>0 AND COALESCE(unit_rule_unit,'')<>'' ORDER BY gm_code`);
  const csv=toCsv(r.rows,['gm_code','name_ko','keyword','unit_rule_qty','unit_rule_unit']);
  res.setHeader('Content-Type','text/csv; charset=utf-8');
  res.setHeader('Content-Disposition',`attachment; filename="gm_category_unit_rule_${Date.now()}.csv"`);
  res.end(csv);
}catch(e){res.status(500).json({ok:false,error:String(e.message||e)});}});

router.post('/api/gm/builder/category-unit/recalc',express.json({limit:'1mb'}),async(req,res)=>{try{
  const b=req.body||{};
  const out=await recalcCategory(db(req),{gmCode:String(b.gm_code||'').trim(),all:!!b.all,apply:!!b.apply});
  res.json({ok:true,...out});
}catch(e){res.status(500).json({ok:false,error:String(e.message||e)});}});

module.exports=router;
