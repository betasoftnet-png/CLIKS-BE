const db = require('./connection');
const dbType = process.env.DB_TYPE || 'sqlite';

async function runMigrations() {
  let sql = `
-- Users
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT DEFAULT 'user',
  business_name TEXT,
  business_type TEXT,
  industry TEXT,
  refresh_token TEXT,
  widgets TEXT, -- Added to persist dashboard configuration
  created_at TEXT,
  updated_at TEXT
);

-- Accounts
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  type TEXT,
  balance REAL DEFAULT 0,
  currency TEXT DEFAULT 'INR',
  color TEXT,
  icon TEXT,
  notes TEXT,
  created_at TEXT,
  updated_at TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

-- Transactions: type restricted to income / expense / transfer
CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  account_id INTEGER,
  type TEXT CHECK(type IN ('income','expense','transfer')),
  amount REAL NOT NULL,
  category TEXT,
  description TEXT,
  date TEXT,
  created_at TEXT,
  updated_at TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

-- Income
CREATE TABLE IF NOT EXISTS income (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  account_id INTEGER,
  source TEXT,
  amount REAL NOT NULL,
  frequency TEXT DEFAULT 'one-time',
  category TEXT,
  date TEXT,
  notes TEXT,
  created_at TEXT,
  updated_at TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

-- Expenses
CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  account_id INTEGER,
  category TEXT,
  amount REAL NOT NULL,
  description TEXT,
  date TEXT,
  is_recurring INTEGER DEFAULT 0,
  notes TEXT,
  created_at TEXT,
  updated_at TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

-- Budgets
CREATE TABLE IF NOT EXISTS budgets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  category TEXT,
  amount_limit REAL,
  amount_spent REAL DEFAULT 0,
  period TEXT DEFAULT 'monthly',
  start_date TEXT,
  end_date TEXT,
  created_at TEXT,
  updated_at TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

-- Savings
CREATE TABLE IF NOT EXISTS savings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  target_amount REAL,
  current_amount REAL DEFAULT 0,
  deadline TEXT,
  notes TEXT,
  created_at TEXT,
  updated_at TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

-- Investments
CREATE TABLE IF NOT EXISTS investments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  type TEXT,
  amount_invested REAL,
  current_value REAL,
  purchase_date TEXT,
  notes TEXT,
  created_at TEXT,
  updated_at TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

-- Debts (creditor = person/institution owed to)
CREATE TABLE IF NOT EXISTS debts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  creditor TEXT NOT NULL,
  creditor_name TEXT,
  amount REAL NOT NULL,
  amount_paid REAL DEFAULT 0,
  due_date TEXT,
  interest_rate REAL,
  notes TEXT,
  created_at TEXT,
  updated_at TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

-- Planned Payments
CREATE TABLE IF NOT EXISTS planned_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  account_id INTEGER,
  name TEXT NOT NULL,
  description TEXT,
  amount REAL,
  due_date TEXT,
  frequency TEXT,
  category TEXT,
  status TEXT DEFAULT 'pending',
  created_at TEXT,
  updated_at TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

-- Stock / Books Inventory
CREATE TABLE IF NOT EXISTS stock (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  sku TEXT,
  quantity REAL DEFAULT 0,
  unit TEXT,
  unit_price REAL,
  category TEXT,
  location TEXT,
  notes TEXT,
  created_at TEXT,
  updated_at TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

-- Stock Transactions
CREATE TABLE IF NOT EXISTS stock_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stock_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  type TEXT CHECK(type IN ('in','out')),
  quantity REAL NOT NULL,
  date TEXT,
  created_at TEXT,
  FOREIGN KEY(stock_id) REFERENCES stock(id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

-- Financial Plans
CREATE TABLE IF NOT EXISTS financial_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  start_date TEXT,
  end_date TEXT,
  status TEXT DEFAULT 'draft',
  created_at TEXT,
  updated_at TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

-- Plan Budgets
CREATE TABLE IF NOT EXISTS plan_budgets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  category TEXT,
  allocated_amount REAL,
  spent_amount REAL DEFAULT 0,
  notes TEXT,
  created_at TEXT,
  updated_at TEXT,
  FOREIGN KEY(plan_id) REFERENCES financial_plans(id)
);

-- Plan Income
CREATE TABLE IF NOT EXISTS plan_income (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  category TEXT,
  source TEXT,
  expected_amount REAL,
  actual_amount REAL,
  date TEXT,
  notes TEXT,
  created_at TEXT,
  updated_at TEXT,
  FOREIGN KEY(plan_id) REFERENCES financial_plans(id)
);

-- Plan Expenses
CREATE TABLE IF NOT EXISTS plan_expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  category TEXT,
  description TEXT,
  expected_amount REAL,
  actual_amount REAL,
  date TEXT,
  notes TEXT,
  created_at TEXT,
  updated_at TEXT,
  FOREIGN KEY(plan_id) REFERENCES financial_plans(id)
);

-- Plan Goals (uses 'title' as the name column, 'name' as alias column — both supported via route)
CREATE TABLE IF NOT EXISTS plan_goals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  name TEXT,
  description TEXT,
  target_amount REAL,
  current_amount REAL DEFAULT 0,
  deadline TEXT,
  status TEXT DEFAULT 'in_progress',
  notes TEXT,
  created_at TEXT,
  updated_at TEXT,
  FOREIGN KEY(plan_id) REFERENCES financial_plans(id)
);

-- Plan Reminders
CREATE TABLE IF NOT EXISTS plan_reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  message TEXT,
  due_date TEXT,
  remind_at TEXT,
  status TEXT DEFAULT 'pending',
  is_sent INTEGER DEFAULT 0,
  type TEXT,
  created_at TEXT,
  updated_at TEXT,
  FOREIGN KEY(plan_id) REFERENCES financial_plans(id)
);

-- People
CREATE TABLE IF NOT EXISTS people (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  role_type TEXT,
  relationship TEXT,
  phone TEXT,
  email TEXT,
  company TEXT,
  contact_info TEXT,
  notes TEXT,
  created_at TEXT,
  updated_at TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

-- People Transactions
CREATE TABLE IF NOT EXISTS people_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  type TEXT CHECK(type IN ('lent','borrowed','settled')),
  amount REAL,
  description TEXT,
  category TEXT,
  date TEXT,
  status TEXT DEFAULT 'pending',
  created_at TEXT,
  updated_at TEXT,
  FOREIGN KEY(person_id) REFERENCES people(id)
);

-- People Reminders
CREATE TABLE IF NOT EXISTS people_reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  title TEXT,
  message TEXT,
  due_date TEXT,
  remind_at TEXT,
  is_sent INTEGER DEFAULT 0,
  status TEXT DEFAULT 'pending',
  created_at TEXT,
  updated_at TEXT,
  FOREIGN KEY(person_id) REFERENCES people(id)
);

-- People Records
CREATE TABLE IF NOT EXISTS people_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  title TEXT,
  type TEXT,
  description TEXT,
  content TEXT,
  date TEXT,
  created_at TEXT,
  updated_at TEXT,
  FOREIGN KEY(person_id) REFERENCES people(id)
);

-- Contacts (no 'group' column — uses 'type' for categorisation)
CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  type TEXT DEFAULT 'other',
  phone TEXT,
  email TEXT,
  company TEXT,
  address TEXT,
  notes TEXT,
  created_at TEXT,
  updated_at TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

-- Segregation Rules
CREATE TABLE IF NOT EXISTS segregation (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT,
  rule_type TEXT,
  category TEXT,
  label TEXT,
  description TEXT,
  allocated_percentage REAL,
  allocated_amount REAL,
  notes TEXT,
  created_at TEXT,
  updated_at TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

-- Segregation Allocations (child rows for each rule)
CREATE TABLE IF NOT EXISTS segregation_allocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  label TEXT,
  percentage REAL,
  notes TEXT,
  created_at TEXT,
  updated_at TEXT,
  FOREIGN KEY(rule_id) REFERENCES segregation(id)
);

-- Split Expenses
CREATE TABLE IF NOT EXISTS split_expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  total_amount REAL,
  date TEXT,
  split_type TEXT,
  paid_by TEXT,
  notes TEXT,
  created_at TEXT,
  updated_at TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

-- Split Participants
CREATE TABLE IF NOT EXISTS split_participants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  split_expense_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  share_amount REAL,
  is_settled INTEGER DEFAULT 0,
  created_at TEXT,
  updated_at TEXT,
  FOREIGN KEY(split_expense_id) REFERENCES split_expenses(id)
);

-- Public Posts
CREATE TABLE IF NOT EXISTS public_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  content TEXT NOT NULL,
  type TEXT DEFAULT 'update',
  likes INTEGER DEFAULT 0,
  created_at TEXT,
  updated_at TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

-- Refresh Tokens
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  token TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

-- Goal Wallets (Personal Purpose Wallet)
CREATE TABLE IF NOT EXISTS goal_wallets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  target_amount REAL NOT NULL,
  current_amount REAL DEFAULT 0,
  status TEXT DEFAULT 'active', -- active | completed
  person_id INTEGER, -- Optional link to a person
  created_at TEXT,
  updated_at TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id),
  FOREIGN KEY(person_id) REFERENCES people(id)
);

-- Wallet Transactions (History of money added)
CREATE TABLE IF NOT EXISTS wallet_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wallet_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  amount REAL NOT NULL,
  type TEXT DEFAULT 'credit',
  created_at TEXT,
  FOREIGN KEY(wallet_id) REFERENCES goal_wallets(id),
  FOREIGN KEY(user_id) REFERENCES users(id)
);

-- Meetups Table
CREATE TABLE IF NOT EXISTS meetups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  type TEXT DEFAULT 'Offline',
  date TEXT,
  time TEXT,
  location TEXT,
  price TEXT DEFAULT 'Free',
  description TEXT,
  category TEXT DEFAULT 'General',
  image_url TEXT,
  icon TEXT DEFAULT 'Users',
  gradient TEXT DEFAULT 'linear-gradient(135deg, #1B6B3A 0%, #22C55E 100%)',
  attendees INTEGER DEFAULT 1,
  created_at TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

-- Inventory
CREATE TABLE IF NOT EXISTS inventory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  sku TEXT,
  category TEXT,
  quantity INTEGER DEFAULT 0,
  price REAL DEFAULT 0,
  supplier TEXT,
  status TEXT DEFAULT 'In Stock',
  created_at TEXT,
  updated_at TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

-- Business Invoices
CREATE TABLE IF NOT EXISTS business_invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  invoice_number TEXT NOT NULL,
  client_name TEXT NOT NULL,
  client_email TEXT,
  amount REAL DEFAULT 0,
  status TEXT DEFAULT 'Draft',
  due_date TEXT,
  items TEXT, -- JSON string
  created_at TEXT,
  updated_at TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id)
);
  `;

  if (dbType === 'postgres') {
    sql = sql.replace(/INTEGER PRIMARY KEY AUTOINCREMENT/g, 'SERIAL PRIMARY KEY');
    sql = sql.replace(/REAL/g, 'NUMERIC');
    
    // Split the statements so we can execute them if needed, or send as one block
    await db.pool.query(sql);

    // Ensure columns are updated
    const pgAlters = [
      'ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT DEFAULT \'user\';',
      'ALTER TABLE users ADD COLUMN IF NOT EXISTS refresh_token TEXT;',
      'ALTER TABLE users ADD COLUMN IF NOT EXISTS widgets TEXT;',
      'ALTER TABLE users ADD COLUMN IF NOT EXISTS business_name TEXT;',
      'ALTER TABLE users ADD COLUMN IF NOT EXISTS business_type TEXT;',
      'ALTER TABLE users ADD COLUMN IF NOT EXISTS industry TEXT;',
      'ALTER TABLE users ADD COLUMN IF NOT EXISTS settings TEXT;',
      'ALTER TABLE stock ADD COLUMN IF NOT EXISTS unit TEXT;',
      'ALTER TABLE people_records ADD COLUMN IF NOT EXISTS type TEXT;',
      'ALTER TABLE people_records ADD COLUMN IF NOT EXISTS description TEXT;',
      'ALTER TABLE people ADD COLUMN IF NOT EXISTS relationship TEXT;',
      'ALTER TABLE people ADD COLUMN IF NOT EXISTS phone TEXT;',
      'ALTER TABLE people ADD COLUMN IF NOT EXISTS email TEXT;',
      'ALTER TABLE people_records ADD COLUMN IF NOT EXISTS attachment_url TEXT;',
      'ALTER TABLE people_records ADD COLUMN IF NOT EXISTS file_type TEXT;',
      'ALTER TABLE plan_income ADD COLUMN IF NOT EXISTS category TEXT;',
      'ALTER TABLE plan_expenses ADD COLUMN IF NOT EXISTS description TEXT;',
      'ALTER TABLE meetups ADD COLUMN IF NOT EXISTS description TEXT;',
      'ALTER TABLE meetups ADD COLUMN IF NOT EXISTS category TEXT DEFAULT \'General\';',
      'ALTER TABLE meetups ADD COLUMN IF NOT EXISTS image_url TEXT;',
      `CREATE TABLE IF NOT EXISTS inventory (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        name VARCHAR(255) NOT NULL,
        sku VARCHAR(100),
        category VARCHAR(100),
        quantity INTEGER DEFAULT 0,
        price NUMERIC DEFAULT 0,
        supplier VARCHAR(255),
        status VARCHAR(50) DEFAULT 'In Stock',
        created_at TEXT,
        updated_at TEXT,
        FOREIGN KEY(user_id) REFERENCES users(id)
      );`,
      `CREATE TABLE IF NOT EXISTS business_invoices (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        invoice_number VARCHAR(100) NOT NULL,
        client_name VARCHAR(255) NOT NULL,
        client_email VARCHAR(255),
        amount NUMERIC DEFAULT 0,
        status VARCHAR(50) DEFAULT 'Draft',
        due_date TEXT,
        items TEXT,
        created_at TEXT,
        updated_at TEXT,
        FOREIGN KEY(user_id) REFERENCES users(id)
      );`
    ];
    try {
      for (const q of pgAlters) await db.pool.query(q);
      console.log('✅ Updated all table columns (PostgreSQL)');
    } catch (e) {
      console.warn('⚠️ Could not alter tables:', e.message);
    }

  } else {
    // SQLite execution
    db.raw.exec(sql);
    
    const alterQueries = [
      'ALTER TABLE users ADD COLUMN role TEXT DEFAULT \'user\'',
      'ALTER TABLE users ADD COLUMN refresh_token TEXT',
      'ALTER TABLE users ADD COLUMN widgets TEXT',
      'ALTER TABLE users ADD COLUMN settings TEXT',
      'ALTER TABLE stock ADD COLUMN unit TEXT',
      'ALTER TABLE people_records ADD COLUMN type TEXT',
      'ALTER TABLE people_records ADD COLUMN description TEXT',
      'ALTER TABLE people ADD COLUMN relationship TEXT',
      'ALTER TABLE people ADD COLUMN phone TEXT',
      'ALTER TABLE people ADD COLUMN email TEXT',
      'ALTER TABLE split_expenses ADD COLUMN paid_by TEXT',
      'ALTER TABLE goal_wallets ADD COLUMN person_id INTEGER',
      'ALTER TABLE people_records ADD COLUMN IF NOT EXISTS attachment_url TEXT',
      'ALTER TABLE people_records ADD COLUMN IF NOT EXISTS file_type TEXT',
      'ALTER TABLE plan_income ADD COLUMN category TEXT',
      'ALTER TABLE plan_expenses ADD COLUMN description TEXT',
      'ALTER TABLE meetups ADD COLUMN description TEXT',
      'ALTER TABLE meetups ADD COLUMN category TEXT DEFAULT \'General\'',
      'ALTER TABLE meetups ADD COLUMN image_url TEXT'
    ];

    alterQueries.forEach(query => {
      try {
        db.raw.exec(query);
      } catch (e) {
        if (!e.message.includes('duplicate column name')) {
          console.warn(`⚠️ Could not execute query "${query}":`, e.message);
        }
      }
    });
    console.log('✅ Verified/Updated table columns in SQLite');
  }

  console.log('✅ Migrations applied');
}

module.exports = { runMigrations };
