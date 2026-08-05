const fs = require('fs');
const content = fs.readFileSync('db/migrations.js', 'utf8');

const lines = content.split('\n');
lines.forEach((line, idx) => {
    if (line.includes('NOT') && !line.includes('NOT NULL') && !line.includes('IF NOT EXISTS') && !line.includes('Not Shared') && !line.includes('!e.message')) {
        console.log(`Line ${idx + 1}: ${line.trim()}`);
    }
});
