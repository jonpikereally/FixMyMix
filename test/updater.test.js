import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { compareVersions, pickAsset, bundlePath, installable, fetchLatest, download, readBundleVersion, INSTALL_SCRIPT } from '../desktop/updater.js';

test('version compare is numeric, tolerant of a v prefix and short forms', () => {
  assert.equal(compareVersions('0.2.0', '0.2.0'), 0);
  assert.equal(compareVersions('v0.2.0', '0.2'), 0);
  assert.equal(compareVersions('0.10.0', '0.9.1'), 1);
  assert.equal(compareVersions('0.2.0', '0.2.1'), -1);
  assert.equal(compareVersions('1.0.0', '0.99.99'), 1);
});

test('picks the mac zip, ignoring the dmg', () => {
  const assets = [{ name: 'FixMyMix-0.3.0.dmg' }, { name: 'FixMyMix-0.3.0-mac.zip' }];
  assert.equal(pickAsset(assets).name, 'FixMyMix-0.3.0-mac.zip');
  assert.equal(pickAsset([{ name: 'FixMyMix-0.3.0.dmg' }]), null);
  assert.equal(pickAsset(undefined), null);
});

test('finds the bundle from the executable path and refuses unsafe locations', () => {
  assert.equal(bundlePath('/Applications/FixMyMix.app/Contents/MacOS/FixMyMix'), '/Applications/FixMyMix.app');
  assert.equal(bundlePath('/home/user/FixMyMix/node_modules/electron/dist/electron'), null);
  assert.equal(installable('/Applications/FixMyMix.app').ok, true);
  assert.equal(installable('/Volumes/FixMyMix 0.2.0/FixMyMix.app').ok, false);
  assert.equal(installable('/private/var/folders/x/AppTranslocation/abc/d/FixMyMix.app').ok, false);
  assert.equal(installable(null).ok, false);
});

test('fetchLatest reads the release and its zip asset', async () => {
  const fetchImpl = async (url, opts) => {
    assert.match(url, /releases\/latest$/);
    assert.equal(opts.headers['User-Agent'], 'FixMyMix-updater');
    return { ok: true, json: async () => ({ tag_name: 'v0.3.0', name: 'FixMyMix v0.3.0', html_url: 'https://example/rel', body: 'notes', assets: [{ name: 'FixMyMix-0.3.0-mac.zip', browser_download_url: 'https://example/zip', size: 5 }] }) };
  };
  const latest = await fetchLatest({ fetchImpl });
  assert.deepEqual(latest, { version: '0.3.0', name: 'FixMyMix v0.3.0', url: 'https://example/rel', notes: 'notes', asset: { name: 'FixMyMix-0.3.0-mac.zip', url: 'https://example/zip', size: 5 } });
  await assert.rejects(fetchLatest({ fetchImpl: async () => ({ ok: false, status: 403 }) }), /403/);
});

test('download streams to disk and reports progress', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fmm-up-'));
  const dest = path.join(dir, 'a', 'file.zip');
  const chunks = [Buffer.from('hello '), Buffer.from('world')];
  const fetchImpl = async () => ({ ok: true, headers: { get: () => String(11) }, body: (async function* () { for (const c of chunks) yield c; })() });
  const seen = [];
  await download('https://example/zip', dest, { fetchImpl, onProgress: (f) => seen.push(f) });
  assert.equal(fs.readFileSync(dest, 'utf8'), 'hello world');
  assert.deepEqual(seen.map((f) => Math.round(f * 100)), [55, 100]);
});

test('reads the version out of a bundle plist; the install script is a careful swap', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fmm-app-'));
  const bundle = path.join(dir, 'FixMyMix.app');
  fs.mkdirSync(path.join(bundle, 'Contents'), { recursive: true });
  fs.writeFileSync(path.join(bundle, 'Contents', 'Info.plist'), '<plist><dict><key>CFBundleShortVersionString</key>\n<string>0.3.0</string></dict></plist>');
  assert.equal(readBundleVersion(bundle), '0.3.0');
  assert.equal(readBundleVersion(path.join(dir, 'nope.app')), null);
  assert.match(INSTALL_SCRIPT, /kill -0 "\$PID"/);
  assert.match(INSTALL_SCRIPT, /mv "\$APP" "\$APP\.old" && mv "\$NEW" "\$APP"/);
  assert.match(INSTALL_SCRIPT, /xattr -dr com\.apple\.quarantine/);
  assert.match(INSTALL_SCRIPT, /open "\$APP"/);
});
