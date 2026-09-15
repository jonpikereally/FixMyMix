// The show API, independent of transport: src/server.js adapts it to Node's
// http module, and the tests call it directly. Paths are relative to /api.

import { StoreError, MAX_MEMBERS, MAX_CHANNELS } from './state.js';
import { Setups, packSetup, setupFilename } from './setups.js';
import { PASSCODE_PATTERN } from './auth.js';

export const HEARTBEAT_MS = 15_000;
export const SESSION_SECONDS = 60 * 60 * 24 * 7;
export const OP_TTL_MS = 60_000;
const OP_CACHE_MAX = 2000;

export class ApiError extends Error {
  constructor(status, message, code = 'error') {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export function createThrottle(limit, windowMs, now = Date.now) {
  const hits = new Map();
  return (key) => {
    const t = now();
    const recent = (hits.get(key) ?? []).filter((stamp) => t - stamp < windowMs);
    if (recent.length >= limit) return false;
    recent.push(t);
    hits.set(key, recent);
    return true;
  };
}

/**
 * Fans store changes out to Server-Sent Events clients. `attach` takes a plain
 * write(chunk: string) function so the adapters decide what a connection is.
 * The heartbeat only runs while someone is connected.
 */
export function createHub(store, { heartbeatMs = HEARTBEAT_MS } = {}) {
  const clients = new Set();
  let heartbeat = null;

  // Who is connected right now: memberId -> open streams. Not persisted; it is
  // rebuilt from the live connections and sent inside every state frame.
  const online = new Map();
  const presence = () => ({ online: Object.fromEntries(online), devices: clients.size });
  const frame = (snapshot) => `event: state\ndata: ${JSON.stringify({ ...snapshot, presence: presence() })}\n\n`;
  const broadcast = (chunk) => {
    for (const client of clients) client.write(chunk);
  };
  const broadcastState = () => broadcast(frame(store.snapshot()));

  const unsubscribe = store.subscribe((snapshot) => broadcast(frame(snapshot)));

  const startHeartbeat = () => {
    if (heartbeat) return;
    heartbeat = setInterval(() => {
      for (const client of clients) client.write(': ping\n\n');
    }, heartbeatMs);
    heartbeat.unref?.();
  };
  const stopHeartbeat = () => {
    if (!heartbeat) return;
    clearInterval(heartbeat);
    heartbeat = null;
  };

  const track = (memberId, delta) => {
    if (!memberId) return;
    const next = (online.get(memberId) ?? 0) + delta;
    if (next > 0) online.set(memberId, next);
    else online.delete(memberId);
  };

  return {
    size: () => clients.size,
    presence,
    /** Sends a one-off event (buzz, …) to everyone, or only to one member's devices. */
    send(event, data = {}, { memberId = null } = {}) {
      const chunk = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
      for (const client of clients) if (!memberId || client.memberId === memberId) client.write(chunk);
    },
    attach(write, { memberId = null, end = () => {} } = {}) {
      let detached = false;
      const client = {
        memberId,
        end,
        write(chunk) {
          try {
            write(chunk);
          } catch {
            detach();
          }
        },
      };
      const detach = () => {
        if (detached) return;
        detached = true;
        clients.delete(client);
        track(memberId, -1);
        if (!clients.size) stopHeartbeat();
        else broadcastState();
      };
      clients.add(client);
      track(memberId, 1);
      client.write(`retry: 2000\n\n${frame(store.snapshot())}`);
      startHeartbeat();
      // Everyone else learns this device arrived (the board's presence dots).
      const chunk = frame(store.snapshot());
      for (const other of clients) if (other !== client) other.write(chunk);
      return detach;
    },
    close() {
      unsubscribe();
      stopHeartbeat();
      // End every live stream, or a server close would wait on them forever.
      for (const client of clients) {
        try {
          client.end();
        } catch {
          // Already gone.
        }
      }
      clients.clear();
      online.clear();
    },
  };
}

/**
 * @param {object} options
 * @param {import('./state.js').Store} options.store
 * @param {ReturnType<import('./auth.js').createAuth>} options.auth
 * @param {string} [options.cookieName]
 * @param {boolean} [options.secureCookies]  true when served over HTTPS
 * @param {(credentials: { passcode: string, secret: string }) => (void|Promise<void>)} [options.onCredentials]  persist a changed passcode
 */
export function createApi({ store, auth, setups = new Setups(), cookieName = 'fmm_admin', secureCookies = false, onCredentials = () => {} }) {
  const hub = createHub(store);
  // Results of recent POSTs by client-supplied opId, so a retried tap whose
  // first attempt actually landed is answered again rather than applied twice.
  const ops = new Map();
  const requestThrottle = createThrottle(12, 3000);
  const messageThrottle = createThrottle(6, 10_000);
  const loginThrottle = createThrottle(8, 60_000);
  const cookieAttrs = `Path=/; HttpOnly; SameSite=Strict${secureCookies ? '; Secure' : ''}`;
  const ok = (json, headers = {}) => ({ status: 200, json, headers });

  const isAdmin = (req) => auth.isAdmin(req.cookies?.[cookieName]);
  const requireAdmin = async (req) => {
    if (!(await isAdmin(req))) throw new ApiError(401, 'Admin passcode required.', 'unauthorized');
  };
  const adminSession = () => ({ admin: true, passcode: auth.passcode });

  const routes = {
    'GET /state': () => ok({ ...store.snapshot(), presence: hub.presence() }),
    'GET /stream': (req) => ({ sse: true, memberId: req.query?.memberId || null }),

    'GET /admin/session': async (req) => ok((await isAdmin(req)) ? adminSession() : { admin: false }),

    'POST /admin/login': async (req) => {
      if (!loginThrottle(req.ip ?? 'unknown')) throw new ApiError(429, 'Too many attempts. Wait a minute.', 'throttled');
      const body = await req.json();
      const token = await auth.login(String(body.passcode ?? '').trim());
      if (!token) throw new ApiError(401, 'Wrong passcode.', 'bad_passcode');
      return ok(adminSession(), { 'Set-Cookie': `${cookieName}=${token}; ${cookieAttrs}; Max-Age=${SESSION_SECONDS}` });
    },

    'POST /admin/logout': () => ok({ admin: false }, { 'Set-Cookie': `${cookieName}=; ${cookieAttrs}; Max-Age=0` }),

    // Changing the passcode rotates the secret, so other admin devices must
    // log in again; this device gets a fresh cookie in the same response.
    'POST /admin/passcode': async (req) => {
      await requireAdmin(req);
      const body = await req.json();
      const next = String(body.passcode ?? '').trim();
      if (!PASSCODE_PATTERN.test(next)) throw new ApiError(400, 'Passcode must be 4 to 12 digits.', 'bad_passcode');
      auth.setPasscode(next);
      await onCredentials({ passcode: auth.passcode, secret: auth.secret });
      const token = await auth.login(next);
      return ok(adminSession(), { 'Set-Cookie': `${cookieName}=${token}; ${cookieAttrs}; Max-Age=${SESSION_SECONDS}` });
    },

    'POST /requests': async (req) => {
      const body = await req.json();
      const memberId = String(body.memberId ?? '');
      if (!requestThrottle(memberId)) throw new ApiError(429, 'Slow down — the request is already on the board.', 'throttled');
      const request = store.submitRequest({
        memberId,
        channelId: String(body.channelId ?? ''),
        direction: String(body.direction ?? ''),
      });
      return ok({ request });
    },

    'POST /requests/cancel': async (req) => {
      const body = await req.json();
      const request = store.cancelRequest({
        memberId: String(body.memberId ?? ''),
        requestId: String(body.requestId ?? ''),
      });
      return ok({ request });
    },

    'POST /messages': async (req) => {
      const body = await req.json();
      const memberId = String(body.memberId ?? '');
      if (!messageThrottle(memberId)) throw new ApiError(429, 'Slow down — give the desk a moment.', 'throttled');
      return ok({ message: store.sendMemberMessage({ memberId, text: String(body.text ?? '') }) });
    },

    'POST /messages/ack': async (req) => {
      const body = await req.json();
      return ok({ message: store.ackMessage({ memberId: String(body.memberId ?? ''), messageId: String(body.messageId ?? '') }) });
    },

    'POST /admin/messages': async (req) => {
      await requireAdmin(req);
      const body = await req.json();
      return ok({ sent: store.sendAdminMessage({ memberId: String(body.memberId ?? ''), all: body.all === true, text: String(body.text ?? ''), buzz: body.buzz === true }) });
    },

    'POST /admin/resolve': async (req) => {
      await requireAdmin(req);
      const body = await req.json();
      if (body.all === true) return ok({ resolved: store.resolveAll() });
      if (body.memberId) return ok({ resolved: store.resolveMember(String(body.memberId)) });
      if (body.requestId) return ok({ resolved: [store.resolveRequest(String(body.requestId))] });
      if (body.messageId) return ok({ resolved: [store.resolveMessage(String(body.messageId))] });
      throw new ApiError(400, 'Nothing to resolve.');
    },

    'POST /admin/roster': async (req) => {
      await requireAdmin(req);
      const body = await req.json();
      if (Array.isArray(body.members)) {
        if (!body.members.length) throw new ApiError(400, 'Keep at least one performer in the roster.');
        return ok(store.setRoster(body.members));
      }
      const memberCount = Number(body.memberCount);
      const channelCount = Number(body.channelCount);
      if (!(memberCount >= 1 && memberCount <= MAX_MEMBERS)) throw new ApiError(400, `Members must be 1–${MAX_MEMBERS}.`);
      if (!(channelCount >= 1 && channelCount <= MAX_CHANNELS)) throw new ApiError(400, `Channels must be 1–${MAX_CHANNELS}.`);
      return ok(store.quickSetup(memberCount, channelCount));
    },

    'POST /admin/show': async (req) => {
      await requireAdmin(req);
      const body = await req.json();
      return ok(store.setShow({
        name: body.name === undefined ? undefined : String(body.name),
        messaging: body.messaging === undefined ? undefined : body.messaging === true,
        buzzDefault: body.buzzDefault === undefined ? undefined : body.buzzDefault === true,
      }));
    },

    // --- Saved band setups: roster + show settings under a name, plus JSON export/import.
    'GET /admin/setups': async (req) => {
      await requireAdmin(req);
      return ok({ setups: setups.summaries() });
    },

    'POST /admin/setups': async (req) => {
      await requireAdmin(req);
      const body = await req.json();
      const saved = setups.save({ name: String(body.name ?? ''), show: store.show, members: store.members });
      return ok({ saved: { id: saved.id, name: saved.name }, setups: setups.summaries() });
    },

    'POST /admin/setups/load': async (req) => {
      await requireAdmin(req);
      const body = await req.json();
      const setup = setups.get(String(body.id ?? ''));
      store.setRoster(setup.members);
      return ok({ loaded: { id: setup.id, name: setup.name }, ...store.setShow(setup.show) });
    },

    'POST /admin/setups/delete': async (req) => {
      await requireAdmin(req);
      const body = await req.json();
      const removed = setups.remove(String(body.id ?? ''));
      return ok({ removed: { id: removed.id, name: removed.name }, setups: setups.summaries() });
    },

    // A file download: the saved setup with that id, or the live roster when none is given.
    'GET /admin/setups/export': async (req) => {
      await requireAdmin(req);
      const id = req.query?.id;
      const setup = id
        ? setups.get(String(id))
        : packSetup({ id: undefined, name: store.show.name, savedAt: Date.now(), show: store.show, members: store.members });
      const { id: _omit, ...file } = setup;
      return ok(file, { 'Content-Disposition': `attachment; filename="${setupFilename(setup.name)}"` });
    },

    'POST /admin/setups/import': async (req) => {
      await requireAdmin(req);
      const body = await req.json();
      const fallbackName = String(body.filename ?? '').replace(/\.json$/i, '').replace(/^FixMyMix-/i, '').replace(/-+/g, ' ').trim() || 'Imported setup';
      const setup = setups.import(body.setup, { fallbackName });
      let snapshot = {};
      if (body.load === true) {
        store.setRoster(setup.members);
        snapshot = store.setShow(setup.show);
      }
      return ok({ imported: { id: setup.id, name: setup.name, loaded: body.load === true }, setups: setups.summaries(), ...snapshot });
    },

    'POST /admin/history/clear': async (req) => {
      await requireAdmin(req);
      return ok(store.clearHistory());
    },

    // Makes every connected stage device (or one member's) vibrate and flash:
    // the soundcheck "is everyone on?" test, and a mid-show attention getter.
    'POST /admin/buzz': async (req) => {
      await requireAdmin(req);
      const body = await req.json();
      const memberId = body.memberId ? String(body.memberId) : null;
      hub.send('buzz', { at: Date.now() }, { memberId });
      return ok({ devices: hub.size() });
    },
  };

  function rememberOp(opId, result) {
    if (!opId) return;
    if (ops.size >= OP_CACHE_MAX) ops.delete(ops.keys().next().value);
    ops.set(opId, { result, at: Date.now() });
  }

  function recallOp(opId) {
    if (!opId) return null;
    const hit = ops.get(opId);
    if (!hit) return null;
    if (Date.now() - hit.at > OP_TTL_MS) {
      ops.delete(opId);
      return null;
    }
    return hit.result;
  }

  /**
   * @param {{ method: string, path: string, query?: object, cookies?: object, ip?: string, json: () => Promise<object> }} req
   * @returns {Promise<{ status: number, json: object, headers: object } | { sse: true, memberId: string|null }>}
   */
  async function handle(req) {
    const handler = routes[`${req.method} ${req.path}`];
    if (!handler) throw new ApiError(404, 'No such endpoint.', 'not_found');
    let opId = null;
    if (req.method === 'POST') {
      // Read the body once and hand the same object to the route.
      const body = await req.json();
      opId = typeof body.opId === 'string' && body.opId.length <= 64 ? body.opId : null;
      const replay = recallOp(opId);
      if (replay) return replay;
      req = { ...req, json: async () => body };
    }
    try {
      const result = await handler(req);
      rememberOp(opId, result);
      return result;
    } catch (error) {
      if (error instanceof StoreError) throw new ApiError(409, error.message, error.code);
      throw error;
    }
  }

  return { handle, hub };
}

/** Turns any error into the JSON the client expects; logs the unexpected ones. */
export function errorResponse(error, log = console.error) {
  if (error instanceof ApiError) return { status: error.status, json: { error: error.message, code: error.code } };
  log(error);
  return { status: 500, json: { error: 'Something went wrong on the server.', code: 'server_error' } };
}
