'use strict';
// GM_BUILDER_IMAGE_HNSW_INDEX_V001
// Isolated HNSW / representative-image Builder domain.
// No background vector production, product queue, SPECIAL or normal search ownership here.

const express=require('express');
const router=express.Router();

router.use(require('./representative'));
router.use(require('./representative_initial'));

module.exports=router;
