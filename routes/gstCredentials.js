const express = require('express');
const router = express.Router();
const caController = require('../controllers/caController');

router.get('/', caController.getGstCredentials);
router.post('/', caController.saveGstCredentials);
router.post('/request', caController.requestGstCredentials);
router.put('/revoke', caController.revokeGstCredentials);
router.delete('/', caController.revokeGstCredentials);

module.exports = router;
