// Every error a person can see must carry an FMM- code from public/js/errors.js.
// These tests fail when a new error is added without one.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { ERRORS, errorCode, withCode, codedError, describeError } from '../public/js/errors.js';
import { ApiError, errorResponse } from '../src/api.js';
import { renderErrorDocs, DOC_PATH } from '../scripts/error-docs.mjs';
import { installable } from '../desktop/updater.js';
import { start } from '../src/server.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const files = (dir, ext) => fs.readdirSync(path.join(ROOT, dir)).filter((f) => f.endsWith(ext)).map((f) => path.join(dir, f));
const SOURCES = [...files('src', '.js'), ...files('public/js', '.js'), ...files('desktop', '.js'), 'desktop/download-worker.cjs'];

test('codes are unique, well formed, and every entry explains itself', () => {
  const codes = Object.values(ERRORS).map((e) => e.code);
  assert.equal(new Set(codes).size, codes.length, 'duplicate code');
  for (const [slug, e] of Object.entries(ERRORS)) {
    assert.match(e.code, /^FMM-[A-Z]\d{2}$/, slug);
    assert.ok(e.message && e.help && e.area, `${slug} needs message, help and area`);
  }
});

test('every slug the code raises is in the catalogue, and every ApiError names one', () => {
  const used = new Map();
  const patterns = [
    /new ApiError\(\s*\d+\s*,[^;]*?,\s*'([a-z_]+)'\s*\)/g,
    /new StoreError\(\s*'([a-z_]+)'/g,
    /codedError\(\s*'([a-z_]+)'/g,
    /showError\(\s*'([a-z_]+)'/g,
    /coded\(\s*'([a-z_]+)'/g,
    /errorCode\(\s*'([a-z_]+)'/g,
    /(?<![/\w])ERRORS\.([a-z_]+)\.(?:message|code|help|area)\b/g,
    /ERRORS\[\s*'([a-z_]+)'\s*\]/g,
    /code: '([a-z_]+)', reason/g,
  ];
  for (const file of SOURCES) {
    const text = read(file);
    for (const re of patterns) for (const m of text.matchAll(re)) used.set(m[1], file);
    for (const m of text.matchAll(/new ApiError\(([^;]*?)\)\s*[;)]/g)) {
      // a quoted slug, or a StoreError's own slug passed through
      assert.match(m[1], /,\s*('[a-z_]+'|error\.code)\s*$/, `${file}: ApiError without an error slug: new ApiError(${m[1]})`);
    }
  }
  for (const [slug, file] of used) assert.ok(ERRORS[slug], `${file} uses "${slug}", which is not in public/js/errors.js`);
  assert.ok(used.size > 40, `expected to find most slugs in use, found ${used.size}`);
});

test('pages never show an uncoded error', () => {
  for (const file of files('public/js', '.js')) {
    if (file.endsWith('net.js')) continue; // defines toast/showError
    const text = read(file);
    assert.doesNotMatch(text, /error:\s*true/, `${file}: show errors with showError(), which adds the code`);
    assert.doesNotMatch(text, /toast\(\s*error\.message/, `${file}: toast(error.message) drops the code; use showError(error)`);
    if (!/errors\.js|qr\.js/.test(file)) assert.doesNotMatch(text, /new Error\(/, `${file}: throw codedError(slug) instead of new Error()`);
  }
  for (const file of ['desktop/updater.js', 'desktop/main.js']) {
    assert.doesNotMatch(read(file), /new Error\(/, `${file}: throw codedError(slug) instead of new Error()`);
  }
});

test('codes written into the HTML exist', () => {
  for (const file of files('public', '.html')) {
    for (const m of read(file).matchAll(/FMM-[A-Z]\d{2}/g)) {
      assert.ok(Object.values(ERRORS).some((e) => e.code === m[0]), `${file} mentions unknown ${m[0]}`);
    }
  }
  assert.match(read('public/stage.html'), /id="offline"[^>]*>[^<]*\(Error FMM-C01\)/);
  assert.match(read('public/admin.html'), /id="offline"[^>]*>[^<]*\(Error FMM-C02\)/);
});

test('docs/ERRORS.md is up to date (run npm run errors:doc)', () => {
  assert.equal(fs.readFileSync(DOC_PATH, 'utf8'), renderErrorDocs());
  for (const e of Object.values(ERRORS)) assert.ok(renderErrorDocs().includes(`| ${e.code} |`));
});

test('helpers format errors the same way everywhere', () => {
  assert.equal(withCode('Wrong passcode.', 'FMM-A02'), 'Wrong passcode. (Error FMM-A02)');
  assert.equal(errorCode('messaging_off'), 'FMM-P06');
  assert.equal(errorCode('no_such_slug'), 'FMM-X99');
  const e = codedError('wrong_passcode');
  assert.equal(e.code, 'wrong_passcode');
  assert.equal(e.errorCode, 'FMM-A02');
  assert.equal(describeError(e), 'Wrong passcode. (Error FMM-A02)');
  assert.equal(describeError(codedError('bad_setup', 'Custom text.')), 'Custom text. (Error FMM-S01)');
  assert.equal(describeError(new Error('raw')), 'raw (Error FMM-X99)');
  assert.equal(describeError({ message: 'From server', code: 'unknown_member', errorCode: 'FMM-P01' }), 'From server (Error FMM-P01)');
});

test('every API error body carries errorCode and help; unexpected faults are FMM-X01', () => {
  const known = errorResponse(new ApiError(409, 'That performer is no longer in the roster.', 'unknown_member'), () => {});
  assert.deepEqual(known.json, { error: 'That performer is no longer in the roster.', code: 'unknown_member', errorCode: 'FMM-P01', help: ERRORS.unknown_member.help });
  const logged = [];
  const crash = errorResponse(new TypeError('boom'), (line) => logged.push(line));
  assert.equal(crash.status, 500);
  assert.equal(crash.json.errorCode, 'FMM-X01');
  assert.match(logged[0], /^\[FMM-X01\] TypeError: boom/);
});

test('updater refusals carry codes', () => {
  assert.equal(installable(null).code, 'update_from_source');
  assert.equal(installable('/Volumes/FixMyMix/FixMyMix.app').code, 'update_from_dmg');
  assert.equal(installable('/private/var/folders/x/AppTranslocation/y/FixMyMix.app').code, 'update_translocated');
  assert.equal(installable('/Applications/FixMyMix.app').ok, true);
});

test('a real server answers API errors with codes and wrong pages with a readable coded line', async (t) => {
  const running = await start({ port: 0, dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'fmm-err-')), autoCert: false, log: () => {} });
  t.after(() => running.close());
  const get = (p, opts = {}) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: running.port, path: p, ...opts }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'], body }));
    });
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
  const api = await get('/api/nope');
  assert.equal(api.status, 404);
  assert.equal(JSON.parse(api.body).errorCode, 'FMM-R03');
  const page = await get('/no-such-page');
  assert.equal(page.status, 404);
  assert.match(page.type, /^text\/plain/);
  assert.match(page.body, /^FixMyMix: Page not found\. \(Error FMM-R04\)\n/);
  const badJson = await get('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{not json' });
  assert.equal(JSON.parse(badJson.body).errorCode, 'FMM-R01');
  const wrong = await get('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ passcode: '0000' }) });
  assert.deepEqual([wrong.status, JSON.parse(wrong.body).code, JSON.parse(wrong.body).errorCode], [401, 'wrong_passcode', 'FMM-A02']);
});
