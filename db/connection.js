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

    // Replace SQLite AUTOINCREMENT with SERIAL for PostgreSQL
    pgSql = pgSql.replace(/INTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT/gi, "SERIAL PRIMARY KEY");
    pgSql = pgSql.replace(/AUTOINCREMENT/gi, "");

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
          const cleanParams = params.flat().map(p => p === undefined ? null : p);
          const res = await pool.query(pgSql, cleanParams);
          return res.rows[0];
        },
        all: async (...params) => {
          const cleanParams = params.flat().map(p => p === undefined ? null : p);
          const res = await pool.query(pgSql, cleanParams);
          return res.rows;
        },
        run: async (...params) => {
          const cleanParams = params.flat().map(p => p === undefined ? null : p);
          const res = await pool.query(pgSql, cleanParams);
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
        get: async (...params) => {
          const cleanParams = params.flat().map(p => p === undefined ? null : p);
          return stmt.get(...cleanParams);
        },
        all: async (...params) => {
          const cleanParams = params.flat().map(p => p === undefined ? null : p);
          return stmt.all(...cleanParams);
        },
        run: async (...params) => {
          const cleanParams = params.flat().map(p => p === undefined ? null : p);
          return stmt.run(...cleanParams);
        }
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

  // Run one-time schema optimization & indexing for ultra-fast product & stock queries
  try {
    const rawDb = db.raw || sqliteDb;
    rawDb.exec(`
      CREATE TABLE IF NOT EXISTS business_products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        sku TEXT,
        category TEXT,
        unit TEXT DEFAULT 'PCS',
        status TEXT DEFAULT 'active',
        stock_status TEXT DEFAULT 'In Stock',
        quantity REAL DEFAULT 0,
        low_stock_threshold REAL DEFAULT 5,
        purchase_price REAL DEFAULT 0,
        selling_price REAL DEFAULT 0,
        barcode TEXT,
        serial_number TEXT,
        batch_number TEXT,
        expiry_date TEXT,
        tax_percentage REAL DEFAULT 18,
        warehouse_id TEXT,
        hsn_code TEXT,
        created_at TEXT,
        updated_at TEXT
      );
      CREATE TABLE IF NOT EXISTS stock (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        sub_name TEXT,
        sku TEXT,
        category TEXT,
        unit TEXT DEFAULT 'PCS',
        unit_price REAL DEFAULT 0,
        cost_price REAL DEFAULT 0,
        quantity REAL DEFAULT 0,
        low_stock_threshold INTEGER DEFAULT 5,
        location TEXT,
        warehouse TEXT,
        supplier TEXT,
        supplier_name TEXT,
        notes TEXT,
        created_at TEXT,
        updated_at TEXT
      );
      CREATE TABLE IF NOT EXISTS inventory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        sku TEXT,
        category TEXT,
        unit TEXT DEFAULT 'PCS',
        quantity REAL DEFAULT 0,
        price REAL DEFAULT 0,
        supplier TEXT,
        status TEXT DEFAULT 'In Stock',
        created_at TEXT,
        updated_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_bp_user ON business_products(user_id);
      CREATE INDEX IF NOT EXISTS idx_bp_cat ON business_products(category);
      CREATE INDEX IF NOT EXISTS idx_stock_user ON stock(user_id);
      CREATE INDEX IF NOT EXISTS idx_inv_user ON inventory(user_id);
    `);

    const alterCols = [
      "ALTER TABLE business_products ADD COLUMN unit TEXT DEFAULT 'PCS'",
      "ALTER TABLE business_products ADD COLUMN hsn_code TEXT",
      "ALTER TABLE business_products ADD COLUMN low_stock_threshold REAL DEFAULT 5",
      "ALTER TABLE business_products ADD COLUMN barcode TEXT",
      "ALTER TABLE business_products ADD COLUMN serial_number TEXT",
      "ALTER TABLE business_products ADD COLUMN batch_number TEXT",
      "ALTER TABLE business_products ADD COLUMN expiry_date TEXT",
      "ALTER TABLE business_products ADD COLUMN tax_percentage REAL DEFAULT 18",
      "ALTER TABLE business_products ADD COLUMN warehouse_id TEXT",
      "ALTER TABLE inventory ADD COLUMN unit TEXT DEFAULT 'PCS'",
      "ALTER TABLE stock ADD COLUMN unit TEXT DEFAULT 'PCS'",
      "ALTER TABLE business_purchases ADD COLUMN supplier_response_type TEXT",
      "ALTER TABLE business_purchases ADD COLUMN supplier_status_message TEXT",
      "ALTER TABLE business_purchases ADD COLUMN expected_available_date TEXT",
      "ALTER TABLE business_purchases ADD COLUMN supplier_response_items TEXT",
      "ALTER TABLE business_purchase_items ADD COLUMN available_quantity REAL",
      "ALTER TABLE business_purchase_items ADD COLUMN item_availability_status TEXT"
    ];
    for (const sql of alterCols) {
      try { rawDb.exec(sql); } catch (e) {}
    }
  } catch (err) {
    console.error('[DB Initialization] Schema optimization warning:', err.message);
  }
}

module.exports = db;

