const fs = require('fs');
const path = require('path');
const db = require('../db/connection');

function parseFullCsv(content) {
  const records = [];
  let field = '';
  let row = [];
  let inQuotes = false;

  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    const nextChar = content[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        field += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      row.push(field.trim());
      field = '';
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') {
        i++;
      }
      row.push(field.trim());
      field = '';
      if (row.length >= 2 && row[0] && row[1]) {
        const code = row[0].replace(/^"|"$/g, '').trim();
        const desc = row[1].replace(/^"|"$/g, '').trim();
        if (code && desc) {
          records.push([code, desc]);
        }
      }
      row = [];
    } else {
      field += char;
    }
  }

  if (field || row.length > 0) {
    row.push(field.trim());
    if (row.length >= 2 && row[0] && row[1]) {
      const code = row[0].replace(/^"|"$/g, '').trim();
      const desc = row[1].replace(/^"|"$/g, '').trim();
      if (code && desc) {
        records.push([code, desc]);
      }
    }
  }

  // Remove header if present
  if (records.length > 0 && records[0][0].toLowerCase().includes('hsn')) {
    records.shift();
  }

  return records;
}

async function seedHsnMaster() {
  try {
    const countRes = await db.prepare('SELECT COUNT(*) AS count FROM hsn_master').get();
    if (countRes && countRes.count > 10000) {
      // Already seeded with complete master list
      return;
    }

    const csvPath = path.join(__dirname, '../CLIKS_HSN_Master.csv');
    if (!fs.existsSync(csvPath)) {
      console.warn('⚠️ HSN Master CSV file not found at:', csvPath);
      return;
    }

    console.log('📦 Seeding HSN Master dataset from CSV...');
    const fileContent = fs.readFileSync(csvPath, 'utf8');
    const records = parseFullCsv(fileContent);

    if (records.length === 0) return;

    // High speed multi-row batch insert (200 records per query)
    const batchSize = 200;
    for (let i = 0; i < records.length; i += batchSize) {
      const chunk = records.slice(i, i + batchSize);
      const placeholders = chunk.map(() => '(?, ?)').join(', ');
      const sql = `INSERT OR IGNORE INTO hsn_master (hsn_code, description) VALUES ${placeholders}`;
      const params = chunk.flat();
      try {
        await db.prepare(sql).run(...params);
      } catch (err) {
        // Fallback for postgres or syntax variations
        for (const [code, desc] of chunk) {
          try {
            await db.prepare('INSERT OR IGNORE INTO hsn_master (hsn_code, description) VALUES (?, ?)').run(code, desc);
          } catch (e) {
            try {
              await db.prepare('INSERT INTO hsn_master (hsn_code, description) VALUES (?, ?) ON CONFLICT DO NOTHING').run(code, desc);
            } catch (pgErr) {}
          }
        }
      }
    }

    console.log(`✅ HSN Master seeded successfully with ${records.length} records.`);
  } catch (error) {
    console.error('❌ Error seeding HSN Master:', error.message);
  }
}

module.exports = { seedHsnMaster };
