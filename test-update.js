const db = require('./db/connection');

async function run() {
  try {
    const id = 1;
    const user_id = 1; // Assuming we have user 1
    const fields = {
            name: "John Doe",
            salary_type: "Monthly",
            performance_rating: 4.5
    };

    const updates = [];
    const params = [];
    for (const [key, value] of Object.entries(fields)) {
        if (key !== 'id' && key !== 'user_id') {
            updates.push(`${key} = ?`);
            params.push(typeof value === 'object' ? JSON.stringify(value) : value);
        }
    }

    if (updates.length > 0) {
        updates.push('updated_at = ?');
        params.push(new Date().toISOString());
        params.push(id, user_id);

        console.log(`UPDATE employees SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`);
        console.log(params);
        await db.prepare(`UPDATE employees SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`).run(...params);
        console.log("Success");
    }
  } catch (err) {
    console.error("ERROR:", err.message);
  }
}

run();
