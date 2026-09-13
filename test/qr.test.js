import { test } from 'node:test';
import assert from 'node:assert/strict';
import { qrMatrix } from '../public/js/qr.js';

test('picks the smallest version that fits and sizes the matrix accordingly', () => {
  assert.equal(qrMatrix('x').version, 1);
  assert.equal(qrMatrix('a'.repeat(14)).version, 1);
  assert.equal(qrMatrix('a'.repeat(15)).version, 2);
  assert.equal(qrMatrix('http://192.168.1.23:8080').version, 2);
  assert.equal(qrMatrix('a'.repeat(213)).version, 10);
  assert.throws(() => qrMatrix('a'.repeat(214)), /too long/);
  for (const v of [1, 2, 10]) assert.equal(qrMatrix('a'.repeat(v === 1 ? 1 : v === 2 ? 20 : 213)).size, 17 + 4 * v);
});

test('function patterns are in place', () => {
  const { size, modules } = qrMatrix('http://10.0.0.5:8080');
  const dark = (x, y) => modules[y][x];
  // finder centres and their light ring
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    assert.equal(dark(cx, cy), true);
    assert.equal(dark(cx + 2, cy), false);
    assert.equal(dark(cx + 3, cy), true);
  }
  // timing patterns alternate starting dark
  for (let i = 8; i < size - 8; i++) {
    assert.equal(dark(i, 6), i % 2 === 0);
    assert.equal(dark(6, i), i % 2 === 0);
  }
  assert.equal(dark(8, size - 8), true, 'always-dark module');
});

test('format information is a valid BCH code word for level M and the chosen mask', () => {
  for (const text of ['x', 'http://192.168.1.23:8080', 'b'.repeat(120)]) {
    const { size, modules, mask } = qrMatrix(text);
    const bits = [];
    for (let i = 0; i <= 5; i++) bits.push(modules[i][8]);
    bits.push(modules[7][8], modules[8][8], modules[8][7]);
    for (let i = 9; i < 15; i++) bits.push(modules[8][14 - i]);
    let value = 0;
    bits.forEach((bit, i) => { if (bit) value |= 1 << i; });
    value ^= 0x5412;
    // data = level bits (M = 00) then mask; BCH remainder must be zero
    assert.equal(value >>> 10, mask);
    let rem = value;
    for (let i = 14; i >= 10; i--) if ((rem >>> i) & 1) rem ^= 0x537 << (i - 10);
    assert.equal(rem, 0);
    // the second copy must match the first
    const copy = [];
    for (let i = 0; i < 8; i++) copy.push(modules[8][size - 1 - i]);
    for (let i = 8; i < 15; i++) copy.push(modules[size - 15 + i][8]);
    assert.deepEqual(copy, bits);
  }
});

test('output is deterministic and roughly balanced', () => {
  const a = qrMatrix('hello');
  const b = qrMatrix('hello');
  assert.deepEqual(a.modules, b.modules);
  const dark = a.modules.flat().filter(Boolean).length;
  const ratio = dark / (a.size * a.size);
  assert.ok(ratio > 0.35 && ratio < 0.65, `dark ratio ${ratio}`);
});
