const db = require('./db/connection');
try {
  const list = db.prepare(`
      SELECT 
          strftime('%m', created_at) as month,
          SUM(total_amount) as total
      FROM business_invoices
      WHERE user_id = 1
      GROUP BY month
  `).all();
  console.log(list);
} catch (e) {
  console.error(e);
}
