const { db } = require('./db');
const { hashPassword } = require('./crypto_utils');

// ============================================================
// HELPERS
// ============================================================
function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function randChoice(arr) {
  return arr[randInt(0, arr.length - 1)];
}
function dateOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}
function datetimeOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}
function logAudit(userId, username, actionType, tableName, recordId, details, daysAgo) {
  db.prepare(`
    INSERT INTO audit_log (user_id, username, action_type, table_name, record_id, details, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(userId, username, actionType, tableName, recordId, details, datetimeOffset(-daysAgo));
}

function seedRealisticData() {
  console.log('Seeding realistic URSB demo data with full asset lifecycle...');

  // ============================================================
  // 1. USERS — realistic Ugandan names across roles & departments
  // ============================================================
  const departments = [
    'Companies Registration', 'Business Registration', 'Intellectual Property',
    'Civil Registration', 'Legal & Board Affairs', 'Finance & Administration',
    'Human Resource & Administration', 'Public Relations & Corporate Affairs',
    'Internal Audit', 'Information Technology'
  ];

  const names = [
    'Brenda Namuli', 'David Okello', 'Sarah Atim', 'Solomon Mugisha', 'Patricia Nankya',
    'Edrine Byaruhanga', 'Florence Achen', 'Joel Wamala', 'Sandra Nabirye', 'Geoffrey Ssekandi',
    'Ritah Auma', 'Tonny Kyeyune', 'Diana Nansubuga', 'Vincent Opio', 'Grace Kato',
    'Allan Mwesigwa', 'Esther Namatovu', 'Henry Tumusiime', 'Joan Asiimwe', 'Moses Apio',
    'Catherine Nakimuli', 'Robert Mukasa', 'Brian Twesigye', 'Stella Nakato', 'Isaac Byamukama',
    'Doreen Atimango', 'Charles Ssemwogerere', 'Irene Namugga', 'Felix Odongo', 'Lillian Kembabazi'
  ];

  const userCheck = db.prepare('SELECT COUNT(*) as count FROM users');
  const existingUserCount = userCheck.get().count;
  const newUsers = [];

  if (existingUserCount < 20) {
    const insertUser = db.prepare(`
      INSERT INTO users (username, password, name, role, department, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    names.forEach((fullName, idx) => {
      let role;
      if (idx < 3) role = 'AssetManager';
      else if (idx < 9) role = 'AssetCustodian';
      else role = 'Employee';

      const dept = departments[idx % departments.length];
      const username = fullName.toLowerCase().split(' ').join('.');
      const createdDaysAgo = randInt(200, 720);

      try {
        const result = insertUser.run(
          username, hashPassword('password123'), fullName, role, dept,
          datetimeOffset(-createdDaysAgo)
        );
        newUsers.push({ id: result.lastInsertRowid, name: fullName, username, role, department: dept });
        logAudit(1, 'admin', 'CREATE', 'users', String(result.lastInsertRowid), `Created user account: ${username} (${role})`, createdDaysAgo);
      } catch (e) { /* username collision — skip */ }
    });
    console.log(`Created ${newUsers.length} realistic user accounts.`);
  }

  // Resolve a default manager (the 'manager' account from db.js init) for actions below
  const defaultManager = db.prepare("SELECT id, username, name FROM users WHERE username = 'manager'").get();
  const managerId = defaultManager ? defaultManager.id : 2;
  const managerUsername = defaultManager ? defaultManager.username : 'manager';

  // Pool of people who can receive/request assets (custodians + employees)
  let recipientPool = newUsers.filter(u => u.role !== 'AssetManager');
  if (recipientPool.length === 0) {
    recipientPool = db.prepare("SELECT id, name, username, role FROM users WHERE role IN ('AssetCustodian','Employee')").all();
  }

  // ============================================================
  // 2. ASSETS — varied catalog across all asset types
  // ============================================================
  const assetCatalog = [
    { name: 'Dell Latitude 5430 Laptop', type: 'ICT Equipment', category: 'Laptop', supplier: "Riley's Computers Uganda", min: 2800000, max: 3500000 },
    { name: 'HP EliteBook 840 G9', type: 'ICT Equipment', category: 'Laptop', supplier: 'Simba Telecom', min: 3000000, max: 3800000 },
    { name: 'Lenovo ThinkPad T14', type: 'ICT Equipment', category: 'Laptop', supplier: 'Computer Frontiers Uganda', min: 2900000, max: 3600000 },
    { name: 'HP LaserJet Pro M404dn', type: 'ICT Equipment', category: 'Printer', supplier: 'Office World Uganda', min: 1200000, max: 1600000 },
    { name: 'Canon imageRUNNER 2625', type: 'ICT Equipment', category: 'Printer', supplier: 'Bryan Office Solutions', min: 4500000, max: 5200000 },
    { name: 'Samsung 27" Curved Monitor', type: 'ICT Equipment', category: 'Monitor', supplier: "Riley's Computers Uganda", min: 650000, max: 850000 },
    { name: 'Cisco Catalyst 2960 Switch', type: 'ICT Equipment', category: 'Network Device', supplier: 'Roke Telkom', min: 1800000, max: 2400000 },
    { name: 'TP-Link Archer AX55 Router', type: 'ICT Equipment', category: 'Network Device', supplier: 'Roke Telkom', min: 350000, max: 500000 },
    { name: 'Epson EB-X41 Projector', type: 'ICT Equipment', category: 'Projector', supplier: 'Office World Uganda', min: 1900000, max: 2300000 },
    { name: 'Ergonomic Mesh Office Chair', type: 'Furniture', category: 'Office Chair', supplier: 'Vamana Furniture', min: 350000, max: 500000 },
    { name: 'Executive Office Desk', type: 'Furniture', category: 'Desk', supplier: 'Vamana Furniture', min: 900000, max: 1200000 },
    { name: '6-Seater Conference Table', type: 'Furniture', category: 'Conference Table', supplier: 'Mukwano Furniture Works', min: 2500000, max: 3200000 },
    { name: 'Steel Filing Cabinet', type: 'Furniture', category: 'Cabinet', supplier: 'Roofings Group', min: 450000, max: 600000 },
    { name: 'Visitor Waiting Bench', type: 'Furniture', category: 'Seating', supplier: 'Mukwano Furniture Works', min: 600000, max: 800000 },
    { name: 'Toyota Hilux Double Cabin', type: 'Vehicle', category: 'Pickup Truck', supplier: 'CFAO Motors Uganda', min: 130000000, max: 160000000 },
    { name: 'Toyota Land Cruiser Prado', type: 'Vehicle', category: 'SUV', supplier: 'Toyota Uganda', min: 220000000, max: 260000000 },
    { name: 'TVS Star HLX Motorcycle', type: 'Vehicle', category: 'Motorcycle', supplier: 'Spear Motors', min: 6500000, max: 7800000 },
    { name: 'Microsoft 365 Business License', type: 'Software', category: 'License', supplier: 'Microsoft East Africa', min: 450000, max: 600000 },
    { name: 'Kaspersky Endpoint Security License', type: 'Software', category: 'License', supplier: 'Computer Frontiers Uganda', min: 800000, max: 1000000 },
    { name: 'Adobe Acrobat Pro License', type: 'Software', category: 'License', supplier: 'Office World Uganda', min: 350000, max: 450000 },
    { name: 'Diesel Standby Generator 20KVA', type: 'Other', category: 'Generator', supplier: 'Mantrac Uganda', min: 28000000, max: 35000000 },
    { name: 'Split Unit Air Conditioner', type: 'Other', category: 'Air Conditioner', supplier: 'Roofings Group', min: 2200000, max: 2800000 },
    { name: 'Water Dispenser', type: 'Other', category: 'Appliance', supplier: 'Office World Uganda', min: 350000, max: 450000 }
  ];

  const assetCountCheck = db.prepare('SELECT COUNT(*) as count FROM assets');
  const createdAssets = [];

  if (assetCountCheck.get().count === 0) {
    const insertAsset = db.prepare(`
      INSERT INTO assets (id, name, type, category, serial_number, condition, acquisition_date, cost, supplier, source, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const TOTAL_ASSETS = 50;
    for (let i = 1; i <= TOTAL_ASSETS; i++) {
      const tpl = assetCatalog[(i - 1) % assetCatalog.length];
      const id = `URSB-AST-${String(i).padStart(4, '0')}`;
      const serial = `SN-${Math.random().toString(36).substring(2, 9).toUpperCase()}`;
      const condition = randChoice(['New', 'Good', 'Good', 'Refurbished']);
      const acquiredDaysAgo = randInt(60, 900);
      const cost = randInt(tpl.min, tpl.max);
      const source = Math.random() < 0.85 ? 'Procurement' : (Math.random() < 0.5 ? 'Donation' : 'Other');

      insertAsset.run(
        id, tpl.name, tpl.type, tpl.category, serial, condition,
        dateOffset(-acquiredDaysAgo), cost, tpl.supplier, source, 'In Storage',
        datetimeOffset(-acquiredDaysAgo)
      );
      createdAssets.push({ id, name: tpl.name, acquiredDaysAgo });
      logAudit(1, 'admin', 'CREATE', 'assets', id, `Registered asset ${tpl.name} (${id})`, acquiredDaysAgo);
    }
    console.log(`Created ${createdAssets.length} realistic assets.`);
  }

  // ============================================================
  // 3. ASSIGNMENTS — first 30 assets go Active, assigned to staff
  // ============================================================
  const assignmentCheck = db.prepare('SELECT COUNT(*) as count FROM assignments');
  if (assignmentCheck.get().count === 0 && createdAssets.length > 0 && recipientPool.length > 0) {
    const insertAssign = db.prepare(`
      INSERT INTO assignments (asset_id, assigned_to, assigned_by, assignment_date, purpose, notes, confirmed_receipt, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'Active', ?)
    `);
    const setAssetActive = db.prepare("UPDATE assets SET status = 'Active' WHERE id = ?");
    const purposes = ['Official duty station equipment', 'Departmental work tool', 'Field operations', 'Office use', 'Project assignment'];

    createdAssets.slice(0, 30).forEach((asset, idx) => {
      const recipient = recipientPool[idx % recipientPool.length];
      const assignDaysAgo = randInt(10, Math.max(15, asset.acquiredDaysAgo - 5));
      const confirmed = Math.random() < 0.85 ? 1 : 0;
      const purpose = randChoice(purposes);

      const result = insertAssign.run(
        asset.id, recipient.id, managerId, dateOffset(-assignDaysAgo), purpose,
        'Issued during routine asset distribution', confirmed,
        datetimeOffset(-assignDaysAgo)
      );
      setAssetActive.run(asset.id);
      logAudit(managerId, managerUsername, 'CREATE', 'assignments', String(result.lastInsertRowid), `Assigned asset ${asset.id} to ${recipient.name}`, assignDaysAgo);
    });
    console.log('Created assignment history for 30 assets.');
  }

  // ============================================================
  // 4. TRANSFERS — 6 of the assigned assets change custodian
  // ============================================================
  const transferCheck = db.prepare('SELECT COUNT(*) as count FROM transfers');
  if (transferCheck.get().count === 0 && createdAssets.length > 0 && recipientPool.length > 1) {
    const insertTransfer = db.prepare(`
      INSERT INTO transfers (asset_id, from_user_id, to_user_id, transfer_date, reason, authorized_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const returnOld = db.prepare(`UPDATE assignments SET status = 'Returned', returned_date = ?, notes = notes || ' (Transferred out)' WHERE asset_id = ? AND status = 'Active'`);
    const insertNewAssign = db.prepare(`
      INSERT INTO assignments (asset_id, assigned_to, assigned_by, assignment_date, purpose, notes, confirmed_receipt, status, created_at)
      VALUES (?, ?, ?, ?, 'Transferred from previous custodian', 'Reassigned via internal transfer', 1, 'Active', ?)
    `);
    const reasons = ['Departmental restructuring', 'Staff relocation to another department', 'Promotion to new duty station', 'Reassignment for project needs'];

    createdAssets.slice(0, 6).forEach((asset, idx) => {
      const activeAssign = db.prepare("SELECT * FROM assignments WHERE asset_id = ? AND status = 'Active'").get(asset.id);
      if (!activeAssign) return;
      const fromUserId = activeAssign.assigned_to;
      let toUser = recipientPool[(idx + 7) % recipientPool.length];
      if (toUser.id === fromUserId) toUser = recipientPool[(idx + 8) % recipientPool.length];

      const transferDaysAgo = randInt(5, 60);
      returnOld.run(dateOffset(-transferDaysAgo), asset.id);
      insertNewAssign.run(asset.id, toUser.id, managerId, dateOffset(-transferDaysAgo), datetimeOffset(-transferDaysAgo));
      insertTransfer.run(asset.id, fromUserId, toUser.id, dateOffset(-transferDaysAgo), randChoice(reasons), managerId, datetimeOffset(-transferDaysAgo));
      logAudit(managerId, managerUsername, 'CREATE', 'transfers', asset.id, `Transferred asset ${asset.id} to ${toUser.name}`, transferDaysAgo);
    });
    console.log('Created transfer history for 6 assets.');
  }

  // ============================================================
  // 5. MAINTENANCE — completed history + open/overdue alerts
  // ============================================================
  const maintCheck = db.prepare('SELECT COUNT(*) as count FROM maintenance');
  if (maintCheck.get().count === 0 && createdAssets.length > 0) {
    const insertMaint = db.prepare(`
      INSERT INTO maintenance (asset_id, service_provider, description, cost, service_date, next_service_date, completed, completion_date, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const providers = ["Riley's Computers Uganda", 'Simba Telecom Service Center', 'Mantrac Uganda', 'CFAO Motors Uganda Workshop', 'Office World Uganda'];
    const descriptions = ['Routine servicing and cleaning', 'Hardware fault repair', 'Software/firmware update', 'Battery replacement', 'General inspection and tune-up'];

    // 5a. Completed history on assets already Active (indices 20-27, within the assigned range)
    createdAssets.slice(20, 28).forEach(asset => {
      const serviceDaysAgo = randInt(40, 200);
      const completionDaysAgo = serviceDaysAgo - randInt(2, 7);
      const result = insertMaint.run(
        asset.id, randChoice(providers), randChoice(descriptions), randInt(80000, 400000),
        dateOffset(-serviceDaysAgo), dateOffset(-serviceDaysAgo + 180), 1, dateOffset(-completionDaysAgo),
        datetimeOffset(-serviceDaysAgo)
      );
      logAudit(managerId, managerUsername, 'UPDATE', 'maintenance', String(result.lastInsertRowid), `Completed maintenance on asset ${asset.id}`, completionDaysAgo);
    });

    // 5b. Open maintenance — asset goes 'Under Maintenance', mix of overdue & due-soon (triggers dashboard alerts)
    const setUnderMaintenance = db.prepare("UPDATE assets SET status = 'Under Maintenance' WHERE id = ?");
    createdAssets.slice(30, 36).forEach((asset, idx) => {
      const serviceDaysAgo = randInt(2, 20);
      const nextServiceOffset = idx % 2 === 0 ? randInt(-5, -1) : randInt(5, 25);
      const result = insertMaint.run(
        asset.id, randChoice(providers), randChoice(descriptions), randInt(80000, 500000),
        dateOffset(-serviceDaysAgo), dateOffset(nextServiceOffset), 0, null,
        datetimeOffset(-serviceDaysAgo)
      );
      setUnderMaintenance.run(asset.id);
      logAudit(managerId, managerUsername, 'CREATE', 'maintenance', String(result.lastInsertRowid), `Opened maintenance for asset ${asset.id}`, serviceDaysAgo);
    });
    console.log('Created maintenance history (8 completed, 6 open — mix of overdue and due-soon).');
  }

  // ============================================================
  // 6. DISPOSALS — 4 assets retired
  // ============================================================
  const disposalCheck = db.prepare('SELECT COUNT(*) as count FROM disposals');
  if (disposalCheck.get().count === 0 && createdAssets.length > 0) {
    const insertDisposal = db.prepare(`
      INSERT INTO disposals (asset_id, disposal_date, method, reason, authorized_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const setDisposed = db.prepare("UPDATE assets SET status = 'Disposed' WHERE id = ?");
    const terminateAssignments = db.prepare(`UPDATE assignments SET status = 'Returned', returned_date = ?, notes = notes || ' (Terminated due to asset disposal)' WHERE asset_id = ? AND status = 'Active'`);
    const methods = ['Write-off', 'Donation', 'Sale', 'Destruction'];
    const reasons = ['Beyond economical repair', 'Obsolete and replaced with newer model', 'Damaged beyond use', 'End of useful life'];

    createdAssets.slice(36, 40).forEach(asset => {
      const disposalDaysAgo = randInt(3, 90);
      terminateAssignments.run(dateOffset(-disposalDaysAgo), asset.id);
      setDisposed.run(asset.id);
      insertDisposal.run(asset.id, dateOffset(-disposalDaysAgo), randChoice(methods), randChoice(reasons), managerId, datetimeOffset(-disposalDaysAgo));
      logAudit(managerId, managerUsername, 'CREATE', 'disposals', asset.id, `Disposed asset ${asset.id}`, disposalDaysAgo);
    });
    console.log('Created disposal records for 4 assets.');
    console.log('10 assets remain unassigned in storage as spare stock.');
  }

  // ============================================================
  // 7. ASSET REQUESTS — pending / approved / rejected mix
  // ============================================================
  const requestCheck = db.prepare('SELECT COUNT(*) as count FROM requests');
  if (requestCheck.get().count === 0 && recipientPool.length > 0) {
    const insertRequest = db.prepare(`
      INSERT INTO requests (requested_by, asset_name, asset_type, purpose, status, manager_notes, actioned_by, actioned_date, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const sampleRequests = [
      { name: 'Laptop', type: 'ICT Equipment', purpose: 'Need a laptop for remote case processing duties' },
      { name: 'Office Chair', type: 'Furniture', purpose: 'Current chair is broken and unsafe to use' },
      { name: 'Printer', type: 'ICT Equipment', purpose: 'Department printer shared by 12 staff is insufficient' },
      { name: 'Projector', type: 'ICT Equipment', purpose: 'Required for monthly stakeholder presentations' },
      { name: 'Filing Cabinet', type: 'Furniture', purpose: 'Need secure storage for confidential client files' },
      { name: 'Desktop Computer', type: 'ICT Equipment', purpose: 'Replacing an outdated unit that frequently crashes' }
    ];

    sampleRequests.forEach((reqItem, idx) => {
      const requester = recipientPool[idx % recipientPool.length];
      const requestDaysAgo = randInt(2, 45);
      let status = 'Pending', notes = null, actionedBy = null, actionedDate = null;

      if (idx % 3 === 1) {
        status = 'Approved';
        notes = 'Approved - within department budget allocation';
        actionedBy = managerId;
        actionedDate = dateOffset(-(requestDaysAgo - 2));
      } else if (idx % 3 === 2) {
        status = 'Rejected';
        notes = 'Rejected - similar asset already assigned to this department';
        actionedBy = managerId;
        actionedDate = dateOffset(-(requestDaysAgo - 1));
      }

      const result = insertRequest.run(
        requester.id, reqItem.name, reqItem.type, reqItem.purpose, status, notes, actionedBy, actionedDate,
        datetimeOffset(-requestDaysAgo)
      );
      logAudit(requester.id, requester.username, 'CREATE', 'requests', String(result.lastInsertRowid), `Submitted request for asset: ${reqItem.name}`, requestDaysAgo);
      if (status !== 'Pending') {
        logAudit(managerId, managerUsername, 'UPDATE', 'requests', String(result.lastInsertRowid), `${status} asset request id ${result.lastInsertRowid}`, requestDaysAgo - 1);
      }
    });
    console.log('Created 6 sample asset requests (mix of pending/approved/rejected).');
  }

  console.log('Realistic seeding complete.');
}

seedRealisticData();
