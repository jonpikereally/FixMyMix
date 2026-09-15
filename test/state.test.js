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

test('messaging is off by default and gated by the show setting', () => {
  const { store, alex } = setup();
  assert.equal(store.show.messaging, false);
  assert.throws(() => store.sendMemberMessage({ memberId: alex.id, text: 'hi' }), (e) => e.code === 'messaging_off');
  assert.throws(() => store.sendAdminMessage({ memberId: alex.id, text: 'hi' }), (e) => e.code === 'messaging_off');
  store.setShow({ messaging: true });
  assert.throws(() => store.sendMemberMessage({ memberId: alex.id, text: '   ' }), (e) => e.code === 'empty_message');
  const sent = store.sendMemberMessage({ memberId: alex.id, text: '  more reverb  pls ' });
  assert.equal(sent.text, 'more reverb pls');
  assert.equal(sent.from, 'member');
  assert.equal(sent.memberName, 'Member 1');
});

test('member → desk messages are resolved by the admin, also via member/all resolves', () => {
  const { store, alex, sam } = setup();
  store.setShow({ messaging: true });
  const a = store.sendMemberMessage({ memberId: alex.id, text: 'a' });
  store.sendMemberMessage({ memberId: sam.id, text: 'b' });
  assert.equal(store.resolveMessage(a.id).status, 'done');
  assert.throws(() => store.resolveMessage(a.id), StoreError);
  assert.equal(store.pendingMessages().length, 1);
  const resolved = store.resolveMember(sam.id);
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0].text, 'b');
  assert.equal(store.pendingMessages().length, 0);
});

test('desk → member messages need the member to ack; broadcast sends one each', () => {
  const { store, alex, sam } = setup();
  store.setShow({ messaging: true });
  const sent = store.sendAdminMessage({ all: true, text: 'Break after this one' });
  assert.equal(sent.length, 2);
  assert.deepEqual(sent.map((m) => m.memberId).sort(), [alex.id, sam.id].sort());
  // resolveAll (admin) does not clear the desk's own messages; only the performer's ack does
  store.resolveAll();
  assert.equal(store.pendingMessages().length, 2);
  assert.throws(() => store.resolveMessage(sent[0].id), StoreError);
  assert.throws(() => store.ackMessage({ memberId: sam.id, messageId: sent[0].id }), StoreError);
  const acked = store.ackMessage({ memberId: sent[0].memberId, messageId: sent[0].id });
  assert.equal(acked.status, 'done');
  assert.equal(store.pendingMessages().length, 1);
});

test('messages survive a round trip and roster edits drop orphans', () => {
  const { store, alex, sam } = setup();
  store.setShow({ messaging: true });
  store.sendMemberMessage({ memberId: alex.id, text: 'keep' });
  store.sendMemberMessage({ memberId: sam.id, text: 'drop' });
  store.setRoster([{ id: alex.id, name: 'Alex', channels: alex.channels }]);
  assert.deepEqual(store.pendingMessages().map((m) => [m.text, m.memberName]), [['keep', 'Alex']]);
  const restored = new Store(JSON.parse(JSON.stringify(store.snapshot())));
  assert.equal(restored.show.messaging, true);
  assert.equal(restored.messages.length, 1);
  restored.clearHistory();
  assert.equal(restored.messages.length, 1);
});

test('desk messages can be sent with buzz, and the default is a show setting', () => {
  const { store, alex, sam } = setup();
  assert.equal(store.show.buzzDefault, false);
  store.setShow({ messaging: true, buzzDefault: true });
  assert.equal(store.show.buzzDefault, true);
  const plain = store.sendAdminMessage({ memberId: alex.id, text: 'plain' });
  assert.equal(plain[0].buzz, false);
  const buzzed = store.sendAdminMessage({ all: true, text: 'Turn round!', buzz: true });
  assert.deepEqual(buzzed.map((m) => m.buzz), [true, true]);
  assert.equal(store.sendAdminMessage({ memberId: sam.id, text: 'x', buzz: 'yes' })[0].buzz, false, 'buzz must be boolean true');
  const restored = new Store(JSON.parse(JSON.stringify(store.snapshot())));
  assert.equal(restored.show.buzzDefault, true);
  assert.deepEqual(restored.pendingMessages().filter((m) => m.buzz).map((m) => m.text), ['Turn round!', 'Turn round!']);
  assert.equal(restored.ackMessage({ memberId: alex.id, messageId: buzzed[0].id }).status, 'done');
});
