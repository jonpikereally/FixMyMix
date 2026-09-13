const STALE_MS = 40_000;

/**
 * Keeps a live view of show state via Server-Sent Events. EventSource
 * reconnects on its own; the watchdog covers the case where the socket goes
 * silent without closing (sleeping phones do this), and the polling fallback
 * covers browsers with EventSource disabled.
 */
export function watchState({ onState, onStatus }) {
  let source = null;
  let lastMessage = 0;
  let lastRev = 0;
  let pollTimer = null;

  const apply = (snapshot) => {
    lastMessage = Date.now();
    if (snapshot.rev < lastRev) return;
    lastRev = snapshot.rev;
    onState(snapshot);
  };

  const open = () => {
    if (source) source.close();
    source = new EventSource('/api/stream');
    source.addEventListener('state', (event) => {
      onStatus(true);
      try {
        apply(JSON.parse(event.data));
      } catch (error) {
        console.error('Bad state frame', error);
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

  return () => {
    source?.close();
    clearInterval(pollTimer);
  };
}

export async function post(url, body = {}) {
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('Cannot reach the FixMyMix server. Are you on the show Wi-Fi?');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data.error || `Request failed (${res.status})`);
    error.code = data.code;
    error.status = res.status;
    throw error;
  }
  return data;
}

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
    navigator.vibrate?.(pattern);
  } catch {
    // Not supported; the visual confirmation is what matters.
  }
}
