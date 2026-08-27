const express = require('express');
const router = express.Router();
const storageController = require('../controllers/storageController');
const { authenticateToken } = require('../middleware/auth');

router.get('/', authenticateToken, storageController.getStorageUsage);
router.get('/usage', authenticateToken, storageController.getStorageUsage);
router.post('/upload', authenticateToken, storageController.uploadFile);
router.delete('/files/:id', authenticateToken, storageController.deleteFile);

module.exports = router;
