const db = require('../db/connection');

async function purgeMockData() {
  try {
    const mockGst = await db.prepare(`SELECT id, eway_bill_number, client_name, is_eway_bill FROM gst_invoices WHERE is_eway_bill = 'true'`).all();
    console.log('Current E-Way records in gst_invoices:', mockGst);

    // Purge records with EWB- mock numbers or blank
    const deletedGst = await db.prepare(`
      DELETE FROM gst_invoices 
      WHERE is_eway_bill = 'true' 
        AND (eway_bill_number LIKE 'EWB-%' OR eway_bill_number IS NULL OR eway_bill_number = '' OR LENGTH(TRIM(eway_bill_number)) != 12)
    `).run();
    console.log('Deleted from gst_invoices:', deletedGst.changes);

    const deletedChallans = await db.prepare(`
      DELETE FROM delivery_challans
      WHERE ewayBillNo LIKE 'EWB-%' OR ewayBillNo IS NULL OR ewayBillNo = '' OR LENGTH(TRIM(ewayBillNo)) != 12
    `).run();
    console.log('Deleted from delivery_challans:', deletedChallans.changes);

    const remaining = await db.prepare(`SELECT id, eway_bill_number, is_eway_bill FROM gst_invoices WHERE is_eway_bill = 'true'`).all();
    console.log('Remaining E-Way records in gst_invoices:', remaining);
  } catch (e) {
    console.error('Error:', e.message);
  }
}

purgeMockData();
