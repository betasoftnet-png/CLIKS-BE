const db = require('../db/connection');
const profileController = require('../controllers/profileController');

async function test() {
  const user = await db.prepare('SELECT * FROM users WHERE id = 1').get();
  console.log("DB User 1:", user);
  // simulate profile call
  const req = { user: { id: 1, role: 'user' } };
  const res = {
    status: function() { return this; },
    json: (data) => console.log("Profile response:", JSON.stringify(data.data.active_subscriptions, null, 2))
  };
  await profileController.getProfile(req, res);
}

test();
