const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');
const controller = require('./controller');
const { dbReady } = require('./db');

// --- Environment Configuration ---
const PORT = parseInt(process.env.PORT, 10) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'database.db');
const NODE_ENV = process.env.NODE_ENV || 'development';
const SSL_KEY_PATH = process.env.SSL_KEY_PATH || '';
const SSL_CERT_PATH = process.env.SSL_CERT_PATH || '';
const RATE_LIMIT_WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000; // 15 min
const RATE_LIMIT_MAX_LOGIN = parseInt(process.env.RATE_LIMIT_MAX_LOGIN, 10) || 10;

// Map controller error messages to appropriate HTTP status codes so genuine
// client errors return 4xx instead of a misleading 500, while internal
// failures (SQLite errors, crashes) still surface as 500.
function classifyError(error) {
  if (error && error.status) return error.status;
  const msg = (error && error.message) || '';
  const lower = msg.toLowerCase();
  if (/not found|not exist|already disposed|no active/i.test(lower)) return 404;
  if (/unauthorized|forbidden|permission/i.test(lower)) return 403;
  if (/invalid username or password|unauthenticated|deactivated|session|logged out/i.test(lower)) return 401;
  if (/already taken|already exists|duplicate|unique constraint|already (assigned|disposed|requested|approved|rejected|returned|confirmed|revoked)/i.test(lower)) return 409;
  if (/required|must|invalid|is not|missing|cannot|too many|too large|invalid json|provide|\bmust be\b/i.test(lower)) return 400;
  if (/sqlite|constraint/i.test(lower)) return 500;
  return 400;
}

const PUBLIC_DIR = path.join(__dirname, 'public');

// --- Simple In-Memory Rate Limiter ---
const rateLimitStore = new Map();
function rateLimit(key, maxAttempts, windowMs) {
  const now = Date.now();
  if (!rateLimitStore.has(key)) {
    rateLimitStore.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: maxAttempts - 1 };
  }
  const entry = rateLimitStore.get(key);
  if (now > entry.resetAt) {
    rateLimitStore.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: maxAttempts - 1 };
  }
  entry.count += 1;
  if (entry.count > maxAttempts) {
    return { allowed: false, remaining: 0 };
  }
  return { allowed: true, remaining: maxAttempts - entry.count };
}

// MIME types lookup
const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

// Security headers applied to every HTTP response (defense-in-depth for
// XSS/clickjacking/MIME-sniffing and a hint to switch to HTTPS).
function applySecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
}

// Helper: send JSON response
function sendJSON(res, data, status = 200, headers = {}) {
  const baseHeaders = { 'Content-Type': 'application/json', ...headers };
  applySecurityHeaders(res);
  res.writeHead(status, baseHeaders);
  res.end(JSON.stringify(data));
}

// Helper: send Error response
function sendError(res, message, status = 400, headers = {}) {
  sendJSON(res, { error: message }, status, headers);
}

// Maximum accepted request body size (1 MB). Prevents memory exhaustion via
// enormous payloads (body-parser style DoS protection).
const MAX_BODY_SIZE = 1 * 1024 * 1024;

// Helper: parse request body
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY_SIZE) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(new Error('Invalid JSON body'));
      }
    });
  });
}

// Helper: Authenticate session from Cookie or Authorization header
function authenticate(req) {
  let sessionId = null;
  
  // 1. Check Authorization header: Bearer <token>
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    sessionId = authHeader.substring(7);
  }
  
  // 2. Check Cookie: session=<token>
  if (!sessionId && req.headers.cookie) {
    const cookies = req.headers.cookie.split(';').reduce((acc, c) => {
      const parts = c.trim().split('=');
      acc[parts[0]] = parts[1];
      return acc;
    }, {});
    sessionId = cookies['session'];
  }
  
  if (!sessionId) return null;
  return controller.getSession(sessionId);
}

// Main HTTP Handler
const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  const method = req.method;
  
  console.log(`${method} ${pathname}`);

  // --- API ROUTING ---
  if (pathname.startsWith('/api/')) {
    try {
      // Unauthenticated routes
      if (pathname === '/api/auth/login' && method === 'POST') {
        const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
        const limit = rateLimit(`login:${clientIp}`, RATE_LIMIT_MAX_LOGIN, RATE_LIMIT_WINDOW_MS);
        res.setHeader('X-RateLimit-Remaining', String(limit.remaining));
        if (!limit.allowed) {
          return sendError(res, 'Too many login attempts. Please try again later.', 429);
        }
        const body = await parseBody(req);
        const result = await controller.login(body.username, body.password);
        
        // Set a hardened session cookie so the user must log in again after
        // closing the browser. The session id is never returned in the JSON
        // body (it is only written into the HttpOnly cookie, so client-side
        // JS cannot read it and it is not exposed in server responses).
        const secure = NODE_ENV === 'production' ? '; Secure' : '';
        res.setHeader('Set-Cookie', `session=${result.sessionId}; Path=/; HttpOnly; SameSite=Strict${secure}`);
        return sendJSON(res, { user: result.user });
      }
      
      if (pathname === '/api/auth/logout' && method === 'POST') {
        let sessionId = null;
        if (req.headers.cookie) {
          const cookies = req.headers.cookie.split(';').reduce((acc, c) => {
            const parts = c.trim().split('=');
            acc[parts[0]] = parts[1];
            return acc;
          }, {});
          sessionId = cookies['session'];
        }
        
        if (sessionId) {
          controller.logout(sessionId);
        }
        const secureCookie = NODE_ENV === 'production' ? '; Secure' : '';
        res.setHeader('Set-Cookie', `session=; Path=/; HttpOnly; SameSite=Strict${secureCookie}; Max-Age=0`);
        return sendJSON(res, { success: true });
      }

      // Check Authentication for all other APIs
      const user = authenticate(req);
      if (!user) {
        return sendError(res, 'Unauthenticated session. Please log in.', 401);
      }

      // GET current session details
      if (pathname === '/api/auth/session' && method === 'GET') {
        return sendJSON(res, { user });
      }

      // Change own password (any authenticated user)
      if (pathname === '/api/auth/password' && method === 'PUT') {
        const body = await parseBody(req);
        return sendJSON(res, await controller.changeOwnPassword(user, body));
      }

      // 1. Users CRUD (Admin)
      if (pathname === '/api/users' && method === 'GET') {
        return sendJSON(res, controller.listUsers(user));
      }
      if (pathname === '/api/users/bulk-import' && method === 'POST') {
        const body = await parseBody(req);
        return sendJSON(res, await controller.bulkCreateUsers(user, body));
      }
      if (pathname === '/api/users' && method === 'POST') {
        const body = await parseBody(req);
        return sendJSON(res, await controller.createUser(user, body), 201);
      }
      
      const userMatch = pathname.match(/^\/api\/users\/(\d+)$/);
      if (userMatch && method === 'PUT') {
        const userId = userMatch[1];
        const body = await parseBody(req);
        return sendJSON(res, controller.updateUser(user, userId, body));
      }

      const userPassMatch = pathname.match(/^\/api\/users\/(\d+)\/password$/);
      if (userPassMatch && method === 'PUT') {
        const userId = userPassMatch[1];
        const body = await parseBody(req);
        return sendJSON(res, await controller.changePassword(user, userId, body));
      }

      // 2. Assets (All authenticated roles can read, Managers register)
      if (pathname === '/api/assets' && method === 'GET') {
        return sendJSON(res, controller.listAssets());
      }
      if (pathname === '/api/assets' && method === 'POST') {
        const body = await parseBody(req);
        return sendJSON(res, controller.registerAsset(user, body), 201);
      }
      
      if (pathname === '/api/assets/bulk-import' && method === 'POST') {
        const body = await parseBody(req);
        return sendJSON(res, await controller.bulkRegisterAssets(user, body));
      }
      
      const assetMatch = pathname.match(/^\/api\/assets\/([A-Za-z0-9\-]+)$/);
      if (assetMatch && method === 'GET') {
        const assetId = assetMatch[1];
        return sendJSON(res, controller.getAsset(assetId));
      }
      if (assetMatch && method === 'PUT') {
        const assetId = assetMatch[1];
        const body = await parseBody(req);
        return sendJSON(res, controller.updateAsset(user, assetId, body));
      }

      // 3. Assignments (Managers)
      if (pathname === '/api/assignments' && method === 'GET') {
        return sendJSON(res, controller.listAssignments(user));
      }
      if (pathname === '/api/assignments' && method === 'POST') {
        const body = await parseBody(req);
        return sendJSON(res, controller.assignAsset(user, body));
      }
      const assignExtendMatch = pathname.match(/^\/api\/assignments\/(\d+)\/extend$/);
      if (assignExtendMatch && method === 'PUT') {
        const assignId = assignExtendMatch[1];
        const body = await parseBody(req);
        return sendJSON(res, controller.extendContract(user, assignId, body));
      }
      
      const assignReturnMatch = pathname.match(/^\/api\/assignments\/(\d+)\/return$/);
      if (assignReturnMatch && method === 'PUT') {
        const assignId = assignReturnMatch[1];
        const body = await parseBody(req);
        return sendJSON(res, controller.returnAsset(user, assignId, body));
      }

      const assignConfirmMatch = pathname.match(/^\/api\/assignments\/(\d+)\/confirm$/);
      if (assignConfirmMatch && method === 'PUT') {
        const assignId = assignConfirmMatch[1];
        return sendJSON(res, controller.confirmReceipt(user, assignId));
      }

      // 4. Transfers (Managers)
      if (pathname === '/api/transfers' && method === 'GET') {
        return sendJSON(res, controller.listTransfers(user));
      }
      if (pathname === '/api/transfers' && method === 'POST') {
        const body = await parseBody(req);
        return sendJSON(res, controller.transferAsset(user, body));
      }

      // 5. Maintenance (Managers)
      if (pathname === '/api/maintenance' && method === 'GET') {
        return sendJSON(res, controller.listMaintenance(user));
      }
      if (pathname === '/api/maintenance' && method === 'POST') {
        const body = await parseBody(req);
        return sendJSON(res, controller.recordMaintenance(user, body));
      }
      
      const maintCompleteMatch = pathname.match(/^\/api\/maintenance\/(\d+)\/complete$/);
      if (maintCompleteMatch && method === 'PUT') {
        const maintId = maintCompleteMatch[1];
        const body = await parseBody(req);
        return sendJSON(res, controller.completeMaintenance(user, maintId, body));
      }

      // 6. Disposals (Managers)
      if (pathname === '/api/disposals' && method === 'POST') {
        const body = await parseBody(req);
        return sendJSON(res, controller.disposeAsset(user, body));
      }

      // 7. Requests (Employees submit, Managers action)
      if (pathname === '/api/requests' && method === 'GET') {
        return sendJSON(res, controller.listRequests(user));
      }
      if (pathname === '/api/requests' && method === 'POST') {
        const body = await parseBody(req);
        return sendJSON(res, controller.createRequest(user, body), 201);
      }
      
      const requestActionMatch = pathname.match(/^\/api\/requests\/(\d+)\/action$/);
      if (requestActionMatch && method === 'PUT') {
        const requestId = requestActionMatch[1];
        const body = await parseBody(req);
        return sendJSON(res, controller.actionRequest(user, requestId, body));
      }

      const requestRevokeMatch = pathname.match(/^\/api\/requests\/(\d+)\/revoke$/);
      if (requestRevokeMatch && method === 'PUT') {
        const requestId = requestRevokeMatch[1];
        const body = await parseBody(req);
        return sendJSON(res, controller.revokeRequest(user, requestId, body));
      }

      const requestFollowUpMatch = pathname.match(/^\/api\/requests\/(\d+)\/followup$/);
      if (requestFollowUpMatch && method === 'PUT') {
        const requestId = requestFollowUpMatch[1];
        const body = await parseBody(req);
        return sendJSON(res, controller.updateRequestFollowUp(user, requestId, body));
      }

      // 8. Reports & Dashboards
      if (pathname === '/api/reports/dashboard' && method === 'GET') {
        return sendJSON(res, controller.getDashboardMetrics(), 200, {
          'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0',
          'Surrogate-Control': 'no-store'
        });
      }
      if (pathname === '/api/reports/register' && method === 'GET') {
        // Employees are not permitted to access the asset register
        if (user.role === 'Employee') {
          return sendError(res, 'Access denied. Employees are not authorised to view the asset register.', 403);
        }
        // Parse filters
        const filters = {
          status: parsedUrl.query.status,
          type: parsedUrl.query.type,
          department: parsedUrl.query.department,
          assignedTo: parsedUrl.query.assignedTo
        };
        return sendJSON(res, controller.generateAssetRegister(filters));
      }
      
      const historyMatch = pathname.match(/^\/api\/reports\/history\/([A-Za-z0-9\-]+)$/);
      if (historyMatch && method === 'GET') {
        const assetId = historyMatch[1];
        return sendJSON(res, controller.getAssetHistory(assetId));
      }
      
      if (pathname === '/api/reports/audits' && method === 'GET') {
        return sendJSON(res, controller.getAuditLogs(user));
      }

      if (pathname === '/api/reports/pdf/asset-register' && method === 'GET') {
        const filters = {
          status: parsedUrl.query.status,
          type: parsedUrl.query.type,
          department: parsedUrl.query.department,
          assignedTo: parsedUrl.query.assignedTo
        };
        const pdfBuffer = await controller.generateAssetRegisterPdf(user, filters);
        res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="asset_register.pdf"' });
        return res.end(pdfBuffer);
      }

      // If we got here, route wasn't found
      return sendError(res, 'Endpoint not found', 404);

    } catch (error) {
      console.error('API Error:', error);
      const status = classifyError(error);
      const message = status === 500 ? 'An unexpected error occurred. Please try again.' : (error.message || 'Request failed');
      return sendError(res, message, status);
    }
  }

  // --- STATIC FILE SERVING ---
  
  // Safe path construction (prevents directory traversal)
  let safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
  if (safePath === '/' || safePath === '\\') {
    safePath = '/index.html';
  }
  
  const filePath = path.join(PUBLIC_DIR, safePath);
  
  // Check that the file resides within the public directory
  if (!filePath.startsWith(PUBLIC_DIR)) {
    applySecurityHeaders(res);
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    return res.end('Access Denied');
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      // Serve index.html for SPA client-side routing fallback if file not found
      const indexFallback = path.join(PUBLIC_DIR, 'index.html');
      fs.readFile(indexFallback, (fallbackErr, content) => {
        if (fallbackErr) {
          applySecurityHeaders(res);
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Page Not Found');
        } else {
          applySecurityHeaders(res);
          res.writeHead(200, {
            'Content-Type': 'text/html',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0'
          });
          res.end(content);
        }
      });
      return;
    }

    // Read and serve file
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    // App code (HTML/JS/CSS) must always be revalidated so a deployed fix is
    // picked up on next load instead of silently being served from a stale
    // browser cache (with no cache headers at all, browsers fall back to
    // their own heuristics, which can hold on to old app.js for a long time).
    // Images/fonts are fine to cache since their filenames/content don't change.
    const noCacheExts = ['.html', '.js', '.css'];

    fs.readFile(filePath, (readErr, content) => {
      if (readErr) {
        applySecurityHeaders(res);
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Server Error');
      } else {
        const headers = { 'Content-Type': contentType };
        if (noCacheExts.includes(ext)) {
          headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
          headers['Pragma'] = 'no-cache';
          headers['Expires'] = '0';
        }
        applySecurityHeaders(res);
        res.writeHead(200, headers);
        res.end(content);
      }
    });
  });
});

function startServer() {
  // Wait for the default admin/manager/employee accounts to be seeded before
  // accepting connections so logins can never race the initial seed.
  dbReady.then(() => {
    if (SSL_KEY_PATH && SSL_CERT_PATH && fs.existsSync(SSL_KEY_PATH) && fs.existsSync(SSL_CERT_PATH)) {
      const sslOptions = {
        key: fs.readFileSync(SSL_KEY_PATH),
        cert: fs.readFileSync(SSL_CERT_PATH)
      };
      https.createServer(sslOptions, server).listen(PORT, HOST, () => {
        console.log(`URSB Asset Management System running at https://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT} (SSL)`);
      });
    } else {
      server.listen(PORT, HOST, () => {
        console.log(`URSB Asset Management System running at http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
        if (NODE_ENV === 'production' && !SSL_KEY_PATH) {
          console.warn('WARNING: Running in production without SSL. Set SSL_KEY_PATH and SSL_CERT_PATH.');
        }
        if (NODE_ENV === 'production') {
          console.warn('WARNING: Change the default admin/manager/employee passwords before going live.');
        }
      });
    }
  });
}

if (require.main === module) {
  startServer();
}

module.exports = { server, startServer };
