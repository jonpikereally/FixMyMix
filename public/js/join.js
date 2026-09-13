import { qrSvg } from './qr.js';
import { el } from './net.js';

const ui = { qr: document.getElementById('qr'), url: document.getElementById('url'), others: document.getElementById('others'), title: document.getElementById('title') };
let urls = [];
let chosen = null;

function render() {
  if (!urls.length) {
    ui.url.textContent = 'No network address yet — is the computer on Wi-Fi?';
    ui.qr.replaceChildren();
    ui.others.replaceChildren();
    return;
  }
  if (!urls.includes(chosen)) {
    // Prefer the address this page was opened on, so the QR matches what the admin already uses.
    chosen = urls.find((u) => u === location.origin) ?? urls[0];
  }
  ui.qr.replaceChildren(qrSvg(chosen));
  ui.url.textContent = chosen;
  ui.others.replaceChildren(
    ...(urls.length > 1 ? urls.map((u) => el('button', { type: 'button', class: u === chosen ? 'primary' : 'ghost', text: u.replace(/^https?:\/\//, ''), onclick: () => { chosen = u; render(); } })) : []),
  );
}

async function refresh() {
  try {
    const res = await fetch('/api/info', { cache: 'no-store' });
    const info = await res.json();
    const next = info.urls ?? [];
    if (next.join() !== urls.join()) {
      urls = next;
      render();
    }
  } catch {
    // Keep showing the last known address.
  }
  try {
    const state = await (await fetch('/api/state', { cache: 'no-store' })).json();
    ui.title.textContent = state.show?.name || 'FixMyMix';
  } catch {
    // Title is cosmetic.
  }
}

refresh();
setInterval(refresh, 15_000); // the address changes when the Wi-Fi does
