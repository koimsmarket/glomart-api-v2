'use strict';
// GM_BUILDER_IMAGE_VECTOR_INDEX_V006_HNSW_DETACHED
// Image Vector Builder entry point.
// Scope is intentionally limited to vector production/maintenance only.
// HNSW / representative Builder routes live under ../image_hnsw.

const express = require('express');
const router = express.Router();

router.use(require('./sync_products'));

module.exports = router;
