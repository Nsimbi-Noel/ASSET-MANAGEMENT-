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

// Enforce referential integrity (SQLite disables this by default per connection).
// Documented in SCHEMA.md but was never actually applied.
db.exec('PRAGMA foreign_keys = ON');

// Use Write-Ahead Logging for better concurrency during high-frequency audit
// writes (documented in SCHEMA.md but was never actually applied).
try {
  db.exec('PRAGMA journal_mode = WAL');
} catch (e) {
  // WAL may be unavailable on some filesystems (e.g. network mounts); fall back silently.
}

/**
 * Initialize database tables and seed initial data.
 */
function initDb() {
  // Enforce FK pragma again here in case initDb is ever called on a fresh connection.
  db.exec('PRAGMA foreign_keys = ON');

  // 1. Users Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('Admin', 'AssetManager', 'Employee')),
      department TEXT,
      status TEXT DEFAULT 'Active' CHECK (status IN ('Active', 'Inactive')),
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
      serial_number TEXT NOT NULL UNIQUE,
      condition TEXT NOT NULL CHECK (condition IN ('New', 'Good', 'Refurbished', 'Damaged')),
      acquisition_date TEXT NOT NULL,
      cost REAL NOT NULL CHECK (cost >= 0),
      supplier TEXT NOT NULL,
      source TEXT NOT NULL CHECK (source IN ('Procurement', 'Donation', 'Lease', 'Other')),
      status TEXT NOT NULL CHECK (status IN ('Active', 'In Storage', 'Under Maintenance', 'Disposed')),
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
      contract_end_date TEXT,
      purpose TEXT,
      notes TEXT,
      confirmed_receipt INTEGER DEFAULT 0 CHECK (confirmed_receipt IN (0, 1)), -- 0 = No, 1 = Yes
      status TEXT DEFAULT 'Active' CHECK (status IN ('Active', 'Returned')),
      returned_date TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 4. Transfers Table (Tracks movement of assets between users/departments)
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
      cost REAL NOT NULL CHECK (cost >= 0),
      service_date TEXT NOT NULL,
      next_service_date TEXT,
      estimated_duration_days INTEGER, -- How many days the manager expects servicing to take
      expected_completion_date TEXT, -- service_date + estimated_duration_days, used to flag readiness
      completed INTEGER DEFAULT 0 CHECK (completed IN (0, 1)), -- 0 = No, 1 = Yes
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
      status TEXT DEFAULT 'Pending' CHECK (status IN ('Pending', 'Approved', 'Rejected', 'Revoked')),
      manager_notes TEXT,
      actioned_by INTEGER REFERENCES users(id),
      actioned_date TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Migration for Requests Table (requester_feedback / received_status added later)
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

  // --- Performance indices (recommended by SCHEMA.md §4 but never created) ---
  try {
    db.exec('CREATE INDEX IF NOT EXISTS idx_assets_status ON assets(status)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_assignments_asset_id ON assignments(asset_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_assignments_status ON assignments(status)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_assignments_assigned_to ON assignments(assigned_to)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_maintenance_asset_id ON maintenance(asset_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_maintenance_completed ON maintenance(completed)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_requests_requested_by ON requests(requested_by)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp)');
  } catch (e) {
    /* indices are best-effort; ignore on unusual storage setups */
  }

  // Remove expired sessions opportunistically at startup so the sessions
  // table does not grow unboundedly over time.
  try {
    db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(new Date().toISOString());
  } catch (e) {
    /* best-effort cleanup */
  }

  // Seed the default accounts asynchronously so the event loop is not blocked
  // by password hashing during startup.
  return seedDefaultUsers();
}

// Asynchronously seed the default accounts (admin/manager/employee) once.
async function seedDefaultUsers() {
  const userCheck = db.prepare('SELECT COUNT(*) as count FROM users');
  const userCount = userCheck.get();

  if (userCount.count === 0) {
    const insertUser = db.prepare(`
      INSERT INTO users (username, password, name, role, department)
      VALUES (?, ?, ?, ?, ?)
    `);

    insertUser.run('admin', await hashPassword('admin123'), 'System Administrator', 'Admin', 'Information Technology');
    insertUser.run('manager', await hashPassword('manager123'), 'Asset Manager', 'AssetManager', 'Administration');
    insertUser.run('employee', await hashPassword('employee123'), 'Brenda Nansubuga', 'Employee', 'Registries');

    console.log('Default accounts created: admin, manager, employee');
  }
}

// Initialize database (table creation happens synchronously so the schema is
// guaranteed to exist before seedDefaultUsers runs).
const dbReady = initDb();

// Migration: Convert legacy custodian roles to Employee so old accounts stop using removed role names
try {
  db.exec("UPDATE users SET role = 'Employee' WHERE role IN ('Custodian', 'AssetCustodian')");
} catch (e) {
  // Ignore if the update fails for some reason
}

// Migration: Ensure estimated_duration_days and expected_completion_date exist in maintenance table
// so managers can state how long a servicing job should take, and the system can flag it
// automatically once that window has passed.
try {
  db.exec("ALTER TABLE maintenance ADD COLUMN estimated_duration_days INTEGER");
} catch (e) {
  // Column might already exist
}

// Migration: add contract_end_date to assignments if missing
try {
  db.exec("ALTER TABLE assignments ADD COLUMN contract_end_date TEXT;");
} catch (e) {
  // ignore if already present
}
try {
  db.exec("ALTER TABLE maintenance ADD COLUMN expected_completion_date TEXT");
} catch (e) {
  // Column might already exist
}

module.exports = {
  db,
  dbPath,
  dbReady
};
