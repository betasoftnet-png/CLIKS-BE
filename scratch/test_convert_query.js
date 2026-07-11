const sql = `
  INSERT INTO people_reminders (person_id, user_id, title, message, amount, due_date, status, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

const convertQuery = (sql) => {
  let pgSql = sql;
  
  // Replace SQLite strftime with PostgreSQL TO_CHAR
  pgSql = pgSql.replace(/strftime\('%Y-%m',\s*date\)/gi, "TO_CHAR(date::timestamp, 'YYYY-MM')");
  pgSql = pgSql.replace(/strftime\('%Y-%m',\s*'now'\)/gi, "TO_CHAR(CURRENT_DATE, 'YYYY-MM')");
  
  // Replace SQLite date('now') with PostgreSQL CURRENT_DATE
  pgSql = pgSql.replace(/date\('now'\)/gi, "CURRENT_DATE");

  let i = 1;
  pgSql = pgSql.replace(/\?/g, () => `$${i++}`);

  if (/^\s*INSERT\s/i.test(pgSql) && !/RETURNING/i.test(pgSql)) {
    pgSql += ' RETURNING id';
  }

  pgSql = pgSql.replace(/AS\s+([a-zA-Z0-9]+[A-Z][a-zA-Z0-9]*)/g, 'AS "$1"');

  return pgSql;
};

console.log('Resulting SQL:', convertQuery(sql));
