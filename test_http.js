const assert = require('assert');
const path = require('path');
const fs = require('fs');

// Isolate this test onto its own throwaway database. Must be set before the
// server module (and its ./db dependency) is required so DB_PATH is picked up.
if (!process.env.DB_PATH) {
  const testDbDir = path.join(__dirname, 'data');
  fs.mkdirSync(testDbDir, { recursive: true });
  process.env.DB_PATH = path.join(testDbDir, 'test-http.db');
}

// Start from a clean slate so repeated runs never collide on UNIQUE keys.
['', '-wal', '-shm'].forEach(suffix => {
  try { fs.unlinkSync(process.env.DB_PATH + suffix); } catch (_) { /* ignore */ }
});

process.env.PORT = '0'; // ephemeral port — read back from the listening server

const { server } = require('./server');
const { dbReady } = require('./db');

const green = '\x1b[32m';
const reset = '\x1b[0m';
const red = '\x1b[31m';

function parseCookies(setCookieHeader) {
  const out = {};
  if (!setCookieHeader) return out;
  setCookieHeader.forEach(c => {
    const first = c.split(';')[0];
    const eq = first.indexOf('=');
    if (eq > 0) out[first.slice(0, eq)] = first.slice(eq + 1);
  });
  return out;
}

function httpRequest(port, method, p, { body, cookie } = {}) {
  return new Promise((resolve, reject) => {
    const req = require('http').request(
      { host: '127.0.0.1', port, method, path: p, headers: {} },
      res => {
        let data = '';
        res.on('data', c => (data += c));
        res.on('end', () => {
          let json = null;
          try { json = data ? JSON.parse(data) : {}; } catch (_) { /* not JSON */ }
          resolve({ status: res.statusCode, headers: res.headers, body: JSON.stringify(res.headers, null, 2) ? json : null, json });
        });
      }
    );
    req.on('error', reject);
    if (body) req.setHeader('Content-Type', 'application/json');
    if (cookie) req.setHeader('Cookie', cookie);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function main() {
  await dbReady; // default accounts must be seeded before login can succeed
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = address.port;
  console.log(`HTTP test server listening on 127.0.0.1:${port}\n`);

  // 1. Login returns 200, sets HttpOnly SameSite=Strict cookie, and does NOT
  //    leak the session id in the JSON body (S-8).
  const login = await httpRequest(port, 'POST', '/api/auth/login', { body: { username: 'admin', password: 'admin123' } });
  assert.strictEqual(login.status, 200, 'Login should return 200');
  const cookies = parseCookies(login.headers['set-cookie']);
  assert.ok(cookies.session, 'Login should set a session cookie');
  const sc = login.headers['set-cookie'][0].toLowerCase();
  assert.ok(sc.includes('httponly'), 'Cookie should be HttpOnly');
  assert.ok(sc.includes('samesite=strict'), 'Cookie should be SameSite=Strict');
  assert.ok(!login.json.sessionId, 'Response body must not expose sessionId');
  assert.ok(login.json.user && login.json.user.username === 'admin', 'Response should include the user');
  console.log(`${green}✓ HTTP login sets HttpOnly/SameSite cookie and hides sessionId${reset}`);

  // 2. Authenticated request with the cookie is accepted.
  const assetList = await httpRequest(port, 'GET', '/api/assets', { cookie: `session=${cookies.session}` });
  assert.strictEqual(assetList.status, 200, 'Authenticated /api/assets should return 200');
  assert.ok(Array.isArray(assetList.json), 'Asset list should be an array');
  console.log(`${green}✓ Cookie-authenticated request to /api/assets works${reset}`);

  // 3. Unauthenticated request is rejected with 401.
  const unauth = await httpRequest(port, 'GET', '/api/assets');
  assert.strictEqual(unauth.status, 401, 'Unauthenticated request should be 401');
  console.log(`${green}✓ Unauthenticated API request correctly rejected (401)${reset}`);

  // 4. Security headers are present on API responses (S-3).
  const sec = login.headers;
  assert.strictEqual(sec['x-content-type-options'], 'nosniff', 'X-Content-Type-Options header missing');
  assert.strictEqual(sec['x-frame-options'], 'DENY', 'X-Frame-Options header missing');
  assert.strictEqual(sec['referrer-policy'], 'no-referrer', 'Referrer-Policy header missing');
  console.log(`${green}✓ Security headers present on responses${reset}`);

  // 5. Static login page is served (index.html) and no third-party image URLs remain (F-6).
  const page = await new Promise((resolve, reject) => {
    require('http').request({ host: '127.0.0.1', port, method: 'GET', path: '/' }, res => {
      let d = '';
      res.on('data', c => (d += c));
      res.on('end', () => resolve(d));
    }).on('error', reject).end();
  });
  assert.ok(/Asset Management System/.test(page), 'Index page should be served');
  assert.ok(!/images\.unsplash\.com/.test(page), 'Login carousel should not depend on unsplash.com');
  console.log(`${green}✓ Static index served without external image dependencies${reset}`);

  console.log(`\n${green}=========================================`);
  console.log(`ALL HTTP TESTS PASSED SUCCESSFULLY!`);
  console.log(`=========================================${reset}`);
  server.close();
  process.exit(0);
}

main().catch(err => {
  console.error(`\n${red}=========================================`);
  console.error(`HTTP TEST RUN FAILED!`);
  console.error(`Error details:`, err && err.message);
  console.error(`=========================================${reset}`);
  try { server.close(); } catch (_) {}
  process.exit(1);
});
