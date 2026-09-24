// The show log: every request and message that finished (cleared by the desk,
// read by the performer, or cancelled), kept beyond the board's short
// "recently done" list so the whole night can be reviewed and exported.

export const MAX_ENTRIES = 5000;

const clean = (value, max = 200) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : null);

export function normalizeEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const kind = raw.kind === 'message' ? 'message' : 'request';
  const createdAt = num(raw.createdAt);
  const resolvedAt = num(raw.resolvedAt) ?? createdAt;
  if (createdAt === null) return null;
  const entry = {
    id: clean(raw.id, 32) || `${createdAt}-${Math.random().toString(36).slice(2, 8)}`,
    kind,
    status: raw.status === 'cancelled' ? 'cancelled' : 'done',
    memberId: clean(raw.memberId, 32),
    memberName: clean(raw.memberName, 40) || 'Unknown',
    createdAt,
    resolvedAt,
    waitMs: Math.max(0, resolvedAt - createdAt),
  };
  if (kind === 'request') {
    entry.channelName = clean(raw.channelName, 40) || 'Channel';
    entry.channelIcon = clean(raw.channelIcon, 24);
    entry.direction = raw.direction === 'less' ? 'less' : 'more';
    entry.count = Math.max(1, Math.min(99, Math.floor(num(raw.count) ?? 1)));
    entry.priority = raw.priority === true;
  } else {
    entry.from = raw.from === 'admin' ? 'admin' : 'member';
    entry.text = clean(raw.text, 200);
    entry.buzz = raw.buzz === true;
  }
  return entry;
}

export class History {
  #listeners = new Set();

  constructor(initial = []) {
    const list = Array.isArray(initial) ? initial : [];
    this.entries = list.map(normalizeEntry).filter(Boolean).slice(-MAX_ENTRIES);
  }

  subscribe(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  snapshot() {
    return this.entries.map((e) => ({ ...e }));
  }

  /** Records one finished item (the shape the store emits). */
  record(raw) {
    const entry = normalizeEntry(raw);
    if (!entry) return null;
    if (this.entries.some((e) => e.id === entry.id && e.kind === entry.kind)) return null;
    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) this.entries = this.entries.slice(-MAX_ENTRIES);
    this.#commit();
    return entry;
  }

  clear() {
    const had = this.entries.length;
    this.entries = [];
    if (had) this.#commit();
    return had;
  }

  #commit() {
    const snapshot = this.snapshot();
    for (const listener of this.#listeners) listener(snapshot);
  }
}

/** Totals for the report header and the History tab. */
export function summarize(entries) {
  const requests = entries.filter((e) => e.kind === 'request' && e.status === 'done');
  const cancelled = entries.filter((e) => e.kind === 'request' && e.status === 'cancelled').length;
  const messages = entries.filter((e) => e.kind === 'message').length;
  const priority = requests.filter((e) => e.priority).length;
  const waits = requests.map((e) => e.waitMs);
  const avg = waits.length ? Math.round(waits.reduce((a, b) => a + b, 0) / waits.length) : 0;
  const slowest = waits.length ? Math.max(...waits) : 0;
  const byMember = new Map();
  for (const e of entries) {
    const m = byMember.get(e.memberId) ?? { memberId: e.memberId, memberName: e.memberName, requests: 0, messages: 0, priority: 0, waits: [] };
    m.memberName = e.memberName;
    if (e.kind === 'request' && e.status === 'done') { m.requests += 1; m.waits.push(e.waitMs); if (e.priority) m.priority += 1; }
    if (e.kind === 'message') m.messages += 1;
    byMember.set(e.memberId, m);
  }
  const times = entries.map((e) => e.createdAt);
  return {
    total: entries.length,
    requests: requests.length,
    cancelled,
    messages,
    priority,
    averageWaitMs: avg,
    slowestWaitMs: slowest,
    firstAt: times.length ? Math.min(...times) : null,
    lastAt: entries.length ? Math.max(...entries.map((e) => e.resolvedAt)) : null,
    members: [...byMember.values()].map((m) => ({
      memberId: m.memberId,
      memberName: m.memberName,
      requests: m.requests,
      messages: m.messages,
      priority: m.priority,
      averageWaitMs: m.waits.length ? Math.round(m.waits.reduce((a, b) => a + b, 0) / m.waits.length) : 0,
    })),
  };
}

function csvCell(value) {
  const s = String(value ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const stamp = (t) => new Date(t).toISOString().replace('T', ' ').slice(0, 19);

/** The whole log as CSV, oldest first. Times are UTC in ISO form. */
export function toCsv(entries, showName = 'FixMyMix') {
  const header = ['Show', 'Asked at (UTC)', 'Performer', 'Type', 'Channel', 'Request', 'Count', 'Priority', 'Message', 'From', 'Outcome', 'Cleared at (UTC)', 'Wait (s)'];
  const rows = entries
    .slice()
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((e) => [
      showName,
      stamp(e.createdAt),
      e.memberName,
      e.kind,
      e.kind === 'request' ? e.channelName : '',
      e.kind === 'request' ? (e.priority ? "can't hear" : e.direction) : '',
      e.kind === 'request' ? e.count : '',
      e.kind === 'request' ? (e.priority ? 'yes' : 'no') : '',
      e.kind === 'message' ? e.text : '',
      e.kind === 'message' ? (e.from === 'admin' ? 'desk' : 'performer') : '',
      e.status === 'cancelled' ? 'cancelled' : e.kind === 'message' ? (e.from === 'admin' ? 'read' : 'done') : 'done',
      stamp(e.resolvedAt),
      (e.waitMs / 1000).toFixed(1),
    ]);
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export function reportFilename(showName, at = Date.now()) {
  const slug = String(showName).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'show';
  const d = new Date(at);
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return `FixMyMix-${slug}-${date}.csv`;
}
