const db = require('../db/connection');
try {
  const tables = db.raw.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(t=>t.name);
  console.log('Matching tables:', tables.filter(t => 
    t.includes('audit') || t.includes('purchase') || t.includes('asset') || 
    t.includes('bank') || t.includes('voucher') || t.includes('rule11g') || 
    t.includes('grn') || t.includes('brs') || t.includes('sa230') || t.includes('invoice')
  ));
} catch(e) {
  console.error(e);
}
process.exit(0);
