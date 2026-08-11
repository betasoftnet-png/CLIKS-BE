const express = require('express');
const router = express.Router();
const caController = require('../controllers/caController');

router.get('/', caController.getPresenceStatus);
router.get('/login', caController.setUserOnline);
router.post('/login', caController.setUserOnline);
router.get('/logout', caController.setUserOffline);
router.post('/logout', caController.setUserOffline);
router.get('/heartbeat', caController.updatePresenceHeartbeat);
router.post('/heartbeat', caController.updatePresenceHeartbeat);

module.exports = router;
