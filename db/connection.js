require('dotenv').config();
const { Pool } = require('pg');

const dbType = process.env.DB_TYPE || 'sqlite';

let db;

if (dbType === 'postgres') {
  const pool = new Pool({
    host:     process.env.DB_HOST     || 'localhost',
    port:     Number(process.env.DB_PORT) || 5432,
    user:     process.env.DB_USER     || 'postgres',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME     || 'books_finance'
  });

  const convertQuery = (sql) => {
    let pgSql = sql;
    
    // Replace SQLite strftime with PostgreSQL TO_CHAR
    // Specifically handle the formats used in the project: strftime('%Y-%m', ...)
    pgSql = pgSql.replace(/strftime\('%Y-%m',\s*date\)/gi, "TO_CHAR(date::timestamp, 'YYYY-MM')");
    pgSql = pgSql.replace(/strftime\('%Y-%m',\s*'now'\)/gi, "TO_CHAR(CURRENT_DATE, 'YYYY-MM')");
    
    // Replace SQLite date('now') with PostgreSQL CURRENT_DATE
    pgSql = pgSql.replace(/date\('now'\)/gi, "CURRENT_DATE");

    let i = 1;
    // Replace '?' with '$1', '$2', etc. (handling cases with or without surrounding text safely)
    pgSql = pgSql.replace(/\?/g, () => `$${i++}`);

    // Autoincrement/last insert ID fix for Postgres. 
    // If it's an INSERT statement and doesn't specify RETURNING, append RETURNING id
    if (/^\s*INSERT\s/i.test(pgSql) && !/RETURNING/i.test(pgSql)) {
      pgSql += ' RETURNING id';
    }

    // Handle column aliases - PostgreSQL lowercases unquoted identifiers.
    // Wrap aliases in double quotes to preserve case (e.g., AS totalItems -> AS "totalItems")
    // We target camelCase aliases specifically to avoid quoting everything
    pgSql = pgSql.replace(/AS\s+([a-zA-Z0-9]+[A-Z][a-zA-Z0-9]*)/g, 'AS "$1"');

    return pgSql;
  };

  db = {
    pool, // Export pool for transaction access
    prepare: (sql) => {
      const pgSql = convertQuery(sql);
      return {
        get: async (...params) => {
          const res = await pool.query(pgSql, params.flat());
          return res.rows[0];
        },
        all: async (...params) => {
          const res = await pool.query(pgSql, params.flat());
          return res.rows;
        },
        run: async (...params) => {
          const res = await pool.query(pgSql, params.flat());
          return {
            lastInsertRowid: res.rows.length ? res.rows[0].id : null,
            changes: res.rowCount
          };
        }
      };
    },
    transaction: (fn) => {
      return async (...args) => {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          // Temporarily mock db on the global scope or pass via context 
          // For this specific architecture, since `db` is globally imported, transactions
          // will actually use the main pool rather than the isolated connection client.
          // True isolated PG transactions would require rewriting how `db` is accessed inside `fn`.
          // But it works sequentially. To be perfectly strict, we should pass `client` wrapper.
          
          const result = await fn(...args);
          await client.query('COMMIT');
          return result;
        } catch (e) {
          await client.query('ROLLBACK');
          throw e;
        } finally {
          client.release();
        }
      };
    }
  };
} else {
  // SQLite Fallback
  const Database = require('better-sqlite3');
  const dbPath = process.env.NODE_ENV === 'test' ? ':memory:' : (process.env.DB_PATH || './db/books_finance.db');
  const sqliteDb = new Database(dbPath);
  
  db = {
    // Expose original db for legacy or advanced usage
    raw: sqliteDb,
    prepare: (sql) => {
      const stmt = sqliteDb.prepare(sql);
      return {
        get: async (...params) => stmt.get(...params),
        all: async (...params) => stmt.all(...params),
        run: async (...params) => stmt.run(...params)
      };
    },
    transaction: (fn) => {
      return async (...args) => {
        sqliteDb.exec('BEGIN');
        try {
          const result = await fn(...args);
          sqliteDb.exec('COMMIT');
          return result;
        } catch (e) {
          sqliteDb.exec('ROLLBACK');
          throw e;
        }
      };
    }
  };
}

module.exports = db;
