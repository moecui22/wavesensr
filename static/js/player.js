// WaveSensr page, part 4 of 4: past recordings, played in the page. Needs core.js and live.js.
// ---------------------------------------------------------------- past recordings: a player
// The page loads the whole recording once and plays it itself, so pause, seek,
// skip and speed are instant. Converting to dB happens once at load.

async function openPast(id) {
  const [info, text] = await Promise.all([
    api('/api/sessions/' + id), fetch('/api/sessions/' + id + '/raw.csv?view=1').then(r => r.ok ? r.text() : '')]);
  const s = info.session || {};
  const lines = text.split('\n').filter(Boolean);
  if (lines.length < 3) { toast('No data in that recording.'); return; }
  const cols = lines[0].split(',').length - 1, n = lines.length - 1;
  const t = new Float64Array(n), db = new Float32Array(n * cols);
  for (let i = 0; i < n; i++) {
    const p = lines[i + 1].split(',');
    t[i] = p[0] === '' ? NaN : +p[0];
    for (let k = 0; k < cols; k++) { const x = +p[k + 1]; db[i * cols + k] = x > 0 ? 20 * Math.log10(x) : NaN; }
  }
  if (Number.isNaN(t[0])) {                               // older recordings: no per-packet time
    const rate = n / Math.max(1, (s.ended || s.started) - s.started);
    for (let i = 0; i < n; i++) t[i] = i / rate;
  } else { const a = t[0]; for (let i = 0; i < n; i++) t[i] -= a; }
  Object.assign(player, {on: true, label: s.label || ('Recording ' + id), started: s.started, n, cols, t, db,
    dur: t[n - 1], fs: (n - 1) / Math.max(t[n - 1], 1e-6), playing: true, lastTick: performance.now()});
  document.body.classList.add('past');
  $('player').hidden = false; $('btn-capture').hidden = true; $('btn-rec').hidden = true;
  seek(0); renderPast(); render(last);
}

function exitPast() {
  Object.assign(player, {on: false, playing: false, t: null, db: null});
  document.body.classList.remove('past');
  $('player').hidden = true; $('btn-capture').hidden = false; $('btn-rec').hidden = false;
  count = 0; dirty = true; render(last);
}

const rowAt = p => {                                       // last row at or before p seconds
  let lo = 0, hi = player.n - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (player.t[mid] <= p) lo = mid; else hi = mid - 1; }
  return lo;
};
function seek(p) {
  p = Math.max(0, Math.min(player.dur, p));
  const keep = offset, iEnd = rowAt(p), iStart = rowAt(Math.max(0, p - tb - 10));   // 10 s warms the baseline
  count = 0; initBuffers(player.cols); offset = keep;
  for (let i = iStart; i <= iEnd; i++) pushDb(player.t[i], player.db.subarray(i * player.cols, (i + 1) * player.cols), player.fs);
  t0 = 0; player.pushed = iEnd; player.pos = p; dirty = true; renderPast();
}
function advance(p) {
  if (p < player.pos || p - player.pos > tb) { seek(p); return; }
  while (player.pushed + 1 < player.n && player.t[player.pushed + 1] <= p) {
    const i = ++player.pushed;
    pushDb(player.t[i], player.db.subarray(i * player.cols, (i + 1) * player.cols), player.fs);
  }
  player.pos = p; dirty = true; renderPast();
}
function playerTick() {
  if (!player.on || !player.playing) return;
  const now = performance.now(), dt = (now - player.lastTick) / 1000;
  player.lastTick = now;
  let p = player.pos + dt * player.speed;
  if (p >= player.dur) { p = player.dur; player.playing = false; }
  advance(p);
}
function setPlaying(on) {
  if (on && player.pos >= player.dur) seek(0);            // play again from the start
  player.playing = on; player.lastTick = performance.now(); renderPast();
}
function renderPast() {
  if (!player.on) return;
  document.body.classList.remove('streaming', 'recording');
  $('pl-play').classList.toggle('glow', player.playing);
  $('unavail').hidden = true;
  $('statusText').innerHTML = (player.playing ? 'Viewing ' : player.pos >= player.dur ? 'Finished ' : 'Paused ')
    + '<span class="title">' + escapeHtml(player.label) + '</span>'
    + (player.started ? ' · started ' + new Date(player.started * 1000).toLocaleString([], {month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit'}) : '')
    + ' · ' + mmss(player.pos) + ' / ' + mmss(player.dur);
  document.querySelector('#b-status .dot').className = 'dot' + (player.playing ? ' on' : '');
  $('b-rate').textContent = player.speed === 1 ? '' : player.speed + '×';
  $('pl-play').textContent = player.playing ? 'Pause' : player.pos >= player.dur ? 'Play again' : 'Play';
  $('pl-pos').textContent = mmss(player.pos); $('pl-dur').textContent = mmss(player.dur);
  if (!player.dragging) $('pl-seek').value = player.dur ? Math.round(player.pos / player.dur * 1000) : 0;
  pressed('#pl-speed button', b => +b.dataset.s === player.speed);
}

$('pl-play').onclick = () => setPlaying(!player.playing);
$('pl-back').onclick = () => seek(player.pos - 5);
$('pl-fwd').onclick = () => seek(player.pos + 5);
$('pl-seek').addEventListener('input', e => { player.dragging = true; seek(e.target.value / 1000 * player.dur); });
$('pl-seek').addEventListener('change', () => { player.dragging = false; player.lastTick = performance.now(); });
document.querySelectorAll('#pl-speed button').forEach(b => b.onclick = () => {
  player.speed = +b.dataset.s; player.lastTick = performance.now(); renderPast();
});
addEventListener('keydown', e => {
  if (!player.on || /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName) && document.activeElement.type !== 'range') return;
  if (e.key === ' ') { e.preventDefault(); setPlaying(!player.playing); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); seek(player.pos - 5); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); seek(player.pos + 5); }
});

loop();
