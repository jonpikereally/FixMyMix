const STALE_MS = 40_000;
const RETRY_DELAYS_MS = [300, 600, 1200, 2400, 3000, 3000, 3000, 3000];

/**
 * Keeps a live view of show state via Server-Sent Events. EventSource
 * reconnects on its own; the watchdog covers the case where the socket goes
 * silent without closing (sleeping phones do this), and the polling fallback
 * covers browsers with EventSource disabled.
 *
 * `url` may be a function so the stream can carry who this device is;
 * call the returned handle's reconnect() when that changes. One-off events
 * from the server (buzz) arrive through onEvent(name, data).
 */
export function watchState({ onState, onStatus, onEvent = () => {}, url = () => '/api/stream' }) {
  let source = null;
  let lastMessage = 0;
  let lastRev = 0;
  let pollTimer = null;

  const apply = (snapshot) => {
    lastMessage = Date.now();
    // Presence changes re-send the same rev, so only reject strictly older frames.
    if (snapshot.rev < lastRev) return;
    lastRev = snapshot.rev;
    onState(snapshot);
  };

  const open = () => {
    if (source) source.close();
    source = new EventSource(typeof url === 'function' ? url() : url);
    source.addEventListener('state', (event) => {
      onStatus(true);
      try {
        apply(JSON.parse(event.data));
      } catch (error) {
        console.error('Bad state frame', error);
      }
    });
    source.addEventListener('buzz', (event) => {
      lastMessage = Date.now();
      try {
        onEvent('buzz', JSON.parse(event.data));
      } catch {
        onEvent('buzz', {});
      }
    });
    source.onopen = () => {
      lastMessage = Date.now();
      onStatus(true);
    };
    source.onerror = () => onStatus(false);
  };

  const poll = async () => {
    try {
      const res = await fetch('/api/state', { cache: 'no-store' });
      if (res.ok) {
        onStatus(true);
        apply(await res.json());
      } else {
        onStatus(false);
      }
    } catch {
      onStatus(false);
    }
  };

  if (typeof EventSource === 'undefined') {
    poll();
    pollTimer = setInterval(poll, 2000);
  } else {
    open();
    pollTimer = setInterval(() => {
      if (Date.now() - lastMessage > STALE_MS) {
        onStatus(false);
        open();
      }
    }, 5000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        poll();
        if (source?.readyState === EventSource.CLOSED) open();
      }
    });
  }

  return {
    reconnect() {
      if (source) open();
    },
    stop() {
      source?.close();
      clearInterval(pollTimer);
    },
  };
}

function newOpId() {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * POSTs JSON. A Wi-Fi blip must not lose a tap, so network failures and 5xx
 * responses are retried for ~15 s; every attempt carries the same opId and
 * the server applies it once, so a retry of something that actually landed
 * is harmless. onRetry fires when the first attempt did not get through.
 */
export async function post(url, body = {}, { onRetry = () => {} } = {}) {
  const payload = JSON.stringify({ opId: newOpId(), ...body });
  let lastError = null;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) {
      onRetry(attempt);
      await wait(RETRY_DELAYS_MS[attempt - 1]);
    }
    let res;
    try {
      res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload });
    } catch {
      lastError = new Error('Cannot reach the FixMyMix server. Are you on the show Wi-Fi?');
      continue;
    }
    const data = await res.json().catch(() => ({}));
    if (res.ok) return data;
    const error = new Error(data.error || `Request failed (${res.status})`);
    error.code = data.code;
    error.status = res.status;
    if (res.status < 500) throw error;
    lastError = error;
  }
  throw lastError;
}

/**
 * Keeps the screen on while the page is open (a locked phone can't show a
 * green confirmation). Browsers drop the lock when the tab hides, so it is
 * re-requested on return. Silently does nothing where unsupported.
 */
let wakeLock = null;
let wakeWanted = false;
async function acquireWakeLock() {
  if (!wakeWanted || wakeLock || document.visibilityState !== 'visible') return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch {
    wakeLock = null;
  }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') acquireWakeLock(); });
export function keepScreenAwake(enabled) {
  wakeWanted = Boolean(enabled) && 'wakeLock' in navigator;
  if (!wakeWanted) {
    wakeLock?.release().catch(() => {});
    wakeLock = null;
    return;
  }
  acquireWakeLock();
}
export const wakeLockSupported = () => typeof navigator !== 'undefined' && 'wakeLock' in navigator;

let toastTimer = null;
export function toast(message, { error = false, ms = 2500 } = {}) {
  let el = document.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.toggle('error', error);
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), ms);
}

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (value !== null && value !== undefined) node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child);
  }
  return node;
}

export function ago(timestamp) {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

export function vibrate(pattern) {
  try {
    // Browsers ignore vibrate() before the first tap on the page (and Chrome
    // logs a warning each time), so don't bother until then.
    if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
    navigator.vibrate?.(pattern);
  } catch {
    // Not supported; the visual confirmation is what matters.
  }
}
