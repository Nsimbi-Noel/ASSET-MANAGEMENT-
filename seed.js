const { db } = require('./db');
const { hashPassword } = require('./crypto_utils');

function seedData() {
  console.log('Seeding sample data...');

  const departments = ['Information Technology', 'Administration', 'Finance', 'Registries', 'Legal', 'Human Resources', 'Public Relations'];
  const roles = ['Admin', 'AssetManager', 'AssetCustodian', 'Employee'];
  
  // 1. Create 25 Users
  const userCheck = db.prepare('SELECT COUNT(*) as count FROM users');
  const currentUserCount = userCheck.get().count;
  
  if (currentUserCount < 25) {
    const insertUser = db.prepare(`
      INSERT INTO users (username, password, name, role, department)
      VALUES (?, ?, ?, ?, ?)
    `);

    for (let i = currentUserCount + 1; i <= 25; i++) {
      const username = `user${i}`;
      const name = `Sample User ${i}`;
      const role = roles[i % roles.length];
      const dept = departments[i % departments.length];
      try {
        insertUser.run(username, hashPassword('password123'), name, role, dept);
      } catch (e) {
        // Skip if username exists
      }
    }
    console.log('Sample users created.');
  }

  // 2. Create Sample Assets
  const assetCheck = db.prepare('SELECT COUNT(*) as count FROM assets');
  if (assetCheck.get().count === 0) {
    const insertAsset = db.prepare(`
      INSERT INTO assets (id, name, type, category, serial_number, condition, acquisition_date, cost, supplier, source, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const assetTypes = [
      { name: 'Dell Latitude 5420', type: 'Laptop', category: 'IT Equipment' },
      { name: 'HP LaserJet Pro', type: 'Printer', category: 'Office Equipment' },
      { name: 'Cisco Router 2900', type: 'Router', category: 'IT Infrastructure' },
      { name: 'Ergonomic Office Chair', type: 'Furniture', category: 'Furniture' },
      { name: 'Samsung 27" Monitor', type: 'Monitor', category: 'IT Equipment' },
      { name: 'Apple MacBook Pro', type: 'Laptop', category: 'IT Equipment' },
      { name: 'Conference Table', type: 'Furniture', category: 'Furniture' },
      { name: 'Air Conditioner', type: 'Fittings', category: 'Fittings' }
    ];

    for (let i = 1; i <= 30; i++) {
      const assetInfo = assetTypes[i % assetTypes.length];
      const id = `URSB-AST-${String(i).padStart(4, '0')}`;
      const serial = `SN-${Math.random().toString(36).substring(2, 10).toUpperCase()}`;
      const condition = ['New', 'Good', 'Refurbished'][i % 3];
      const acqDate = `2024-0${(i % 9) + 1}-15`;
      const cost = 500000 + (Math.random() * 5000000);
      const supplier = ['Dell Uganda', 'HP East Africa', 'Simba Telecom', 'Office World'][i % 4];
      const status = ['Active', 'In Storage', 'Under Maintenance'][i % 3];
      
      insertAsset.run(id, assetInfo.name, assetInfo.type, assetInfo.category, serial, condition, acqDate, cost, supplier, 'Procurement', status);
    }
    console.log('Sample assets created.');
  }

  // 3. Create some assignments
  const assignCheck = db.prepare('SELECT COUNT(*) as count FROM assignments');
  if (assignCheck.get().count === 0) {
    const activeAssets = db.prepare("SELECT id FROM assets WHERE status = 'Active' LIMIT 10").all();
    const employees = db.prepare("SELECT id FROM users WHERE role = 'Employee' LIMIT 10").all();
    const manager = db.prepare("SELECT id FROM users WHERE role = 'AssetManager' LIMIT 1").get();

    if (activeAssets.length > 0 && employees.length > 0 && manager) {
      const insertAssign = db.prepare(`
        INSERT INTO assignments (asset_id, assigned_to, assigned_by, assignment_date, purpose, notes, confirmed_receipt, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      activeAssets.forEach((asset, idx) => {
        if (employees[idx]) {
          insertAssign.run(asset.id, employees[idx].id, manager.id, '2025-01-10', 'Official Work', 'Assigned during orientation', 1, 'Active');
        }
      });
      console.log('Sample assignments created.');
    }
  }

  console.log('Seeding complete.');
}

seedData();
