const express = require('express');
const router = express.Router();
const businessSegregationController = require('../controllers/businessSegregationController');

router.get('/', businessSegregationController.getSegregations);
router.post('/', businessSegregationController.createSegregation);
router.delete('/:id', businessSegregationController.deleteSegregation);

module.exports = router;
