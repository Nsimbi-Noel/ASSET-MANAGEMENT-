const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
const { hashPassword } = require('./crypto_utils');

// Ensure database path exists
const dbDir = __dirname;
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}
const dbPath = path.join(dbDir, 'database.db');
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
      role TEXT NOT NULL, -- Admin, AssetManager, AssetCustodian, Employee
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

  // Seed Default Users if empty
  const userCheck = db.prepare('SELECT COUNT(*) as count FROM users');
  const userCount = userCheck.get();
  
  if (userCount.count === 0) {
    const insertUser = db.prepare(`
      INSERT INTO users (username, password, name, role, department)
      VALUES (?, ?, ?, ?, ?)
    `);

    // Hashed default passwords: same as username + '123'
    insertUser.run('admin', hashPassword('admin123'), 'System Administrator', 'Admin', 'Information Technology');
    insertUser.run('manager', hashPassword('manager123'), 'Asset Manager', 'AssetManager', 'Administration');
    insertUser.run('custodian', hashPassword('custodian123'), 'Asset Custodian', 'AssetCustodian', 'Finance');
    insertUser.run('employee', hashPassword('employee123'), 'Regular Employee', 'Employee', 'Registries');
    
    console.log('Seeded initial user accounts: admin/admin123, manager/manager123, custodian/custodian123, employee/employee123');
    
    // Seed some initial assets for testing the system
    const insertAsset = db.prepare(`
      INSERT INTO assets (id, name, type, category, serial_number, condition, acquisition_date, cost, supplier, source, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    insertAsset.run('URSB-AST-0001', 'Lenovo ThinkPad L14', 'Laptop', 'IT Equipment', 'LNV-SN-98217', 'New', '2026-01-15', 3500000, 'Datalink Uganda', 'Procurement', 'Active');
    insertAsset.run('URSB-AST-0002', 'HP LaserJet Pro M404', 'Printer', 'Office Equipment', 'HP-PRNT-1123', 'Good', '2025-11-20', 1200000, 'Sharp Electronics Ltd', 'Procurement', 'In Storage');
    insertAsset.run('URSB-AST-0003', 'Conference Room Projector Epson', 'Projector', 'IT Equipment', 'EPS-PRJ-5432', 'Refurbished', '2026-02-10', 2500000, 'UNICEF Uganda', 'Donation', 'Active');
    insertAsset.run('URSB-AST-0004', 'Executive Leather Desk Chair', 'Furniture', 'Fittings', 'FRN-CHR-004', 'Good', '2026-03-01', 450000, 'Furniture World Kampala', 'Procurement', 'Active');
    insertAsset.run('URSB-AST-0005', 'Dell PowerEdge R740 Server', 'Server', 'IT Infrastructure', 'DLL-SRV-8823', 'Damaged', '2024-05-18', 15000000, 'Dell East Africa', 'Procurement', 'Under Maintenance');
    insertAsset.run('URSB-AST-0006', 'Broken Office Shredder', 'Shredder', 'Office Equipment', 'SHR-BK-0092', 'Damaged', '2023-08-12', 800000, 'Office Depot Ltd', 'Procurement', 'Disposed');

    // Seed disposal for the disposed asset
    const insertDisposal = db.prepare(`
      INSERT INTO disposals (asset_id, disposal_date, method, reason, authorized_by)
      VALUES (?, ?, ?, ?, ?)
    `);
    insertDisposal.run('URSB-AST-0006', '2026-05-10', 'Scrapped', 'Motor burnt out beyond economic repair cost.', 2); // manager is id 2

    // Seed assignments
    const insertAssignment = db.prepare(`
      INSERT INTO assignments (asset_id, assigned_to, assigned_by, assignment_date, purpose, notes, confirmed_receipt, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    // Assign Lenovo ThinkPad to custodian
    insertAssignment.run('URSB-AST-0001', 3, 2, '2026-01-20', 'Daily work and field audits', 'Please handle with care', 1, 'Active');
    // Assign Conference Room Projector to employee
    insertAssignment.run('URSB-AST-0003', 4, 2, '2026-02-15', 'Boardroom presentation support', 'Temporary assignment', 0, 'Active');

    // Seed maintenance record
    const insertMaintenance = db.prepare(`
      INSERT INTO maintenance (asset_id, service_provider, description, cost, service_date, next_service_date, completed)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    insertMaintenance.run('URSB-AST-0005', 'Dell Service Centre Kampala', 'Power supply replacement and motherboard diagnostic', 1200000, '2026-06-10', '2026-12-10', 0);

    // Seed requests
    const insertRequest = db.prepare(`
      INSERT INTO requests (requested_by, asset_name, asset_type, purpose, status)
      VALUES (?, ?, ?, ?, ?)
    `);
    insertRequest.run(4, 'iPad Air for Field Registrations', 'Tablet', 'To register local businesses during the rural outreach program.', 'Pending');
    insertRequest.run(3, 'Desktop Monitor 27"', 'Monitor', 'Extra screen real-estate for accounts auditing.', 'Approved');

    // Seed audit logs
    const insertAudit = db.prepare(`
      INSERT INTO audit_log (user_id, username, action_type, table_name, record_id, details)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    insertAudit.run(2, 'manager', 'CREATE', 'assets', 'URSB-AST-0001', 'Created asset URSB-AST-0001 - Lenovo ThinkPad L14');
    insertAudit.run(2, 'manager', 'CREATE', 'assets', 'URSB-AST-0002', 'Created asset URSB-AST-0002 - HP LaserJet Pro M404');
    insertAudit.run(2, 'manager', 'CREATE', 'assets', 'URSB-AST-0003', 'Created asset URSB-AST-0003 - Conference Room Projector Epson');
    insertAudit.run(2, 'manager', 'CREATE', 'assets', 'URSB-AST-0004', 'Created asset URSB-AST-0004 - Executive Leather Desk Chair');
    insertAudit.run(2, 'manager', 'CREATE', 'assets', 'URSB-AST-0005', 'Created asset URSB-AST-0005 - Dell PowerEdge R740 Server');
    insertAudit.run(2, 'manager', 'CREATE', 'assets', 'URSB-AST-0006', 'Created asset URSB-AST-0006 - Broken Office Shredder');
    insertAudit.run(2, 'manager', 'UPDATE', 'assets', 'URSB-AST-0006', 'Disposed asset URSB-AST-0006');

    console.log('Seeded database with initial assets, assignments, requests, and audit logs.');
  }
}

// Initialize database
initDb();

module.exports = {
  db,
  dbPath
};
