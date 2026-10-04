// Writes docs/ERRORS.md from public/js/errors.js: `npm run errors:doc`.
// test/errors.test.js fails if the file is out of date.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ERRORS, ERRORS_DOC_URL, ERRORS_RAW_URL } from '../public/js/errors.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DOC_PATH = path.join(ROOT, 'docs', 'ERRORS.md');

const cell = (text) => String(text).replace(/\|/g, '\\|');

export function renderErrorDocs() {
  const byArea = new Map();
  for (const [slug, entry] of Object.entries(ERRORS)) {
    if (!byArea.has(entry.area)) byArea.set(entry.area, []);
    byArea.get(entry.area).push({ slug, ...entry });
  }
  const out = [
    '# FixMyMix error codes',
    '',
    '<!-- Generated from public/js/errors.js by `npm run errors:doc`. Do not edit by hand. -->',
    '',
    'Every error FixMyMix shows ends with a code, for example **(Error FMM-P06)**. Find the code below to see what happened and what to do.',
    '',
    `- **Asking an AI assistant?** Paste the whole error message including the code, and this link: ${ERRORS_DOC_URL} (plain text: ${ERRORS_RAW_URL}).`,
    '- **On the show Wi-Fi with no internet?** The same list is built into FixMyMix: open `/errors` on the FixMyMix address, e.g. `http://192.168.1.20:8080/errors`. Every error popup also has a Help link to it.',
    '- **For developers:** API error bodies carry `error` (the message), `code` (the slug), `errorCode` (the FMM- code), `help` and `helpUrl`.',
    '',
    '_For AI assistants: FixMyMix is a local app for live bands. Performers tap + / − on their phones to ask the sound engineer for more or less of a channel in their monitor mix; the engineer clears requests on an admin board. It runs on one Mac (a menu-bar app) on the venue Wi-Fi and needs no internet during the show. The admin passcode is shown in the FixMyMix menu-bar menu._',
    '',
    '## All codes',
    '',
    '| Code | Message |',
    '| --- | --- |',
    ...Object.values(ERRORS).map((e) => `| [${e.code}](#${e.code.toLowerCase()}) | ${cell(e.message)} |`),
    '',
  ];
  for (const [area, entries] of byArea) {
    out.push(`## ${area}`, '');
    for (const e of entries) {
      out.push(`### ${e.code}`, '', `- **Message:** ${e.message}`, `- **What it means and what to do:** ${e.help}`, `- **Slug:** \`${e.slug}\``, '');
    }
  }
  return out.join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  fs.mkdirSync(path.dirname(DOC_PATH), { recursive: true });
  fs.writeFileSync(DOC_PATH, renderErrorDocs());
  console.log(`Wrote ${path.relative(ROOT, DOC_PATH)} (${Object.keys(ERRORS).length} codes).`);
}
