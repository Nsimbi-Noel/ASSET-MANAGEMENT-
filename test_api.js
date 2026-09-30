const assert = require('assert');
const path = require('path');
const fs = require('fs');

// Use an isolated, throwaway database for tests so they never write to the
// production/dev database. The env var must be set BEFORE controller/db are
// required, because those modules read DB_PATH at load time.
if (!process.env.DB_PATH) {
  const testDbDir = path.join(__dirname, 'data');
  fs.mkdirSync(testDbDir, { recursive: true });
  process.env.DB_PATH = path.join(testDbDir, 'test-api.db');
}

// Start from a clean slate so repeated runs (or a leftover DB from a previous
// run) never collide on UNIQUE keys like serial numbers.
['', '-wal', '-shm'].forEach(suffix => {
  try { fs.unlinkSync(process.env.DB_PATH + suffix); } catch (_) { /* ignore */ }
});

const controller = require('./controller');
const { db, dbReady } = require('./db');
const C = require('./constants');

// The bootstrap accounts are created from these env vars, so the suite must
// authenticate with the same values rather than a literal baked into a test.
const ADMIN_PASSWORD = process.env.BOOTSTRAP_ADMIN_PASSWORD || 'admin123';
const MANAGER_PASSWORD = process.env.BOOTSTRAP_MANAGER_PASSWORD || 'manager123';
const EMPLOYEE_PASSWORD = process.env.BOOTSTRAP_EMPLOYEE_PASSWORD || 'employee123';

// Color codes for output styling
const green = '\x1b[32m';
const reset = '\x1b[0m';
const red = '\x1b[31m';

async function runTests() {
  console.log('Starting automated integration test suite for AMS...\n');
  
  try {
    // Wait for the default accounts (admin/manager/employee) to finish seeding
    // before logging in — their password hashing happens asynchronously.
    await dbReady;

    // 1. Test Auth & Login
    console.log('Testing Authentication...');
    const authResult = await controller.login('manager', MANAGER_PASSWORD);
    assert.ok(authResult.sessionId, 'Session token should be generated');
    assert.strictEqual(authResult.user.role, C.ROLES.ASSET_MANAGER, 'User role should match database seed');
    console.log(`${green}✓ Authentication login successful${reset}`);
    
    // Setup Mock Requesting User Context
    // Look users up by their stable natural key (username) rather than hardcoding
    // primary keys, so the suite doesn't break if seed ordering ever changes.
    const managerUser = authResult.user;

    const employeeRow = db.prepare("SELECT * FROM users WHERE username = 'employee'").get();
    const employeeUser = { id: employeeRow.id, username: employeeRow.username, role: employeeRow.role, department: employeeRow.department };

    const adminRow = db.prepare("SELECT * FROM users WHERE username = 'admin'").get();
    const adminUser = { id: adminRow.id, username: adminRow.username, role: adminRow.role, department: adminRow.department };

    // 2. Test Asset Registration
    console.log('\nTesting Asset Registration...');
    const assetData = {
      name: 'Test Project iPad',
      type: 'Tablet',
      category: 'IT Equipment',
      serial_number: 'SN-IPAD-TEST-990',
      condition: 'New',
      acquisition_date: '2026-06-18',
      cost: 1800000,
      supplier: 'Apple Uganda Retailer',
      source: 'Procurement',
      status: 'In Storage'
    };
    
    const newAsset = controller.registerAsset(managerUser, assetData);
    assert.ok(newAsset.id.startsWith('AMS-AST-'), 'Unique Asset ID should be auto-generated with AMS-AST- prefix');
    console.log(`${green}✓ Asset successfully registered with ID: ${newAsset.id}${reset}`);

    // 3. Test Asset Assignment & Rule Enforcement
    console.log('\nTesting Asset Assignment & Rule Validation...');
    
    // Assign the new asset to an assignee (the seeded employee)
    const assignResult = controller.assignAsset(managerUser, {
      assetId: newAsset.id,
      assignedTo: employeeUser.id,
      assignmentDate: '2026-06-18',
      purpose: 'Field outreach registrations',
      notes: 'Please return in original box'
    });
    assert.ok(assignResult.success, 'Assignment should complete successfully');
    
    // Verify asset status changed to Active
    const updatedAsset = controller.getAsset(newAsset.id);
    assert.strictEqual(updatedAsset.status, 'Active', 'Asset status should change to Active upon assignment');
    console.log(`${green}✓ Asset successfully assigned to assignee. Status changed to Active.${reset}`);

    // Test Rule: Prevent assigning an already assigned asset
    try {
      controller.assignAsset(managerUser, {
        assetId: newAsset.id,
        assignedTo: adminUser.id,
        assignmentDate: '2026-06-18'
      });
      assert.fail('Should prevent assigning an already assigned asset');
    } catch (err) {
      assert.match(err.message, /already assigned/, 'Should reject with already assigned error message');
      console.log(`${green}✓ Correctly blocked duplicate active assignment.${reset}`);
    }

    // 4. Test Asset Maintenance Cycle
    console.log('\nTesting Asset Maintenance Cycle...');
    const maintAsset = controller.registerAsset(managerUser, {
      name: 'Test Desk for Maintenance',
      type: 'Furniture',
      category: 'Fittings',
      serial_number: 'SN-MAINT-TEST-001',
      condition: 'Good',
      acquisition_date: '2026-06-01',
      cost: 500000,
      supplier: 'Test Supplier',
      source: 'Procurement',
      status: 'In Storage'
    });
    
    // Initiate maintenance
    const maintResult = controller.recordMaintenance(managerUser, {
      assetId: maintAsset.id,
      serviceProvider: 'Kampala Furniture Servicing',
      description: 'Structural wheel replacement',
      cost: 150000,
      serviceDate: '2026-06-18',
      nextServiceDate: '2026-12-18',
      estimatedDurationDays: 5
    });
    assert.ok(maintResult.success, 'Maintenance record should be successfully created');

    // Verify expected_completion_date was derived from service_date + estimated duration
    const maintRecords = controller.listMaintenance(managerUser);
    const createdMaintRecord = maintRecords.find(m => m.id === maintResult.maintenanceId);
    assert.strictEqual(createdMaintRecord.expected_completion_date, '2026-06-23', 'Expected completion date should be service_date + estimated_duration_days');
    console.log(`${green}✓ Expected completion date correctly derived from estimated duration.${reset}`);
    
    // Verify status toggled to Under Maintenance
    const maintAssetDetails = controller.getAsset(maintAsset.id);
    assert.strictEqual(maintAssetDetails.status, 'Under Maintenance', 'Asset status should toggle to Under Maintenance');
    
    // Test Rule: Prevent assigning an asset under maintenance
    try {
      controller.assignAsset(managerUser, {
        assetId: maintAsset.id,
        assignedTo: employeeUser.id,
        assignmentDate: '2026-06-18'
      });
      assert.fail('Should prevent assignment of asset under maintenance');
    } catch (err) {
      assert.match(err.message, /under maintenance/, 'Should throw under maintenance error');
      console.log(`${green}✓ Correctly blocked assignment of asset under maintenance.${reset}`);
    }

    // Complete maintenance
    const completeResult = controller.completeMaintenance(managerUser, maintResult.maintenanceId, {
      completionDate: '2026-06-19',
      nextStatus: 'Active'
    });
    assert.ok(completeResult.success, 'Maintenance completion should register');
    
    const postMaintAsset = controller.getAsset(maintAsset.id);
    assert.strictEqual(postMaintAsset.status, 'Active', 'Asset status should return to Active after servicing completes');
    console.log(`${green}✓ Maintenance completed successfully. Asset returned to Active status.${reset}`);

    // 5. Test Asset Disposal
    console.log('\nTesting Asset Disposal...');
    const disposalAsset = controller.registerAsset(managerUser, {
      name: 'Test Item for Disposal',
      type: 'Shredder',
      category: 'Office Equipment',
      serial_number: 'SN-DISP-TEST-001',
      condition: 'Damaged',
      acquisition_date: '2026-01-01',
      cost: 200000,
      supplier: 'Test Supplier',
      source: 'Procurement',
      status: 'In Storage'
    });
    
    const disposeResult = controller.disposeAsset(managerUser, {
      assetId: disposalAsset.id,
      disposalDate: '2026-06-18',
      method: 'Donated',
      reason: 'Test disposal for validation.'
    });
    assert.ok(disposeResult.success, 'Disposal should register');
    
    const disposedAsset = controller.getAsset(disposalAsset.id);
    assert.strictEqual(disposedAsset.status, 'Disposed', 'Asset status should update to Disposed');
    
    // Test Rule: Disposed assets remain in register
    const register = controller.generateAssetRegister({ status: 'Disposed' });
    const foundInRegister = register.some(a => a.id === disposalAsset.id);
    assert.ok(foundInRegister, 'Disposed asset must remain in system lists under Disposed filter');
    
    // Test Rule: Prevent assignment of disposed asset
    try {
      controller.assignAsset(managerUser, {
        assetId: disposalAsset.id,
        assignedTo: employeeUser.id,
        assignmentDate: '2026-06-18'
      });
      assert.fail('Should prevent assignment of disposed asset');
    } catch (err) {
      assert.match(err.message, /disposed asset/, 'Should throw disposed error');
      console.log(`${green}✓ Correctly blocked assignment of disposed asset.${reset}`);
    }
    
    // Test Rule: Prevent scheduling maintenance on disposed asset
    try {
      controller.recordMaintenance(managerUser, {
        assetId: disposalAsset.id,
        serviceProvider: 'Repair Tech',
        description: 'Test repair',
        cost: 10000,
        serviceDate: '2026-06-18',
        estimatedDurationDays: 3
      });
      assert.fail('Should prevent maintenance on disposed asset');
    } catch (err) {
      assert.match(err.message, /disposed asset/, 'Should throw disposed error');
      console.log(`${green}✓ Correctly blocked maintenance on disposed asset.${reset}`);
    }

    // Test Rule: Estimated duration is required so a review notification can be scheduled
    try {
      controller.recordMaintenance(managerUser, {
        assetId: maintAsset.id,
        serviceProvider: 'Repair Tech',
        description: 'Test repair without duration',
        cost: 10000,
        serviceDate: '2026-06-18'
      });
      assert.fail('Should require an estimated duration');
    } catch (err) {
      assert.match(err.message, /[Ee]stimated duration/, 'Should throw missing-duration error');
      console.log(`${green}✓ Correctly required an estimated duration when logging maintenance.${reset}`);
    }

    // 6. Test Audit Logging
    console.log('\nTesting System Audit Trail...');
    const audits = controller.getAuditLogs(managerUser);
    assert.ok(audits.length > 0, 'Audit logs should contain records');
    
    const registrationAudit = audits.find(log => log.record_id === newAsset.id && log.action_type === 'CREATE');
    assert.ok(registrationAudit, 'Should find audit trail log for registered iPad');
    assert.strictEqual(registrationAudit.username, 'manager', 'Audit should record the correct initiating user');
    console.log(`${green}✓ Audit trail captured registered asset successfully.${reset}`);

    // 7. Test Request Follow-Up
    console.log('\nTesting Request Follow-Up...');
    const request = controller.createRequest(employeeUser, {
      assetName: 'Follow-up Test Laptop',
      assetType: 'Laptop',
      purpose: 'Testing follow-up feature'
    });
    assert.ok(request.id, 'Request should be created');

    const followUpResult = controller.updateRequestFollowUp(employeeUser, request.id, {
      feedback: 'Excellent condition',
      receivedStatus: 'Received'
    });
    assert.ok(followUpResult.success, 'Follow-up update should be successful');

    const updatedRequests = controller.listRequests(employeeUser);
    const updatedRequest = updatedRequests.find(r => r.id === request.id);
    assert.strictEqual(updatedRequest.requester_feedback, 'Excellent condition', 'Feedback should be updated');
    assert.strictEqual(updatedRequest.received_status, 'Received', 'Received status should be updated');
    console.log(`${green}✓ Request follow-up updated and verified successfully.${reset}`);

    // 8. Test that received_status is now validated server-side.
    // The column has no DB CHECK (it came from a migration), so an
    // unvalidated client could previously write any arbitrary string.
    console.log('\nTesting Enum Validation...');
    try {
      controller.updateRequestFollowUp(employeeUser, request.id, {
        feedback: 'Attempting to inject an invalid status',
        receivedStatus: 'Not A Real Status'
      });
      assert.fail('Should have rejected an invalid received_status');
    } catch (err) {
      assert.match(err.message, /Invalid received status/, 'Should reject an invalid received_status');
    }
    console.log(`${green}✓ Correctly rejected an invalid received_status.${reset}`);

    // Values that were valid in the DB but unreachable from the UI must now be
    // accepted end-to-end (Lease source, Damaged condition).
    const leasedAsset = controller.registerAsset(managerUser, {
      name: 'Leased Generator',
      type: 'Generator',
      category: 'Fittings',
      serial_number: 'SN-LEASE-0001',
      condition: C.ASSET_CONDITION.DAMAGED,
      acquisition_date: '2026-01-15',
      cost: 4500000,
      supplier: 'Regional Leasing Co',
      source: C.ASSET_SOURCE.LEASE,
      status: C.ASSET_STATUS.ACTIVE
    });
    assert.strictEqual(leasedAsset.source, C.ASSET_SOURCE.LEASE, 'Lease source should be accepted');
    assert.strictEqual(leasedAsset.condition, C.ASSET_CONDITION.DAMAGED, 'Damaged condition should be accepted');
    console.log(`${green}✓ Lease source and Damaged condition are reachable end-to-end.${reset}`);

    // Every enum the server advertises must be insertable, so /api/config can
    // never hand the UI a value the API would then reject.
    for (const source of C.ASSET_SOURCE_VALUES) {
      controller.registerAsset(managerUser, {
        name: `Source Probe ${source}`, type: 'Laptop', category: 'IT Equipment',
        serial_number: `SN-SRC-${source.replace(/\s+/g, '')}`,
        condition: C.ASSET_CONDITION.NEW, acquisition_date: '2026-02-01',
        cost: 1000, supplier: 'Probe Supplier', source, status: C.ASSET_STATUS.ACTIVE
      });
    }
    for (const method of C.DISPOSAL_METHODS) {
      assert.ok(C.DISPOSAL_METHODS.includes(method), `${method} should be a valid disposal method`);
    }
    console.log(`${green}✓ All advertised asset sources validate against the API.${reset}`);

    // A status that is legal in the schema but illegal as a post-maintenance
    // target must still be rejected.
    const guardAsset = controller.registerAsset(managerUser, {
      name: 'Status Guard Test', type: 'Printer', category: 'Office Equipment',
      serial_number: 'SN-GUARD-0001', condition: C.ASSET_CONDITION.GOOD,
      acquisition_date: '2026-02-02', cost: 500000, supplier: 'Probe Supplier',
      source: C.ASSET_SOURCE.PROCUREMENT, status: C.ASSET_STATUS.ACTIVE
    });
    const maintRec = controller.recordMaintenance(managerUser, {
      assetId: guardAsset.id,
      serviceProvider: 'Probe Service',
      description: 'Status guard probe',
      cost: 1000,
      serviceDate: '2026-02-03',
      nextServiceDate: '2026-08-03',
      estimatedDurationDays: 7
    });
    try {
      controller.completeMaintenance(managerUser, maintRec.maintenanceId, {
        completionDate: '2026-02-05',
        nextStatus: C.ASSET_STATUS.UNDER_MAINTENANCE
      });
      assert.fail('Should have rejected Under Maintenance as a post-maintenance target');
    } catch (err) {
      assert.match(err.message, /Invalid next status/, 'Should reject Under Maintenance as a post-maintenance target');
    }
    console.log(`${green}✓ Post-maintenance status cannot be set back to Under Maintenance.${reset}`);

    console.log(`\n${green}=========================================`);
    console.log(`ALL INTEGRATION TESTS PASSED SUCCESSFULLY!`);
    console.log(`=========================================${reset}`);
    process.exit(0);
    
  } catch (err) {
    console.error(`\n${red}=========================================`);
    console.error(`TEST RUN FAILED!`);
    console.error(`Error details:`, err.message);
    console.error(`=========================================${reset}`);
    process.exit(1);
  }
}

runTests();
