import { qrSvg } from './qr.js';
import { el } from './net.js';

const $ = (id) => document.getElementById(id);
const ui = {
  qr: $('qr'), url: $('url'), others: $('others'), title: $('title'), hint: $('joinHint'),
  tabs: [...document.querySelectorAll('.seg [data-app]')],
  ablesetOptions: $('abletOptions'), ablesetHost: $('abletHost'), ablesetPort: $('abletPort'),
  ablesetCustomWrap: $('abletHostCustomWrap'), ablesetCustom: $('abletHostCustom'),
  customOptions: $('customOptions'), customUrl: $('customUrl'),
};
const APPS = new Set(['fixmymix', 'ableset', 'custom']);
const STORAGE = 'fixmymix.join';
const HINTS = {
  fixmymix: "Point the phone's camera at the code and tap the link it shows. If nothing appears, type the address above into the browser.",
  ableset: 'Scanning opens AbleSet\'s web app on the phone. AbleSet must be running with its server on, and the phone on the same Wi-Fi.',
  custom: 'A QR code for any address on this network — a mixer\'s web page, a lyrics screen, anything the band needs to open.',
};

let urls = [];
let hosts = [];
let chosen = null;
let prefs = load();
let app = APPS.has(new URLSearchParams(location.search).get('app')) ? new URLSearchParams(location.search).get('app') : prefs.app || 'fixmymix';

function load() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE) ?? '{}') ?? {};
  } catch {
    return {};
  }
}

function save() {
  // ablesetHost is stored only when the user picks one (see the change handler),
  // so a placeholder chosen before the addresses arrived is never remembered.
  prefs = { ...prefs, app, ablesetPort: ui.ablesetPort.value, ablesetCustom: ui.ablesetCustom.value.trim(), customUrl: ui.customUrl.value.trim() };
  try {
    localStorage.setItem(STORAGE, JSON.stringify(prefs));
  } catch {
    // Private mode; fine.
  }
}

function ablesetHost() {
  return ui.ablesetHost.value === 'custom' ? ui.ablesetCustom.value.trim() : ui.ablesetHost.value;
}

/** The address the current tab should encode, or null with a reason. */
function target() {
  if (app === 'fixmymix') {
    if (!urls.length) return { error: 'No network address yet — is the computer on Wi-Fi?' };
    if (!urls.includes(chosen)) chosen = urls.find((u) => u === location.origin) ?? urls[0];
    return { url: chosen };
  }
  if (app === 'ableset') {
    const host = ablesetHost();
    const portText = ui.ablesetPort.value.trim();
    const port = Number(portText);
    if (!host) return { error: 'Type the address of the computer running Ableton.' };
    if (portText && !(port >= 1 && port <= 65535)) return { error: 'Port must be between 1 and 65535, or empty.' };
    return { url: portText ? `http://${host}:${port}` : `http://${host}` };
  }
  const raw = ui.customUrl.value.trim();
  if (!raw) return { error: 'Type an address to encode.' };
  try {
    return { url: new URL(raw.includes('://') ? raw : `http://${raw}`).toString().replace(/\/$/, '') };
  } catch {
    return { error: 'That does not look like a web address.' };
  }
}

function renderHosts() {
  ui.ablesetHost.replaceChildren(
    ...hosts.map((h) => el('option', { value: h, text: `${h} (this computer)` })),
    el('option', { value: 'custom', text: 'Another computer…' }),
  );
  const wanted = prefs.ablesetHost;
  ui.ablesetHost.value = wanted && [...ui.ablesetHost.options].some((o) => o.value === wanted) ? wanted : (hosts[0] ?? 'custom');
  ui.ablesetCustomWrap.classList.toggle('hidden', ui.ablesetHost.value !== 'custom');
}

function render() {
  for (const tab of ui.tabs) {
    tab.className = tab.dataset.app === app ? 'primary' : 'ghost';
    tab.setAttribute('aria-selected', String(tab.dataset.app === app));
  }
  ui.ablesetOptions.classList.toggle('hidden', app !== 'ableset');
  ui.customOptions.classList.toggle('hidden', app !== 'custom');
  ui.hint.textContent = HINTS[app];

  const { url, error } = target();
  if (!url) {
    ui.qr.replaceChildren();
    ui.url.textContent = error;
    ui.others.replaceChildren();
    return;
  }
  try {
    ui.qr.replaceChildren(qrSvg(url));
    ui.url.textContent = url;
  } catch (e) {
    ui.qr.replaceChildren();
    ui.url.textContent = e.message;
  }
  ui.others.replaceChildren(
    ...(app === 'fixmymix' && urls.length > 1
      ? urls.map((u) => el('button', { type: 'button', class: u === chosen ? 'primary' : 'ghost', text: u.replace(/^https?:\/\//, ''), onclick: () => { chosen = u; render(); } }))
      : []),
  );
}

async function refresh() {
  try {
    const info = await (await fetch('/api/info', { cache: 'no-store' })).json();
    const next = info.urls ?? [];
    if (next.join() !== urls.join()) {
      urls = next;
      hosts = urls.map((u) => new URL(u).hostname);
      renderHosts();
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

for (const tab of ui.tabs) tab.addEventListener('click', () => { app = tab.dataset.app; save(); render(); });
ui.ablesetHost.addEventListener('change', () => {
  prefs.ablesetHost = ui.ablesetHost.value;
  ui.ablesetCustomWrap.classList.toggle('hidden', ui.ablesetHost.value !== 'custom');
  save();
  render();
});
for (const input of [ui.ablesetPort, ui.ablesetCustom, ui.customUrl]) input.addEventListener('input', () => { save(); render(); });

if (prefs.ablesetPort !== undefined) ui.ablesetPort.value = prefs.ablesetPort;
if (prefs.ablesetCustom) ui.ablesetCustom.value = prefs.ablesetCustom;
if (prefs.customUrl) ui.customUrl.value = prefs.customUrl;
renderHosts();
render();
refresh();
setInterval(refresh, 15_000); // the address changes when the Wi-Fi does
