'use strict';
// GM_BUILDER_IMAGE_VECTOR_INDEX_V005_REPRESENTATIVE_INITIAL
// Image Vector Builder entry point.
// Retired permanently: category_group importer + Tree/Leaf classification Builder.
// Preserved: source-vector product sync / pending queue / background worker pipeline.
// Representative status/stats and initial/full execution are mounted separately.

const express = require('express');
const router = express.Router();

router.use(require('./sync_products'));
router.use(require('./representative'));         // representative status/statistics
router.use(require('./representative_initial')); // representative initial/full execution

module.exports = router;
