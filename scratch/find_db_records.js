const Database = require('better-sqlite3');
const path = require('path');

const paths = [
  './db/books_finance.db',
  './books_finance.db',
  './database.sqlite'
];

paths.forEach(p => {
  const absPath = path.resolve(__dirname, '..', p);
  try {
    const db = new Database(absPath);
    const count = db.prepare("SELECT COUNT(*) as cnt FROM people_reminders").get().cnt;
    const countPeople = db.prepare("SELECT COUNT(*) as cnt FROM people").get().cnt;
    console.log(`DB ${p} (${absPath}): reminders count = ${count}, people count = ${countPeople}`);
    if (count > 0) {
      console.log('Reminders:', db.prepare("SELECT * FROM people_reminders").all());
    }
  } catch (err) {
    console.log(`DB ${p} (${absPath}): error: ${err.message}`);
  }
});
