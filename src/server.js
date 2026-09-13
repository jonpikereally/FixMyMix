// A plain Node HTTP server for a laptop on the show Wi-Fi. `npm start` runs it
// from the terminal; the menu-bar app in desktop/ calls start() directly.

import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './state.js';
import { createApi, errorResponse, ApiError } from './api.js';
import { createAuth, parseCookies, randomSecret } from './auth.js';
import { loadTls } from './tls.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
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
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
};

// Strict-Transport-Security is deliberately absent: LAN mode is plain HTTP and
// browsers ignore the header there. The hosted Worker (src/index.js) sets it.
export const SECURITY_HEADERS = {
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

const PAGES = { '/': 'index.html', '/stage': 'stage.html', '/admin': 'admin.html', '/join': 'join.html' };

// ---------------------------------------------------------------------------
// Persistence

function readJson(file, fallback, log) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') log(`Ignoring unreadable ${path.basename(file)}: ${error.message}`);
    return fallback;
  }
}

// The passcode is a fixed default: this runs on a private stage Wi-Fi and the
// point of the lock is to stop a performer wandering into the board by
// accident, not to resist an attacker. ADMIN_PASSCODE overrides it.
export const DEFAULT_PASSCODE = '1234';

function loadConfig(dataDir, passcodeOverride, log) {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, 'config.json');
  const stored = readJson(file, {}, log);
  const config = {
    secret: typeof stored.secret === 'string' && stored.secret.length >= 32 ? stored.secret : randomSecret(),
    passcode: /^\d{4,12}$/.test(String(passcodeOverride ?? '')) ? String(passcodeOverride) : DEFAULT_PASSCODE,
  };
  if (config.secret !== stored.secret) {
    fs.writeFileSync(file, JSON.stringify({ secret: config.secret }, null, 2), { mode: 0o600 });
  }
  return config;
}

function createPersister(store, dataDir, log) {
  const file = path.join(dataDir, 'state.json');
  let timer = null;
  let writing = Promise.resolve();
  const flush = () => {
    clearTimeout(timer);
    timer = null;
    const snapshot = store.snapshot();
    writing = writing
      .then(() => fsp.writeFile(`${file}.tmp`, JSON.stringify(snapshot)))
      .then(() => fsp.rename(`${file}.tmp`, file))
      .catch((error) => log(`Could not save state: ${error.message}`));
    return writing;
  };
  const unsubscribe = store.subscribe(() => {
    if (!timer) timer = setTimeout(flush, 250);
  });
  return { flush, stop: () => { unsubscribe(); clearTimeout(timer); } };
}

// ---------------------------------------------------------------------------
// HTTP plumbing

function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, ...headers });
  res.end(body);
}

function sendJson(res, { status, json, headers = {} }) {
  send(res, status, JSON.stringify(json), { 'Content-Type': CONTENT_TYPES['.json'], ...headers });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new ApiError(413, 'Request body too large.'));
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
        reject(new ApiError(400, 'Body must be JSON.'));
      }
    });
    req.on('error', reject);
  });
}

async function serveStatic(res, urlPath) {
  const relative = PAGES[urlPath] ?? urlPath.replace(/^\/+/, '');
  const file = path.resolve(PUBLIC_DIR, relative);
  if (!file.startsWith(PUBLIC_DIR + path.sep)) throw new ApiError(404, 'Not found.');
  let data;
  try {
    data = await fsp.readFile(file);
  } catch {
    throw new ApiError(404, 'Not found.');
  }
  send(res, 200, data, { 'Content-Type': CONTENT_TYPES[path.extname(file)] ?? 'application/octet-stream' });
}

function attachStream(hub, req, res) {
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    'Content-Type': 'text/event-stream; charset=utf-8',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const detach = hub.attach((chunk) => res.write(chunk));
  req.on('close', detach);
}

function createRequestListener({ api, log, info }) {
  return async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname === '/api/info') return sendJson(res, { status: 200, json: { mode: 'lan', ...info() } });
      if (url.pathname.startsWith('/api/')) {
        const result = await api.handle({
          method: req.method,
          path: url.pathname.slice('/api'.length),
          cookies: parseCookies(req.headers.cookie),
          ip: req.socket.remoteAddress ?? 'unknown',
          json: () => readBody(req),
        });
        if (result.sse) return attachStream(api.hub, req, res);
        return sendJson(res, result);
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new ApiError(405, 'Method not allowed.');
      await serveStatic(res, url.pathname);
    } catch (error) {
      sendJson(res, errorResponse(error, log));
    }
  };
}

export function lanAddresses() {
  const addresses = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) addresses.push(entry.address);
    }
  }
  return addresses;
}

// ---------------------------------------------------------------------------
// Startup

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
}

// Other stage tools (AbleSet, mixer remotes) like port 8080 too. Rather than
// refuse to start, walk up to the next free port; every address the app shows
// carries the real port, so nothing else needs to know.
async function listenNearby(server, port, host, log) {
  for (let candidate = port; candidate < port + 10; candidate++) {
    try {
      await listen(server, candidate, host);
      if (candidate !== port) log(`Port ${port} is in use; using ${candidate} instead.`);
      return candidate;
    } catch (error) {
      if (error.code !== 'EADDRINUSE' || candidate === port + 9) throw error;
      server.removeAllListeners('error');
    }
  }
  throw new Error('unreachable');
}

/**
 * Starts the LAN server. Resolves once it is listening. If data/key.pem and
 * data/cert.pem exist (see `npm run cert`) an https listener is started too.
 * @returns {Promise<{ port: number, httpsPort: number|null, urls: string[], httpsUrls: string[], passcode: string, dataDir: string, close: () => Promise<void> }>}
 */
export async function start({
  port = Number(process.env.PORT) || 8080,
  httpsPort = Number(process.env.HTTPS_PORT) || 8443,
  host = process.env.HOST || '0.0.0.0',
  dataDir = process.env.FIXMYMIX_DATA_DIR || path.join(ROOT, 'data'),
  passcode = process.env.ADMIN_PASSCODE,
  log = console.log,
} = {}) {
  const config = loadConfig(dataDir, passcode, log);
  const store = new Store(readJson(path.join(dataDir, 'state.json'), {}, log));
  if (!store.members.length) store.quickSetup(4, 4);
  const persister = createPersister(store, dataDir, log);
  const api = createApi({ store, auth: createAuth(config) });
  // Filled in once the ports are known; /api/info reports them so the join
  // page can draw a QR code of the address performers should open.
  let addresses = () => ({ urls: [], httpsUrls: [] });
  const listener = createRequestListener({ api, log, info: () => addresses() });
  const server = http.createServer(listener);
  await listenNearby(server, port, host, log);

  const tls = loadTls(dataDir);
  let secure = null;
  if (tls) {
    secure = https.createServer(tls, listener);
    try {
      await listen(secure, httpsPort, host);
    } catch (error) {
      log(`Not serving https: ${error.message}`);
      secure = null;
    }
  }

  const actualPort = server.address().port;
  const actualHttpsPort = secure?.address().port ?? null;
  const hosts = () => {
    const ips = lanAddresses();
    return ips.length ? ips : ['localhost'];
  };

  const urls = () => hosts().map((ip) => `http://${ip}:${actualPort}`);
  const httpsUrls = () => (actualHttpsPort ? hosts().map((ip) => `https://${ip}:${actualHttpsPort}`) : []);
  addresses = () => ({ urls: urls(), httpsUrls: httpsUrls() });

  return {
    port: actualPort,
    httpsPort: actualHttpsPort,
    passcode: config.passcode,
    dataDir,
    get urls() {
      return urls();
    },
    get httpsUrls() {
      return httpsUrls();
    },
    async close() {
      api.hub.close();
      persister.stop();
      await Promise.all([server, secure].filter(Boolean).map((s) => new Promise((resolve) => s.close(resolve))));
      await persister.flush();
    },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const running = await start();
  console.log('');
  console.log('  FixMyMix is running.');
  console.log('');
  console.log('  Performers open one of these on the same Wi-Fi:');
  for (const url of running.urls) console.log(`    ${url}`);
  console.log(`  QR code for them to scan: http://localhost:${running.port}/join`);
  if (running.httpsUrls.length) {
    console.log('');
    console.log('  For MIDI controllers on other devices (accept the certificate once):');
    for (const url of running.httpsUrls) console.log(`    ${url}`);
  } else {
    console.log('');
    console.log('  MIDI controllers on other devices need https: run `npm run cert` and restart.');
  }
  console.log('');
  console.log(`  Admin passcode: ${running.passcode}`);
  console.log('  (Set ADMIN_PASSCODE to choose your own.)');
  console.log('');
  const shutdown = () => running.close().finally(() => process.exit(0));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
