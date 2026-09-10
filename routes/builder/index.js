'use strict';
// GM_BUILDER_ROUTE_INDEX_V002_DOMAIN_SPLIT
//
// Builder routing rule:
//   1) Generic Builder functions stay at routes/builder/*.js
//   2) Domain-specific functions are mounted through one domain index only.
//   3) Do NOT mount an image-vector leaf route directly from this file.
//      Image-vector ownership starts at ./image_vector/index.js.
//
// This makes the request path traceable:
//   /api/gm/builder/image-vector/* -> image_vector/index.js -> one leaf module.

const express = require('express');
const router = express.Router();

// ---- Generic Builder modules -------------------------------------------------
router.use(require('./meta'));          // metadata / status lists
router.use(require('./download'));      // backup / download
router.use(require('./safe_update'));   // generic CSV safe update only
router.use(require('./members'));       // Cafe24 member import/export
router.use(require('./record_editor')); // direct record maintenance
router.use(require('./runtime_config'));// central runtime configuration
router.use(require('./device_lang'));   // language-pack administration

// ---- Domain Builder modules --------------------------------------------------
router.use(require('./image_vector'));  // ALL /builder/image-vector/* routes

module.exports = router;
