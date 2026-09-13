// The show API, independent of transport: src/server.js adapts it to Node's
// http module, and the tests call it directly. Paths are relative to /api.

import { StoreError, MAX_MEMBERS, MAX_CHANNELS } from './state.js';

export const HEARTBEAT_MS = 15_000;
export const SESSION_SECONDS = 60 * 60 * 24 * 7;

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
  const frame = (snapshot) => `event: state\ndata: ${JSON.stringify(snapshot)}\n\n`;

  const unsubscribe = store.subscribe((snapshot) => {
    const chunk = frame(snapshot);
    for (const client of clients) client.write(chunk);
  });

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

  return {
    size: () => clients.size,
    attach(write) {
      const client = {
        write(chunk) {
          try {
            write(chunk);
          } catch {
            detach();
          }
        },
      };
      const detach = () => {
        clients.delete(client);
        if (!clients.size) stopHeartbeat();
      };
      client.write(`retry: 2000\n\n${frame(store.snapshot())}`);
      clients.add(client);
      startHeartbeat();
      return detach;
    },
    close() {
      unsubscribe();
      stopHeartbeat();
      clients.clear();
    },
  };
}

/**
 * @param {object} options
 * @param {import('./state.js').Store} options.store
 * @param {ReturnType<import('./auth.js').createAuth>} options.auth
 * @param {string} [options.cookieName]
 * @param {boolean} [options.secureCookies]  true when served over HTTPS
 */
export function createApi({ store, auth, cookieName = 'fmm_admin', secureCookies = false }) {
  const hub = createHub(store);
  const requestThrottle = createThrottle(12, 3000);
  const loginThrottle = createThrottle(8, 60_000);
  const cookieAttrs = `Path=/; HttpOnly; SameSite=Strict${secureCookies ? '; Secure' : ''}`;
  const ok = (json, headers = {}) => ({ status: 200, json, headers });

  const isAdmin = (req) => auth.isAdmin(req.cookies?.[cookieName]);
  const requireAdmin = async (req) => {
    if (!(await isAdmin(req))) throw new ApiError(401, 'Admin passcode required.', 'unauthorized');
  };
  const adminSession = () => ({ admin: true, passcode: auth.passcode });

  const routes = {
    'GET /state': () => ok(store.snapshot()),
    'GET /stream': () => ({ sse: true }),

    'GET /admin/session': async (req) => ok((await isAdmin(req)) ? adminSession() : { admin: false }),

    'POST /admin/login': async (req) => {
      if (!loginThrottle(req.ip ?? 'unknown')) throw new ApiError(429, 'Too many attempts. Wait a minute.', 'throttled');
      const body = await req.json();
      const token = await auth.login(String(body.passcode ?? '').trim());
      if (!token) throw new ApiError(401, 'Wrong passcode.', 'bad_passcode');
      return ok(adminSession(), { 'Set-Cookie': `${cookieName}=${token}; ${cookieAttrs}; Max-Age=${SESSION_SECONDS}` });
    },

    'POST /admin/logout': () => ok({ admin: false }, { 'Set-Cookie': `${cookieName}=; ${cookieAttrs}; Max-Age=0` }),

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

    'POST /admin/resolve': async (req) => {
      await requireAdmin(req);
      const body = await req.json();
      if (body.all === true) return ok({ resolved: store.resolveAll() });
      if (body.memberId) return ok({ resolved: store.resolveMember(String(body.memberId)) });
      if (body.requestId) return ok({ resolved: [store.resolveRequest(String(body.requestId))] });
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
      return ok(store.setShowName(body.name));
    },

    'POST /admin/history/clear': async (req) => {
      await requireAdmin(req);
      return ok(store.clearHistory());
    },
  };

  /**
   * @param {{ method: string, path: string, cookies?: object, ip?: string, json: () => Promise<object> }} req
   * @returns {Promise<{ status: number, json: object, headers: object } | { sse: true }>}
   */
  async function handle(req) {
    const handler = routes[`${req.method} ${req.path}`];
    if (!handler) throw new ApiError(404, 'No such endpoint.', 'not_found');
    try {
      return await handler(req);
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
