const assert = require('assert');
const controller = require('./controller');
const { db } = require('./db');

// Color codes for output styling
const green = '\x1b[32m';
const reset = '\x1b[0m';
const red = '\x1b[31m';

async function runTests() {
  console.log('Starting automated integration test suite for URSB AMS...\n');
  
  try {
    // 1. Test Auth & Login
    console.log('Testing Authentication...');
    const authResult = controller.login('manager', 'manager123');
    assert.ok(authResult.sessionId, 'Session token should be generated');
    assert.strictEqual(authResult.user.role, 'AssetManager', 'User role should match database seed');
    console.log(`${green}✓ Authentication login successful${reset}`);
    
    // Setup Mock Requesting User Context
    const managerUser = authResult.user;
    const employeeUser = { id: 4, username: 'employee', role: 'Employee', department: 'Registries' };
    const adminUser = { id: 1, username: 'admin', role: 'Admin', department: 'Information Technology' };

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
    assert.ok(newAsset.id.startsWith('URSB-AST-'), 'Unique Asset ID should be auto-generated with URSB-AST- prefix');
    console.log(`${green}✓ Asset successfully registered with ID: ${newAsset.id}${reset}`);

    // 3. Test Asset Assignment & Rule Enforcement
    console.log('\nTesting Asset Assignment & Rule Validation...');
    
    // Assign the new asset to custodian (id 3)
    const assignResult = controller.assignAsset(managerUser, {
      assetId: newAsset.id,
      assignedTo: 3,
      assignmentDate: '2026-06-18',
      purpose: 'Field outreach registrations',
      notes: 'Please return in original box'
    });
    assert.ok(assignResult.success, 'Assignment should complete successfully');
    
    // Verify asset status changed to Active
    const updatedAsset = controller.getAsset(newAsset.id);
    assert.strictEqual(updatedAsset.status, 'Active', 'Asset status should change to Active upon assignment');
    console.log(`${green}✓ Asset successfully assigned to custodian. Status changed to Active.${reset}`);

    // Test Rule: Prevent assigning an already assigned asset
    try {
      controller.assignAsset(managerUser, {
        assetId: newAsset.id,
        assignedTo: 4,
        assignmentDate: '2026-06-18'
      });
      assert.fail('Should prevent assigning an already assigned asset');
    } catch (err) {
      assert.match(err.message, /already assigned/, 'Should reject with already assigned error message');
      console.log(`${green}✓ Correctly blocked duplicate active assignment.${reset}`);
    }

    // 4. Test Asset Maintenance Cycle
    console.log('\nTesting Asset Maintenance Cycle...');
    const testMaintAsset = 'URSB-AST-0004'; // seeded Executive Leather Desk Chair
    
    // Initiate maintenance
    const maintResult = controller.recordMaintenance(managerUser, {
      assetId: testMaintAsset,
      serviceProvider: 'Kampala Furniture Servicing',
      description: 'Leather cleaning and structural wheel replacement',
      cost: 150000,
      serviceDate: '2026-06-18',
      nextServiceDate: '2026-12-18'
    });
    assert.ok(maintResult.success, 'Maintenance record should be successfully created');
    
    // Verify status toggled to Under Maintenance
    const maintAssetDetails = controller.getAsset(testMaintAsset);
    assert.strictEqual(maintAssetDetails.status, 'Under Maintenance', 'Asset status should toggle to Under Maintenance');
    
    // Test Rule: Prevent assigning an asset under maintenance
    try {
      controller.assignAsset(managerUser, {
        assetId: testMaintAsset,
        assignedTo: 3,
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
    
    const postMaintAsset = controller.getAsset(testMaintAsset);
    assert.strictEqual(postMaintAsset.status, 'Active', 'Asset status should return to Active after servicing completes');
    console.log(`${green}✓ Maintenance completed successfully. Asset returned to Active status.${reset}`);

    // 5. Test Asset Disposal (Soft delete, Read-only status)
    console.log('\nTesting Asset Disposal...');
    const testDisposalAsset = 'URSB-AST-0002'; // HP LaserJet Printer
    
    const disposeResult = controller.disposeAsset(managerUser, {
      assetId: testDisposalAsset,
      disposalDate: '2026-06-18',
      method: 'Donated',
      reason: 'Obsolete black-and-white print speed. Donated to local school library.'
    });
    assert.ok(disposeResult.success, 'Disposal should register');
    
    const disposedAsset = controller.getAsset(testDisposalAsset);
    assert.strictEqual(disposedAsset.status, 'Disposed', 'Asset status should update to Disposed');
    
    // Test Rule: Disposed assets remain as read-only records in register
    const register = controller.generateAssetRegister({ status: 'Disposed' });
    const foundInRegister = register.some(a => a.id === testDisposalAsset);
    assert.ok(foundInRegister, 'Disposed asset must remain in system lists under Disposed filter');
    
    // Test Rule: Prevent assignment of disposed asset
    try {
      controller.assignAsset(managerUser, {
        assetId: testDisposalAsset,
        assignedTo: 3,
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
        assetId: testDisposalAsset,
        serviceProvider: 'Repair Tech',
        description: 'Test repair',
        cost: 10000,
        serviceDate: '2026-06-18'
      });
      assert.fail('Should prevent maintenance on disposed asset');
    } catch (err) {
      assert.match(err.message, /disposed asset/, 'Should throw disposed error');
      console.log(`${green}✓ Correctly blocked maintenance on disposed asset.${reset}`);
    }

    // 6. Test Audit Logging
    console.log('\nTesting System Audit Trail...');
    const audits = controller.getAuditLogs(managerUser);
    assert.ok(audits.length > 0, 'Audit logs should contain records');
    
    const registrationAudit = audits.find(log => log.record_id === newAsset.id && log.action_type === 'CREATE');
    assert.ok(registrationAudit, 'Should find audit trail log for registered iPad');
    assert.strictEqual(registrationAudit.username, 'manager', 'Audit should record the correct initiating user');
    console.log(`${green}✓ Audit trail captured registered asset successfully.${reset}`);

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
