import { watchState, post, toast, el, vibrate, ago, keepScreenAwake, wakeLockSupported } from './net.js';
import { glyph } from './icons.js';
import { createMidi, renderMidiPanel } from './midi.js';

const withGlyph = (item) => (glyph(item.icon) ? `${glyph(item.icon)} ${item.name}` : item.name);

const MEMBER_KEY = 'fixmymix.memberId';
const SETTINGS_KEY = 'fixmymix.settings';
const CONFIRM_MS = 8000;
const DEFAULT_SETTINGS = { autoDismiss: true, layout: 'rows', keepAwake: true, swipe: true };
// A flick: at least this far, mostly vertical, and quick — slower drags scroll.
const SWIPE_MIN_PX = 40;
// A flick is decided by time alone: a real one on a phone easily travels
// 200 px or more, so distance must never disqualify it. Once a touch has
// lasted longer than this it is a drag, and the page follows the finger.
const SWIPE_MAX_MS = 600;
const LAYOUTS = new Set(['rows', 'boxes']);

const ui = {
  title: document.getElementById('title'),
  who: document.getElementById('who'),
  status: document.getElementById('status'),
  switchBtn: document.getElementById('switch'),
  settingsBtn: document.getElementById('settingsBtn'),
  settings: document.getElementById('settings'),
  autoDismiss: document.getElementById('autoDismiss'),
  keepAwake: document.getElementById('keepAwake'),
  swipe: document.getElementById('swipe'),
  keepAwakeHint: document.getElementById('keepAwakeHint'),
  layoutInputs: document.querySelectorAll('input[name="layout"]'),
  offline: document.getElementById('offline'),
  picker: document.getElementById('picker'),
  members: document.getElementById('members'),
  mix: document.getElementById('mix'),
  channels: document.getElementById('channels'),
  hint: document.getElementById('hint'),
  deskMessages: document.getElementById('deskMessages'),
  buzzOverlay: document.getElementById('buzzOverlay'),
  buzzMessages: document.getElementById('buzzMessages'),
  myMessages: document.getElementById('myMessages'),
  composer: document.getElementById('composer'),
  messageText: document.getElementById('messageText'),
  midiPanel: document.getElementById('midiPanel'),
};

let state = null;
let memberId = readStored(MEMBER_KEY, null);
let settings = { ...DEFAULT_SETTINGS, ...(readStored(SETTINGS_KEY, {}) ?? {}) };
if (!LAYOUTS.has(settings.layout)) settings.layout = 'rows';
let settingsOpen = false;
// Requests this device has seen pending; when one flips to done we confirm it.
const knownPending = new Set();
// channelId -> { until, request } for the green "done" state. `until` is
// Infinity when confirmations stay until tapped.
const confirmations = new Map();
// The same idea for messages I sent: messageId -> { until }.
const knownPendingMessages = new Set();
const messageConfirmations = new Map();
// Desk messages already buzzed for, so a re-render doesn't buzz again.
const seenDeskMessages = new Set();

const confirmUntil = () => (settings.autoDismiss ? Date.now() + CONFIRM_MS : Infinity);
// Channels whose tap is being retried after a Wi-Fi blip ("Sending…").
const sendingRetry = new Set();
let stream = null;

// MIDI drives a highlighted channel: next/prev move it, up/down arm a
// direction, confirm sends. Only drawn once a controller is bound.
let cursor = 0;
let armed = null;
const MIDI_LABELS = {
  up: { title: 'Up', hint: 'Arm “more” on the highlighted channel' },
  down: { title: 'Down', hint: 'Arm “less” on the highlighted channel' },
  next: { title: 'Next channel', hint: 'Move the highlight down' },
  prev: { title: 'Previous channel', hint: 'Move the highlight up' },
  confirm: { title: 'Confirm / send', hint: 'Send what is armed, or answer a message' },
};
const midi = createMidi({
  actions: Object.keys(MIDI_LABELS),
  storageKey: 'fixmymix.midi.stage',
  onAction: (action) => midiAction(action),
  onChange: () => render(),
});

function midiAction(action) {
  const member = currentMember();
  if (!member || !member.channels.length) return;
  const count = member.channels.length;
  if (overlayOpen()) {
    const buzzed = state.messages.find((m) => m.memberId === member.id && m.from === 'admin' && m.status === 'pending' && m.buzz);
    if (action === 'confirm' && buzzed) act(() => post('/api/messages/ack', { memberId: member.id, messageId: buzzed.id }));
    return;
  }
  if (action === 'next' || action === 'prev') {
    cursor = (cursor + (action === 'next' ? 1 : count - 1)) % count;
    armed = null;
  } else if (action === 'up' || action === 'down') {
    armed = action === 'up' ? 'more' : 'less';
  } else if (action === 'confirm') {
    const channel = member.channels[cursor];
    const fromDesk = state.messages.find((m) => m.memberId === member.id && m.from === 'admin' && m.status === 'pending');
    if (armed && channel) {
      const direction = armed;
      armed = null;
      confirmations.delete(channel.id);
      act(() => post('/api/requests', { memberId: member.id, channelId: channel.id, direction }));
    } else if (fromDesk) {
      act(() => post('/api/messages/ack', { memberId: member.id, messageId: fromDesk.id }));
    } else if (channel && confirmations.has(channel.id)) {
      confirmations.delete(channel.id);
    } else {
      confirmations.clear();
      messageConfirmations.clear();
    }
  }
  render();
  document.querySelector('.cursor')?.scrollIntoView({ block: 'nearest' });
}

function readStored(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return key === SETTINGS_KEY ? JSON.parse(raw) : raw;
  } catch {
    return fallback;
  }
}

function writeStored(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
  } catch {
    // Private mode; the choice just lasts until reload.
  }
}

function saveMember(id) {
  memberId = id;
  writeStored(MEMBER_KEY, id);
  // The stream announces who this device is (presence on the board).
  stream?.reconnect();
}

function currentMember() {
  return state?.members.find((m) => m.id === memberId) ?? null;
}

function trackConfirmations(member) {
  const mine = state.requests.filter((r) => r.memberId === member.id);
  const now = Date.now();
  let vibrated = false;
  for (const request of mine) {
    if (request.status === 'pending') {
      knownPending.add(request.id);
    } else if (knownPending.has(request.id)) {
      knownPending.delete(request.id);
      confirmations.set(request.channelId, { until: confirmUntil(), request });
      if (!vibrated) {
        vibrate([120, 60, 120]);
        vibrated = true;
      }
    }
  }
  // Requests cancelled or dropped by a roster change vanish without becoming done.
  const live = new Set(mine.map((r) => r.id));
  for (const id of knownPending) if (!live.has(id)) knownPending.delete(id);
}

function dismiss(channelId) {
  if (!confirmations.delete(channelId)) return;
  render();
}

// "· 12s ago" next to a confirmation, ticked in place by the interval below.
function sinceLabel(resolvedAt) {
  return el('span', { class: 'since', 'data-resolved': resolvedAt, text: ` · ${ago(resolvedAt)} ago` });
}

function dismissMessage(messageId) {
  if (!messageConfirmations.delete(messageId)) return;
  render();
}

function messageCard(kind, from, body, trailing) {
  return el('div', { class: `msg ${kind}` }, [
    el('div', { class: 'msg-text' }, [el('span', { class: 'msg-from', text: from }), body]),
    trailing,
  ]);
}

function renderMessages(member) {
  const mine = state.messages.filter((m) => m.memberId === member.id);
  const now = Date.now();

  // Desk → me: needs a "Got it". A message sent with buzz takes over the
  // screen (and vibrates harder) until it is dismissed; the rest sit above
  // the channels.
  const fromDesk = mine.filter((m) => m.from === 'admin' && m.status === 'pending');
  let fresh = false;
  let freshBuzz = false;
  for (const m of fromDesk) {
    if (!seenDeskMessages.has(m.id)) {
      seenDeskMessages.add(m.id);
      if (m.buzz) freshBuzz = true; else fresh = true;
    }
  }
  if (freshBuzz) buzz({ quiet: true });
  else if (fresh) vibrate([200, 80, 200]);
  const gotIt = (m) => el('button', { type: 'button', class: 'done-btn', text: 'Got it', onclick: () => act(() => post('/api/messages/ack', { memberId: member.id, messageId: m.id })) });
  ui.deskMessages.replaceChildren(
    ...fromDesk.filter((m) => !m.buzz).map((m) => messageCard('desk', 'From the desk', m.text, gotIt(m))),
  );
  const buzzed = fromDesk.filter((m) => m.buzz);
  ui.buzzMessages.replaceChildren(...buzzed.map((m) => messageCard('desk buzzed', 'Buzz', m.text, gotIt(m))));
  setOverlay(buzzed.length > 0);

  // Me → desk: Sent, then Seen ✓ once the desk clears it.
  let vibrated = false;
  for (const m of mine) {
    if (m.from !== 'member') continue;
    if (m.status === 'pending') {
      knownPendingMessages.add(m.id);
    } else if (knownPendingMessages.has(m.id)) {
      knownPendingMessages.delete(m.id);
      messageConfirmations.set(m.id, { until: confirmUntil() });
      if (!vibrated) {
        vibrate([120, 60, 120]);
        vibrated = true;
      }
    }
  }
  const live = new Set(mine.map((m) => m.id));
  for (const id of knownPendingMessages) if (!live.has(id)) knownPendingMessages.delete(id);

  const outgoing = mine.filter((m) => m.from === 'member' && (m.status === 'pending' || messageConfirmations.get(m.id)?.until > now));
  ui.myMessages.replaceChildren(
    ...outgoing.map((m) => {
      const seen = m.status === 'done';
      const stateLine = el('div', { class: 'state' }, seen ? ['Seen ✓', sinceLabel(m.resolvedAt)] : ['Sent']);
      if (seen && !settings.autoDismiss) {
        stateLine.append(el('button', { type: 'button', class: 'cancel ok', text: 'OK', onclick: (e) => { e.stopPropagation(); dismissMessage(m.id); } }));
      }
      const card = messageCard(`mine ${seen ? 'done' : 'pending'}`, 'You', m.text, stateLine);
      if (seen) card.addEventListener('click', () => dismissMessage(m.id));
      return card;
    }),
  );
}

function renderPicker() {
  ui.picker.classList.remove('hidden');
  ui.mix.classList.add('hidden');
  ui.switchBtn.classList.add('hidden');
  ui.who.textContent = 'Pick your name';
  ui.members.replaceChildren(
    ...state.members.map((m) =>
      el('button', { type: 'button', text: withGlyph(m), onclick: () => { saveMember(m.id); render(); } }),
    ),
  );
}

const HINTS = {
  rows: {
    auto: 'Tap − or + (or flick up or down) to ask for less or more. Tap again to push harder. The row turns green when it\'s been done.',
    sticky: 'Tap − or + (or flick up or down) to ask for less or more. Tap again to push harder. The row turns green when it\'s been done; tap it to clear.',
  },
  boxes: {
    auto: 'Tap the top of a box for more, the bottom for less, or flick up or down. Tap again to push harder. The box turns green when it\'s been done.',
    sticky: 'Tap the top of a box for more, the bottom for less, or flick up or down. Tap again to push harder. The box turns green when it\'s been done; tap it to clear.',
  },
};

/** Everything a channel's row or box needs to draw itself, independent of layout. */
function channelView(member, channel, pending, confirmed) {
  const showDone = Boolean(confirmed && confirmed.until > Date.now() && !pending);
  const stateLine = el('div', { class: 'state' });
  if (showDone) {
    stateLine.append(`Done ✓ ${confirmed.request.direction === 'more' ? 'turned up' : 'turned down'}`, sinceLabel(confirmed.request.resolvedAt));
    if (!settings.autoDismiss) {
      stateLine.append(el('button', { type: 'button', class: 'cancel ok', text: 'OK', onclick: (e) => { e.stopPropagation(); dismiss(channel.id); } }));
    }
  } else if (pending) {
    stateLine.append(
      `Sent: ${pending.direction === 'more' ? 'more' : 'less'}${pending.count > 1 ? ` ×${pending.count}` : ''}`,
      el('button', {
        type: 'button', class: 'cancel', text: 'cancel',
        onclick: (e) => { e.stopPropagation(); act(() => post('/api/requests/cancel', { memberId: member.id, requestId: pending.id })); },
      }),
    );
  }
  const send = (direction) => (event) => {
    event.stopPropagation();
    sendRequest(member, channel, direction);
  };
  const badge = (direction) => (pending?.direction === direction ? el('span', { class: 'count', text: `×${pending.count}` }) : null);
  if (sendingRetry.has(channel.id) && !pending && !showDone) {
    stateLine.replaceChildren(el('span', { class: 'sending', text: 'Sending…' }));
  }
  const isCursor = midi.active() && member.channels[cursor] === channel;
  if (isCursor && armed) {
    stateLine.replaceChildren(el('span', { class: 'armed', text: `${armed === 'more' ? '▲ More' : '▼ Less'} armed — confirm to send` }));
  }
  const stateClass = `${showDone ? ' done' : pending ? ' pending' : ''}${isCursor ? ' cursor' : ''}`;
  const label = (direction) => `${direction === 'more' ? 'More' : 'Less'} ${channel.name}`;
  return { channel, showDone, stateLine, send, badge, stateClass, label };
}

function sendRequest(member, channel, direction) {
  confirmations.delete(channel.id);
  act(() => post('/api/requests', { memberId: member.id, channelId: channel.id, direction }, {
    onRetry: () => { sendingRetry.add(channel.id); render(); },
  }).finally(() => { if (sendingRetry.delete(channel.id)) render(); }));
}

function renderRow(view) {
  const tap = (direction, text) =>
    el('button', { type: 'button', class: `tap ${direction}`, 'aria-label': view.label(direction), onclick: view.send(direction) }, [text, view.badge(direction)]);
  const row = el('div', { class: `channel${view.stateClass}`, 'data-channel': view.channel.id }, [
    el('div', {}, [el('div', { class: 'name', text: withGlyph(view.channel) }), view.stateLine]),
    tap('less', '−'),
    tap('more', '+'),
  ]);
  if (view.showDone) row.addEventListener('click', () => dismiss(view.channel.id));
  return row;
}

function renderBox(view) {
  const half = (direction, arrow, position) =>
    el('button', { type: 'button', class: `half ${position}${view.badge(direction) ? ' active' : ''}`, 'aria-label': view.label(direction), onclick: view.send(direction) }, [arrow, view.badge(direction)]);
  const box = el('div', { class: `box${view.stateClass}`, 'data-channel': view.channel.id }, [
    half('more', '▲', 'up'),
    el('div', { class: 'middle' }, [el('div', { class: 'name', text: withGlyph(view.channel) }), view.stateLine]),
    half('less', '▼', 'down'),
  ]);
  if (view.showDone) box.addEventListener('click', () => dismiss(view.channel.id));
  return box;
}

function renderChannels(member) {
  ui.picker.classList.add('hidden');
  ui.mix.classList.remove('hidden');
  ui.switchBtn.classList.remove('hidden');
  ui.who.textContent = withGlyph(member);
  ui.hint.textContent = HINTS[settings.layout][settings.autoDismiss ? 'auto' : 'sticky'];

  const pendingByChannel = new Map(
    state.requests.filter((r) => r.status === 'pending' && r.memberId === member.id).map((r) => [r.channelId, r]),
  );
  if (cursor >= member.channels.length) cursor = 0;
  const views = member.channels.map((channel) => channelView(member, channel, pendingByChannel.get(channel.id), confirmations.get(channel.id)));
  ui.channels.className = `${settings.layout === 'boxes' ? 'boxes' : ''}${settings.swipe ? ' swipe' : ''}`.trim();
  // Rows read best in a narrow column; boxes want the whole width on a tablet.
  document.querySelector('main').classList.toggle('narrow', settings.layout !== 'boxes');
  ui.channels.replaceChildren(...views.map(settings.layout === 'boxes' ? renderBox : renderRow));
}

async function act(fn) {
  try {
    await fn();
  } catch (error) {
    toast(error.message, { error: true });
  }
}

function render() {
  if (!state) return;
  ui.title.textContent = state.show.name;
  document.title = `${state.show.name} · Stage`;
  ui.settings.classList.toggle('hidden', !settingsOpen);
  if (settingsOpen) renderMidiPanel(ui.midiPanel, midi, MIDI_LABELS);
  ui.autoDismiss.checked = settings.autoDismiss;
  ui.keepAwake.checked = settings.keepAwake;
  ui.swipe.checked = settings.swipe;
  for (const input of ui.layoutInputs) input.checked = input.value === settings.layout;
  const member = currentMember();
  if (!member) {
    if (memberId) saveMember(null);
    setOverlay(false);
    renderPicker();
    ui.composer.classList.add('hidden');
    document.body.classList.remove('has-composer');
    return;
  }
  trackConfirmations(member);
  renderChannels(member);
  renderMessages(member);
  const composer = Boolean(state.show.messaging);
  ui.composer.classList.toggle('hidden', !composer);
  document.body.classList.toggle('has-composer', composer);
}

ui.switchBtn.addEventListener('click', () => {
  saveMember(null);
  render();
});

ui.settingsBtn.addEventListener('click', () => {
  settingsOpen = !settingsOpen;
  ui.settingsBtn.setAttribute('aria-expanded', String(settingsOpen));
  render();
});

ui.autoDismiss.addEventListener('change', () => {
  settings.autoDismiss = ui.autoDismiss.checked;
  writeStored(SETTINGS_KEY, settings);
  // Apply to anything already on screen so the toggle is felt immediately.
  const now = Date.now();
  for (const entry of [...confirmations.values(), ...messageConfirmations.values()]) {
    entry.until = settings.autoDismiss ? Math.min(entry.until, now + CONFIRM_MS) : Infinity;
  }
  render();
});

ui.swipe.addEventListener('change', () => {
  settings.swipe = ui.swipe.checked;
  writeStored(SETTINGS_KEY, settings);
  render();
});

// Swipe on a channel row or box: a quick flick up sends "more", down "less".
// With swiping on, the channels carry touch-action: none, so the browser
// never turns a flick into a scroll (or a pull-to-refresh). Scrolling a long
// list still works: a touch that outlasts the flick window, or travels
// further than a flick, becomes a drag and the page follows the finger.
let touchStart = null;
ui.channels.addEventListener('touchstart', (event) => {
  if (!settings.swipe || overlayOpen() || event.touches.length !== 1) return;
  const target = event.target.closest('[data-channel]');
  if (!target) return;
  const touch = event.touches[0];
  touchStart = { channelId: target.dataset.channel, x: touch.clientX, y: touch.clientY, lastY: touch.clientY, at: Date.now(), dragging: false };
}, { passive: true });
ui.channels.addEventListener('touchmove', (event) => {
  const start = touchStart;
  if (!start || event.touches.length !== 1) return;
  const touch = event.touches[0];
  if (!start.dragging && Date.now() - start.at > SWIPE_MAX_MS) {
    start.dragging = true;
    start.lastY = touch.clientY;
  }
  if (start.dragging) {
    window.scrollBy(0, start.lastY - touch.clientY);
    start.lastY = touch.clientY;
  }
}, { passive: true });
ui.channels.addEventListener('touchend', (event) => {
  const start = touchStart;
  touchStart = null;
  if (!start || start.dragging || !settings.swipe) return;
  const touch = event.changedTouches[0];
  const dx = touch.clientX - start.x;
  const dy = touch.clientY - start.y;
  if (Date.now() - start.at > SWIPE_MAX_MS || Math.abs(dy) < SWIPE_MIN_PX || Math.abs(dy) < Math.abs(dx) * 1.5) return;
  const member = currentMember();
  const channel = member?.channels.find((c) => c.id === start.channelId);
  if (!channel) return;
  const direction = dy < 0 ? 'more' : 'less';
  vibrate(30);
  const element = ui.channels.querySelector(`[data-channel="${channel.id}"]`);
  element?.classList.add(`swiped-${direction}`);
  setTimeout(() => element?.classList.remove(`swiped-${direction}`), 350);
  sendRequest(member, channel, direction);
}, { passive: true });
ui.channels.addEventListener('touchcancel', () => { touchStart = null; }, { passive: true });

ui.keepAwake.addEventListener('change', () => {
  settings.keepAwake = ui.keepAwake.checked;
  writeStored(SETTINGS_KEY, settings);
  keepScreenAwake(settings.keepAwake);
});
if (!wakeLockSupported()) {
  ui.keepAwake.disabled = true;
  ui.keepAwakeHint.textContent = 'Not available in this browser — turn off Auto-Lock in the phone\'s settings for the show instead.';
}
keepScreenAwake(settings.keepAwake);

ui.composer.addEventListener('submit', (event) => {
  event.preventDefault();
  const member = currentMember();
  const text = ui.messageText.value.trim();
  if (!member || !text) return;
  const button = ui.composer.querySelector('button');
  act(async () => {
    await post('/api/messages', { memberId: member.id, text }, { onRetry: () => { button.textContent = 'Sending…'; } });
    ui.messageText.value = '';
  }).finally(() => { button.textContent = 'Send'; });
});

// The desk's "buzz": vibrate and flash so the whole band can be checked at once.
let flashTimer = null;
function buzz({ quiet = false } = {}) {
  vibrate([300, 100, 300, 100, 300]);
  document.body.classList.add('flash');
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => document.body.classList.remove('flash'), 1800);
  if (!quiet) toast('The desk is buzzing you 👋');
}

// While a buzzed message is up, the channels (and the rest of the page) are
// inert: the performer has to dismiss it first.
function overlayOpen() {
  return !ui.buzzOverlay.classList.contains('hidden');
}
function setOverlay(open) {
  if (open === overlayOpen()) return;
  ui.buzzOverlay.classList.toggle('hidden', !open);
  document.body.classList.toggle('modal', open);
  for (const node of document.body.children) {
    if (node === ui.buzzOverlay || node.tagName === 'SCRIPT') continue;
    if (open) node.setAttribute('inert', ''); else node.removeAttribute('inert');
  }
  if (open) ui.buzzMessages.querySelector('button')?.focus();
}

for (const input of ui.layoutInputs) {
  input.addEventListener('change', () => {
    if (!input.checked || !LAYOUTS.has(input.value)) return;
    settings.layout = input.value;
    writeStored(SETTINGS_KEY, settings);
    render();
  });
}

// A device with bindings saved is a MIDI device: connect on load (the browser
// remembers the permission), so the controller works without opening settings.
if (Object.keys(midi.bindings()).length) midi.connect();

stream = watchState({
  url: () => (memberId ? `/api/stream?memberId=${encodeURIComponent(memberId)}` : '/api/stream'),
  onState: (snapshot) => {
    state = snapshot;
    render();
  },
  onStatus: (live) => {
    ui.status.classList.toggle('live', live);
    ui.offline.classList.toggle('hidden', live);
  },
  onEvent: (name) => {
    if (name === 'buzz') buzz();
  },
});

// Expire "done" flashes without waiting for the next server push, and keep
// the "ago" labels on the ones still showing current.
setInterval(() => {
  const now = Date.now();
  for (const label of document.querySelectorAll('.since[data-resolved]')) {
    label.textContent = ` · ${ago(Number(label.dataset.resolved))} ago`;
  }
  let changed = false;
  for (const map of [confirmations, messageConfirmations]) {
    for (const [key, entry] of map) {
      if (entry.until <= now) {
        map.delete(key);
        changed = true;
      }
    }
  }
  if (changed) render();
}, 1000);
