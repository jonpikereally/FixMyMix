// Writes docs/ERRORS.md from public/js/errors.js: `npm run errors:doc`.
// test/errors.test.js fails if the file is out of date.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ERRORS } from '../public/js/errors.js';

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
    'When asking an LLM for help, paste the whole message including the code.',
    '',
    'The API returns the same information in every error body: `error` (the message), `code` (the slug below), `errorCode` (the FMM- code) and `help`.',
    '',
  ];
  for (const [area, entries] of byArea) {
    out.push(`## ${area}`, '', '| Code | Slug | Message | What to do |', '| --- | --- | --- | --- |');
    for (const e of entries) out.push(`| ${e.code} | \`${e.slug}\` | ${cell(e.message)} | ${cell(e.help)} |`);
    out.push('');
  }
  return out.join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  fs.mkdirSync(path.dirname(DOC_PATH), { recursive: true });
  fs.writeFileSync(DOC_PATH, renderErrorDocs());
  console.log(`Wrote ${path.relative(ROOT, DOC_PATH)} (${Object.keys(ERRORS).length} codes).`);
}
