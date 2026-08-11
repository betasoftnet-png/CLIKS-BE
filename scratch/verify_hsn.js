const { runMigrations } = require('../db/migrations');
const db = require('../db/connection');

async function testHsn() {
  console.log('--- Clearing hsn_master table for clean test ---');
  try {
    await db.prepare('DROP TABLE IF EXISTS hsn_master').run();
  } catch (e) {}

  console.log('--- Running Migrations & HSN Seed ---');
  await runMigrations();

  console.log('\n--- Checking hsn_master count ---');
  const count = await db.prepare('SELECT COUNT(*) as count FROM hsn_master').get();
  console.log('hsn_master total records:', count.count);

  console.log('\n--- Testing Search: macbook / data processing ---');
  const macbookRes = await db.prepare(`
    SELECT hsn_code AS hsnCode, description FROM hsn_master 
    WHERE hsn_code LIKE '%8471%' OR description LIKE '%data processing%' 
    LIMIT 5
  `).all();
  console.log('Search "8471 / data processing":', macbookRes);

  console.log('\n--- Testing Search: 0101 ---');
  const hsn0101Res = await db.prepare(`
    SELECT hsn_code AS hsnCode, description FROM hsn_master 
    WHERE hsn_code LIKE '0101%' OR description LIKE '%0101%' 
    LIMIT 5
  `).all();
  console.log('Search "0101":', hsn0101Res);

  console.log('\n--- Testing Search: horse ---');
  const horseRes = await db.prepare(`
    SELECT hsn_code AS hsnCode, description FROM hsn_master 
    WHERE hsn_code LIKE '%horse%' OR description LIKE '%horse%' 
    LIMIT 5
  `).all();
  console.log('Search "horse":', horseRes);

  console.log('\n--- Testing Search: barley ---');
  const barleyRes = await db.prepare(`
    SELECT hsn_code AS hsnCode, description FROM hsn_master 
    WHERE hsn_code LIKE '%barley%' OR description LIKE '%barley%' 
    LIMIT 5
  `).all();
  console.log('Search "barley":', barleyRes);

  console.log('\n--- Idempotency Check: Running runMigrations again ---');
  await runMigrations();
  const countAfter = await db.prepare('SELECT COUNT(*) as count FROM hsn_master').get();
  console.log('hsn_master count after 2nd run:', countAfter.count);
  if (count.count === countAfter.count) {
    console.log('✅ IDEMPOTENT: No duplicate records created.');
  } else {
    console.error('❌ NOT IDEMPOTENT: Count changed!');
  }
}

testHsn().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
