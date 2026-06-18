// ================= URSB AMS CLIENT CORE =================

// Global State
let currentUser = null;
let activeView = 'dashboard';
let cacheData = {
  assets: [],
  users: [],
  assignments: [],
  requests: [],
  transfers: [],
  audits: []
};

// Document Ready
document.addEventListener('DOMContentLoaded', () => {
  initApp();
});

async function initApp() {
  setupEventListeners();
  await checkSession();
}

// Check Authentication Session
async function checkSession() {
  try {
    const res = await fetch('/api/auth/session');
    if (res.ok) {
      const data = await res.json();
      currentUser = data.user;
      showApp();
    } else {
      showLogin();
    }
  } catch (err) {
    showLogin();
  }
}

// UI State Switchers
function showLogin() {
  document.getElementById('auth-container').style.display = 'flex';
  document.getElementById('app-container').style.display = 'none';
  currentUser = null;
}

function showApp() {
  document.getElementById('auth-container').style.display = 'none';
  document.getElementById('app-container').style.display = 'grid';
  
  // Set user profile headers
  document.getElementById('header-user-name').textContent = currentUser.name;
  document.getElementById('header-user-role').textContent = formatRole(currentUser.role) + ` (${currentUser.department})`;
  document.getElementById('header-user-avatar').textContent = currentUser.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
  document.getElementById('header-user-name').style.cursor = 'pointer';
  document.getElementById('header-user-name').title = 'Click to change password';
  document.getElementById('header-user-name').onclick = () => openModal('modal-change-own-password');
  
  // Apply Role-based Access Control (RBAC) on sidebar navigation items
  document.querySelectorAll('.sidebar-nav li').forEach(li => {
    const roleAttr = li.getAttribute('data-role');
    if (roleAttr === 'All') {
      li.style.display = 'block';
    } else {
      const allowedRoles = roleAttr.split(',');
      if (allowedRoles.includes(currentUser.role)) {
        li.style.display = 'block';
      } else {
        li.style.display = 'none';
      }
    }
  });

  // Load notifications (maintenance due check)
  loadUpcomingAlerts();

  // Navigate to default view or dashboard
  navigateTo(activeView);
}

// Setup Event Listeners
function setupEventListeners() {
  // Login Form
  document.getElementById('login-form').addEventListener('submit', handleLogin);
  
  // Logout Button
  document.getElementById('logout-btn').addEventListener('click', handleLogout);
  
  // Sidebar Nav Links
  document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const view = link.getAttribute('data-view');
      navigateTo(view);
    });
  });

  // Modal Submissions
  document.getElementById('register-asset-form').addEventListener('submit', submitRegisterAsset);
  document.getElementById('edit-asset-form').addEventListener('submit', submitEditAsset);
  document.getElementById('assign-asset-form').addEventListener('submit', submitAssignAsset);
  document.getElementById('transfer-asset-form').addEventListener('submit', submitTransferAsset);
  document.getElementById('maintenance-asset-form').addEventListener('submit', submitMaintenanceEvent);
  document.getElementById('dispose-asset-form').addEventListener('submit', submitDisposal);
  document.getElementById('create-request-form').addEventListener('submit', submitRequisition);
  document.getElementById('user-form').addEventListener('submit', submitUserForm);
  document.getElementById('change-password-form').addEventListener('submit', submitResetPassword);
  document.getElementById('change-own-password-form').addEventListener('submit', submitChangeOwnPassword);

  // Close modals on backdrop click
  document.getElementById('modal-backdrop').addEventListener('click', () => {
    closeAllModals();
  });
}

// Handle Login
async function handleLogin(e) {
  e.preventDefault();
  const usernameInput = document.getElementById('login-username').value;
  const passwordInput = document.getElementById('login-password').value;
  const errorDiv = document.getElementById('login-error');
  
  errorDiv.textContent = '';
  
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: usernameInput, password: passwordInput })
    });
    
    const data = await res.json();
    if (res.ok) {
      currentUser = data.user;
      showToast('Logged in successfully!', 'success');
      showApp();
    } else {
      errorDiv.textContent = data.error || 'Authentication failed.';
    }
  } catch (err) {
    errorDiv.textContent = 'Server unreachable. Check connections.';
  }
}

// Handle Logout
async function handleLogout() {
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
  } catch(e) {}
  showToast('Logged out successfully.', 'info');
  showLogin();
}

// Navigation & Router
function navigateTo(view) {
  activeView = view;
  document.querySelectorAll('.nav-link').forEach(link => {
    if (link.getAttribute('data-view') === view) {
      link.classList.add('active');
    } else {
      link.classList.remove('active');
    }
  });
  
  // Set View Title
  const titleMap = {
    dashboard: 'Dashboard Overview',
    register: 'Asset Register',
    assignments: 'Asset Assignments',
    transfers: 'Asset Custodian Transfers',
    maintenance: 'Asset Maintenance Logs',
    disposals: 'Disposed Asset Archives',
    requests: 'Asset Requisitions',
    users: 'System User Accounts',
    audits: 'System Audit Logs'
  };
  document.getElementById('view-title').textContent = titleMap[view] || 'Asset Management System';
  
  // Render View content
  renderView(view);
}

// Render Specific Views
function renderView(view) {
  const container = document.getElementById('viewport');
  container.innerHTML = '<div class="text-center" style="padding: 3rem;"><div class="spinner">Loading data...</div></div>';
  
  switch(view) {
    case 'dashboard':
      renderDashboardView(container);
      break;
    case 'register':
      renderRegisterView(container);
      break;
    case 'assignments':
      renderAssignmentsView(container);
      break;
    case 'transfers':
      renderTransfersView(container);
      break;
    case 'maintenance':
      renderMaintenanceView(container);
      break;
    case 'disposals':
      renderDisposalsView(container);
      break;
    case 'requests':
      renderRequestsView(container);
      break;
    case 'users':
      renderUsersView(container);
      break;
    case 'audits':
      renderAuditsView(container);
      break;
    default:
      container.innerHTML = '<h2>Page Not Found</h2>';
  }
}

// ================= VIEW: DASHBOARD =================
async function renderDashboardView(container) {
  try {
    const res = await fetch('/api/reports/dashboard');
    if (!res.ok) throw new Error('Failed to fetch dashboard metrics');
    const data = await res.json();
    
    container.innerHTML = `
      <!-- Metric Cards Grid -->
      <div class="grid grid-4" style="margin-bottom: 2rem;">
        <div class="metric-card card-total">
          <div class="metric-info">
            <span class="metric-title">Total Active Assets</span>
            <span class="metric-value">${data.counts.Active + data.counts.InStorage + data.counts.UnderMaintenance}</span>
          </div>
          <div class="metric-icon-box">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 7h-9m3 14H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v8"/></svg>
          </div>
        </div>
        <div class="metric-card card-active">
          <div class="metric-info">
            <span class="metric-title">Assigned (Active)</span>
            <span class="metric-value">${data.assignmentRatio.assigned || 0}</span>
          </div>
          <div class="metric-icon-box">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
          </div>
        </div>
        <div class="metric-card card-storage">
          <div class="metric-info">
            <span class="metric-title">In Storage</span>
            <span class="metric-value">${data.counts.InStorage}</span>
          </div>
          <div class="metric-icon-box">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
          </div>
        </div>
        <div class="metric-card card-maint">
          <div class="metric-info">
            <span class="metric-title">Under Maintenance</span>
            <span class="metric-value">${data.counts.UnderMaintenance}</span>
          </div>
          <div class="metric-icon-box">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>
          </div>
        </div>
      </div>

      <div class="dashboard-grid">
        <!-- Visualizations -->
        <div class="dashboard-card">
          <h3>Asset Distribution by Status</h3>
          <div class="chart-container">
            <canvas id="chartStatus" width="300" height="240"></canvas>
          </div>
        </div>
        
        <div class="dashboard-card">
          <h3>Asset Count by Category</h3>
          <div class="chart-container">
            <canvas id="chartCategory" width="300" height="240"></canvas>
          </div>
        </div>
      </div>
      
      <!-- Maintenance Overdue Warnings -->
      <div class="dashboard-card" style="margin-top: 1.5rem;">
        <h3>Upcoming and Overdue Maintenance</h3>
        <div class="table-responsive">
          <table style="margin-top: 0.5rem;">
            <thead>
              <tr>
                <th>Asset ID</th>
                <th>Asset Name</th>
                <th>Service Provider</th>
                <th>Scheduled Date</th>
                <th>Next Due Date</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${data.upcomingMaintenance.length === 0 ? `
                <tr><td colspan="6" class="text-center text-secondary">No assets have maintenance due within 30 days.</td></tr>
              ` : data.upcomingMaintenance.map(m => `
                <tr>
                  <td><a href="#" class="text-link" onclick="viewAssetDetails('${m.asset_id}')">${m.asset_id}</a></td>
                  <td><strong>${m.asset_name}</strong></td>
                  <td>${m.service_provider}</td>
                  <td>${m.service_date}</td>
                  <td><span class="text-danger" style="font-weight:600;">${m.next_service_date || 'N/A'}</span></td>
                  <td><span class="status-badge under-maintenance">Due</span></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
    
    // Draw canvas charts offline-ready
    renderStatusChart('chartStatus', data.counts);
    renderCategoryChart('chartCategory', data.categoryDistribution);
    
  } catch (err) {
    container.innerHTML = `<div class="warning-banner">${err.message}</div>`;
  }
}

// Draw Status Pie Chart
function renderStatusChart(canvasId, counts) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  
  const labels = ['Active', 'In Storage', 'Under Maint'];
  const values = [counts.Active, counts.InStorage, counts.UnderMaintenance];
  const colors = ['#2ec4b6', '#3182ce', '#dd6b20'];
  const total = values.reduce((sum, v) => sum + v, 0);
  
  if (total === 0) {
    ctx.font = '14px Outfit';
    ctx.fillStyle = '#718096';
    ctx.fillText('No active asset data to display', 40, 100);
    return;
  }

  // Draw Pie
  const centerX = 100;
  const centerY = 120;
  const radius = 80;
  let startAngle = 0;
  
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  for (let i = 0; i < values.length; i++) {
    if (values[i] === 0) continue;
    
    const sliceAngle = (values[i] / total) * 2 * Math.PI;
    
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.arc(centerX, centerY, radius, startAngle, startAngle + sliceAngle);
    ctx.closePath();
    ctx.fillStyle = colors[i];
    ctx.fill();
    
    startAngle += sliceAngle;
  }
  
  // Legend
  ctx.font = '13px Outfit';
  let legendY = 60;
  for (let i = 0; i < labels.length; i++) {
    const pct = total > 0 ? Math.round((values[i] / total) * 100) : 0;
    ctx.fillStyle = colors[i];
    ctx.fillRect(205, legendY - 10, 12, 12);
    
    ctx.fillStyle = '#1a202c';
    ctx.fillText(`${labels[i]}: ${values[i]} (${pct}%)`, 225, legendY);
    legendY += 30;
  }
}

// Draw Category Bar Chart
function renderCategoryChart(canvasId, distributions) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  if (distributions.length === 0) {
    ctx.font = '14px Outfit';
    ctx.fillStyle = '#718096';
    ctx.fillText('No asset categories to display', 40, 100);
    return;
  }

  const padding = 40;
  const chartWidth = canvas.width - padding * 2;
  const chartHeight = canvas.height - padding * 2;
  
  // Find max value
  const maxVal = Math.max(...distributions.map(d => d.count), 5);
  
  // Draw axis lines
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padding, padding);
  ctx.lineTo(padding, canvas.height - padding);
  ctx.lineTo(canvas.width - padding, canvas.height - padding);
  ctx.stroke();
  
  const barWidth = 35;
  const gap = (chartWidth - barWidth * distributions.length) / (distributions.length + 1);
  
  for (let i = 0; i < distributions.length; i++) {
    const d = distributions[i];
    const barHeight = (d.count / maxVal) * chartHeight;
    const x = padding + gap + i * (barWidth + gap);
    const y = canvas.height - padding - barHeight;
    
    // Draw Bar
    ctx.fillStyle = '#0a448e';
    ctx.fillRect(x, y, barWidth, barHeight);
    
    // Draw Label (vertical or truncated)
    ctx.font = '11px Outfit';
    ctx.fillStyle = '#4a5568';
    const shortCat = d.category.length > 8 ? d.category.substring(0, 7) + '..' : d.category;
    ctx.fillText(shortCat, x - 2, canvas.height - padding + 15);
    
    // Draw Value on Top
    ctx.fillStyle = '#1a202c';
    ctx.font = 'bold 11px Outfit';
    ctx.fillText(d.count, x + barWidth / 2 - 4, y - 6);
  }
}

// ================= VIEW: ASSET REGISTER =================
async function renderRegisterView(container) {
  try {
    const res = await fetch('/api/reports/register');
    if (!res.ok) throw new Error('Failed to load asset register');
    const data = await res.json();
    cacheData.assets = data;
    
    // Action bar depending on role
    const actionsHtml = currentUser.role === 'AssetManager' ? `
      <button class="btn btn-primary" onclick="openRegisterAssetModal()">
        <svg class="btn-icon" viewBox="0 0 24 24" width="16" height="16"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
        Register Asset
      </button>
      <button class="btn btn-primary" onclick="openBulkImportModal()">
        <svg class="btn-icon" viewBox="0 0 24 24" width="16" height="16"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm-3.06 16L7.4 14.46l1.41-1.41 2.12 2.12 4.24-4.24 1.41 1.41L10.94 18zM13 9V3.5L18.5 9H13z"/></svg>
        Bulk Import
      </button>
      <button class="btn btn-secondary" onclick="openAssignAssetModal()">
        <svg class="btn-icon" viewBox="0 0 24 24" width="16" height="16"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
        Assign Asset
      </button>
    ` : '';
    
    container.innerHTML = `
      <div class="view-actions-bar">
        <div class="filters-bar">
          <input type="text" id="asset-search" placeholder="Search by name, serial..." class="filter-input" oninput="filterAssetTable()">
          <select id="asset-filter-type" class="filter-select" onchange="filterAssetTable()">
            <option value="">All Types</option>
            ${Array.from(new Set(data.map(a => a.type))).map(type => `<option value="${type}">${type}</option>`).join('')}
          </select>
          <select id="asset-filter-status" class="filter-select" onchange="filterAssetTable()">
            <option value="">All Statuses</option>
            <option value="Active">Active</option>
            <option value="In Storage">In Storage</option>
            <option value="Under Maintenance">Under Maintenance</option>
          </select>
        </div>
        <div style="display:flex; gap:0.5rem;">
          ${actionsHtml}
          <button class="btn btn-outline" onclick="exportAssetRegisterCSV()">
            Export CSV
          </button>
        </div>
      </div>
      
      <div class="table-card">
        <div class="table-responsive">
          <table id="asset-register-table">
            <thead>
              <tr>
                <th class="sortable" onclick="sortTable('asset-register-table', 0)">Asset ID <span class="sort-indicator">↕</span></th>
                <th class="sortable" onclick="sortTable('asset-register-table', 1)">Asset Name <span class="sort-indicator">↕</span></th>
                <th class="sortable" onclick="sortTable('asset-register-table', 2)">Type <span class="sort-indicator">↕</span></th>
                <th class="sortable" onclick="sortTable('asset-register-table', 3)">Serial Number <span class="sort-indicator">↕</span></th>
                <th class="sortable" onclick="sortTable('asset-register-table', 4)">Condition <span class="sort-indicator">↕</span></th>
                <th>Custodian / Dept</th>
                <th class="sortable" onclick="sortTable('asset-register-table', 6)">Status <span class="sort-indicator">↕</span></th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody id="asset-register-tbody">
              <!-- Rendered via function -->
            </tbody>
          </table>
        </div>
      </div>
    `;
    
    renderAssetTableRows(data);
    
  } catch (err) {
    container.innerHTML = `<div class="warning-banner">${err.message}</div>`;
  }
}

function renderAssetTableRows(assets) {
  const tbody = document.getElementById('asset-register-tbody');
  if (assets.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="table-empty">No assets registered in the system.</td></tr>`;
    return;
  }
  
  tbody.innerHTML = assets.map(a => `
    <tr style="cursor: pointer;">
      <td onclick="viewAssetDetails('${a.id}')"><strong>${a.id}</strong></td>
      <td onclick="viewAssetDetails('${a.id}')">${a.name}</td>
      <td onclick="viewAssetDetails('${a.id}')">${a.type}</td>
      <td onclick="viewAssetDetails('${a.id}')">${a.serial_number}</td>
      <td onclick="viewAssetDetails('${a.id}')"><span class="status-badge active">${a.condition}</span></td>
      <td onclick="viewAssetDetails('${a.id}')">${a.custodian_name ? `${a.custodian_name} (${a.custodian_department})` : '<span class="text-secondary">-</span>'}</td>
      <td onclick="viewAssetDetails('${a.id}')"><span class="status-badge ${a.status.toLowerCase().replace(' ', '-')}">${a.status}</span></td>
      <td>
        <div style="display:flex; gap:0.25rem;">
          <button class="btn btn-outline btn-sm" onclick="viewAssetDetails('${a.id}')">History</button>
          ${currentUser.role === 'AssetManager' ? `<button class="btn btn-outline btn-sm" onclick="openEditAssetModal('${a.id}')">Edit</button>` : ''}
        </div>
      </td>
    </tr>
  `).join('');
}

function filterAssetTable() {
  const searchVal = document.getElementById('asset-search').value.toLowerCase();
  const typeVal = document.getElementById('asset-filter-type').value;
  const statusVal = document.getElementById('asset-filter-status').value;
  
  const filtered = cacheData.assets.filter(a => {
    const matchesSearch = a.name.toLowerCase().includes(searchVal) || 
                          a.id.toLowerCase().includes(searchVal) || 
                          a.serial_number.toLowerCase().includes(searchVal);
    const matchesType = !typeVal || a.type === typeVal;
    const matchesStatus = !statusVal || a.status === statusVal;
    return matchesSearch && matchesType && matchesStatus;
  });
  
  renderAssetTableRows(filtered);
}

// Export register to CSV
function exportAssetRegisterCSV() {
  if (cacheData.assets.length === 0) {
    showToast('No asset data to export.', 'error');
    return;
  }
  
  let csvContent = 'Asset ID,Asset Name,Type,Category,Serial Number,Condition,Acquisition Date,Cost (UGX),Supplier,Source,Custodian,Department,Status\n';
  
  cacheData.assets.forEach(a => {
    const custodian = a.custodian_name ? a.custodian_name.replace(/"/g, '""') : '';
    const dept = a.custodian_department ? a.custodian_department.replace(/"/g, '""') : '';
    csvContent += `"${a.id}","${a.name.replace(/"/g, '""')}","${a.type}","${a.category}","${a.serial_number}","${a.condition}","${a.acquisition_date}",${a.cost},"${a.supplier.replace(/"/g, '""')}","${a.source}","${custodian}","${dept}","${a.status}"\n`;
  });
  
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `URSB_Asset_Register_${new Date().toISOString().split('T')[0]}.csv`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// ================= VIEW: ASSIGNMENTS =================
async function renderAssignmentsView(container) {
  try {
    const res = await fetch('/api/assignments');
    if (!res.ok) throw new Error('Failed to load assignments');
    const data = await res.json();
    cacheData.assignments = data;
    
    const assignBtnHtml = currentUser.role === 'AssetManager' ? `
      <button class="btn btn-primary" onclick="openAssignAssetModal()">Assign Asset</button>
    ` : '';
    
    container.innerHTML = `
      <div class="view-actions-bar">
        <div class="filters-bar">
          <input type="text" id="assign-search" placeholder="Search by asset or user..." class="filter-input" oninput="filterAssignmentTable()">
        </div>
        <div>
          ${assignBtnHtml}
        </div>
      </div>
      
      <div class="table-card">
        <div class="table-responsive">
          <table id="assignments-table">
            <thead>
              <tr>
                <th>Asset ID</th>
                <th>Asset Name</th>
                <th>Assigned To (Custodian)</th>
                <th>Department</th>
                <th>Assigned By</th>
                <th>Assignment Date</th>
                <th>Receipt confirmed?</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody id="assignments-tbody">
              <!-- Rendered dynamically -->
            </tbody>
          </table>
        </div>
      </div>
    `;
    
    renderAssignmentTableRows(data);
  } catch (err) {
    container.innerHTML = `<div class="warning-banner">${err.message}</div>`;
  }
}

function renderAssignmentTableRows(assignments) {
  const tbody = document.getElementById('assignments-tbody');
  if (assignments.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="table-empty">No asset assignments found.</td></tr>`;
    return;
  }
  
  tbody.innerHTML = assignments.map(a => {
    // Determine action buttons based on user role and receipt state
    let actionBtn = '';
    if (a.status === 'Active') {
      if (currentUser.role === 'AssetManager') {
        actionBtn = `<button class="btn btn-outline btn-danger btn-sm" onclick="returnAssetPrompt('${a.id}', '${a.asset_id}')">Return to storage</button>`;
      } else if (a.assigned_to === currentUser.id && a.confirmed_receipt === 0) {
        actionBtn = `<button class="btn btn-secondary btn-sm" onclick="confirmReceiptAction('${a.id}')">Confirm Receipt</button>`;
      } else {
        actionBtn = '<span class="text-secondary">-</span>';
      }
    } else {
      actionBtn = '<span class="text-secondary">Closed</span>';
    }
    
    const receiptLabel = a.confirmed_receipt === 1 
      ? '<span class="status-badge active">Confirmed</span>' 
      : '<span class="status-badge pending">Pending</span>';
      
    return `
      <tr>
        <td><strong>${a.asset_id}</strong></td>
        <td>${a.asset_name}</td>
        <td>${a.assigned_to_name}</td>
        <td>${a.assigned_to_department}</td>
        <td>${a.assigned_by_name}</td>
        <td>${a.assignment_date}</td>
        <td>${receiptLabel}</td>
        <td><span class="status-badge ${a.status === 'Active' ? 'active' : 'disposed'}">${a.status}</span></td>
        <td>${actionBtn}</td>
      </tr>
    `;
  }).join('');
}

function filterAssignmentTable() {
  const searchVal = document.getElementById('assign-search').value.toLowerCase();
  const filtered = cacheData.assignments.filter(a => {
    return a.asset_id.toLowerCase().includes(searchVal) || 
           a.asset_name.toLowerCase().includes(searchVal) || 
           a.assigned_to_name.toLowerCase().includes(searchVal) ||
           a.assigned_to_department.toLowerCase().includes(searchVal);
  });
  renderAssignmentTableRows(filtered);
}

// Confirm receipt client callback
async function confirmReceiptAction(assignmentId) {
  if (!confirm('Confirm receipt of this asset? By clicking OK you certify that you have received this physical asset in good condition.')) {
    return;
  }
  try {
    const res = await fetch(`/api/assignments/${assignmentId}/confirm`, {
      method: 'PUT'
    });
    const data = await res.json();
    if (res.ok) {
      showToast('Receipt confirmed successfully!', 'success');
      renderView('assignments');
    } else {
      showToast(data.error || 'Failed to confirm receipt', 'error');
    }
  } catch (err) {
    showToast('Network error during confirmation.', 'error');
  }
}

// Return asset callback
async function returnAssetPrompt(assignmentId, assetId) {
  const returnDate = new Date().toISOString().split('T')[0];
  if (!confirm(`Are you sure you want to return asset ${assetId} to storage?`)) return;
  
  try {
    const res = await fetch(`/api/assignments/${assignmentId}/return`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ returnedDate: returnDate })
    });
    const data = await res.json();
    if (res.ok) {
      showToast('Asset returned to storage successfully', 'success');
      renderView('assignments');
    } else {
      showToast(data.error || 'Failed to return asset', 'error');
    }
  } catch (err) {
    showToast('Network error during return process', 'error');
  }
}

// ================= VIEW: TRANSFERS =================
async function renderTransfersView(container) {
  try {
    const res = await fetch('/api/assets');
    const assetsData = await res.json();
    
    const usersRes = await fetch('/api/users');
    let usersData = [];
    if (usersRes.ok) usersData = await usersRes.json();
    
    container.innerHTML = `
      <div class="view-actions-bar">
        <h3>Custodian Allocation History</h3>
        <div>
          <button class="btn btn-primary" onclick="openTransferAssetModal()">
            New Custodian Transfer
          </button>
        </div>
      </div>
      
      <div class="table-card">
        <div class="table-responsive">
          <table id="transfers-table">
            <thead>
              <tr>
                <th>Asset ID</th>
                <th>From Custodian</th>
                <th>To Custodian</th>
                <th>Transfer Date</th>
                <th>Reason</th>
                <th>Authorized By</th>
              </tr>
            </thead>
            <tbody id="transfers-tbody">
              <tr><td colspan="6" class="table-empty">Loading transfers history...</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    `;
    
    loadTransfersTable();
  } catch (err) {
    container.innerHTML = `<div class="warning-banner">${err.message}</div>`;
  }
}

async function loadTransfersTable() {
  const tbody = document.getElementById('transfers-tbody');
  try {
    const res = await fetch('/api/transfers');
    if (!res.ok) throw new Error('Failed to load transfers');
    const transfers = await res.json();
    
    if (transfers.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="table-empty">No transfer logs recorded.</td></tr>`;
      return;
    }
    
    tbody.innerHTML = transfers.map(t => {
      return `
        <tr>
          <td><strong>${t.asset_id}</strong></td>
          <td>${t.from_name} (${t.from_department || '-'})</td>
          <td>${t.to_name} (${t.to_department || '-'})</td>
          <td>${t.transfer_date}</td>
          <td>${t.reason}</td>
          <td>${t.manager_name}</td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" class="table-empty text-danger">${err.message}</td></tr>`;
  }
}

// ================= VIEW: MAINTENANCE =================
async function renderMaintenanceView(container) {
  try {
    const res = await fetch('/api/assets');
    const assets = await res.ok ? await res.json() : [];
    cacheData.assets = assets;
    
    const addMaintHtml = currentUser.role === 'AssetManager' ? `
      <button class="btn btn-primary" onclick="openRecordMaintenanceModal()">
        Log Maintenance Event
      </button>
    ` : '';
    
    container.innerHTML = `
      <div class="view-actions-bar">
        <h3>Active Service Tickets</h3>
        <div>
          ${addMaintHtml}
        </div>
      </div>
      
      <div class="table-card">
        <div class="table-responsive">
          <table id="maintenance-table">
            <thead>
              <tr>
                <th>Asset ID</th>
                <th>Asset Name</th>
                <th>Service Provider</th>
                <th>Cost (UGX)</th>
                <th>Service Date</th>
                <th>Next Service Due</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody id="maintenance-tbody">
              <!-- Loaded dynamically -->
            </tbody>
          </table>
        </div>
      </div>
    `;
    
    loadMaintenanceTable();
  } catch (err) {
    container.innerHTML = `<div class="warning-banner">${err.message}</div>`;
  }
}

async function loadMaintenanceTable() {
  const tbody = document.getElementById('maintenance-tbody');
  tbody.innerHTML = `<tr><td colspan="8" class="table-empty">Loading tickets...</td></tr>`;
  try {
    const res = await fetch('/api/maintenance');
    if (!res.ok) throw new Error('Failed to load maintenance records');
    const records = await res.json();
    
    if (records.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" class="table-empty">No maintenance events recorded.</td></tr>`;
      return;
    }
    
    tbody.innerHTML = records.map(m => {
      const actionBtn = currentUser.role === 'AssetManager' && m.completed === 0
        ? `<button class="btn btn-secondary btn-sm" onclick="completeMaintenancePrompt('${m.id}', '${m.asset_id}')">Complete Servicing</button>`
        : '<span class="text-secondary">-</span>';
      
      return `
        <tr>
          <td><strong>${m.asset_id}</strong></td>
          <td>${m.asset_name}</td>
          <td>${m.service_provider}</td>
          <td>UGX ${Number(m.cost).toLocaleString()}</td>
          <td>${m.service_date}</td>
          <td>${m.next_service_date || 'N/A'}</td>
          <td><span class="status-badge ${m.completed ? 'active' : 'under-maintenance'}">${m.completed ? 'Completed' : 'Open'}</span></td>
          <td>${actionBtn}</td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="8" class="table-empty text-danger">${err.message}</td></tr>`;
  }
}

async function completeMaintenancePrompt(maintenanceId, assetId) {
  const completionDate = new Date().toISOString().split('T')[0];
  const nextStatus = prompt('Enter next status for the asset (Active or In Storage):', 'Active');
  
  if (nextStatus === null) return; // cancel
  if (!['Active', 'In Storage'].includes(nextStatus)) {
    alert('Invalid status. Enter either "Active" or "In Storage".');
    return;
  }
  
  try {
    const res = await fetch(`/api/maintenance/${maintenanceId}/complete`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ completionDate, nextStatus })
    });
    const data = await res.json();
    if (res.ok) {
      showToast('Maintenance marked as completed!', 'success');
      renderView('maintenance');
    } else {
      showToast(data.error || 'Failed to close ticket', 'error');
    }
  } catch (err) {
    showToast('Network error.', 'error');
  }
}

// ================= VIEW: DISPOSALS =================
async function renderDisposalsView(container) {
  try {
    const res = await fetch('/api/assets');
    const assets = await res.json();
    const disposed = assets.filter(a => a.status === 'Disposed');
    
    const actionHtml = currentUser.role === 'AssetManager' ? `
      <button class="btn btn-danger" onclick="openDisposeAssetModal()">
        Dispose Asset
      </button>
    ` : '';
    
    container.innerHTML = `
      <div class="view-actions-bar">
        <h3>Disposed Assets Archive (Read-Only)</h3>
        <div>
          ${actionHtml}
        </div>
      </div>
      
      <div class="table-card">
        <div class="table-responsive">
          <table id="disposals-table">
            <thead>
              <tr>
                <th>Asset ID</th>
                <th>Asset Name</th>
                <th>Type</th>
                <th>Serial Number</th>
                <th>Acquisition Cost</th>
                <th>Disposal Info</th>
                <th>Authorized By</th>
              </tr>
            </thead>
            <tbody id="disposals-tbody">
              ${disposed.length === 0 ? `
                <tr><td colspan="7" class="table-empty">No assets recorded as disposed.</td></tr>
              ` : ''}
            </tbody>
          </table>
        </div>
      </div>
    `;
    
    if (disposed.length > 0) {
      loadDisposalsTableRows(disposed);
    }
  } catch (err) {
    container.innerHTML = `<div class="warning-banner">${err.message}</div>`;
  }
}

async function loadDisposalsTableRows(disposedAssets) {
  const tbody = document.getElementById('disposals-tbody');
  tbody.innerHTML = '';
  
  for (const asset of disposedAssets) {
    try {
      const res = await fetch(`/api/reports/history/${asset.id}`);
      if (!res.ok) continue;
      const history = await res.json();
      const disp = history.disposal;
      
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${asset.id}</strong></td>
        <td>${asset.name}</td>
        <td>${asset.type}</td>
        <td>${asset.serial_number}</td>
        <td>UGX ${asset.cost.toLocaleString()}</td>
        <td>
          ${disp ? `
            <strong>Method:</strong> ${disp.method}<br>
            <strong>Date:</strong> ${disp.disposal_date}<br>
            <strong>Reason:</strong> ${disp.reason}
          ` : 'Disposal metadata missing'}
        </td>
        <td>${disp ? disp.manager_name : '-'}</td>
      `;
      tbody.appendChild(tr);
    } catch (e) {}
  }
}

// ================= VIEW: REQUESTS =================
async function renderRequestsView(container) {
  try {
    const res = await fetch('/api/requests');
    if (!res.ok) throw new Error('Failed to load requests');
    const data = await res.json();
    cacheData.requests = data;
    
    container.innerHTML = `
      <div class="view-actions-bar">
        <h3>Asset Requisitions Registry</h3>
        <div>
          <button class="btn btn-primary" onclick="openCreateRequestModal()">
            Submit New Request
          </button>
        </div>
      </div>
      
      <div class="table-card">
        <div class="table-responsive">
          <table id="requests-table">
            <thead>
              <tr>
                <th>Req ID</th>
                <th>Requested By</th>
                <th>Requested Asset</th>
                <th>Type</th>
                <th>Purpose</th>
                <th>Submitted Date</th>
                <th>Status</th>
                <th>Manager Feedback</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody id="requests-tbody">
              <!-- Loaded dynamically -->
            </tbody>
          </table>
        </div>
      </div>
    `;
    
    renderRequestTableRows(data);
  } catch (err) {
    container.innerHTML = `<div class="warning-banner">${err.message}</div>`;
  }
}

function renderRequestTableRows(requests) {
  const tbody = document.getElementById('requests-tbody');
  if (requests.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="table-empty">No asset requests registered.</td></tr>`;
    return;
  }
  
  tbody.innerHTML = requests.map(r => {
    let actionBtn = '';
    if (r.status === 'Pending' && currentUser.role === 'AssetManager') {
      actionBtn = `
        <div style="display:flex; gap:0.25rem;">
          <button class="btn btn-primary btn-sm" onclick="actionRequestAction('${r.id}', 'Approved')">Approve</button>
          <button class="btn btn-danger btn-sm" onclick="actionRequestAction('${r.id}', 'Rejected')">Reject</button>
        </div>
      `;
    } else {
      actionBtn = '<span class="text-secondary">-</span>';
    }
    
    return `
      <tr>
        <td>#REQ-${r.id}</td>
        <td><strong>${r.requested_by_name}</strong></td>
        <td>${r.asset_name}</td>
        <td>${r.asset_type}</td>
        <td>${r.purpose}</td>
        <td>${new Date(r.created_at).toLocaleDateString()}</td>
        <td><span class="status-badge ${r.status.toLowerCase()}">${r.status}</span></td>
        <td>${r.manager_notes || '<span class="text-secondary">-</span>'}</td>
        <td>${actionBtn}</td>
      </tr>
    `;
  }).join('');
}

async function actionRequestAction(requestId, status) {
  const managerNotes = prompt(`Enter optional review notes/feedback for requisition approval/rejection:`);
  if (managerNotes === null) return; // cancelled
  
  try {
    const res = await fetch(`/api/requests/${requestId}/action`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, managerNotes })
    });
    const data = await res.json();
    if (res.ok) {
      showToast(`Requisition marked as ${status}!`, 'success');
      renderView('requests');
    } else {
      showToast(data.error || 'Failed to action request', 'error');
    }
  } catch (err) {
    showToast('Network error.', 'error');
  }
}

// ================= VIEW: USERS (ADMIN) =================
async function renderUsersView(container) {
  if (currentUser.role !== 'Admin') {
    container.innerHTML = '<div class="warning-banner">Unauthorized to view page. Admins only.</div>';
    return;
  }
  
  try {
    const res = await fetch('/api/users');
    if (!res.ok) throw new Error('Failed to load users list');
    const data = await res.json();
    cacheData.users = data;
    
    container.innerHTML = `
      <div class="view-actions-bar">
        <h3>System User Directories</h3>
        <div>
          <button class="btn btn-primary" onclick="openCreateUserModal()">
            Create User Account
          </button>
        </div>
      </div>
      
      <div class="table-card">
        <div class="table-responsive">
          <table id="users-table">
            <thead>
              <tr>
                <th>Username</th>
                <th>Full Name</th>
                <th>System Role</th>
                <th>Department</th>
                <th>Account Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody id="users-tbody">
              <!-- Loaded dynamically -->
            </tbody>
          </table>
        </div>
      </div>
    `;
    
    renderUserTableRows(data);
  } catch (err) {
    container.innerHTML = `<div class="warning-banner">${err.message}</div>`;
  }
}

function renderUserTableRows(users) {
  const tbody = document.getElementById('users-tbody');
  if (users.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="table-empty">No users registered in system databases.</td></tr>`;
    return;
  }
  
  tbody.innerHTML = users.map(u => {
    return `
      <tr>
        <td><strong>${u.username}</strong></td>
        <td>${u.name}</td>
        <td>${formatRole(u.role)}</td>
        <td>${u.department}</td>
        <td><span class="status-badge ${u.status === 'Active' ? 'active' : 'disposed'}">${u.status}</span></td>
        <td>
          <div style="display:flex; gap:0.5rem;">
            <button class="btn btn-outline btn-sm" onclick="openEditUserModal('${u.id}')">Edit</button>
            <button class="btn btn-outline btn-sm" onclick="openResetPasswordModal('${u.id}', '${u.username}')">Reset Pass</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// ================= VIEW: AUDIT LOGS =================
async function renderAuditsView(container) {
  try {
    const res = await fetch('/api/reports/audits');
    if (!res.ok) throw new Error('Failed to load audit trail');
    const data = await res.json();
    cacheData.audits = data;
    
    container.innerHTML = `
      <div class="view-actions-bar">
        <div class="filters-bar">
          <input type="text" id="audit-search" placeholder="Search by username, record..." class="filter-input" oninput="filterAuditTable()">
        </div>
        <h3>System Change Audit logs</h3>
      </div>
      
      <div class="table-card">
        <div class="table-responsive">
          <table id="audits-table">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Action User</th>
                <th>Action Type</th>
                <th>Scope</th>
                <th>Ref ID</th>
                <th>Change Summary Details</th>
              </tr>
            </thead>
            <tbody id="audits-tbody">
              <!-- Loaded dynamically -->
            </tbody>
          </table>
        </div>
      </div>
    `;
    
    renderAuditTableRows(data);
  } catch (err) {
    container.innerHTML = `<div class="warning-banner">${err.message}</div>`;
  }
}

function renderAuditTableRows(logs) {
  const tbody = document.getElementById('audits-tbody');
  if (logs.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="table-empty">No audit events recorded in logs.</td></tr>`;
    return;
  }
  
  tbody.innerHTML = logs.map(l => {
    return `
      <tr>
        <td style="font-size:0.8rem; white-space:nowrap;">${new Date(l.timestamp).toLocaleString()}</td>
        <td><strong>${l.username}</strong></td>
        <td><span class="status-badge ${l.action_type === 'CREATE' ? 'active' : l.action_type === 'DELETE' ? 'disposed' : 'in-storage'}">${l.action_type}</span></td>
        <td>${l.table_name}</td>
        <td><code>${l.record_id}</code></td>
        <td style="font-size:0.85rem;">${l.details}</td>
      </tr>
    `;
  }).join('');
}

function filterAuditTable() {
  const searchVal = document.getElementById('audit-search').value.toLowerCase();
  const filtered = cacheData.audits.filter(l => {
    return l.username.toLowerCase().includes(searchVal) || 
           l.details.toLowerCase().includes(searchVal) || 
           l.table_name.toLowerCase().includes(searchVal) ||
           l.record_id.toLowerCase().includes(searchVal);
  });
  renderAuditTableRows(filtered);
}

// ================= MODAL MANAGERS =================

function openModal(id) {
  document.getElementById('modal-backdrop').style.display = 'block';
  document.getElementById(id).style.display = 'flex';
}

function closeModal(id) {
  document.getElementById(id).style.display = 'none';
  // Check if any other modal is open
  const openModals = Array.from(document.querySelectorAll('.modal')).filter(m => m.style.display === 'flex');
  if (openModals.length === 0) {
    document.getElementById('modal-backdrop').style.display = 'none';
  }
}

function closeAllModals() {
  document.querySelectorAll('.modal').forEach(m => m.style.display = 'none');
  document.getElementById('modal-backdrop').style.display = 'none';
}

// 1. View Asset Details & History
async function viewAssetDetails(assetId) {
  try {
    const res = await fetch(`/api/reports/history/${assetId}`);
    if (!res.ok) throw new Error('Failed to retrieve history');
    const data = await res.json();
    
    // Set text contents
    document.getElementById('detail-asset-id').innerHTML = `Asset Details: <code>${data.asset.id}</code>`;
    document.getElementById('det-name').textContent = data.asset.name;
    document.getElementById('det-category').textContent = data.asset.category;
    document.getElementById('det-type').textContent = data.asset.type;
    document.getElementById('det-serial').textContent = data.asset.serial_number;
    
    const conditionBadge = document.getElementById('det-condition');
    conditionBadge.className = 'status-badge active';
    conditionBadge.textContent = data.asset.condition;
    
    const statusBadge = document.getElementById('det-status');
    statusBadge.className = `status-badge ${data.asset.status.toLowerCase().replace(' ', '-')}`;
    statusBadge.textContent = data.asset.status;
    
    document.getElementById('det-acq-date').textContent = data.asset.acquisition_date;
    document.getElementById('det-cost').textContent = `UGX ${data.asset.cost.toLocaleString()}`;
    document.getElementById('det-supplier').textContent = data.asset.supplier;
    document.getElementById('det-source').textContent = data.asset.source;
    
    // Custodian Details
    const custodianBox = document.getElementById('det-current-custodian-box');
    const activeAssign = data.assignments.find(a => a.status === 'Active');
    
    if (activeAssign) {
      custodianBox.style.display = 'block';
      document.getElementById('det-custodian-name').textContent = activeAssign.custodian_name;
      document.getElementById('det-custodian-dept').textContent = activeAssign.assigned_to_department || 'General';
      document.getElementById('det-custodian-date').textContent = activeAssign.assignment_date;
      document.getElementById('det-custodian-purpose').textContent = activeAssign.purpose || '-';
    } else {
      custodianBox.style.display = 'none';
    }
    
    // Timeline history
    const timeline = document.getElementById('detail-history-timeline');
    timeline.innerHTML = '';
    
    const events = [];
    
    // Process Creation
    events.push({
      date: data.asset.created_at,
      title: 'Asset Registered',
      desc: `Registered on system by user. Supplier: ${data.asset.supplier}`,
      class: 'creation'
    });
    
    // Process Assignments
    data.assignments.forEach(a => {
      events.push({
        date: a.assignment_date,
        title: `Asset Assigned to ${a.custodian_name}`,
        desc: `Authorized by ${a.manager_name}. Purpose: ${a.purpose || 'Not stated'} (${a.confirmed_receipt === 1 ? 'Receipt Confirmed' : 'Pending Confirmation'})`,
        class: 'assignment'
      });
      if (a.returned_date) {
        events.push({
          date: a.returned_date,
          title: `Returned from ${a.custodian_name}`,
          desc: `Asset returned to inventory storage. Notes: ${a.notes || '-'}`,
          class: 'assignment'
        });
      }
    });
    
    // Process Transfers
    data.transfers.forEach(t => {
      events.push({
        date: t.transfer_date,
        title: `Transferred Custodian`,
        desc: `Transferred from ${t.from_name} to ${t.to_name}. Reason: ${t.reason}. Authorized by ${t.manager_name}`,
        class: 'transfer'
      });
    });
    
    // Process Maintenance
    data.maintenance.forEach(m => {
      events.push({
        date: m.service_date,
        title: `Servicing Open - ${m.service_provider}`,
        desc: `Diagnostic: ${m.description}. Cost: UGX ${m.cost.toLocaleString()}`,
        class: 'maintenance'
      });
      if (m.completed === 1) {
        events.push({
          date: m.completion_date || m.service_date,
          title: `Servicing Closed`,
          desc: `Maintenance completed. Asset returned to rotation service.`,
          class: 'maintenance'
        });
      }
    });
    
    // Process Disposal
    if (data.disposal) {
      events.push({
        date: data.disposal.disposal_date,
        title: `Asset Disposed - Method: ${data.disposal.method}`,
        desc: `Reason: ${data.disposal.reason}. Authorized by ${data.disposal.manager_name}`,
        class: 'disposal'
      });
    }
    
    // Sort events by date descending
    events.sort((a,b) => new Date(b.date) - new Date(a.date));
    
    if (events.length === 0) {
      timeline.innerHTML = '<div class="text-secondary text-center">No history events.</div>';
    } else {
      timeline.innerHTML = events.map(e => `
        <div class="timeline-item">
          <div class="timeline-dot ${e.class}"></div>
          <div class="timeline-content">
            <div class="timeline-date">${new Date(e.date).toLocaleDateString()}</div>
            <div class="timeline-title">${e.title}</div>
            <div class="timeline-desc">${e.desc}</div>
          </div>
        </div>
      `).join('');
    }
    
    // Open General tab first
    switchDetailTab('tab-general');
    openModal('modal-asset-detail');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function switchDetailTab(tabId) {
  document.querySelectorAll('#modal-asset-detail .tab-btn').forEach(btn => {
    if (btn.getAttribute('onclick').includes(tabId)) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
  document.querySelectorAll('#modal-asset-detail .tab-content').forEach(tc => {
    tc.classList.remove('active');
  });
  document.getElementById(tabId).classList.add('active');
}

// 2. Open Register Asset
function openRegisterAssetModal() {
  document.getElementById('register-asset-form').reset();
  document.getElementById('reg-acq-date').value = new Date().toISOString().split('T')[0];
  openModal('modal-register-asset');
}

async function submitRegisterAsset(e) {
  e.preventDefault();
  const payload = {
    name: document.getElementById('reg-name').value,
    type: document.getElementById('reg-type').value,
    category: document.getElementById('reg-category').value,
    serial_number: document.getElementById('reg-serial').value,
    condition: document.getElementById('reg-condition').value,
    acquisition_date: document.getElementById('reg-acq-date').value,
    cost: document.getElementById('reg-cost').value,
    supplier: document.getElementById('reg-supplier').value,
    source: document.getElementById('reg-source').value,
    status: document.getElementById('reg-status').value
  };
  
  try {
    const res = await fetch('/api/assets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (res.ok) {
      showToast(`Asset registered! ID generated: ${data.id}`, 'success');
      closeModal('modal-register-asset');
      renderView('register');
    } else {
      showToast(data.error || 'Failed to register asset', 'error');
    }
  } catch (err) {
    showToast('Network error during registration.', 'error');
  }
}

// 3. Open Edit Asset
async function openEditAssetModal(assetId) {
  try {
    const res = await fetch(`/api/assets/${assetId}`);
    if (!res.ok) throw new Error('Failed to load asset');
    const asset = await res.json();

    document.getElementById('edit-asset-id').value = asset.id;
    document.getElementById('edit-name').value = asset.name;
    document.getElementById('edit-type').value = asset.type;
    document.getElementById('edit-category').value = asset.category;
    document.getElementById('edit-serial').value = asset.serial_number;
    document.getElementById('edit-condition').value = asset.condition;
    document.getElementById('edit-acq-date').value = asset.acquisition_date;
    document.getElementById('edit-cost').value = asset.cost;
    document.getElementById('edit-supplier').value = asset.supplier;
    document.getElementById('edit-source').value = asset.source;
    document.getElementById('edit-status').value = asset.status;

    openModal('modal-edit-asset');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function submitEditAsset(e) {
  e.preventDefault();
  const assetId = document.getElementById('edit-asset-id').value;
  const payload = {
    name: document.getElementById('edit-name').value,
    type: document.getElementById('edit-type').value,
    category: document.getElementById('edit-category').value,
    serial_number: document.getElementById('edit-serial').value,
    condition: document.getElementById('edit-condition').value,
    acquisition_date: document.getElementById('edit-acq-date').value,
    cost: document.getElementById('edit-cost').value,
    supplier: document.getElementById('edit-supplier').value,
    source: document.getElementById('edit-source').value,
    status: document.getElementById('edit-status').value
  };

  try {
    const res = await fetch(`/api/assets/${assetId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (res.ok) {
      showToast('Asset updated successfully!', 'success');
      closeModal('modal-edit-asset');
      renderView('register');
    } else {
      showToast(data.error || 'Failed to update asset', 'error');
    }
  } catch (err) {
    showToast('Network error during update.', 'error');
  }
}

// 4. Bulk Import
function openBulkImportModal() {
  document.getElementById('bulk-csv-input').value = '';
  document.getElementById('bulk-import-result').style.display = 'none';
  openModal('modal-bulk-import');
}

async function submitBulkImport() {
  const csvText = document.getElementById('bulk-csv-input').value.trim();
  if (!csvText) {
    showToast('Paste CSV data first', 'error');
    return;
  }

  const lines = csvText.split('\n').filter(l => l.trim());
  const assets = lines.map(line => {
    const cols = line.split(',').map(c => c.trim());
    return {
      name: cols[0] || '',
      type: cols[1] || '',
      category: cols[2] || '',
      serial_number: cols[3] || '',
      condition: cols[4] || 'Good',
      acquisition_date: cols[5] || new Date().toISOString().split('T')[0],
      cost: cols[6] || 0,
      supplier: cols[7] || 'Unknown',
      source: cols[8] || 'Procurement',
      status: cols[9] || 'In Storage'
    };
  });

  const resultDiv = document.getElementById('bulk-import-result');
  resultDiv.style.display = 'block';
  resultDiv.innerHTML = '<div class="text-center">Importing...</div>';

  try {
    const res = await fetch('/api/assets/bulk-import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assets })
    });
    const data = await res.json();
    if (res.ok) {
      resultDiv.innerHTML = `
        <div class="status-badge active" style="margin-bottom:0.5rem;">✓ ${data.imported} assets imported</div>
        ${data.errors ? `<div class="status-badge rejected">${data.errors} errors</div>` : ''}
        <div style="font-size:0.85rem; margin-top:0.5rem; max-height:200px; overflow-y:auto;">
          ${data.assets.map(a => `<div>${a.id} — ${a.name}</div>`).join('')}
        </div>
      `;
      renderView('register');
    } else {
      resultDiv.innerHTML = `<div class="status-badge rejected">${data.error || 'Import failed'}</div>`;
    }
  } catch (err) {
    resultDiv.innerHTML = `<div class="status-badge rejected">Network error: ${err.message}</div>`;
  }
}

// 5. Change Own Password
async function submitChangeOwnPassword(e) {
  e.preventDefault();
  const payload = {
    currentPassword: document.getElementById('own-pass-current').value,
    newPassword: document.getElementById('own-pass-new').value
  };

  try {
    const res = await fetch('/api/auth/password', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (res.ok) {
      showToast('Password changed successfully!', 'success');
      closeModal('modal-change-own-password');
      document.getElementById('change-own-password-form').reset();
    } else {
      showToast(data.error || 'Failed to change password', 'error');
    }
  } catch (err) {
    showToast('Network error.', 'error');
  }
}

// 6. Open Assign Asset
async function openAssignAssetModal() {
  document.getElementById('assign-asset-form').reset();
  document.getElementById('assign-date').value = new Date().toISOString().split('T')[0];
  
  const assetSelect = document.getElementById('assign-asset-select');
  const userSelect = document.getElementById('assign-user-select');
  
  assetSelect.innerHTML = '<option value="">Loading assets...</option>';
  userSelect.innerHTML = '<option value="">Loading users...</option>';
  
  openModal('modal-assign-asset');
  
  try {
    // Load unassigned active assets
    const aRes = await fetch('/api/reports/register');
    const assets = await aRes.json();
    const assignable = assets.filter(a => (a.status === 'Active' && !a.custodian_name) || a.status === 'In Storage');
    
    assetSelect.innerHTML = '<option value="">Select Asset to Assign</option>' + 
      assignable.map(a => `<option value="${a.id}">${a.id} - ${a.name} (${a.status})</option>`).join('');
      
    // Load Active Custodians or employees
    const uRes = await fetch('/api/users');
    const users = await uRes.json();
    const activeUsers = users.filter(u => u.status === 'Active' && u.role !== 'Admin');
    
    userSelect.innerHTML = '<option value="">Select Custodian</option>' + 
      activeUsers.map(u => `<option value="${u.id}">${u.name} (${formatRole(u.role)} - ${u.department})</option>`).join('');
      
  } catch (err) {
    assetSelect.innerHTML = '<option value="">Error loading list</option>';
  }
}

async function submitAssignAsset(e) {
  e.preventDefault();
  const payload = {
    assetId: document.getElementById('assign-asset-select').value,
    assignedTo: document.getElementById('assign-user-select').value,
    assignmentDate: document.getElementById('assign-date').value,
    purpose: document.getElementById('assign-purpose').value,
    notes: document.getElementById('assign-notes').value
  };
  
  try {
    const res = await fetch('/api/assignments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (res.ok) {
      showToast('Asset assigned successfully!', 'success');
      closeModal('modal-assign-asset');
      // If we are currently on asset register, refresh it; otherwise assignments
      if (activeView === 'register') renderView('register');
      else navigateTo('assignments');
    } else {
      showToast(data.error || 'Failed to assign asset', 'error');
    }
  } catch (err) {
    showToast('Network error during assignment.', 'error');
  }
}

// 4. Open Transfer Asset
async function openTransferAssetModal() {
  document.getElementById('transfer-asset-form').reset();
  document.getElementById('trans-date').value = new Date().toISOString().split('T')[0];
  
  const assetSelect = document.getElementById('trans-asset-select');
  const userSelect = document.getElementById('trans-user-select');
  
  assetSelect.innerHTML = '<option value="">Loading assigned assets...</option>';
  userSelect.innerHTML = '<option value="">Loading users...</option>';
  
  openModal('modal-transfer-asset');
  
  try {
    // Load currently assigned active assets
    const aRes = await fetch('/api/reports/register');
    const assets = await aRes.json();
    const assigned = assets.filter(a => a.status === 'Active' && a.custodian_name);
    
    assetSelect.innerHTML = '<option value="">Select Asset to Transfer</option>' + 
      assigned.map(a => `<option value="${a.id}" data-custodian="${a.custodian_name} (${a.custodian_department})">${a.id} - ${a.name}</option>`).join('');
      
    // Set change trigger to display current custodian
    assetSelect.onchange = () => {
      const selectedOption = assetSelect.options[assetSelect.selectedIndex];
      const custInfo = selectedOption.getAttribute('data-custodian') || '';
      document.getElementById('trans-current-custodian').value = custInfo;
    };

    // Load active users
    const uRes = await fetch('/api/users');
    const users = await uRes.json();
    const activeUsers = users.filter(u => u.status === 'Active' && u.role !== 'Admin');
    
    userSelect.innerHTML = '<option value="">Select Target Custodian</option>' + 
      activeUsers.map(u => `<option value="${u.id}">${u.name} (${formatRole(u.role)} - ${u.department})</option>`).join('');
  } catch (e) {
    assetSelect.innerHTML = '<option value="">Error loading list</option>';
  }
}

async function submitTransferAsset(e) {
  e.preventDefault();
  const payload = {
    assetId: document.getElementById('trans-asset-select').value,
    toUserId: document.getElementById('trans-user-select').value,
    transferDate: document.getElementById('trans-date').value,
    reason: document.getElementById('trans-reason').value
  };
  
  try {
    const res = await fetch('/api/transfers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (res.ok) {
      showToast('Asset transferred successfully!', 'success');
      closeModal('modal-transfer-asset');
      renderView('transfers');
    } else {
      showToast(data.error || 'Failed to transfer asset', 'error');
    }
  } catch (err) {
    showToast('Network error.', 'error');
  }
}

// 5. Open Record Maintenance
async function openRecordMaintenanceModal() {
  document.getElementById('maintenance-asset-form').reset();
  document.getElementById('maint-date').value = new Date().toISOString().split('T')[0];
  
  const assetSelect = document.getElementById('maint-asset-select');
  assetSelect.innerHTML = '<option value="">Loading assets...</option>';
  
  openModal('modal-record-maintenance');
  
  try {
    const res = await fetch('/api/assets');
    const assets = await res.json();
    const maintainable = assets.filter(a => a.status !== 'Disposed');
    
    assetSelect.innerHTML = '<option value="">Select Asset</option>' + 
      maintainable.map(a => `<option value="${a.id}">${a.id} - ${a.name} (${a.status})</option>`).join('');
  } catch (e) {
    assetSelect.innerHTML = '<option value="">Error loading assets</option>';
  }
}

async function submitMaintenanceEvent(e) {
  e.preventDefault();
  const payload = {
    assetId: document.getElementById('maint-asset-select').value,
    serviceProvider: document.getElementById('maint-provider').value,
    serviceDate: document.getElementById('maint-date').value,
    nextServiceDate: document.getElementById('maint-next-date').value || null,
    cost: document.getElementById('maint-cost').value,
    description: document.getElementById('maint-desc').value
  };
  
  try {
    const res = await fetch('/api/maintenance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (res.ok) {
      showToast('Maintenance ticket opened and asset status set to Under Maintenance!', 'success');
      closeModal('modal-record-maintenance');
      renderView('maintenance');
    } else {
      showToast(data.error || 'Failed to open ticket', 'error');
    }
  } catch (err) {
    showToast('Network error.', 'error');
  }
}

// 6. Open Dispose Asset Modal
async function openDisposeAssetModal() {
  document.getElementById('dispose-asset-form').reset();
  document.getElementById('disp-date').value = new Date().toISOString().split('T')[0];
  
  const assetSelect = document.getElementById('disp-asset-select');
  assetSelect.innerHTML = '<option value="">Loading assets...</option>';
  
  openModal('modal-dispose-asset');
  
  try {
    const res = await fetch('/api/assets');
    const assets = await res.json();
    const activeAssets = assets.filter(a => a.status !== 'Disposed');
    
    assetSelect.innerHTML = '<option value="">Select Asset to Dispose</option>' + 
      activeAssets.map(a => `<option value="${a.id}">${a.id} - ${a.name} (${a.status})</option>`).join('');
  } catch(e) {
    assetSelect.innerHTML = '<option value="">Error loading assets</option>';
  }
}

async function submitDisposal(e) {
  e.preventDefault();
  
  const payload = {
    assetId: document.getElementById('disp-asset-select').value,
    disposalDate: document.getElementById('disp-date').value,
    method: document.getElementById('disp-method').value,
    reason: document.getElementById('disp-reason').value
  };
  
  try {
    const res = await fetch('/api/disposals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (res.ok) {
      showToast('Asset disposed and archived successfully!', 'success');
      closeModal('modal-dispose-asset');
      renderView('disposals');
    } else {
      showToast(data.error || 'Failed to dispose asset', 'error');
    }
  } catch (err) {
    showToast('Network error.', 'error');
  }
}

// 7. Requisition Request
function openCreateRequestModal() {
  document.getElementById('create-request-form').reset();
  openModal('modal-create-request');
}

async function submitRequisition(e) {
  e.preventDefault();
  const payload = {
    assetName: document.getElementById('req-asset-name').value,
    assetType: document.getElementById('req-asset-type').value,
    purpose: document.getElementById('req-purpose').value
  };
  
  try {
    const res = await fetch('/api/requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (res.ok) {
      showToast('Requisition request submitted successfully!', 'success');
      closeModal('modal-create-request');
      renderView('requests');
    } else {
      showToast(data.error || 'Failed to submit requisition', 'error');
    }
  } catch (err) {
    showToast('Network error.', 'error');
  }
}

// 8. User creation (Admin)
function openCreateUserModal() {
  document.getElementById('user-form').reset();
  document.getElementById('user-modal-title').textContent = 'Create User Account';
  document.getElementById('usr-submit-btn').textContent = 'Create User';
  document.getElementById('user-form-id').value = '';
  document.getElementById('usr-username').disabled = false;
  document.getElementById('usr-password').required = true;
  document.getElementById('usr-pass-group').style.display = 'block';
  document.getElementById('usr-status-group').style.display = 'none';
  openModal('modal-manage-user');
}

function openEditUserModal(id) {
  const user = cacheData.users.find(u => u.id == id);
  if (!user) return;
  
  document.getElementById('user-modal-title').textContent = `Edit User: ${user.username}`;
  document.getElementById('usr-submit-btn').textContent = 'Save Changes';
  document.getElementById('user-form-id').value = user.id;
  
  document.getElementById('usr-username').value = user.username;
  document.getElementById('usr-username').disabled = true; // cannot change username
  
  document.getElementById('usr-password').required = false;
  document.getElementById('usr-pass-group').style.display = 'none'; // reset pass in separate modal
  
  document.getElementById('usr-name').value = user.name;
  document.getElementById('usr-role').value = user.role;
  document.getElementById('usr-department').value = user.department;
  
  document.getElementById('usr-status').value = user.status;
  document.getElementById('usr-status-group').style.display = 'block';
  
  openModal('modal-manage-user');
}

async function submitUserForm(e) {
  e.preventDefault();
  const id = document.getElementById('user-form-id').value;
  const isEdit = !!id;
  
  const payload = {
    username: document.getElementById('usr-username').value,
    name: document.getElementById('usr-name').value,
    role: document.getElementById('usr-role').value,
    department: document.getElementById('usr-department').value
  };
  
  if (!isEdit) {
    payload.password = document.getElementById('usr-password').value;
  } else {
    payload.status = document.getElementById('usr-status').value;
  }
  
  const url = isEdit ? `/api/users/${id}` : '/api/users';
  const method = isEdit ? 'PUT' : 'POST';
  
  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (res.ok) {
      showToast(isEdit ? 'User account details updated!' : 'User account created successfully!', 'success');
      closeModal('modal-manage-user');
      renderView('users');
    } else {
      showToast(data.error || 'Operation failed', 'error');
    }
  } catch (err) {
    showToast('Network error during user management.', 'error');
  }
}

function openResetPasswordModal(id, username) {
  document.getElementById('change-password-form').reset();
  document.getElementById('change-pass-user-id').value = id;
  document.getElementById('change-pass-username').value = username;
  openModal('modal-change-password');
}

async function submitResetPassword(e) {
  e.preventDefault();
  const id = document.getElementById('change-pass-user-id').value;
  const payload = {
    newPassword: document.getElementById('change-pass-new').value
  };
  
  try {
    const res = await fetch(`/api/users/${id}/password`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (res.ok) {
      showToast('Password reset successfully!', 'success');
      closeModal('modal-change-password');
    } else {
      showToast(data.error || 'Failed to reset password', 'error');
    }
  } catch (err) {
    showToast('Network error.', 'error');
  }
}

// ================= NOTIFICATION ENGINE =================
async function loadUpcomingAlerts() {
  const badge = document.getElementById('alerts-indicator');
  const countSpan = document.getElementById('alerts-count');
  const alertsList = document.getElementById('alerts-list');
  
  try {
    const res = await fetch('/api/reports/dashboard');
    if (!res.ok) return;
    const data = await res.json();
    
    const count = data.upcomingMaintenance.length;
    if (count > 0) {
      badge.style.display = 'block';
      countSpan.textContent = count;
      alertsList.innerHTML = data.upcomingMaintenance.map(m => `
        <li>
          <div class="alert-item-title">Maintenance Due!</div>
          <div class="alert-item-detail">
            Asset <strong>${m.asset_id}</strong> (${m.asset_name}) is scheduled for servicing by ${m.service_provider} on <strong>${m.next_service_date || m.service_date}</strong>.
          </div>
        </li>
      `).join('');
    } else {
      badge.style.display = 'none';
      alertsList.innerHTML = '<li class="dropdown-empty">No critical alerts.</li>';
    }
  } catch(e) {}
}

// ================= TOAST ALERTS HELPER =================
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span>${message}</span>
    <button class="toast-close">&times;</button>
  `;
  
  container.appendChild(toast);
  
  // Auto-remove after 4 seconds
  const timer = setTimeout(() => {
    removeToast(toast);
  }, 4000);
  
  toast.querySelector('.toast-close').onclick = () => {
    clearTimeout(timer);
    removeToast(toast);
  };
}

function removeToast(toast) {
  toast.style.animation = 'toastSlideIn 0.3s reverse';
  toast.addEventListener('animationend', () => {
    toast.remove();
  });
}

// ================= GENERAL HELPERS =================
function formatRole(role) {
  if (role === 'AssetManager') return 'Asset Manager';
  if (role === 'AssetCustodian') return 'Asset Custodian';
  return role;
}

// Table column sorter
function sortTable(tableId, colIndex) {
  const table = document.getElementById(tableId);
  if (!table) return;
  const tbody = table.querySelector('tbody');
  const rows = Array.from(tbody.querySelectorAll('tr'));
  
  const isAscending = !table.dataset.sortAsc || table.dataset.sortAsc === 'false';
  table.dataset.sortAsc = isAscending;
  
  rows.sort((rowA, rowB) => {
    const cellA = rowA.cells[colIndex].textContent.trim();
    const cellB = rowB.cells[colIndex].textContent.trim();
    
    // Check numeric
    const valA = parseFloat(cellA.replace(/[^0-9.-]/g, ''));
    const valB = parseFloat(cellB.replace(/[^0-9.-]/g, ''));
    
    if (!isNaN(valA) && !isNaN(valB)) {
      return isAscending ? valA - valB : valB - valA;
    }
    
    return isAscending 
      ? cellA.localeCompare(cellB) 
      : cellB.localeCompare(cellA);
  });
  
  tbody.innerHTML = '';
  rows.forEach(r => tbody.appendChild(r));
}
