const express = require('express');
const router = express.Router();
const caController = require('../controllers/caController');

router.get('/', caController.getNotifications);
router.post('/', caController.addNotification);
router.put('/read-all', caController.markAllNotificationsRead);
router.put('/:id/read', caController.markNotificationRead);

module.exports = router;
