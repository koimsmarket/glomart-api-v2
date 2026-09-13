const express = require('express');
const router = express.Router();

router.use(require('./meta'));
router.use(require('./download'));
router.use(require('./safe_update'));
router.use(require('./members'));
router.use(require('./record_editor'));
router.use(require('./vector_sync'));
// HNSW module connection only: keep all existing Builder routes unchanged.
router.use(require('./image_vector'));
router.use(require('./runtime_config'));
router.use(require('./device_lang'));

module.exports = router;
