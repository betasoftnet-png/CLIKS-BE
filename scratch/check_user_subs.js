const db = require('../db/connection');

async function check() {
  try {
    const users = await db.prepare("SELECT id, username, email, tier, active_subscriptions FROM users").all();
    console.log("Users count:", users.length);
    for (const u of users) {
      console.log(`User ${u.id} (${u.username}): active_subscriptions =`, u.active_subscriptions);
    }
  } catch (err) {
    console.error("Error:", err);
  }
}

check();
