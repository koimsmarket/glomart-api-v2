const express = require('express');
const router = express.Router();

router.use(require('./meta'));
router.use(require('./download'));
router.use(require('./safe_update'));
router.use(require('./members'));

module.exports = router;
