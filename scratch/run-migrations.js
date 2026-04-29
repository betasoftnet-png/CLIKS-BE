const dotenv = require('dotenv');
dotenv.config();
const { runMigrations } = require('../db/migrations');

async function run() {
  try {
    await runMigrations();
    console.log('✅ Migrations complete');
    process.exit(0);
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  }
}

run();
