// The printable show report: fetches the log (admin session required) and lays
// it out for paper; the browser's Print dialog turns it into a PDF.

import { el } from './net.js';
import { glyph } from './icons.js';

const main = document.getElementById('report');
document.getElementById('print').addEventListener('click', () => window.print());

const seconds = (ms) => (ms >= 60_000 ? `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s` : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`);
const clock = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const day = (t) => new Date(t).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

async function load() {
  const res = await fetch('/api/admin/history', { headers: { Accept: 'application/json' } });
  if (res.status === 401) return renderLogin();
  if (!res.ok) throw new Error(`Could not load the log (${res.status}).`);
  render(await res.json());
}

function renderLogin() {
  const input = el('input', { type: 'password', inputmode: 'numeric', placeholder: 'Admin passcode', autocomplete: 'off' });
  const form = el('form', { class: 'login' }, [
    el('p', { text: 'Enter the admin passcode to see the report.' }),
    input,
    el('button', { type: 'submit', class: 'btn primary', text: 'Unlock' }),
  ]);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const r = await fetch('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ passcode: input.value.trim() }) });
    if (r.ok) load();
    else input.value = '';
  });
  main.replaceChildren(form);
  input.focus();
}

function what(e) {
  if (e.kind === 'message') return `${e.from === 'admin' ? 'Desk: ' : ''}“${e.text}”${e.buzz ? ' (buzz)' : ''}`;
  return `${glyph(e.channelIcon) ? `${glyph(e.channelIcon)} ` : ''}${e.channelName} ${e.priority ? "CAN'T HEAR" : e.direction === 'more' ? 'more' : 'less'}${e.count > 1 ? ` ×${e.count}` : ''}`;
}

function outcome(e) {
  if (e.status === 'cancelled') return 'cancelled';
  if (e.kind === 'message') return e.from === 'admin' ? 'read' : 'done';
  return 'done';
}

function render({ show, entries, summary: s }) {
  document.title = `${show} · Show report`;
  if (!entries.length) {
    main.replaceChildren(el('h1', { text: show }), el('p', { class: 'muted', text: 'Nothing in the show log yet.' }));
    return;
  }
  const members = new Map();
  for (const e of entries) members.set(e.memberId, e.memberName);
  const stat = (n, l) => el('div', { class: 'stat' }, [el('span', { class: 'n', text: String(n) }), el('span', { class: 'l', text: l })]);
  const sections = [...members].map(([id, name]) => {
    const mine = entries.filter((e) => e.memberId === id).sort((a, b) => a.createdAt - b.createdAt);
    const st = s.members.find((m) => m.memberId === id);
    return el('section', {}, [
      el('h2', {}, [el('div', { class: 'member-head' }, [name, el('span', { class: 'muted', text: `${st.requests} requests${st.priority ? `, ${st.priority} can't-hear` : ''}, ${st.messages} messages${st.requests ? `, average wait ${seconds(st.averageWaitMs)}` : ''}` })])]),
      el('table', {}, [
        el('thead', {}, [el('tr', {}, [el('th', { text: 'Asked' }), el('th', { text: 'What' }), el('th', { text: 'Outcome' }), el('th', { class: 'num', text: 'Cleared' }), el('th', { class: 'num', text: 'Wait' })])]),
        el('tbody', {}, mine.map((e) => el('tr', { class: `${e.priority ? 'priority' : ''} ${e.status === 'cancelled' ? 'cancelled' : ''}`.trim() }, [
          el('td', { class: 'time', text: clock(e.createdAt) }),
          el('td', { class: 'what', text: what(e) }),
          el('td', { text: outcome(e) }),
          el('td', { class: 'num', text: clock(e.resolvedAt) }),
          el('td', { class: 'num', text: seconds(e.waitMs) }),
        ]))),
      ]),
    ]);
  });
  main.replaceChildren(
    el('h1', { text: show }),
    el('p', { class: 'muted', text: `Show report · ${day(s.firstAt)} · ${clock(s.firstAt)} – ${clock(s.lastAt)} · generated ${new Date().toLocaleString()}` }),
    el('div', { class: 'summary' }, [
      stat(s.requests, 'requests cleared'),
      stat(s.priority, "can't-hear alerts"),
      stat(s.messages, 'messages'),
      stat(s.cancelled, 'cancelled'),
      stat(seconds(s.averageWaitMs), 'average wait'),
      stat(seconds(s.slowestWaitMs), 'slowest'),
    ]),
    ...sections,
  );
}

load().catch((error) => { main.replaceChildren(el('p', { class: 'muted', text: error.message })); });
