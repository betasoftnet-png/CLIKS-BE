require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     Number(process.env.DB_PORT) || 5432,
  user:     process.env.DB_USER     || 'postgres',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME     || 'books_finance'
});

async function run() {
  try {
    const pgSql = `
      INSERT INTO people_reminders (person_id, user_id, title, message, amount, due_date, status, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *
    `;
    const params = [1, 5, 'Test Direct Postgres', 'msg', 9000, '2026-07-25', 'pending', new Date().toISOString(), new Date().toISOString()];
    const res = await pool.query(pgSql, params);
    console.log('Inserted Row:', res.rows[0]);
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

run();
