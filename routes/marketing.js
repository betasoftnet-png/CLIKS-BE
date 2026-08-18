const express = require('express');
const router = express.Router();
const marketingController = require('../controllers/marketingController');
const { auth } = require('../middleware/auth');

router.use(auth);

router.get('/', marketingController.getCampaigns);
router.post('/', marketingController.createCampaign);
router.post('/:id/launch', marketingController.launchCampaign);
router.put('/:id', marketingController.updateCampaign);
router.delete('/:id', marketingController.deleteCampaign);

module.exports = router;
