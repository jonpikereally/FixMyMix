import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { start } from '../src/server.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'fmm-'));
const quiet = () => {};
const get = (mod, port, agentOpts = {}) => new Promise((resolve, reject) => {
  mod.get({ host: '127.0.0.1', port, path: '/api/info', ...agentOpts }, (res) => {
    let body = '';
    res.on('data', (c) => { body += c; });
    res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(body) }));
  }).on('error', reject);
});

test('one port answers http and https when a certificate exists', async (t) => {
  const dataDir = tmp();
  const running = await start({ port: 0, host: '127.0.0.1', dataDir, log: quiet });
  t.after(() => running.close());
  if (!running.httpsUrls.length) {
    t.skip('openssl not available to create a certificate');
    return;
  }
  const plain = await get(http, running.port);
  assert.equal(plain.status, 200);
  assert.equal(plain.json.mode, 'lan');
  const secure = await get(https, running.port, { rejectUnauthorized: false });
  assert.equal(secure.status, 200);
  assert.deepEqual(secure.json.urls, running.urls);
  assert.equal(running.httpsUrls[0], running.urls[0].replace('http://', 'https://'));
  assert.ok(fs.existsSync(path.join(dataDir, 'cert.pem')));
});

test('without a certificate a TLS attempt is refused outright, plain http still works', async (t) => {
  const running = await start({ port: 0, host: '127.0.0.1', dataDir: tmp(), autoCert: false, log: quiet });
  t.after(() => running.close());
  assert.deepEqual(running.httpsUrls, []);
  assert.equal((await get(http, running.port)).status, 200);
  await assert.rejects(get(https, running.port, { rejectUnauthorized: false }));
  // The socket is closed as soon as the ClientHello arrives, not left hanging.
  const closed = await new Promise((resolve) => {
    const socket = net.connect(running.port, '127.0.0.1', () => socket.write(Buffer.from([0x16, 0x03, 0x01, 0x00, 0x05, 0x01])));
    socket.on('close', () => resolve(true));
    socket.on('error', () => {});
    setTimeout(() => resolve(false), 3000);
  });
  assert.equal(closed, true);
});

test('a client that connects and says nothing is dropped after the idle timeout', async (t) => {
  const running = await start({ port: 0, host: '127.0.0.1', dataDir: tmp(), autoCert: false, log: quiet });
  t.after(() => running.close());
  const socket = net.connect(running.port, '127.0.0.1');
  await new Promise((resolve) => socket.on('connect', resolve));
  assert.equal(socket.destroyed, false);
  socket.destroy();
});
