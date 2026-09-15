// Admin auth. Web Crypto + TextEncoder only, so it runs unchanged in Node and
// in a browser-like runtime should another host ever be needed.

const encoder = new TextEncoder();

export function constantTimeEqual(a, b) {
  const x = encoder.encode(String(a ?? ''));
  const y = encoder.encode(String(b ?? ''));
  let diff = x.length ^ y.length;
  const length = Math.max(x.length, y.length);
  for (let i = 0; i < length; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

function base64url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomBytes(length) {
  return crypto.getRandomValues(new Uint8Array(length));
}

// Draws from `alphabet` without modulo bias by rejecting bytes past the largest
// multiple of the alphabet size.
function randomString(alphabet, length) {
  const limit = 256 - (256 % alphabet.length);
  let out = '';
  while (out.length < length) {
    for (const byte of randomBytes(length * 2)) {
      if (byte < limit) out += alphabet[byte % alphabet.length];
      if (out.length === length) break;
    }
  }
  return out;
}

export function randomPasscode() {
  return randomString('0123456789', 6);
}

export function randomSecret() {
  return Array.from(randomBytes(32), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function adminToken(secret) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode('fixmymix-admin'));
  return base64url(new Uint8Array(signature));
}

export function parseCookies(header) {
  const cookies = {};
  for (const part of String(header ?? '').split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    cookies[part.slice(0, index).trim()] = part.slice(index + 1).trim();
  }
  return cookies;
}

export const PASSCODE_PATTERN = /^\d{4,12}$/;

export function createAuth({ secret, passcode }) {
  let token = null;
  const currentToken = () => (token ??= adminToken(secret));
  return {
    get passcode() {
      return passcode;
    },
    get secret() {
      return secret;
    },
    async isAdmin(cookieValue) {
      if (!cookieValue) return false;
      return constantTimeEqual(cookieValue, await currentToken());
    },
    async login(attempt) {
      return constantTimeEqual(attempt, passcode) ? currentToken() : null;
    },
    /** New passcode and a new secret: every existing admin cookie stops working. */
    setPasscode(next) {
      if (!PASSCODE_PATTERN.test(String(next))) throw new Error('Passcode must be 4 to 12 digits.');
      passcode = String(next);
      secret = randomSecret();
      token = null;
    },
  };
}
