const express = require('express');
const router = express.Router();
const calculatorController = require('../controllers/calculatorController');
const { auth } = require('../middleware/auth');

router.use(auth);

router.get('/history', calculatorController.getHistory);
router.post('/history', calculatorController.saveHistory);
router.delete('/history/:id', calculatorController.deleteHistoryItem);
router.delete('/history', calculatorController.clearHistory);

module.exports = router;
