const db = require('./db/connection');

async function check() {
  try {
    const rows = await db.prepare("SELECT * FROM transactions").all();
    console.log("All Rows:", JSON.stringify(rows, null, 2));
  } catch (err) {
    console.error("Error:", err);
  }
}

check();
