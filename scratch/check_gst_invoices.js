const db = require('../db/connection');

async function main() {
    try {
        console.log("Querying gst_invoices table...");
        const rows = await db.prepare("SELECT * FROM gst_invoices LIMIT 5").all();
        console.log("Sample Rows:", JSON.stringify(rows, null, 2));

        const count = await db.prepare("SELECT COUNT(*) as count FROM gst_invoices").get();
        console.log("Total Count:", count);
    } catch (e) {
        console.error("Error:", e);
    } finally {
        process.exit(0);
    }
}

main();
