const fs = require('fs');

const content = fs.readFileSync('db/migrations.js', 'utf8');

// Extract the `sql` string from runMigrations()
const startIdx = content.indexOf('let sql = `');
const endIdx = content.indexOf('`;', startIdx);

if (startIdx === -1 || endIdx === -1) {
    console.error('Could not find sql string');
    process.exit(1);
}

let sql = content.substring(startIdx + 11, endIdx);
sql = sql.replace(/INTEGER PRIMARY KEY AUTOINCREMENT/g, 'SERIAL PRIMARY KEY');
sql = sql.replace(/REAL/g, 'NUMERIC');

const statements = sql.split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0);

console.log(`Found ${statements.length} SQL statements in sql string.`);

statements.forEach((stmt, i) => {
    // Check for syntax traps in Postgres SQL
    if (stmt.includes('NOT')) {
        // Print statement snippet
        const lines = stmt.split('\n').filter(l => !l.trim().startsWith('--'));
        const cleaned = lines.join('\n');
        // Check for suspicious 'NOT' usage
        if (cleaned.includes('NOT') && !cleaned.includes('NOT NULL') && !cleaned.includes('IF NOT EXISTS')) {
            console.log(`[Suspicious Statement #${i+1}]:\n${cleaned}\n---`);
        }
    }
});
