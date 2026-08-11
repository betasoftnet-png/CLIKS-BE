const db = require('../db/connection');

async function test8517() {
  const rows = await db.prepare("SELECT hsn_code, description FROM hsn_master WHERE hsn_code LIKE '8517%' LIMIT 10").all();
  console.log('8517 records in DB:', rows);
}

test8517().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
