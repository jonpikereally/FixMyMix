import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Setups, parseSetup, setupFilename, MAX_SETUPS } from '../src/setups.js';
import { Store, StoreError, buildRoster } from '../src/state.js';

const band = () => new Store({ members: buildRoster(3, 2), show: { name: 'Friday', messaging: true, buzzDefault: true } });

test('save keeps roster ids and show settings; the same name overwrites in place', () => {
  const setups = new Setups();
  const store = band();
  const saved = setups.save({ name: '  Friday   trio ', show: store.show, members: store.members });
  assert.equal(saved.name, 'Friday trio');
  assert.deepEqual(saved.members.map((m) => m.id), store.members.map((m) => m.id));
  assert.deepEqual(saved.show, { name: 'Friday', messaging: true, buzzDefault: true });
  store.setShow({ name: 'Saturday' });
  const again = setups.save({ name: 'friday TRIO', show: store.show, members: store.members });
  assert.equal(again.id, saved.id);
  assert.equal(setups.summaries().length, 1);
  assert.equal(setups.get(saved.id).show.name, 'Saturday');
  assert.deepEqual(setups.summaries()[0], { id: saved.id, name: 'friday TRIO', savedAt: again.savedAt, members: 3, channels: 6 });
});

test('setups survive a round trip through JSON and skip unreadable entries', () => {
  const setups = new Setups();
  const store = band();
  setups.save({ name: 'A', show: store.show, members: store.members });
  setups.save({ name: 'B', show: store.show, members: store.members.slice(0, 1) });
  const raw = JSON.parse(JSON.stringify(setups.snapshot()));
  raw.push({ name: 'broken', members: [] }, 'nonsense', null);
  const restored = new Setups(raw);
  assert.deepEqual(restored.summaries().map((s) => [s.name, s.members]).sort(), [['A', 3], ['B', 1]]);
});

test('import validates the file, keeps names unique, and export names the file sensibly', () => {
  const setups = new Setups();
  assert.throws(() => setups.import('nope'), (e) => e instanceof StoreError && e.code === 'bad_setup');
  assert.throws(() => setups.import({ members: [] }), (e) => e.code === 'bad_setup');
  assert.throws(() => parseSetup({ members: 'x' }), StoreError);
  const store = band();
  const first = setups.import({ app: 'FixMyMix', format: 1, name: 'Tour band', show: store.show, members: store.members });
  assert.equal(first.name, 'Tour band');
  const second = setups.import({ name: 'tour BAND', members: store.members });
  assert.equal(second.name, 'tour BAND (2)');
  assert.notEqual(second.id, first.id);
  // a bare roster with no name takes the fallback (from the filename)
  const bare = setups.import({ members: buildRoster(2, 2) }, { fallbackName: 'from file' });
  assert.equal(bare.name, 'from file');
  assert.deepEqual(bare.show, { name: 'FixMyMix', messaging: false, buzzDefault: false });
  assert.equal(setupFilename('Friday Night / Trio!'), 'FixMyMix-friday-night-trio.json');
  assert.equal(setupFilename('***'), 'FixMyMix-setup.json');
});

test('remove, unknown ids, and the cap', () => {
  const setups = new Setups();
  const store = band();
  const saved = setups.save({ name: 'x', show: store.show, members: store.members });
  assert.throws(() => setups.get('nope'), (e) => e.code === 'unknown_setup');
  assert.equal(setups.remove(saved.id).name, 'x');
  assert.throws(() => setups.remove(saved.id), StoreError);
  for (let i = 0; i < MAX_SETUPS; i++) setups.save({ name: `s${i}`, show: store.show, members: store.members });
  assert.throws(() => setups.save({ name: 'one more', show: store.show, members: store.members }), (e) => e.code === 'too_many_setups');
  setups.save({ name: 's0', show: store.show, members: store.members }); // overwrite is still fine
});
