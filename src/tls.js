// Optional HTTPS for LAN mode. Browsers only expose Web MIDI on secure pages,
// so a stage laptop with a controller needs an https:// address. The cert is
// self-signed (each device accepts it once); openssl ships with macOS and most
// Linux distributions.

import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';

export function tlsFiles(dataDir) {
  return { key: path.join(dataDir, 'key.pem'), cert: path.join(dataDir, 'cert.pem') };
}

export function loadTls(dataDir) {
  const files = tlsFiles(dataDir);
  try {
    return { key: fs.readFileSync(files.key), cert: fs.readFileSync(files.cert) };
  } catch {
    return null;
  }
}

export function createCertificate(dataDir) {
  const files = tlsFiles(dataDir);
  fs.mkdirSync(dataDir, { recursive: true });
  const args = ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '3650', '-subj', '/CN=FixMyMix', '-keyout', files.key, '-out', files.cert];
  return new Promise((resolve, reject) => {
    execFile('openssl', args, (error, _stdout, stderr) => {
      if (error) {
        const hint = error.code === 'ENOENT' ? 'openssl is not installed.' : stderr.trim() || error.message;
        return reject(new Error(`Could not create a certificate: ${hint}`));
      }
      try {
        fs.chmodSync(files.key, 0o600);
      } catch {
        // Windows; permissions do not apply.
      }
      resolve(files);
    });
  });
}
