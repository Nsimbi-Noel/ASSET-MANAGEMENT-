const { db } = require('./db');
const { verifyPassword, hashPassword } = require('./crypto_utils');
const crypto = require('crypto');

// --- Helper Functions ---

/**
 * Log an action to the audit trail.
 * Must be executed within DB transactions if part of a multi-table change.
 */
function logAudit(userId, username, actionType, tableName, recordId, details) {
  const insert = db.prepare(`
    INSERT INTO audit_log (user_id, username, action_type, table_name, record_id, details)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  insert.run(userId, username, actionType, tableName, recordId, details);
}

/**
 * Generate a new unique Asset ID (e.g. URSB-AST-0007)
 */
function generateAssetId() {
  const query = db.prepare(`
    SELECT id FROM assets 
    WHERE id LIKE 'URSB-AST-%' 
    ORDER BY CAST(SUBSTR(id, 10) AS INTEGER) DESC 
    LIMIT 1
  `);
  const row = query.get();
  if (!row) return 'URSB-AST-0001';
  
  const lastNum = parseInt(row.id.replace('URSB-AST-', ''), 10);
  const nextNum = lastNum + 1;
  return `URSB-AST-${String(nextNum).padStart(4, '0')}`;
}

// --- Authentication Controllers ---

function login(username, password) {
  const query = db.prepare('SELECT * FROM users WHERE username = ?');
  const user = query.get(username);
  
  if (!user) {
    throw new Error('Invalid username or password');
  }
  
  if (user.status !== 'Active') {
    throw new Error('This user account has been deactivated');
  }
  
  const isMatch = verifyPassword(password, user.password);
  if (!isMatch) {
    throw new Error('Invalid username or password');
  }
  
  // Generate session token (using native crypto)
  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24 hours expiry
  
  const insertSession = db.prepare('INSERT INTO sessions (session_id, user_id, expires_at) VALUES (?, ?, ?)');
  insertSession.run(sessionId, user.id, expiresAt);
  
  // Log login audit
  logAudit(user.id, user.username, 'LOGIN', 'users', String(user.id), `User logged in successfully`);
  
  return {
    sessionId,
    user: {
      id: user.id,
      username: user.username,
      name: user.name,
      role: user.role,
      department: user.department
    }
  };
}

function logout(sessionId) {
  const sessionQuery = db.prepare('SELECT user_id FROM sessions WHERE session_id = ?');
  const session = sessionQuery.get(sessionId);
  
  if (session) {
    const userQuery = db.prepare('SELECT username FROM users WHERE id = ?');
    const user = userQuery.get(session.user_id);
    const username = user ? user.username : 'unknown';
    
    logAudit(session.user_id, username, 'LOGOUT', 'users', String(session.user_id), `User logged out`);
    
    const deleteSession = db.prepare('DELETE FROM sessions WHERE session_id = ?');
    deleteSession.run(sessionId);
  }
  return { success: true };
}

function getSession(sessionId) {
  const query = db.prepare(`
    SELECT u.id, u.username, u.name, u.role, u.department, u.status, s.expires_at 
    FROM sessions s
    JOIN users u ON s.user_id = u.id
    WHERE s.session_id = ?
  `);
  const row = query.get(sessionId);
  
  if (!row) return null;
  
  // Check if expired
  if (new Date(row.expires_at) < new Date()) {
    const deleteSession = db.prepare('DELETE FROM sessions WHERE session_id = ?');
    deleteSession.run(sessionId);
    return null;
  }
  
  if (row.status !== 'Active') {
    return null;
  }
  
  return {
    id: row.id,
    username: row.username,
    name: row.name,
    role: row.role,
    department: row.department
  };
}

// --- User Management (Admin Only) ---

function listUsers(reqUser) {
  // Admins manage accounts; Asset Managers need this list to assign/transfer
  // assets to employees and custodians, so they must be allowed to read it too.
  if (reqUser.role !== 'Admin' && reqUser.role !== 'AssetManager') {
    throw new Error('Unauthorized');
  }
  const query = db.prepare('SELECT id, username, name, role, department, status, created_at FROM users');
  return query.all();
}

function createUser(reqUser, { username, password, name, role, department }) {
  if (reqUser.role !== 'Admin') throw new Error('Unauthorized');
  
  if (!username || !password || !name || !role || !department) {
    throw new Error('All fields are required');
  }
  
  const existingCheck = db.prepare('SELECT id FROM users WHERE username = ?');
  if (existingCheck.get(username)) {
    throw new Error('Username is already taken');
  }
  
  const insert = db.prepare(`
    INSERT INTO users (username, password, name, role, department)
    VALUES (?, ?, ?, ?, ?)
  `);
  const result = insert.run(username, hashPassword(password), name, role, department);
  const newId = result.lastInsertRowid;
  
  logAudit(reqUser.id, reqUser.username, 'CREATE', 'users', String(newId), `Created user account: ${username} (${role})`);
  return { id: newId, username, name, role, department, status: 'Active' };
}

function updateUser(reqUser, id, { name, role, department, status }) {
  if (reqUser.role !== 'Admin') throw new Error('Unauthorized');
  
  // Protect self-role updates or self-deactivation to avoid locking out the current admin
  if (reqUser.id === parseInt(id, 10)) {
    if (status && status !== 'Active') {
      throw new Error('You cannot deactivate your own admin account.');
    }
  }

  const update = db.prepare(`
    UPDATE users 
    SET name = ?, role = ?, department = ?, status = ?
    WHERE id = ?
  `);
  update.run(name, role, department, status, id);
  
  logAudit(reqUser.id, reqUser.username, 'UPDATE', 'users', String(id), `Updated user ${id} profile details`);
  return { id, name, role, department, status };
}

function changePassword(reqUser, id, { newPassword }) {
  if (reqUser.role !== 'Admin') throw new Error('Unauthorized');
  if (!newPassword || newPassword.length < 6) {
    throw new Error('Password must be at least 6 characters long');
  }
  
  const update = db.prepare('UPDATE users SET password = ? WHERE id = ?');
  update.run(hashPassword(newPassword), id);
  
  const userQuery = db.prepare('SELECT username FROM users WHERE id = ?');
  const targetUser = userQuery.get(id);
  const targetUsername = targetUser ? targetUser.username : String(id);
  
  logAudit(reqUser.id, reqUser.username, 'UPDATE', 'users', String(id), `Changed password for user ${targetUsername}`);
  return { success: true };
}

function changeOwnPassword(user, { currentPassword, newPassword }) {
  const query = db.prepare('SELECT * FROM users WHERE id = ?');
  const dbUser = query.get(user.id);

  if (!dbUser) throw new Error('User not found');
  if (!verifyPassword(currentPassword, dbUser.password)) {
    throw new Error('Current password is incorrect');
  }
  if (!newPassword || newPassword.length < 6) {
    throw new Error('New password must be at least 6 characters long');
  }

  const update = db.prepare('UPDATE users SET password = ? WHERE id = ?');
  update.run(hashPassword(newPassword), user.id);

  logAudit(user.id, user.username, 'UPDATE', 'users', String(user.id), 'Changed own password');
  return { success: true };
}

// --- Asset Registration (Asset Manager Only) ---

function listAssets() {
  const query = db.prepare('SELECT * FROM assets ORDER BY created_at DESC');
  return query.all();
}

function getAsset(id) {
  const query = db.prepare('SELECT * FROM assets WHERE id = ?');
  const asset = query.get(id);
  if (!asset) throw new Error('Asset not found');
  return asset;
}

function registerAsset(reqUser, data) {
  if (reqUser.role !== 'AssetManager') throw new Error('Unauthorized');
  
  const { name, type, category, serial_number, condition, acquisition_date, cost, supplier, source, status } = data;
  
  if (!name || !type || !category || !serial_number || !condition || !acquisition_date || !cost || !supplier || !source || !status) {
    throw new Error('Missing mandatory asset registration fields');
  }
  
  const id = generateAssetId();
  const insert = db.prepare(`
    INSERT INTO assets (id, name, type, category, serial_number, condition, acquisition_date, cost, supplier, source, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  db.exec('BEGIN TRANSACTION');
  try {
    insert.run(id, name, type, category, serial_number, condition, acquisition_date, parseFloat(cost), supplier, source, status);
    logAudit(reqUser.id, reqUser.username, 'CREATE', 'assets', id, `Registered asset ${name} (${id})`);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  
  return { id, name, type, category, serial_number, condition, acquisition_date, cost, supplier, source, status };
}

function updateAsset(reqUser, id, data) {
  if (reqUser.role !== 'AssetManager') throw new Error('Unauthorized');

  const asset = getAsset(id);
  if (asset.status === 'Disposed') throw new Error('Cannot edit a disposed asset');

  const { name, type, category, serial_number, condition, acquisition_date, cost, supplier, source, status } = data;

  if (!name || !type || !category || !serial_number || !condition || !acquisition_date || !cost || !supplier || !source || !status) {
    throw new Error('All fields are required to update an asset');
  }

  const update = db.prepare(`
    UPDATE assets
    SET name = ?, type = ?, category = ?, serial_number = ?, condition = ?,
        acquisition_date = ?, cost = ?, supplier = ?, source = ?, status = ?
    WHERE id = ?
  `);
  update.run(name, type, category, serial_number, condition, acquisition_date, parseFloat(cost), supplier, source, status, id);

  logAudit(reqUser.id, reqUser.username, 'UPDATE', 'assets', id, `Updated asset ${name} (${id})`);
  return { success: true };
}

function bulkRegisterAssets(reqUser, { assets }) {
  if (reqUser.role !== 'AssetManager') throw new Error('Unauthorized');
  if (!Array.isArray(assets) || assets.length === 0) {
    throw new Error('Provide an array of asset objects');
  }

  const results = [];
  const errors = [];

  for (let i = 0; i < assets.length; i++) {
    const data = assets[i];
    if (!data.name || !data.type || !data.category || !data.serial_number) {
      errors.push({ row: i + 1, message: 'Missing required fields (name, type, category, serial_number)' });
      continue;
    }
    try {
      const id = generateAssetId();
      const insert = db.prepare(`
        INSERT INTO assets (id, name, type, category, serial_number, condition, acquisition_date, cost, supplier, source, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      insert.run(
        id, data.name, data.type, data.category, data.serial_number,
        data.condition || 'Good',
        data.acquisition_date || new Date().toISOString().split('T')[0],
        parseFloat(data.cost || 0),
        data.supplier || 'Unknown',
        data.source || 'Procurement',
        data.status || 'In Storage'
      );
      logAudit(reqUser.id, reqUser.username, 'CREATE', 'assets', id, `Bulk imported asset ${data.name} (${id})`);
      results.push({ id, name: data.name });
    } catch (err) {
      errors.push({ row: i + 1, message: err.message });
    }
  }

  return { success: true, imported: results.length, errors: errors.length, assets: results, errors };
}

// --- Asset Assignment & Transfers (Asset Manager & Custodians) ---

function listAssignments() {
  const query = db.prepare(`
    SELECT a.*, ast.name as asset_name, ast.serial_number, ast.type as asset_type,
           u1.name as assigned_to_name, u1.department as assigned_to_department,
           u2.name as assigned_by_name
    FROM assignments a
    JOIN assets ast ON a.asset_id = ast.id
    JOIN users u1 ON a.assigned_to = u1.id
    JOIN users u2 ON a.assigned_by = u2.id
    ORDER BY a.assignment_date DESC
  `);
  return query.all();
}

function assignAsset(reqUser, { assetId, assignedTo, assignmentDate, purpose, notes }) {
  if (reqUser.role !== 'AssetManager') throw new Error('Unauthorized');
  
  if (!assetId || !assignedTo || !assignmentDate) {
    throw new Error('Asset, custodian, and date are required fields');
  }
  
  // Enforce assignment rules:
  const asset = getAsset(assetId);
  
  if (asset.status === 'Disposed') {
    throw new Error('Cannot assign a disposed asset');
  }
  if (asset.status === 'Under Maintenance') {
    throw new Error('Cannot assign an asset currently under maintenance');
  }
  
  // Check if asset is already assigned active
  const checkAssignment = db.prepare(`
    SELECT id FROM assignments 
    WHERE asset_id = ? AND status = 'Active'
  `);
  if (checkAssignment.get(assetId)) {
    throw new Error('Asset is already assigned and active');
  }
  
  db.exec('BEGIN TRANSACTION');
  try {
    // 1. Insert assignment
    const insert = db.prepare(`
      INSERT INTO assignments (asset_id, assigned_to, assigned_by, assignment_date, purpose, notes, confirmed_receipt, status)
      VALUES (?, ?, ?, ?, ?, ?, 0, 'Active')
    `);
    const result = insert.run(assetId, assignedTo, reqUser.id, assignmentDate, purpose, notes);
    
    // 2. Set asset status to Active
    const updateAsset = db.prepare("UPDATE assets SET status = 'Active' WHERE id = ?");
    updateAsset.run(assetId);
    
    // 3. Log audit
    const uQuery = db.prepare('SELECT name FROM users WHERE id = ?');
    const destUser = uQuery.get(assignedTo);
    const destName = destUser ? destUser.name : String(assignedTo);
    logAudit(reqUser.id, reqUser.username, 'CREATE', 'assignments', String(result.lastInsertRowid), `Assigned asset ${assetId} to ${destName}`);
    
    db.exec('COMMIT');
    return { success: true, assignmentId: result.lastInsertRowid };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function returnAsset(reqUser, assignmentId, { returnedDate }) {
  if (reqUser.role !== 'AssetManager') throw new Error('Unauthorized');
  if (!returnedDate) throw new Error('Return date is required');
  
  const query = db.prepare('SELECT * FROM assignments WHERE id = ?');
  const assignment = query.get(assignmentId);
  if (!assignment) throw new Error('Assignment record not found');
  if (assignment.status === 'Returned') throw new Error('Asset was already returned');
  
  db.exec('BEGIN TRANSACTION');
  try {
    // 1. Update assignment record
    const update = db.prepare(`
      UPDATE assignments 
      SET status = 'Returned', returned_date = ?
      WHERE id = ?
    `);
    update.run(returnedDate, assignmentId);
    
    // 2. Update asset status to 'In Storage'
    const updateAsset = db.prepare("UPDATE assets SET status = 'In Storage' WHERE id = ?");
    updateAsset.run(assignment.asset_id);
    
    // 3. Log audit
    logAudit(reqUser.id, reqUser.username, 'UPDATE', 'assignments', String(assignmentId), `Returned asset ${assignment.asset_id} to storage`);
    
    db.exec('COMMIT');
    return { success: true };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function confirmReceipt(reqUser, assignmentId) {
  const query = db.prepare('SELECT * FROM assignments WHERE id = ?');
  const assignment = query.get(assignmentId);
  
  if (!assignment) throw new Error('Assignment not found');
  if (assignment.assigned_to !== reqUser.id) throw new Error('Only the assigned custodian can confirm receipt');
  if (assignment.confirmed_receipt === 1) throw new Error('Receipt already confirmed');
  
  const update = db.prepare('UPDATE assignments SET confirmed_receipt = 1 WHERE id = ?');
  update.run(assignmentId);
  
  logAudit(reqUser.id, reqUser.username, 'UPDATE', 'assignments', String(assignmentId), `Confirmed receipt of asset ${assignment.asset_id}`);
  return { success: true };
}

function listTransfers() {
  const query = db.prepare(`
    SELECT t.*, u1.name as from_name, u1.department as from_department,
           u2.name as to_name, u2.department as to_department,
           u3.name as manager_name
    FROM transfers t
    JOIN users u1 ON t.from_user_id = u1.id
    JOIN users u2 ON t.to_user_id = u2.id
    JOIN users u3 ON t.authorized_by = u3.id
    ORDER BY t.transfer_date DESC
  `);
  return query.all();
}

function transferAsset(reqUser, { assetId, toUserId, reason, transferDate }) {
  if (reqUser.role !== 'AssetManager') throw new Error('Unauthorized');
  
  if (!assetId || !toUserId || !reason || !transferDate) {
    throw new Error('All transfer fields (Asset, To User, Reason, Date) are required');
  }
  
  // Find current active assignment
  const activeAssignmentQuery = db.prepare(`
    SELECT * FROM assignments 
    WHERE asset_id = ? AND status = 'Active'
  `);
  const activeAssign = activeAssignmentQuery.get(assetId);
  
  if (!activeAssign) {
    throw new Error('Asset is not currently assigned to any custodian. Assign it directly instead.');
  }
  
  const fromUserId = activeAssign.assigned_to;
  if (fromUserId === parseInt(toUserId, 10)) {
    throw new Error('Cannot transfer an asset to the same custodian.');
  }
  
  db.exec('BEGIN TRANSACTION');
  try {
    // 1. Mark existing assignment as returned
    const returnOld = db.prepare(`
      UPDATE assignments 
      SET status = 'Returned', returned_date = ?, notes = notes || ' (Transferred out)'
      WHERE id = ?
    `);
    returnOld.run(transferDate, activeAssign.id);
    
    // 2. Insert new assignment
    const insertNew = db.prepare(`
      INSERT INTO assignments (asset_id, assigned_to, assigned_by, assignment_date, purpose, notes, confirmed_receipt, status)
      VALUES (?, ?, ?, ?, ?, 'Transferred from previous custodian', 0, 'Active')
    `);
    insertNew.run(assetId, toUserId, reqUser.id, transferDate, activeAssign.purpose);
    
    // 3. Record transfer event
    const insertTransfer = db.prepare(`
      INSERT INTO transfers (asset_id, from_user_id, to_user_id, transfer_date, reason, authorized_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    insertTransfer.run(assetId, fromUserId, toUserId, transferDate, reason, reqUser.id);
    
    // 4. Update asset status (keep Active)
    const updateAsset = db.prepare("UPDATE assets SET status = 'Active' WHERE id = ?");
    updateAsset.run(assetId);
    
    // 5. Log audit
    const uQuery = db.prepare('SELECT name FROM users WHERE id IN (?, ?)');
    const names = uQuery.all(fromUserId, toUserId);
    const fromName = names.find(n => n.id === fromUserId)?.name || String(fromUserId);
    const toName = names.find(n => n.id === parseInt(toUserId, 10))?.name || String(toUserId);
    
    logAudit(reqUser.id, reqUser.username, 'CREATE', 'transfers', assetId, `Transferred asset ${assetId} from ${fromName} to ${toName}`);
    
    db.exec('COMMIT');
    return { success: true };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// --- Asset Maintenance (Asset Manager Only) ---

function listMaintenance() {
  const query = db.prepare(`
    SELECT m.*, a.name as asset_name, a.type as asset_type
    FROM maintenance m
    JOIN assets a ON m.asset_id = a.id
    ORDER BY m.service_date DESC
  `);
  return query.all();
}

function recordMaintenance(reqUser, { assetId, serviceProvider, description, cost, serviceDate, nextServiceDate }) {
  if (reqUser.role !== 'AssetManager') throw new Error('Unauthorized');
  
  if (!assetId || !serviceProvider || !description || !cost || !serviceDate) {
    throw new Error('Asset ID, service provider, description, cost, and service date are required');
  }
  
  const asset = getAsset(assetId);
  if (asset.status === 'Disposed') {
    throw new Error('Cannot schedule maintenance on a disposed asset');
  }
  
  db.exec('BEGIN TRANSACTION');
  try {
    // 1. Create maintenance row
    const insert = db.prepare(`
      INSERT INTO maintenance (asset_id, service_provider, description, cost, service_date, next_service_date, completed)
      VALUES (?, ?, ?, ?, ?, ?, 0)
    `);
    const result = insert.run(assetId, serviceProvider, description, parseFloat(cost), serviceDate, nextServiceDate);
    
    // 2. Set asset status to 'Under Maintenance'
    const updateAsset = db.prepare("UPDATE assets SET status = 'Under Maintenance' WHERE id = ?");
    updateAsset.run(assetId);
    
    // 3. Log audit
    logAudit(reqUser.id, reqUser.username, 'CREATE', 'maintenance', String(result.lastInsertRowid), `Opened maintenance for asset ${assetId}`);
    
    db.exec('COMMIT');
    return { success: true, maintenanceId: result.lastInsertRowid };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function completeMaintenance(reqUser, maintenanceId, { completionDate, nextStatus }) {
  if (reqUser.role !== 'AssetManager') throw new Error('Unauthorized');
  if (!completionDate) throw new Error('Completion date is required');
  
  const query = db.prepare('SELECT * FROM maintenance WHERE id = ?');
  const maint = query.get(maintenanceId);
  if (!maint) throw new Error('Maintenance record not found');
  if (maint.completed === 1) throw new Error('Maintenance event is already closed');
  
  const assetStatus = nextStatus || 'Active'; // default back to Active
  
  db.exec('BEGIN TRANSACTION');
  try {
    // 1. Complete maintenance row
    const updateMaint = db.prepare(`
      UPDATE maintenance 
      SET completed = 1, completion_date = ?
      WHERE id = ?
    `);
    updateMaint.run(completionDate, maintenanceId);
    
    // 2. Return asset status
    const updateAsset = db.prepare('UPDATE assets SET status = ? WHERE id = ?');
    updateAsset.run(assetStatus, maint.asset_id);
    
    // 3. Log audit
    logAudit(reqUser.id, reqUser.username, 'UPDATE', 'maintenance', String(maintenanceId), `Completed maintenance on asset ${maint.asset_id}. Set status to ${assetStatus}`);
    
    db.exec('COMMIT');
    return { success: true };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// --- Asset Disposal (Asset Manager Only) ---

function disposeAsset(reqUser, { assetId, disposalDate, method, reason }) {
  if (reqUser.role !== 'AssetManager') throw new Error('Unauthorized');
  
  if (!assetId || !disposalDate || !method || !reason) {
    throw new Error('All fields (Asset ID, Date, Method, Reason) are required to dispose an asset');
  }
  
  const asset = getAsset(assetId);
  if (asset.status === 'Disposed') {
    throw new Error('Asset is already disposed');
  }
  
  db.exec('BEGIN TRANSACTION');
  try {
    // 1. Insert disposal archive record
    const insert = db.prepare(`
      INSERT INTO disposals (asset_id, disposal_date, method, reason, authorized_by)
      VALUES (?, ?, ?, ?, ?)
    `);
    insert.run(assetId, disposalDate, method, reason, reqUser.id);
    
    // 2. Set asset status to 'Disposed'
    const updateAsset = db.prepare("UPDATE assets SET status = 'Disposed' WHERE id = ?");
    updateAsset.run(assetId);
    
    // 3. Mark any current active assignments as returned (soft disposal auto-termination)
    const terminateAssignments = db.prepare(`
      UPDATE assignments 
      SET status = 'Returned', returned_date = ?, notes = notes || ' (Terminated due to asset disposal)'
      WHERE asset_id = ? AND status = 'Active'
    `);
    terminateAssignments.run(disposalDate, assetId);
    
    // 4. Log audit
    logAudit(reqUser.id, reqUser.username, 'CREATE', 'disposals', assetId, `Disposed asset ${assetId} via ${method}`);
    
    db.exec('COMMIT');
    return { success: true };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// --- Asset Requests (Employees & Managers) ---

function listRequests(reqUser) {
  let query;
  if (reqUser.role === 'Employee') {
    // Employees only view their own requests
    query = db.prepare(`
      SELECT r.*, u.name as requested_by_name, u2.name as actioned_by_name 
      FROM requests r
      JOIN users u ON r.requested_by = u.id
      LEFT JOIN users u2 ON r.actioned_by = u2.id
      WHERE r.requested_by = ?
      ORDER BY r.created_at DESC
    `);
    return query.all(reqUser.id);
  } else {
    // Managers, Admins, Custodians can view all requests
    query = db.prepare(`
      SELECT r.*, u.name as requested_by_name, u2.name as actioned_by_name 
      FROM requests r
      JOIN users u ON r.requested_by = u.id
      LEFT JOIN users u2 ON r.actioned_by = u2.id
      ORDER BY r.created_at DESC
    `);
    return query.all();
  }
}

function createRequest(reqUser, { assetName, assetType, purpose }) {
  if (!assetName || !assetType || !purpose) {
    throw new Error('Asset Name, Type, and Purpose are required to request an asset');
  }
  
  const insert = db.prepare(`
    INSERT INTO requests (requested_by, asset_name, asset_type, purpose, status)
    VALUES (?, ?, ?, ?, 'Pending')
  `);
  const result = insert.run(reqUser.id, assetName, assetType, purpose);
  
  logAudit(reqUser.id, reqUser.username, 'CREATE', 'requests', String(result.lastInsertRowid), `Submitted request for asset: ${assetName}`);
  return { id: result.lastInsertRowid, assetName, assetType, purpose, status: 'Pending' };
}

function actionRequest(reqUser, requestId, { status, managerNotes }) {
  if (reqUser.role !== 'AssetManager') throw new Error('Unauthorized');
  
  if (!status || !['Approved', 'Rejected'].includes(status)) {
    throw new Error('Valid status (Approved or Rejected) is required');
  }
  
  const query = db.prepare('SELECT * FROM requests WHERE id = ?');
  const req = query.get(requestId);
  if (!req) throw new Error('Request not found');
  if (req.status !== 'Pending') throw new Error('Request has already been actioned');
  
  const update = db.prepare(`
    UPDATE requests 
    SET status = ?, manager_notes = ?, actioned_by = ?, actioned_date = date('now')
    WHERE id = ?
  `);
  update.run(status, managerNotes || null, reqUser.id, requestId);
  
  logAudit(reqUser.id, reqUser.username, 'UPDATE', 'requests', String(requestId), `${status} asset request id ${requestId}. Notes: ${managerNotes}`);
  return { success: true };
}

function revokeRequest(reqUser, requestId, { managerNotes }) {
  if (reqUser.role !== 'AssetManager') throw new Error('Unauthorized');

  const query = db.prepare('SELECT * FROM requests WHERE id = ?');
  const req = query.get(requestId);
  if (!req) throw new Error('Request not found');
  if (req.status !== 'Approved') {
    throw new Error('Only previously approved requests can be revoked');
  }

  const note = managerNotes
    ? `Revoked. ${managerNotes}`
    : 'Revoked by Asset Manager';

  const update = db.prepare(`
    UPDATE requests
    SET status = 'Revoked', manager_notes = ?, actioned_by = ?, actioned_date = date('now')
    WHERE id = ?
  `);
  update.run(note, reqUser.id, requestId);

  logAudit(reqUser.id, reqUser.username, 'UPDATE', 'requests', String(requestId), `Revoked previously approved asset request id ${requestId}. Notes: ${managerNotes || ''}`);
  return { success: true };
}

// --- Reports & Dashboards ---

function getDashboardMetrics() {
  // 1. Asset status counts
  const statusQuery = db.prepare('SELECT status, COUNT(*) as count FROM assets GROUP BY status');
  const statusRows = statusQuery.all();
  
  const counts = { Total: 0, Active: 0, InStorage: 0, UnderMaintenance: 0, Disposed: 0 };
  statusRows.forEach(row => {
    counts.Total += row.count;
    if (row.status === 'Active') counts.Active = row.count;
    if (row.status === 'In Storage') counts.InStorage = row.count;
    if (row.status === 'Under Maintenance') counts.UnderMaintenance = row.count;
    if (row.status === 'Disposed') counts.Disposed = row.count;
  });
  
  // 2. Type distribution
  const typeQuery = db.prepare("SELECT type, COUNT(*) as count FROM assets WHERE status != 'Disposed' GROUP BY type");
  const typeDistribution = typeQuery.all();
  
  // 3. Category distribution
  const catQuery = db.prepare("SELECT category, COUNT(*) as count FROM assets WHERE status != 'Disposed' GROUP BY category");
  const categoryDistribution = catQuery.all();
  
  // 4. Assigned vs Unassigned
  const assignedQuery = db.prepare(`
    SELECT 
      SUM(CASE WHEN status = 'Active' AND id IN (SELECT asset_id FROM assignments WHERE status = 'Active') THEN 1 ELSE 0 END) as assigned,
      SUM(CASE WHEN status = 'In Storage' OR (status = 'Active' AND id NOT IN (SELECT asset_id FROM assignments WHERE status = 'Active')) THEN 1 ELSE 0 END) as unassigned
    FROM assets
    WHERE status != 'Disposed'
  `);
  const assignmentRatio = assignedQuery.get() || { assigned: 0, unassigned: 0 };
  
  // 5. Total cost valuation
  const costQuery = db.prepare("SELECT SUM(cost) as total_val FROM assets WHERE status != 'Disposed'");
  const costVal = costQuery.get()?.total_val || 0;

  // 6. Upcoming Maintenance (in next 30 days or overdue)
  const maintenanceQuery = db.prepare(`
    SELECT m.*, a.name as asset_name 
    FROM maintenance m
    JOIN assets a ON m.asset_id = a.id
    WHERE m.completed = 0 AND (
      m.next_service_date <= date('now', '+30 days') OR m.service_date <= date('now')
    )
    ORDER BY m.next_service_date ASC
  `);
  const upcomingMaintenance = maintenanceQuery.all();

  // 7. Asset acquisition trend (assets added per month)
  const trendQuery = db.prepare(`
    SELECT strftime('%Y-%m', acquisition_date) as month, COUNT(*) as count
    FROM assets
    WHERE acquisition_date IS NOT NULL
    GROUP BY month
    ORDER BY month ASC
  `);
  const acquisitionTrend = trendQuery.all();

  // 8. Asset availability list (for request reference table)
  const availabilityQuery = db.prepare(`
    SELECT a.id, a.name, a.category, a.type, a.status,
      CASE
        WHEN a.status = 'Active' AND a.id NOT IN (SELECT asset_id FROM assignments WHERE status = 'Active') THEN 'Available'
        ELSE 'Unavailable'
      END as availability
    FROM assets a
    WHERE a.status != 'Disposed'
    ORDER BY a.name ASC
  `);
  const assetAvailability = availabilityQuery.all();

  return {
    counts,
    typeDistribution,
    categoryDistribution,
    assignmentRatio,
    totalValuation: costVal,
    upcomingMaintenance,
    acquisitionTrend,
    assetAvailability
  };
}

function generateAssetRegister(filters = {}) {
  let queryStr = `
    SELECT a.*, 
           assign.assignment_date, assign.notes as assignment_notes, 
           u.name as custodian_name, u.department as custodian_department
    FROM assets a
    LEFT JOIN assignments assign ON a.id = assign.asset_id AND assign.status = 'Active'
    LEFT JOIN users u ON assign.assigned_to = u.id
    WHERE 1=1
  `;
  
  const params = [];
  
  if (filters.status) {
    queryStr += ' AND a.status = ?';
    params.push(filters.status);
  } else {
    // Default: show active lists (excluding Disposed unless requested)
    queryStr += " AND a.status != 'Disposed'";
  }
  
  if (filters.type) {
    queryStr += ' AND a.type = ?';
    params.push(filters.type);
  }
  
  if (filters.department) {
    queryStr += ' AND u.department = ?';
    params.push(filters.department);
  }
  
  if (filters.custodian) {
    queryStr += ' AND u.id = ?';
    params.push(filters.custodian);
  }
  
  queryStr += ' ORDER BY a.id ASC';
  
  const query = db.prepare(queryStr);
  return query.all(...params);
}

function getAssetHistory(assetId) {
  // Get main asset record
  const asset = getAsset(assetId);
  
  // 1. Assignment history
  const assignmentsQuery = db.prepare(`
    SELECT a.*, u1.name as custodian_name, u1.department as assigned_to_department, u2.name as manager_name
    FROM assignments a
    JOIN users u1 ON a.assigned_to = u1.id
    JOIN users u2 ON a.assigned_by = u2.id
    WHERE a.asset_id = ?
    ORDER BY a.assignment_date DESC
  `);
  const assignments = assignmentsQuery.all(assetId);
  
  // 2. Transfer history
  const transfersQuery = db.prepare(`
    SELECT t.*, u1.name as from_name, u2.name as to_name, u3.name as manager_name
    FROM transfers t
    JOIN users u1 ON t.from_user_id = u1.id
    JOIN users u2 ON t.to_user_id = u2.id
    JOIN users u3 ON t.authorized_by = u3.id
    WHERE t.asset_id = ?
    ORDER BY t.transfer_date DESC
  `);
  const transfers = transfersQuery.all(assetId);
  
  // 3. Maintenance history
  const maintenanceQuery = db.prepare(`
    SELECT * FROM maintenance 
    WHERE asset_id = ?
    ORDER BY service_date DESC
  `);
  const maintenance = maintenanceQuery.all(assetId);
  
  // 4. Disposal detail (if any)
  let disposal = null;
  if (asset.status === 'Disposed') {
    const disposalQuery = db.prepare(`
      SELECT d.*, u.name as manager_name 
      FROM disposals d
      JOIN users u ON d.authorized_by = u.id
      WHERE d.asset_id = ?
    `);
    disposal = disposalQuery.get(assetId) || null;
  }
  
  return {
    asset,
    assignments,
    transfers,
    maintenance,
    disposal
  };
}

const { generateTablePdf } = require("./pdf_generator");
const fs = require('fs');
const path = require('path');

function getLogoBuffer() {
  try {
    const logoPath = path.join(__dirname, 'public', 'ursb-logo.jpg');
    return fs.readFileSync(logoPath);
  } catch (err) {
    return null;
  }
}

async function generateAssetRegisterPdf(reqUser, filters) {
  if (reqUser.role !== 'Admin' && reqUser.role !== 'AssetManager' && reqUser.role !== 'AssetCustodian') {
    throw new Error('Unauthorized to generate asset register PDF');
  }

  const assets = generateAssetRegister(filters);
  const logoBuffer = getLogoBuffer();

  const rows = assets.map(asset => ({
    id: asset.id,
    name: asset.name,
    type: asset.type,
    category: asset.category,
    serial_number: asset.serial_number,
    condition: asset.condition,
    acquisition_date: asset.acquisition_date,
    cost: (asset.cost || 0).toLocaleString(),
    supplier: asset.supplier,
    status: asset.status,
    custodian_name: asset.custodian_name || '-',
    custodian_department: asset.custodian_department || '-'
  }));

  try {
    return await generateTablePdf({
      title: 'URSB Asset Register Report',
      logoBuffer,
      columns: ['Asset ID', 'Name', 'Type', 'Category', 'Serial No.', 'Condition', 'Acquisition Date', 'Cost (UGX)', 'Supplier', 'Status', 'Custodian', 'Department'],
      columnKeys: ['id', 'name', 'type', 'category', 'serial_number', 'condition', 'acquisition_date', 'cost', 'supplier', 'status', 'custodian_name', 'custodian_department'],
      rows
    }, true);
  } catch (err) {
    console.error('PDF generation failed:', err);
    throw new Error(
      `Could not generate the PDF. Underlying error: ${err.message}`
    );
  }
}

function getAuditLogs(reqUser) {
  if (reqUser.role !== 'Admin' && reqUser.role !== 'AssetManager') {
    throw new Error('Unauthorized to view system audit logs');
  }
  const query = db.prepare(`
    SELECT * FROM audit_log 
    ORDER BY timestamp DESC
  `);
  return query.all();
}

module.exports = {
  login,
  logout,
  getSession,
  listUsers,
  createUser,
  updateUser,
  changePassword,
  listAssets,
  getAsset,
  registerAsset,
  updateAsset,
  bulkRegisterAssets,
  changeOwnPassword,
  listAssignments,
  assignAsset,
  returnAsset,
  confirmReceipt,
  listTransfers,
  transferAsset,
  listMaintenance,
  recordMaintenance,
  completeMaintenance,
  disposeAsset,
  listRequests,
  createRequest,
  actionRequest,
  revokeRequest,
  getDashboardMetrics,
  generateAssetRegister,
  getAssetHistory,
  getAuditLogs,
  generateAssetRegisterPdf
};
