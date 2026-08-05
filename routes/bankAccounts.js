const express = require('express');
const router = express.Router();
const bankAccountController = require('../controllers/bankAccountController');
const { authenticateToken } = require('../middleware/auth');

router.get('/', authenticateToken, bankAccountController.getBankAccounts);
router.get('/:id', authenticateToken, bankAccountController.getBankAccountById);
router.post('/', authenticateToken, bankAccountController.createBankAccount);
router.put('/:id', authenticateToken, bankAccountController.updateBankAccount);
router.patch('/:id', authenticateToken, bankAccountController.updateBankAccount);
router.post('/:id/update-balance', authenticateToken, bankAccountController.updateBalance);
router.delete('/:id', authenticateToken, bankAccountController.deleteBankAccount);

module.exports = router;
