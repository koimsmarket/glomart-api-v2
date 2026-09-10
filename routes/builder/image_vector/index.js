'use strict';
// GM_BUILDER_IMAGE_VECTOR_INDEX_V002
// Single entry point for Image Vector Builder features.
// New image-vector Builder APIs must be mounted here, not in ../index.js.

const express = require('express');
const router = express.Router();

router.use(require('./sync_products'));
router.use(require('./category_group'));
router.use(require('./classification')); // periodic visual classification + lightweight verification exports

module.exports = router;
