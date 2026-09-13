import { watchState, post, toast, el, vibrate } from './net.js';

const STORAGE_KEY = 'fixmymix.memberId';
const CONFIRM_MS = 8000;

const ui = {
  title: document.getElementById('title'),
  who: document.getElementById('who'),
  status: document.getElementById('status'),
  switchBtn: document.getElementById('switch'),
  offline: document.getElementById('offline'),
  picker: document.getElementById('picker'),
  members: document.getElementById('members'),
  mix: document.getElementById('mix'),
  channels: document.getElementById('channels'),
};

let state = null;
let memberId = readMember();
// Requests this device has seen pending; when one flips to done we confirm it.
const knownPending = new Set();
// channelId -> { until, request } for the green "done" flash.
const confirmations = new Map();

function readMember() {
  try {
    return localStorage.getItem(STORAGE_KEY) || null;
  } catch {
    return null;
  }
}

function saveMember(id) {
  memberId = id;
  try {
    if (id) localStorage.setItem(STORAGE_KEY, id);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private mode; the choice just lasts until reload.
  }
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
      confirmations.set(request.channelId, { until: now + CONFIRM_MS, request });
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

function renderChannels(member) {
  ui.picker.classList.add('hidden');
  ui.mix.classList.remove('hidden');
  ui.switchBtn.classList.remove('hidden');
  ui.who.textContent = member.name;

  const pendingByChannel = new Map(
    state.requests.filter((r) => r.status === 'pending' && r.memberId === member.id).map((r) => [r.channelId, r]),
  );
  const now = Date.now();

  ui.channels.replaceChildren(
    ...member.channels.map((channel) => {
      const pending = pendingByChannel.get(channel.id);
      const confirmed = confirmations.get(channel.id);
      const showDone = confirmed && confirmed.until > now && !pending;

      const stateLine = el('div', { class: 'state' });
      if (showDone) {
        stateLine.textContent = `Done ✓ ${confirmed.request.direction === 'more' ? 'turned up' : 'turned down'}`;
      } else if (pending) {
        stateLine.append(
          `Sent: ${pending.direction === 'more' ? 'more' : 'less'}${pending.count > 1 ? ` ×${pending.count}` : ''}`,
          el('button', {
            type: 'button', class: 'cancel', text: 'cancel',
            onclick: () => act(() => post('/api/requests/cancel', { memberId: member.id, requestId: pending.id })),
          }),
        );
      }

      const tap = (direction, label) => {
        const button = el('button', {
          type: 'button',
          class: `tap ${direction}`,
          'aria-label': `${direction === 'more' ? 'More' : 'Less'} ${channel.name}`,
          onclick: () => act(() => post('/api/requests', { memberId: member.id, channelId: channel.id, direction })),
        }, label);
        if (pending?.direction === direction) button.append(el('span', { class: 'count', text: `×${pending.count}` }));
        return button;
      };

      return el('div', { class: `channel${showDone ? ' done' : pending ? ' pending' : ''}` }, [
        el('div', {}, [el('div', { class: 'name', text: channel.name }), stateLine]),
        tap('less', '−'),
        tap('more', '+'),
      ]);
    }),
  );
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
