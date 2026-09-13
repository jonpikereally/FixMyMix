import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/state.js';
import { createApi, ApiError, createThrottle, createHub } from '../src/api.js';
import { createAuth, constantTimeEqual, adminToken, randomPasscode, parseCookies } from '../src/auth.js';

const PASSCODE = '123456';

function setup() {
  const store = new Store();
  store.quickSetup(2, 2);
  const auth = createAuth({ secret: 'a'.repeat(64), passcode: PASSCODE });
  const api = createApi({ store, auth });
  const call = (method, path, { body = {}, cookies = {}, ip = '10.0.0.1' } = {}) =>
    api.handle({ method, path, cookies, ip, json: async () => body });
  return { store, api, call };
}

async function login(call) {
  const res = await call('POST', '/admin/login', { body: { passcode: PASSCODE } });
  const cookie = parseCookies(res.headers['Set-Cookie'].split(';')[0]);
  return cookie;
}

test('constantTimeEqual compares bytes and never leaks on length', () => {
  assert.equal(constantTimeEqual('abc', 'abc'), true);
  assert.equal(constantTimeEqual('abc', 'abd'), false);
  assert.equal(constantTimeEqual('abc', 'abcd'), false);
  assert.equal(constantTimeEqual('', ''), true);
  assert.equal(constantTimeEqual(undefined, ''), true);
});

test('admin tokens are stable per secret and url-safe', async () => {
  const a = await adminToken('secret-one');
  assert.equal(a, await adminToken('secret-one'));
  assert.notEqual(a, await adminToken('secret-two'));
  assert.match(a, /^[A-Za-z0-9_-]+$/);
});

test('passcodes are six digits', () => {
  for (let i = 0; i < 50; i++) assert.match(randomPasscode(), /^\d{6}$/);
});

test('session is anonymous until login; wrong passcode is rejected', async () => {
  const { call } = setup();
  assert.deepEqual((await call('GET', '/admin/session')).json, { admin: false });
  await assert.rejects(call('POST', '/admin/login', { body: { passcode: '000000' } }), (e) => e instanceof ApiError && e.status === 401);
});

test('login sets a cookie that unlocks admin routes and reveals the passcode', async () => {
  const { call } = setup();
  const res = await call('POST', '/admin/login', { body: { passcode: ` ${PASSCODE} ` } });
  assert.match(res.headers['Set-Cookie'], /^fmm_admin=[A-Za-z0-9_-]+; Path=\/; HttpOnly; SameSite=Strict; Max-Age=\d+$/);
  const cookies = parseCookies(res.headers['Set-Cookie'].split(';')[0]);
  const session = await call('GET', '/admin/session', { cookies });
  assert.deepEqual(session.json, { admin: true, passcode: PASSCODE });
  const out = await call('POST', '/admin/logout', { cookies });
  assert.match(out.headers['Set-Cookie'], /Max-Age=0/);
});

test('secure cookies get the Secure attribute', async () => {
  const store = new Store();
  const api = createApi({ store, auth: createAuth({ secret: 's'.repeat(64), passcode: PASSCODE }), cookieName: 'fmm_admin_ZZZZ', secureCookies: true });
  const res = await api.handle({ method: 'POST', path: '/admin/login', cookies: {}, ip: 'x', json: async () => ({ passcode: PASSCODE }) });
  assert.match(res.headers['Set-Cookie'], /^fmm_admin_ZZZZ=.*; Secure; Max-Age=/);
});

test('admin routes reject anonymous callers', async () => {
  const { call } = setup();
  for (const [path, body] of [['/admin/resolve', { all: true }], ['/admin/roster', { memberCount: 2, channelCount: 2 }], ['/admin/show', { name: 'x' }], ['/admin/history/clear', {}]]) {
    await assert.rejects(call('POST', path, { body }), (e) => e.status === 401, path);
  }
});

test('performer request → admin resolve round trip', async () => {
  const { store, call } = setup();
  const [member] = store.members;
  const channel = member.channels[0];
  const sent = await call('POST', '/requests', { body: { memberId: member.id, channelId: channel.id, direction: 'more' } });
  assert.equal(sent.json.request.status, 'pending');
  const cookies = await login(call);
  const done = await call('POST', '/admin/resolve', { body: { requestId: sent.json.request.id }, cookies });
  assert.equal(done.json.resolved[0].status, 'done');
  assert.equal(store.pending().length, 0);
});

test('store errors surface as 409 and unknown routes as 404', async () => {
  const { call } = setup();
  await assert.rejects(call('POST', '/requests', { body: { memberId: 'nope', channelId: 'nope', direction: 'more' } }), (e) => e.status === 409 && e.code === 'unknown_member');
  await assert.rejects(call('GET', '/nope'), (e) => e.status === 404);
});

test('a performer mashing buttons is throttled', async () => {
  const { store, call } = setup();
  const [member] = store.members;
  const body = { memberId: member.id, channelId: member.channels[0].id, direction: 'more' };
  for (let i = 0; i < 12; i++) await call('POST', '/requests', { body });
  await assert.rejects(call('POST', '/requests', { body }), (e) => e.status === 429);
});

test('roster quick setup validates counts', async () => {
  const { call } = setup();
  const cookies = await login(call);
  await assert.rejects(call('POST', '/admin/roster', { body: { memberCount: 0, channelCount: 2 }, cookies }), (e) => e.status === 400);
  await assert.rejects(call('POST', '/admin/roster', { body: { members: [] }, cookies }), (e) => e.status === 400);
  const res = await call('POST', '/admin/roster', { body: { memberCount: 3, channelCount: 1 }, cookies });
  assert.equal(res.json.members.length, 3);
});

test('hub sends the current state on attach and every change after', () => {
  const store = new Store();
  store.quickSetup(1, 1);
  const hub = createHub(store, { heartbeatMs: 100_000 });
  const chunks = [];
  const detach = hub.attach((chunk) => chunks.push(chunk));
  assert.equal(hub.size(), 1);
  assert.match(chunks[0], /^retry: 2000\n\nevent: state\ndata: \{"rev":/);
  store.setShowName('Live');
  assert.equal(chunks.length, 2);
  assert.match(chunks[1], /"name":"Live"/);
  detach();
  store.setShowName('Gone');
  assert.equal(chunks.length, 2);
  assert.equal(hub.size(), 0);
  hub.close();
});

test('a client whose write throws is dropped', () => {
  const store = new Store();
  const hub = createHub(store);
  let calls = 0;
  hub.attach(() => { calls += 1; if (calls > 1) throw new Error('gone'); });
  store.setShowName('x');
  assert.equal(hub.size(), 0);
  hub.close();
});

test('throttle window slides', () => {
  let t = 0;
  const throttle = createThrottle(2, 1000, () => t);
  assert.equal(throttle('a'), true);
  assert.equal(throttle('a'), true);
  assert.equal(throttle('a'), false);
  assert.equal(throttle('b'), true);
  t = 1001;
  assert.equal(throttle('a'), true);
});

test('messaging routes: setting toggle, member send, admin send, ack and resolve', async () => {
  const { store, call } = setup();
  const [alex, sam] = store.members;
  await assert.rejects(call('POST', '/messages', { body: { memberId: alex.id, text: 'hi' } }), (e) => e.status === 409 && e.code === 'messaging_off');
  const cookies = await login(call);
  const show = await call('POST', '/admin/show', { body: { messaging: true }, cookies });
  assert.equal(show.json.show.messaging, true);
  assert.equal(show.json.show.name, 'FixMyMix');

  const fromMember = await call('POST', '/messages', { body: { memberId: alex.id, text: 'more reverb' } });
  assert.equal(fromMember.json.message.from, 'member');
  const done = await call('POST', '/admin/resolve', { body: { messageId: fromMember.json.message.id }, cookies });
  assert.equal(done.json.resolved[0].status, 'done');

  await assert.rejects(call('POST', '/admin/messages', { body: { all: true, text: 'x' } }), (e) => e.status === 401);
  const broadcast = await call('POST', '/admin/messages', { body: { all: true, text: 'Break after this' }, cookies });
  assert.equal(broadcast.json.sent.length, 2);
  const mine = broadcast.json.sent.find((m) => m.memberId === sam.id);
  await assert.rejects(call('POST', '/messages/ack', { body: { memberId: alex.id, messageId: mine.id } }), (e) => e.status === 409);
  const ack = await call('POST', '/messages/ack', { body: { memberId: sam.id, messageId: mine.id } });
  assert.equal(ack.json.message.status, 'done');

  for (let i = 0; i < 4; i++) await call('POST', '/messages', { body: { memberId: alex.id, text: `m${i}` } }); // 6 per 10 s, incl. the two attempts above
  await assert.rejects(call('POST', '/messages', { body: { memberId: alex.id, text: 'too many' } }), (e) => e.status === 429);
});
