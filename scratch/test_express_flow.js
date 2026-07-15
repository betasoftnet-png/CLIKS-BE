process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';

const request = require('supertest');
const app = require('../app');
const db = require('../db/connection');
const { runMigrations } = require('../db/migrations');
const TokenService = require('../utils/tokenService');

async function runTest() {
  try {
    console.log("Setting up database for Express test...");
    await runMigrations();

    // 1. Create/Ensure user and generate auth token
    const now = new Date().toISOString();
    let user = await db.prepare("SELECT * FROM users WHERE id = 1").get();
    if (!user) {
      const info = await db.prepare("INSERT INTO users (id, username, email, password_hash, created_at, updated_at) VALUES (1, 'TestUser', 'testuser@test.com', 'hash', ?, ?)").run(now, now);
      user = await db.prepare("SELECT * FROM users WHERE id = ?").get(info.lastInsertRowid);
    }

    const { accessToken } = await TokenService.issueEnhancedTokens(user);
    console.log("AccessToken obtained:", accessToken);

    // 2. Create a contact "gowtham" for this user
    let person = await db.prepare("SELECT * FROM people WHERE name = 'gowtham' AND user_id = ?").get(user.id);
    if (!person) {
      // First ensure people table has the columns, if not alter it
      try {
        await db.prepare("ALTER TABLE people ADD COLUMN role_type TEXT").run();
      } catch (e) {}
      try {
        await db.prepare("ALTER TABLE people ADD COLUMN company TEXT").run();
      } catch (e) {}
      try {
        await db.prepare("ALTER TABLE people ADD COLUMN contact_info TEXT").run();
      } catch (e) {}

      const info = await db.prepare("INSERT INTO people (user_id, name, role_type, created_at, updated_at) VALUES (?, 'gowtham', 'friend', ?, ?)").run(user.id, now, now);
      person = await db.prepare("SELECT * FROM people WHERE id = ?").get(info.lastInsertRowid);
    }
    console.log("Person created/ensured:", person);

    // 3. Post a new reminder without amount using supertest
    console.log("Sending POST /api/v1/people/:personId/reminders request...");
    const postRes = await request(app)
      .post(`/api/v1/people/${person.id}/reminders`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        title: '567',
        due_date: '2026-07-13'
      });

    console.log("POST Response Body:", JSON.stringify(postRes.body, null, 2));
    const reminderId = postRes.body.data.id;

    // 4. Update the reminder to add amount: 456
    console.log(`Sending PATCH /api/v1/people/${person.id}/reminders/${reminderId} request...`);
    const patchRes = await request(app)
      .patch(`/api/v1/people/${person.id}/reminders/${reminderId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        amount: '456'
      });

    console.log("PATCH Response Status:", patchRes.status);
    console.log("PATCH Response Body:", JSON.stringify(patchRes.body, null, 2));

  } catch (err) {
    console.error("Express test failed:", err);
  } finally {
    process.exit();
  }
}

runTest();
