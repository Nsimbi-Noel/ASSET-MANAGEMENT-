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
const C = require('./constants');

// Bootstrap credentials come from the environment (see .env.example), so the
// tests must read the same values rather than assume development defaults.
const ADMIN_PASSWORD = process.env.BOOTSTRAP_ADMIN_PASSWORD || 'admin123';

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
  const login = await httpRequest(port, 'POST', '/api/auth/login', { body: { username: 'admin', password: ADMIN_PASSWORD } });
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

  // 6. /api/config publishes the shared enums and needs no authentication, so
  // the client can build every dropdown from one source of truth.
  const config = await httpRequest(port, 'GET', '/api/config');
  assert.strictEqual(config.status, 200, '/api/config should be publicly readable');
  assert.deepStrictEqual(config.json.roles, C.ROLE_VALUES, 'roles should match constants.js');
  assert.deepStrictEqual(config.json.assetStatuses, C.ASSET_STATUS_VALUES, 'assetStatuses should match constants.js');
  assert.deepStrictEqual(config.json.assetSources, C.ASSET_SOURCE_VALUES, 'assetSources should match constants.js');
  assert.deepStrictEqual(config.json.assetConditions, C.ASSET_CONDITION_VALUES, 'assetConditions should match constants.js');
  assert.deepStrictEqual(config.json.disposalMethods, C.DISPOSAL_METHODS, 'disposalMethods should match constants.js');
  assert.deepStrictEqual(config.json.receivedStatuses, C.RECEIVED_STATUS_VALUES, 'receivedStatuses should match constants.js');
  assert.strictEqual(config.json.currency, C.CURRENCY, 'currency should match constants.js');
  assert.strictEqual(config.json.passwordMinLength, C.PASSWORD_MIN_LENGTH, 'passwordMinLength should match constants.js');
  // Every published source must be one the API will actually accept.
  assert.ok(config.json.assetSources.includes(C.ASSET_SOURCE.LEASE), 'Lease must be published (it used to be unreachable in the UI)');
  console.log(`${green}✓ /api/config publishes enums matching constants.js${reset}`);

  // 7. The login page must not hardcode option lists any more; each enum
  // select is marked with data-enum and hydrated from /api/config.
  for (const sel of ['reg-category', 'reg-condition', 'reg-source', 'reg-status',
                     'edit-category', 'edit-condition', 'edit-source', 'edit-status',
                     'disp-method', 'followup-received-status', 'usr-role', 'usr-status']) {
    const re = new RegExp(`<select id="${sel}"[^>]*data-enum="[^"]+"[^>]*>\\s*</select>`);
    assert.ok(re.test(page), `${sel} should be an empty select carrying data-enum`);
  }
  console.log(`${green}✓ Login page selects are config-driven, not duplicated HTML${reset}`);

  // 8. Logout slides images are actually served with the right content type.
  for (const slide of ['01-circuit', '02-server-room', '03-engineer', '05-storage']) {
    const img = await new Promise((resolve, reject) => {
      require('http').request({ host: '127.0.0.1', port, method: 'GET', path: `/slides/${slide}.jpg` }, res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'], buf: Buffer.concat(chunks) }));
      }).on('error', reject).end();
    });
    assert.strictEqual(img.status, 200, `${slide}.jpg should be served`);
    assert.strictEqual(img.type, 'image/jpeg', `${slide}.jpg should be image/jpeg`);
    assert.strictEqual(img.buf[0], 0xff, `${slide}.jpg should start with a JPEG SOI marker`);
    assert.strictEqual(img.buf[1], 0xd8, `${slide}.jpg should start with a JPEG SOI marker`);
  }
  console.log(`${green}✓ All login slideshow images are served as valid JPEGs${reset}`);

  // 9. No production password may be committed to source. The bootstrap and
  // seed passwords must come from the environment.
  const dbSrc = require('fs').readFileSync(path.join(__dirname, 'db.js'), 'utf8');
  const seedSrc = require('fs').readFileSync(path.join(__dirname, 'seed.js'), 'utf8');
  assert.ok(!/hashPassword\('[^']+'\)/.test(dbSrc), 'db.js must not hardcode a password passed to hashPassword');
  assert.ok(!/hashPassword\('[^']+'\)/.test(seedSrc), 'seed.js must not hardcode a password passed to hashPassword');
  assert.ok(/NODE_ENV\s*===\s*'production'/.test(dbSrc), 'db.js must require bootstrap passwords in production');
  console.log(`${green}✓ No bootstrap or seed password is hardcoded in source${reset}`);

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
