// The error list page (/errors): every code, what it means, what to do, and a
// one-tap copy for an AI assistant. Built from the same table as the errors
// themselves, and served by FixMyMix so it works on the show Wi-Fi offline.

import { ERRORS, ERRORS_DOC_URL, helpUrl, llmPrompt } from './errors.js';
import { el, toast, showError } from './net.js';

const list = document.getElementById('list');
const search = document.getElementById('search');
const publicLink = document.getElementById('publicLink');
publicLink.href = ERRORS_DOC_URL;
publicLink.textContent = ERRORS_DOC_URL;

/** Copies text; on plain-http pages the Clipboard API is missing, so fall back to a selection. */
async function copy(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the selection copy
  }
  const area = el('textarea', { class: 'offscreen', readonly: '' });
  area.value = text;
  document.body.append(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  area.remove();
  return ok;
}

function entryCard(slug, e) {
  const manual = el('textarea', { class: 'prompt hidden', readonly: '', rows: '5', 'aria-label': `Text to paste into an AI assistant for ${e.code}` });
  manual.value = llmPrompt(e.code);
  return el('section', { class: 'card err', id: e.code, 'data-search': `${e.code} ${slug} ${e.area} ${e.message} ${e.help}`.toLowerCase() }, [
    el('div', { class: 'err-head' }, [
      el('span', { class: 'err-code', text: e.code }),
      el('span', { class: 'muted small', text: e.area }),
    ]),
    el('p', { class: 'err-message', text: e.message }),
    el('p', { class: 'muted', text: e.help }),
    el('div', { class: 'row' }, [
      el('button', {
        type: 'button', class: 'ghost compact', text: 'Copy for AI assistant',
        onclick: async () => {
          if (await copy(manual.value)) {
            toast(`Copied ${e.code} — paste it into your AI assistant`);
          } else {
            manual.classList.remove('hidden');
            manual.select();
            showError('copy_failed');
          }
        },
      }),
      el('a', { class: 'ghost btn-link compact', href: helpUrl(e.code), target: '_blank', rel: 'noopener', text: 'Public link' }),
    ]),
    manual,
  ]);
}

const byArea = new Map();
for (const [slug, e] of Object.entries(ERRORS)) {
  if (!byArea.has(e.area)) byArea.set(e.area, []);
  byArea.get(e.area).push(entryCard(slug, e));
}
list.replaceChildren(...[...byArea].flatMap(([area, cards]) => [el('h2', { class: 'err-area', text: area }), ...cards]));

function filter() {
  const q = search.value.trim().toLowerCase();
  for (const card of list.querySelectorAll('.err')) card.classList.toggle('hidden', Boolean(q) && !card.dataset.search.includes(q));
  for (const heading of list.querySelectorAll('.err-area')) {
    let next = heading.nextElementSibling;
    let any = false;
    while (next && !next.classList.contains('err-area')) {
      if (!next.classList.contains('hidden')) any = true;
      next = next.nextElementSibling;
    }
    heading.classList.toggle('hidden', !any);
  }
}
search.addEventListener('input', filter);

// Arriving from a Help link (/errors#FMM-P06): bring that code into view.
function focusHash() {
  const target = location.hash && document.getElementById(decodeURIComponent(location.hash.slice(1)).toUpperCase());
  if (!target) return;
  search.value = '';
  filter();
  target.scrollIntoView({ block: 'start' });
}
window.addEventListener('hashchange', focusHash);
focusHash();
