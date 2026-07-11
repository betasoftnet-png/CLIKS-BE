const db = require('../db/connection');

async function test() {
  try {
    const people = await db.prepare("SELECT * FROM people").all();
    const reminders = await db.prepare("SELECT * FROM people_reminders").all();
    console.log('People:', people);
    console.log('Reminders:', reminders);
  } catch (err) {
    console.error(err);
  }
}

test();
