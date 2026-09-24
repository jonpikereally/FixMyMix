import { test } from 'node:test';
import assert from 'node:assert/strict';
import { History, summarize, toCsv, reportFilename, MAX_ENTRIES } from '../src/history.js';
import { Store, buildRoster } from '../src/state.js';

function band() {
  const store = new Store({ members: buildRoster(2, 2), show: { name: 'Friday', messaging: true } });
  const history = new History();
  store.subscribeEvents((e) => history.record(e));
  return { store, history, alex: store.members[0], sam: store.members[1] };
}

test('every way a request or message finishes lands in the log, with the wait', () => {
  const { store, history, alex, sam } = band();
  const a = store.submitRequest({ memberId: alex.id, channelId: alex.channels[0].id, direction: 'more' });
  store.submitRequest({ memberId: alex.id, channelId: alex.channels[0].id, direction: 'more', priority: true });
  const b = store.submitRequest({ memberId: alex.id, channelId: alex.channels[1].id, direction: 'less' });
  const c = store.submitRequest({ memberId: sam.id, channelId: sam.channels[0].id, direction: 'more' });
  const m = store.sendMemberMessage({ memberId: sam.id, text: 'more reverb' });
  const [d] = store.sendAdminMessage({ memberId: alex.id, text: 'Break next', buzz: true });
  store.resolveRequest(a.id);
  store.cancelRequest({ memberId: alex.id, requestId: b.id });
  store.resolveMember(sam.id); // c and m
  store.ackMessage({ memberId: alex.id, messageId: d.id });
  const log = history.snapshot();
  assert.deepEqual(log.map((e) => [e.kind, e.status, e.memberName]), [
    ['request', 'done', 'Member 1'], ['request', 'cancelled', 'Member 1'], ['request', 'done', 'Member 2'], ['message', 'done', 'Member 2'], ['message', 'done', 'Member 1'],
  ]);
  assert.equal(log[0].priority, true);
  assert.equal(log[0].count, 2);
  assert.equal(log[3].from, 'member');
  assert.equal(log[4].from, 'admin');
  assert.equal(log[4].buzz, true);
  assert.ok(log.every((e) => e.waitMs >= 0 && e.resolvedAt >= e.createdAt));
  // clearing the board's recent list does not touch the log; only history.clear() does
  store.clearHistory();
  assert.equal(history.snapshot().length, 5);
  assert.equal(history.clear(), 5);
  assert.equal(history.snapshot().length, 0);
});

test('the log survives a round trip, skips junk, and is capped', () => {
  const history = new History([
    { kind: 'request', status: 'done', id: 'r1', memberId: 'm1', memberName: 'Alex', channelName: 'Vox', direction: 'more', count: 3, priority: true, createdAt: 1000, resolvedAt: 4000 },
    { kind: 'message', id: 'x1', memberId: 'm2', memberName: 'Sam', from: 'member', text: 'hi', createdAt: 2000, resolvedAt: 2500 },
    { nonsense: true }, 'no', null, { kind: 'request', memberName: 'no time' },
  ]);
  assert.equal(history.snapshot().length, 2);
  assert.equal(history.snapshot()[0].waitMs, 3000);
  assert.equal(history.record({ kind: 'request', id: 'r1', memberId: 'm1', createdAt: 1000 }), null, 'duplicates are ignored');
  const restored = new History(JSON.parse(JSON.stringify(history.snapshot())));
  assert.deepEqual(restored.snapshot(), history.snapshot());
  const big = new History();
  for (let i = 0; i < MAX_ENTRIES + 5; i++) big.record({ kind: 'request', id: `r${i}`, memberId: 'm', memberName: 'M', channelName: 'C', createdAt: i, resolvedAt: i + 1 });
  assert.equal(big.snapshot().length, MAX_ENTRIES);
  assert.equal(big.snapshot()[0].id, 'r5', 'oldest dropped first');
});

test('summary totals and CSV export', () => {
  const entries = new History([
    { kind: 'request', status: 'done', id: 'a', memberId: 'm1', memberName: 'Alex', channelName: 'Lead "Vox"', direction: 'more', count: 2, priority: true, createdAt: 1_700_000_000_000, resolvedAt: 1_700_000_010_000 },
    { kind: 'request', status: 'done', id: 'b', memberId: 'm2', memberName: 'Sam, drums', channelName: 'Kick', direction: 'less', count: 1, createdAt: 1_700_000_020_000, resolvedAt: 1_700_000_050_000 },
    { kind: 'request', status: 'cancelled', id: 'c', memberId: 'm2', memberName: 'Sam, drums', channelName: 'Snare', direction: 'more', count: 1, createdAt: 1_700_000_030_000, resolvedAt: 1_700_000_031_000 },
    { kind: 'message', status: 'done', id: 'd', memberId: 'm1', memberName: 'Alex', from: 'member', text: 'more reverb\nplease', createdAt: 1_700_000_040_000, resolvedAt: 1_700_000_045_000 },
  ]).snapshot();
  const s = summarize(entries);
  assert.equal(s.total, 4);
  assert.equal(s.requests, 2);
  assert.equal(s.cancelled, 1);
  assert.equal(s.messages, 1);
  assert.equal(s.priority, 1);
  assert.equal(s.averageWaitMs, 20_000);
  assert.equal(s.slowestWaitMs, 30_000);
  assert.equal(s.firstAt, 1_700_000_000_000);
  assert.equal(s.lastAt, 1_700_000_050_000);
  assert.deepEqual(s.members.map((m) => [m.memberName, m.requests, m.messages, m.priority, m.averageWaitMs]), [['Alex', 1, 1, 1, 10_000], ['Sam, drums', 1, 0, 0, 30_000]]);

  const csv = toCsv(entries, 'Friday Night');
  const lines = csv.trim().split('\r\n');
  assert.equal(lines.length, 5);
  assert.equal(lines[0], 'Show,Asked at (UTC),Performer,Type,Channel,Request,Count,Priority,Message,From,Outcome,Cleared at (UTC),Wait (s)');
  assert.equal(lines[1], 'Friday Night,2023-11-14 22:13:20,Alex,request,"Lead ""Vox""",can\'t hear,2,yes,,,done,2023-11-14 22:13:30,10.0');
  assert.equal(lines[2], 'Friday Night,2023-11-14 22:13:40,"Sam, drums",request,Kick,less,1,no,,,done,2023-11-14 22:14:10,30.0');
  assert.ok(lines[3].includes(',cancelled,'));
  assert.ok(lines[4].includes(',more reverb please,performer,done,'), lines[4]);
  assert.match(reportFilename('Friday Night!', Date.UTC(2026, 8, 24, 12)), /^FixMyMix-friday-night-2026-09-2[45]\.csv$/);
});
