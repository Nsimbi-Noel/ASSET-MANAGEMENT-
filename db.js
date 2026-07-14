const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
const { hashPassword } = require('./crypto_utils');

// Ensure database directory exists
const dbPath = process.env.DB_PATH || path.join(__dirname, 'data', 'database.db');
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}
const db = new DatabaseSync(dbPath);

/**
 * Initialize database tables and seed initial data.
 */
function initDb() {
  // 1. Users Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL, -- Admin, AssetManager, Employee
      department TEXT,
      status TEXT DEFAULT 'Active', -- Active, Inactive
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 2. Assets Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS assets (
      id TEXT PRIMARY KEY, -- Unique generated ID, e.g., URSB-AST-0001
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      category TEXT NOT NULL,
      serial_number TEXT NOT NULL,
      condition TEXT NOT NULL, -- New, Good, Refurbished, Damaged
      acquisition_date TEXT NOT NULL,
      cost REAL NOT NULL,
      supplier TEXT NOT NULL,
      source TEXT NOT NULL, -- Procurement, Donation, Other
      status TEXT NOT NULL, -- Active, In Storage, Under Maintenance, Disposed
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 3. Assignments Table (Tracks asset handovers)
  db.exec(`
    CREATE TABLE IF NOT EXISTS assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asset_id TEXT REFERENCES assets(id),
      assigned_to INTEGER REFERENCES users(id),
      assigned_by INTEGER REFERENCES users(id),
      assignment_date TEXT NOT NULL,
      purpose TEXT,
      notes TEXT,
      confirmed_receipt INTEGER DEFAULT 0, -- 0 = No, 1 = Yes
      status TEXT DEFAULT 'Active', -- Active, Returned
      returned_date TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 4. Transfers Table (Tracks movement of assets between custodians/departments)
  db.exec(`
    CREATE TABLE IF NOT EXISTS transfers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asset_id TEXT REFERENCES assets(id),
      from_user_id INTEGER REFERENCES users(id),
      to_user_id INTEGER REFERENCES users(id),
      transfer_date TEXT NOT NULL,
      reason TEXT NOT NULL,
      authorized_by INTEGER REFERENCES users(id),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 5. Maintenance Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS maintenance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asset_id TEXT REFERENCES assets(id),
      service_provider TEXT NOT NULL,
      description TEXT NOT NULL,
      cost REAL NOT NULL,
      service_date TEXT NOT NULL,
      next_service_date TEXT,
      estimated_duration_days INTEGER, -- How many days the manager expects servicing to take
      expected_completion_date TEXT, -- service_date + estimated_duration_days, used to flag readiness
      completed INTEGER DEFAULT 0, -- 0 = No, 1 = Yes
      completion_date TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 6. Disposals Table (read-only archive)
  db.exec(`
    CREATE TABLE IF NOT EXISTS disposals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asset_id TEXT REFERENCES assets(id),
      disposal_date TEXT NOT NULL,
      method TEXT NOT NULL,
      reason TEXT NOT NULL,
      authorized_by INTEGER REFERENCES users(id),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 7. Requests Table (Employees requesting assets)
  db.exec(`
    CREATE TABLE IF NOT EXISTS requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      requested_by INTEGER REFERENCES users(id),
      asset_name TEXT NOT NULL,
      asset_type TEXT NOT NULL,
      purpose TEXT NOT NULL,
      status TEXT DEFAULT 'Pending', -- Pending, Approved, Rejected
      manager_notes TEXT,
      actioned_by INTEGER REFERENCES users(id),
      actioned_date TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Migration for Requests Table
  try {
    db.exec("ALTER TABLE requests ADD COLUMN requester_feedback TEXT;");
  } catch (e) { /* ignore if column exists */ }
  
  try {
    db.exec("ALTER TABLE requests ADD COLUMN received_status TEXT DEFAULT 'Pending';");
  } catch (e) { /* ignore if column exists */ }

  // 8. Audit Log Table (un-deletable system audit trail)
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      username TEXT NOT NULL,
      action_type TEXT NOT NULL, -- CREATE, UPDATE, DELETE
      table_name TEXT NOT NULL,
      record_id TEXT NOT NULL,
      details TEXT NOT NULL,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 9. Sessions Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      session_id TEXT PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      expires_at TEXT NOT NULL
    );
  `);

  // Seed default users only (no demo data)
  const userCheck = db.prepare('SELECT COUNT(*) as count FROM users');
  const userCount = userCheck.get();
  
  if (userCount.count === 0) {
    const insertUser = db.prepare(`
      INSERT INTO users (username, password, name, role, department)
      VALUES (?, ?, ?, ?, ?)
    `);

    insertUser.run('admin', hashPassword('admin123'), 'System Administrator', 'Admin', 'Information Technology');
    insertUser.run('manager', hashPassword('manager123'), 'Asset Manager', 'AssetManager', 'Administration');
    insertUser.run('custodian', hashPassword('custodian123'), 'Asset Custodian', 'Employee', 'Finance');
    insertUser.run('employee', hashPassword('employee123'), 'Brenda Nansubuga', 'Employee', 'Registries');
    
    console.log('Default accounts created: admin, manager, custodian, employee');
  }
}

// Initialize database
initDb();

// Migration: Ensure requester_feedback and received_status exist in requests table for existing databases
try {
  db.exec("ALTER TABLE requests ADD COLUMN requester_feedback TEXT");
} catch (e) {
  // Column might already exist
}
try {
  db.exec("ALTER TABLE requests ADD COLUMN received_status TEXT DEFAULT 'Pending'");
} catch (e) {
  // Column might already exist
}

// Migration: Ensure estimated_duration_days and expected_completion_date exist in maintenance table
// so managers can state how long a servicing job should take, and the system can flag it
// automatically once that window has passed.
try {
  db.exec("ALTER TABLE maintenance ADD COLUMN estimated_duration_days INTEGER");
} catch (e) {
  // Column might already exist
}
try {
  db.exec("ALTER TABLE maintenance ADD COLUMN expected_completion_date TEXT");
} catch (e) {
  // Column might already exist
}

module.exports = {
  db,
  dbPath
};
