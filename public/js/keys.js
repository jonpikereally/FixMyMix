// Keyboard "learn" for the same named actions the MIDI module drives: press
// Learn, then a key (with any modifiers), and that key fires the action from
// then on. Bindings are per device (localStorage), like MIDI ones.
//
// While the focus is in a text field a bare key types as normal; only a
// binding with Ctrl, Alt or ⌘ fires there. Escape is never bindable: it
// cancels a learn in progress.

import { el } from './net.js';

const MODIFIERS = ['ctrl', 'alt', 'shift', 'meta'];
const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform ?? '');
const MODIFIER_LABELS = MAC
  ? { ctrl: '⌃', alt: '⌥', shift: '⇧', meta: '⌘' }
  : { ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift', meta: 'Win' };
const KEY_LABELS = { arrowup: '↑', arrowdown: '↓', arrowleft: '←', arrowright: '→', enter: 'Enter', space: 'Space', backspace: '⌫', delete: 'Del', tab: 'Tab', pageup: 'PgUp', pagedown: 'PgDn', home: 'Home', end: 'End' };

/** A stable id for a key press: "ctrl+shift+k", "arrowup", "numpad 1". */
export function keyId(event) {
  const code = event.code || '';
  let key;
  if (/^Key[A-Z]$/.test(code)) key = code.slice(3).toLowerCase();
  else if (/^Digit\d$/.test(code)) key = code.slice(5);
  else if (/^Numpad\d$/.test(code)) key = `numpad ${code.slice(6)}`;
  else if (/^F\d{1,2}$/.test(code)) key = code.toLowerCase();
  else key = (event.key === ' ' ? 'space' : String(event.key ?? '')).toLowerCase();
  if (!key || MODIFIERS.includes(key) || ['control', 'os', 'dead', 'unidentified', 'escape'].includes(key)) return null;
  const mods = [];
  if (event.ctrlKey) mods.push('ctrl');
  if (event.altKey) mods.push('alt');
  if (event.shiftKey) mods.push('shift');
  if (event.metaKey) mods.push('meta');
  return [...mods, key].join('+');
}

export function describeKey(id) {
  if (!id) return 'Not set';
  const parts = id.split('+');
  const key = parts.pop();
  const label = KEY_LABELS[key] ?? (key.length === 1 ? key.toUpperCase() : key.replace(/^numpad (\d)$/, 'Num $1').replace(/^f(\d+)$/, 'F$1'));
  return [...parts.map((m) => MODIFIER_LABELS[m] ?? m), label].join(MAC ? '' : '+');
}

function inTextField(target) {
  if (!target || !target.tagName) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable === true;
}

export function createKeys({ actions, storageKey, onAction, onChange = () => {} }) {
  let learning = null;
  let bindings = load();
  const state = { get learning() { return learning?.action ?? null; } };

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

  function handle(event) {
    if (event.repeat) return;
    if (learning) {
      if (event.key === 'Escape') {
        event.preventDefault();
        cancelLearn();
        return;
      }
      const id = keyId(event);
      if (!id) return;
      event.preventDefault();
      for (const [action, bound] of Object.entries(bindings)) if (bound === id && action !== learning.action) delete bindings[action];
      bindings[learning.action] = id;
      save();
      const finished = learning;
      learning = null;
      finished.resolve(id);
      onChange();
      return;
    }
    const id = keyId(event);
    if (!id) return;
    const withModifier = event.ctrlKey || event.altKey || event.metaKey;
    if (inTextField(event.target) && !withModifier) return;
    for (const [action, bound] of Object.entries(bindings)) {
      if (bound !== id) continue;
      event.preventDefault();
      onAction(action);
    }
  }

  function cancelLearn() {
    learning?.resolve(null);
    learning = null;
    onChange();
  }

  window.addEventListener('keydown', handle);

  return {
    state,
    bindings: () => ({ ...bindings }),
    active: () => Object.keys(bindings).length > 0,
    /** Resolves with the key id once the next key is pressed; null if cancelled. */
    learn(action) {
      learning?.resolve(null);
      return new Promise((resolve) => {
        learning = { action, resolve };
        onChange();
      });
    },
    cancelLearn,
    clear(action) {
      delete bindings[action];
      save();
      onChange();
    },
  };
}

/** Settings UI for one page's key bindings; re-render by calling again with the same container. */
export function renderKeysPanel(container, keys, labels) {
  const bindings = keys.bindings();
  const rows = Object.entries(labels).map(([action, label]) => {
    const isLearning = keys.state.learning === action;
    return el('div', { class: `midi-row keys-row${isLearning ? ' learning' : ''}`, 'data-action': action }, [
      el('div', { class: 'midi-label' }, [el('strong', { text: label.title }), el('span', { class: 'muted small', text: label.hint })]),
      el('span', { class: 'midi-binding', text: isLearning ? 'Press a key… (Esc cancels)' : describeKey(bindings[action]) }),
      isLearning
        ? el('button', { type: 'button', class: 'ghost compact', text: 'Cancel', onclick: () => keys.cancelLearn() })
        : el('button', { type: 'button', class: 'ghost compact', text: 'Learn', onclick: () => keys.learn(action) }),
      el('button', { type: 'button', class: 'ghost compact', text: '×', 'aria-label': `Clear ${label.title}`, disabled: bindings[action] ? null : 'disabled', onclick: () => keys.clear(action) }),
    ]);
  });
  container.replaceChildren(
    el('p', { class: 'muted small', text: 'Press Learn, then the key or key combination you want. Bare keys stay out of the way while you are typing in a box; add Ctrl, Alt or ⌘ to a shortcut if you want it to work there too.' }),
    ...rows,
  );
}
