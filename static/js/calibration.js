// WaveSensr page, part 3 of 4: the resting-baseline calibration. Needs core.js and live.js.
// ---------------------------------------------------------------- calibration
// Resting baseline: 10 s countdown, then 3 min recorded as "Baseline".
const CAL_COUNT = 10, CAL_SECS = 180;
const fmtClock = x => Math.floor(x / 60) + ':' + String(Math.floor(x % 60)).padStart(2, '0');
let calLock = false, actx = null;
const cal = {phase: 'idle', t: 0, timer: null};

function chime(n) {
  if (!$('cal-sound').checked || !actx) return;
  for (let k = 0; k < n; k++) {
    const o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime + k * .22;
    o.type = 'sine'; o.frequency.value = 880;
    g.gain.setValueAtTime(.0001, t);
    g.gain.exponentialRampToValueAtTime(.16, t + .02);
    g.gain.exponentialRampToValueAtTime(.0001, t + .38);
    o.connect(g).connect(actx.destination); o.start(t); o.stop(t + .42);
  }
}
function calShow(title, secs) {
  $('cal-title').textContent = title; $('cal-clock').textContent = fmtClock(Math.max(0, secs));
}
function calReset(title) {
  clearInterval(cal.timer); cal.timer = null; cal.phase = 'idle'; calLock = false;
  $('cal-go').textContent = 'Start'; calShow(title, CAL_SECS); render(last);
}
async function calTick() {
  const left = Math.ceil((cal.t - Date.now()) / 1000);
  if (cal.phase === 'count') {
    calShow('Starting in ' + Math.max(0, left) + ' s', CAL_SECS);
    if (left > 0) return;
    cal.phase = 'busy';
    const r = await post('/api/record/start', {label: 'Baseline', note: 'resting baseline'});
    if (!r.session_id) { calReset(r.error || 'Could not start recording.'); return; }
    cal.phase = 'rec'; cal.t = Date.now() + CAL_SECS * 1000; chime(1);
  } else if (cal.phase === 'rec') {
    calShow('Recording baseline', left);
    if (left > 0) return;
    cal.phase = 'busy';
    await post('/api/record/stop'); chime(3);
    calReset('Done. Saved as Baseline.'); loadSessions(); loadBaseline();
  }
}
$('cal-go').onclick = async () => {
  if (cal.phase === 'idle') {
    if (needDistance()) return;
    if (!last.running || liveProblem(last)) { calShow('Live data not available.', CAL_SECS); return; }
    try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {}
    calLock = true; render(last);
    cal.phase = 'count'; cal.t = Date.now() + CAL_COUNT * 1000;
    $('cal-go').textContent = 'Cancel';
    cal.timer = setInterval(calTick, 250); calTick();
  } else if (cal.phase === 'count') {
    calReset('Cancelled.');
  } else if (cal.phase === 'rec') {
    if (!confirm('Stop the baseline? The recording so far is kept.')) return;
    clearInterval(cal.timer);
    await post('/api/record/stop');
    calReset('Stopped early.'); loadSessions();
  }
};
$('cal-close').onclick = () => {
  if (calLock) { $('cal-title').textContent = 'Finish or cancel the baseline first.'; return; }
  closePanels();
};

