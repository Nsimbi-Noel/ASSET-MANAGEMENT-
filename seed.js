const { db } = require('./db');
const { hashPassword } = require('./crypto_utils');

function seedData() {
  return seedDataAsync();
}

async function seedDataAsync() {
  console.log('Seeding sample data...');

  const departments = ['Information Technology', 'Administration', 'Finance', 'Registries', 'Legal', 'Human Resources', 'Public Relations'];
  const roles = ['Admin', 'AssetManager', 'Employee'];
  
  // 1. Create 30 Employee Users (to match the 30 sample assets)
  const employeeNames = [
    'Brenda Nansubuga', 'James Okello', 'Grace Nakato', 'Brian Mugisha', 'Patricia Achieng',
    'Allan Kato', 'Sarah Namutebi', 'Moses Ssemwogerere', 'Esther Nabirye', 'Daniel Wasswa',
    'Florence Atim', 'Joseph Lubega', 'Agnes Kobusingye', 'Robert Tumusiime', 'Joyce Birungi',
    'Peter Ochieng', 'Mary Nankya', 'Henry Byaruhanga', 'Christine Nalubega', 'Charles Opio',
    'Diana Nantongo', 'Andrew Were', 'Ruth Akello', 'David Mubiru', 'Catherine Namugga',
    'Samuel Kintu', 'Irene Apio', 'Paul Tugume', 'Harriet Nansamba', 'Tom Egadu'
  ];

  const userCheck = db.prepare('SELECT COUNT(*) as count FROM users');
  const currentUserCount = userCheck.get().count;
  const targetUserCount = 200;

  if (currentUserCount > targetUserCount) {
    const deleteUsers = currentUserCount - targetUserCount;
    db.prepare(`
      DELETE FROM users
      WHERE id IN (
        SELECT id FROM users
        WHERE username LIKE 'user%'
        ORDER BY id DESC
        LIMIT ?
      )
    `).run(deleteUsers);
    console.log(`Removed ${deleteUsers} extra seeded users to keep the dataset at ${targetUserCount}.`);
  }

  if (currentUserCount < targetUserCount) {
    const insertUser = db.prepare(`
      INSERT INTO users (username, password, name, role, department)
      VALUES (?, ?, ?, ?, ?)
    `);

    const extraFirstNames = ['Alice', 'Bernard', 'Clara', 'David', 'Evelyn', 'Frank', 'Gillian', 'Harold', 'Irene', 'Joseph', 'Kemi', 'Lucas', 'Martha', 'Nathan', 'Odong', 'Patricia', 'Quentin', 'Rosaline', 'Samuel', 'Theresa', 'Umar', 'Victoria', 'Wambui', 'Xavier', 'Yvonne', 'Zed'];
    const extraLastNames = ['Bakare', 'Chan', 'Dlamini', 'Ekundayo', 'Fahim', 'Gonzalez', 'Hassan', 'Ibrahim', 'Juma', 'Kebede', 'Lule', 'Mugisha', 'Nabirye', 'Okoth', 'Patel', 'Quartey', 'Rukundo', 'Ssewankambo', 'Tumusiime', 'Umaru', 'Vanessa', 'Wanjiru', 'Yusuf', 'Zainab'];
    const roleBuckets = [];

    for (let i = 0; i < 10; i++) roleBuckets.push('AssetManager');
    for (let i = roleBuckets.length; i < targetUserCount - currentUserCount; i++) roleBuckets.push('Employee');

    const totalToCreate = targetUserCount - currentUserCount;
    for (let i = 0; i < totalToCreate; i++) {
      const username = `user${currentUserCount + i + 1}`;
      const first = extraFirstNames[i % extraFirstNames.length];
      const last = extraLastNames[(i + 3) % extraLastNames.length];
      const name = `${first} ${last}`;
      const role = roleBuckets[i] || 'Employee';
      const dept = departments[i % departments.length];
      try {
        insertUser.run(username, await hashPassword('password123'), name, role, dept);
      } catch (e) {
        // Skip if username exists
      }
    }
    console.log(`Seeded ${targetUserCount - currentUserCount} additional users.`);
  }

  // 2. Create Sample Assets
  const assetCheck = db.prepare('SELECT COUNT(*) as count FROM assets');
  const existingAssetCount = assetCheck.get().count;
  const targetAssetCount = 500;

  if (existingAssetCount > targetAssetCount) {
    const deleteAssets = existingAssetCount - targetAssetCount;
    const assetsToDelete = db.prepare(`
      SELECT id FROM assets
      ORDER BY id DESC
      LIMIT ?
    `).all(deleteAssets).map(row => row.id);

    if (assetsToDelete.length > 0) {
      const deleteAssignments = db.prepare(`DELETE FROM assignments WHERE asset_id IN (${assetsToDelete.map(() => '?').join(',')})`);
      const deleteMaintenance = db.prepare(`DELETE FROM maintenance WHERE asset_id IN (${assetsToDelete.map(() => '?').join(',')})`);
      const deleteDisposals = db.prepare(`DELETE FROM disposals WHERE asset_id IN (${assetsToDelete.map(() => '?').join(',')})`);
      const deleteTransfers = db.prepare(`DELETE FROM transfers WHERE asset_id IN (${assetsToDelete.map(() => '?').join(',')})`);

      deleteAssignments.run(...assetsToDelete);
      deleteMaintenance.run(...assetsToDelete);
      deleteDisposals.run(...assetsToDelete);
      deleteTransfers.run(...assetsToDelete);

      db.prepare(`
        DELETE FROM assets
        WHERE id IN (${assetsToDelete.map(() => '?').join(',')})
      `).run(...assetsToDelete);
    }

    console.log(`Removed ${deleteAssets} extra assets so the dataset remains at ${targetAssetCount}.`);
  }

  if (existingAssetCount < targetAssetCount) {
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
      { name: 'Air Conditioner', type: 'Fittings', category: 'Fittings' },
      { name: 'Projector X200', type: 'Projector', category: 'IT Equipment' },
      { name: 'Network Switch 48-Port', type: 'Switch', category: 'IT Infrastructure' }
    ];

    const suppliers = ['Dell Uganda', 'HP East Africa', 'Simba Telecom', 'Office World', 'Airtel Business', 'Samsung East Africa'];
    const sources = ['Procurement', 'Donation', 'Lease'];
    const conditions = ['New', 'Good', 'Refurbished'];
    const statuses = ['Active', 'In Storage', 'Under Maintenance', 'Disposed'];

    const currentYear = new Date().getFullYear();
    const assetTotalToAdd = targetAssetCount - existingAssetCount;
    const monthDistribution = [60, 45, 80, 35, 70, 50, 60]; // Jan–Jul distribution with ups and downs
    let remainingToAdd = assetTotalToAdd;
    let overallIndex = existingAssetCount;

    for (let monthIdx = 0; monthIdx < monthDistribution.length && remainingToAdd > 0; monthIdx++) {
      const month = monthIdx + 1;
      const countForMonth = Math.min(monthDistribution[monthIdx], remainingToAdd);
      for (let j = 0; j < countForMonth; j++) {
        overallIndex += 1;
        const assetInfo = assetTypes[(overallIndex - 1) % assetTypes.length];
        const id = `URSB-AST-${String(overallIndex).padStart(4, '0')}`;
        const serial = `SN-${Math.random().toString(36).substring(2, 10).toUpperCase()}`;
        const condition = conditions[overallIndex % conditions.length];
        const day = 5 + ((overallIndex - 1) % 20);
        const acquisitionDate = `${currentYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const cost = Math.round(500000 + Math.random() * 4500000);
        const supplier = suppliers[overallIndex % suppliers.length];
        const source = sources[overallIndex % sources.length];
        const status = statuses[overallIndex % statuses.length];

        insertAsset.run(id, assetInfo.name, assetInfo.type, assetInfo.category, serial, condition, acquisitionDate, cost, supplier, source, status);
      }
      remainingToAdd -= countForMonth;
    }
    console.log(`Seeded ${assetTotalToAdd} additional assets.`);
  }

  // Normalize acquisition dates for the retained 500 assets so the trend has an up/down pattern.
  const finalAssetCount = db.prepare('SELECT COUNT(*) as count FROM assets').get().count;
  if (finalAssetCount === targetAssetCount) {
    const distribution = [60, 45, 80, 35, 70, 50, 60];
    const assetsToUpdate = db.prepare('SELECT id FROM assets ORDER BY id ASC LIMIT ?').all(targetAssetCount);
    const updateAssetDate = db.prepare('UPDATE assets SET acquisition_date = ? WHERE id = ?');
    let updateIndex = 0;

    for (let month = 1; month <= distribution.length; month++) {
      const countForMonth = distribution[month - 1];
      for (let i = 0; i < countForMonth && updateIndex < assetsToUpdate.length; i++, updateIndex++) {
        const asset = assetsToUpdate[updateIndex];
        const day = 5 + (updateIndex % 20);
        const acquisitionDate = `${new Date().getFullYear()}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        updateAssetDate.run(acquisitionDate, asset.id);
      }
    }
    console.log('Normalized acquisition dates for all 500 assets to create a varied monthly trend.');
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

seedData().then(() => {
  console.log('Done.');
}).catch((err) => {
  console.error('Seeding failed:', err);
  process.exit(1);
});
