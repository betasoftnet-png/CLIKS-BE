const express = require('express');
const router = express.Router();
const caController = require('../controllers/caController');

router.get('/', caController.getTasks);
router.post('/', caController.addTask);
router.put('/:id', caController.updateTask);
router.delete('/:id', caController.deleteTask);
router.post('/:id/toggle', caController.toggleTaskStatus);
router.post('/:id/upload', caController.uploadTaskDoc);

module.exports = router;
