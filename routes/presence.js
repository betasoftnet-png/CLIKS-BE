const express = require('express');
const router = express.Router();
const caController = require('../controllers/caController');

router.get('/', caController.getPresenceStatus);
router.post('/login', caController.setUserOnline);
router.post('/logout', caController.setUserOffline);
router.post('/heartbeat', caController.updatePresenceHeartbeat);

module.exports = router;
