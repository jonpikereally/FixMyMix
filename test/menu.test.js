import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMenu } from '../desktop/menu.js';

function actionsSpy() {
  const calls = [];
  const spy = (name) => (...args) => calls.push([name, ...args]);
  return { calls, actions: { copy: spy('copy'), open: spy('open'), start: spy('start'), stop: spy('stop'), toggleLogin: spy('toggleLogin'), quit: spy('quit') } };
}

const labels = (items) => items.map((i) => i.label ?? '---');
const find = (items, label) => items.find((i) => i.label === label);

test('running menu shows addresses, passcode and open/stop actions', () => {
  const { calls, actions } = actionsSpy();
  const items = buildMenu({ running: true, starting: false, error: null, urls: ['http://10.0.0.5:8080'], passcode: '482913', port: 8080, loginItem: false }, actions);
  assert.deepEqual(labels(items), [
    'FixMyMix is running', '---', 'Performers open (click to copy):', 'http://10.0.0.5:8080', 'Admin passcode: 482913',
    '---', 'Open admin board', 'Open stage view', '---', 'Stop server', 'Start at login', '---', 'Quit FixMyMix',
  ]);
  find(items, 'http://10.0.0.5:8080').click();
  find(items, 'Admin passcode: 482913').click();
  find(items, 'Open admin board').click();
  find(items, 'Stop server').click();
  assert.deepEqual(calls, [['copy', 'http://10.0.0.5:8080'], ['copy', '482913'], ['open', 'http://localhost:8080/admin'], ['stop']]);
  assert.equal(find(items, 'Start at login').type, 'checkbox');
  assert.equal(find(items, 'Start at login').checked, false);
});

test('stopped and errored menus offer to start', () => {
  const { calls, actions } = actionsSpy();
  const stopped = buildMenu({ running: false, starting: false, error: null, urls: [], passcode: null, port: 8080, loginItem: true }, actions);
  assert.deepEqual(labels(stopped), ['FixMyMix is stopped', '---', 'Start server', 'Start at login', '---', 'Quit FixMyMix']);
  assert.equal(find(stopped, 'Start at login').checked, true);
  find(stopped, 'Start server').click();
  assert.deepEqual(calls, [['start']]);

  const errored = buildMenu({ running: false, starting: false, error: 'port 8080 is already in use', urls: [], passcode: null, port: 8080, loginItem: false }, actions);
  assert.equal(errored[0].label, 'FixMyMix stopped: port 8080 is already in use');
  assert.ok(find(errored, 'Try again'));
});

test('starting menu disables the start item', () => {
  const { actions } = actionsSpy();
  const items = buildMenu({ running: false, starting: true, error: null, urls: [], passcode: null, port: 8080, loginItem: false }, actions);
  assert.equal(items[0].label, 'Starting FixMyMix…');
  assert.equal(find(items, 'Start server').enabled, false);
});
