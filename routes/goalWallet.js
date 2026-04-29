const express = require('express');
const router = express.Router();
const { 
  getWallets, 
  createWallet, 
  getWallet, 
  addMoney, 
  claimWallet, 
  deleteWallet 
} = require('../controllers/goalWalletController');

router.get('/', getWallets);
router.post('/', createWallet);
router.get('/:id', getWallet);
router.post('/:id/add-money', addMoney);
router.post('/:id/claim', claimWallet);
router.delete('/:id', deleteWallet);

module.exports = router;
