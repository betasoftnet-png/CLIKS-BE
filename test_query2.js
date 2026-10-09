const db = require('./db/connection');
try {
  const list = db.prepare(`
      SELECT 
          COALESCE(json_extract(item.value, '$.product_name'), json_extract(item.value, '$.description'), json_extract(item.value, '$.name')) as name,
          SUM(json_extract(item.value, '$.quantity')) as sold,
          SUM(json_extract(item.value, '$.quantity') * COALESCE(json_extract(item.value, '$.unit_price'), json_extract(item.value, '$.price'), json_extract(item.value, '$.rate'), 0)) as total_sales
      FROM business_invoices, json_each(business_invoices.items) as item
      WHERE business_invoices.user_id = 1
      GROUP BY name
      HAVING name IS NOT NULL
      ORDER BY total_sales DESC
      LIMIT 5
  `).all();
  console.log(list);
} catch (e) {
  console.error(e);
}
