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

// Holds a one-time filter to apply to the next view we navigate into
// (e.g. clicking a dashboard metric card jumps to a view pre-filtered
// to match that metric). Consumed and cleared by the destination view's
// render function.
let pendingViewFilter = null;

// Raw data + active filter for the My Assets summary cards, which act as
// quick filters into the combined assignments/requests table below them
// (mirrors the click-to-filter pattern used by the Maintenance page cards).
let myAssetsRawData = { assignments: [], requests: [] };
let myAssetsFilterType = 'all';

// Document Ready
document.addEventListener('DOMContentLoaded', () => {
  initApp();
});

// Flag to prevent the session check from firing while a login is in progress,
// which was causing the login-page reload loop when the form submitted and
// showApp() was called before the browser had fully processed the session cookie.
let loginInProgress = false;

async function initApp() {
  setupEventListeners();
  if (!loginInProgress) {
    await checkSession();
  }
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

  // Load notifications (maintenance due check) and keep polling so managers
  // are notified as soon as a maintenance job's estimated duration elapses.
  loadUpcomingAlerts();
  startAlertsPolling();

  // If an Employee somehow lands on 'register', redirect to dashboard
  if (currentUser.role === 'Employee' && activeView === 'register') {
    activeView = 'dashboard';
  }

  // Ensure newly logged-in users always start on the dashboard.
  // This guarantees a consistent landing page for every login session.
  activeView = 'dashboard';
  // Navigate to dashboard
  navigateTo(activeView);
}

// Setup Event Listeners
function setupEventListeners() {
  // Login Form
  document.getElementById('login-form').addEventListener('submit', handleLogin);
  
  // Logout Button
  document.getElementById('logout-btn').addEventListener('click', handleLogout);

  // ── Sidebar collapse (desktop) ──
  const appLayout    = document.getElementById('app-container');
  const collapseBtn  = document.getElementById('sidebar-collapse-btn');
  const COLLAPSED_KEY = 'sidebar-collapsed';

  // Restore saved state
  if (localStorage.getItem(COLLAPSED_KEY) === '1') {
    appLayout.classList.add('sidebar-collapsed');
  }

  collapseBtn.addEventListener('click', () => {
    const isNowCollapsed = appLayout.classList.toggle('sidebar-collapsed');
    localStorage.setItem(COLLAPSED_KEY, isNowCollapsed ? '1' : '0');
  });

  // ── Mobile hamburger ──
  const sidebar        = document.getElementById('sidebar');
  const hamburgerBtn   = document.getElementById('hamburger-btn');
  const sidebarOverlay = document.getElementById('sidebar-overlay');

  function openMobileSidebar() {
    sidebar.classList.add('mobile-open');
    sidebarOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';
  }
  function closeMobileSidebar() {
    sidebar.classList.remove('mobile-open');
    sidebarOverlay.classList.remove('active');
    document.body.style.overflow = '';
  }

  hamburgerBtn.addEventListener('click', openMobileSidebar);
  sidebarOverlay.addEventListener('click', closeMobileSidebar);

  // Close mobile sidebar on nav link click
  document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', () => {
      if (window.innerWidth <= 768) closeMobileSidebar();
    });
  });

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
  document.getElementById('maint-date').addEventListener('change', updateExpectedCompletionHint);
  document.getElementById('maint-duration').addEventListener('input', updateExpectedCompletionHint);
  document.getElementById('dispose-asset-form').addEventListener('submit', submitDisposal);
  document.getElementById('create-request-form').addEventListener('submit', submitRequisition);
  document.getElementById('request-followup-form').addEventListener('submit', submitRequestFollowUp);
  document.getElementById('user-form').addEventListener('submit', submitUserForm);
  document.getElementById('change-password-form').addEventListener('submit', submitResetPassword);
  document.getElementById('change-own-password-form').addEventListener('submit', submitChangeOwnPassword);

  // Close modals on backdrop click
  document.getElementById('modal-backdrop').addEventListener('click', () => {
    closeAllModals();
  });

  // Handle radio button change for maintenance action
  initMaintenanceActionListeners();
}

function initMaintenanceActionListeners() {
  const radios = document.querySelectorAll('input[name="post-maintenance-action"]');
  radios.forEach(radio => {
    radio.addEventListener('change', (e) => {
      const assignSection = document.getElementById('assign-user-section');
      if (e.target.value === 'assign') {
        assignSection.style.display = 'block';
      } else {
        assignSection.style.display = 'none';
      }
    });
  });
}

// Handle Login
async function handleLogin(e) {
  e.preventDefault();
  loginInProgress = true;
  
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
      // Reset the form and clear the error before showing the app, to prevent
      // any residual form state from causing issues if the user hits back.
      document.getElementById('login-form').reset();
      errorDiv.textContent = '';
      showApp();
      // Release the lock after a short delay so any subsequent session checks
      // (e.g. after a page refresh) can proceed normally.
      setTimeout(() => { loginInProgress = false; }, 2000);
    } else {
      errorDiv.textContent = data.error || 'Authentication failed.';
      loginInProgress = false;
    }
  } catch (err) {
    errorDiv.textContent = 'Server unreachable. Check connections.';
    loginInProgress = false;
  }
}

// Handle Logout
async function handleLogout() {
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
  } catch(e) {}
  showToast('Logged out successfully.', 'info');
  loginInProgress = false;
  showLogin();
}

// Navigation & Router
// `filter` is an optional plain object describing how the destination view
// should be pre-filtered, e.g. { status: 'Active' } for the Asset Register
// or { progressStatus: 'In Progress' } for the Maintenance Log. Used by the
// clickable dashboard metric cards to jump straight to a filtered list.
function navigateTo(view, filter = null) {
  // Employees are not allowed to access the Asset Register view
  if (view === 'register' && currentUser && currentUser.role === 'Employee') {
    view = 'dashboard';
    filter = null;
  }
  const previousView = activeView;
  pendingViewFilter = filter;
  activeView = view;

  // Show the header's "Return to Dashboard" button on every page except the
  // dashboard itself, so users can always navigate back without using the sidebar.
  const backBtn = document.getElementById('return-to-dashboard-btn');
  if (backBtn) backBtn.style.display = (view !== 'dashboard') ? 'inline-flex' : 'none';
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
    'my-assets': 'My Assigned Assets',
    assignments: 'Asset Assignments',
    transfers: 'Asset Transfers',
    maintenance: 'Asset Maintenance Logs',
    disposals: 'Disposed Asset Archives',
    requests: 'Asset Requisitions',
    users: 'System User Accounts',
    audits: 'System Audit Logs'
  };
  document.getElementById('view-title').textContent = titleMap[view] || 'Asset Management System';
  
  // Render View content
  renderView(view);

  // After render, label table cells for mobile card-stack layout
  requestAnimationFrame(labelTableCells);
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
    case 'my-assets':
      renderMyAssetsView(container);
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
    const res = await fetch('/api/reports/dashboard', { cache: 'no-cache' });
    if (!res.ok) throw new Error('Failed to fetch dashboard metrics');
    const data = await res.json();

    // Computed up front (not inside the onclick string) so it's evaluated now,
    // while `data` is still in scope, rather than at click-time in the global
    // scope where `data` would be undefined and silently break the handler.
    const maintProgressStatus = data.maintenanceReadyForReview.length > 0 ? 'Ready for Review' : 'Active';

    // Employees can't access the Asset Register or Maintenance Log views, so
    // their dashboard cards must not act as shortcuts into those views. Render
    // them as plain, non-interactive <div>s (no onclick, no clickable class,
    // no navigation hint in the title) instead of <button>s for that role.
    const isEmployee = currentUser && currentUser.role === 'Employee';
    const cardTag = isEmployee ? 'div' : 'button';
    const cardTypeAttr = isEmployee ? '' : 'type="button"';
    const cardClickableClass = isEmployee ? '' : ' metric-card-clickable';

    container.innerHTML = `
      <!-- Metric Cards Grid: for roles with register/maintenance access, each
           card is a clickable shortcut into a pre-filtered view. For Employees
           the cards are informational only (see isEmployee above). -->
      <div class="grid grid-4" style="margin-bottom: 2rem;">
        <${cardTag} ${cardTypeAttr} class="metric-card${cardClickableClass} card-total" ${isEmployee ? '' : `onclick="navigateTo('register')"`} title="${isEmployee ? 'Total Active Assets' : 'View all assets in the Asset Register'}">
          <div class="metric-info">
            <span class="metric-title">Total Active Assets</span>
            <span class="metric-value">${data.counts.Active + data.counts.InStorage + data.counts.UnderMaintenance}</span>
          </div>
          <div class="metric-icon-box">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 7h-9m3 14H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v8"/></svg>
          </div>
        </${cardTag}>
        <${cardTag} ${cardTypeAttr} class="metric-card${cardClickableClass} card-active" ${isEmployee ? '' : `onclick="navigateTo('register', { status: 'Active' })"`} title="${isEmployee ? 'Assigned (Active)' : 'View assigned (active) assets in the Asset Register'}">
          <div class="metric-info">
            <span class="metric-title">Assigned (Active)</span>
            <span class="metric-value">${data.assignmentRatio.assigned || 0}</span>
          </div>
          <div class="metric-icon-box">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
          </div>
        </${cardTag}>
        <${cardTag} ${cardTypeAttr} class="metric-card${cardClickableClass} card-storage" ${isEmployee ? '' : `onclick="navigateTo('register', { status: 'In Storage' })"`} title="${isEmployee ? 'In Storage' : 'View in-storage assets in the Asset Register'}">
          <div class="metric-info">
            <span class="metric-title">In Storage</span>
            <span class="metric-value">${data.counts.InStorage}</span>
          </div>
          <div class="metric-icon-box">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
          </div>
        </${cardTag}>
        <${cardTag} ${cardTypeAttr} class="metric-card${cardClickableClass} card-maint" ${isEmployee ? '' : `onclick="navigateTo('maintenance', { progressStatus: '${maintProgressStatus}' })"`} title="${isEmployee ? 'Under Maintenance' : 'View active maintenance tickets in the Maintenance Log'}">
          <div class="metric-info">
            <span class="metric-title">Under Maintenance</span>
            <span class="metric-value">${data.counts.UnderMaintenance}</span>
          </div>
          <div class="metric-icon-box">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>
          </div>
        </${cardTag}>
      </div>

      <!-- Acquisition Trend (full width, stretched) -->
      <div class="dashboard-card" style="margin-top: 1.5rem;">
        <h3>Asset Acquisition Trend</h3>
        <div class="chart-container chart-container-wide">
          <canvas id="chartStatus"></canvas>
        </div>
      </div>

      <div class="dashboard-grid" style="margin-top: 1.5rem;">
        <!-- Asset Availability Table -->
        <div class="dashboard-card">
          <h3>Asset Availability <span class="text-secondary" style="font-size:0.8rem;font-weight:400;">For request reference</span></h3>
          <div class="table-responsive" style="max-height: 320px; overflow-y: auto;">
            <table style="margin-top: 0.5rem;">
              <thead>
                <tr>
                  <th>Asset ID</th>
                  <th>Asset Name</th>
                  <th>Category</th>
                  <th>Availability</th>
                </tr>
              </thead>
              <tbody>
                ${data.assetAvailability.length === 0 ? `
                  <tr><td colspan="4" class="text-center text-secondary">No assets to display.</td></tr>
                ` : data.assetAvailability.map(a => `
                  <tr>
                    <td><a href="#" class="text-link" onclick="viewAssetDetails('${a.id}')">${a.id}</a></td>
                    <td><strong>${a.name}</strong></td>
                    <td>${a.category}</td>
                    <td><span class="status-badge ${a.availability === 'Available' ? 'active' : 'under-maintenance'}">${a.availability}</span></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <div class="dashboard-card">
          <h3>Asset Count by Category</h3>
          <div class="chart-container">
            <canvas id="chartCategory" width="300" height="240"></canvas>
          </div>
        </div>
      </div>
      
      <!-- Maintenance Ready for Review -->
      <div class="dashboard-card" style="margin-top: 1.5rem;">
        <h3>Maintenance Ready for Review <span class="text-secondary" style="font-size:0.8rem;font-weight:400;">Estimated duration has elapsed &mdash; decide next step</span></h3>
        <div class="table-responsive">
          <table style="margin-top: 0.5rem;">
            <thead>
              <tr>
                <th>Asset ID</th>
                <th>Asset Name</th>
                <th>Service Provider</th>
                <th>Expected Completion</th>
                <th>Days Overdue</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              ${data.maintenanceReadyForReview.length === 0 ? `
                <tr><td colspan="6" class="text-center text-secondary">No maintenance jobs are due for review right now.</td></tr>
              ` : data.maintenanceReadyForReview.map(m => `
                <tr>
                  <td><a href="#" class="text-link" onclick="viewAssetDetails('${m.asset_id}')">${m.asset_id}</a></td>
                  <td><strong>${m.asset_name}</strong></td>
                  <td>${m.service_provider}</td>
                  <td><span class="text-danger" style="font-weight:600;">${m.expected_completion_date}</span></td>
                  <td>${m.days_overdue > 0 ? `${m.days_overdue} day(s)` : 'Due today'}</td>
                  <td>${currentUser.role === 'AssetManager' ? `<button class="btn btn-primary btn-sm" onclick="completeMaintenancePrompt('${m.id}', '${m.asset_id}')">Review &amp; Decide</button>` : '<span class="text-secondary">-</span>'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <!-- Maintenance Overdue Warnings -->
      <div class="dashboard-card" style="margin-top: 1.5rem;">
        <h3>Upcoming and Overdue Maintenance</h3>
        <p class="text-secondary" style="font-size:0.85rem;margin-top:0.4rem;">"Overdue" indicates an asset whose last completed maintenance listed a next service date before today and has no open maintenance job.</p>
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
    renderTrendChart('chartStatus', data.acquisitionTrend);
    renderCategoryChart('chartCategory', data.categoryDistribution);
    
  } catch (err) {
    container.innerHTML = `<div class="warning-banner">${err.message}</div>`;
  }
}

// Group daily trend data into weekly buckets when there are too many points,
// so the chart stays readable and the line has meaningful curvature instead of
// a flat stair-step across dozens of 0-or-1 daily values.
function _bucketTrendByWeek(trend) {
  // If already weekly (has only ~7-day-spaced dates) or fewer than 15 points,
  // return as-is.
  if (trend.length <= 14) return trend;

  const buckets = [];
  let weekStart = null, weekEnd = null, weekCount = 0, weekLabel = '';

  for (const entry of trend) {
    // Treat t.month as a YYYY-MM-DD string from the backend.
    const d = new Date(entry.month);
    if (isNaN(d.getTime())) {
      // Fallback: keep the raw value.
      buckets.push(entry);
      continue;
    }
    const dateStr = entry.month.substring(0, 10);
    if (!weekStart) {
      weekStart = d;
      weekEnd = d;
      weekCount = entry.count;
      weekLabel = dateStr;
      continue;
    }
    // If within 7 days of the bucket start, accumulate.
    const diffDays = (d - weekStart) / (1000 * 60 * 60 * 24);
    if (diffDays <= 7) {
      weekEnd = d;
      weekCount += entry.count;
    } else {
      buckets.push({ month: weekLabel, count: weekCount });
      weekStart = d;
      weekEnd = d;
      weekCount = entry.count;
      weekLabel = dateStr;
    }
  }
  // Push the last bucket.
  if (weekStart) buckets.push({ month: weekLabel, count: weekCount });
  return buckets;
}

// Draw Asset Acquisition Trend Line Chart with Smooth Curves (bezier)
function renderTrendChart(canvasId, trend) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  // Size the drawing buffer to match the actual rendered (stretched) size
  const rect = canvas.parentElement.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(rect.width, 300) * dpr;
  canvas.height = Math.max(rect.height, 240) * dpr;

  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const cssWidth = canvas.width / dpr;
  const cssHeight = canvas.height / dpr;

  ctx.clearRect(0, 0, cssWidth, cssHeight);

  // Bucket daily data into weekly chunks when there are many points, so the
  // line has visible curvature rather than a flat stair-step.
  const dataPoints = _bucketTrendByWeek(trend);

  if (!dataPoints || dataPoints.length === 0) {
    ctx.font = '14px Outfit';
    ctx.fillStyle = '#718096';
    ctx.fillText('No acquisition data to display', 40, 100);
    return;
  }

  const padding = { left: 50, right: 30, top: 30, bottom: 50 };
  const chartWidth = cssWidth - padding.left - padding.right;
  const chartHeight = cssHeight - padding.top - padding.bottom;

  const values = dataPoints.map(t => t.count);
  const maxVal = Math.max(...values, 1);
  const minVal = 0;

  // Draw enhanced background with subtle gradient
  const bgGradient = ctx.createLinearGradient(0, padding.top, 0, cssHeight - padding.bottom);
  bgGradient.addColorStop(0, 'rgba(248, 250, 252, 0.8)');
  bgGradient.addColorStop(1, 'rgba(240, 245, 250, 0.3)');
  ctx.fillStyle = bgGradient;
  ctx.fillRect(padding.left, padding.top, chartWidth, chartHeight);

  // Axes with enhanced styling and gradient
  const axisGradient = ctx.createLinearGradient(0, padding.top, 0, cssHeight - padding.bottom);
  axisGradient.addColorStop(0, '#a0aec0');
  axisGradient.addColorStop(1, '#cbd5e0');
  ctx.strokeStyle = axisGradient;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(padding.left, padding.top);
  ctx.lineTo(padding.left, cssHeight - padding.bottom);
  ctx.lineTo(cssWidth - padding.right, cssHeight - padding.bottom);
  ctx.stroke();

  // Gridlines + Y labels with enhanced styling
  const ySteps = 4;
  ctx.font = 'bold 11px Outfit';
  ctx.fillStyle = '#718096';
  for (let s = 0; s <= ySteps; s++) {
    const val = Math.round((maxVal / ySteps) * s);
    const y = cssHeight - padding.bottom - (val / maxVal) * chartHeight;

    // Alternating gridline opacity for better readability
    ctx.strokeStyle = s % 2 === 0 ? '#e2e8f0' : '#f0f4f8';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(cssWidth - padding.right, y);
    ctx.stroke();
    ctx.setLineDash([]);

    // Y-axis label with background
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.fillRect(2, y - 8, 30, 14);
    ctx.fillStyle = '#4a5568';
    ctx.fillText(val, 8, y + 3);
  }

  // Compute point coordinates
  const stepX = dataPoints.length > 1 ? chartWidth / (dataPoints.length - 1) : 0;
  const points = dataPoints.map((t, i) => {
    const x = padding.left + (dataPoints.length > 1 ? stepX * i : chartWidth / 2);
    const y = cssHeight - padding.bottom - ((t.count - minVal) / maxVal) * chartHeight;
    return { x, y, label: t.month, value: t.count };
  });

  // Create enhanced gradient for area fill
  const gradient = ctx.createLinearGradient(0, padding.top, 0, cssHeight - padding.bottom);
  gradient.addColorStop(0, 'rgba(45, 122, 196, 0.35)');
  gradient.addColorStop(0.5, 'rgba(30, 91, 168, 0.15)');
  gradient.addColorStop(1, 'rgba(10, 68, 142, 0.02)');

  // Fill area under SMOOTH line with gradient
  ctx.beginPath();
  ctx.moveTo(points[0].x, cssHeight - padding.bottom);
  if (points.length === 1) {
    ctx.lineTo(points[0].x, points[0].y);
  } else if (points.length === 2) {
    // Straight line for 2 points
    ctx.lineTo(points[0].x, points[0].y);
    ctx.lineTo(points[1].x, points[1].y);
  } else {
    // Draw smooth bezier curve through all points
    ctx.lineTo(points[0].x, points[0].y);
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[Math.max(i - 1, 0)];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[Math.min(i + 2, points.length - 1)];

      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;

      ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
    }
  }
  ctx.lineTo(points[points.length - 1].x, cssHeight - padding.bottom);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();

  // Draw SMOOTH line with enhanced shadow effect
  ctx.shadowColor = 'rgba(10, 68, 142, 0.25)';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 3;

  // Create gradient for line color
  const lineGradient = ctx.createLinearGradient(points[0].x, 0, points[points.length - 1].x, 0);
  lineGradient.addColorStop(0, '#0a448e');
  lineGradient.addColorStop(0.5, '#1e5ba8');
  lineGradient.addColorStop(1, '#2d7ac4');

  ctx.beginPath();
  if (points.length === 1) {
    ctx.moveTo(points[0].x, points[0].y);
  } else if (points.length === 2) {
    ctx.moveTo(points[0].x, points[0].y);
    ctx.lineTo(points[1].x, points[1].y);
  } else {
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[Math.max(i - 1, 0)];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[Math.min(i + 2, points.length - 1)];

      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;

      ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
    }
  }
  ctx.strokeStyle = lineGradient;
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.shadowColor = 'transparent';

  // Draw points with enhanced styling and glow effects
  points.forEach((p, idx) => {
    // Enhanced outer glow (multiple layers)
    for (let i = 3; i > 0; i--) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 7 + i, 0, 2 * Math.PI);
      ctx.fillStyle = `rgba(10, 68, 142, ${0.08 / i})`;
      ctx.fill();
    }

    // Inner circle with gradient
    const pointGradient = ctx.createRadialGradient(p.x - 2, p.y - 2, 0, p.x, p.y, 5);
    pointGradient.addColorStop(0, '#2d7ac4');
    pointGradient.addColorStop(1, '#0a448e');
    ctx.beginPath();
    ctx.arc(p.x, p.y, 5, 0, 2 * Math.PI);
    ctx.fillStyle = pointGradient;
    ctx.fill();

    // White center dot with shadow
    ctx.shadowColor = 'rgba(10, 68, 142, 0.3)';
    ctx.shadowBlur = 3;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 2.5, 0, 2 * Math.PI);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.shadowColor = 'transparent';

    // Value label above point with enhanced background
    ctx.font = 'bold 12px Outfit';
    ctx.fillStyle = '#1a202c';
    ctx.textAlign = 'center';
    const labelY = p.y - 20;

    // Background for label with shadow
    ctx.shadowColor = 'rgba(0, 0, 0, 0.1)';
    ctx.shadowBlur = 3;
    ctx.shadowOffsetY = 1;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.98)';
    ctx.fillRect(p.x - 18, labelY - 11, 36, 18);
    ctx.shadowColor = 'transparent';

    // Border for label
    ctx.strokeStyle = 'rgba(10, 68, 142, 0.15)';
    ctx.lineWidth = 1;
    ctx.strokeRect(p.x - 18, labelY - 11, 36, 18);

    // Label text
    ctx.fillStyle = '#0a448e';
    ctx.font = 'bold 11px Outfit';
    ctx.fillText(p.value, p.x, labelY + 3);

    // Date label below axis — show MM-DD for weekly buckets, YY-MM-DD for daily
    ctx.font = '10px Outfit';
    ctx.fillStyle = '#4a5568';
    const label = p.label ? p.label.substring(0, 10) : ''; // YYYY-MM-DD
    const displayLabel = label.length >= 10 ? label.substring(5) : label.substring(2); // MM-DD or YY-MM
    ctx.fillText(displayLabel, p.x, cssHeight - padding.bottom + 20);
  });
  ctx.textAlign = 'left';
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
            <button class="btn btn-primary" onclick="exportAssetRegisterPDF()">
              Export PDF
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
                <th>Assignee / Dept</th>
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

    // If we arrived here via a dashboard metric card click, pre-apply its filter
    if (pendingViewFilter) {
      const { status, type } = pendingViewFilter;
      pendingViewFilter = null;
      if (status) document.getElementById('asset-filter-status').value = status;
      if (type) document.getElementById('asset-filter-type').value = type;
      if (status || type) filterAssetTable();
    }
    
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
async function exportAssetRegisterPDF() {
  try {
    const res = await fetch("/api/reports/pdf/asset-register");
    if (!res.ok) throw new Error("Failed to generate PDF report.");
    
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `URSB_Asset_Register_${new Date().toISOString().split("T")[0]}.pdf`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast("PDF report generated successfully!", "success");
  } catch (error) {
    console.error("Error generating PDF:", error);
    showToast(`Error generating PDF: ${error.message}`, "error");
  }
}

function exportAssetRegisterCSV() {
  if (cacheData.assets.length === 0) {
    showToast('No asset data to export.', 'error');
    return;
  }
  
  let csvContent = 'Asset ID,Asset Name,Type,Category,Serial Number,Condition,Acquisition Date,Cost (UGX),Supplier,Source,Assignee,Department,Status\n';
  
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

// ================= VIEW: MY ASSETS =================

async function renderMyAssetsView(container) {
  try {
    // Fetch both assignments and requests in parallel
    const [assignRes, requestRes] = await Promise.all([
      fetch('/api/assignments'),
      fetch('/api/requests')
    ]);
    
    if (!assignRes.ok) throw new Error('Failed to load your assets');
    if (!requestRes.ok) throw new Error('Failed to load your requests');
    
    const allAssignments = await assignRes.json();
    const allRequests = await requestRes.json();
    
    // Filter assignments to only show active ones for current user
    const myAssignments = allAssignments.filter(a => a.assigned_to === currentUser.id && a.status === 'Active');
    
    // Filter requests to only show those for current user
    const myRequests = allRequests.filter(r => r.requested_by === currentUser.id);
    
    
    // Calculate stats
    const totalAssigned = myAssignments.length;
    const confirmedAssets = myAssignments.filter(a => a.confirmed_receipt === 1).length;
    // Requests that were approved AND the requester has confirmed receiving
    // the asset - these are just as much "assets you have" as a direct
    // assignment, so they should count toward your holdings too.
    const receivedRequests = myRequests.filter(r => r.status === 'Approved' && r.received_status === 'Received');
    const pendingRequests = myRequests.filter(r => r.status === 'Pending').length;
    // Everything currently in the user's possession, whichever route it came through.
    const totalHeld = totalAssigned + receivedRequests.length;
    
    // Cache the raw per-user lists so setMyAssetsFilter() can re-slice them
    // without another fetch, and reset to the unfiltered view on each load.
    myAssetsRawData = { assignments: myAssignments, requests: myRequests };
    myAssetsFilterType = 'all';

    container.innerHTML = `
      <div class="view-actions-bar">
        <h3>My Assets Dashboard</h3>
      </div>

      <!-- My Assets Summary Cards: each card filters the combined table below
           to the matching subset (mirrors the Maintenance page's filter cards). -->
      <div class="grid grid-4" id="my-assets-cards" style="margin-bottom: 2rem;">
        <button type="button" class="metric-card metric-card-clickable card-total" onclick="setMyAssetsFilter('held')" title="Show everything currently in your possession">
          <div class="metric-info">
            <span class="metric-title">Total Assets Held</span>
            <span class="metric-value">${totalHeld}</span>
          </div>
          <div class="metric-icon-box">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 7h-9m3 14H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v8"/></svg>
          </div>
        </button>
        <button type="button" class="metric-card metric-card-clickable card-active" onclick="setMyAssetsFilter('assigned')" title="Show assets directly assigned to you">
          <div class="metric-info">
            <span class="metric-title">Directly Assigned</span>
            <span class="metric-value">${totalAssigned}</span>
            <span class="metric-subtext">${confirmedAssets} receipt confirmed</span>
          </div>
          <div class="metric-icon-box">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="7" r="4"/><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/></svg>
          </div>
        </button>
        <button type="button" class="metric-card metric-card-clickable card-storage" onclick="setMyAssetsFilter('received')" title="Show assets you received via an approved request">
          <div class="metric-info">
            <span class="metric-title">Received via Request</span>
            <span class="metric-value">${receivedRequests.length}</span>
          </div>
          <div class="metric-icon-box">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
          </div>
        </button>
        <button type="button" class="metric-card metric-card-clickable card-maint" onclick="setMyAssetsFilter('pending')" title="Show your requests still awaiting a decision">
          <div class="metric-info">
            <span class="metric-title">Pending Requests</span>
            <span class="metric-value">${pendingRequests}</span>
          </div>
          <div class="metric-icon-box">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          </div>
        </button>
      </div>
      
      <!-- Combined Assets Table -->
      <div class="table-card">
        <div class="table-responsive">
          <table id="my-assets-table">
            <thead>
              <tr>
                <th>Reference</th>
                <th>Asset Name</th>
                <th>Type</th>
                <th>Date</th>
                <th>Status</th>
                <th>Manager Feedback</th>
                <th>Receipt Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody id="my-assets-tbody">
              <!-- Rendered dynamically -->
            </tbody>
          </table>
        </div>
      </div>
    `;
    
    applyMyAssetsFilter();
  } catch (err) {
    container.innerHTML = `<div class="warning-banner">${err.message}</div>`;
  }
}

// Re-slices the cached My Assets data per the active card filter and
// re-renders the table. 'all' (the default) shows everything unfiltered.
function applyMyAssetsFilter() {
  const { assignments, requests } = myAssetsRawData;
  let filteredAssignments = assignments;
  let filteredRequests = requests;

  switch (myAssetsFilterType) {
    case 'held':
      // "Total Assets Held": direct assignments + requests actually received.
      filteredRequests = requests.filter(r => r.status === 'Approved' && r.received_status === 'Received');
      break;
    case 'assigned':
      filteredRequests = [];
      break;
    case 'received':
      filteredAssignments = [];
      filteredRequests = requests.filter(r => r.status === 'Approved' && r.received_status === 'Received');
      break;
    case 'pending':
      filteredAssignments = [];
      filteredRequests = requests.filter(r => r.status === 'Pending');
      break;
    default:
      // 'all' - no slicing, show everything.
      break;
  }

  renderMyAssetsTableRows(filteredAssignments, filteredRequests, myAssetsFilterType !== 'all');
}

// Clicking the active card's filter again returns to the unfiltered view (toggle).
function setMyAssetsFilter(type) {
  myAssetsFilterType = (myAssetsFilterType === type) ? 'all' : type;
  applyMyAssetsFilter();
}

function renderMyAssetsTableRows(assignments, requests, isFiltered = false) {
  const tbody = document.getElementById('my-assets-tbody');
  
  if (assignments.length === 0 && requests.length === 0) {
    tbody.innerHTML = isFiltered
      ? `<tr><td colspan="8" class="table-empty">No items match this filter.</td></tr>`
      : `<tr><td colspan="8" class="table-empty">You don't have any assigned assets or active requests yet.</td></tr>`;
    return;
  }
  
  let html = '';
  
  // 1. Render Assigned Assets first
  assignments.forEach(a => {
    const receiptLabel = a.confirmed_receipt === 1 
      ? '<span class="status-badge active">✓ Confirmed</span>' 
      : '<span class="status-badge pending">⏱ Pending</span>';
    
    const actionBtn = a.confirmed_receipt === 0 
      ? `<button class="btn btn-secondary btn-sm" onclick="confirmReceiptAction('${a.id}')">Confirm Receipt</button>`
      : '<span class="text-secondary">-</span>';
    
    html += `
      <tr class="assignment-row">
        <td><strong>${a.asset_id}</strong></td>
        <td>${a.asset_name}</td>
        <td>${a.asset_type || '-'}</td>
        <td>${a.assignment_date}</td>
        <td><span class="status-badge active">Assigned</span></td>
        <td><span class="text-secondary">N/A</span></td>
        <td>${receiptLabel}</td>
        <td>${actionBtn}</td>
      </tr>
    `;
  });
  
  // 2. Render Requisitions next
  requests.forEach(r => {
    let actionBtn = '';
    if (r.status === 'Approved') {
      actionBtn = `<button class="btn btn-outline btn-sm" onclick="openRequestFollowUpModal('${r.id}')">Update Receipt</button>`;
    } else {
      actionBtn = '<span class="text-secondary">-</span>';
    }
    
    const statusClass = r.status.toLowerCase();
    const receiptStatusClass = r.received_status ? r.received_status.toLowerCase().replace(' ', '-') : 'pending';
    
    html += `
      <tr class="request-row" style="background-color: rgba(10, 68, 142, 0.02);">
        <td>#REQ-${r.id}</td>
        <td>${r.asset_name}</td>
        <td>${r.asset_type || '-'}</td>
        <td>${new Date(r.created_at).toLocaleDateString()}</td>
        <td><span class="status-badge ${statusClass}">${r.status}</span></td>
        <td>${r.manager_notes || '<span class="text-secondary">-</span>'}</td>
        <td><span class="status-badge ${receiptStatusClass}">${r.received_status || 'Pending'}</span></td>
        <td>${actionBtn}</td>
      </tr>
    `;
  });
  
  tbody.innerHTML = html;
}

// ================= VIEW: ASSIGNMENTS =================
async function renderAssignmentsView(container) {
  try {
    const res = await fetch('/api/assignments');
    if (!res.ok) throw new Error('Failed to load assignments');
    const data = await res.json();
    cacheData.assignments = data;
    
    // Filter assignments based on user role
    let filteredData = data;
    let viewTitle = 'All Asset Assignments';
    
    if (currentUser.role === 'Employee') {
      // Employees only see assets assigned to them
      filteredData = data.filter(a => a.assigned_to === currentUser.id);
      viewTitle = 'My Assigned Assets';
    }
    
    const assignBtnHtml = currentUser.role === 'AssetManager' ? `
      <button class="btn btn-primary" onclick="openAssignAssetModal()">Assign Asset</button>
    ` : '';
    
    container.innerHTML = `
      <div class="view-actions-bar">
        <div>
          <h3 style="margin: 0;">${viewTitle}</h3>
        </div>
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
                <th>Assigned To</th>
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
    
    renderAssignmentTableRows(filteredData);
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

// Store assignment data for receipt confirmation modal
let pendingReceiptConfirmation = null;

// Confirm receipt client callback - open modal
async function confirmReceiptAction(assignmentId) {
  // Find the assignment in cache
  const assignment = cacheData.assignments.find(a => a.id === parseInt(assignmentId));
  if (!assignment) {
    showToast('Assignment not found', 'error');
    return;
  }
  
  // Store for submission
  pendingReceiptConfirmation = assignmentId;
  
  // Populate modal with asset details
  document.getElementById('receipt-asset-id').textContent = assignment.asset_id;
  document.getElementById('receipt-asset-name').textContent = assignment.asset_name;
  document.getElementById('receipt-asset-type').textContent = assignment.asset_type || 'N/A';
  document.getElementById('receipt-asset-serial').textContent = assignment.serial_number || 'N/A';
  
  // Open modal
  openModal('modal-confirm-receipt');
}

// Submit receipt confirmation
async function submitConfirmReceipt() {
  if (!pendingReceiptConfirmation) {
    showToast('No assignment selected', 'error');
    return;
  }
  
  try {
    const res = await fetch(`/api/assignments/${pendingReceiptConfirmation}/confirm`, {
      method: 'PUT'
    });
    const data = await res.json();
    if (res.ok) {
      showToast('Receipt confirmed successfully!', 'success');
      closeModal('modal-confirm-receipt');
      pendingReceiptConfirmation = null;
      if (activeView === 'my-assets') {
        renderView('my-assets');
      } else {
        renderView('assignments');
      }
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
        <h3>Transfer History</h3>
        <div>
          <button class="btn btn-primary" onclick="openTransferAssetModal()">
            New Transfer
          </button>
        </div>
      </div>
      
      <div class="table-card">
        <div class="table-responsive">
          <table id="transfers-table">
            <thead>
              <tr>
                <th>Asset ID</th>
                <th>From</th>
                <th>To</th>
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
        <h3>Maintenance Management Dashboard</h3>
        <div>
          ${addMaintHtml}
        </div>
      </div>
      
      <!-- Maintenance Status Summary Cards -->
      <div class="grid grid-5" id="maintenance-summary" style="margin-bottom: 2rem;">
        <!-- Populated dynamically -->
      </div>
      
      <!-- Maintenance Progress Filters -->
      <div class="filters-bar" style="margin-bottom: 1.5rem;">
        <select id="maint-filter-status" class="filter-select" onchange="filterMaintenanceTable()">
          <option value="">All Statuses</option>
          <option value="Active">Active (Ongoing)</option>
          <option value="Ready for Review">Ready for Review</option>
          <option value="Overdue">Overdue</option>
          <option value="In Progress">In Progress</option>
          <option value="Scheduled">Scheduled</option>
          <option value="Completed">Completed</option>
        </select>
        <input type="text" id="maint-search" placeholder="Search by asset name or provider..." class="filter-input" oninput="filterMaintenanceTable()">
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
                <th>Expected Completion</th>
                <th>Next Service Due</th>
                <th>Progress</th>
                <th>Next Action</th>
              </tr>
            </thead>
            <tbody id="maintenance-tbody">
              <!-- Loaded dynamically -->
            </tbody>
          </table>
        </div>
      </div>
    `;
    
    await loadMaintenanceTable();

    // If we arrived here via a dashboard metric card click, pre-apply its filter
    if (pendingViewFilter) {
      const { progressStatus } = pendingViewFilter;
      pendingViewFilter = null;
      if (progressStatus) {
        document.getElementById('maint-filter-status').value = progressStatus;
        filterMaintenanceTable();
      }
    }
  } catch (err) {
    container.innerHTML = `<div class="warning-banner">${err.message}</div>`;
  }
}

async function loadMaintenanceTable() {
  const tbody = document.getElementById('maintenance-tbody');
  tbody.innerHTML = `<tr><td colspan="9" class="table-empty">Loading tickets...</td></tr>`;
  try {
    const res = await fetch('/api/maintenance');
    if (!res.ok) throw new Error('Failed to load maintenance records');
    const records = await res.json();
    
    cacheData.maintenance = records;
    
    // Render summary cards
    renderMaintenanceSummary(records);
    
    if (records.length === 0) {
      tbody.innerHTML = `<tr><td colspan="9" class="table-empty">No maintenance events recorded.</td></tr>`;
      return;
    }
    
    renderMaintenanceTableRows(records);
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="9" class="table-empty text-danger">${err.message}</td></tr>`;
  }
}

function renderMaintenanceSummary(records) {
  const summary = document.getElementById('maintenance-summary');
  
  const counts = {
    readyForReview: records.filter(m => m.progress_status === 'Ready for Review' || m.progress_status === 'Due Today').length,
    overdue: records.filter(m => m.progress_status === 'Overdue').length,
    inProgress: records.filter(m => m.progress_status === 'In Progress').length,
    scheduled: records.filter(m => m.progress_status === 'Scheduled').length,
    completed: records.filter(m => m.progress_status === 'Completed').length
  };
  
  // Each card is clickable and instantly filters the table below it,
  // mirroring the same status options as the "All Statuses" dropdown.
  summary.innerHTML = `
    <button type="button" class="metric-card metric-card-clickable card-maint" onclick="setMaintenanceStatusFilter('Ready for Review')" title="Show jobs whose estimated duration has elapsed and need a decision">
      <div class="metric-info">
        <span class="metric-title">Ready for Review</span>
        <span class="metric-value">${counts.readyForReview}</span>
      </div>
      <div class="metric-icon-box">
        <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
        </svg>
      </div>
    </button>

    <button type="button" class="metric-card metric-card-clickable card-maint" onclick="setMaintenanceStatusFilter('Overdue')" title="Show overdue maintenance tickets">
      <div class="metric-info">
        <span class="metric-title">Overdue</span>
        <span class="metric-value">${counts.overdue}</span>
      </div>
      <div class="metric-icon-box">
        <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
        </svg>
      </div>
    </button>
    
    <button type="button" class="metric-card metric-card-clickable card-maint" onclick="setMaintenanceStatusFilter('In Progress')" title="Show in-progress maintenance tickets">
      <div class="metric-info">
        <span class="metric-title">In Progress</span>
        <span class="metric-value">${counts.inProgress}</span>
      </div>
      <div class="metric-icon-box">
        <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
        </svg>
      </div>
    </button>
    
    <button type="button" class="metric-card metric-card-clickable card-storage" onclick="setMaintenanceStatusFilter('Scheduled')" title="Show scheduled maintenance tickets">
      <div class="metric-info">
        <span class="metric-title">Scheduled</span>
        <span class="metric-value">${counts.scheduled}</span>
      </div>
      <div class="metric-icon-box">
        <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
          <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14zm-5-7h4v2h-4zm0 4h4v2h-4zm-5-8h2v2h-2zm3 0h2v2h-2zm3 0h2v2h-2z"/>
        </svg>
      </div>
    </button>
    
    <button type="button" class="metric-card metric-card-clickable card-active" onclick="setMaintenanceStatusFilter('Completed')" title="Show completed maintenance tickets">
      <div class="metric-info">
        <span class="metric-title">Completed</span>
        <span class="metric-value">${counts.completed}</span>
      </div>
      <div class="metric-icon-box">
        <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
        </svg>
      </div>
    </button>
  `;
}

// Sets the maintenance status dropdown to the given value (or clears it if
// it's already selected, acting as a toggle) and re-filters the table.
function setMaintenanceStatusFilter(status) {
  const select = document.getElementById('maint-filter-status');
  if (!select) return;
  select.value = (select.value === status) ? '' : status;
  filterMaintenanceTable();
}

function renderMaintenanceTableRows(records) {
  const tbody = document.getElementById('maintenance-tbody');
  
  if (records.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="table-empty">No maintenance events recorded.</td></tr>`;
    return;
  }
  
  tbody.innerHTML = records.map(m => {
    // Determine progress badge color and text
    let progressBadgeClass = 'active';
    if (m.progress_status === 'Ready for Review' || m.progress_status === 'Due Today') progressBadgeClass = 'disposed';
    else if (m.progress_status === 'Overdue') progressBadgeClass = 'disposed';
    else if (m.progress_status === 'In Progress') progressBadgeClass = 'under-maintenance';
    else if (m.progress_status === 'Scheduled') progressBadgeClass = 'in-storage';
    else if (m.progress_status === 'Completed') progressBadgeClass = 'active';
    
    const readyForReview = m.completed !== 1 && (m.progress_status === 'Ready for Review' || m.progress_status === 'Due Today');
    
    // Determine next action
    let nextAction = '';
    if (m.completed === 1) {
      nextAction = '<span class="text-secondary">-</span>';
    } else if (currentUser.role === 'AssetManager') {
      nextAction = `<button class="btn ${readyForReview ? 'btn-primary' : 'btn-secondary'} btn-sm" onclick="completeMaintenancePrompt('${m.id}', '${m.asset_id}')">${readyForReview ? 'Review & Decide' : 'Complete'}</button>`;
    } else {
      nextAction = '<span class="text-secondary">Pending</span>';
    }
    
    // Calculate days remaining/overdue
    let daysInfo = '';
    if (m.next_service_date) {
      const today = new Date();
      const dueDate = new Date(m.next_service_date);
      const diffTime = dueDate - today;
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      
      if (diffDays < 0) {
        daysInfo = `<span style="color: #c53030; font-weight: 600;">${Math.abs(diffDays)} days overdue</span>`;
      } else if (diffDays <= 7) {
        daysInfo = `<span style="color: #e65100; font-weight: 600;">${diffDays} days remaining</span>`;
      }
    }
    
    return `
      <tr>
        <td><strong>${m.asset_id}</strong></td>
        <td>${m.asset_name}</td>
        <td>${m.service_provider}</td>
        <td>UGX ${Number(m.cost).toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
        <td>${m.service_date}</td>
        <td>${m.expected_completion_date ? `<span style="${readyForReview ? 'color:#c53030;font-weight:600;' : ''}">${m.expected_completion_date}</span>` : 'N/A'}</td>
        <td>
          <div>${m.next_service_date || 'N/A'}</div>
          ${daysInfo}
        </td>
        <td><span class="status-badge ${progressBadgeClass}">${m.progress_status}</span></td>
        <td>${nextAction}</td>
      </tr>
    `;
  }).join('');
}

function filterMaintenanceTable() {
  const statusFilter = document.getElementById('maint-filter-status')?.value || '';
  const searchFilter = document.getElementById('maint-search')?.value.toLowerCase() || '';
  
  if (!cacheData.maintenance) return;
  
  const filtered = cacheData.maintenance.filter(m => {
    const matchStatus = !statusFilter ||
      (statusFilter === 'Active' ? m.progress_status !== 'Completed' : m.progress_status === statusFilter);
    const matchSearch = !searchFilter || 
      m.asset_name.toLowerCase().includes(searchFilter) || 
      m.service_provider.toLowerCase().includes(searchFilter) ||
      m.asset_id.toLowerCase().includes(searchFilter);
    
    return matchStatus && matchSearch;
  });
  
  renderMaintenanceTableRows(filtered);
}

// Store maintenance data for completion modal
let pendingMaintenanceCompletion = null;

async function completeMaintenancePrompt(maintenanceId, assetId) {
  // Find the maintenance record
  const res = await fetch('/api/maintenance');
  if (!res.ok) {
    showToast('Failed to load maintenance data', 'error');
    return;
  }
  const records = await res.json();
  const maintenance = records.find(m => m.id === parseInt(maintenanceId));
  
  if (!maintenance) {
    showToast('Maintenance record not found', 'error');
    return;
  }
  
  // Store for submission
  pendingMaintenanceCompletion = maintenanceId;
  
  // Populate modal
  document.getElementById('complete-maint-asset-id').textContent = maintenance.asset_id;
  document.getElementById('complete-maint-asset-name').textContent = maintenance.asset_name;
  document.getElementById('complete-maint-date').value = new Date().toISOString().split('T')[0];

  // Give the manager the timing context that led to this review: how long
  // the job was expected to take, and whether it's now overdue against that estimate.
  const timingNote = document.getElementById('complete-maint-timing-note');
  if (timingNote) {
    if (maintenance.expected_completion_date) {
      const today = new Date().toISOString().split('T')[0];
      const isOverdue = maintenance.expected_completion_date < today;
      timingNote.innerHTML = isOverdue
        ? `<span style="color:#c53030;font-weight:600;">Estimated completion was ${maintenance.expected_completion_date} — this is now overdue against that estimate.</span>`
        : `Estimated completion date: <strong>${maintenance.expected_completion_date}</strong>.`;
    } else {
      timingNote.textContent = '';
    }
  }
  
  // Load users for assignment dropdown and try to pre-select last assignee
  try {
    const [usersRes, historyRes] = await Promise.all([
      fetch('/api/users'),
      fetch(`/api/reports/history/${assetId}`)
    ]);
    
    let lastAssigneeId = null;
    if (historyRes.ok) {
      const history = await historyRes.json();
      if (history.assignments && history.assignments.length > 0) {
        // The most recent assignment is first due to ORDER BY assignment_date DESC
        lastAssigneeId = history.assignments[0].assigned_to;
      }
    }

    if (usersRes.ok) {
      const users = await usersRes.json();
      const selectEl = document.getElementById('complete-maint-assign-to');
      selectEl.innerHTML = '<option value="">Select a user...</option>';
      users.forEach(u => {
        if (u.status === 'Active') {
          const option = document.createElement('option');
          option.value = u.id;
          option.textContent = `${u.name} (${u.department})${u.id === lastAssigneeId ? ' [Last Assignee]' : ''}`;
          if (u.id === lastAssigneeId) option.selected = true;
          selectEl.appendChild(option);
        }
      });
    }
  } catch (err) {
    console.error('Failed to load users or history:', err);
  }
  
  // Reset radio buttons
  document.querySelector('input[name="post-maintenance-action"][value="storage"]').checked = true;
  document.getElementById('assign-user-section').style.display = 'none';
  
  // Open modal
  openModal('modal-complete-maintenance');
}

// Submit complete maintenance
async function submitCompleteMaintenance() {
  if (!pendingMaintenanceCompletion) {
    showToast('No maintenance record selected', 'error');
    return;
  }
  
  const completionDate = document.getElementById('complete-maint-date').value;
  if (!completionDate) {
    showToast('Please select a completion date', 'error');
    return;
  }
  
  const action = document.querySelector('input[name="post-maintenance-action"]:checked').value;
  let nextStatus = 'In Storage';
  let assignToId = null;
  
  if (action === 'assign') {
    assignToId = document.getElementById('complete-maint-assign-to').value;
    if (!assignToId) {
      showToast('Please select a user to assign the asset to', 'error');
      return;
    }
    nextStatus = 'Active';
  } else if (action === 'dispose') {
    nextStatus = 'Disposed';
  }
  
  try {
    const res = await fetch(`/api/maintenance/${pendingMaintenanceCompletion}/complete`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ completionDate, nextStatus, assignToId })
    });
    const data = await res.json();
    if (res.ok) {
      showToast('Maintenance marked as completed!', 'success');
      
      // If assign action was selected, create the assignment
      if (action === 'assign' && assignToId && data.assetId) {
        try {
          const assignRes = await fetch('/api/assignments', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              assetId: data.assetId,
              assignedTo: parseInt(assignToId),
              assignmentDate: new Date().toISOString().split('T')[0],
              purpose: 'Post-maintenance assignment',
              notes: `Assigned after maintenance completion on ${completionDate}`
            })
          });
          if (assignRes.ok) {
            showToast('Asset assigned successfully after maintenance!', 'success');
          } else {
            const assignError = await assignRes.json();
            showToast('Maintenance completed but assignment failed: ' + (assignError.error || 'Unknown error'), 'warning');
          }
        } catch (assignErr) {
          showToast('Maintenance completed but assignment failed: Network error', 'warning');
        }
      } else if (action === 'dispose' && data.assetId) {
        // If dispose action was selected, also record it in the disposals archive
        try {
          await fetch('/api/disposals', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              assetId: data.assetId,
              disposalDate: completionDate,
              method: 'Scrapped',
              reason: 'Too foregone/damaged beyond repair after maintenance'
            })
          });
          showToast('Asset marked as disposed in archive.', 'success');
        } catch (err) {
          console.error('Failed to record disposal archive:', err);
        }
      }
      
      closeModal('modal-complete-maintenance');
      pendingMaintenanceCompletion = null;
      renderView(activeView);
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
        <td>UGX ${Number(asset.cost).toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
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
                <th>Receipt Status</th>
                <th>My Feedback</th>
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
    } else if (r.status === 'Approved' && currentUser.role === 'AssetManager') {
      actionBtn = `
        <button class="btn btn-outline btn-sm" onclick="revokeRequestAction('${r.id}')">Revoke</button>
      `;
    } else if (r.requested_by === currentUser.id) {
      actionBtn = `
        <button class="btn btn-outline btn-sm" onclick="openRequestFollowUpModal('${r.id}')">Update Status</button>
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
        <td><span class="status-badge ${r.received_status ? r.received_status.toLowerCase().replace(' ', '-') : 'pending'}">${r.received_status || 'Pending'}</span></td>
        <td>${r.requester_feedback || '<span class="text-secondary">-</span>'}</td>
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

async function revokeRequestAction(requestId) {
  const confirmed = confirm('Revoke this previously approved requisition? The employee will no longer be authorised to collect this asset.');
  if (!confirmed) return;

  const managerNotes = prompt('Enter optional reason for revoking this requisition:');
  if (managerNotes === null) return; // cancelled

  try {
    const res = await fetch(`/api/requests/${requestId}/revoke`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ managerNotes })
    });
    const data = await res.json();
    if (res.ok) {
      showToast('Requisition revoked.', 'success');
      renderView('requests');
    } else {
      showToast(data.error || 'Failed to revoke request', 'error');
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
    document.getElementById('det-cost').textContent = `UGX ${Number(data.asset.cost).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
    document.getElementById('det-supplier').textContent = data.asset.supplier;
    document.getElementById('det-source').textContent = data.asset.source;
    
    // Assignee Details
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
        desc: `Diagnostic: ${m.description}. Cost: UGX ${Number(m.cost).toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
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
  updateExpectedCompletionHint();
  
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

// Shows the manager, in plain language, exactly which date their estimated
// duration works out to, so "how long will it take" has a concrete answer
// before the ticket is even opened.
function updateExpectedCompletionHint() {
  const hint = document.getElementById('maint-expected-completion-hint');
  if (!hint) return;
  const dateVal = document.getElementById('maint-date').value;
  const durationVal = parseInt(document.getElementById('maint-duration').value, 10);
  
  if (!dateVal || !durationVal || durationVal < 1) {
    hint.textContent = 'This asset will be flagged for your review once this many days have passed.';
    return;
  }
  
  const expected = new Date(dateVal + 'T00:00:00');
  expected.setDate(expected.getDate() + durationVal);
  const expectedStr = expected.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  hint.textContent = `Expected completion: ${expectedStr}. You'll be notified to review this asset from that date.`;
}

async function submitMaintenanceEvent(e) {
  e.preventDefault();
  const payload = {
    assetId: document.getElementById('maint-asset-select').value,
    serviceProvider: document.getElementById('maint-provider').value,
    serviceDate: document.getElementById('maint-date').value,
    estimatedDurationDays: document.getElementById('maint-duration').value,
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
async function openCreateRequestModal() {
  document.getElementById('create-request-form').reset();
  openModal('modal-create-request');
  await populateAvailableAssetsDropdown();
}

async function populateAvailableAssetsDropdown() {
  const select = document.getElementById('req-asset-select');
  if (!select) return;
  select.innerHTML = `<option value="">Loading available assets...</option>`;
  try {
    const res = await fetch('/api/reports/dashboard', { cache: 'no-cache' });
    if (!res.ok) throw new Error('Failed to load assets');
    const data = await res.json();
    const available = (data.assetAvailability || []).filter(a => a.availability === 'Available');

    select.innerHTML = `<option value="">-- Choose an in-stock asset, or describe a new one below --</option>` +
      (available.length === 0
        ? `<option value="" disabled>No assets currently available in stock</option>`
        : available.map(a => `<option value="${a.id}" data-name="${a.name}" data-type="${a.type || a.category}">${a.name} (${a.id}) — ${a.category}</option>`).join(''));
  } catch (err) {
    select.innerHTML = `<option value="">-- Could not load available assets --</option>`;
  }
}

function handleAvailableAssetSelect(selectEl) {
  const option = selectEl.options[selectEl.selectedIndex];
  if (!option || !option.value) return;
  document.getElementById('req-asset-name').value = option.dataset.name || '';
  document.getElementById('req-asset-type').value = option.dataset.type || '';
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
      showToast('Requisition submitted for review!', 'success');
      closeModal('modal-create-request');
      // Refresh whichever view the request was submitted from (My Assets or
      // Requests) so its stats/table reflect the new request immediately.
      renderView(activeView);
    } else {
      showToast(data.error || 'Failed to submit request', 'error');
    }
  } catch (err) {
    showToast('Network error.', 'error');
  }
}

let pendingRequestFollowUp = null;

function openRequestFollowUpModal(requestId) {
  const req = cacheData.requests.find(r => r.id === parseInt(requestId));
  if (!req) return;
  
  pendingRequestFollowUp = requestId;
  document.getElementById('followup-received-status').value = req.received_status || 'Pending';
  document.getElementById('followup-feedback').value = req.requester_feedback || '';
  
  openModal('modal-request-followup');
}

async function submitRequestFollowUp(e) {
  e.preventDefault();
  const payload = {
    receivedStatus: document.getElementById('followup-received-status').value,
    feedback: document.getElementById('followup-feedback').value
  };
  
  try {
    const res = await fetch(`/api/requests/${pendingRequestFollowUp}/followup`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      showToast('Status updated successfully!', 'success');
      closeModal('modal-request-followup');
      // Refresh whichever view triggered this (My Assets or Requests) so its
      // stats/table reflect the updated receipt status immediately.
      renderView(activeView);
    } else {
      const data = await res.json();
      showToast(data.error || 'Failed to update status', 'error');
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

// Tracks which "ready for review" maintenance IDs we've already popped a toast for,
// so the manager gets notified once per job becoming ready, not on every poll.
let notifiedReadyMaintenanceIds = new Set();
let alertsPollingStarted = false;

async function loadUpcomingAlerts() {
  const badge = document.getElementById('alerts-indicator');
  const countSpan = document.getElementById('alerts-count');
  const alertsList = document.getElementById('alerts-list');
  
  try {
    const res = await fetch('/api/reports/dashboard', { cache: 'no-cache' });
    if (!res.ok) return;
    const data = await res.json();

    const readyItems = data.maintenanceReadyForReview || [];
    const upcomingItems = data.upcomingMaintenance || [];
    const count = readyItems.length + upcomingItems.length;

    if (count > 0) {
      badge.style.display = 'block';
      countSpan.textContent = count;

      const readyHtml = readyItems.map(m => `
        <li>
          <div class="alert-item-title text-danger">Maintenance Ready for Review</div>
          <div class="alert-item-detail">
            Asset <strong>${m.asset_id}</strong> (${m.asset_name}) was expected to finish servicing with ${m.service_provider} by <strong>${m.expected_completion_date}</strong>. Decide whether to close it out or extend it.
          </div>
        </li>
      `).join('');

      const upcomingHtml = upcomingItems.map(m => `
        <li>
          <div class="alert-item-title">Maintenance Due!</div>
          <div class="alert-item-detail">
            Asset <strong>${m.asset_id}</strong> (${m.asset_name}) is scheduled for servicing by ${m.service_provider} on <strong>${m.next_service_date || m.service_date}</strong>.
          </div>
        </li>
      `).join('');

      alertsList.innerHTML = readyHtml + upcomingHtml;
    } else {
      badge.style.display = 'none';
      alertsList.innerHTML = '<li class="dropdown-empty">No critical alerts.</li>';
    }

    // Pop a toast the moment a job newly crosses into "ready for review", so the
    // asset manager is notified proactively rather than only on-demand.
    if (currentUser && currentUser.role === 'AssetManager') {
      readyItems.forEach(m => {
        if (!notifiedReadyMaintenanceIds.has(m.id)) {
          notifiedReadyMaintenanceIds.add(m.id);
          showToast(`Maintenance for asset ${m.asset_id} (${m.asset_name}) is ready for your review.`, 'info');
        }
      });
    }
  } catch(e) {}
}

// Starts periodic polling so notifications appear while the manager stays logged
// in, without requiring a manual refresh of the page.
function startAlertsPolling() {
  if (alertsPollingStarted) return;
  alertsPollingStarted = true;
  setInterval(loadUpcomingAlerts, 60000);
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
  
  // Auto-remove after 2 seconds
  const timer = setTimeout(() => {
    if (toast.parentNode) {
      toast.parentNode.removeChild(toast);
    }
  }, 2000);
  
  toast.querySelector('.toast-close').onclick = () => {
    clearTimeout(timer);
    removeToast(toast);
  };
}

function removeToast(toast) {
  if (toast.parentNode) {
    toast.parentNode.removeChild(toast);
  }
}

// ================= GENERAL HELPERS =================
function formatRole(role) {
  if (role === 'AssetManager') return 'Asset Manager';
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

// ================= LOGIN PAGE SLIDESHOW =================
(function initLoginSlideshow() {
  const slides = document.querySelectorAll('#login-slideshow .slide');
  if (!slides.length) return;

  let current = 0;

  function showNext() {
    slides[current].classList.remove('active');
    current = (current + 1) % slides.length;
    slides[current].classList.add('active');
  }

  // Switch every 10 seconds
  setInterval(showNext, 10000);
})();

// ================================================================
// MOBILE TABLE LABELLING — adds data-label to each <td> so the
// CSS card-stack layout can show column names without <thead>
// ================================================================
function labelTableCells() {
  document.querySelectorAll('.table-responsive table, table').forEach(table => {
    const headers = Array.from(table.querySelectorAll('thead th')).map(th => th.textContent.trim());
    if (!headers.length) return;
    table.querySelectorAll('tbody tr').forEach(row => {
      Array.from(row.querySelectorAll('td')).forEach((td, i) => {
        if (headers[i]) td.setAttribute('data-label', headers[i]);
      });
    });
  });
}

// Re-label whenever the viewport content changes (async renders, filter updates)
(function watchViewport() {
  const vp = document.getElementById('viewport');
  if (!vp) return;
  new MutationObserver(() => {
    requestAnimationFrame(labelTableCells);
  }).observe(vp, { childList: true, subtree: true });
})();
