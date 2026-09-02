const express = require('express');
const router = express.Router();

router.use(require('./meta'));
router.use(require('./download'));
router.use(require('./safe_update'));
router.use(require('./members'));
router.use(require('./record_editor'));
router.use(require('./vector_sync'));

module.exports = router;
