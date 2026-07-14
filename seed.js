const { db } = require('./db');
const { hashPassword } = require('./crypto_utils');

function seedData() {
  console.log('Seeding sample data...');

  const departments = ['Information Technology', 'Administration', 'Finance', 'Registries', 'Legal', 'Human Resources', 'Public Relations'];
  const roles = ['Admin', 'AssetManager', 'AssetCustodian', 'Employee'];
  
  // 1. Create 30 Employee Users (to match the 30 sample assets)
  const employeeNames = [
    'Brenda Nansubuga', 'James Okello', 'Grace Nakato', 'Brian Mugisha', 'Patricia Achieng',
    'Allan Kato', 'Sarah Namutebi', 'Moses Ssemwogerere', 'Esther Nabirye', 'Daniel Wasswa',
    'Florence Atim', 'Joseph Lubega', 'Agnes Kobusingye', 'Robert Tumusiime', 'Joyce Birungi',
    'Peter Ochieng', 'Mary Nankya', 'Henry Byaruhanga', 'Christine Nalubega', 'Charles Opio',
    'Diana Nantongo', 'Andrew Were', 'Ruth Akello', 'David Mubiru', 'Catherine Namugga',
    'Samuel Kintu', 'Irene Apio', 'Paul Tugume', 'Harriet Nansamba', 'Tom Egadu'
  ];

  const employeeCheck = db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'Employee'");
  const currentEmployeeCount = employeeCheck.get().count;

  if (currentEmployeeCount < 30) {
    const insertUser = db.prepare(`
      INSERT INTO users (username, password, name, role, department)
      VALUES (?, ?, ?, ?, ?)
    `);

    for (let i = currentEmployeeCount + 1; i <= 30; i++) {
      const username = `employee${i}`;
      const name = employeeNames[(i - 1) % employeeNames.length];
      const dept = departments[i % departments.length];
      try {
        insertUser.run(username, hashPassword('password123'), name, 'Employee', dept);
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
      const acqMonth = ((i * 2) % 18) + 1; // spread across 18 months
      const acqYear = acqMonth <= 12 ? 2024 : 2025;
      const acqMonthNorm = acqMonth <= 12 ? acqMonth : acqMonth - 12;
      const acqDate = `${acqYear}-${String(acqMonthNorm).padStart(2, '0')}-15`;
      const cost = 500000 + (Math.random() * 5000000);
      const supplier = ['Dell Uganda', 'HP East Africa', 'Simba Telecom', 'Office World'][i % 4];
      const status = ['Active', 'In Storage', 'Under Maintenance'][i % 3];
      
      insertAsset.run(id, assetInfo.name, assetInfo.type, assetInfo.category, serial, condition, acqDate, cost, supplier, 'Procurement', status);
    }
    console.log('Sample assets created.');
  }

  // 2b. Backfill a maintenance record for every asset that is marked
  // 'Under Maintenance' but has no OPEN maintenance row (completed = 0)
  // pointing at it - an "orphaned" Under Maintenance asset. This can happen
  // either from the sample assets seeded above, or from an older copy of
  // this database seeded before this backfill existed. The Maintenance
  // screen, progress tracking, and "ready for review" notifications are all
  // driven off the `maintenance` table (joined to assets), not the asset's
  // status column alone - so an orphaned asset shows that status everywhere
  // else but never actually appears on the Maintenance screen, and a manager
  // has no way to act on or close it out.
  //
  // Unlike the blocks above, this check is NOT gated on "table is empty" -
  // it re-evaluates from scratch every run, so re-running `node seed.js` on
  // an existing database will keep fixing this instead of silently skipping
  // it forever. It's still safe to run repeatedly: once an asset has an open
  // maintenance row (whether backfilled here or created normally through the
  // app), it no longer matches the orphan query below, so nothing is ever
  // inserted twice.
  const orphanedUnderMaintenance = db.prepare(`
    SELECT a.id, a.name FROM assets a
    WHERE a.status = 'Under Maintenance'
    AND NOT EXISTS (
      SELECT 1 FROM maintenance m WHERE m.asset_id = a.id AND m.completed = 0
    )
  `).all();

  if (orphanedUnderMaintenance.length > 0) {
    const serviceProviders = ['Kampala IT Services', 'Simba Telecom Repairs', 'Office World Servicing', 'Uganda Tech Solutions'];

    const insertMaint = db.prepare(`
      INSERT INTO maintenance (asset_id, service_provider, description, cost, service_date, next_service_date, estimated_duration_days, expected_completion_date, completed)
      VALUES (?, ?, ?, ?, ?, ?, ?, date(?, '+' || ? || ' days'), 0)
    `);

    const addDays = (days) => {
      const d = new Date();
      d.setDate(d.getDate() + days);
      return d.toISOString().slice(0, 10);
    };

    // Spread the backfilled jobs across the three "in-flight" progress states
    // (Ready for Review / In Progress / Scheduled) so the Maintenance
    // screen and notification system have something realistic to show
    // for each, rather than everything landing in one state.
    orphanedUnderMaintenance.forEach((asset, idx) => {
      const provider = serviceProviders[idx % serviceProviders.length];
      let serviceDate, durationDays;

      if (idx % 3 === 0) {
        // Estimated completion has already passed -> Ready for Review.
        serviceDate = addDays(-10);
        durationDays = 5;
      } else if (idx % 3 === 1) {
        // Underway, expected completion still ahead -> In Progress.
        serviceDate = addDays(-2);
        durationDays = 7;
      } else {
        // Hasn't started yet -> Scheduled.
        serviceDate = addDays(7);
        durationDays = 5;
      }
      const nextServiceDate = addDays(180 + idx); // routine follow-up service, well in the future

      insertMaint.run(
        asset.id, provider, `Routine servicing for ${asset.name}`, 150000 + (idx * 25000),
        serviceDate, nextServiceDate, durationDays, serviceDate, durationDays
      );
    });
    console.log(`Backfilled ${orphanedUnderMaintenance.length} maintenance record(s) for orphaned Under Maintenance asset(s).`);
  }

  // 3. Create some assignments (leave a few Active assets unassigned so they show as "Available")
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

      const assetsToAssign = activeAssets.slice(0, 6); // leave the remaining Active assets available
      assetsToAssign.forEach((asset, idx) => {
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
