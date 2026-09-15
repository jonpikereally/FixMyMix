// Saved band setups: a named copy of the roster and show settings that can be
// brought back for the next gig, exported as a JSON file, and imported again
// (on this laptop or another). Kept apart from the live show state so
// performers' devices never receive them.

import { normalizeMembers, StoreError, newId } from './state.js';

export const MAX_SETUPS = 50;
export const SETUP_FORMAT = 1;
const MAX_NAME = 60;

function name(value, fallback) {
  const out = String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
  return out || fallback;
}

function showSettings(raw) {
  return {
    name: name(raw?.name, 'FixMyMix'),
    messaging: raw?.messaging === true,
    buzzDefault: raw?.buzzDefault === true,
  };
}

/** Everything a setup file carries; also the shape used in memory. */
export function packSetup({ id, name: label, savedAt, show, members }) {
  return {
    app: 'FixMyMix',
    format: SETUP_FORMAT,
    id,
    name: label,
    savedAt,
    show: showSettings(show),
    members: normalizeMembers(members),
  };
}

/** Reads a setup from user-supplied JSON (a file, or an older/foreign shape). */
export function parseSetup(raw, { fallbackName = 'Imported setup' } = {}) {
  if (!raw || typeof raw !== 'object') throw new StoreError('bad_setup', 'That is not a FixMyMix setup file.');
  const members = normalizeMembers(raw.members);
  if (!members.length) throw new StoreError('bad_setup', 'That file has no band members in it.');
  return packSetup({
    id: typeof raw.id === 'string' && /^[\w-]{1,32}$/.test(raw.id) ? raw.id : newId(),
    name: name(raw.name, fallbackName),
    savedAt: Number.isFinite(Number(raw.savedAt)) ? Number(raw.savedAt) : Date.now(),
    show: raw.show,
    members,
  });
}

export function setupFilename(label) {
  const slug = String(label).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'setup';
  return `FixMyMix-${slug}.json`;
}

export class Setups {
  #listeners = new Set();

  constructor(initial = []) {
    const list = Array.isArray(initial) ? initial : [];
    this.items = [];
    for (const entry of list.slice(0, MAX_SETUPS)) {
      try {
        const setup = parseSetup(entry);
        if (!this.items.some((s) => s.id === setup.id)) this.items.push(setup);
      } catch {
        // Skip anything unreadable rather than lose the rest.
      }
    }
  }

  subscribe(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  snapshot() {
    return this.items.map((s) => ({ ...s, show: { ...s.show }, members: s.members.map((m) => ({ ...m, channels: m.channels.map((c) => ({ ...c })) })) }));
  }

  /** What the admin page lists: no member detail, just enough to choose one. */
  summaries() {
    return this.items
      .slice()
      .sort((a, b) => b.savedAt - a.savedAt)
      .map((s) => ({
        id: s.id,
        name: s.name,
        savedAt: s.savedAt,
        members: s.members.length,
        channels: s.members.reduce((n, m) => n + m.channels.length, 0),
      }));
  }

  get(id) {
    const setup = this.items.find((s) => s.id === id);
    if (!setup) throw new StoreError('unknown_setup', 'That setup is no longer saved.');
    return setup;
  }

  /** Saves under a name; the same name (case-insensitive) is overwritten in place. */
  save({ name: label, show, members }) {
    const setup = parseSetup({ name: label, show, members, savedAt: Date.now() }, { fallbackName: 'Untitled setup' });
    const existing = this.items.find((s) => s.name.toLowerCase() === setup.name.toLowerCase());
    if (existing) {
      setup.id = existing.id;
      this.items[this.items.indexOf(existing)] = setup;
    } else {
      if (this.items.length >= MAX_SETUPS) throw new StoreError('too_many_setups', `You can keep up to ${MAX_SETUPS} setups. Delete one first.`);
      this.items.push(setup);
    }
    this.#commit();
    return setup;
  }

  /** Adds a setup read from a file. A clashing id or name gets a fresh id / a "(2)" suffix. */
  import(raw, { fallbackName } = {}) {
    const setup = parseSetup(raw, { fallbackName });
    setup.savedAt = Date.now();
    if (this.items.some((s) => s.id === setup.id)) setup.id = newId();
    const base = setup.name;
    for (let n = 2; this.items.some((s) => s.name.toLowerCase() === setup.name.toLowerCase()); n++) setup.name = `${base} (${n})`.slice(0, MAX_NAME);
    if (this.items.length >= MAX_SETUPS) throw new StoreError('too_many_setups', `You can keep up to ${MAX_SETUPS} setups. Delete one first.`);
    this.items.push(setup);
    this.#commit();
    return setup;
  }

  remove(id) {
    const setup = this.get(id);
    this.items = this.items.filter((s) => s !== setup);
    this.#commit();
    return setup;
  }

  #commit() {
    const snapshot = this.snapshot();
    for (const listener of this.#listeners) listener(snapshot);
  }
}
