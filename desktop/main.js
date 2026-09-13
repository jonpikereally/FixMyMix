// Menu-bar app: runs the LAN server in-process and shows the address and
// passcode in the tray. No windows; everything happens in the browser.

import { app, Tray, Menu, nativeImage, clipboard, shell, dialog } from 'electron';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { start } from '../src/server.js';
import { createCertificate } from '../src/tls.js';
import { buildMenu } from './menu.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8080;
const SMOKE = process.env.FIXMYMIX_SMOKE === '1';

if (!app.requestSingleInstanceLock()) app.quit();

let tray = null;
let running = null;
let starting = false;
let error = null;
let lastMenuKey = '';

function state() {
  return {
    running: Boolean(running),
    starting,
    error,
    urls: running?.urls ?? [],
    httpsUrls: running?.httpsUrls ?? [],
    passcode: running?.passcode ?? null,
    port: running?.port ?? PORT,
    loginItem: app.getLoginItemSettings().openAtLogin,
  };
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
          ? `Devices with a MIDI controller open:\n${urls.join('\n')}\n\nThe first time, the browser will warn about the certificate — choose Advanced → Proceed.`
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
    running = await start({
      port: PORT,
      dataDir: dataDir(),
      log: (line) => console.log(line),
    });
  } catch (e) {
    error = e.code === 'EADDRINUSE' ? `port ${PORT} is already in use` : e.message;
  } finally {
    starting = false;
    refresh(true);
  }
}

async function stopServer() {
  const current = running;
  running = null;
  refresh(true);
  await current?.close();
}

// Rebuilding the menu while it is open closes it, so only rebuild on change.
function refresh(force = false) {
  if (!tray) return;
  const current = state();
  const key = JSON.stringify(current);
  if (!force && key === lastMenuKey) return;
  lastMenuKey = key;
  tray.setContextMenu(Menu.buildFromTemplate(buildMenu(current, actions)));
  tray.setToolTip(current.running ? `FixMyMix — ${current.urls[0] ?? `port ${PORT}`}` : 'FixMyMix (stopped)');
}

app.on('window-all-closed', () => {
  // A menu-bar app has no windows; stay alive.
});

app.whenReady().then(async () => {
  app.dock?.hide();
  const icon = nativeImage.createFromPath(path.join(here, 'trayTemplate.png'));
  icon.setTemplateImage(true);
  try {
    tray = new Tray(icon);
  } catch (e) {
    console.error(`No system tray available: ${e.message}`);
  }
  await startServer();
  refresh();
  setInterval(refresh, 10_000).unref?.(); // the LAN address changes when the Wi-Fi does
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
  console.log(`SMOKE ${JSON.stringify({ running: current.running, error: current.error, urls: current.urls, passcode: current.passcode, status, labels })}`);
  await stopServer();
  app.exit(status === 200 && current.running ? 0 : 1);
}
