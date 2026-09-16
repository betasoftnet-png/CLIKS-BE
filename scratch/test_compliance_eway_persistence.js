const express = require('express');
const request = require('supertest');
const complianceRouter = require('../routes/compliance');

const app = express();
app.use(express.json());

// Mock auth middleware putting user on req
app.use((req, res, next) => {
  req.user = { id: 1, business_id: 1, role: 'business', account_type: 'business' };
  next();
});

app.use('/compliance', complianceRouter);

async function run() {
  const db = require('../db/connection');
  await db.query(`
    INSERT INTO eway_bills (
      user_id, business_id, eway_bill_no, carrier_name, vehicle_no, distance_km, from_place, to_place, status, pdf_url, created_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, 'GENERATED', $9, NOW()
    ) ON CONFLICT (eway_bill_no) DO UPDATE SET status = 'GENERATED', pdf_url = EXCLUDED.pdf_url;
  `, [1, 1, '341010876551', 'Fast Transport', 'DL01AB9999', 50, 'Delhi', 'Jaipur', 'https://example.com/pdf2']);

  console.log('Testing GET /compliance/ewaybills...');
  const res = await request(app).get('/compliance/ewaybills');
  console.log('Status:', res.status);
  console.log('Success:', res.body?.success);
  console.log('Rows count:', res.body?.data?.length);
  console.log('Top record:', res.body?.data?.[0]?.eway_bill_no);
  console.log('Second record:', res.body?.data?.[1]?.eway_bill_no);
}

run().catch(console.error);
