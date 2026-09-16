require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

async function runMigration() {
  const pool = new Pool({
    host:     process.env.DB_HOST     || 'localhost',
    port:     Number(process.env.DB_PORT) || 5432,
    user:     process.env.DB_USER     || 'postgres',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME     || 'books_finance'
  });

  try {
    const sqlPath = path.join(__dirname, '../migrations/add_gst_invoices_columns.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    console.log('Running migration on PostgreSQL...');
    await pool.query(sql);
    console.log('✅ PostgreSQL migration applied successfully!');
  } catch (err) {
    console.warn('⚠️ Migration note:', err.message);
  } finally {
    await pool.end();
  }
}

runMigration();
