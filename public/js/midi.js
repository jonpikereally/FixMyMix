// Web MIDI "learn" for a handful of named actions. Bindings are per device
// (localStorage) because they belong to whatever controller is plugged into it.
//
// A binding fires on: note-on with velocity > 0, a CC crossing 64 upwards (so a
// foot switch sending 0/127 fires once per press), or any program change.

import { el } from './net.js';

const TYPES = { 0x9: 'note', 0xb: 'cc', 0xc: 'pc' };
const TYPE_LABELS = { note: 'Note', cc: 'CC', pc: 'Program' };

export function describeBinding(id) {
  if (!id) return 'Not set';
  const [type, channel, number] = id.split(':');
  return `${TYPE_LABELS[type] ?? type} ${number} · ch ${channel}`;
}

export function createMidi({ actions, storageKey, onAction, onChange = () => {} }) {
  const supported = typeof navigator !== 'undefined' && typeof navigator.requestMIDIAccess === 'function';
  const secure = typeof window !== 'undefined' && window.isSecureContext;
  let access = null;
  let learning = null;
  let bindings = load();
  const ccLevels = new Map();
  const state = { supported, secure, granted: false, inputs: 0, error: null, get learning() { return learning?.action ?? null; } };

  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(storageKey) ?? '{}');
      const out = {};
      for (const action of actions) if (typeof raw[action] === 'string') out[action] = raw[action];
      return out;
    } catch {
      return {};
    }
  }

  function save() {
    try {
      localStorage.setItem(storageKey, JSON.stringify(bindings));
    } catch {
      // Private mode; bindings last until reload.
    }
  }

  function attachInputs() {
    if (!access) return;
    for (const input of access.inputs.values()) input.onmidimessage = handle;
    state.inputs = access.inputs.size;
    onChange();
  }

  function handle(event) {
    const [status, d1, d2] = event.data;
    const type = TYPES[status >> 4];
    if (!type) return;
    const channel = (status & 0x0f) + 1;
    let fire = true;
    if (type === 'note') {
      fire = d2 > 0;
    } else if (type === 'cc') {
      const key = `${channel}:${d1}`;
      const was = ccLevels.get(key) ?? 0;
      ccLevels.set(key, d2);
      fire = d2 >= 64 && was < 64;
    }
    if (!fire) return;
    const id = `${type}:${channel}:${d1}`;
    if (learning) {
      bindings[learning.action] = id;
      save();
      const finished = learning;
      learning = null;
      finished.resolve(id);
      onChange();
      return;
    }
    for (const [action, bound] of Object.entries(bindings)) if (bound === id) onAction(action);
  }

  return {
    state,
    bindings: () => ({ ...bindings }),
    /** True once a controller can drive the page: permission granted and something is bound. */
    active: () => state.granted && Object.keys(bindings).length > 0,

    async connect() {
      if (access) return true;
      if (!supported) return false;
      try {
        access = await navigator.requestMIDIAccess();
        state.granted = true;
        state.error = null;
        access.onstatechange = attachInputs;
        attachInputs();
        return true;
      } catch (error) {
        state.error = error?.message || 'Permission refused';
        onChange();
        return false;
      }
    },

    /** Resolves with the binding id once the next control is pressed; null if cancelled. */
    async learn(action) {
      if (!(await this.connect())) return null;
      learning?.resolve(null);
      return new Promise((resolve) => {
        learning = { action, resolve };
        onChange();
      });
    },

    cancelLearn() {
      learning?.resolve(null);
      learning = null;
      onChange();
    },

    clear(action) {
      delete bindings[action];
      save();
      onChange();
    },
  };
}

/** Settings UI for one page's bindings; re-render by calling again with the same container. */
export function renderMidiPanel(container, midi, labels) {
  const { state } = midi;
  const bindings = midi.bindings();
  let status;
  if (!state.supported) {
    status = el('p', { class: 'muted small', text: 'This browser has no Web MIDI. Safari (and every browser on iPhone/iPad) cannot do MIDI; use Chrome, Edge or Firefox on a laptop or Android.' });
  } else if (!state.secure) {
    status = el('p', { class: 'muted small', text: 'Browsers only allow MIDI on a secure page. On the computer running FixMyMix open http://localhost; on another laptop use the https:// address shown in the FixMyMix menu (accept the certificate once).' });
  } else if (state.error) {
    status = el('p', { class: 'small warn', text: `MIDI permission refused: ${state.error}` });
  } else if (!state.granted) {
    status = el('div', { class: 'row' }, [
      el('button', { type: 'button', class: 'ghost', text: 'Enable MIDI', onclick: () => midi.connect() }),
      el('span', { class: 'muted small', text: 'Your browser will ask for permission.' }),
    ]);
  } else {
    status = el('p', { class: 'muted small', text: state.inputs ? `Connected · ${state.inputs} input${state.inputs === 1 ? '' : 's'}` : 'Connected · no MIDI inputs found — plug a controller in.' });
  }

  const rows = Object.entries(labels).map(([action, label]) => {
    const isLearning = state.learning === action;
    return el('div', { class: `midi-row${isLearning ? ' learning' : ''}`, 'data-action': action }, [
      el('div', { class: 'midi-label' }, [el('strong', { text: label.title }), el('span', { class: 'muted small', text: label.hint })]),
      el('span', { class: 'midi-binding', text: isLearning ? 'Press a control…' : describeBinding(bindings[action]) }),
      isLearning
        ? el('button', { type: 'button', class: 'ghost compact', text: 'Cancel', onclick: () => midi.cancelLearn() })
        : el('button', { type: 'button', class: 'ghost compact', text: 'Learn', disabled: state.supported && state.secure ? null : 'disabled', onclick: () => midi.learn(action) }),
      el('button', { type: 'button', class: 'ghost compact', text: '×', 'aria-label': `Clear ${label.title}`, disabled: bindings[action] ? null : 'disabled', onclick: () => midi.clear(action) }),
    ]);
  });

  container.replaceChildren(status, ...rows);
}
