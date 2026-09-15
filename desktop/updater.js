// In-app updates without Apple code signing: ask GitHub for the latest
// release, download the zipped app, and swap it into place with a small shell
// script once the app has quit. The pieces that decide things are plain
// functions so they can be tested; the pieces that touch the disk are thin.

import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';

export const REPO = 'jonpikereally/FixMyMix';
export const RELEASES_URL = `https://github.com/${REPO}/releases`;
const API_LATEST = `https://api.github.com/repos/${REPO}/releases/latest`;
const USER_AGENT = 'FixMyMix-updater';

/** Numeric dotted compare: 0.10.0 > 0.9.1. Returns -1, 0 or 1. */
export function compareVersions(a, b) {
  const parse = (v) => String(v).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** The zipped app for this platform: FixMyMix-<version>-mac.zip. */
export function pickAsset(assets) {
  const list = Array.isArray(assets) ? assets : [];
  return list.find((a) => /-mac\.zip$/i.test(a.name)) ?? list.find((a) => /\.zip$/i.test(a.name)) ?? null;
}

/** …/FixMyMix.app from the running executable's path, or null when not in a bundle. */
export function bundlePath(exePath) {
  const parts = String(exePath).split(path.sep);
  const index = parts.findLastIndex((p) => p.endsWith('.app'));
  if (index === -1) return null;
  return parts.slice(0, index + 1).join(path.sep);
}

/** Bundles inside a mounted disk image or a translocated copy cannot update themselves. */
export function installable(bundle) {
  if (!bundle) return { ok: false, reason: 'FixMyMix is running from the source folder, not an installed app.' };
  if (bundle.startsWith('/Volumes/')) return { ok: false, reason: 'FixMyMix is running from the disk image. Drag it to Applications first.' };
  if (bundle.includes('/AppTranslocation/')) return { ok: false, reason: 'macOS is running a temporary copy. Move FixMyMix to Applications and open it from there.' };
  return { ok: true };
}

export async function fetchLatest({ fetchImpl = fetch, apiUrl = API_LATEST } = {}) {
  const res = await fetchImpl(apiUrl, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/vnd.github+json' } });
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
  const release = await res.json();
  const asset = pickAsset(release.assets);
  return {
    version: String(release.tag_name ?? '').replace(/^v/, ''),
    name: release.name ?? release.tag_name,
    url: release.html_url ?? RELEASES_URL,
    notes: release.body ?? '',
    asset: asset ? { name: asset.name, url: asset.browser_download_url, size: asset.size ?? 0 } : null,
  };
}

export async function download(url, dest, { fetchImpl = fetch, onProgress = () => {} } = {}) {
  const res = await fetchImpl(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`);
  const total = Number(res.headers.get('content-length')) || 0;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const file = fs.createWriteStream(dest);
  let received = 0;
  for await (const chunk of res.body) {
    received += chunk.length;
    if (!file.write(chunk)) await new Promise((resolve) => file.once('drain', resolve));
    onProgress(total ? received / total : 0, received, total);
  }
  await new Promise((resolve, reject) => { file.on('error', reject); file.end(resolve); });
  return dest;
}

/** Unzips with macOS's ditto (keeps bundle metadata; unzip elsewhere) and returns the .app inside. */
export function extractApp(zip, dir) {
  return new Promise((resolve, reject) => {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const [tool, args] = process.platform === 'darwin' ? ['ditto', ['-x', '-k', zip, dir]] : ['unzip', ['-q', zip, '-d', dir]];
    execFile(tool, args, (error) => {
      if (error) return reject(new Error(`Could not unpack the update: ${error.message}`));
      const app = fs.readdirSync(dir).find((name) => name.endsWith('.app'));
      if (!app) return reject(new Error('The update did not contain an app.'));
      resolve(path.join(dir, app));
    });
  });
}

export function readBundleVersion(bundle) {
  try {
    const plist = fs.readFileSync(path.join(bundle, 'Contents', 'Info.plist'), 'utf8');
    return plist.match(/<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/)?.[1] ?? null;
  } catch {
    return null;
  }
}

/** Waits for the running app to exit, swaps the bundles, clears quarantine, relaunches. */
export const INSTALL_SCRIPT = `#!/bin/sh
# FixMyMix updater: runs after the app quits.
APP="$1"; NEW="$2"; PID="$3"
i=0
while kill -0 "$PID" 2>/dev/null && [ "$i" -lt 120 ]; do sleep 0.5; i=$((i+1)); done
rm -rf "$APP.old"
if mv "$APP" "$APP.old" && mv "$NEW" "$APP"; then
  rm -rf "$APP.old"
else
  mv "$APP.old" "$APP" 2>/dev/null
  exit 1
fi
xattr -dr com.apple.quarantine "$APP" 2>/dev/null
open "$APP"
`;

export function launchInstaller({ bundle, fresh, pid, scriptDir }) {
  fs.mkdirSync(scriptDir, { recursive: true });
  const script = path.join(scriptDir, 'install-update.sh');
  fs.writeFileSync(script, INSTALL_SCRIPT, { mode: 0o755 });
  const child = spawn('/bin/sh', [script, bundle, fresh, String(pid)], { detached: true, stdio: 'ignore' });
  child.unref();
  return script;
}
