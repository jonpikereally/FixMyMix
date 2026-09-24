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
  const call = (method, path, { body = {}, cookies = {}, ip = '10.0.0.1', query = {} } = {}) =>
    api.handle({ method, path, cookies, ip, query, json: async () => body });
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
  assert.equal(sent.json.request.priority, false);
  const urgent = await call('POST', '/requests', { body: { memberId: member.id, channelId: channel.id, direction: 'more', priority: true } });
  assert.equal(urgent.json.request.priority, true);
  assert.equal(urgent.json.request.id, sent.json.request.id);
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
  assert.equal(mine.buzz, false);

  const buzzed = await call('POST', '/admin/messages', { body: { memberId: alex.id, text: 'Look up', buzz: true }, cookies });
  assert.equal(buzzed.json.sent[0].buzz, true);
  const withDefault = await call('POST', '/admin/show', { body: { buzzDefault: true }, cookies });
  assert.equal(withDefault.json.show.buzzDefault, true);
  assert.equal(withDefault.json.show.messaging, true, 'other show settings untouched');

  for (let i = 0; i < 4; i++) await call('POST', '/messages', { body: { memberId: alex.id, text: `m${i}` } }); // 6 per 10 s, incl. the two attempts above
  await assert.rejects(call('POST', '/messages', { body: { memberId: alex.id, text: 'too many' } }), (e) => e.status === 429);
});

test('a retried POST with the same opId is answered once, not applied twice', async () => {
  const { store, call } = setup();
  const [alex] = store.members;
  const body = { memberId: alex.id, channelId: alex.channels[0].id, direction: 'more', opId: 'tap-1' };
  const first = await call('POST', '/requests', { body });
  const again = await call('POST', '/requests', { body });
  assert.equal(again.json.request.count, 1);
  assert.equal(again.json.request.id, first.json.request.id);
  assert.equal(store.pending()[0].count, 1);
  const fresh = await call('POST', '/requests', { body: { ...body, opId: 'tap-2' } });
  assert.equal(fresh.json.request.count, 2);
});

test('stream carries presence and buzz reaches the right devices', async () => {
  const { store, api, call } = setup();
  const [alex, sam] = store.members;
  const seen = { alex: [], sam: [], board: [] };
  const detachAlex = api.hub.attach((c) => seen.alex.push(c), { memberId: alex.id });
  api.hub.attach((c) => seen.sam.push(c), { memberId: sam.id });
  api.hub.attach((c) => seen.board.push(c));
  const state = await call('GET', '/state');
  assert.deepEqual(state.json.presence, { online: { [alex.id]: 1, [sam.id]: 1 }, devices: 3 });
  const stream = await call('GET', '/stream', {});
  assert.deepEqual(stream, { sse: true, memberId: null });
  const withMember = await api.handle({ method: 'GET', path: '/stream', query: { memberId: alex.id }, cookies: {}, json: async () => ({}) });
  assert.equal(withMember.memberId, alex.id);

  const cookies = await login(call);
  await assert.rejects(call('POST', '/admin/buzz', { body: {} }), (e) => e.status === 401);
  const all = await call('POST', '/admin/buzz', { body: {}, cookies });
  assert.equal(all.json.devices, 3);
  assert.equal(seen.alex.filter((c) => c.startsWith('event: buzz')).length, 1);
  assert.equal(seen.board.filter((c) => c.startsWith('event: buzz')).length, 1);
  await call('POST', '/admin/buzz', { body: { memberId: sam.id }, cookies });
  assert.equal(seen.sam.filter((c) => c.startsWith('event: buzz')).length, 2);
  assert.equal(seen.alex.filter((c) => c.startsWith('event: buzz')).length, 1);

  // Alex disconnects: the others get a fresh state frame without them.
  detachAlex();
  const last = JSON.parse(seen.board.at(-1).replace(/^event: state\ndata: /, ''));
  assert.deepEqual(last.presence, { online: { [sam.id]: 1 }, devices: 2 });
  api.hub.close();
});

test('admin can change the passcode; old sessions die, the changing device stays in', async () => {
  const { store, call } = setup();
  const persisted = [];
  const auth = createAuth({ secret: 'z'.repeat(64), passcode: '1234' });
  const api = createApi({ store, auth, onCredentials: (c) => persisted.push(c) });
  const go = (method, path, opts = {}) => api.handle({ method, path, cookies: {}, ip: 'x', json: async () => ({}), ...opts });
  const cookieOf = (res) => parseCookies(res.headers['Set-Cookie'].split(';')[0]);
  const deviceA = cookieOf(await go('POST', '/admin/login', { json: async () => ({ passcode: '1234' }) }));
  const deviceB = cookieOf(await go('POST', '/admin/login', { json: async () => ({ passcode: '1234' }) }));
  await assert.rejects(go('POST', '/admin/passcode', { cookies: deviceA, json: async () => ({ passcode: '12' }) }), (e) => e.status === 400);
  await assert.rejects(go('POST', '/admin/passcode', { json: async () => ({ passcode: '9876' }) }), (e) => e.status === 401);
  const changed = await go('POST', '/admin/passcode', { cookies: deviceA, json: async () => ({ passcode: '9876' }) });
  assert.equal(changed.json.passcode, '9876');
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].passcode, '9876');
  assert.notEqual(persisted[0].secret, 'z'.repeat(64));
  const deviceA2 = cookieOf(changed);
  assert.deepEqual((await go('GET', '/admin/session', { cookies: deviceA2 })).json, { admin: true, passcode: '9876' });
  assert.deepEqual((await go('GET', '/admin/session', { cookies: deviceA })).json, { admin: false });
  assert.deepEqual((await go('GET', '/admin/session', { cookies: deviceB })).json, { admin: false });
  await assert.rejects(go('POST', '/admin/login', { json: async () => ({ passcode: '1234' }) }), (e) => e.status === 401);
  assert.ok(await go('POST', '/admin/login', { json: async () => ({ passcode: '9876' }) }));
  assert.equal(auth.passcode, '9876');
});

test('hub.close() ends every attached stream', () => {
  const store = new Store();
  const api = createApi({ store, auth: createAuth({ secret: 'q'.repeat(64), passcode: '1234' }) });
  const ended = [];
  api.hub.attach(() => {}, { end: () => ended.push('a') });
  api.hub.attach(() => {}, { memberId: 'm', end: () => ended.push('b') });
  api.hub.attach(() => {}, { end: () => { throw new Error('gone'); } });
  api.hub.close();
  assert.deepEqual(ended.sort(), ['a', 'b']);
  assert.equal(api.hub.size(), 0);
});

test('band setups: save, list, load, export as a download, import, delete — admin only', async () => {
  const { store, call } = setup();
  for (const [method, path] of [['GET', '/admin/setups'], ['POST', '/admin/setups'], ['POST', '/admin/setups/load'], ['GET', '/admin/setups/export'], ['POST', '/admin/setups/import'], ['POST', '/admin/setups/delete']]) {
    await assert.rejects(call(method, path, { body: { name: 'x' } }), (e) => e.status === 401, path);
  }
  const cookies = await login(call);
  await call('POST', '/admin/show', { body: { name: 'Friday', messaging: true, buzzDefault: true }, cookies });
  const originalIds = store.members.map((m) => m.id);

  await assert.rejects(call('POST', '/admin/setups', { body: { name: '   ' }, cookies }).then((r) => { if (r.json.saved.name !== 'Untitled setup') throw new Error('x'); return Promise.reject(Object.assign(new Error('named'), { named: true })); }), (e) => e.named, 'a blank name falls back to Untitled setup');
  const saved = await call('POST', '/admin/setups', { body: { name: 'Friday trio' }, cookies });
  assert.equal(saved.json.saved.name, 'Friday trio');
  assert.equal(saved.json.setups.length, 2);
  const listed = await call('GET', '/admin/setups', { cookies });
  assert.deepEqual(listed.json.setups.map((s) => s.name).sort(), ['Friday trio', 'Untitled setup']);

  // change the live show, then load the setup back: roster ids and show settings return
  await call('POST', '/admin/roster', { body: { memberCount: 1, channelCount: 1 }, cookies });
  await call('POST', '/admin/show', { body: { name: 'Other', messaging: false }, cookies });
  assert.equal(store.members.length, 1);
  const loaded = await call('POST', '/admin/setups/load', { body: { id: saved.json.saved.id }, cookies });
  assert.equal(loaded.json.loaded.name, 'Friday trio');
  assert.deepEqual(store.members.map((m) => m.id), originalIds);
  assert.equal(store.show.name, 'Friday');
  assert.equal(store.show.messaging, true);
  await assert.rejects(call('POST', '/admin/setups/load', { body: { id: 'nope' }, cookies }), (e) => e.status === 409 && e.code === 'unknown_setup');

  // export: a saved one by id, or the live roster; always a file download
  const file = await call('GET', '/admin/setups/export', { query: { id: saved.json.saved.id }, cookies });
  assert.equal(file.headers['Content-Disposition'], 'attachment; filename="FixMyMix-friday-trio.json"');
  assert.equal(file.json.app, 'FixMyMix');
  assert.equal(file.json.id, undefined, 'ids are minted on import, not carried in the file');
  assert.equal(file.json.members.length, 2);
  const live = await call('GET', '/admin/setups/export', { cookies });
  assert.equal(live.json.name, 'Friday');
  assert.equal(live.headers['Content-Disposition'], 'attachment; filename="FixMyMix-friday.json"');

  // import the exported file (round trip), as a saved copy and then loaded
  const imported = await call('POST', '/admin/setups/import', { body: { setup: file.json, filename: 'FixMyMix-friday-trio.json' }, cookies });
  assert.equal(imported.json.imported.name, 'Friday trio (2)');
  assert.equal(imported.json.imported.loaded, false);
  const bare = await call('POST', '/admin/setups/import', { body: { setup: { members: [{ name: 'Solo', channels: [{ name: 'Vox' }] }] }, filename: 'FixMyMix-tour-band.json', load: true }, cookies });
  assert.equal(bare.json.imported.name, 'tour band');
  assert.equal(bare.json.imported.loaded, true);
  assert.equal(store.members[0].name, 'Solo');
  await assert.rejects(call('POST', '/admin/setups/import', { body: { setup: { hello: 1 } }, cookies }), (e) => e.status === 409 && e.code === 'bad_setup');

  const removed = await call('POST', '/admin/setups/delete', { body: { id: saved.json.saved.id }, cookies });
  assert.equal(removed.json.removed.name, 'Friday trio');
  assert.equal(removed.json.setups.length, 3);
});

test('show log routes: list with summary, CSV download, clear with journal', async () => {
  const { store, call } = setup();
  const [alex] = store.members;
  for (const [method, path] of [['GET', '/admin/history'], ['GET', '/admin/history/export']]) await assert.rejects(call(method, path), (e) => e.status === 401, path);
  const cookies = await login(call);
  const empty = await call('GET', '/admin/history', { cookies });
  assert.deepEqual(empty.json.entries, []);
  assert.equal(empty.json.summary.total, 0);
  // nothing recorded without a History wired to the store events; wire one like the server does
  const { History } = await import('../src/history.js');
  const history = new History();
  store.subscribeEvents((e) => history.record(e));
  const api2 = createApi({ store, auth: createAuth({ secret: 'a'.repeat(64), passcode: PASSCODE }), history });
  const call2 = (method, path, { body = {}, cookies = {}, ip = '10.0.0.1', query = {} } = {}) => api2.handle({ method, path, cookies, ip, query, json: async () => body });
  const cookies2 = await login(call2);
  const r = await call2('POST', '/requests', { body: { memberId: alex.id, channelId: alex.channels[0].id, direction: 'more' } });
  await call2('POST', '/admin/resolve', { body: { requestId: r.json.request.id }, cookies: cookies2 });
  const listed = await call2('GET', '/admin/history', { cookies: cookies2 });
  assert.equal(listed.json.entries.length, 1);
  assert.equal(listed.json.entries[0].channelName, alex.channels[0].name);
  assert.equal(listed.json.summary.requests, 1);
  assert.equal(listed.json.show, 'FixMyMix');
  const csv = await call2('GET', '/admin/history/export', { cookies: cookies2 });
  assert.equal(csv.status, 200);
  assert.match(csv.headers['Content-Type'], /^text\/csv/);
  assert.match(csv.headers['Content-Disposition'], /^attachment; filename="FixMyMix-fixmymix-\d{4}-\d{2}-\d{2}\.csv"$/);
  assert.ok(csv.body.startsWith('Show,Asked at (UTC),Performer'));
  assert.equal(csv.body.trim().split('\r\n').length, 2);
  // clearing the recent list alone keeps the log; journal: true wipes it
  await call2('POST', '/admin/history/clear', { body: {}, cookies: cookies2 });
  assert.equal((await call2('GET', '/admin/history', { cookies: cookies2 })).json.entries.length, 1);
  await call2('POST', '/admin/history/clear', { body: { journal: true }, cookies: cookies2 });
  assert.equal((await call2('GET', '/admin/history', { cookies: cookies2 })).json.entries.length, 0);
});
