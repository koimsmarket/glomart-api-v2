'use strict';
// GM_BUILDER_IMAGE_VECTOR_INDEX_V003_HNSW
// Image Vector Builder entry point.
// Retired permanently: category_group importer + Tree/Leaf classification Builder.
// Preserved: source-vector product sync / pending queue / background worker pipeline.

const express = require('express');
const router = express.Router();

router.use(require('./sync_products'));

module.exports = router;
