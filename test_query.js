const db = require('./db/connection');
try {
  const list = db.prepare(`
      SELECT 
          json_extract(item.value, '$.name') as name,
          SUM(json_extract(item.value, '$.quantity')) as sold,
          SUM(json_extract(item.value, '$.quantity') * json_extract(item.value, '$.price')) as total_sales
      FROM business_invoices, json_each(business_invoices.items) as item
      WHERE business_invoices.user_id = 1
      GROUP BY json_extract(item.value, '$.name')
      ORDER BY sold DESC
      LIMIT 5
  `).all();
  console.log(list);
} catch (e) {
  console.error(e);
}
