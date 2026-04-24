const express = require('express');
const router = express.Router();
const { getContacts, createContact, getContact, updateContact, deleteContact } = require('../controllers/contactsController');

// GET    /contacts              — List all contacts (searchable, filterable by type)
router.get('/', getContacts);

// POST   /contacts              — Create a new contact
router.post('/', createContact);

// GET    /contacts/:id          — Get a single contact by ID
router.get('/:id', getContact);

// PATCH  /contacts/:id          — Update contact fields
router.patch('/:id', updateContact);

// DELETE /contacts/:id          — Delete a contact
router.delete('/:id', deleteContact);

module.exports = router;
