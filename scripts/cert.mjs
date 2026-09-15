// `npm run cert`: create the self-signed certificate that turns on https://
// (needed for MIDI controllers on devices other than the one running the server).

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCertificate, loadTls } from '../src/tls.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = process.env.FIXMYMIX_DATA_DIR || path.join(root, 'data');

if (loadTls(dataDir)) {
  console.log(`A certificate already exists in ${dataDir}. Delete key.pem and cert.pem there to make a new one.`);
} else {
  const files = await createCertificate(dataDir);
  console.log(`Wrote ${files.cert} and ${files.key}.`);
  console.log('Restart FixMyMix and the same address will also work as https://.');
}
