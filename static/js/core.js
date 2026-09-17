// WaveSensr page, part 1 of 4: shared helpers, trace buffers, drawing and view controls.
// Classic scripts loaded in order (core, live, calibration, player); they share globals.
const $ = id => document.getElementById(id);
const api = (url, opt) => fetch(url, opt).then(r => r.json());
const post = (url, body) => api(url, {method: 'POST',
  headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body || {})});
const dur = s => s == null ? '—'
  : (s >= 3600 ? Math.floor(s / 3600) + 'h ' : '') + Math.floor(s % 3600 / 60) + 'm '
    + String(Math.floor(s % 60)).padStart(2, '0') + 's';
const mmss = x => Math.floor(x / 60) + ':' + String(Math.floor(x % 60)).padStart(2, '0');
const hms = x => (x >= 3600 ? Math.floor(x / 3600) + ':' + String(Math.floor(x % 3600 / 60)).padStart(2, '0')
  : String(Math.floor(x / 60)).padStart(2, '0')) + ':' + String(Math.floor(x % 60)).padStart(2, '0');
const escapeHtml = s => String(s).replace(/[&<>"]/g,
  c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
const store = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
const stored = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
function pressed(selector, isOn) {                     // segmented controls: look and announce the choice
  document.querySelectorAll(selector).forEach(b => {
    const on = isOn(b); b.classList.toggle('on', on); b.setAttribute('aria-pressed', on);
  });
}
let last = {};
// Past-mode player state; declared here because the draw loop starts at load.
const player = {on: false, label: '', n: 0, cols: 0, t: null, db: null, dur: 0, fs: 60,
                pos: 0, playing: false, speed: 1, pushed: -1, lastTick: 0, dragging: false};

// ---------------------------------------------------------------- theme
let PAL = {};
function readPalette() {
  const cs = getComputedStyle(document.documentElement);
  for (const k of ['label', 'grid', 'axis', 'fill', 'plot', 'hairline']) PAL[k] = cs.getPropertyValue('--' + k).trim();
}
document.documentElement.dataset.theme = stored('theme') || 'dark';
readPalette();
$('themeBtn').onclick = () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  store('theme', next); readPalette(); dirty = true;
};

// ---------------------------------------------------------------- trace buffers
// One ring buffer per slice, 30 s deep at up to 100 Hz. Three display modes,
// all display only (the CSV keeps raw strengths):
//   raw       strength in dB, nothing subtracted, on a fixed colour range
//   rolling   dB change from each slice's own rolling average (1-10 s)
//   baseline  dB change from each slice's mean in the latest Baseline recording
// Rolling and baseline can also subtract the across-slice mean, which removes
// whole-channel gain jumps.
const CAP = 3000, SCALES = [0.5, 1, 2, 5, 10, 20];
let N = 0, head = 0, count = 0, V = [], D = [], CM = new Float32Array(CAP), T = new Float64Array(CAP), t0 = 0;
let show = stored('show') || 'roll', rollSecs = +stored('rollSecs') || 5;
let calib = null;                                      // {id, started, distance_cm, mean: Float64Array, avg}
let rawRange = null;                                   // {lo, hi} dB, fixed once fitted
let base, seen, live, order = [], labels = [];
let tb = 10, scaleIdx = 3, perPage = 32, offset = 0, dirty = true;

function initBuffers(n) {
  N = n; head = 0; count = 0; offset = 0; rawRange = null;
  V = Array.from({length: n}, () => new Float32Array(CAP));
  D = Array.from({length: n}, () => new Float32Array(CAP));
  base = new Float64Array(n); seen = new Uint8Array(n); live = new Uint8Array(n);
  // The server already sends slices in frequency order: s1 is the lowest.
  order = [...Array(n).keys()];
  labels = order.map(j => 's' + (j + 1));
}

function rollInto(j, fs) {                             // rolling change for the packet stored at j
  const alpha = 1 / (fs * rollSecs);
  let sum = 0, m = 0;
  for (let k = 0; k < N; k++) {
    const d = D[k][j];
    if (d === d) {
      if (!seen[k]) { base[k] = d; seen[k] = 1; live[k] = 1; }
      base[k] += alpha * (d - base[k]);
      V[k][j] = d - base[k]; sum += V[k][j]; m++;
    } else V[k][j] = NaN;
  }
  if ($('f-cm').checked && m) for (let k = 0; k < N; k++) V[k][j] -= sum / m;
}
function pushDb(t, db, fs) {                            // db: one packet in dB, NaN = empty slice
  if (db.length !== N) initBuffers(db.length);
  let sumRaw = 0, m = 0;
  for (let k = 0; k < N; k++) { const d = db[k]; D[k][head] = d; if (d === d) { sumRaw += d; m++; } }
  CM[head] = m ? sumRaw / m : NaN;
  rollInto(head, fs);
  if (!count) t0 = t;
  T[head] = t; head = (head + 1) % CAP; count = Math.min(count + 1, CAP);
}
// Re-derive the rolling view from the buffered raw values, so a new window or
// gain-jump setting applies at once, live or paused.
function rebuildRolling() {
  if (!count) return;
  const first = (head - count + CAP) % CAP, lastJ = (head - 1 + CAP) % CAP;
  const fs = count > 1 && T[lastJ] > T[first] ? (count - 1) / (T[lastJ] - T[first]) : 60;
  seen.fill(0);
  for (let i = 0; i < count; i++) rollInto((first + i) % CAP, fs);
  dirty = true;
}
function pushFrame(f) {                                 // a live packet: [unix time, strengths…]
  const db = new Float64Array(f.length - 1);
  for (let k = 0; k < db.length; k++) db[k] = f[k + 1] > 0 ? 20 * Math.log10(f[k + 1]) : NaN;
  pushDb(f[0], db, last.fs_meas || +$('f-fs').value || 60);
  lastPacketAt = Date.now();
}
function fitRaw() {                                     // 2nd-98th percentile of everything buffered
  const vals = [];
  const step = Math.max(1, Math.floor(count / 400));
  for (let i = 0; i < count; i += step) {
    const j = (head - count + i + CAP) % CAP;
    for (let k = 0; k < N; k++) { const d = D[k][j]; if (d === d) vals.push(d); }
  }
  if (!vals.length) return null;
  vals.sort((a, b) => a - b);
  const lo = vals[Math.floor(vals.length * .02)], hi = vals[Math.floor(vals.length * .98)];
  return hi > lo ? {lo, hi} : {lo: lo - 1, hi: hi + 1};
}

// ---------------------------------------------------------------- colour
// Size of change and raw strength: "plasma" (perceptually even, dark blue = less,
// red = more). Change from baseline has a sign: "coolwarm" centred on zero.
const ramp = stops => Array.from({length: 256}, (_, i) => {
  const t = i / 255 * (stops.length - 1), a = Math.floor(t), b = Math.min(a + 1, stops.length - 1), f = t - a;
  return stops[a].map((c, n) => Math.round(c + (stops[b][n] - c) * f));
});
const PLASMA = ramp([[13, 8, 135], [78, 2, 162], [129, 4, 167], [173, 39, 147], [208, 77, 115], [234, 116, 87]]);
const COOLWARM = ramp([[59, 76, 192], [124, 159, 249], [192, 212, 245], [221, 220, 220], [242, 203, 183], [238, 132, 104], [180, 4, 38]]);
let view = stored('view') === 'heat' ? 'heat' : 'lines';
const heatCv = document.createElement('canvas');

// ---------------------------------------------------------------- drawing
function draw() {
  dirty = false;
  const cv = $('tv'), dpr = devicePixelRatio || 1;
  const W = cv.clientWidth, H = cv.clientHeight;
  if (!W || !H) return;
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  }
  const cx = cv.getContext('2d');
  cx.setTransform(dpr, 0, 0, dpr, 0, 0);
  cx.clearRect(0, 0, W, H);
  const gut = 50, padT = 16, padB = 34;
  const pw = W - gut - 70, ph = H - padT - padB;               // right margin holds the key
  cx.font = '10px ui-monospace,"SF Mono",Menlo,monospace';
  cx.fillStyle = PAL.plot; cx.strokeStyle = PAL.hairline; cx.lineWidth = 1;      // the instrument's plot window
  cx.beginPath(); cx.roundRect(gut - .5, padT - .5, pw + 1, ph + 1, 8); cx.fill(); cx.stroke();

  const vis = order.filter(k => live[k]);
  const noBase = show === 'base' && !(calib && calib.mean.length === N);
  if (!count || !vis.length || noBase) {
    cx.fillStyle = PAL.axis;
    cx.fillText(noBase && count ? 'No baseline recording for these slices yet. Run Calibrate.'
      : last.running ? 'Waiting for packets…' : 'Press Start to stream.', gut + 12, H / 2);
    $('tvRange').textContent = ''; return;
  }
  const per = perPage ? Math.min(perPage, vis.length) : vis.length;
  offset = Math.max(0, Math.min(offset, vis.length - per));
  const page = vis.slice(offset, offset + per), laneH = ph / page.length;
  const iEnd = (head - 1 + CAP) % CAP, tEnd = T[iEnd], tStart = tEnd - tb;
  const X = t => gut + (t - tStart) / tb * pw;
  const idx = [];                                                   // samples in the window
  for (let i = 0, j = iEnd; i < count; i++, j = (j - 1 + CAP) % CAP) {
    if (T[j] < tStart) break; idx.push(j);
  }
  idx.reverse();

  let scale = SCALES[scaleIdx];
  const cmOn = $('f-cm').checked;
  if (show === 'raw') {
    if (!rawRange) { rawRange = fitRaw(); scaleText(); }
    scale = (rawRange.hi - rawRange.lo) / 2;
  }
  const mid = show === 'raw' ? (rawRange.lo + rawRange.hi) / 2 : 0;
  const val = show === 'roll' ? (k, j) => V[k][j]
    : show === 'base' ? (k, j) => D[k][j] - calib.mean[k] - (cmOn ? CM[j] - calib.avg : 0)
    : (k, j) => D[k][j] - mid;
  // heat level 0..1: raw position in range, rolling size of change, baseline signed around 0.5
  const level = show === 'base' ? v => (v / scale + 1) / 2 : show === 'raw' ? v => (v / scale + 1) / 2 : v => Math.abs(v) / scale;
  const LUT = show === 'base' ? COOLWARM : PLASMA;

  if (view === 'heat') {                                            // one pixel per sample per slice
    heatCv.width = idx.length; heatCv.height = page.length;
    const hx = heatCv.getContext('2d'), img = hx.createImageData(idx.length, page.length), px = img.data;
    page.forEach((k, r) => {
      idx.forEach((j, c) => {
        const v = val(k, j), o = (r * idx.length + c) * 4;
        if (v !== v) { px[o + 3] = 0; return; }
        const rgb = LUT[Math.max(0, Math.min(255, Math.round(level(v) * 255)))];
        px[o] = rgb[0]; px[o + 1] = rgb[1]; px[o + 2] = rgb[2]; px[o + 3] = 255;
      });
    });
    hx.putImageData(img, 0, 0);
    const x0 = X(T[idx[0]]), x1 = X(T[idx[idx.length - 1]]);
    cx.imageSmoothingEnabled = false;
    cx.save(); cx.beginPath(); cx.roundRect(gut, padT, pw, ph, 8); cx.clip();       // keep the frame's corners
    cx.drawImage(heatCv, 0, 0, idx.length, page.length, x0, padT, Math.max(1, x1 - x0), ph);
    cx.restore();
  } else {
    page.forEach((k, li) => {                                       // faint band per decade
      if (Math.floor(k / 10) % 2) { cx.fillStyle = PAL.fill; cx.fillRect(gut, padT + laneH * li, pw, laneH); }
    });
  }

  const tick = tb > 10 ? 5 : 1;                                     // seconds since Start
  const clock = v => v < 60 ? String(v) : Math.floor(v / 60) + ':' + String(v % 60).padStart(2, '0');
  cx.fillStyle = PAL.axis; cx.lineWidth = 1;
  for (let s = Math.max(0, Math.ceil(tStart - t0)); s <= tEnd - t0; s++) {
    const major = s % tick === 0, x = Math.round(X(t0 + s)) + .5;
    cx.globalAlpha = view === 'heat' ? (major ? .45 : 0) : (major ? .9 : .35);
    cx.strokeStyle = view === 'heat' ? '#fff' : PAL.grid;
    cx.beginPath(); cx.moveTo(x, padT); cx.lineTo(x, padT + ph); cx.stroke();
    cx.globalAlpha = 1;
    if (major) { cx.textAlign = 'center'; cx.fillText(clock(s), x, padT + ph + 13); }
  }
  const tname = player.on ? 'Time in recording' : 'Time since start';
  cx.textAlign = 'right'; cx.fillText(tname + (tEnd - t0 < 60 ? ' (s)' : ' (min:s)'), gut + pw, H - 3);
  cx.textAlign = 'left'; cx.fillText('Slice', 4, 10);

  const need = Math.ceil(9 / laneH), every = [1, 2, 5, 10, 20].find(v => v >= need) || 20;   // round-number labels when dense
  const px = (laneH * .5) / scale;
  cx.lineWidth = laneH > 14 ? 1.1 : .75; cx.lineJoin = 'round';
  page.forEach((k, li) => {
    const y0 = padT + laneH * (li + .5), lo = y0 - laneH * .5, hi = y0 + laneH * .5;
    if (every === 1 || (k + 1) % every === 0) {
      cx.fillStyle = PAL.axis; cx.textAlign = 'right';
      cx.fillText(labels[k], gut - 8, y0 + 3.5); cx.textAlign = 'left';
    }
    if (view === 'heat') return;
    cx.strokeStyle = PAL.label; cx.globalAlpha = .82; cx.beginPath();
    let started = false;
    for (const j of idx) {
      const v = val(k, j);
      if (v !== v) { started = false; continue; }                    // NaN gap
      const y = Math.max(lo, Math.min(hi, y0 - v * px));             // clip to lane
      const x = X(T[j]);
      started ? cx.lineTo(x, y) : cx.moveTo(x, y); started = true;
    }
    cx.stroke(); cx.globalAlpha = 1;
  });

  const kx = gut + pw + 14;                                          // key in the right margin
  cx.fillStyle = PAL.axis; cx.textAlign = 'left';
  if (view === 'heat') {
    const kh = Math.min(160, ph), ky = padT + ph - kh;
    const g = cx.createLinearGradient(0, ky + kh, 0, ky);
    LUT.forEach((c, i) => { if (i % 51 === 0 || i === 255) g.addColorStop(i / 255, `rgb(${c})`); });
    cx.fillStyle = g; cx.fillRect(kx, ky, 8, kh);
    cx.fillStyle = PAL.axis;
    const [top, sub1, sub2, bot] = show === 'raw' ? [rawRange.hi.toFixed(0) + ' dB', 'strong', 'weak', rawRange.lo.toFixed(0)]
      : show === 'base' ? ['+' + scale + ' dB', 'above', 'below', '−' + scale] : [scale + ' dB', 'more', 'less', '0'];
    cx.fillText(top, kx + 12, ky + 8); cx.fillText(sub1, kx + 12, ky + 22);
    cx.fillText(sub2, kx + 12, ky + kh - 14); cx.fillText(bot, kx + 12, ky + kh);
    if (show === 'base') cx.fillText('0 rest', kx + 12, ky + kh / 2 + 3);
  } else if (show === 'raw') {
    cx.fillText(rawRange.lo.toFixed(0) + '–' + rawRange.hi.toFixed(0), kx, padT + ph - 12);
    cx.fillText('dB', kx, padT + ph);
  } else {
    const bar = scale * px;                                          // amplitude reference
    if (bar >= 8) {
      const by = padT + ph;
      cx.strokeStyle = PAL.label; cx.lineWidth = 1.5;
      cx.beginPath(); cx.moveTo(kx, by); cx.lineTo(kx, by - bar); cx.stroke();
      cx.fillText(scale + ' dB', kx + 5, by - bar / 2 + 3.5);
    }
  }
  const empty = N - vis.length, sk = page.map(k => labels[k]);
  let note = '';
  if (show === 'base') {                                            // which baseline, and whether it still fits
    const when = new Date(calib.started * 1000);
    const stale = when.toDateString() !== new Date().toDateString()
      || (calib.distance_cm && distanceCm && Math.round(calib.distance_cm) !== Math.round(distanceCm));
    note = ' · baseline ' + when.toLocaleString([], {month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'})
      + (stale ? ' (other day or distance)' : '');
    $('tvRange').classList.toggle('warn', !!stale);
  } else $('tvRange').classList.remove('warn');
  $('tvRange').textContent = (per < vis.length ? sk[0] + '–' + sk[sk.length - 1] + ' · ' : '')
    + per + ' of ' + vis.length + ' slices' + (empty ? ' · ' + empty + ' empty' : '') + note;
}

function loop() { playerTick(); if (dirty && !document.hidden) draw(); requestAnimationFrame(loop); }   // started by player.js, the last part
addEventListener('resize', () => dirty = true);
// The traces take whatever height the floating bars leave free.
new ResizeObserver(([e]) => {
  document.documentElement.style.setProperty('--bottom-h', Math.ceil(e.contentRect.height) + 'px');
  dirty = true;
}).observe($('bottomBar'));
$('tv').addEventListener('wheel', e => {
  e.preventDefault();
  offset += Math.sign(e.deltaY) * Math.max(1, Math.round((perPage || N) / 4)); dirty = true;
}, {passive: false});

// ---------------------------------------------------------------- view controls
$('f-tb').onchange = e => { tb = +e.target.value; dirty = true; };
$('f-ch').onchange = e => { perPage = +e.target.value; offset = 0; dirty = true; };
const setView = v => { view = v; pressed('#viewSeg button', b => b.dataset.view === v); store('view', v); dirty = true; };
document.querySelectorAll('#viewSeg button').forEach(b => b.onclick = () => setView(b.dataset.view));
setView(view);
$('f-cm').onchange = () => rebuildRolling();

// Scale: ±dB for Rolling and Baseline; in Raw the same buttons narrow or widen the fixed range.
function scaleText() {
  $('scText').textContent = show !== 'raw' ? '±' + SCALES[scaleIdx] + ' dB'
    : rawRange ? rawRange.lo.toFixed(0) + '–' + rawRange.hi.toFixed(0) + ' dB' : 'range';
  $('sc-dn').setAttribute('aria-label', show === 'raw' ? 'Narrow the dB range' : 'Smaller scale');
  $('sc-up').setAttribute('aria-label', show === 'raw' ? 'Widen the dB range' : 'Larger scale');
}
function zoomRaw(f) {
  if (!rawRange) return;
  const c = (rawRange.lo + rawRange.hi) / 2, h = Math.max(1, (rawRange.hi - rawRange.lo) / 2 * f);
  rawRange = {lo: c - h, hi: c + h};
}
$('sc-dn').onclick = () => { show === 'raw' ? zoomRaw(0.8) : scaleIdx = Math.max(0, scaleIdx - 1); scaleText(); dirty = true; };
$('sc-up').onclick = () => { show === 'raw' ? zoomRaw(1.25) : scaleIdx = Math.min(SCALES.length - 1, scaleIdx + 1); scaleText(); dirty = true; };

// Display mode: Raw / Rolling (with its window) / Baseline (latest calibration).
async function loadBaseline() {
  const rows = await api('/api/sessions');
  const s = rows.find(r => /^Baseline/.test(r.label || '') && r.raw_file && r.ended);
  if (!s) { calib = null; dirty = true; return; }
  if (calib && calib.id === s.id) return;
  const lines = (await (await fetch('/api/sessions/' + s.id + '/raw.csv?view=1')).text()).trim().split('\n').slice(1);
  const n = lines[0] ? lines[0].split(',').length - 1 : 0, sum = new Float64Array(n), cnt = new Uint32Array(n);
  for (const ln of lines) {
    const c = ln.split(',');
    for (let k = 0; k < n; k++) { const x = +c[k + 1]; if (x > 0) { sum[k] += 20 * Math.log10(x); cnt[k]++; } }
  }
  const mean = new Float64Array(n).map((_, k) => cnt[k] > lines.length / 2 ? sum[k] / cnt[k] : NaN);
  const ok = [...mean].filter(x => x === x);
  calib = {id: s.id, started: s.started, distance_cm: s.distance_cm, mean, avg: ok.reduce((a, b) => a + b, 0) / (ok.length || 1)};
  dirty = true;
}
function setShow(m) {
  show = m;
  pressed('#showSeg button', b => b.dataset.m === m);
  $('rollCtl').hidden = m !== 'roll';
  store('show', m);
  if (m === 'base') loadBaseline();
  scaleText(); dirty = true;
}
const rollText = () => $('rwText').textContent = rollSecs + ' s';
function setRoll(s) { rollSecs = Math.max(1, Math.min(10, s)); rollText(); store('rollSecs', rollSecs); rebuildRolling(); }
$('rw-dn').onclick = () => setRoll(rollSecs - 1);
$('rw-up').onclick = () => setRoll(rollSecs + 1);
document.querySelectorAll('#showSeg button').forEach(b => b.onclick = () => setShow(b.dataset.m));
rollText();
setShow(show);
