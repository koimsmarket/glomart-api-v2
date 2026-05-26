const express = require('express');
const router = express.Router();
function db(req){ return req.app.locals.db || req.app.locals.pool; }
router.get('/api/health', async (req,res)=>{
  const pool=db(req);
  if(!pool) return res.status(500).json({ok:false,error:'DB pool is not attached'});
  try{
    const r=await pool.query('SELECT NOW() AS now');
    res.json({ok:true,db:true,now:r.rows[0].now});
  }catch(e){ res.status(500).json({ok:false,error:e.message}); }
});
module.exports=router;
