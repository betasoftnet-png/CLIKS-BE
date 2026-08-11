const billingController = require('../controllers/billingController');
const gstController = require('../controllers/gstController');
const db = require('../db/connection');

async function runGstr1Tests() {
  console.log('====================================================');
  console.log('       GSTR-1 SALES INVOICE SYNC END-TO-END TESTS   ');
  console.log('====================================================\n');

  // TEST 1 — B2B INVOICE CREATION & SYNC
  console.log('--- TEST 1: B2B Invoice Creation ---');
  const b2bReq = {
    user: { id: 7 },
    body: {
      invoice_number: 'TEST-B2B-001',
      client_name: 'Test Trader',
      client_gstin: '33ABCDE1234F1Z5',
      amount: 10000,
      tax_amount: 1800,
      total_amount: 11800,
      paid_amount: 11800,
      due_amount: 0,
      payment_mode: 'Cash',
      status: 'Paid',
      items: [
        { product_name: 'Electronics Item', hsn_code: '84713010', quantity: 1, price: 10000, tax_rate: 18, total: 11800 }
      ]
    }
  };
  let b2bResData = null;
  await billingController.createInvoice(b2bReq, { status: () => ({ json: (d) => { b2bResData = d; } }) });
  console.log('B2B Invoice Created:', b2bResData?.data?.invoice_number);

  // Verify GSTR-1 Record for TEST-B2B-001
  const b2bGstr1 = await db.prepare("SELECT * FROM gst_invoices WHERE invoice_number = 'TEST-B2B-001' AND user_id = 7").get();
  console.log('GSTR-1 B2B Record:', {
    invoice_number: b2bGstr1?.invoice_number,
    invoice_type: b2bGstr1?.invoice_type,
    customer_name: b2bGstr1?.customer_name,
    customer_gstin: b2bGstr1?.customer_gstin,
    taxable_value: b2bGstr1?.taxable_value,
    total_tax: b2bGstr1?.total_tax,
    goods_hsn_code: b2bGstr1?.goods_hsn_code,
    status: b2bGstr1?.status
  });
  if (b2bGstr1?.invoice_type === 'B2B' && b2bGstr1?.customer_gstin === '33ABCDE1234F1Z5') {
    console.log('✅ TEST 1 PASSED: B2B Invoice successfully synced to GSTR-1 with B2B type & GSTIN!\n');
  } else {
    console.error('❌ TEST 1 FAILED:', b2bGstr1);
  }

  // TEST 2 — B2C INVOICE CREATION & SYNC
  console.log('--- TEST 2: B2C Invoice Creation ---');
  const b2cReq = {
    user: { id: 7 },
    body: {
      invoice_number: 'TEST-B2C-001',
      client_name: 'Walk-in Customer',
      client_gstin: '',
      amount: 5000,
      tax_amount: 900,
      total_amount: 5900,
      paid_amount: 5900,
      due_amount: 0,
      payment_mode: 'Cash',
      status: 'Paid',
      items: [
        { product_name: 'Grocery Item', hsn_code: '10061010', quantity: 1, price: 5000, tax_rate: 18, total: 5900 }
      ]
    }
  };
  let b2cResData = null;
  await billingController.createInvoice(b2cReq, { status: () => ({ json: (d) => { b2cResData = d; } }) });
  console.log('B2C Invoice Created:', b2cResData?.data?.invoice_number);

  // Verify GSTR-1 Record for TEST-B2C-001
  const b2cGstr1 = await db.prepare("SELECT * FROM gst_invoices WHERE invoice_number = 'TEST-B2C-001' AND user_id = 7").get();
  console.log('GSTR-1 B2C Record:', {
    invoice_number: b2cGstr1?.invoice_number,
    invoice_type: b2cGstr1?.invoice_type,
    customer_name: b2cGstr1?.customer_name,
    customer_gstin: b2cGstr1?.customer_gstin,
    taxable_value: b2cGstr1?.taxable_value,
    total_tax: b2cGstr1?.total_tax,
    goods_hsn_code: b2cGstr1?.goods_hsn_code,
    status: b2cGstr1?.status
  });
  if (b2cGstr1?.invoice_type === 'B2C' && b2cGstr1?.customer_gstin === 'URD-CONSUMER') {
    console.log('✅ TEST 2 PASSED: B2C Invoice successfully synced to GSTR-1 with B2C type!\n');
  } else {
    console.error('❌ TEST 2 FAILED:', b2cGstr1);
  }

  // TEST 3 — DUPLICATE PREVENTION ON UPDATE / RE-SYNC
  console.log('--- TEST 3: Duplicate Prevention ---');
  await billingController.updateInvoice({
    params: { id: b2bResData.data.id },
    user: { id: 7 },
    body: {
      client_name: 'Test Trader Updated',
      client_gstin: '33ABCDE1234F1Z5',
      amount: 12000,
      tax_amount: 2160,
      total_amount: 14160,
      paid_amount: 14160,
      items: [
        { product_name: 'Electronics Item Updated', hsn_code: '84713010', quantity: 1, price: 12000, tax_rate: 18, total: 14160 }
      ]
    }
  }, { status: () => ({ json: () => {} }) });

  const dupCount = await db.prepare("SELECT COUNT(*) as count FROM gst_invoices WHERE invoice_number = 'TEST-B2B-001' AND user_id = 7").get();
  console.log(`Matching GSTR-1 records count for TEST-B2B-001: ${dupCount.count}`);
  if (dupCount.count === 1) {
    console.log('✅ TEST 3 PASSED: Zero duplicates created! Exactly 1 GSTR-1 record exists after update.\n');
  } else {
    console.error('❌ TEST 3 FAILED: Duplicates found!', dupCount);
  }

  // TEST 4 — BUSINESS ISOLATION
  console.log('--- TEST 4: Business Isolation ---');
  let user7Invoices = [];
  let user1Invoices = [];
  const mockRes = (setter) => ({
    status: function() { return this; },
    json: function(payload) { setter(payload.data || []); return this; }
  });
  await gstController.getInvoices({ user: { id: 7 } }, mockRes(data => { user7Invoices = data; }));
  await gstController.getInvoices({ user: { id: 1 } }, mockRes(data => { user1Invoices = data; }));

  const user7HasUser1Recs = user7Invoices.some(i => i.user_id !== 7);
  const user1HasUser7Recs = user1Invoices.some(i => i.user_id !== 1);

  console.log(`User 7 sees ${user7Invoices.length} invoices. Has cross-tenant records: ${user7HasUser1Recs}`);
  console.log(`User 1 sees ${user1Invoices.length} invoices. Has cross-tenant records: ${user1HasUser7Recs}`);

  if (!user7HasUser1Recs && !user1HasUser7Recs) {
    console.log('✅ TEST 4 PASSED: Strict tenant business isolation verified!\n');
  } else {
    console.error('❌ TEST 4 FAILED: Tenant leak detected!');
  }

  // TEST 5 — REFRESH / PERSISTENCE
  console.log('--- TEST 5: Refresh & Persistence ---');
  const refreshedB2b = user7Invoices.find(i => i.invoice_number === 'TEST-B2B-001');
  const refreshedB2c = user7Invoices.find(i => i.invoice_number === 'TEST-B2C-001');

  if (refreshedB2b && refreshedB2c && refreshedB2b.status === 'READY') {
    console.log('✅ TEST 5 PASSED: Invoices remain persisted and READY in GSTR-1 list endpoint!\n');
  } else {
    console.error('❌ TEST 5 FAILED:', { refreshedB2b, refreshedB2c });
  }

  // Cleanup test invoices
  await db.prepare("DELETE FROM business_invoices WHERE invoice_number IN ('TEST-B2B-001', 'TEST-B2C-001')").run();
  await db.prepare("DELETE FROM gst_invoices WHERE invoice_number IN ('TEST-B2B-001', 'TEST-B2C-001')").run();
  console.log('Cleaned up temporary test records.');
}

runGstr1Tests().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
