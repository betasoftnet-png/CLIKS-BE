const db = require('../db/connection');

async function check99() {
  const rows = await db.prepare("SELECT hsn_code, description FROM hsn_master WHERE hsn_code LIKE '99%' LIMIT 15").all();
  console.log('SAC 99 records in DB:', rows);
}

check99().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
