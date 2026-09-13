// A small QR code encoder — byte mode, versions 1–10, error correction level M —
// so the join page can show a scannable address with no network and no library.
// Structure follows the ISO 18004 steps: segment → codewords → Reed-Solomon
// blocks → interleave → place → mask (lowest penalty wins) → format bits.

const VERSIONS = [
  // [version, total codewords, EC codewords per block, blocks] at level M
  null,
  [1, 26, 10, 1], [2, 44, 16, 1], [3, 70, 26, 1], [4, 100, 18, 2], [5, 134, 24, 2],
  [6, 172, 16, 4], [7, 196, 18, 4], [8, 242, 22, 4], [9, 292, 22, 5], [10, 346, 26, 5],
];
const FORMAT_BITS_M = 0;

// --- GF(256) arithmetic for Reed-Solomon ------------------------------------

function gfMultiply(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

function rsDivisor(degree) {
  const result = new Array(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = gfMultiply(result[j], root);
      if (j + 1 < degree) result[j] ^= result[j + 1];
    }
    root = gfMultiply(root, 0x02);
  }
  return result;
}

function rsRemainder(data, divisor) {
  const result = new Array(divisor.length).fill(0);
  for (const byte of data) {
    const factor = byte ^ result.shift();
    result.push(0);
    divisor.forEach((coef, i) => { result[i] ^= gfMultiply(coef, factor); });
  }
  return result;
}

// --- Codewords -----------------------------------------------------------------

function chooseVersion(byteCount) {
  for (let v = 1; v <= 10; v++) {
    const [, total, ec, blocks] = VERSIONS[v];
    const dataBits = (total - ec * blocks) * 8;
    const needed = 4 + (v <= 9 ? 8 : 16) + byteCount * 8;
    if (needed <= dataBits) return v;
  }
  throw new Error('Text too long for a QR code here (max ~200 characters).');
}

function dataCodewords(bytes, version) {
  const [, total, ec, blocks] = VERSIONS[version];
  const capacity = total - ec * blocks;
  const bits = [];
  const push = (value, count) => { for (let i = count - 1; i >= 0; i--) bits.push((value >>> i) & 1); };
  push(0b0100, 4);
  push(bytes.length, version <= 9 ? 8 : 16);
  for (const byte of bytes) push(byte, 8);
  push(0, Math.min(4, capacity * 8 - bits.length));
  while (bits.length % 8) bits.push(0);
  const out = [];
  for (let i = 0; i < bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  for (let pad = 0xec; out.length < capacity; pad ^= 0xec ^ 0x11) out.push(pad);
  return out;
}

function interleave(data, version) {
  const [, total, ecLen, blocks] = VERSIONS[version];
  const shortBlocks = blocks - (total % blocks);
  const shortLen = Math.floor(total / blocks);
  const divisor = rsDivisor(ecLen);
  const parts = [];
  for (let i = 0, k = 0; i < blocks; i++) {
    const len = shortLen - ecLen + (i < shortBlocks ? 0 : 1);
    const dat = data.slice(k, k + len);
    k += len;
    const ecc = rsRemainder(dat, divisor);
    if (i < shortBlocks) dat.push(null); // placeholder so columns line up
    parts.push(dat.concat(ecc));
  }
  const result = [];
  for (let i = 0; i < parts[0].length; i++) {
    for (const part of parts) if (part[i] !== null) result.push(part[i]);
  }
  return result;
}

// --- Matrix ----------------------------------------------------------------------

function alignmentPositions(version) {
  if (version === 1) return [];
  const count = Math.floor(version / 7) + 2;
  const size = version * 4 + 17;
  const step = Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2;
  const positions = [6];
  for (let pos = size - 7; positions.length < count; pos -= step) positions.splice(1, 0, pos);
  return positions;
}

function buildMatrix(codewords, version) {
  const size = version * 4 + 17;
  const modules = Array.from({ length: size }, () => new Array(size).fill(false));
  const reserved = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (x, y, dark) => { modules[y][x] = dark; reserved[y][x] = true; };

  const finder = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx, y = cy + dy;
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        set(x, y, d !== 2 && d !== 4);
      }
    }
  };
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4);

  for (let i = 0; i < size; i++) {
    if (!reserved[6][i]) set(i, 6, i % 2 === 0);
    if (!reserved[i][6]) set(6, i, i % 2 === 0);
  }

  // Alignment patterns sit on the timing lines from version 7 up; only the
  // three that would collide with finders are left out.
  const aligns = alignmentPositions(version);
  const last = aligns[aligns.length - 1];
  for (const cy of aligns) {
    for (const cx of aligns) {
      if ((cx === 6 && cy === 6) || (cx === 6 && cy === last) || (cx === last && cy === 6)) continue;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
  }

  // Reserve format areas (filled after masking) and the always-dark module.
  for (let i = 0; i < 9; i++) { reserved[8][i] = true; reserved[i][8] = true; }
  for (let i = 0; i < 8; i++) { reserved[8][size - 1 - i] = true; reserved[size - 1 - i][8] = true; }
  set(8, size - 8, true);

  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const bit = ((bits >>> i) & 1) === 1;
      const a = size - 11 + (i % 3), b = Math.floor(i / 3);
      set(a, b, bit);
      set(b, a, bit);
    }
  }

  // Zigzag data placement, two columns at a time, skipping the timing column.
  let bitIndex = 0;
  const totalBits = codewords.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (reserved[y][x]) continue;
        if (bitIndex < totalBits) {
          modules[y][x] = ((codewords[bitIndex >>> 3] >>> (7 - (bitIndex & 7))) & 1) === 1;
          bitIndex++;
        }
      }
    }
  }
  return { size, modules, reserved };
}

const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x, y) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

function applyMask(grid, mask) {
  const { size, modules, reserved } = grid;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) if (!reserved[y][x] && MASKS[mask](x, y)) modules[y][x] = !modules[y][x];
  }
}

function drawFormat(grid, mask) {
  const { size, modules } = grid;
  const data = (FORMAT_BITS_M << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const bits = ((data << 10) | rem) ^ 0x5412;
  const bit = (i) => ((bits >>> i) & 1) === 1;
  for (let i = 0; i <= 5; i++) modules[i][8] = bit(i);
  modules[7][8] = bit(6);
  modules[8][8] = bit(7);
  modules[8][7] = bit(8);
  for (let i = 9; i < 15; i++) modules[8][14 - i] = bit(i);
  for (let i = 0; i < 8; i++) modules[8][size - 1 - i] = bit(i);
  for (let i = 8; i < 15; i++) modules[size - 15 + i][8] = bit(i);
  modules[size - 8][8] = true;
}

function penalty(grid) {
  const { size, modules } = grid;
  let score = 0;
  const line = (get) => {
    let run = 0, last = null, bits = '';
    for (let i = 0; i < size; i++) {
      const dark = get(i);
      bits += dark ? '1' : '0';
      if (dark === last) {
        run++;
        if (run === 5) score += 3;
        else if (run > 5) score += 1;
      } else {
        run = 1;
        last = dark;
      }
    }
    for (const needle of ['10111010000', '00001011101']) {
      for (let at = bits.indexOf(needle); at !== -1; at = bits.indexOf(needle, at + 1)) score += 40;
    }
  };
  for (let y = 0; y < size; y++) line((x) => modules[y][x]);
  for (let x = 0; x < size; x++) line((y) => modules[y][x]);
  let dark = 0;
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const a = modules[y][x];
      if (a === modules[y][x + 1] && a === modules[y + 1][x] && a === modules[y + 1][x + 1]) score += 3;
    }
  }
  for (const row of modules) for (const m of row) if (m) dark++;
  const percent = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(percent - 50) / 5) * 10;
  return score;
}

/** Returns { size, modules: boolean[][] } (true = dark). */
export function qrMatrix(text) {
  const bytes = Array.from(new TextEncoder().encode(String(text)));
  const version = chooseVersion(bytes.length);
  const codewords = interleave(dataCodewords(bytes, version), version);
  let best = null;
  for (let mask = 0; mask < 8; mask++) {
    const grid = buildMatrix(codewords, version);
    applyMask(grid, mask);
    drawFormat(grid, mask);
    const score = penalty(grid);
    if (!best || score < best.score) best = { score, grid, mask };
  }
  return { size: best.grid.size, modules: best.grid.modules, version, mask: best.mask };
}

/** An <svg> element with a 4-module quiet zone; scales to its container. */
export function qrSvg(text, { dark = '#000', light = '#fff' } = {}) {
  const { size, modules } = qrMatrix(text);
  const quiet = 4;
  const total = size + quiet * 2;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${total} ${total}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('shape-rendering', 'crispEdges');
  const bg = document.createElementNS(ns, 'rect');
  bg.setAttribute('width', total);
  bg.setAttribute('height', total);
  bg.setAttribute('fill', light);
  svg.append(bg);
  let d = '';
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) if (modules[y][x]) d += `M${x + quiet} ${y + quiet}h1v1h-1z`;
  }
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', dark);
  svg.append(path);
  return svg;
}
