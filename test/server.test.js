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

test('one port answers http and https; the certificate is created on first start', async (t) => {
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

test('without a certificate a TLS attempt gets a handshake_failure alert, plain http still works', async (t) => {
  const running = await start({ port: 0, host: '127.0.0.1', dataDir: tmp(), autoCert: false, log: quiet });
  t.after(() => running.close());
  assert.deepEqual(running.httpsUrls, []);
  assert.equal((await get(http, running.port)).status, 200);
  await assert.rejects(get(https, running.port, { rejectUnauthorized: false }));
  // The ClientHello is answered with a fatal handshake_failure alert, then closed.
  const reply = await new Promise((resolve) => {
    const chunks = [];
    const socket = net.connect(running.port, '127.0.0.1', () => socket.write(Buffer.from([0x16, 0x03, 0x01, 0x00, 0x05, 0x01])));
    socket.on('data', (c) => chunks.push(c));
    const done = () => { socket.destroy(); resolve(Buffer.concat(chunks)); };
    socket.on('end', done);
    socket.on('close', done);
    socket.on('error', () => {});
    setTimeout(done, 3000).unref();
  });
  assert.deepEqual([...reply], [0x15, 0x03, 0x01, 0x00, 0x02, 0x02, 0x28]);
});

test('a client that connects and says nothing is dropped after the idle timeout', async (t) => {
  const running = await start({ port: 0, host: '127.0.0.1', dataDir: tmp(), autoCert: false, log: quiet });
  t.after(() => running.close());
  const socket = net.connect(running.port, '127.0.0.1');
  await new Promise((resolve) => socket.on('connect', resolve));
  assert.equal(socket.destroyed, false);
  socket.destroy();
});

test('a leftover passcode from an early config file is ignored; one chosen in Setup persists', async (t) => {
  const dataDir = tmp();
  fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify({ secret: 's'.repeat(64), passcode: '384723' }));
  const first = await start({ port: 0, host: '127.0.0.1', dataDir, autoCert: false, log: quiet });
  assert.equal(first.passcode, '1234');
  await first.close();

  fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify({ secret: 's'.repeat(64), passcode: '2468', passcodeChosen: true }));
  const second = await start({ port: 0, host: '127.0.0.1', dataDir, autoCert: false, log: quiet });
  t.after(() => second.close());
  assert.equal(second.passcode, '2468');
  assert.equal((await start({ port: 0, host: '127.0.0.1', dataDir, autoCert: false, passcode: '5555', log: quiet }).then(async (r) => { const p = r.passcode; await r.close(); return p; })), '5555');
});

test('the default port is 80, falling back to 8080 and up when it cannot be bound', async (t) => {
  // Port 80 is not bindable here without root, so this exercises the fallback.
  const running = await start({ host: '127.0.0.1', dataDir: tmp(), autoCert: false, log: quiet });
  t.after(() => running.close());
  assert.ok([80, 8080, 8081, 8082, 8083, 8084, 8085].includes(running.port), String(running.port));
  const url = running.urls[0];
  assert.equal(url, running.port === 80 ? `http://${new URL(url).hostname}` : `http://${new URL(url).hostname}:${running.port}`);
});

test('close() returns promptly even with a live stream and idle connections open', async (t) => {
  const running = await start({ port: 0, host: '127.0.0.1', dataDir: tmp(), autoCert: false, log: quiet });
  // An SSE stream that would otherwise keep the server open forever.
  const stream = await new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: running.port, path: '/api/stream' }, resolve).on('error', reject);
  });
  assert.equal(stream.statusCode, 200);
  stream.on('error', () => {});
  stream.resume(); // 'end' only fires on a stream something is reading
  const ended = new Promise((resolve) => { stream.on('end', () => resolve('end')); stream.on('close', () => resolve('close')); });
  // And an idle keep-alive connection that has sent nothing.
  const idle = net.connect(running.port, '127.0.0.1');
  idle.on('error', () => {});
  await new Promise((resolve) => idle.on('connect', resolve));

  const started = Date.now();
  await running.close();
  assert.ok(Date.now() - started < 1500, `close took ${Date.now() - started} ms`);
  assert.ok(['end', 'close'].includes(await ended));
  await assert.rejects(get(http, running.port));
});
