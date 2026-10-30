const db = require('./connection');

async function runManufacturingMigrations() {
  const dbType = process.env.DB_TYPE || 'sqlite';
  const idType = dbType === 'postgres' ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';

  // 1. Alter existing business_products table for item roles & group links
  const productAlters = [
    "ALTER TABLE business_products ADD COLUMN item_role TEXT DEFAULT 'standard'",
    "ALTER TABLE business_products ADD COLUMN group_id INTEGER DEFAULT NULL",
    "ALTER TABLE business_products ADD COLUMN subgroup_id INTEGER DEFAULT NULL"
  ];
  for (const sql of productAlters) {
    try { await db.prepare(sql).run(); } catch (_) {}
  }

  // 2. Alter existing product_categories table for hierarchical groups/subgroups
  const categoryAlters = [
    "ALTER TABLE product_categories ADD COLUMN parent_id INTEGER DEFAULT NULL",
    "ALTER TABLE product_categories ADD COLUMN is_active INTEGER DEFAULT 1",
    "ALTER TABLE product_categories ADD COLUMN description TEXT DEFAULT NULL",
    "ALTER TABLE product_categories ADD COLUMN image_url TEXT DEFAULT NULL",
    "ALTER TABLE product_categories ADD COLUMN icon TEXT DEFAULT NULL"
  ];
  for (const sql of categoryAlters) {
    try { await db.prepare(sql).run(); } catch (_) {}
  }

  // 3. Manufacturing BOMs table
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS manufacturing_boms (
      id ${idType},
      user_id INTEGER NOT NULL,
      bom_number TEXT,
      name TEXT NOT NULL,
      product_id INTEGER,
      version TEXT DEFAULT '1.0',
      output_quantity REAL DEFAULT 1,
      output_unit TEXT DEFAULT 'PCS',
      expected_loss_percent REAL DEFAULT 0,
      labor_cost REAL DEFAULT 0,
      overhead_cost REAL DEFAULT 0,
      other_cost REAL DEFAULT 0,
      status TEXT DEFAULT 'active',
      is_default INTEGER DEFAULT 1,
      effective_date TEXT,
      notes TEXT,
      description TEXT,
      items TEXT,
      created_at TEXT,
      updated_at TEXT
    )
  `).run();

  // Safely ensure new columns exist in manufacturing_boms if table existed previously
  const bomAlters = [
    "ALTER TABLE manufacturing_boms ADD COLUMN bom_number TEXT",
    "ALTER TABLE manufacturing_boms ADD COLUMN product_id INTEGER",
    "ALTER TABLE manufacturing_boms ADD COLUMN version TEXT DEFAULT '1.0'",
    "ALTER TABLE manufacturing_boms ADD COLUMN output_quantity REAL DEFAULT 1",
    "ALTER TABLE manufacturing_boms ADD COLUMN output_unit TEXT DEFAULT 'PCS'",
    "ALTER TABLE manufacturing_boms ADD COLUMN expected_loss_percent REAL DEFAULT 0",
    "ALTER TABLE manufacturing_boms ADD COLUMN labor_cost REAL DEFAULT 0",
    "ALTER TABLE manufacturing_boms ADD COLUMN overhead_cost REAL DEFAULT 0",
    "ALTER TABLE manufacturing_boms ADD COLUMN other_cost REAL DEFAULT 0",
    "ALTER TABLE manufacturing_boms ADD COLUMN is_default INTEGER DEFAULT 1",
    "ALTER TABLE manufacturing_boms ADD COLUMN effective_date TEXT",
    "ALTER TABLE manufacturing_boms ADD COLUMN notes TEXT",
    "ALTER TABLE manufacturing_boms ADD COLUMN status TEXT DEFAULT 'active'"
  ];
  for (const sql of bomAlters) {
    try { await db.prepare(sql).run(); } catch (_) {}
  }

  // 4. Manufacturing BOM Items table
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS manufacturing_bom_items (
      id ${idType},
      bom_id INTEGER NOT NULL,
      component_product_id INTEGER NOT NULL,
      quantity REAL NOT NULL,
      unit TEXT DEFAULT 'PCS',
      waste_percent REAL DEFAULT 0,
      cost_per_unit REAL DEFAULT 0,
      notes TEXT,
      created_at TEXT
    )
  `).run();

  // 5. Production Orders table
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS production_orders (
      id ${idType},
      user_id INTEGER NOT NULL,
      order_number TEXT NOT NULL,
      bom_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      planned_quantity REAL NOT NULL,
      completed_quantity REAL DEFAULT 0,
      rejected_quantity REAL DEFAULT 0,
      scrap_quantity REAL DEFAULT 0,
      remaining_quantity REAL DEFAULT 0,
      status TEXT DEFAULT 'Draft',
      source_warehouse_id TEXT,
      destination_warehouse_id TEXT,
      planned_date TEXT,
      start_date TEXT,
      completion_date TEXT,
      bom_snapshot TEXT,
      planned_material_cost REAL DEFAULT 0,
      actual_material_cost REAL DEFAULT 0,
      labor_cost REAL DEFAULT 0,
      overhead_cost REAL DEFAULT 0,
      total_cost REAL DEFAULT 0,
      unit_cost REAL DEFAULT 0,
      cost_variance REAL DEFAULT 0,
      wastage_cost REAL DEFAULT 0,
      responsible_employee TEXT,
      notes TEXT,
      completion_notes TEXT,
      created_at TEXT,
      updated_at TEXT
    )
  `).run();

  // 6. Production Order Materials (Planned vs Issued vs Consumed vs Returned vs Wasted)
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS production_order_materials (
      id ${idType},
      production_order_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      planned_quantity REAL NOT NULL,
      issued_quantity REAL DEFAULT 0,
      consumed_quantity REAL DEFAULT 0,
      returned_quantity REAL DEFAULT 0,
      wasted_quantity REAL DEFAULT 0,
      unit TEXT NOT NULL,
      unit_cost REAL DEFAULT 0,
      total_cost REAL DEFAULT 0,
      wastage_reason TEXT,
      status TEXT DEFAULT 'Pending',
      notes TEXT,
      created_at TEXT,
      updated_at TEXT
    )
  `).run();

  // 7. Production Order Logs / History
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS production_order_logs (
      id ${idType},
      production_order_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      details TEXT,
      created_at TEXT
    )
  `).run();

  // 8. Helpful Indices
  const indices = [
    'CREATE INDEX IF NOT EXISTS idx_mfg_bom_user ON manufacturing_boms(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_mfg_bom_prod ON manufacturing_boms(product_id)',
    'CREATE INDEX IF NOT EXISTS idx_mfg_bom_items_bom ON manufacturing_bom_items(bom_id)',
    'CREATE INDEX IF NOT EXISTS idx_mfg_po_user ON production_orders(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_mfg_po_status ON production_orders(status)',
    'CREATE INDEX IF NOT EXISTS idx_mfg_po_mat_order ON production_order_materials(production_order_id)',
    'CREATE INDEX IF NOT EXISTS idx_mfg_po_logs_order ON production_order_logs(production_order_id)'
  ];
  for (const sql of indices) {
    try { await db.prepare(sql).run(); } catch (_) {}
  }

  console.log('✅ Manufacturing & Production schema migrations applied successfully');
}

module.exports = { runManufacturingMigrations };
