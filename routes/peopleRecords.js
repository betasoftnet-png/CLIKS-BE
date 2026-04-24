const express = require('express');
const router = express.Router({ mergeParams: true });
const { verifyPerson, getRecords, createRecord, getRecord, updateRecord, deleteRecord } = require('../controllers/peopleRecordsController');

// Middleware: verify the parent person exists and belongs to the user
router.use(verifyPerson);

// GET    /people/:personId/records              — List all records for a person
router.get('/', getRecords);

// POST   /people/:personId/records              — Add a new record to a person
router.post('/', createRecord);

// GET    /people/:personId/records/:id          — Get a single record by ID
router.get('/:id', getRecord);

// PATCH  /people/:personId/records/:id          — Update a record (title, type, content)
router.patch('/:id', updateRecord);

// DELETE /people/:personId/records/:id          — Delete a record
router.delete('/:id', deleteRecord);

module.exports = router;
