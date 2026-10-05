const express = require('express');
const router = express.Router();
const mailController = require('../controllers/mailController');
const { auth } = require('../middleware/auth');

router.post('/send', auth, mailController.send);
router.post('/bulk-send', auth, mailController.bulkSend);

module.exports = router;
