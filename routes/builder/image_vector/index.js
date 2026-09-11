'use strict';
// GM_BUILDER_IMAGE_VECTOR_INDEX_V004_REPRESENTATIVE
// Image Vector Builder entry point.
// Retired permanently: category_group importer + Tree/Leaf classification Builder.
// Preserved: source-vector product sync / pending queue / background worker pipeline.

const express = require('express');
const router = express.Router();

router.use(require('./sync_products'));
router.use(require('./representative')); // representative map/stat builder

module.exports = router;
