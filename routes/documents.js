const express = require('express');
const router = express.Router();
const documentController = require('../controllers/documentController');
const { authenticateToken } = require('../middleware/auth');

router.get('/', authenticateToken, documentController.getDocuments);
router.get('/:id', authenticateToken, documentController.getDocumentById);
router.post('/', authenticateToken, documentController.createDocument);
router.put('/:id', authenticateToken, documentController.updateDocument);
router.patch('/:id', authenticateToken, documentController.updateDocument);
router.delete('/:id', authenticateToken, documentController.deleteDocument);

module.exports = router;
