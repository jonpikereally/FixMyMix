// Menu-bar app: runs the LAN server in-process and shows the address and
// passcode in the tray. No windows; everything happens in the browser.

import { app, Tray, Menu, nativeImage, clipboard, shell, dialog, powerSaveBlocker } from 'electron';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { start } from '../src/server.js';
import { createCertificate } from '../src/tls.js';
import { buildMenu } from './menu.js';
import { compareVersions, fetchLatest, download, extractApp, readBundleVersion, bundlePath, installable, launchInstaller, RELEASES_URL } from './updater.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 80;
const SMOKE = process.env.FIXMYMIX_SMOKE === '1';
const WATCHDOG_MS = 10_000;
const LOG_MAX_BYTES = 1024 * 1024;
const UPDATE_CHECK_DELAY_MS = 20_000;
const UPDATE_CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
const UPDATE_API = process.env.FIXMYMIX_UPDATE_API || undefined; // test feeds

if (!app.requestSingleInstanceLock()) app.quit();

let tray = null;
let icons = null;
let running = null;
let starting = false;
let error = null;
let lastMenuKey = '';
let blockerId = null;
let watchdogFailures = 0;
let restarts = 0;
// In-app updater: idle → checking → available → downloading → ready → (install)
let update = { status: 'idle', version: null, progress: 0, message: null, latest: null, fresh: null };

// --- Log file: what happened, for when something goes wrong at a gig. -------
const logFile = () => path.join(app.getPath('userData'), 'fixmymix.log');
function log(line) {
  const stamped = `${new Date().toISOString()} ${line}`;
  console.log(stamped);
  try {
    fs.appendFileSync(logFile(), `${stamped}\n`);
  } catch {
    // Logging must never take the app down.
  }
}
function trimLog() {
  try {
    if (fs.statSync(logFile()).size > LOG_MAX_BYTES) fs.truncateSync(logFile(), 0);
  } catch {
    // No log yet.
  }
}

// --- Settings kept by the app itself (the server has its own data dir). ------
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
let settings = { keepAwake: true };
function loadSettings() {
  try {
    settings = { ...settings, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) };
  } catch {
    // First run.
  }
}
function saveSettings() {
  try {
    fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2));
  } catch (e) {
    log(`Could not save settings: ${e.message}`);
  }
}

// --- Keep the Mac from sleeping while the board is live. ---------------------
function syncPowerAssertion() {
  const want = Boolean(running) && settings.keepAwake;
  if (want && blockerId === null) {
    blockerId = powerSaveBlocker.start('prevent-app-suspension');
    log('Keeping the Mac awake while the server runs.');
  } else if (!want && blockerId !== null) {
    powerSaveBlocker.stop(blockerId);
    blockerId = null;
    log('Released the keep-awake assertion.');
  }
}

function state() {
  return {
    running: Boolean(running),
    starting,
    error,
    urls: running?.urls ?? [],
    httpsUrls: running?.httpsUrls ?? [],
    passcode: running?.passcode ?? null,
    port: running?.port ?? PORT,
    devices: running?.devices() ?? 0,
    keepAwake: settings.keepAwake,
    loginItem: app.getLoginItemSettings().openAtLogin,
    version: app.getVersion(),
    update: { status: update.status, version: update.version, progress: update.progress, message: update.message },
  };
}

// --- Updates -----------------------------------------------------------------
const updatesDir = () => path.join(app.getPath('userData'), 'updates');

function setUpdate(patch) {
  update = { ...update, ...patch };
  refresh(true);
}

async function checkForUpdates({ quiet = false } = {}) {
  if (['checking', 'downloading'].includes(update.status)) return;
  if (!app.isPackaged && !UPDATE_API) return setUpdate({ status: 'unsupported' });
  setUpdate({ status: 'checking', message: null });
  try {
    const latest = await fetchLatest({ apiUrl: UPDATE_API });
    if (latest.asset && compareVersions(latest.version, app.getVersion()) > 0) {
      log(`Update available: ${latest.version} (running ${app.getVersion()}).`);
      setUpdate({ status: 'available', version: latest.version, latest, fresh: null, progress: 0 });
    } else {
      setUpdate({ status: 'uptodate', version: app.getVersion(), latest });
    }
  } catch (e) {
    log(`Update check failed: ${e.message}`);
    setUpdate({ status: quiet ? 'idle' : 'error', message: e.message });
  }
}

async function downloadUpdate() {
  const { latest } = update;
  if (!latest?.asset || update.status === 'downloading') return;
  const zip = path.join(updatesDir(), latest.asset.name);
  setUpdate({ status: 'downloading', progress: 0 });
  try {
    let shown = -1;
    await download(latest.asset.url, zip, {
      onProgress: (fraction) => {
        const pct = Math.floor(fraction * 100);
        if (pct !== shown && pct % 5 === 0) {
          shown = pct;
          setUpdate({ progress: pct });
        }
      },
    });
    const fresh = await extractApp(zip, path.join(updatesDir(), 'unpacked'));
    const got = readBundleVersion(fresh);
    if (got && compareVersions(got, latest.version) !== 0) throw new Error(`downloaded ${got}, expected ${latest.version}`);
    fs.rmSync(zip, { force: true });
    log(`Update ${latest.version} downloaded and unpacked.`);
    setUpdate({ status: 'ready', fresh, progress: 100 });
  } catch (e) {
    log(`Update download failed: ${e.message}`);
    setUpdate({ status: 'error', message: e.message });
  }
}

async function installUpdate() {
  if (update.status !== 'ready' || !update.fresh) return;
  const bundle = app.isPackaged ? bundlePath(app.getPath('exe')) : null;
  const check = installable(bundle);
  if (!check.ok) {
    dialog.showMessageBox({ type: 'info', message: 'Cannot update this copy of FixMyMix', detail: `${check.reason}\n\nOr download the installer from ${RELEASES_URL}.` });
    return;
  }
  log(`Installing update ${update.version} over ${bundle} and relaunching.`);
  await stopServer();
  launchInstaller({ bundle, fresh: update.fresh, pid: process.pid, scriptDir: updatesDir() });
  app.exit(0);
}

const actions = {
  copy: (text) => clipboard.writeText(String(text)),
  open: (url) => shell.openExternal(url),
  start: startServer,
  stop: stopServer,
  toggleLogin() {
    app.setLoginItemSettings({ openAtLogin: !app.getLoginItemSettings().openAtLogin });
    refresh(true);
  },
  toggleKeepAwake() {
    settings.keepAwake = !settings.keepAwake;
    saveSettings();
    syncPowerAssertion();
    refresh(true);
  },
  openLog() {
    shell.openPath(logFile());
  },
  checkForUpdates: () => checkForUpdates(),
  downloadUpdate,
  installUpdate,
  async quit() {
    await stopServer();
    app.exit(0);
  },
  async setupHttps() {
    try {
      await createCertificate(dataDir());
      await stopServer();
      await startServer();
      const urls = running?.httpsUrls ?? [];
      dialog.showMessageBox({
        type: 'info',
        message: urls.length ? 'HTTPS is on.' : 'Certificate created, but https did not start.',
        detail: urls.length
          ? `Devices with a MIDI controller open:\n${urls.join('\n')}\n\nThe first time, the browser warns about the certificate: choose Advanced → Proceed (Safari: Show Details → visit this website). Phones keep using the plain http:// address from the QR code.`
          : 'Check the log for the reason.',
      });
    } catch (e) {
      dialog.showErrorBox('Could not set up HTTPS', e.message);
    }
  },
};

const dataDir = () => path.join(app.getPath('userData'), 'data');

async function startServer() {
  if (running || starting) return;
  starting = true;
  error = null;
  refresh(true);
  try {
    running = await start({ port: PORT, dataDir: dataDir(), log });
    watchdogFailures = 0;
    log(`Server running on ${running.urls.join(', ') || `port ${running.port}`}`);
  } catch (e) {
    error = e.code === 'EADDRINUSE' ? `port ${PORT} is already in use` : e.message;
    log(`Server failed to start: ${error}`);
  } finally {
    starting = false;
    syncPowerAssertion();
    refresh(true);
  }
}

async function stopServer() {
  const current = running;
  running = null;
  syncPowerAssertion();
  refresh(true);
  await current?.close();
  if (current) log('Server stopped.');
}

// --- Watchdog: if the server stops answering, restart it rather than sit dead.
async function watchdog() {
  if (!running || starting) return;
  const port = running.port;
  const alive = await new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/info', timeout: 3000 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
  if (alive) {
    watchdogFailures = 0;
    return;
  }
  watchdogFailures += 1;
  log(`Watchdog: server not answering (${watchdogFailures}).`);
  if (watchdogFailures >= 2) {
    restarts += 1;
    log(`Watchdog: restarting the server (restart #${restarts}).`);
    watchdogFailures = 0;
    await stopServer().catch(() => {});
    await startServer();
  }
}

process.on('uncaughtException', (e) => {
  log(`Uncaught error: ${e?.stack || e}`);
  if (!running && !starting) startServer();
});
process.on('unhandledRejection', (e) => {
  log(`Unhandled rejection: ${e?.stack || e}`);
});

// Rebuilding the menu while it is open closes it, so only rebuild on change.
function refresh(force = false) {
  if (!tray) return;
  const current = state();
  const key = JSON.stringify(current);
  if (!force && key === lastMenuKey) return;
  lastMenuKey = key;
  tray.setContextMenu(Menu.buildFromTemplate(buildMenu(current, actions)));
  tray.setImage(current.running ? icons.running : icons.stopped);
  tray.setToolTip(current.running ? `FixMyMix — ${current.urls[0] ?? `port ${PORT}`} · ${current.devices} connected` : 'FixMyMix (stopped)');
}

app.on('window-all-closed', () => {
  // A menu-bar app has no windows; stay alive.
});

app.whenReady().then(async () => {
  app.dock?.hide();
  trimLog();
  loadSettings();
  log(`FixMyMix ${app.getVersion()} starting.`);
  const load = (file) => {
    const image = nativeImage.createFromPath(path.join(here, file));
    image.setTemplateImage(true);
    return image;
  };
  icons = { running: load('trayTemplate.png'), stopped: load('trayStoppedTemplate.png') };
  try {
    tray = new Tray(icons.stopped);
  } catch (e) {
    log(`No system tray available: ${e.message}`);
  }
  await startServer();
  refresh();
  setInterval(refresh, 10_000).unref?.(); // the LAN address and device count change
  setInterval(watchdog, WATCHDOG_MS).unref?.();
  // Quiet checks: the menu just gains an "Update to X" line when there is one.
  setTimeout(() => checkForUpdates({ quiet: true }), UPDATE_CHECK_DELAY_MS).unref?.();
  setInterval(() => checkForUpdates({ quiet: true }), UPDATE_CHECK_EVERY_MS).unref?.();
  if (SMOKE) await smoke();
});

// FIXMYMIX_SMOKE=1: boot, prove the server answers, print the menu, exit.
async function smoke() {
  const current = state();
  const template = buildMenu(current, actions);
  Menu.buildFromTemplate(template);
  const status = await new Promise((resolve) => {
    http.get(`http://127.0.0.1:${PORT}/api/state`, (res) => resolve(res.statusCode)).on('error', () => resolve(0));
  });
  const labels = template.map((item) => item.label ?? (item.type === 'separator' ? '---' : '?'));
  await watchdog();
  const updateTrail = [];
  if (UPDATE_API) {
    await checkForUpdates();
    updateTrail.push(update.status);
    if (update.status === 'available') {
      await downloadUpdate();
      updateTrail.push(update.status, readBundleVersion(update.fresh ?? ''));
    }
    // Not installed in smoke mode: that would replace whatever launched us.
  }
  const logged = fs.existsSync(logFile());
  console.log(`SMOKE ${JSON.stringify({ running: current.running, error: current.error, urls: current.urls, passcode: current.passcode, status, labels: buildMenu(state(), actions).map((i) => i.label ?? (i.type === 'separator' ? '---' : '?')), keepAwake: blockerId !== null && powerSaveBlocker.isStarted(blockerId), logged, watchdogFailures, updateTrail })}`);
  await stopServer();
  app.exit(status === 200 && current.running ? 0 : 1);
}
