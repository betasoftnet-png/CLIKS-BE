const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { likeLimiter } = require('../middleware/rateLimiter');
const cache = require('../middleware/cache');
const { getPublicFeed, createPost, likePost, deletePost, getActiveAnnouncement } = require('../controllers/publicController');

// GET    /public              — Get paginated public post feed (cached 2 min, filterable by type)
router.get('/', cache(120), validate.listQuery, validate.handle, getPublicFeed);

// GET    /public/announcement — Fetch the latest active announcement for display
router.get('/announcement', getActiveAnnouncement);

// POST   /public              — Create a new public post (auth required)
router.post('/', auth, validate.createPost, validate.handle, createPost);

// PATCH  /public/:id/like     — Increment like count on a post (rate-limited, no auth required)
router.patch('/:id/like', likeLimiter, likePost);

// DELETE /public/:id          — Delete your own post (auth required, author only)
router.delete('/:id', auth, deletePost);

module.exports = router;
