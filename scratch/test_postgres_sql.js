const fs = require('fs');

const content = fs.readFileSync('db/migrations.js', 'utf8');

const startIdx = content.indexOf('let sql = `');
const endIdx = content.indexOf('`;', startIdx);

let sql = content.substring(startIdx + 11, endIdx);
sql = sql.replace(/INTEGER PRIMARY KEY AUTOINCREMENT/g, 'SERIAL PRIMARY KEY');
sql = sql.replace(/REAL/g, 'NUMERIC');

const statements = sql.split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0);

console.log(`Auditing ${statements.length} SQL statements...`);

statements.forEach((stmt, idx) => {
    // Strip comments
    const lines = stmt.split('\n').filter(l => !l.trim().startsWith('--'));
    const cleanStmt = lines.join(' ').trim();
    if (!cleanStmt) return;

    // Check for PostgreSQL syntax bugs
    // 1. Column default syntax: DEFAULT 'false' vs DEFAULT FALSE
    // 2. Trailing commas before closing parenthesis: , )
    if (/,\s*\)/.test(cleanStmt)) {
        console.log(`❌ Statement #${idx + 1} has trailing comma before ')'!`);
        console.log(cleanStmt);
    }

    // 3. Double NOT or bad NOT syntax
    if (/\bNOT\b/i.test(cleanStmt)) {
        // Find where NOT appears
        const words = cleanStmt.split(/\s+/);
        words.forEach((w, wIdx) => {
            if (w.toUpperCase() === 'NOT') {
                const prev = words[wIdx - 1] || '';
                const next = words[wIdx + 1] || '';
                // In Postgres: valid NOT contexts: 'NOT NULL', 'IF NOT EXISTS', 'NOT IN', 'NOT LIKE', 'IS NOT'
                const validNext = ['NULL', 'EXISTS', 'IN', 'LIKE', 'DELETED', 'PENDING', 'PAID', 'UNPAID', 'REVOKED', 'ACTIVE', 'SHARED', 'COMPLETED', 'DRAFT'];
                const validPrev = ['IF', 'IS', 'DEFAULT', '=', '!='];
                
                // If w is part of a string literal like 'NOT SHARED' or 'NOT CONNECTED' or 'NOT FOUND'
                const isStringLiteral = cleanStmt.includes(`'${w}`) || cleanStmt.includes(`${w}'`) || cleanStmt.includes(`'NOT`);

                if (!validNext.includes(next.toUpperCase()) && !validPrev.includes(prev.toUpperCase()) && !isStringLiteral) {
                    console.log(`⚠️ Statement #${idx + 1} suspicious NOT context: "...${prev} ${w} ${next}..."`);
                    console.log(`Statement text:\n${cleanStmt}\n`);
                }
            }
        });
    }
});
