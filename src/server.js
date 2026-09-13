import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { Store, StoreError, MAX_MEMBERS, MAX_CHANNELS } from './state.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = process.env.FIXMYMIX_DATA_DIR || path.join(ROOT, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '0.0.0.0';

const ADMIN_COOKIE = 'fmm_admin';
const ADMIN_SESSION_SECONDS = 60 * 60 * 24 * 7;
const HEARTBEAT_MS = 15_000;
const MAX_BODY_BYTES = 64 * 1024;

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

// HSTS is deliberately absent: the app is served over plain HTTP on a LAN and
// browsers ignore the header there anyway.
const SECURITY_HEADERS = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "manifest-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
  ].join('; '),
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'Cache-Control': 'no-store',
};

const PAGES = {
  '/': 'index.html',
  '/stage': 'stage.html',
  '/admin': 'admin.html',
};

// ---------------------------------------------------------------------------
// Persistence

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn(`Ignoring unreadable ${path.basename(file)}: ${error.message}`);
    return fallback;
  }
}

function loadConfig() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const stored = readJson(CONFIG_FILE, {});
  const config = {
    secret: typeof stored.secret === 'string' && stored.secret.length >= 32 ? stored.secret : randomBytes(32).toString('hex'),
    passcode: /^\d{4,12}$/.test(String(stored.passcode ?? '')) ? String(stored.passcode) : String(randomInt(100000, 999999)),
  };
  if (process.env.ADMIN_PASSCODE) config.passcode = String(process.env.ADMIN_PASSCODE);
  if (config.secret !== stored.secret || config.passcode !== stored.passcode) {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), { mode: 0o600 });
  }
  return config;
}

function createPersister(store) {
  let timer = null;
  let writing = Promise.resolve();
  const flush = () => {
    timer = null;
    const snapshot = store.snapshot();
    writing = writing
      .then(() => fsp.writeFile(`${STATE_FILE}.tmp`, JSON.stringify(snapshot)))
      .then(() => fsp.rename(`${STATE_FILE}.tmp`, STATE_FILE))
      .catch((error) => console.error(`Could not save state: ${error.message}`));
    return writing;
  };
  store.subscribe(() => {
    if (!timer) timer = setTimeout(flush, 250);
  });
  return { flush };
}

// ---------------------------------------------------------------------------
// Admin auth

function adminToken(secret) {
  return createHmac('sha256', secret).update('fixmymix-admin').digest('base64url');
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) {
    // Compare against ourselves so a length mismatch still takes a full compare.
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}

function parseCookies(header) {
  const cookies = {};
  for (const part of String(header ?? '').split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    cookies[part.slice(0, index).trim()] = part.slice(index + 1).trim();
  }
  return cookies;
}

function isAdmin(req, config) {
  const cookie = parseCookies(req.headers.cookie)[ADMIN_COOKIE];
  return Boolean(cookie) && safeEqual(cookie, adminToken(config.secret));
}

// ---------------------------------------------------------------------------
// HTTP helpers

class HttpError extends Error {
  constructor(status, message, code = 'error') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, ...headers });
  res.end(body);
}

function sendJson(res, status, payload, headers = {}) {
  send(res, status, JSON.stringify(payload), { 'Content-Type': CONTENT_TYPES['.json'], ...headers });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new HttpError(413, 'Request body too large.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        resolve(parsed && typeof parsed === 'object' ? parsed : {});
      } catch {
        reject(new HttpError(400, 'Body must be JSON.'));
      }
    });
    req.on('error', reject);
  });
}

async function serveStatic(res, urlPath) {
  const relative = PAGES[urlPath] ?? urlPath.replace(/^\/+/, '');
  const file = path.resolve(PUBLIC_DIR, relative);
  if (!file.startsWith(PUBLIC_DIR + path.sep)) throw new HttpError(404, 'Not found.');
  let data;
  try {
    data = await fsp.readFile(file);
  } catch {
    throw new HttpError(404, 'Not found.');
  }
  const type = CONTENT_TYPES[path.extname(file)] ?? 'application/octet-stream';
  send(res, 200, data, { 'Content-Type': type });
}

// ---------------------------------------------------------------------------
// Live updates (Server-Sent Events)

function createHub(store) {
  const clients = new Set();

  store.subscribe((snapshot) => {
    const frame = `event: state\ndata: ${JSON.stringify(snapshot)}\n\n`;
    for (const client of clients) client.write(frame);
  });

  const heartbeat = setInterval(() => {
    for (const client of clients) client.write(': ping\n\n');
  }, HEARTBEAT_MS);
  heartbeat.unref();

  return {
    size: () => clients.size,
    attach(req, res) {
      res.writeHead(200, {
        ...SECURITY_HEADERS,
        'Content-Type': 'text/event-stream; charset=utf-8',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.write('retry: 2000\n\n');
      res.write(`event: state\ndata: ${JSON.stringify(store.snapshot())}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
    },
  };
}

// ---------------------------------------------------------------------------
// Throttle: a performer mashing buttons should not flood the board.

function createThrottle(limit, windowMs) {
  const hits = new Map();
  return (key) => {
    const now = Date.now();
    const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (recent.length >= limit) return false;
    recent.push(now);
    hits.set(key, recent);
    return true;
  };
}

// ---------------------------------------------------------------------------
// Routing

function createApp({ store, config, hub }) {
  const throttle = createThrottle(12, 3000);
  const loginThrottle = createThrottle(8, 60_000);

  const requireAdmin = (req) => {
    if (!isAdmin(req, config)) throw new HttpError(401, 'Admin passcode required.', 'unauthorized');
  };

  const routes = {
    'GET /api/state': (req, res) => sendJson(res, 200, store.snapshot()),
    'GET /api/stream': (req, res) => hub.attach(req, res),
    'GET /api/admin/session': (req, res) => sendJson(res, 200, { admin: isAdmin(req, config) }),

    'POST /api/admin/login': async (req, res) => {
      const ip = req.socket.remoteAddress ?? 'unknown';
      if (!loginThrottle(ip)) throw new HttpError(429, 'Too many attempts. Wait a minute.', 'throttled');
      const { passcode } = await readBody(req);
      if (!safeEqual(passcode, config.passcode)) throw new HttpError(401, 'Wrong passcode.', 'bad_passcode');
      const cookie = `${ADMIN_COOKIE}=${adminToken(config.secret)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${ADMIN_SESSION_SECONDS}`;
      sendJson(res, 200, { admin: true }, { 'Set-Cookie': cookie });
    },

    'POST /api/admin/logout': (req, res) => {
      sendJson(res, 200, { admin: false }, { 'Set-Cookie': `${ADMIN_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0` });
    },

    'POST /api/requests': async (req, res) => {
      const body = await readBody(req);
      if (!throttle(String(body.memberId))) throw new HttpError(429, 'Slow down — the request is already on the board.', 'throttled');
      const request = store.submitRequest({
        memberId: String(body.memberId ?? ''),
        channelId: String(body.channelId ?? ''),
        direction: String(body.direction ?? ''),
      });
      sendJson(res, 200, { request });
    },

    'POST /api/requests/cancel': async (req, res) => {
      const body = await readBody(req);
      const request = store.cancelRequest({
        memberId: String(body.memberId ?? ''),
        requestId: String(body.requestId ?? ''),
      });
      sendJson(res, 200, { request });
    },

    'POST /api/admin/resolve': async (req, res) => {
      requireAdmin(req);
      const body = await readBody(req);
      if (body.all === true) return sendJson(res, 200, { resolved: store.resolveAll() });
      if (body.memberId) return sendJson(res, 200, { resolved: store.resolveMember(String(body.memberId)) });
      if (body.requestId) return sendJson(res, 200, { resolved: [store.resolveRequest(String(body.requestId))] });
      throw new HttpError(400, 'Nothing to resolve.');
    },

    'POST /api/admin/roster': async (req, res) => {
      requireAdmin(req);
      const body = await readBody(req);
      if (Array.isArray(body.members)) {
        if (!body.members.length) throw new HttpError(400, 'Keep at least one performer in the roster.');
        return sendJson(res, 200, store.setRoster(body.members));
      }
      const memberCount = Number(body.memberCount);
      const channelCount = Number(body.channelCount);
      if (!(memberCount >= 1 && memberCount <= MAX_MEMBERS)) throw new HttpError(400, `Members must be 1–${MAX_MEMBERS}.`);
      if (!(channelCount >= 1 && channelCount <= MAX_CHANNELS)) throw new HttpError(400, `Channels must be 1–${MAX_CHANNELS}.`);
      sendJson(res, 200, store.quickSetup(memberCount, channelCount));
    },

    'POST /api/admin/show': async (req, res) => {
      requireAdmin(req);
      const body = await readBody(req);
      sendJson(res, 200, store.setShowName(body.name));
    },

    'POST /api/admin/history/clear': (req, res) => {
      requireAdmin(req);
      sendJson(res, 200, store.clearHistory());
    },
  };

  return async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const key = `${req.method} ${url.pathname}`;
    try {
      const handler = routes[key];
      if (handler) return await handler(req, res, url);
      if (url.pathname.startsWith('/api/')) throw new HttpError(404, 'No such endpoint.');
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed.');
      await serveStatic(res, url.pathname);
    } catch (error) {
      if (error instanceof StoreError) return sendJson(res, 409, { error: error.message, code: error.code });
      if (error instanceof HttpError) return sendJson(res, error.status, { error: error.message, code: error.code });
      console.error(error);
      sendJson(res, 500, { error: 'Something went wrong on the server.', code: 'server_error' });
    }
  };
}

// ---------------------------------------------------------------------------
// Startup

function lanAddresses() {
  const addresses = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) addresses.push(entry.address);
    }
  }
  return addresses;
}

export function start() {
  const config = loadConfig();
  const store = new Store(readJson(STATE_FILE, {}));
  if (!store.members.length) store.quickSetup(4, 4);
  const persister = createPersister(store);
  const hub = createHub(store);
  const server = http.createServer(createApp({ store, config, hub }));

  server.listen(PORT, HOST, () => {
    const urls = lanAddresses().map((ip) => `http://${ip}:${PORT}`);
    console.log('');
    console.log('  FixMyMix is running.');
    console.log('');
    console.log('  Performers open one of these on the same Wi-Fi:');
    for (const url of urls.length ? urls : [`http://localhost:${PORT}`]) console.log(`    ${url}`);
    console.log('');
    console.log(`  Admin passcode: ${config.passcode}`);
    console.log('  (Set ADMIN_PASSCODE to choose your own.)');
    console.log('');
  });

  const shutdown = () => {
    server.close();
    persister.flush().finally(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  start();
}
