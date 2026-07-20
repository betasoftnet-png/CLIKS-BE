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
  tier TEXT DEFAULT 'Free Plan',
  subscription_days_remaining INTEGER DEFAULT 0,
  primary_income_source TEXT, -- Rental | Pension | Salaried | Business | Freelancer
  global_budget REAL DEFAULT 20000,
  created_at TEXT,
  updated_at TEXT
);

-- Financial Goals
CREATE TABLE IF NOT EXISTS financial_goals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  target_amount REAL NOT NULL,
  current_savings REAL DEFAULT 0,
  target_date TEXT,
  category TEXT, -- Emergency Fund, Retirement, etc.
  status TEXT DEFAULT 'in_progress',
  created_at TEXT,
  updated_at TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

-- Salary Records
CREATE TABLE IF NOT EXISTS salary_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  company_name TEXT,
  employee_id TEXT,
  salary_date TEXT,
  basic_salary REAL DEFAULT 0,
  hra REAL DEFAULT 0,
  da REAL DEFAULT 0,
  bonus REAL DEFAULT 0,
  other_allowances REAL DEFAULT 0,
  gross_salary REAL DEFAULT 0,
  net_salary REAL DEFAULT 0,
  salary_slip_url TEXT,
  wallet_id INTEGER,
  created_at TEXT,
  updated_at TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

-- Property Records
CREATE TABLE IF NOT EXISTS property_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  property_name TEXT NOT NULL,
  address TEXT,
  tenant_name TEXT,
  monthly_rent REAL DEFAULT 0,
  security_deposit REAL DEFAULT 0,
  due_date INTEGER, -- Day of month
  last_received_date TEXT,
  maintenance_cost REAL DEFAULT 0,
  property_tax REAL DEFAULT 0,
  occupancy_status TEXT DEFAULT 'Occupied',
  wallet_id INTEGER,
  created_at TEXT,
  updated_at TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

-- Pension Records
CREATE TABLE IF NOT EXISTS pension_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  provider TEXT,
  pension_number TEXT,
  monthly_amount REAL DEFAULT 0,
  payment_date TEXT,
  is_family_pension INTEGER DEFAULT 0,
  pension_type TEXT,
  wallet_id INTEGER,
  created_at TEXT,
  updated_at TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

-- Tax Records
CREATE TABLE IF NOT EXISTS tax_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  tax_year TEXT,
  income_tax REAL DEFAULT 0,
  tds_paid REAL DEFAULT 0,
  epf REAL DEFAULT 0,
  esi REAL DEFAULT 0,
  prof_tax REAL DEFAULT 0,
  advance_tax REAL DEFAULT 0,
  tax_savings REAL DEFAULT 0,
  notes TEXT,
  created_at TEXT,
  updated_at TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

-- Notifications
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  title TEXT,
  message TEXT,
  type TEXT, -- Alert | Info | Success
  is_read INTEGER DEFAULT 0,
  link TEXT,
  created_at TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

-- Finance Reports
CREATE TABLE IF NOT EXISTS finance_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  report_name TEXT,
  report_type TEXT, -- Monthly | Annual | Tax | etc.
  file_url TEXT,
  period TEXT,
  created_at TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id)
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
  name TEXT,
  time TEXT,
  schedule TEXT,
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
  type TEXT,
  person_id INTEGER,
  created_at TEXT,
  updated_at TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

-- Stock / Books Inventory
CREATE TABLE IF NOT EXISTS stock (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  sub_name TEXT,
  sku TEXT,
  quantity REAL DEFAULT 0,
  unit TEXT,
  unit_price REAL,
  category TEXT,
  location TEXT,
  notes TEXT,
  low_stock_threshold INTEGER DEFAULT 5,
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
  amount REAL,
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

-- Split Tickets
CREATE TABLE IF NOT EXISTS split_tickets (
  id VARCHAR(255) PRIMARY KEY,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  currency TEXT,
  currency_symbol TEXT,
  description TEXT,
  participants TEXT,
  created_at TEXT,
  updated_at TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

-- Split Ticket Expenses
CREATE TABLE IF NOT EXISTS split_ticket_expenses (
  id VARCHAR(255) PRIMARY KEY,
  split_ticket_id VARCHAR(255) NOT NULL,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  amount REAL,
  paid_by TEXT,
  date TEXT,
  attachment TEXT,
  split_type TEXT,
  shares TEXT,
  created_at TEXT,
  updated_at TEXT,
  FOREIGN KEY(split_ticket_id) REFERENCES split_tickets(id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES users(id)
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
  max_seats INTEGER DEFAULT 100,
  created_at TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

-- Meetup Registrations (Tracks seat bookings to prevent dupes)
CREATE TABLE IF NOT EXISTS meetup_registrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meetup_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  created_at TEXT,
  UNIQUE(meetup_id, user_id),
  FOREIGN KEY(meetup_id) REFERENCES meetups(id),
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
  client_gstin TEXT,
  billing_address TEXT,
  shipping_address TEXT,
  amount REAL DEFAULT 0,
  tax_amount REAL DEFAULT 0,
  total_amount REAL DEFAULT 0,
  paid_amount REAL DEFAULT 0,
  due_amount REAL DEFAULT 0,
  bank_account_id TEXT,
  discount_amount REAL DEFAULT 0,
  round_off REAL DEFAULT 0,
  status TEXT DEFAULT 'Draft',
  due_date TEXT,
  payment_mode TEXT,
  invoice_type TEXT,
  tax_type TEXT,
  items TEXT, -- JSON string
  created_at TEXT,
  updated_at TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

-- Business Customers
CREATE TABLE IF NOT EXISTS business_customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  company TEXT,
  status TEXT DEFAULT 'lead',
  notes TEXT,
  city TEXT,
  outstanding_balance REAL DEFAULT 0,
  total_spent REAL DEFAULT 0,
  loyalty_points INTEGER DEFAULT 0,
  created_at TEXT,
  updated_at TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

-- Customer Addresses
CREATE TABLE IF NOT EXISTS customer_addresses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  address_line1 TEXT,
  address_line2 TEXT,
  city TEXT,
  state TEXT,
  postal_code TEXT,
  country TEXT,
  created_at TEXT,
  FOREIGN KEY(customer_id) REFERENCES business_customers(id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

-- Customer Notes
CREATE TABLE IF NOT EXISTS customer_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  note TEXT NOT NULL,
  created_at TEXT,
  FOREIGN KEY(customer_id) REFERENCES business_customers(id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

-- Customer Payments
CREATE TABLE IF NOT EXISTS customer_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  amount REAL DEFAULT 0,
  payment_method TEXT,
  reference_number TEXT,
  created_at TEXT,
  FOREIGN KEY(customer_id) REFERENCES business_customers(id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

-- Customer Ledger
CREATE TABLE IF NOT EXISTS customer_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  description TEXT,
  amount REAL DEFAULT 0,
  type TEXT, -- debit (invoice/charge), credit (payment)
  created_at TEXT,
  FOREIGN KEY(customer_id) REFERENCES business_customers(id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

-- Customer Documents
CREATE TABLE IF NOT EXISTS customer_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  file_name TEXT NOT NULL,
  file_url TEXT,
  file_size TEXT,
  created_at TEXT,
  FOREIGN KEY(customer_id) REFERENCES business_customers(id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

-- Business Employees
CREATE TABLE IF NOT EXISTS business_employees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  role TEXT,
  email TEXT,
  phone TEXT,
  salary REAL DEFAULT 0,
  status TEXT DEFAULT 'active',
  hire_date TEXT,
  created_at TEXT,
  updated_at TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

-- Business Plans
CREATE TABLE IF NOT EXISTS business_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  start_date TEXT,
  end_date TEXT,
  total_budget REAL DEFAULT 0,
  status TEXT DEFAULT 'Draft',
  created_at TEXT,
  updated_at TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

-- Business Plan Items
CREATE TABLE IF NOT EXISTS business_plan_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER NOT NULL,
  type TEXT, -- revenue, expense, capex
  category TEXT,
  description TEXT,
  amount REAL DEFAULT 0,
  date TEXT,
  created_at TEXT,
  FOREIGN KEY(plan_id) REFERENCES business_plans(id) ON DELETE CASCADE
);

-- Employees Table
CREATE TABLE IF NOT EXISTS employees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  role TEXT,
  email TEXT,
  phone TEXT,
  salary REAL DEFAULT 0,
  status TEXT DEFAULT 'active',
  hire_date TEXT,
  created_at TEXT,
  updated_at TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

-- Manufacturing BOM (Bill of Materials)
CREATE TABLE IF NOT EXISTS manufacturing_boms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  items TEXT, -- JSON string of components
  created_at TEXT,
  updated_at TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

-- Manufacturing Orders
CREATE TABLE IF NOT EXISTS manufacturing_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  bom_id INTEGER,
  product_name TEXT NOT NULL,
  quantity INTEGER DEFAULT 1,
  status TEXT DEFAULT 'Pending', -- Pending | In Progress | Completed
  created_at TEXT,
  updated_at TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

-- Payroll Table
CREATE TABLE IF NOT EXISTS payroll (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  employee_id INTEGER NOT NULL,
  amount REAL NOT NULL,
  month TEXT,
  status TEXT DEFAULT 'Pending', -- Pending | Processed
  created_at TEXT,
  updated_at TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id),
  FOREIGN KEY(employee_id) REFERENCES employees(id)
);

-- Attendance Table
CREATE TABLE IF NOT EXISTS attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  employee_id INTEGER,
  date TEXT,
  check_in TEXT,
  check_out TEXT,
  status TEXT DEFAULT 'Present',
  created_at TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

-- GST Invoices
CREATE TABLE IF NOT EXISTS gst_invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  invoice_number TEXT,
  client_name TEXT,
  amount REAL DEFAULT 0,
  gst_amount REAL DEFAULT 0,
  eway_bill_number TEXT,
  invoice_type TEXT,
  place_of_supply TEXT,
  taxable_value REAL DEFAULT 0,
  gst_percentage REAL DEFAULT 0,
  cgst_amount REAL DEFAULT 0,
  sgst_amount REAL DEFAULT 0,
  igst_amount REAL DEFAULT 0,
  total_tax REAL DEFAULT 0,
  reverse_charge TEXT,
  irn_number TEXT,
  qr_status TEXT,
  vendor_gstin TEXT,
  vendor_name TEXT,
  eligible_itc REAL DEFAULT 0,
  invoice_match_status TEXT,
  mismatch_reason TEXT,
  reconciliation_date TEXT,
  transporter_name TEXT,
  vehicle_number TEXT,
  transport_distance INTEGER DEFAULT 0,
  dispatch_location TEXT,
  delivery_location TEXT,
  status TEXT DEFAULT 'Active',
  reference_invoice TEXT,
  is_eway_bill TEXT DEFAULT 'false',
  is_reconciliation TEXT DEFAULT 'false',
  created_at TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

-- Business Payments Table
CREATE TABLE IF NOT EXISTS business_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  type TEXT, -- receive, pay
  supplier_id INTEGER,
  amount REAL DEFAULT 0,
  status TEXT DEFAULT 'Completed',
  created_at TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

-- Calculator History
CREATE TABLE IF NOT EXISTS calculator_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  tape TEXT NOT NULL,
  total REAL NOT NULL,
  timestamp TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

-- Warehouses
CREATE TABLE IF NOT EXISTS warehouses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  location TEXT,
  code TEXT,
  type TEXT,
  status TEXT DEFAULT 'active',
  address TEXT,
  city TEXT,
  state TEXT,
  pincode TEXT,
  contact_person TEXT,
  phone_number TEXT,
  email TEXT,
  capacity_utilization TEXT DEFAULT '0%',
  created_at TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

-- Warehouse Transfers
CREATE TABLE IF NOT EXISTS warehouse_transfers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  from_warehouse_id INTEGER,
  to_warehouse_id INTEGER,
  stock_id INTEGER,
  quantity REAL DEFAULT 0,
  created_at TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

-- Product Returns
CREATE TABLE IF NOT EXISTS product_returns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  product_name TEXT NOT NULL,
  amount REAL DEFAULT 0,
  status TEXT DEFAULT 'Pending', -- Pending | Approved | Refunded
  created_at TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

-- Suppliers Table
CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  outstanding_balance REAL DEFAULT 0,
  created_at TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

-- Supplier Ledger
CREATE TABLE IF NOT EXISTS supplier_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  description TEXT,
  amount REAL DEFAULT 0,
  type TEXT, -- debit, credit
  created_at TEXT,
  FOREIGN KEY(supplier_id) REFERENCES suppliers(id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

-- Business Orders
CREATE TABLE IF NOT EXISTS business_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  customer_id INTEGER,
  order_number TEXT NOT NULL UNIQUE,
  customer TEXT NOT NULL,
  customer_phone TEXT,
  customer_gstin TEXT,
  billing_address TEXT,
  shipping_address TEXT,
  date TEXT,
  delivery_date TEXT,
  status TEXT DEFAULT 'Draft',
  advance_amount REAL DEFAULT 0,
  shipping_charge REAL DEFAULT 0,
  subtotal REAL DEFAULT 0,
  total_discount REAL DEFAULT 0,
  total_tax REAL DEFAULT 0,
  grand_total REAL DEFAULT 0,
  pending_amount REAL DEFAULT 0,
  shipping_method TEXT,
  tracking_number TEXT,
  dispatch_date TEXT,
  created_at TEXT,
  updated_at TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

-- Business Order Items
CREATE TABLE IF NOT EXISTS business_order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  sku TEXT,
  hsn TEXT,
  quantity INTEGER DEFAULT 0,
  price REAL DEFAULT 0,
  discount REAL DEFAULT 0,
  gst INTEGER DEFAULT 0,
  total REAL DEFAULT 0,
  FOREIGN KEY(order_id) REFERENCES business_orders(id) ON DELETE CASCADE
);

-- Business Order Notes
CREATE TABLE IF NOT EXISTS business_order_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  title TEXT,
  content TEXT,
  created_at TEXT,
  FOREIGN KEY(order_id) REFERENCES business_orders(id) ON DELETE CASCADE
);

-- Business Order Documents
CREATE TABLE IF NOT EXISTS business_order_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  name TEXT,
  file_path TEXT,
  created_at TEXT,
  FOREIGN KEY(order_id) REFERENCES business_orders(id) ON DELETE CASCADE
);

-- Business Invoice Payments
CREATE TABLE IF NOT EXISTS business_invoice_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL,
  amount REAL DEFAULT 0,
  payment_method TEXT,
  payment_date TEXT,
  reference_number TEXT,
  notes TEXT,
  FOREIGN KEY(invoice_id) REFERENCES business_invoices(id) ON DELETE CASCADE
);

-- Business Invoice Returns
CREATE TABLE IF NOT EXISTS business_invoice_returns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL,
  reason TEXT,
  amount REAL DEFAULT 0,
  return_date TEXT,
  FOREIGN KEY(invoice_id) REFERENCES business_invoices(id) ON DELETE CASCADE
);

-- Business Invoice Notes
CREATE TABLE IF NOT EXISTS business_invoice_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL,
  title TEXT,
  content TEXT,
  created_at TEXT,
  FOREIGN KEY(invoice_id) REFERENCES business_invoices(id) ON DELETE CASCADE
);

-- Business Invoice Documents
CREATE TABLE IF NOT EXISTS business_invoice_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL,
  name TEXT,
  file_path TEXT,
  created_at TEXT,
  FOREIGN KEY(invoice_id) REFERENCES business_invoices(id) ON DELETE CASCADE
);

-- Business Returns
CREATE TABLE IF NOT EXISTS business_returns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  return_number TEXT NOT NULL,
  return_type TEXT NOT NULL, -- sales, purchase
  return_date TEXT NOT NULL,
  status TEXT DEFAULT 'Pending', -- Pending, Completed
  invoice_id TEXT,
  purchase_id TEXT,
  customer_name TEXT,
  supplier_name TEXT,
  refund_amount REAL DEFAULT 0,
  adjustment_amount REAL DEFAULT 0,
  tax_adjustment REAL DEFAULT 0,
  refund_mode TEXT,
  refund_status TEXT DEFAULT 'pending',
  refund_date TEXT,
  refund_reference TEXT,
  reason_code TEXT,
  inspection_status TEXT DEFAULT 'Pending Check',
  warehouse_id TEXT,
  created_at TEXT,
  updated_at TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

-- Business Return Items
CREATE TABLE IF NOT EXISTS business_return_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  return_id INTEGER NOT NULL,
  product_id TEXT,
  product_name TEXT NOT NULL,
  batch_number TEXT,
  serial_number TEXT,
  return_quantity INTEGER DEFAULT 1,
  replacement_quantity INTEGER DEFAULT 0,
  price REAL DEFAULT 0,
  gst_percentage REAL DEFAULT 18,
  tax_amount REAL DEFAULT 0,
  total REAL DEFAULT 0,
  FOREIGN KEY(return_id) REFERENCES business_returns(id) ON DELETE CASCADE
);

-- Business Return Notes
CREATE TABLE IF NOT EXISTS business_return_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  return_id INTEGER NOT NULL,
  title TEXT,
  content TEXT,
  created_at TEXT,
  FOREIGN KEY(return_id) REFERENCES business_returns(id) ON DELETE CASCADE
);

-- Business Return Documents
CREATE TABLE IF NOT EXISTS business_return_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  return_id INTEGER NOT NULL,
  name TEXT,
  file_path TEXT,
  created_at TEXT,
  FOREIGN KEY(return_id) REFERENCES business_returns(id) ON DELETE CASCADE
);

-- Business Purchases
CREATE TABLE IF NOT EXISTS business_purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  purchase_number TEXT NOT NULL,
  purchase_type TEXT DEFAULT 'GST',
  purchase_date TEXT NOT NULL,
  due_date TEXT NOT NULL,
  doc_type TEXT DEFAULT 'PO',
  status TEXT DEFAULT 'Approved',
  supplier_name TEXT NOT NULL,
  supplier_gstin TEXT,
  billing_address TEXT,
  contact_number TEXT,
  warehouse_id TEXT DEFAULT 'Main Godown',
  purchase_by TEXT,
  payment_status TEXT DEFAULT 'pending',
  payment_mode TEXT DEFAULT 'Cash',
  bank_account_id TEXT,
  paid_amount REAL DEFAULT 0,
  advance_amount REAL DEFAULT 0,
  shipping_charge REAL DEFAULT 0,
  round_off REAL DEFAULT 0,
  place_of_supply TEXT DEFAULT 'Maharashtra',
  return_reason TEXT,
  subtotal REAL DEFAULT 0,
  total_discount REAL DEFAULT 0,
  total_tax REAL DEFAULT 0,
  grand_total REAL DEFAULT 0,
  created_at TEXT,
  updated_at TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

-- Business Purchase Items
CREATE TABLE IF NOT EXISTS business_purchase_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_id INTEGER NOT NULL,
  product_name TEXT NOT NULL,
  sku TEXT,
  batch_number TEXT,
  expiry_date TEXT,
  quantity REAL DEFAULT 1,
  received_quantity REAL DEFAULT 0,
  free_quantity REAL DEFAULT 0,
  primary_unit TEXT DEFAULT 'pcs',
  purchase_price REAL DEFAULT 0,
  discount REAL DEFAULT 0,
  gst_percentage REAL DEFAULT 18,
  tax_amount REAL DEFAULT 0,
  total REAL DEFAULT 0,
  FOREIGN KEY(purchase_id) REFERENCES business_purchases(id) ON DELETE CASCADE
);

-- Business Purchase Notes
CREATE TABLE IF NOT EXISTS business_purchase_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_id INTEGER NOT NULL,
  title TEXT,
  content TEXT,
  created_at TEXT,
  FOREIGN KEY(purchase_id) REFERENCES business_purchases(id) ON DELETE CASCADE
);

-- Business Purchase Documents
CREATE TABLE IF NOT EXISTS business_purchase_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_id INTEGER NOT NULL,
  name TEXT,
  file_path TEXT,
  FOREIGN KEY(purchase_id) REFERENCES business_purchases(id) ON DELETE CASCADE
);

-- Business Suppliers
CREATE TABLE IF NOT EXISTS business_suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  company TEXT,
  gstin TEXT,
  status TEXT DEFAULT 'active',
  city TEXT,
  outstanding_balance REAL DEFAULT 0,
  total_purchased REAL DEFAULT 0,
  created_at TEXT,
  updated_at TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

-- Supplier Addresses
CREATE TABLE IF NOT EXISTS supplier_addresses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  address_line1 TEXT,
  address_line2 TEXT,
  city TEXT,
  state TEXT,
  postal_code TEXT,
  country TEXT,
  created_at TEXT,
  FOREIGN KEY(supplier_id) REFERENCES business_suppliers(id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

-- Supplier Contacts
CREATE TABLE IF NOT EXISTS supplier_contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  contact_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  designation TEXT,
  created_at TEXT,
  FOREIGN KEY(supplier_id) REFERENCES business_suppliers(id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

-- Supplier Notes
CREATE TABLE IF NOT EXISTS supplier_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  note TEXT NOT NULL,
  created_at TEXT,
  FOREIGN KEY(supplier_id) REFERENCES business_suppliers(id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

-- Supplier Payments
CREATE TABLE IF NOT EXISTS supplier_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  amount REAL DEFAULT 0,
  payment_method TEXT,
  reference_number TEXT,
  created_at TEXT,
  FOREIGN KEY(supplier_id) REFERENCES business_suppliers(id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

-- Supplier Documents
CREATE TABLE IF NOT EXISTS supplier_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  file_name TEXT NOT NULL,
  file_url TEXT,
  file_size TEXT,
  created_at TEXT,
  FOREIGN KEY(supplier_id) REFERENCES business_suppliers(id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

-- Supplier Ledger
CREATE TABLE IF NOT EXISTS supplier_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  description TEXT,
  amount REAL DEFAULT 0,
  type TEXT,
  created_at TEXT,
  FOREIGN KEY(supplier_id) REFERENCES business_suppliers(id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

-- Business Products
CREATE TABLE IF NOT EXISTS business_products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  sku TEXT,
  category TEXT,
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
  warehouse_id TEXT DEFAULT 'Main Godown',
  created_at TEXT,
  updated_at TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

-- Product Images
CREATE TABLE IF NOT EXISTS product_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  image_url TEXT NOT NULL,
  created_at TEXT,
  FOREIGN KEY(product_id) REFERENCES business_products(id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

-- Product Documents
CREATE TABLE IF NOT EXISTS product_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  file_name TEXT NOT NULL,
  file_url TEXT,
  created_at TEXT,
  FOREIGN KEY(product_id) REFERENCES business_products(id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

-- Product Stock History
CREATE TABLE IF NOT EXISTS product_stock_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  quantity_changed REAL DEFAULT 0,
  type TEXT,
  description TEXT,
  created_at TEXT,
  FOREIGN KEY(product_id) REFERENCES business_products(id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

-- Product Notes
CREATE TABLE IF NOT EXISTS product_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  note TEXT NOT NULL,
  created_at TEXT,
  FOREIGN KEY(product_id) REFERENCES business_products(id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

-- Product Categories
CREATE TABLE IF NOT EXISTS product_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  category_name TEXT NOT NULL,
  created_at TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

-- Platform Global Settings Override Engine
CREATE TABLE IF NOT EXISTS platform_config (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT UNIQUE NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT
);

-- Multi-Tenant Broadcast Announcement Engine
CREATE TABLE IF NOT EXISTS platform_announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  banner_type TEXT DEFAULT 'INFO', -- INFO | WARNING | CRITICAL
  is_active INTEGER DEFAULT 1,
  created_at TEXT
);

-- Immutable Core Infrastructure Audit Logging Engine
CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action_type TEXT NOT NULL,
  message TEXT NOT NULL,
  actor TEXT DEFAULT 'System',
  severity TEXT DEFAULT 'INFO',
  created_at TEXT
);

-- Global Platform Administration Registry
CREATE TABLE IF NOT EXISTS platform_admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT
);

-- Multi-Agent Enterprise Sales Pipeline Management
CREATE TABLE IF NOT EXISTS sales_agents (

  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  commission_rate REAL DEFAULT 0.0,
  is_active INTEGER DEFAULT 1,
  created_at TEXT
);

-- Distributed Customer Leads Distribution Grid
CREATE TABLE IF NOT EXISTS sales_leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id INTEGER,
  business_name TEXT NOT NULL,
  contact_name TEXT,
  email TEXT,
  phone TEXT,
  status TEXT DEFAULT 'NEW',
  estimated_value REAL DEFAULT 0.0,
  notes TEXT,
  created_at TEXT,
  updated_at TEXT
);

-- Venture Pitches Hub
CREATE TABLE IF NOT EXISTS venture_pitches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  business_name TEXT NOT NULL,
  industry TEXT,
  funding_target REAL NOT NULL,
  raised_amount REAL DEFAULT 0,
  equity_offered REAL,
  headline TEXT NOT NULL,
  pitch_deck_url TEXT,
  use_of_funds TEXT,
  is_verified INTEGER DEFAULT 0,
  listing_status TEXT DEFAULT 'DRAFT',
  payment_reference TEXT,
  founder_phone TEXT,
  founder_email TEXT,
  created_at TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

-- Global Customer Support Agent Registry
CREATE TABLE IF NOT EXISTS support_agents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  is_active INTEGER DEFAULT 1,
  created_at TEXT
);

-- Customer Support Tickets Tracking Grid
CREATE TABLE IF NOT EXISTS support_tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  subject TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT DEFAULT 'OPEN',
  priority TEXT DEFAULT 'MEDIUM',
  agent_id INTEGER,
  admin_note TEXT,
  resolution_notes TEXT,
  created_at TEXT,
  updated_at TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id)
);
-- Business Wallets (Prepaid Stored Value)
CREATE TABLE IF NOT EXISTS business_wallets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE,
  balance REAL DEFAULT 0,
  reward_points INTEGER DEFAULT 0,
  created_at TEXT,
  updated_at TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

-- Business Wallet Transactions
CREATE TABLE IF NOT EXISTS business_wallet_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wallet_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  amount REAL NOT NULL,
  description TEXT,
  transaction_ref TEXT,
  created_at TEXT,
  FOREIGN KEY(wallet_id) REFERENCES business_wallets(id)
);

-- Money Trackers
CREATE TABLE IF NOT EXISTS money_trackers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  category TEXT NOT NULL,
  name TEXT NOT NULL,
  place TEXT,
  date TEXT,
  budget REAL DEFAULT 0,
  details TEXT,
  expenses TEXT,
  locations TEXT,
  photos TEXT,
  timeline TEXT,
  memories TEXT,
  route_map TEXT,
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
      'ALTER TABLE stock ADD COLUMN IF NOT EXISTS sub_name TEXT;',
      'ALTER TABLE stock ADD COLUMN IF NOT EXISTS unit TEXT;',
      'ALTER TABLE stock ADD COLUMN IF NOT EXISTS low_stock_threshold INTEGER DEFAULT 5;',
      'ALTER TABLE people_records ADD COLUMN IF NOT EXISTS type TEXT;',
      'ALTER TABLE people_records ADD COLUMN IF NOT EXISTS description TEXT;',
      'ALTER TABLE people ADD COLUMN IF NOT EXISTS relationship TEXT;',
      'ALTER TABLE people ADD COLUMN IF NOT EXISTS phone TEXT;',
      'ALTER TABLE people ADD COLUMN IF NOT EXISTS email TEXT;',
      'ALTER TABLE people ADD COLUMN IF NOT EXISTS role_type VARCHAR(100);',
      'ALTER TABLE people ADD COLUMN IF NOT EXISTS company VARCHAR(255);',
      'ALTER TABLE people ADD COLUMN IF NOT EXISTS contact_info TEXT;',
      'ALTER TABLE people_records ADD COLUMN IF NOT EXISTS attachment_url TEXT;',
      'ALTER TABLE people_records ADD COLUMN IF NOT EXISTS file_type TEXT;',
      'ALTER TABLE plan_income ADD COLUMN IF NOT EXISTS category TEXT;',
      'ALTER TABLE plan_expenses ADD COLUMN IF NOT EXISTS description TEXT;',
      'ALTER TABLE meetups ADD COLUMN IF NOT EXISTS description TEXT;',
      'ALTER TABLE meetups ADD COLUMN IF NOT EXISTS category TEXT DEFAULT \'General\';',
      'ALTER TABLE meetups ADD COLUMN IF NOT EXISTS image_url TEXT;',
      'ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS code TEXT;',
      'ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS type TEXT;',
      'ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS status TEXT DEFAULT \'active\';',
      'ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS address TEXT;',
      'ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS city TEXT;',
      'ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS state TEXT;',
      'ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS pincode TEXT;',
      'ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS contact_person TEXT;',
      'ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS phone_number TEXT;',
      'ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS email TEXT;',
      'ALTER TABLE gst_invoices ADD COLUMN IF NOT EXISTS invoice_type TEXT;',
      'ALTER TABLE gst_invoices ADD COLUMN IF NOT EXISTS place_of_supply TEXT;',
      'ALTER TABLE gst_invoices ADD COLUMN IF NOT EXISTS taxable_value NUMERIC DEFAULT 0;',
      'ALTER TABLE gst_invoices ADD COLUMN IF NOT EXISTS gst_percentage NUMERIC DEFAULT 0;',
      'ALTER TABLE gst_invoices ADD COLUMN IF NOT EXISTS cgst_amount NUMERIC DEFAULT 0;',
      'ALTER TABLE gst_invoices ADD COLUMN IF NOT EXISTS sgst_amount NUMERIC DEFAULT 0;',
      'ALTER TABLE gst_invoices ADD COLUMN IF NOT EXISTS igst_amount NUMERIC DEFAULT 0;',
      'ALTER TABLE gst_invoices ADD COLUMN IF NOT EXISTS total_tax NUMERIC DEFAULT 0;',
      'ALTER TABLE gst_invoices ADD COLUMN IF NOT EXISTS reverse_charge TEXT;',
      'ALTER TABLE gst_invoices ADD COLUMN IF NOT EXISTS irn_number TEXT;',
      'ALTER TABLE gst_invoices ADD COLUMN IF NOT EXISTS qr_status TEXT;',
      'ALTER TABLE gst_invoices ADD COLUMN IF NOT EXISTS vendor_gstin TEXT;',
      'ALTER TABLE gst_invoices ADD COLUMN IF NOT EXISTS vendor_name TEXT;',
      'ALTER TABLE gst_invoices ADD COLUMN IF NOT EXISTS eligible_itc NUMERIC DEFAULT 0;',
      'ALTER TABLE gst_invoices ADD COLUMN IF NOT EXISTS invoice_match_status TEXT;',
      'ALTER TABLE gst_invoices ADD COLUMN IF NOT EXISTS mismatch_reason TEXT;',
      'ALTER TABLE gst_invoices ADD COLUMN IF NOT EXISTS reconciliation_date TEXT;',
      'ALTER TABLE gst_invoices ADD COLUMN IF NOT EXISTS transporter_name TEXT;',
      'ALTER TABLE gst_invoices ADD COLUMN IF NOT EXISTS vehicle_number TEXT;',
      'ALTER TABLE gst_invoices ADD COLUMN IF NOT EXISTS transport_distance INTEGER DEFAULT 0;',
      'ALTER TABLE gst_invoices ADD COLUMN IF NOT EXISTS dispatch_location TEXT;',
      'ALTER TABLE gst_invoices ADD COLUMN IF NOT EXISTS delivery_location TEXT;',
      'ALTER TABLE gst_invoices ADD COLUMN IF NOT EXISTS status TEXT DEFAULT \'Active\';',
      'ALTER TABLE gst_invoices ADD COLUMN IF NOT EXISTS reference_invoice TEXT;',
      'ALTER TABLE gst_invoices ADD COLUMN IF NOT EXISTS is_eway_bill TEXT DEFAULT \'false\';',
      'ALTER TABLE gst_invoices ADD COLUMN IF NOT EXISTS is_reconciliation TEXT DEFAULT \'false\';',
      'ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS capacity_utilization TEXT DEFAULT \'0%\';',
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
      );`,
      `CREATE TABLE IF NOT EXISTS business_customers (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255),
        phone VARCHAR(50),
        company VARCHAR(255),
        status VARCHAR(50) DEFAULT 'lead',
        notes TEXT,
        total_spent NUMERIC DEFAULT 0,
        created_at TEXT,
        updated_at TEXT,
        FOREIGN KEY(user_id) REFERENCES users(id)
      );`,
      `CREATE TABLE IF NOT EXISTS business_employees (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        name VARCHAR(255) NOT NULL,
        role VARCHAR(100),
        email VARCHAR(255),
        phone VARCHAR(50),
        salary NUMERIC DEFAULT 0,
        status VARCHAR(50) DEFAULT 'active',
        hire_date TEXT,
        created_at TEXT,
        updated_at TEXT,
        FOREIGN KEY(user_id) REFERENCES users(id)
      );`,
      `CREATE TABLE IF NOT EXISTS business_plans (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        start_date TEXT,
        end_date TEXT,
        total_budget NUMERIC DEFAULT 0,
        status VARCHAR(50) DEFAULT 'Draft',
        created_at TEXT,
        updated_at TEXT,
        FOREIGN KEY(user_id) REFERENCES users(id)
      );`,
      `CREATE TABLE IF NOT EXISTS business_plan_items (
        id SERIAL PRIMARY KEY,
        plan_id INTEGER NOT NULL,
        type VARCHAR(50),
        category VARCHAR(100),
        description TEXT,
        amount NUMERIC DEFAULT 0,
        date TEXT,
        created_at TEXT,
        FOREIGN KEY(plan_id) REFERENCES business_plans(id) ON DELETE CASCADE
      );`,
      `CREATE TABLE IF NOT EXISTS venture_pitches (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        business_name VARCHAR(255) NOT NULL,
        industry VARCHAR(100),
        funding_target NUMERIC NOT NULL,
        raised_amount NUMERIC DEFAULT 0,
        equity_offered NUMERIC,
        headline VARCHAR(255) NOT NULL,
        pitch_deck_url TEXT,
        use_of_funds TEXT,
        is_verified BOOLEAN DEFAULT FALSE,
        listing_status VARCHAR(50) DEFAULT 'DRAFT',
        payment_reference VARCHAR(100),
        founder_phone VARCHAR(50),
        founder_email VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id)
      );`,
      `ALTER TABLE meetups ADD COLUMN IF NOT EXISTS max_seats INTEGER DEFAULT 100;`,
      `CREATE TABLE IF NOT EXISTS meetup_registrations (
        id SERIAL PRIMARY KEY,
        meetup_id INTEGER NOT NULL REFERENCES meetups(id),
        user_id INTEGER NOT NULL REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(meetup_id, user_id)
      );`,
      `ALTER TABLE venture_pitches ADD COLUMN IF NOT EXISTS founder_phone VARCHAR(50);`,
      `ALTER TABLE venture_pitches ADD COLUMN IF NOT EXISTS founder_email VARCHAR(255);`,
      `ALTER TABLE planned_payments ADD COLUMN IF NOT EXISTS type VARCHAR(50);`,
      `ALTER TABLE planned_payments ADD COLUMN IF NOT EXISTS person_id INTEGER;`,
      `CREATE TABLE IF NOT EXISTS business_wallets (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL UNIQUE,
        balance NUMERIC DEFAULT 0,
        reward_points INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id)
      );`,
      `CREATE TABLE IF NOT EXISTS business_wallet_transactions (
        id SERIAL PRIMARY KEY,
        wallet_id INTEGER NOT NULL,
        type VARCHAR(50) NOT NULL,
        amount NUMERIC NOT NULL,
        description TEXT,
        transaction_ref VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(wallet_id) REFERENCES business_wallets(id)
      );`,
      `ALTER TABLE transactions ADD COLUMN IF NOT EXISTS name VARCHAR(255);`,
      `ALTER TABLE transactions ADD COLUMN IF NOT EXISTS time VARCHAR(50);`,
      `ALTER TABLE transactions ADD COLUMN IF NOT EXISTS schedule VARCHAR(100);`,
      `ALTER TABLE people_reminders ADD COLUMN IF NOT EXISTS amount NUMERIC;`
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
      'ALTER TABLE stock ADD COLUMN sub_name TEXT',
      'ALTER TABLE stock ADD COLUMN unit TEXT',
      'ALTER TABLE stock ADD COLUMN low_stock_threshold INTEGER DEFAULT 5',
      'ALTER TABLE people_records ADD COLUMN type TEXT',
      'ALTER TABLE people_records ADD COLUMN description TEXT',
      'ALTER TABLE people ADD COLUMN relationship TEXT',
      'ALTER TABLE people ADD COLUMN phone TEXT',
      'ALTER TABLE people ADD COLUMN email TEXT',
      'ALTER TABLE people ADD COLUMN role_type TEXT',
      'ALTER TABLE people ADD COLUMN company TEXT',
      'ALTER TABLE people ADD COLUMN contact_info TEXT',
      'ALTER TABLE split_expenses ADD COLUMN paid_by TEXT',
      'ALTER TABLE goal_wallets ADD COLUMN person_id INTEGER',
      'ALTER TABLE planned_payments ADD COLUMN type TEXT',
      'ALTER TABLE planned_payments ADD COLUMN person_id INTEGER',
      'ALTER TABLE people_records ADD COLUMN IF NOT EXISTS attachment_url TEXT',
      'ALTER TABLE people_records ADD COLUMN IF NOT EXISTS file_type TEXT',
      'ALTER TABLE plan_income ADD COLUMN category TEXT',
      'ALTER TABLE plan_expenses ADD COLUMN description TEXT',
      'ALTER TABLE meetups ADD COLUMN description TEXT',
      'ALTER TABLE meetups ADD COLUMN category TEXT DEFAULT \'General\'',
      'ALTER TABLE meetups ADD COLUMN image_url TEXT',
      'ALTER TABLE business_invoices ADD COLUMN client_gstin TEXT',
      'ALTER TABLE business_invoices ADD COLUMN billing_address TEXT',
      'ALTER TABLE business_invoices ADD COLUMN shipping_address TEXT',
      'ALTER TABLE business_invoices ADD COLUMN tax_amount REAL DEFAULT 0',
      'ALTER TABLE business_invoices ADD COLUMN total_amount REAL DEFAULT 0',
      'ALTER TABLE business_invoices ADD COLUMN paid_amount REAL DEFAULT 0',
      'ALTER TABLE business_invoices ADD COLUMN due_amount REAL DEFAULT 0',
      'ALTER TABLE business_invoices ADD COLUMN bank_account_id TEXT',
      'ALTER TABLE business_invoices ADD COLUMN discount_amount REAL DEFAULT 0',
      'ALTER TABLE business_invoices ADD COLUMN round_off REAL DEFAULT 0',
      'ALTER TABLE business_invoices ADD COLUMN payment_mode TEXT',
      'ALTER TABLE business_invoices ADD COLUMN invoice_type TEXT',
      'ALTER TABLE business_invoices ADD COLUMN tax_type TEXT',
      'ALTER TABLE warehouses ADD COLUMN code TEXT',
      'ALTER TABLE warehouses ADD COLUMN type TEXT',
      'ALTER TABLE warehouses ADD COLUMN status TEXT DEFAULT \'active\'',
      'ALTER TABLE warehouses ADD COLUMN address TEXT',
      'ALTER TABLE warehouses ADD COLUMN city TEXT',
      'ALTER TABLE warehouses ADD COLUMN state TEXT',
      'ALTER TABLE warehouses ADD COLUMN pincode TEXT',
      'ALTER TABLE warehouses ADD COLUMN contact_person TEXT',
      'ALTER TABLE warehouses ADD COLUMN phone_number TEXT',
      'ALTER TABLE warehouses ADD COLUMN email TEXT',
      'ALTER TABLE warehouses ADD COLUMN capacity_utilization TEXT DEFAULT \'0%\'',
      'ALTER TABLE gst_invoices ADD COLUMN invoice_type TEXT',
      'ALTER TABLE gst_invoices ADD COLUMN place_of_supply TEXT',
      'ALTER TABLE gst_invoices ADD COLUMN taxable_value REAL DEFAULT 0',
      'ALTER TABLE gst_invoices ADD COLUMN gst_percentage REAL DEFAULT 0',
      'ALTER TABLE gst_invoices ADD COLUMN cgst_amount REAL DEFAULT 0',
      'ALTER TABLE gst_invoices ADD COLUMN sgst_amount REAL DEFAULT 0',
      'ALTER TABLE gst_invoices ADD COLUMN igst_amount REAL DEFAULT 0',
      'ALTER TABLE gst_invoices ADD COLUMN total_tax REAL DEFAULT 0',
      'ALTER TABLE gst_invoices ADD COLUMN reverse_charge TEXT',
      'ALTER TABLE gst_invoices ADD COLUMN irn_number TEXT',
      'ALTER TABLE gst_invoices ADD COLUMN qr_status TEXT',
      'ALTER TABLE gst_invoices ADD COLUMN vendor_gstin TEXT',
      'ALTER TABLE gst_invoices ADD COLUMN vendor_name TEXT',
      'ALTER TABLE gst_invoices ADD COLUMN eligible_itc REAL DEFAULT 0',
      'ALTER TABLE gst_invoices ADD COLUMN invoice_match_status TEXT',
      'ALTER TABLE gst_invoices ADD COLUMN mismatch_reason TEXT',
      'ALTER TABLE gst_invoices ADD COLUMN reconciliation_date TEXT',
      'ALTER TABLE gst_invoices ADD COLUMN transporter_name TEXT',
      'ALTER TABLE gst_invoices ADD COLUMN vehicle_number TEXT',
      'ALTER TABLE gst_invoices ADD COLUMN transport_distance INTEGER DEFAULT 0',
      'ALTER TABLE gst_invoices ADD COLUMN dispatch_location TEXT',
      'ALTER TABLE gst_invoices ADD COLUMN delivery_location TEXT',
      'ALTER TABLE gst_invoices ADD COLUMN status TEXT DEFAULT \'Active\'',
      'ALTER TABLE gst_invoices ADD COLUMN reference_invoice TEXT',
      'ALTER TABLE gst_invoices ADD COLUMN is_eway_bill TEXT DEFAULT \'false\'',
      'ALTER TABLE gst_invoices ADD COLUMN is_reconciliation TEXT DEFAULT \'false\'',
      'ALTER TABLE venture_pitches ADD COLUMN founder_phone TEXT',
      'ALTER TABLE venture_pitches ADD COLUMN founder_email TEXT',
      'ALTER TABLE users ADD COLUMN tier TEXT DEFAULT \'Free Plan\'',
      'ALTER TABLE users ADD COLUMN subscription_days_remaining INTEGER DEFAULT 0',
      'ALTER TABLE users ADD COLUMN primary_income_source TEXT',
      'ALTER TABLE users ADD COLUMN global_budget REAL DEFAULT 20000',
      'ALTER TABLE transactions ADD COLUMN name TEXT',
      'ALTER TABLE transactions ADD COLUMN time TEXT',
      'ALTER TABLE transactions ADD COLUMN schedule TEXT',
      'ALTER TABLE people_reminders ADD COLUMN amount REAL'
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

  // Seed Initial Infrastructure Configurations (Dialect Agnostic Block)
  try {
    const check = await db.prepare("SELECT count(*) as cnt FROM platform_config").get();
    if (check && (check.cnt === 0 || check.cnt === '0')) {
      console.log('🌱 Seeding default platform engine parameters...');
      await db.prepare("INSERT INTO platform_config (key, value, updated_at) VALUES ('maintenance_mode', 'false', CURRENT_TIMESTAMP)").run();
      await db.prepare("INSERT INTO platform_config (key, value, updated_at) VALUES ('signup_enabled', 'true', CURRENT_TIMESTAMP)").run();
      await db.prepare("INSERT INTO platform_config (key, value, updated_at) VALUES ('ai_auditing', 'true', CURRENT_TIMESTAMP)").run();
      await db.prepare("INSERT INTO platform_config (key, value, updated_at) VALUES ('instant_invoicing', 'true', CURRENT_TIMESTAMP)").run();
      await db.prepare("INSERT INTO platform_config (key, value, updated_at) VALUES ('beta_integrations', 'false', CURRENT_TIMESTAMP)").run();
      await db.prepare("INSERT INTO platform_config (key, value, updated_at) VALUES ('api_throttle_limit', '1200', CURRENT_TIMESTAMP)").run();
    }
  } catch (err) {
    console.warn("⚠️ Skipping infrastructure seed sequence:", err.message);
  }

  console.log('✅ Migrations applied');
}

module.exports = { runMigrations };
