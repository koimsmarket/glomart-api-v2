'use strict';
// GM_BUILDER_IMAGE_VECTOR_INDEX_V001
// Single entry point for Image Vector Builder features.
// New image-vector Builder APIs must be mounted here, not in ../index.js.

const express = require('express');
const router = express.Router();

router.use(require('./sync_products'));
router.use(require('./category_group'));

module.exports = router;
