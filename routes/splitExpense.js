const express = require('express');
const router = express.Router();
const { getSplitSummary, settleFriend, getSplitExpenses, createSplitExpense, getSplitExpense, updateSplitExpense, deleteSplitExpense, getParticipants, addParticipant, settleParticipant, deleteParticipant } = require('../controllers/splitExpenseController');

// ── Summary / helper routes (must be before /:id) ────────────────────────────

// GET   /split-expenses/summary                               — Get per-friend owed summary
router.get('/summary', getSplitSummary);

// PATCH /split-expenses/settle-friend                         — Mark all unsettled shares for a named friend as settled
router.patch('/settle-friend', settleFriend);

// ── Split expense CRUD ────────────────────────────────────────────────────────

// GET    /split-expenses                                      — List all split expenses
router.get('/', getSplitExpenses);

// POST   /split-expenses                                      — Create a split expense with participants
router.post('/', createSplitExpense);

// GET    /split-expenses/:id                                  — Get a single split expense with participants
router.get('/:id', getSplitExpense);

// PATCH  /split-expenses/:id                                  — Update split expense fields
router.patch('/:id', updateSplitExpense);

// DELETE /split-expenses/:id                                  — Delete a split expense and its participants
router.delete('/:id', deleteSplitExpense);

// ── Participant sub-routes ────────────────────────────────────────────────────

// GET    /split-expenses/:id/participants                      — List all participants of a split expense
router.get('/:id/participants', getParticipants);

// POST   /split-expenses/:id/participants                      — Add a participant to a split expense
router.post('/:id/participants', addParticipant);

// PATCH  /split-expenses/:id/participants/:participantId/settle — Mark a participant's share as settled
router.patch('/:id/participants/:participantId/settle', settleParticipant);

// DELETE /split-expenses/:id/participants/:participantId       — Remove a participant from a split expense
router.delete('/:id/participants/:participantId', deleteParticipant);

module.exports = router;
