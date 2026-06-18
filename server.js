const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const controller = require('./controller');

const PORT = 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

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

// Helper: send JSON response
function sendJSON(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

// Helper: send Error response
function sendError(res, message, status = 400) {
  sendJSON(res, { error: message }, status);
}

// Helper: parse request body
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
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
        const body = await parseBody(req);
        const result = controller.login(body.username, body.password);
        
        // Set cookie
        res.setHeader('Set-Cookie', `session=${result.sessionId}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400`);
        return sendJSON(res, result);
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
        res.setHeader('Set-Cookie', `session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
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

      // 1. Users CRUD (Admin)
      if (pathname === '/api/users' && method === 'GET') {
        return sendJSON(res, controller.listUsers(user));
      }
      if (pathname === '/api/users' && method === 'POST') {
        const body = await parseBody(req);
        return sendJSON(res, controller.createUser(user, body), 201);
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
        return sendJSON(res, controller.changePassword(user, userId, body));
      }

      // 2. Assets (All authenticated roles can read, Managers register)
      if (pathname === '/api/assets' && method === 'GET') {
        return sendJSON(res, controller.listAssets());
      }
      if (pathname === '/api/assets' && method === 'POST') {
        const body = await parseBody(req);
        return sendJSON(res, controller.registerAsset(user, body), 201);
      }
      
      const assetMatch = pathname.match(/^\/api\/assets\/([A-Za-z0-9\-]+)$/);
      if (assetMatch && method === 'GET') {
        const assetId = assetMatch[1];
        return sendJSON(res, controller.getAsset(assetId));
      }

      // 3. Assignments (Managers)
      if (pathname === '/api/assignments' && method === 'GET') {
        return sendJSON(res, controller.listAssignments());
      }
      if (pathname === '/api/assignments' && method === 'POST') {
        const body = await parseBody(req);
        return sendJSON(res, controller.assignAsset(user, body));
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
      if (pathname === '/api/transfers' && method === 'POST') {
        const body = await parseBody(req);
        return sendJSON(res, controller.transferAsset(user, body));
      }

      // 5. Maintenance (Managers)
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

      // 8. Reports & Dashboards
      if (pathname === '/api/reports/dashboard' && method === 'GET') {
        return sendJSON(res, controller.getDashboardMetrics());
      }
      if (pathname === '/api/reports/register' && method === 'GET') {
        // Parse filters
        const filters = {
          status: parsedUrl.query.status,
          type: parsedUrl.query.type,
          department: parsedUrl.query.department,
          custodian: parsedUrl.query.custodian
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

      // If we got here, route wasn't found
      return sendError(res, 'Endpoint not found', 404);

    } catch (error) {
      console.error('API Error:', error);
      return sendError(res, error.message, 500);
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
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    return res.end('Access Denied');
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      // Serve index.html for SPA client-side routing fallback if file not found
      const indexFallback = path.join(PUBLIC_DIR, 'index.html');
      fs.readFile(indexFallback, (fallbackErr, content) => {
        if (fallbackErr) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Page Not Found');
        } else {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(content);
        }
      });
      return;
    }

    // Read and serve file
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    
    fs.readFile(filePath, (readErr, content) => {
      if (readErr) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Server Error');
      } else {
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content);
      }
    });
  });
});

server.listen(PORT, () => {
  console.log(`URSB Asset Management System server running at http://localhost:${PORT}`);
});
