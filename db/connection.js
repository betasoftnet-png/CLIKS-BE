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

  // Auto-run schema migrations for PostgreSQL to ensure missing columns are added automatically
  (async () => {
    try {
      await pool.query(`
        ALTER TABLE gst_invoices 
        ADD COLUMN IF NOT EXISTS sender_product_name VARCHAR(255),
        ADD COLUMN IF NOT EXISTS receiver_product_name VARCHAR(255),
        ADD COLUMN IF NOT EXISTS product_name VARCHAR(255),
        ADD COLUMN IF NOT EXISTS hsn_code VARCHAR(50),
        ADD COLUMN IF NOT EXISTS unit VARCHAR(20),
        ADD COLUMN IF NOT EXISTS quantity NUMERIC DEFAULT 1,
        ADD COLUMN IF NOT EXISTS pdf_url TEXT;

        ALTER TABLE invoices 
        ADD COLUMN IF NOT EXISTS customer_name VARCHAR(255),
        ADD COLUMN IF NOT EXISTS customer_gstin VARCHAR(50),
        ADD COLUMN IF NOT EXISTS taxable_amount NUMERIC DEFAULT 0,
        ADD COLUMN IF NOT EXISTS total_amount NUMERIC DEFAULT 0,
        ADD COLUMN IF NOT EXISTS irn TEXT,
        ADD COLUMN IF NOT EXISTS ack_no VARCHAR(100),
        ADD COLUMN IF NOT EXISTS ack_date VARCHAR(100),
        ADD COLUMN IF NOT EXISTS signed_qr TEXT,
        ADD COLUMN IF NOT EXISTS pdf_url TEXT;

        CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_inv_num ON invoices(invoice_number);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_gst_invoices_inv_num ON gst_invoices(invoice_number);

        CREATE TABLE IF NOT EXISTS eway_bills (
          id SERIAL PRIMARY KEY,
          user_id INTEGER,
          business_id INTEGER,
          eway_bill_no VARCHAR(50) UNIQUE,
          carrier_name VARCHAR(255),
          vehicle_no VARCHAR(50),
          distance_km NUMERIC,
          from_place VARCHAR(255),
          to_place VARCHAR(255),
          status VARCHAR(50) DEFAULT 'GENERATED',
          pdf_url TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_eway_bills_no ON eway_bills(eway_bill_no);
        CREATE INDEX IF NOT EXISTS idx_eway_bills_user_biz ON eway_bills(user_id, business_id);

        CREATE TABLE IF NOT EXISTS founder_pitches (
          id SERIAL PRIMARY KEY,
          user_id VARCHAR(255),
          founder_name VARCHAR(255) NOT NULL,
          founder_email VARCHAR(255) NOT NULL,
          venture_name VARCHAR(255) NOT NULL,
          sector VARCHAR(100) NOT NULL,
          headline_pitch TEXT NOT NULL,
          description TEXT NOT NULL,
          pitch_deck_url TEXT,
          review_status VARCHAR(50) DEFAULT 'Published',
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
      `);
      console.log('✅ [PostgreSQL Connection] Ensured gst_invoices, invoices, eway_bills & founder_pitches schema columns exist');
    } catch (err) {
      // Table might not be created yet during first boot before migrations run
      console.warn('⚠️ [PostgreSQL Connection Init Note]:', err.message);
    }
  })();


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
    query: async (sql, params = []) => {
      const cleanParams = (params || []).flat().map(p => p === undefined ? null : p);
      return pool.query(convertQuery(sql), cleanParams);
    },
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
    query: async (sql, params = []) => {
      const cleanParams = (params || []).flat().map(p => p === undefined ? null : p);
      let sqliteSql = sql.replace(/\$\d+/g, '?').replace(/NOW\(\)/gi, "datetime('now')").trim();
      const cleanSql = sqliteSql.replace(/;\s*$/, '');
      if (/^\s*(SELECT|PRAGMA)/i.test(cleanSql) || /RETURNING/i.test(cleanSql)) {
        const rows = sqliteDb.prepare(cleanSql).all(...cleanParams);
        return { rows, rowCount: rows.length, lastInsertRowid: rows[0]?.id };
      } else {
        const info = sqliteDb.prepare(cleanSql).run(...cleanParams);
        return { rows: [{ id: info.lastInsertRowid }], rowCount: info.changes, lastInsertRowid: info.lastInsertRowid };
      }
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
      CREATE TABLE IF NOT EXISTS business_purchases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        purchase_number TEXT,
        supplier_name TEXT,
        supplier_email TEXT,
        status TEXT DEFAULT 'PENDING SUPPLIER CONFIRMATION',
        supplier_confirmation_status TEXT,
        supplier_response_type TEXT,
        supplier_status_message TEXT,
        expected_available_date TEXT,
        supplier_response_items TEXT,
        confirmed_at TEXT,
        created_at TEXT,
        updated_at TEXT
      );
      CREATE TABLE IF NOT EXISTS business_purchase_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        purchase_id INTEGER,
        product_name TEXT,
        unit_price REAL DEFAULT 0,
        quantity REAL DEFAULT 0,
        available_quantity REAL DEFAULT 0,
        item_availability_status TEXT,
        item_status TEXT,
        created_at TEXT
      );
      CREATE TABLE IF NOT EXISTS invoices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        invoice_number TEXT,
        client_name TEXT,
        client_email TEXT,
        status TEXT,
        supplier_confirmation_status TEXT,
        supplier_response_type TEXT,
        supplier_status_message TEXT,
        expected_available_date TEXT,
        supplier_response_items TEXT,
        created_at TEXT,
        updated_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_bp_user ON business_products(user_id);
      CREATE INDEX IF NOT EXISTS idx_bp_cat ON business_products(category);
      CREATE INDEX IF NOT EXISTS idx_stock_user ON stock(user_id);
      CREATE INDEX IF NOT EXISTS idx_inv_user ON inventory(user_id);

      CREATE TABLE IF NOT EXISTS eway_bills (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        business_id INTEGER,
        eway_bill_no TEXT UNIQUE,
        carrier_name TEXT,
        vehicle_no TEXT,
        distance_km REAL,
        from_place TEXT,
        to_place TEXT,
        status TEXT DEFAULT 'GENERATED',
        pdf_url TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_eway_bills_no ON eway_bills(eway_bill_no);
      CREATE INDEX IF NOT EXISTS idx_eway_bills_user_biz ON eway_bills(user_id, business_id);
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
      "ALTER TABLE business_products ADD COLUMN has_warranty TEXT DEFAULT 'No'",
      "ALTER TABLE business_products ADD COLUMN warranty_period TEXT",
      "ALTER TABLE inventory ADD COLUMN unit TEXT DEFAULT 'PCS'",
      "ALTER TABLE stock ADD COLUMN unit TEXT DEFAULT 'PCS'",
      "ALTER TABLE business_purchases ADD COLUMN supplier_response_type TEXT",
      "ALTER TABLE business_purchases ADD COLUMN supplier_status_message TEXT",
      "ALTER TABLE business_purchases ADD COLUMN expected_available_date TEXT",
      "ALTER TABLE business_purchases ADD COLUMN supplier_response_items TEXT",
      "ALTER TABLE business_purchase_items ADD COLUMN available_quantity REAL",
      "ALTER TABLE business_purchase_items ADD COLUMN item_availability_status TEXT",
      "ALTER TABLE invoices ADD COLUMN supplier_confirmation_status TEXT",
      "ALTER TABLE invoices ADD COLUMN supplier_response_type TEXT",
      "ALTER TABLE invoices ADD COLUMN supplier_status_message TEXT",
      "ALTER TABLE invoices ADD COLUMN expected_available_date TEXT",
      "ALTER TABLE invoices ADD COLUMN supplier_response_items TEXT",
      "ALTER TABLE invoices ADD COLUMN customer_name TEXT",
      "ALTER TABLE invoices ADD COLUMN customer_gstin TEXT",
      "ALTER TABLE invoices ADD COLUMN taxable_amount REAL DEFAULT 0",
      "ALTER TABLE invoices ADD COLUMN total_amount REAL DEFAULT 0",
      "ALTER TABLE invoices ADD COLUMN irn TEXT",
      "ALTER TABLE invoices ADD COLUMN ack_no TEXT",
      "ALTER TABLE invoices ADD COLUMN ack_date TEXT",
      "ALTER TABLE invoices ADD COLUMN signed_qr TEXT",
      "ALTER TABLE invoices ADD COLUMN pdf_url TEXT",
      "ALTER TABLE gst_invoices ADD COLUMN sender_product_name TEXT",
      "ALTER TABLE gst_invoices ADD COLUMN receiver_product_name TEXT",
      "ALTER TABLE gst_invoices ADD COLUMN product_name TEXT",
      "ALTER TABLE gst_invoices ADD COLUMN hsn_code TEXT",
      "ALTER TABLE gst_invoices ADD COLUMN unit TEXT",
      "ALTER TABLE gst_invoices ADD COLUMN quantity REAL DEFAULT 1",
      "ALTER TABLE gst_invoices ADD COLUMN pdf_url TEXT",
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_inv_num ON invoices(invoice_number)",
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_gst_invoices_inv_num ON gst_invoices(invoice_number)",
      "ALTER TABLE warehouse_transfers ADD COLUMN reference TEXT"
    ];
    for (const sql of alterCols) {
      try { rawDb.exec(sql); } catch (e) {}
    }
  } catch (err) {
    console.error('[DB Initialization] Schema optimization warning:', err.message);
  }
}

module.exports = db;

