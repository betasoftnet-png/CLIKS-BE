const express = require('express');
const router = express.Router();
const { getPlannedPayments, createPlannedPayment, getPlannedPayment, updatePlannedPayment, markPlannedPaymentPaid, deletePlannedPayment } = require('../controllers/plannedPaymentsController');

// GET    /planned-payments                    — List all planned payments (filterable by status, category)
router.get('/', getPlannedPayments);

// POST   /planned-payments                    — Create a new planned payment
router.post('/', createPlannedPayment);

// GET    /planned-payments/:id                — Get a single planned payment by ID
router.get('/:id', getPlannedPayment);

// PATCH  /planned-payments/:id                — Update planned payment fields
router.patch('/:id', updatePlannedPayment);

// PATCH  /planned-payments/:id/mark-paid      — Mark a planned payment as paid
router.patch('/:id/mark-paid', markPlannedPaymentPaid);

// DELETE /planned-payments/:id                — Delete a planned payment
router.delete('/:id', deletePlannedPayment);

module.exports = router;
