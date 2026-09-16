const db = require('../db/connection');

async function test() {
  const q = `
    INSERT INTO eway_bills (
      user_id,
      business_id,
      eway_bill_no,
      carrier_name,
      vehicle_no,
      distance_km,
      from_place,
      to_place,
      status,
      pdf_url,
      created_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, 'GENERATED', $9, NOW()
    )
    ON CONFLICT (eway_bill_no) 
    DO UPDATE SET 
      status = 'GENERATED',
      pdf_url = EXCLUDED.pdf_url;
  `;

  const params = [
    1,
    1,
    '341010876550',
    'Jay Trans',
    'UK07AB1234',
    40,
    'Dehradun',
    'Noida',
    'https://example.com/pdf'
  ];

  const res = await db.query(q, params);
  console.log('Query result:', res);

  const fetchQ = `
    SELECT 
      id,
      eway_bill_no,
      carrier_name,
      vehicle_no,
      distance_km,
      from_place,
      to_place,
      status,
      pdf_url,
      created_at
    FROM eway_bills
    WHERE business_id = $1 OR user_id = $2
    ORDER BY created_at DESC, id DESC
  `;

  const fetchRes = await db.query(fetchQ, [1, 1]);
  console.log('Fetch result:', fetchRes.rows);
}

test().catch(console.error);
