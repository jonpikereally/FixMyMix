// A plain Node HTTP server for a laptop on the show Wi-Fi. `npm start` runs it
// from the terminal; the menu-bar app in desktop/ calls start() directly.

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './state.js';
import { createApi, errorResponse, ApiError } from './api.js';
import { createAuth, parseCookies, randomPasscode, randomSecret } from './auth.js';

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

const PAGES = { '/': 'index.html', '/stage': 'stage.html', '/admin': 'admin.html' };

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

function loadConfig(dataDir, passcodeOverride, log) {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, 'config.json');
  const stored = readJson(file, {}, log);
  const config = {
    secret: typeof stored.secret === 'string' && stored.secret.length >= 32 ? stored.secret : randomSecret(),
    passcode: /^\d{4,12}$/.test(String(stored.passcode ?? '')) ? String(stored.passcode) : randomPasscode(),
  };
  if (passcodeOverride) config.passcode = String(passcodeOverride);
  if (config.secret !== stored.secret || config.passcode !== stored.passcode) {
    fs.writeFileSync(file, JSON.stringify(config, null, 2), { mode: 0o600 });
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

function createRequestListener({ api, log }) {
  return async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname === '/api/info') return sendJson(res, { status: 200, json: { mode: 'lan' } });
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

/**
 * Starts the LAN server. Resolves once it is listening.
 * @returns {Promise<{ port: number, urls: string[], passcode: string, close: () => Promise<void> }>}
 */
export async function start({
  port = Number(process.env.PORT) || 8080,
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
  const server = http.createServer(createRequestListener({ api, log }));

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });

  const actualPort = server.address().port;
  const urls = () => {
    const ips = lanAddresses();
    return (ips.length ? ips : ['localhost']).map((ip) => `http://${ip}:${actualPort}`);
  };

  return {
    port: actualPort,
    passcode: config.passcode,
    get urls() {
      return urls();
    },
    async close() {
      api.hub.close();
      persister.stop();
      await new Promise((resolve) => server.close(resolve));
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
  console.log('');
  console.log(`  Admin passcode: ${running.passcode}`);
  console.log('  (Set ADMIN_PASSCODE to choose your own.)');
  console.log('');
  const shutdown = () => running.close().finally(() => process.exit(0));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
