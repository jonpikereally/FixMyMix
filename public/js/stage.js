import { watchState, post, toast, el, vibrate } from './net.js';

const MEMBER_KEY = 'fixmymix.memberId';
const SETTINGS_KEY = 'fixmymix.settings';
const CONFIRM_MS = 8000;
const DEFAULT_SETTINGS = { autoDismiss: true, layout: 'rows' };
const LAYOUTS = new Set(['rows', 'boxes']);

const ui = {
  title: document.getElementById('title'),
  who: document.getElementById('who'),
  status: document.getElementById('status'),
  switchBtn: document.getElementById('switch'),
  settingsBtn: document.getElementById('settingsBtn'),
  settings: document.getElementById('settings'),
  autoDismiss: document.getElementById('autoDismiss'),
  layoutInputs: document.querySelectorAll('input[name="layout"]'),
  offline: document.getElementById('offline'),
  picker: document.getElementById('picker'),
  members: document.getElementById('members'),
  mix: document.getElementById('mix'),
  channels: document.getElementById('channels'),
  hint: document.getElementById('hint'),
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
      confirmations.set(request.channelId, { until: settings.autoDismiss ? now + CONFIRM_MS : Infinity, request });
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

function renderPicker() {
  ui.picker.classList.remove('hidden');
  ui.mix.classList.add('hidden');
  ui.switchBtn.classList.add('hidden');
  ui.who.textContent = 'Pick your name';
  ui.members.replaceChildren(
    ...state.members.map((m) =>
      el('button', { type: 'button', text: m.name, onclick: () => { saveMember(m.id); render(); } }),
    ),
  );
}

const HINTS = {
  rows: {
    auto: 'Tap − or + to ask for less or more. Tap again to push harder. The row turns green when it\'s been done.',
    sticky: 'Tap − or + to ask for less or more. Tap again to push harder. The row turns green when it\'s been done; tap it to clear.',
  },
  boxes: {
    auto: 'Tap the top of a box for more, the bottom for less. Tap again to push harder. The box turns green when it\'s been done.',
    sticky: 'Tap the top of a box for more, the bottom for less. Tap again to push harder. The box turns green when it\'s been done; tap it to clear.',
  },
};

/** Everything a channel's row or box needs to draw itself, independent of layout. */
function channelView(member, channel, pending, confirmed) {
  const showDone = Boolean(confirmed && confirmed.until > Date.now() && !pending);
  const stateLine = el('div', { class: 'state' });
  if (showDone) {
    stateLine.append(`Done ✓ ${confirmed.request.direction === 'more' ? 'turned up' : 'turned down'}`);
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
    confirmations.delete(channel.id);
    act(() => post('/api/requests', { memberId: member.id, channelId: channel.id, direction }));
  };
  const badge = (direction) => (pending?.direction === direction ? el('span', { class: 'count', text: `×${pending.count}` }) : null);
  const stateClass = showDone ? ' done' : pending ? ' pending' : '';
  const label = (direction) => `${direction === 'more' ? 'More' : 'Less'} ${channel.name}`;
  return { channel, showDone, stateLine, send, badge, stateClass, label };
}

function renderRow(view) {
  const tap = (direction, text) =>
    el('button', { type: 'button', class: `tap ${direction}`, 'aria-label': view.label(direction), onclick: view.send(direction) }, [text, view.badge(direction)]);
  const row = el('div', { class: `channel${view.stateClass}` }, [
    el('div', {}, [el('div', { class: 'name', text: view.channel.name }), view.stateLine]),
    tap('less', '−'),
    tap('more', '+'),
  ]);
  if (view.showDone) row.addEventListener('click', () => dismiss(view.channel.id));
  return row;
}

function renderBox(view) {
  const half = (direction, arrow, position) =>
    el('button', { type: 'button', class: `half ${position}${view.badge(direction) ? ' active' : ''}`, 'aria-label': view.label(direction), onclick: view.send(direction) }, [arrow, view.badge(direction)]);
  const box = el('div', { class: `box${view.stateClass}` }, [
    half('more', '▲', 'up'),
    el('div', { class: 'middle' }, [el('div', { class: 'name', text: view.channel.name }), view.stateLine]),
    half('less', '▼', 'down'),
  ]);
  if (view.showDone) box.addEventListener('click', () => dismiss(view.channel.id));
  return box;
}

function renderChannels(member) {
  ui.picker.classList.add('hidden');
  ui.mix.classList.remove('hidden');
  ui.switchBtn.classList.remove('hidden');
  ui.who.textContent = member.name;
  ui.hint.textContent = HINTS[settings.layout][settings.autoDismiss ? 'auto' : 'sticky'];

  const pendingByChannel = new Map(
    state.requests.filter((r) => r.status === 'pending' && r.memberId === member.id).map((r) => [r.channelId, r]),
  );
  const views = member.channels.map((channel) => channelView(member, channel, pendingByChannel.get(channel.id), confirmations.get(channel.id)));
  ui.channels.className = settings.layout === 'boxes' ? 'boxes' : '';
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
  ui.autoDismiss.checked = settings.autoDismiss;
  for (const input of ui.layoutInputs) input.checked = input.value === settings.layout;
  const member = currentMember();
  if (!member) {
    if (memberId) saveMember(null);
    renderPicker();
    return;
  }
  trackConfirmations(member);
  renderChannels(member);
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
  for (const entry of confirmations.values()) {
    entry.until = settings.autoDismiss ? Math.min(entry.until, now + CONFIRM_MS) : Infinity;
  }
  render();
});

for (const input of ui.layoutInputs) {
  input.addEventListener('change', () => {
    if (!input.checked || !LAYOUTS.has(input.value)) return;
    settings.layout = input.value;
    writeStored(SETTINGS_KEY, settings);
    render();
  });
}

watchState({
  onState: (snapshot) => {
    state = snapshot;
    render();
  },
  onStatus: (live) => {
    ui.status.classList.toggle('live', live);
    ui.offline.classList.toggle('hidden', live);
  },
});

// Expire "done" flashes without waiting for the next server push.
setInterval(() => {
  const now = Date.now();
  let changed = false;
  for (const [channelId, entry] of confirmations) {
    if (entry.until <= now) {
      confirmations.delete(channelId);
      changed = true;
    }
  }
  if (changed) render();
}, 1000);
