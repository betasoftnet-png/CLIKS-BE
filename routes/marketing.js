const express = require('express');
const router = express.Router();
const marketingController = require('../controllers/marketingController');
const { auth } = require('../middleware/auth');

router.use(auth);

// Templates endpoints (must come before /:id)
router.get('/templates', marketingController.getTemplates);
router.post('/templates', marketingController.createTemplate);
router.put('/templates/:id', marketingController.updateTemplate);
router.delete('/templates/:id', marketingController.deleteTemplate);

router.get('/', marketingController.getCampaigns);
router.post('/', marketingController.createCampaign);
router.post('/:id/launch', marketingController.launchCampaign);
router.put('/:id', marketingController.updateCampaign);
router.delete('/:id', marketingController.deleteCampaign);

module.exports = router;
