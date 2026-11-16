const express = require('express');
const router = express.Router();
const marketingController = require('../controllers/marketingController');
const { auth } = require('../middleware/auth');

router.use(auth);

// Automations endpoints (must come before /:id)
router.get('/automations', marketingController.getAutomations);
router.post('/automations', marketingController.createAutomation);
router.put('/automations/:id', marketingController.updateAutomation);
router.patch('/automations/:id/toggle', marketingController.toggleAutomationStatus);
router.post('/automations/:id/trigger', marketingController.triggerAutomationNow);
router.delete('/automations/:id', marketingController.deleteAutomation);

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
