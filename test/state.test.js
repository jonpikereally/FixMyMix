import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store, StoreError, buildRoster, MAX_COUNT, MAX_HISTORY } from '../src/state.js';

function setup() {
  const store = new Store();
  store.quickSetup(2, 3);
  const [alex, sam] = store.members;
  return { store, alex, sam };
}

test('quick setup builds numbered members with named channels', () => {
  const roster = buildRoster(3, 2);
  assert.equal(roster.length, 3);
  assert.deepEqual(roster.map((m) => m.name), ['Member 1', 'Member 2', 'Member 3']);
  assert.deepEqual(roster[0].channels.map((c) => c.name), ['Vocal', 'Guitar']);
  assert.notEqual(roster[0].channels[0].id, roster[1].channels[0].id);
});

test('submitting a request puts it on the board and bumps rev', () => {
  const { store, alex } = setup();
  const before = store.rev;
  const request = store.submitRequest({ memberId: alex.id, channelId: alex.channels[0].id, direction: 'more' });
  assert.equal(request.status, 'pending');
  assert.equal(request.memberName, 'Member 1');
  assert.equal(request.channelName, 'Vocal');
  assert.equal(store.pending().length, 1);
  assert.equal(store.rev, before + 1);
});

test('repeat taps escalate instead of stacking, capped at MAX_COUNT', () => {
  const { store, alex } = setup();
  const args = { memberId: alex.id, channelId: alex.channels[1].id, direction: 'less' };
  for (let i = 0; i < MAX_COUNT + 3; i++) store.submitRequest(args);
  const pending = store.pending();
  assert.equal(pending.length, 1);
  assert.equal(pending[0].count, MAX_COUNT);
});

test('opposite direction replaces the pending request', () => {
  const { store, alex } = setup();
  const channelId = alex.channels[0].id;
  store.submitRequest({ memberId: alex.id, channelId, direction: 'more' });
  store.submitRequest({ memberId: alex.id, channelId, direction: 'more' });
  const swapped = store.submitRequest({ memberId: alex.id, channelId, direction: 'less' });
  assert.equal(store.pending().length, 1);
  assert.equal(swapped.direction, 'less');
  assert.equal(swapped.count, 1);
});

test('rejects unknown members, channels and directions', () => {
  const { store, alex } = setup();
  assert.throws(() => store.submitRequest({ memberId: 'nope', channelId: alex.channels[0].id, direction: 'more' }), StoreError);
  assert.throws(() => store.submitRequest({ memberId: alex.id, channelId: 'nope', direction: 'more' }), StoreError);
  assert.throws(() => store.submitRequest({ memberId: alex.id, channelId: alex.channels[0].id, direction: 'louder' }), StoreError);
});

test('resolving marks the request done with a timestamp', () => {
  const { store, alex } = setup();
  const request = store.submitRequest({ memberId: alex.id, channelId: alex.channels[0].id, direction: 'more' });
  const done = store.resolveRequest(request.id);
  assert.equal(done.status, 'done');
  assert.ok(done.resolvedAt >= done.createdAt);
  assert.equal(store.pending().length, 0);
  assert.throws(() => store.resolveRequest(request.id), StoreError);
});

test('performers can only cancel their own pending requests', () => {
  const { store, alex, sam } = setup();
  const request = store.submitRequest({ memberId: alex.id, channelId: alex.channels[0].id, direction: 'more' });
  assert.throws(() => store.cancelRequest({ memberId: sam.id, requestId: request.id }), StoreError);
  store.cancelRequest({ memberId: alex.id, requestId: request.id });
  assert.equal(store.requests.length, 0);
});

test('resolveMember and resolveAll clear the right requests', () => {
  const { store, alex, sam } = setup();
  store.submitRequest({ memberId: alex.id, channelId: alex.channels[0].id, direction: 'more' });
  store.submitRequest({ memberId: alex.id, channelId: alex.channels[1].id, direction: 'less' });
  store.submitRequest({ memberId: sam.id, channelId: sam.channels[0].id, direction: 'more' });
  assert.equal(store.resolveMember(alex.id).length, 2);
  assert.equal(store.pending().length, 1);
  assert.equal(store.resolveAll().length, 1);
  assert.equal(store.pending().length, 0);
  assert.deepEqual(store.resolveAll(), []);
});

test('roster edits keep ids, rename live requests and drop orphans', () => {
  const { store, alex, sam } = setup();
  const keep = store.submitRequest({ memberId: alex.id, channelId: alex.channels[0].id, direction: 'more' });
  store.submitRequest({ memberId: sam.id, channelId: sam.channels[0].id, direction: 'less' });
  store.setRoster([
    { id: alex.id, name: 'Alex', channels: [{ id: alex.channels[0].id, name: 'Lead Vox' }, { name: 'New' }] },
  ]);
  assert.equal(store.members.length, 1);
  assert.equal(store.members[0].channels.length, 2);
  const pending = store.pending();
  assert.equal(pending.length, 1);
  assert.equal(pending[0].id, keep.id);
  assert.equal(pending[0].memberName, 'Alex');
  assert.equal(pending[0].channelName, 'Lead Vox');
});

test('history is capped and pending requests survive the cap', () => {
  const { store, alex } = setup();
  for (let i = 0; i < MAX_HISTORY + 20; i++) {
    const request = store.submitRequest({ memberId: alex.id, channelId: alex.channels[0].id, direction: 'more' });
    store.resolveRequest(request.id);
  }
  store.submitRequest({ memberId: alex.id, channelId: alex.channels[1].id, direction: 'less' });
  assert.equal(store.requests.filter((r) => r.status === 'done').length, MAX_HISTORY);
  assert.equal(store.pending().length, 1);
  store.clearHistory();
  assert.equal(store.requests.length, 1);
});

test('snapshot round-trips through the constructor and sanitises junk', () => {
  const { store, alex } = setup();
  store.setShowName('   Friday   Night  ');
  store.submitRequest({ memberId: alex.id, channelId: alex.channels[0].id, direction: 'more' });
  const raw = JSON.parse(JSON.stringify(store.snapshot()));
  raw.requests.push({ memberId: 'ghost', channelId: 'ghost', status: 'pending' });
  raw.members.push({ name: '<b>x</b>'.repeat(20), channels: 'not-a-list' });
  const restored = new Store(raw);
  assert.equal(restored.show.name, 'Friday Night');
  assert.equal(restored.rev, store.rev);
  assert.equal(restored.pending().length, 1);
  assert.equal(restored.members.length, 3);
  assert.equal(restored.members[2].name.length, 40);
  assert.equal(restored.members[2].channels.length, 4);
});

test('subscribers receive a snapshot on every change', () => {
  const { store, alex } = setup();
  const seen = [];
  const unsubscribe = store.subscribe((snapshot) => seen.push(snapshot.rev));
  store.submitRequest({ memberId: alex.id, channelId: alex.channels[0].id, direction: 'more' });
  store.resolveAll();
  unsubscribe();
  store.resolveAll();
  assert.equal(seen.length, 2);
  assert.equal(seen[1], seen[0] + 1);
});

test('icons are guessed for defaults, validated on load and carried into requests', async () => {
  const { guessIcon } = await import('../public/js/icons.js');
  assert.equal(guessIcon('Lead Vox'), 'vocal');
  assert.equal(guessIcon('Bass guitar'), 'bass');
  assert.equal(guessIcon('Kick'), 'drums');
  assert.equal(guessIcon('Mystery'), '');
  const store = new Store();
  store.quickSetup(1, 3);
  assert.deepEqual(store.members[0].channels.map((c) => c.icon), ['vocal', 'guitar', 'bass']);
  store.setRoster([{ id: store.members[0].id, name: 'Alex', icon: 'drums', channels: [{ name: 'Snare', icon: 'drums' }, { name: 'Odd', icon: 'not-an-icon' }] }]);
  assert.equal(store.members[0].icon, 'drums');
  assert.deepEqual(store.members[0].channels.map((c) => c.icon), ['drums', '']);
  const request = store.submitRequest({ memberId: store.members[0].id, channelId: store.members[0].channels[0].id, direction: 'more' });
  assert.equal(request.channelIcon, 'drums');
  const restored = new Store(JSON.parse(JSON.stringify(store.snapshot())));
  assert.equal(restored.members[0].icon, 'drums');
  assert.equal(restored.requests[0].channelIcon, 'drums');
});
