require('dotenv').config();
const { Pool } = require('pg');
const db = require('../db/connection');

async function cleanupPldSubscriptions() {
  console.log('--- Starting PLD Subscription Cleanup ---');

  // 1. PostgreSQL Database execution
  try {
    const pool = new Pool({
      host:     process.env.DB_HOST     || 'localhost',
      port:     Number(process.env.DB_PORT) || 5432,
      user:     process.env.DB_USER     || 'postgres',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME     || 'books_finance'
    });

    const updateSql = `
      DO $$
      BEGIN
        IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'subscriptions') THEN
          UPDATE subscriptions
          SET is_active = FALSE,
              status = 'cancelled',
              updated_at = NOW()
          WHERE LOWER(module) IN ('partner_launch_desk', 'pld', 'investor_club', 'products_ideas')
             OR LOWER(plan_key) LIKE '%pld%'
             OR LOWER(plan_name) LIKE '%investor%'
             OR LOWER(plan_name) LIKE '%innovators%';
        END IF;
      END $$;
    `;

    await pool.query(updateSql);
    console.log('✅ PostgreSQL subscriptions table cleaned up successfully.');
    await pool.end();
  } catch (err) {
    console.log('ℹ️ PostgreSQL note (may use SQLite or table not present):', err.message);
  }

  // 2. Cleanup active_subscriptions in users table via connection
  try {
    const users = await db.prepare('SELECT id, active_subscriptions FROM users').all();
    let cleanedCount = 0;

    for (const u of (users || [])) {
      if (u.active_subscriptions) {
        try {
          const subs = typeof u.active_subscriptions === 'string'
            ? JSON.parse(u.active_subscriptions)
            : u.active_subscriptions;

          let modified = false;
          if (subs.investor && (subs.investor.active !== false || subs.investor.plan)) {
            subs.investor = { active: false, plan: null };
            modified = true;
          }
          if (subs.poster && (subs.poster.active !== false || subs.poster.plan)) {
            subs.poster = { active: false, plan: null };
            modified = true;
          }

          if (modified) {
            await db.prepare('UPDATE users SET active_subscriptions = ? WHERE id = ?')
              .run(JSON.stringify(subs), u.id);
            cleanedCount++;
          }
        } catch (pe) {
          // ignore parse error
        }
      }
    }
    console.log(`✅ Cleaned up PLD subscriptions for ${cleanedCount} user(s) in database.`);
  } catch (err) {
    console.log('ℹ️ Users table active_subscriptions cleanup note:', err.message);
  }

  console.log('--- PLD Subscription Cleanup Finished ---');
}

cleanupPldSubscriptions()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Cleanup error:', err);
    process.exit(1);
  });
