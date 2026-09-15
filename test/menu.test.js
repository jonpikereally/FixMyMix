import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMenu, updateItems } from '../desktop/menu.js';

function actionsSpy() {
  const calls = [];
  const spy = (name) => (...args) => calls.push([name, ...args]);
  return { calls, actions: { copy: spy('copy'), open: spy('open'), start: spy('start'), stop: spy('stop'), toggleLogin: spy('toggleLogin'), quit: spy('quit'), toggleKeepAwake: spy('toggleKeepAwake'), openLog: spy('openLog'), checkForUpdates: spy('checkForUpdates'), downloadUpdate: spy('downloadUpdate'), installUpdate: spy('installUpdate') } };
}

const labels = (items) => items.map((i) => i.label ?? '---');
const find = (items, label) => items.find((i) => i.label === label);

test('running menu shows addresses, passcode and open/stop actions', () => {
  const { calls, actions } = actionsSpy();
  const items = buildMenu({ running: true, starting: false, error: null, urls: ['http://10.0.0.5:8080'], httpsUrls: [], passcode: '482913', port: 8080, devices: 3, keepAwake: true, loginItem: false, version: '0.3.0' }, actions);
  assert.deepEqual(labels(items), [
    'FixMyMix 0.3.0 is running', '3 devices connected', '---', 'Performers open (click to copy):', 'http://10.0.0.5:8080', 'Admin passcode: 482913',
    '---', 'Open admin board', 'Open stage view', 'Show QR code for performers', 'Show QR code for AbleSet', '---', 'Stop server', 'Start at login', 'Keep Mac awake while running', '---', 'Check for updates…', 'Open log', 'Quit FixMyMix',
  ]);
  find(items, 'Check for updates…').click();
  assert.equal(find(items, 'Keep Mac awake while running').checked, true);
  find(items, 'Keep Mac awake while running').click();
  find(items, 'Open log').click();
  find(items, 'http://10.0.0.5:8080').click();
  find(items, 'Admin passcode: 482913').click();
  find(items, 'Open admin board').click();
  find(items, 'Show QR code for performers').click();
  find(items, 'Show QR code for AbleSet').click();
  find(items, 'Stop server').click();
  assert.deepEqual(calls, [['checkForUpdates'], ['toggleKeepAwake'], ['openLog'], ['copy', 'http://10.0.0.5:8080'], ['copy', '482913'], ['open', 'http://localhost:8080/admin'], ['open', 'http://localhost:8080/join'], ['open', 'http://localhost:8080/join?app=ableset'], ['stop']]);
  assert.equal(find(items, 'Start at login').type, 'checkbox');
  assert.equal(find(items, 'Start at login').checked, false);
});

test('stopped and errored menus offer to start', () => {
  const { calls, actions } = actionsSpy();
  const stopped = buildMenu({ running: false, starting: false, error: null, urls: [], passcode: null, port: 8080, loginItem: true }, actions);
  assert.deepEqual(labels(stopped), ['FixMyMix is stopped', '---', 'Start server', 'Start at login', 'Keep Mac awake while running', '---', 'Check for updates…', 'Open log', 'Quit FixMyMix']);
  assert.equal(find(stopped, 'Start at login').checked, true);
  find(stopped, 'Start server').click();
  assert.deepEqual(calls, [['start']]);

  const errored = buildMenu({ running: false, starting: false, error: 'port 8080 is already in use', urls: [], passcode: null, port: 8080, loginItem: false }, actions);
  assert.equal(errored[0].label, 'FixMyMix stopped: port 8080 is already in use');
  assert.ok(find(errored, 'Try again'));
});

test('one device reads singular', () => {
  const { actions } = actionsSpy();
  const items = buildMenu({ running: true, starting: false, error: null, urls: [], httpsUrls: [], passcode: '1', port: 8080, devices: 1, loginItem: false }, actions);
  assert.equal(items[1].label, '1 device connected');
});

test('the https address is listed for MIDI laptops', () => {
  const { calls, actions } = actionsSpy();
  const items = buildMenu({ running: true, starting: false, error: null, urls: ['http://10.0.0.5:8080'], httpsUrls: ['https://10.0.0.5:8080'], passcode: '1', port: 8080, loginItem: false }, actions);
  find(items, 'https://10.0.0.5:8080  (MIDI)').click();
  assert.deepEqual(calls, [['copy', 'https://10.0.0.5:8080']]);
});

test('starting menu disables the start item', () => {
  const { actions } = actionsSpy();
  const items = buildMenu({ running: false, starting: true, error: null, urls: [], passcode: null, port: 8080, loginItem: false }, actions);
  assert.equal(items[0].label, 'Starting FixMyMix…');
  assert.equal(find(items, 'Start server').enabled, false);
});

test('update items follow the updater state machine', () => {
  const { calls, actions } = actionsSpy();
  const l = (u) => updateItems(u, actions).map((i) => i.label);
  assert.deepEqual(l({ status: 'checking' }), ['Checking for updates…']);
  assert.deepEqual(l({ status: 'uptodate', version: '0.3.0' }), ['Up to date (0.3.0) — check again']);
  assert.deepEqual(l({ status: 'available', version: '0.4.0' }), ['Update to 0.4.0 — download']);
  assert.deepEqual(l({ status: 'downloading', version: '0.4.0', progress: 45 }), ['Downloading 0.4.0… 45%']);
  assert.deepEqual(l({ status: 'ready', version: '0.4.0' }), ['Install 0.4.0 and relaunch']);
  assert.deepEqual(l({ status: 'error', message: 'offline' }), ['Update failed: offline', 'Try again']);
  assert.deepEqual(l({ status: 'unsupported' }), ['Updates apply to the installed app']);
  updateItems({ status: 'available', version: '0.4.0' }, actions)[0].click();
  updateItems({ status: 'ready', version: '0.4.0' }, actions)[0].click();
  updateItems({ status: 'error' }, actions)[1].click();
  assert.deepEqual(calls, [['downloadUpdate'], ['installUpdate'], ['checkForUpdates']]);
  assert.equal(updateItems({ status: 'downloading', version: '1', progress: 5 }, actions)[0].enabled, false);
});

test('port 80 gives port-less local links', () => {
  const { calls, actions } = actionsSpy();
  const items = buildMenu({ running: true, starting: false, error: null, urls: ['http://10.0.0.5'], httpsUrls: [], passcode: '1', port: 80, loginItem: false }, actions);
  find(items, 'Open admin board').click();
  assert.deepEqual(calls, [['open', 'http://localhost/admin']]);
});
