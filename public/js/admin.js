import { watchState, post, toast, el, ago, keepScreenAwake } from './net.js';
import { ICONS, glyph, guessIcon } from './icons.js';
import { createMidi, renderMidiPanel } from './midi.js';

const OLD_AFTER_MS = 30_000;

const $ = (id) => document.getElementById(id);
const ui = {
  title: $('title'), subtitle: $('subtitle'), status: $('status'), pendingPill: $('pendingPill'),
  tabBoard: $('tabBoard'), tabSetup: $('tabSetup'), logout: $('logout'), offline: $('offline'),
  login: $('login'), loginForm: $('loginForm'), passcode: $('passcode'),
  board: $('board'), memberCards: $('memberCards'), log: $('log'), resolveAll: $('resolveAll'), clearHistory: $('clearHistory'), buzzAll: $('buzzAll'), boardHint: $('boardHint'),
  setup: $('setup'), showName: $('showName'), saveShow: $('saveShow'),
  memberCount: $('memberCount'), channelCount: $('channelCount'), quickSetup: $('quickSetup'),
  roster: $('roster'), addMember: $('addMember'), saveRoster: $('saveRoster'), revertRoster: $('revertRoster'),
  allChannelName: $('allChannelName'), addToAll: $('addToAll'),
  allowMessages: $('allowMessages'), buzzDefault: $('buzzDefault'), adminComposer: $('adminComposer'), messageTo: $('messageTo'), adminMessageText: $('adminMessageText'), messageBuzz: $('messageBuzz'),
  adminMidiPanel: $('adminMidiPanel'), qrLink: $('qrLink'),
  currentPasscode: $('currentPasscode'), newPasscode: $('newPasscode'), savePasscode: $('savePasscode'),
};

let state = null;
let admin = false;
let passcode = null; // revealed by the session once logged in
let view = 'board';
let draft = null; // editable copy of the roster while on the Setup tab

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

function boardItems() {
  const pending = state.requests.filter((r) => r.status === 'pending');
  const inbox = state.messages.filter((m) => m.status === 'pending' && m.from === 'member');
  return state.members.flatMap((member) => [
    ...pending.filter((r) => r.memberId === member.id).sort((a, b) => a.createdAt - b.createdAt).map((r) => ({ id: r.id, memberId: member.id, kind: 'request' })),
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
  if (!midi.active()) return;
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
  return el('div', { class: 'request', 'data-id': request.id }, [
    el('div', { class: `arrow ${request.direction}`, text: request.direction === 'more' ? '▲' : '▼' }),
    el('div', {}, [
      el('div', { class: 'label', text: `${glyph(request.channelIcon) ? `${glyph(request.channelIcon)} ` : ''}${request.channelName} ${request.direction === 'more' ? 'MORE' : 'LESS'}${request.count > 1 ? ` ×${request.count}` : ''}` }),
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

function renderBoard() {
  const pending = state.requests.filter((r) => r.status === 'pending');
  const inbox = state.messages.filter((m) => m.status === 'pending' && m.from === 'member');
  const outgoing = state.messages.filter((m) => m.status === 'pending' && m.from === 'admin');
  const open = pending.length + inbox.length;
  ui.pendingPill.textContent = String(open);
  ui.pendingPill.classList.toggle('hot', open > 0);
  ui.resolveAll.disabled = open === 0;

  ui.memberCards.replaceChildren(
    ...state.members.map((member) => {
      const mine = pending.filter((r) => r.memberId === member.id).sort((a, b) => a.createdAt - b.createdAt);
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
      return el('div', { class: `card member-card${count ? ' hot' : ''}` }, [
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
      return `${item.memberName} · ${glyph(item.channelIcon) ? `${glyph(item.channelIcon)} ` : ''}${item.channelName} ${item.direction === 'more' ? '▲' : '▼'}${item.count > 1 ? ` ×${item.count}` : ''}`;
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
    await post('/api/admin/roster', { members });
    seedDraft();
    renderRoster();
  }, 'Roster saved');
}

// ---------------------------------------------------------------------------
// Shell

function render() {
  if (!state) return;
  ui.title.textContent = state.show.name;
  document.title = `${state.show.name} · Admin`;

  ui.login.classList.toggle('hidden', admin);
  ui.tabBoard.classList.toggle('hidden', !admin);
  ui.tabSetup.classList.toggle('hidden', !admin);
  ui.logout.classList.toggle('hidden', !admin);
  ui.qrLink.classList.toggle('hidden', !admin);
  ui.board.classList.toggle('hidden', !admin || view !== 'board');
  ui.setup.classList.toggle('hidden', !admin || view !== 'setup');
  ui.tabBoard.className = view === 'board' ? 'primary' : 'ghost';
  ui.tabSetup.className = view === 'setup' ? 'primary' : 'ghost';
  ui.subtitle.textContent = admin ? (view === 'board' ? 'Mix board' : 'Setup') : 'Locked';
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
    if (!draft) {
      seedDraft();
      renderRoster();
    }
  }
}

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
ui.tabSetup.addEventListener('click', () => { view = 'setup'; draft = null; render(); });
ui.tabBoard.addEventListener('click', closeIconMenu);

ui.resolveAll.addEventListener('click', () => act(() => post('/api/admin/resolve', { all: true })));
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
    await post('/api/admin/roster', { memberCount, channelCount });
    seedDraft();
    renderRoster();
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
