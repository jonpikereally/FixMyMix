import { randomBytes } from 'node:crypto';
import { ICON_KEYS, guessIcon } from '../public/js/icons.js';

export const MAX_MEMBERS = 24;
export const MAX_CHANNELS = 16;
export const MAX_HISTORY = 100;
export const MAX_COUNT = 9;
export const MAX_MESSAGE_LENGTH = 200;

const DIRECTIONS = new Set(['more', 'less']);
const DEFAULT_CHANNEL_NAMES = [
  'Vocal', 'Guitar', 'Bass', 'Keys', 'Drums', 'Click',
  'Backing', 'Ambience', 'Sax', 'Horns', 'Perc', 'Talkback',
];

export class StoreError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'StoreError';
    this.code = code;
  }
}

export function newId() {
  return randomBytes(6).toString('hex');
}

function text(value, fallback, max = 40) {
  const out = String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
  return out || fallback;
}

function iconKey(value) {
  return ICON_KEYS.has(value) ? value : '';
}

function clamp(value, min, max, fallback) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function defaultChannels(count) {
  const total = clamp(count, 1, MAX_CHANNELS, 4);
  return Array.from({ length: total }, (_, i) => {
    const name = DEFAULT_CHANNEL_NAMES[i] ?? `Ch ${i + 1}`;
    return { id: newId(), name, icon: guessIcon(name) };
  });
}

export function buildRoster(memberCount, channelCount) {
  const total = clamp(memberCount, 1, MAX_MEMBERS, 4);
  return Array.from({ length: total }, (_, i) => ({
    id: newId(),
    name: `Member ${i + 1}`,
    icon: '',
    channels: defaultChannels(channelCount),
  }));
}

function normalizeChannels(raw) {
  const list = Array.isArray(raw) ? raw.slice(0, MAX_CHANNELS) : [];
  const seen = new Set();
  const channels = [];
  for (const [i, channel] of list.entries()) {
    let id = text(channel?.id, '', 32) || newId();
    if (seen.has(id)) id = newId();
    seen.add(id);
    channels.push({ id, name: text(channel?.name, `Ch ${i + 1}`), icon: iconKey(channel?.icon) });
  }
  return channels.length ? channels : defaultChannels(4);
}

function normalizeMembers(raw) {
  const list = Array.isArray(raw) ? raw.slice(0, MAX_MEMBERS) : [];
  const seen = new Set();
  return list.map((member, i) => {
    let id = text(member?.id, '', 32) || newId();
    if (seen.has(id)) id = newId();
    seen.add(id);
    return {
      id,
      name: text(member?.name, `Member ${i + 1}`),
      icon: iconKey(member?.icon),
      channels: normalizeChannels(member?.channels),
    };
  });
}

function normalizeRequests(raw, members) {
  const index = new Map(members.map((m) => [m.id, new Set(m.channels.map((c) => c.id))]));
  const list = Array.isArray(raw) ? raw : [];
  const requests = [];
  for (const entry of list) {
    const status = entry?.status === 'done' ? 'done' : 'pending';
    const memberId = text(entry?.memberId, '', 32);
    const channelId = text(entry?.channelId, '', 32);
    if (status === 'pending' && !index.get(memberId)?.has(channelId)) continue;
    const createdAt = clamp(entry?.createdAt, 0, Number.MAX_SAFE_INTEGER, Date.now());
    requests.push({
      id: text(entry?.id, '', 32) || newId(),
      memberId,
      memberName: text(entry?.memberName, 'Unknown'),
      channelId,
      channelName: text(entry?.channelName, 'Unknown'),
      channelIcon: iconKey(entry?.channelIcon),
      direction: DIRECTIONS.has(entry?.direction) ? entry.direction : 'more',
      count: clamp(entry?.count, 1, MAX_COUNT, 1),
      status,
      createdAt,
      updatedAt: clamp(entry?.updatedAt, 0, Number.MAX_SAFE_INTEGER, createdAt),
      resolvedAt: status === 'done' ? clamp(entry?.resolvedAt, 0, Number.MAX_SAFE_INTEGER, createdAt) : null,
    });
  }
  return requests;
}

function pruneDone(list) {
  const done = list.filter((item) => item.status === 'done');
  if (done.length <= MAX_HISTORY) return list;
  const keep = new Set(done.sort((a, b) => b.resolvedAt - a.resolvedAt).slice(0, MAX_HISTORY).map((item) => item.id));
  return list.filter((item) => item.status === 'pending' || keep.has(item.id));
}

function normalizeMessages(raw, members) {
  const index = new Map(members.map((m) => [m.id, m]));
  const list = Array.isArray(raw) ? raw : [];
  const messages = [];
  for (const entry of list) {
    const status = entry?.status === 'done' ? 'done' : 'pending';
    const memberId = text(entry?.memberId, '', 32);
    if (status === 'pending' && !index.has(memberId)) continue;
    const body = text(entry?.text, '', MAX_MESSAGE_LENGTH);
    if (!body) continue;
    const createdAt = clamp(entry?.createdAt, 0, Number.MAX_SAFE_INTEGER, Date.now());
    messages.push({
      id: text(entry?.id, '', 32) || newId(),
      from: entry?.from === 'admin' ? 'admin' : 'member',
      memberId,
      memberName: text(entry?.memberName, index.get(memberId)?.name ?? 'Unknown'),
      text: body,
      status,
      createdAt,
      resolvedAt: status === 'done' ? clamp(entry?.resolvedAt, 0, Number.MAX_SAFE_INTEGER, createdAt) : null,
    });
  }
  return messages;
}

/**
 * In-memory show state. Every mutation bumps `rev` and notifies subscribers
 * with a fresh snapshot, which is what the server pushes down the SSE stream.
 */
export class Store {
  #listeners = new Set();

  constructor(initial = {}) {
    this.rev = clamp(initial.rev, 1, Number.MAX_SAFE_INTEGER, 1);
    this.show = { name: text(initial.show?.name, 'FixMyMix', 60), messaging: initial.show?.messaging === true };
    this.members = normalizeMembers(initial.members);
    this.requests = normalizeRequests(initial.requests, this.members);
    this.messages = normalizeMessages(initial.messages, this.members);
  }

  subscribe(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  snapshot() {
    return {
      rev: this.rev,
      show: { ...this.show },
      members: this.members.map((m) => ({
        id: m.id,
        name: m.name,
        icon: m.icon,
        channels: m.channels.map((c) => ({ ...c })),
      })),
      requests: this.requests.map((r) => ({ ...r })),
      messages: this.messages.map((m) => ({ ...m })),
    };
  }

  pending() {
    return this.requests.filter((r) => r.status === 'pending');
  }

  pendingMessages() {
    return this.messages.filter((m) => m.status === 'pending');
  }

  #commit() {
    this.rev += 1;
    const snapshot = this.snapshot();
    for (const listener of this.#listeners) listener(snapshot);
    return snapshot;
  }

  #member(memberId) {
    const member = this.members.find((m) => m.id === memberId);
    if (!member) throw new StoreError('unknown_member', 'That performer is no longer in the roster.');
    return member;
  }

  #prune() {
    this.requests = pruneDone(this.requests);
    this.messages = pruneDone(this.messages);
  }

  setShowName(name) {
    return this.setShow({ name });
  }

  setShow({ name, messaging } = {}) {
    if (name !== undefined) this.show.name = text(name, 'FixMyMix', 60);
    if (messaging !== undefined) this.show.messaging = messaging === true;
    return this.#commit();
  }

  /**
   * Replaces the roster. Members and channels keep their ids where supplied, so
   * renaming during a set does not orphan the requests already on the board.
   */
  setRoster(members) {
    this.members = normalizeMembers(members);
    const index = new Map(this.members.map((m) => [m.id, m]));
    this.requests = this.requests.filter((request) => {
      if (request.status === 'done') return true;
      const member = index.get(request.memberId);
      const channel = member?.channels.find((c) => c.id === request.channelId);
      if (!channel) return false;
      request.memberName = member.name;
      request.channelName = channel.name;
      request.channelIcon = channel.icon;
      return true;
    });
    this.messages = this.messages.filter((message) => {
      if (message.status === 'done') return true;
      const member = index.get(message.memberId);
      if (!member) return false;
      message.memberName = member.name;
      return true;
    });
    return this.#commit();
  }

  quickSetup(memberCount, channelCount) {
    return this.setRoster(buildRoster(memberCount, channelCount));
  }

  /**
   * A repeat tap in the same direction escalates the existing request rather
   * than stacking a second card on the engineer's board; the opposite direction
   * replaces it, because the performer has changed their mind.
   */
  submitRequest({ memberId, channelId, direction }) {
    const member = this.#member(memberId);
    const channel = member.channels.find((c) => c.id === channelId);
    if (!channel) throw new StoreError('unknown_channel', 'That channel is no longer in your mix.');
    if (!DIRECTIONS.has(direction)) throw new StoreError('bad_direction', 'Request must be "more" or "less".');

    const now = Date.now();
    const existing = this.requests.find(
      (r) => r.status === 'pending' && r.memberId === member.id && r.channelId === channel.id,
    );

    let request;
    if (existing) {
      if (existing.direction === direction) {
        existing.count = Math.min(existing.count + 1, MAX_COUNT);
      } else {
        existing.direction = direction;
        existing.count = 1;
      }
      existing.memberName = member.name;
      existing.channelName = channel.name;
      existing.channelIcon = channel.icon;
      existing.updatedAt = now;
      request = existing;
    } else {
      request = {
        id: newId(),
        memberId: member.id,
        memberName: member.name,
        channelId: channel.id,
        channelName: channel.name,
        channelIcon: channel.icon,
        direction,
        count: 1,
        status: 'pending',
        createdAt: now,
        updatedAt: now,
        resolvedAt: null,
      };
      this.requests.push(request);
    }
    this.#commit();
    return { ...request };
  }

  cancelRequest({ memberId, requestId }) {
    const index = this.requests.findIndex(
      (r) => r.id === requestId && r.status === 'pending' && r.memberId === memberId,
    );
    if (index === -1) throw new StoreError('unknown_request', 'That request has already been handled.');
    const [removed] = this.requests.splice(index, 1);
    this.#commit();
    return { ...removed };
  }

  resolveRequest(requestId) {
    const request = this.requests.find((r) => r.id === requestId && r.status === 'pending');
    if (!request) throw new StoreError('unknown_request', 'That request has already been handled.');
    request.status = 'done';
    request.resolvedAt = Date.now();
    this.#prune();
    this.#commit();
    return { ...request };
  }

  resolveMember(memberId) {
    const member = this.#member(memberId);
    return this.#resolveMany((r) => r.memberId === member.id);
  }

  resolveAll() {
    return this.#resolveMany(() => true);
  }

  #resolveMany(match) {
    const now = Date.now();
    const resolved = [];
    for (const request of this.requests) {
      if (request.status !== 'pending' || !match(request)) continue;
      request.status = 'done';
      request.resolvedAt = now;
      resolved.push({ ...request });
    }
    for (const message of this.messages) {
      if (message.status !== 'pending' || message.from !== 'member' || !match(message)) continue;
      message.status = 'done';
      message.resolvedAt = now;
      resolved.push({ ...message });
    }
    if (resolved.length) {
      this.#prune();
      this.#commit();
    }
    return resolved;
  }

  #newMessage(from, member, body) {
    const now = Date.now();
    const message = {
      id: newId(),
      from,
      memberId: member.id,
      memberName: member.name,
      text: body,
      status: 'pending',
      createdAt: now,
      resolvedAt: null,
    };
    this.messages.push(message);
    return message;
  }

  #messageText(value) {
    const body = text(value, '', MAX_MESSAGE_LENGTH);
    if (!body) throw new StoreError('empty_message', 'Type a message first.');
    return body;
  }

  /** A performer writes to the desk. Off unless the admin has enabled messaging. */
  sendMemberMessage({ memberId, text: value }) {
    if (!this.show.messaging) throw new StoreError('messaging_off', 'Messages are switched off for this show.');
    const member = this.#member(memberId);
    const message = this.#newMessage('member', member, this.#messageText(value));
    this.#commit();
    return { ...message };
  }

  /** The desk writes to one performer, or to everyone (one message each). */
  sendAdminMessage({ memberId, all = false, text: value }) {
    if (!this.show.messaging) throw new StoreError('messaging_off', 'Messages are switched off for this show.');
    const body = this.#messageText(value);
    const targets = all ? this.members : [this.#member(memberId)];
    const sent = targets.map((member) => ({ ...this.#newMessage('admin', member, body) }));
    if (sent.length) this.#commit();
    return sent;
  }

  /** Admin has read a performer's message. */
  resolveMessage(messageId) {
    const message = this.messages.find((m) => m.id === messageId && m.status === 'pending' && m.from === 'member');
    if (!message) throw new StoreError('unknown_message', 'That message has already been handled.');
    message.status = 'done';
    message.resolvedAt = Date.now();
    this.#prune();
    this.#commit();
    return { ...message };
  }

  /** A performer has read the desk's message. */
  ackMessage({ memberId, messageId }) {
    const message = this.messages.find((m) => m.id === messageId && m.status === 'pending' && m.from === 'admin' && m.memberId === memberId);
    if (!message) throw new StoreError('unknown_message', 'That message has already been handled.');
    message.status = 'done';
    message.resolvedAt = Date.now();
    this.#prune();
    this.#commit();
    return { ...message };
  }

  clearHistory() {
    const before = this.requests.length + this.messages.length;
    this.requests = this.requests.filter((r) => r.status === 'pending');
    this.messages = this.messages.filter((m) => m.status === 'pending');
    if (this.requests.length + this.messages.length !== before) this.#commit();
    return this.snapshot();
  }
}
