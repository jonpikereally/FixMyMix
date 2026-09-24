import { watchState, post, get, toast, el, ago, keepScreenAwake, vibrate } from './net.js';
import { ICONS, glyph, guessIcon } from './icons.js';
import { createMidi, renderMidiPanel } from './midi.js';
import { createKeys, renderKeysPanel } from './keys.js';

const OLD_AFTER_MS = 30_000;

const $ = (id) => document.getElementById(id);
const ui = {
  title: $('title'), subtitle: $('subtitle'), status: $('status'), pendingPill: $('pendingPill'),
  tabBoard: $('tabBoard'), tabSetup: $('tabSetup'), logout: $('logout'), offline: $('offline'),
  login: $('login'), loginForm: $('loginForm'), passcode: $('passcode'),
  board: $('board'), memberCards: $('memberCards'), log: $('log'), resolveAll: $('resolveAll'), clearHistory: $('clearHistory'), buzzAll: $('buzzAll'), boardHint: $('boardHint'),
  tabHistory: $('tabHistory'), history: $('history'), historyMember: $('historyMember'), historySummary: $('historySummary'), historyGroups: $('historyGroups'), historyClear: $('historyClear'),
  setup: $('setup'), showName: $('showName'), saveShow: $('saveShow'),
  memberCount: $('memberCount'), channelCount: $('channelCount'), quickSetup: $('quickSetup'),
  roster: $('roster'), addMember: $('addMember'), saveRoster: $('saveRoster'), revertRoster: $('revertRoster'),
  allChannelName: $('allChannelName'), addToAll: $('addToAll'),
  allowMessages: $('allowMessages'), buzzDefault: $('buzzDefault'), adminComposer: $('adminComposer'), messageTo: $('messageTo'), adminMessageText: $('adminMessageText'), messageBuzz: $('messageBuzz'),
  adminMidiPanel: $('adminMidiPanel'), adminKeysPanel: $('adminKeysPanel'), alertSound: $('alertSound'), qrLink: $('qrLink'),
  setupName: $('setupName'), saveSetup: $('saveSetup'), setups: $('setups'), exportCurrent: $('exportCurrent'), importSetup: $('importSetup'), importFile: $('importFile'),
  currentPasscode: $('currentPasscode'), newPasscode: $('newPasscode'), savePasscode: $('savePasscode'),
};

let state = null;
let admin = false;
let passcode = null; // revealed by the session once logged in
let view = 'board';
let alertSound = false;
try { alertSound = localStorage.getItem('fixmymix.alertSound') === '1'; } catch { /* private mode */ }
// Priority ("can't hear") requests already alerted for, so a re-render doesn't alert again.
const alertedPriority = new Set();
let alertTimer = null;
let audio = null;

function beep() {
  try {
    audio ??= new (window.AudioContext || window.webkitAudioContext)();
    const t = audio.currentTime;
    for (const [at, freq] of [[0, 880], [0.18, 880], [0.36, 1175]]) {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = 'square';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t + at);
      gain.gain.exponentialRampToValueAtTime(0.15, t + at + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + at + 0.14);
      osc.connect(gain).connect(audio.destination);
      osc.start(t + at);
      osc.stop(t + at + 0.16);
    }
  } catch {
    // No audio here; the flash and the red row carry the alert.
  }
}

function priorityAlert() {
  document.body.classList.add('flash');
  clearTimeout(alertTimer);
  alertTimer = setTimeout(() => document.body.classList.remove('flash'), 1800);
  vibrate([200, 80, 200, 80, 500]);
  if (alertSound) beep();
}
let draft = null; // editable copy of the roster while on the Setup tab
let setups = null; // saved band setups, fetched when the Setup tab opens
let historyData = null; // the show log, fetched when the History tab opens
let historyRev = null; // state rev the log was fetched at, so a change refreshes it

// MIDI walks a highlight through the pending items in board order.
let cursorId = null;
const MIDI_LABELS = {
  up: { title: 'Previous member', hint: 'Jump to the previous member with something pending' },
  down: { title: 'Next member', hint: 'Jump to the next member with something pending' },
  next: { title: 'Next item', hint: 'Highlight the next request or message' },
  prev: { title: 'Previous item', hint: 'Highlight the previous request or message' },
  confirm: { title: 'Confirm (Done)', hint: 'Mark the highlighted item done' },
};
const midi = createMidi({
  actions: Object.keys(MIDI_LABELS),
  storageKey: 'fixmymix.midi.admin',
  onAction: (action) => midiAction(action),
  onChange: () => render(),
});

// Keyboard shortcuts: the MIDI actions plus a couple that only make sense with a keyboard.
const KEY_LABELS = {
  ...MIDI_LABELS,
  clearAll: { title: 'Clear all', hint: 'Mark every pending request and message done' },
  message: { title: 'Message box', hint: 'Jump to the message box at the bottom of the board' },
};
const keys = createKeys({
  actions: Object.keys(KEY_LABELS),
  storageKey: 'fixmymix.keys.admin',
  onAction: (action) => keyAction(action),
  onChange: () => render(),
});
const controllerActive = () => midi.active() || keys.active();

function keyAction(action) {
  if (!admin || !state) return;
  if (action === 'clearAll') {
    if (state.requests.some((r) => r.status === 'pending') || state.messages.some((m) => m.status === 'pending' && m.from === 'member')) act(() => post('/api/admin/resolve', { all: true }), 'Board cleared');
    return;
  }
  if (action === 'message') {
    if (view !== 'board') { view = 'board'; render(); }
    if (!ui.adminComposer.classList.contains('hidden')) ui.adminMessageText.focus();
    else toast('Turn on Allow messages in Setup first', { error: true });
    return;
  }
  midiAction(action);
}

function boardItems() {
  const pending = state.requests.filter((r) => r.status === 'pending');
  const inbox = state.messages.filter((m) => m.status === 'pending' && m.from === 'member');
  return state.members.flatMap((member) => [
    ...pending.filter((r) => r.memberId === member.id).sort(byUrgency).map((r) => ({ id: r.id, memberId: member.id, kind: 'request' })),
    ...inbox.filter((m) => m.memberId === member.id).sort((a, b) => a.createdAt - b.createdAt).map((m) => ({ id: m.id, memberId: member.id, kind: 'message' })),
  ]);
}

function midiAction(action) {
  if (!admin || !state) return;
  const items = boardItems();
  if (!items.length) return;
  let index = items.findIndex((item) => item.id === cursorId);
  if (index === -1) index = 0;
  if (action === 'next') {
    index = (index + 1) % items.length;
  } else if (action === 'prev') {
    index = (index + items.length - 1) % items.length;
  } else if (action === 'up' || action === 'down') {
    const memberIds = [...new Set(items.map((item) => item.memberId))];
    const current = memberIds.indexOf(items[index].memberId);
    const target = memberIds[(current + (action === 'down' ? 1 : memberIds.length - 1)) % memberIds.length];
    index = items.findIndex((item) => item.memberId === target);
  } else if (action === 'confirm') {
    const item = items[index];
    const following = items[(index + 1) % items.length];
    cursorId = following.id === item.id ? null : following.id;
    act(() => post('/api/admin/resolve', item.kind === 'request' ? { requestId: item.id } : { messageId: item.id }));
    return;
  }
  cursorId = items[index].id;
  render();
  document.querySelector('.request.cursor')?.scrollIntoView({ block: 'nearest' });
}

function applyCursor() {
  if (!controllerActive()) return;
  const items = boardItems();
  if (!items.some((item) => item.id === cursorId)) cursorId = items[0]?.id ?? null;
  if (cursorId) ui.memberCards.querySelector(`[data-id="${cursorId}"]`)?.classList.add('cursor');
}

async function act(fn, okMessage) {
  try {
    await fn();
    if (okMessage) toast(okMessage);
  } catch (error) {
    if (error.status === 401) {
      admin = false;
      render();
    }
    toast(error.message, { error: true });
  }
}

// ---------------------------------------------------------------------------
// Board

function requestRow(request) {
  const meta = el('div', { class: 'meta', 'data-created': request.createdAt });
  meta.textContent = `${ago(request.createdAt)} ago`;
  const priority = request.priority === true;
  return el('div', { class: `request${priority ? ' priority' : ''}`, 'data-id': request.id }, [
    el('div', { class: `arrow ${priority ? 'urgent' : request.direction}`, text: priority ? '🚨' : request.direction === 'more' ? '▲' : '▼' }),
    el('div', {}, [
      el('div', { class: 'label', text: `${glyph(request.channelIcon) ? `${glyph(request.channelIcon)} ` : ''}${request.channelName} ${priority ? 'CAN’T HEAR AT ALL' : request.direction === 'more' ? 'MORE' : 'LESS'}${request.count > 1 ? ` ×${request.count}` : ''}` }),
      meta,
    ]),
    el('button', {
      type: 'button', class: 'done-btn', text: 'Done',
      onclick: () => act(() => post('/api/admin/resolve', { requestId: request.id })),
    }),
  ]);
}

function messageRow(message) {
  const meta = el('div', { class: 'meta', 'data-created': message.createdAt, text: `${ago(message.createdAt)} ago` });
  return el('div', { class: 'request message', 'data-id': message.id }, [
    el('div', { class: 'arrow chat', text: '💬' }),
    el('div', {}, [el('div', { class: 'label quote', text: message.text }), meta]),
    el('button', {
      type: 'button', class: 'done-btn', text: 'Done',
      onclick: () => act(() => post('/api/admin/resolve', { messageId: message.id })),
    }),
  ]);
}

function outgoingRow(message) {
  return el('div', { class: 'outgoing' }, [
    el('span', { class: 'muted', text: message.buzz ? 'You (buzz): ' : 'You: ' }),
    el('span', { class: 'quote', text: message.text }),
    el('span', { class: 'muted small', text: ' — waiting for a Got it' }),
  ]);
}

let composerKey = '';
let buzzDefaultSeen = null;
function renderComposer() {
  const show = admin && view === 'board' && Boolean(state.show.messaging);
  ui.adminComposer.classList.toggle('hidden', !show);
  document.body.classList.toggle('has-composer', show);
  if (!show) return;
  // The Buzz tick follows the Setup default whenever that default changes; the
  // admin can still flip it per message.
  const buzzDefault = Boolean(state.show.buzzDefault);
  if (buzzDefault !== buzzDefaultSeen) {
    buzzDefaultSeen = buzzDefault;
    ui.messageBuzz.checked = buzzDefault;
  }
  const key = state.members.map((m) => `${m.id}:${m.name}`).join('|');
  if (key === composerKey) return;
  composerKey = key;
  const current = ui.messageTo.value;
  ui.messageTo.replaceChildren(
    el('option', { value: 'all', text: 'Everyone' }),
    ...state.members.map((m) => el('option', { value: m.id, text: m.name })),
  );
  if ([...ui.messageTo.options].some((o) => o.value === current)) ui.messageTo.value = current;
}

const byUrgency = (a, b) => (b.priority === true) - (a.priority === true) || a.createdAt - b.createdAt;

function renderBoard() {
  const pending = state.requests.filter((r) => r.status === 'pending');
  const priorities = pending.filter((r) => r.priority === true);
  let fresh = false;
  for (const r of priorities) if (!alertedPriority.has(r.id)) { alertedPriority.add(r.id); fresh = true; }
  for (const id of alertedPriority) if (!pending.some((r) => r.id === id)) alertedPriority.delete(id);
  if (fresh) priorityAlert();
  document.title = `${priorities.length ? '🚨 ' : ''}${state.show.name} · Admin`;
  const inbox = state.messages.filter((m) => m.status === 'pending' && m.from === 'member');
  const outgoing = state.messages.filter((m) => m.status === 'pending' && m.from === 'admin');
  const open = pending.length + inbox.length;
  ui.pendingPill.textContent = String(open);
  ui.pendingPill.classList.toggle('hot', open > 0);
  ui.resolveAll.disabled = open === 0;

  ui.memberCards.replaceChildren(
    ...state.members.map((member) => {
      const mine = pending.filter((r) => r.memberId === member.id).sort(byUrgency);
      const myInbox = inbox.filter((m) => m.memberId === member.id).sort((a, b) => a.createdAt - b.createdAt);
      const myOutgoing = outgoing.filter((m) => m.memberId === member.id);
      const count = mine.length + myInbox.length;
      const connected = Boolean(state.presence?.online?.[member.id]);
      const header = el('header', {}, [
        el('h3', {}, [
          el('span', { class: `dot${connected ? ' on' : ''}`, title: connected ? 'Connected' : 'Not connected', 'aria-label': connected ? 'connected' : 'not connected' }),
          `${glyph(member.icon) ? `${glyph(member.icon)} ` : ''}${member.name}`,
        ]),
        el('span', { class: 'row' }, [
          el('button', { type: 'button', class: 'ghost compact', text: 'Buzz', title: `Buzz ${member.name}'s phone`, disabled: connected ? null : 'disabled', onclick: () => act(() => post('/api/admin/buzz', { memberId: member.id })) }),
          count > 1
            ? el('button', { type: 'button', class: 'ghost compact', text: 'All done', onclick: () => act(() => post('/api/admin/resolve', { memberId: member.id })) })
            : el('span', { class: `pill${count ? ' hot' : ''}`, text: String(count) }),
        ]),
      ]);
      return el('div', { class: `card member-card${count ? ' hot' : ''}${mine.some((r) => r.priority) ? ' priority' : ''}` }, [
        header,
        ...mine.map(requestRow),
        ...myInbox.map(messageRow),
        ...myOutgoing.map(outgoingRow),
        ...(count || myOutgoing.length ? [] : [el('div', { class: 'idle small', text: 'Happy for now' })]),
      ]);
    }),
  );

  const onlineCount = state.members.filter((m) => state.presence?.online?.[m.id]).length;
  ui.boardHint.textContent = `${onlineCount} of ${state.members.length} performers connected · ${state.presence?.devices ?? 0} device${state.presence?.devices === 1 ? '' : 's'} on the board. Press Done once you've made a change.`;
  ui.buzzAll.disabled = !(state.presence?.devices > 0);

  const done = [...state.requests, ...state.messages]
    .filter((r) => r.status === 'done')
    .sort((a, b) => b.resolvedAt - a.resolvedAt)
    .slice(0, 12);
  ui.clearHistory.disabled = done.length === 0;
  const logLine = (item) => {
    if (item.text === undefined) {
      return `${item.memberName} · ${glyph(item.channelIcon) ? `${glyph(item.channelIcon)} ` : ''}${item.channelName} ${item.priority ? '🚨 couldn’t hear' : item.direction === 'more' ? '▲' : '▼'}${item.count > 1 ? ` ×${item.count}` : ''}`;
    }
    return item.from === 'admin' ? `${item.memberName} ✓ read “${item.text}”` : `${item.memberName} · 💬 “${item.text}”`;
  };
  ui.log.replaceChildren(
    ...(done.length
      ? done.map((r) => el('li', {}, [
          el('span', { text: logLine(r) }),
          el('span', { class: 'muted', text: new Date(r.resolvedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }),
        ]))
      : [el('li', { class: 'muted', text: 'Nothing cleared yet.' })]),
  );
  renderComposer();
  applyCursor();
}

// Age labels tick without a full re-render so buttons keep their tap state.
setInterval(() => {
  for (const meta of ui.memberCards.querySelectorAll('.meta[data-created]')) {
    const created = Number(meta.dataset.created);
    meta.textContent = `${ago(created)} ago`;
    meta.classList.toggle('old', Date.now() - created > OLD_AFTER_MS);
  }
}, 1000);

// ---------------------------------------------------------------------------
// Setup

function seedDraft() {
  draft = state.members.map((m) => ({ id: m.id, name: m.name, icon: m.icon, channels: m.channels.map((c) => ({ ...c })) }));
  ui.showName.value = state.show.name;
}

// One floating icon menu, moved under whichever button opened it.
let iconMenu = null;
function openIconMenu(anchor, current, onPick) {
  closeIconMenu();
  const pick = (key) => { closeIconMenu(); onPick(key); };
  iconMenu = el('div', { class: 'icon-menu', role: 'listbox' }, [
    ...ICONS.map((icon) => el('button', {
      type: 'button', class: icon.key === current ? 'selected' : '', role: 'option', 'aria-selected': String(icon.key === current),
      onclick: () => pick(icon.key),
    }, [el('span', { class: 'glyph', text: icon.glyph }), icon.label])),
    el('button', { type: 'button', class: current ? '' : 'selected', role: 'option', onclick: () => pick('') }, [el('span', { class: 'glyph', text: '–' }), 'No icon']),
  ]);
  const rect = anchor.getBoundingClientRect();
  iconMenu.style.top = `${rect.bottom + window.scrollY + 4}px`;
  iconMenu.style.left = `${Math.max(8, Math.min(rect.left + window.scrollX, window.innerWidth - 240))}px`;
  document.body.append(iconMenu);
  iconMenu.querySelector('.selected')?.focus();
}
function closeIconMenu() {
  iconMenu?.remove();
  iconMenu = null;
}
document.addEventListener('pointerdown', (event) => {
  if (iconMenu && !iconMenu.contains(event.target) && !event.target.closest('.icon-pick')) closeIconMenu();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeIconMenu();
});

function iconButton(item, label) {
  const button = el('button', { type: 'button', class: `icon-pick${item.icon ? '' : ' empty'}`, 'aria-label': `Icon for ${label}`, text: glyph(item.icon) || '+' });
  button.addEventListener('click', () => openIconMenu(button, item.icon, (key) => {
    item.icon = key;
    item.iconChosen = true;
    button.textContent = glyph(key) || '+';
    button.classList.toggle('empty', !key);
  }));
  return button;
}

// Typing a name guesses an icon until the admin picks one explicitly.
function guessWhileTyping(input, item, button) {
  input.addEventListener('input', () => {
    item.name = input.value;
    if (item.iconChosen) return;
    item.icon = guessIcon(input.value);
    button.textContent = glyph(item.icon) || '+';
    button.classList.toggle('empty', !item.icon);
  });
}

function renderRoster() {
  closeIconMenu();
  ui.roster.replaceChildren(
    ...draft.map((member, index) => {
      const nameInput = el('input', { type: 'text', maxlength: 40, value: member.name, placeholder: `Member ${index + 1}`, 'aria-label': 'Member name' });
      const memberIcon = iconButton(member, member.name || `Member ${index + 1}`);
      nameInput.addEventListener('input', () => { member.name = nameInput.value; });

      const chips = el('div', { class: 'chips' }, [
        ...member.channels.map((channel, ci) => {
          const input = el('input', { type: 'text', maxlength: 40, value: channel.name, placeholder: `Ch ${ci + 1}`, 'aria-label': 'Channel name' });
          const icon = iconButton(channel, channel.name || `channel ${ci + 1}`);
          guessWhileTyping(input, channel, icon);
          return el('div', { class: 'chip' }, [
            icon,
            input,
            el('button', { type: 'button', text: '×', 'aria-label': `Remove ${channel.name}`, onclick: () => { member.channels.splice(ci, 1); renderRoster(); } }),
          ]);
        }),
        el('button', {
          type: 'button', class: 'add-chip', text: '+ Channel',
          onclick: () => {
            if (member.channels.length >= 16) return toast('Max 16 channels per member', { error: true });
            member.channels.push({ id: null, name: '', icon: '' });
            renderRoster();
            ui.roster.querySelectorAll('.roster-member')[index]?.querySelector('.chip:last-of-type input')?.focus();
          },
        }),
      ]);

      return el('div', { class: 'roster-member' }, [
        el('div', { class: 'head' }, [
          memberIcon,
          nameInput,
          el('button', { type: 'button', class: 'icon', text: '🗑', 'aria-label': `Remove ${member.name}`, onclick: () => {
            if (draft.length === 1) return toast('Keep at least one member', { error: true });
            if (!confirm(`Remove ${member.name || 'this member'}?`)) return;
            draft.splice(index, 1);
            renderRoster();
          } }),
        ]),
        chips,
      ]);
    }),
  );
}

function saveRoster() {
  const members = draft.map((m, i) => ({
    id: m.id,
    name: m.name.trim() || `Member ${i + 1}`,
    icon: m.icon || '',
    channels: m.channels.map((c, ci) => ({ id: c.id || undefined, name: c.name.trim() || `Ch ${ci + 1}`, icon: c.icon || '' })),
  }));
  if (members.some((m) => !m.channels.length)) return toast('Every member needs at least one channel', { error: true });
  act(async () => {
    applySnapshot(await post('/api/admin/roster', { members }));
  }, 'Roster saved');
}

// ---------------------------------------------------------------------------
// Shell

function render() {
  if (!state) return;
  ui.title.textContent = state.show.name;
  if (!admin) document.title = `${state.show.name} · Admin`;

  ui.login.classList.toggle('hidden', admin);
  ui.tabBoard.classList.toggle('hidden', !admin);
  ui.tabSetup.classList.toggle('hidden', !admin);
  ui.tabHistory.classList.toggle('hidden', !admin);
  ui.logout.classList.toggle('hidden', !admin);
  ui.qrLink.classList.toggle('hidden', !admin);
  ui.board.classList.toggle('hidden', !admin || view !== 'board');
  ui.setup.classList.toggle('hidden', !admin || view !== 'setup');
  ui.history.classList.toggle('hidden', !admin || view !== 'history');
  ui.tabBoard.className = view === 'board' ? 'primary' : 'ghost';
  ui.tabSetup.className = view === 'setup' ? 'primary' : 'ghost';
  ui.tabHistory.className = view === 'history' ? 'primary' : 'ghost';
  ui.subtitle.textContent = admin ? ({ board: 'Mix board', setup: 'Setup', history: 'Show log' })[view] : 'Locked';
  keepScreenAwake(admin); // the board must stay visible through the set

  ui.allowMessages.checked = Boolean(state.show.messaging);
  ui.buzzDefault.checked = Boolean(state.show.buzzDefault);
  if (!admin) {
    ui.passcode.focus();
    ui.adminComposer.classList.add('hidden');
    document.body.classList.remove('has-composer');
    return;
  }
  renderBoard();
  if (view === 'setup') {
    ui.currentPasscode.textContent = passcode ?? '…';
    renderMidiPanel(ui.adminMidiPanel, midi, MIDI_LABELS);
    renderKeysPanel(ui.adminKeysPanel, keys, KEY_LABELS);
    ui.alertSound.checked = alertSound;
    if (!draft) {
      seedDraft();
      renderRoster();
    }
    if (!setups) refreshSetups();
    else renderSetups();
  }
  if (view === 'history') {
    if (!historyData || historyRev !== state.rev) refreshHistory();
    else renderHistory();
  }
}

// --- History: the show log, grouped by performer
async function refreshHistory() {
  historyRev = state?.rev ?? null;
  try {
    historyData = await get('/api/admin/history');
  } catch (error) {
    historyData = { entries: [], summary: null, error: error.message };
  }
  renderHistory();
}

const seconds = (ms) => (ms >= 60_000 ? `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s` : `${Math.round(ms / 1000)} s`);
const clock = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

function historyLine(e) {
  const icon = e.kind === 'message' ? (e.from === 'admin' ? '📣' : '💬') : e.priority ? '🚨' : e.direction === 'more' ? '▲' : '▼';
  let what;
  if (e.kind === 'message') what = `${e.from === 'admin' ? 'Desk: ' : ''}“${e.text}”${e.buzz ? ' (buzz)' : ''}`;
  else what = `${glyph(e.channelIcon) ? `${glyph(e.channelIcon)} ` : ''}${e.channelName} ${e.priority ? 'CAN’T HEAR' : e.direction === 'more' ? 'MORE' : 'LESS'}${e.count > 1 ? ` ×${e.count}` : ''}`;
  const outcome = e.status === 'cancelled' ? 'cancelled by performer' : e.kind === 'message' && e.from === 'admin' ? `read after ${seconds(e.waitMs)}` : `cleared in ${seconds(e.waitMs)}`;
  return el('li', { class: `hist ${e.kind}${e.priority ? ' priority' : ''}${e.status === 'cancelled' ? ' cancelled' : ''}` }, [
    el('span', { class: 'hist-time', text: clock(e.createdAt) }),
    el('span', { class: 'hist-icon', text: icon }),
    el('span', { class: 'hist-what', text: what }),
    el('span', { class: 'hist-outcome muted small', text: outcome }),
  ]);
}

function renderHistory() {
  const data = historyData;
  if (!data) return;
  if (data.error) {
    ui.historySummary.textContent = data.error;
    ui.historyGroups.replaceChildren();
    return;
  }
  const entries = data.entries;
  const s = data.summary;
  const current = ui.historyMember.value || 'all';
  const members = new Map();
  for (const e of entries) members.set(e.memberId, e.memberName);
  ui.historyMember.replaceChildren(
    el('option', { value: 'all', text: 'Everyone' }),
    ...[...members].map(([id, name]) => el('option', { value: id, text: name })),
  );
  ui.historyMember.value = members.has(current) ? current : 'all';
  const filter = ui.historyMember.value;
  ui.historyClear.disabled = entries.length === 0;
  if (!entries.length) {
    ui.historySummary.textContent = 'Nothing in the log yet. Every request and message that gets cleared during the show lands here.';
    ui.historyGroups.replaceChildren();
    return;
  }
  const span = s.firstAt && s.lastAt ? `${new Date(s.firstAt).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} – ${clock(s.lastAt)}` : '';
  ui.historySummary.textContent = `${s.requests} request${s.requests === 1 ? '' : 's'} cleared${s.priority ? ` (${s.priority} can’t-hear)` : ''}, ${s.messages} message${s.messages === 1 ? '' : 's'}${s.cancelled ? `, ${s.cancelled} cancelled` : ''} · average wait ${seconds(s.averageWaitMs)}, slowest ${seconds(s.slowestWaitMs)} · ${span}`;
  const groups = [...members].filter(([id]) => filter === 'all' || id === filter).map(([id, name]) => {
    const mine = entries.filter((e) => e.memberId === id).sort((a, b) => b.createdAt - a.createdAt);
    const stats = s.members.find((m) => m.memberId === id);
    return el('div', { class: 'hist-group' }, [
      el('h3', {}, [name, el('span', { class: 'muted small', text: ` · ${stats.requests} request${stats.requests === 1 ? '' : 's'}${stats.priority ? `, ${stats.priority} can’t-hear` : ''}, ${stats.messages} message${stats.messages === 1 ? '' : 's'}${stats.requests ? `, average wait ${seconds(stats.averageWaitMs)}` : ''}` })]),
      el('ul', { class: 'hist-list' }, mine.map(historyLine)),
    ]);
  });
  ui.historyGroups.replaceChildren(...groups);
}

ui.tabHistory.addEventListener('click', () => { view = 'history'; render(); });
ui.historyMember.addEventListener('change', renderHistory);
ui.historyClear.addEventListener('click', () => {
  if (!confirm('Clear the whole show log? Download the CSV first if you want to keep it. The board is not affected.')) return;
  act(async () => {
    await post('/api/admin/history/clear', { journal: true });
    historyData = null;
    render();
  }, 'Show log cleared');
});

// --- Band setups: save / load / export / delete / import
async function refreshSetups() {
  setups = [];
  try {
    const { setups: list } = await get('/api/admin/setups');
    setups = list;
  } catch (error) {
    toast(error.message, { error: true });
  }
  renderSetups();
}

function renderSetups() {
  const when = (t) => new Date(t).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  ui.setups.replaceChildren(
    ...(setups?.length
      ? setups.map((s) => el('div', { class: 'setup', 'data-id': s.id }, [
          el('div', { class: 'grow' }, [
            el('div', { class: 'name', text: s.name }),
            el('div', { class: 'muted small', text: `${s.members} member${s.members === 1 ? '' : 's'} · ${s.channels} channel${s.channels === 1 ? '' : 's'} · saved ${when(s.savedAt)}` }),
          ]),
          el('button', { type: 'button', class: 'primary compact load-setup', text: 'Load', onclick: () => loadSetup(s) }),
          el('a', { class: 'btn-link compact', href: `/api/admin/setups/export?id=${encodeURIComponent(s.id)}`, download: '', text: 'Export' }),
          el('button', { type: 'button', class: 'ghost compact danger delete-setup', text: 'Delete', onclick: () => deleteSetup(s) }),
        ]))
      : [el('p', { class: 'muted small', text: 'No setups saved yet. Name the current one above and press Save current.' })]),
  );
}

// The reply to a load carries the new roster; use it now rather than waiting
// for the stream, so the editor below never re-seeds from the old one.
function applySnapshot(snapshot) {
  if (snapshot?.members && state) state = { ...state, ...snapshot, presence: state.presence };
  draft = null;
  render();
}

function loadSetup(setup) {
  if (!confirm(`Load “${setup.name}”? This replaces the current roster. Pending requests for anyone not in it are cleared, and performers may need to re-pick their name.`)) return;
  act(async () => {
    const { loaded: _loaded, ...snapshot } = await post('/api/admin/setups/load', { id: setup.id });
    applySnapshot(snapshot);
  }, `Loaded “${setup.name}”`);
}

function deleteSetup(setup) {
  if (!confirm(`Delete the saved setup “${setup.name}”? The current roster is not affected.`)) return;
  act(async () => {
    const { setups: list } = await post('/api/admin/setups/delete', { id: setup.id });
    setups = list;
    renderSetups();
  }, 'Setup deleted');
}

ui.saveSetup.addEventListener('click', () => {
  const name = ui.setupName.value.trim();
  if (!name) { ui.setupName.focus(); return toast('Give the setup a name first', { error: true }); }
  if (draft && JSON.stringify(draft) !== JSON.stringify(state.members.map((m) => ({ id: m.id, name: m.name, icon: m.icon, channels: m.channels.map((c) => ({ ...c })) }))) && !confirm('The roster below has unsaved edits, which will not be included. Save the setup anyway?')) return;
  act(async () => {
    const { saved, setups: list } = await post('/api/admin/setups', { name });
    setups = list;
    ui.setupName.value = '';
    renderSetups();
    return saved;
  }, `Saved “${name}”`);
});

ui.importSetup.addEventListener('click', () => ui.importFile.click());
ui.importFile.addEventListener('change', () => {
  const file = ui.importFile.files?.[0];
  ui.importFile.value = '';
  if (!file) return;
  act(async () => {
    let parsed;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      throw new Error('That file is not valid JSON.');
    }
    const load = confirm(`Import “${file.name}” and load it now? OK replaces the current roster with it; Cancel just adds it to the saved list.`);
    const { imported, setups: list, ...snapshot } = await post('/api/admin/setups/import', { setup: parsed, filename: file.name, load });
    setups = list;
    if (load) applySnapshot(snapshot); else renderSetups();
    toast(load ? `Imported and loaded “${imported.name}”` : `Imported “${imported.name}” — press Load to use it`);
  });
});

if (Object.keys(midi.bindings()).length) midi.connect();

ui.loginForm.addEventListener('submit', (event) => {
  event.preventDefault();
  act(async () => {
    const session = await post('/api/admin/login', { passcode: ui.passcode.value.trim() });
    ui.passcode.value = '';
    admin = true;
    passcode = session.passcode ?? null;
    render();
  });
});

ui.logout.addEventListener('click', () => act(async () => {
  await post('/api/admin/logout');
  admin = false;
  draft = null;
  render();
}));

ui.tabBoard.addEventListener('click', () => { view = 'board'; render(); });
ui.tabSetup.addEventListener('click', () => { view = 'setup'; draft = null; setups = null; render(); });
ui.tabBoard.addEventListener('click', closeIconMenu);

ui.resolveAll.addEventListener('click', () => act(() => post('/api/admin/resolve', { all: true })));
ui.alertSound.addEventListener('change', () => {
  alertSound = ui.alertSound.checked;
  try { localStorage.setItem('fixmymix.alertSound', alertSound ? '1' : '0'); } catch { /* private mode */ }
  if (alertSound) beep();
});
ui.buzzAll.addEventListener('click', () => act(async () => {
  const { devices } = await post('/api/admin/buzz', {});
  toast(`Buzzed ${devices} device${devices === 1 ? '' : 's'}`);
}));
ui.clearHistory.addEventListener('click', () => act(() => post('/api/admin/history/clear')));
ui.saveShow.addEventListener('click', () => act(() => post('/api/admin/show', { name: ui.showName.value }), 'Show name saved'));
ui.savePasscode.addEventListener('click', () => {
  const next = ui.newPasscode.value.trim();
  if (!/^\d{4,12}$/.test(next)) return toast('Passcode must be 4 to 12 digits', { error: true });
  act(async () => {
    const session = await post('/api/admin/passcode', { passcode: next });
    passcode = session.passcode;
    ui.newPasscode.value = '';
    render();
  }, `Passcode is now ${next}`);
});
ui.newPasscode.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    ui.savePasscode.click();
  }
});
ui.allowMessages.addEventListener('change', () => act(() => post('/api/admin/show', { messaging: ui.allowMessages.checked }), ui.allowMessages.checked ? 'Messages on' : 'Messages off'));
ui.buzzDefault.addEventListener('change', () => act(() => post('/api/admin/show', { buzzDefault: ui.buzzDefault.checked }), ui.buzzDefault.checked ? 'Messages buzz by default' : 'Messages no longer buzz by default'));

ui.adminComposer.addEventListener('submit', (event) => {
  event.preventDefault();
  const text = ui.adminMessageText.value.trim();
  if (!text) return;
  const to = ui.messageTo.value;
  const buzz = ui.messageBuzz.checked;
  act(async () => {
    await post('/api/admin/messages', { ...(to === 'all' ? { all: true } : { memberId: to }), text, buzz });
    ui.adminMessageText.value = '';
    ui.messageBuzz.checked = Boolean(state.show.buzzDefault);
  }, `${to === 'all' ? 'Sent to everyone' : 'Sent'}${buzz ? ' with buzz' : ''}`);
});

ui.quickSetup.addEventListener('click', () => {
  const memberCount = Number(ui.memberCount.value);
  const channelCount = Number(ui.channelCount.value);
  if (!confirm(`Replace the current roster with ${memberCount} members × ${channelCount} channels? Pending requests will be cleared and performers will need to re-pick their name.`)) return;
  act(async () => {
    applySnapshot(await post('/api/admin/roster', { memberCount, channelCount }));
  }, 'Roster built');
});

ui.addMember.addEventListener('click', () => {
  if (draft.length >= 24) return toast('Max 24 members', { error: true });
  draft.push({ id: null, name: '', icon: '', channels: [{ id: null, name: 'Vocal', icon: 'vocal' }] });
  renderRoster();
  ui.roster.lastElementChild?.querySelector('input')?.focus();
});
function addChannelToEveryone() {
  const name = ui.allChannelName.value.trim();
  if (!name) return toast('Type a channel name first', { error: true });
  let added = 0;
  let full = 0;
  for (const member of draft) {
    if (member.channels.some((c) => c.name.trim().toLowerCase() === name.toLowerCase())) continue;
    if (member.channels.length >= 16) { full += 1; continue; }
    member.channels.push({ id: null, name, icon: guessIcon(name) });
    added += 1;
  }
  renderRoster();
  ui.allChannelName.value = '';
  if (!added) return toast(full ? 'Everyone already has that channel or is full' : 'Everyone already has that channel', { error: true });
  toast(`Added “${name}” to ${added} member${added === 1 ? '' : 's'}${full ? ` (${full} full)` : ''} — press Save roster`);
}

ui.addToAll.addEventListener('click', addChannelToEveryone);
ui.allChannelName.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    addChannelToEveryone();
  }
});
ui.saveRoster.addEventListener('click', saveRoster);
ui.revertRoster.addEventListener('click', () => { seedDraft(); renderRoster(); toast('Changes discarded'); });

fetch('/api/admin/session', { cache: 'no-store' })
  .then((res) => res.json())
  .then((data) => { admin = Boolean(data.admin); passcode = data.passcode ?? null; render(); })
  .catch(() => {});

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
