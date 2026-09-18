// WaveSensr page, part 2 of 4: live status, capture and record, recordings list,
// panels, settings. Needs core.js.
let lastPacketAt = 0, wasRecording = false;
const announce = msg => { $('announce').textContent = msg; };

// Live shows real packets or an honest reason why there are none; never a stand-in.
function liveProblem(d) {
  if (!d.running) return null;
  const fresh = lastPacketAt && Date.now() - lastPacketAt < 3000;
  if (fresh) return null;
  const link = d.link || '';
  if (d.source === 'serial') {
    if (link.startsWith('waiting')) return 'No receiver found. Plug it into this Mac by USB.';
    if (link.startsWith('receiver lost')) return 'Receiver disconnected. Check the USB cable.';
    return 'No packets. Check the sender has power.';
  }
  if (d.source === 'udp') return 'No packets on ' + ((d.config && d.config.bind) || 'the network port') + '.';
  return 'No packets.';
}
function render(d) {
  last = d;
  const recording = d.recording, running = d.running;
  pressed('#modeSeg button', b => b.dataset.mode === (player.on ? 'past' : 'live'));
  if (recording !== wasRecording) {                     // tell screen readers too
    announce(recording ? 'Recording started' : 'Recording saved');
    wasRecording = recording;
  }
  const elapsed = recording ? hms(Math.max(0, Date.now() / 1000 - d.rec_started)) : '';
  $('recBadge').hidden = !(recording && player.on);     // a recording never disappears from view
  $('recBadgeTime').textContent = elapsed;
  // The setup figure lights the boards: receiver when it is plugged in, sender when packets arrive.
  const fresh = lastPacketAt && Date.now() - lastPacketAt < 3000;
  window.wsLink = {rx: !!(running && d.source === 'serial' && d.link && !/^(waiting|receiver lost)/.test(d.link)) || !!fresh,
                   tx: !!(running && fresh)};
  if (player.on) { renderPast(); return; }
  const problem = liveProblem(d);
  $('unavail').hidden = !problem && running;
  $('unTitle').textContent = problem ? 'Live data not available' : 'Live is off';
  $('unText').textContent = problem || 'Press Start.';
  $('statusText').textContent = recording
    ? 'Recording · started ' + new Date(d.rec_started * 1000).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit', second: '2-digit'}) + ' · ' + elapsed
    : problem ? 'Not available' : running ? (d.link && d.link !== 'ok' ? d.link : 'Streaming') : 'Stopped';
  $('b-status').title = $('statusText').textContent;
  document.querySelector('#b-status .dot').className = 'dot ' + (recording ? 'rec' : problem ? 'warn' : running ? 'on' : '');
  $('b-rate').textContent = running && !problem && d.fs_meas ? d.fs_meas.toFixed(0) + ' Hz' : '';
  $('btn-capture').textContent = running ? 'Stop' : 'Start';
  $('btn-capture').classList.toggle('primary', !running);
  $('btn-capture').classList.toggle('ghost', running);
  $('recText').textContent = recording ? 'Stop · ' + dur(Date.now() / 1000 - d.rec_started).replace(/^0m /, '') : 'Record';
  $('btn-rec').classList.toggle('live', !!recording);
  document.body.classList.toggle('streaming', !!(running && !problem));   // glows: live data is flowing
  document.body.classList.toggle('recording', !!recording);
  $('btn-rec').disabled = !running || !!problem || calLock;
  $('errBanner').hidden = !d.error;
  if (d.error) $('errBanner').textContent = d.error;
}

function connect() {
  const es = new EventSource('/api/stream');
  es.onmessage = e => {
    const d = JSON.parse(e.data);
    if (d.packets && !player.on) { for (const f of d.packets) pushFrame(f); dirty = true; }
    delete d.packets;
    render(d);
  };
  es.onerror = () => { es.close(); setTimeout(connect, 2000); };
}

function syncFields() {
  const s = $('f-source').value;
  document.querySelectorAll('.only-serial,.only-udp')
    .forEach(el => el.style.display = el.classList.contains('only-' + s) ? '' : 'none');
}
$('f-source').onchange = syncFields;

async function startLive() {
  count = 0; dirty = true;
  await post('/api/start', {source: $('f-source').value,
    subcarriers: +$('f-sub').value, port: $('f-port').value,
    baud: +$('f-baud').value, bind: $('f-bind').value});
}
$('btn-capture').onclick = async () => {
  if (last.running) { await post('/api/stop'); return; }
  startLive();
};
document.querySelectorAll('#modeSeg button').forEach(b => b.onclick = () => {
  if (b.dataset.mode === 'past') { openPanel('recPanel'); return; }
  if (player.on) exitPast();
});
$('recBadge').onclick = () => { if (player.on) exitPast(); };
function toast(msg, title) {                            // brief message in the top bar
  const el = $('b-saved'); el.textContent = msg; el.title = title || msg; el.hidden = false;
  clearTimeout(el._t); el._t = setTimeout(() => el.hidden = true, 6000);
}
// Recording needs the measured distance between the boards (saved with each recording).
let distanceCm = null;
function needDistance() {
  if (distanceCm) return false;
  openPanel('setupPanel'); $('f-dist').focus();
  return true;
}
$('btn-rec').onclick = async () => {
  if (!last.recording && needDistance()) return;
  if (last.recording) {
    const r = await post('/api/record/stop');
    if (r.session_id) {
      const d = await api('/api/sessions/' + r.session_id);
      const f = d.session && d.session.raw_file;
      if (f) toast('Saved ' + f.split('/').pop(), f);
    }
    loadSessions(); return;
  }
  await post('/api/record/start', {});
};

// ---------------------------------------------------------------- recordings
async function loadSessions() {
  const [rows, st] = await Promise.all([api('/api/sessions'), api('/api/settings')]);
  $('recDir').textContent = st.effective;
  $('recCount').textContent = rows.length || '';
  const el = $('sessions');
  if (!rows.length) { el.innerHTML = '<p class="dim">No recordings yet.</p>'; return; }
  el.innerHTML = '<table><tbody>' + rows.map(r => `<tr>
      <td><span class="rname">${escapeHtml(r.label || ('Recording ' + r.id))}</span>
        <div class="dim small">${new Date(r.started * 1000).toLocaleString()} · ${r.ended ? dur(r.ended - r.started) : 'open'}${r.distance_cm ? ' · ' + Math.round(r.distance_cm) + ' cm apart' : ''}</div>
        ${r.note ? '<div class="dim small">' + escapeHtml(r.note) + '</div>' : ''}
        ${r.raw_file ? '<div class="dim small mono">' + escapeHtml(r.raw_file.split('/').pop()) + '</div>' : ''}</td>
      <td class="acts">${r.raw_file ? `<a href="#" data-play="${r.id}">View</a><a href="/api/sessions/${r.id}/raw.csv">Download</a><a href="#" data-rev="${r.id}">Show in Finder</a>` : ''}
        <a href="#" data-ren="${r.id}">Rename</a><a href="#" data-del="${r.id}">Delete</a></td></tr>`).join('')
    + '</tbody></table>';
  el.querySelectorAll('[data-play]').forEach(a => a.onclick = async e => {
    e.preventDefault();
    closePanels();
    openPast(a.dataset.play);
  });
  el.querySelectorAll('[data-rev]').forEach(a => a.onclick = e => {
    e.preventDefault(); post('/api/sessions/' + a.dataset.rev + '/reveal');
  });
  el.querySelectorAll('[data-ren]').forEach(a => a.onclick = async e => {
    e.preventDefault();
    const r = rows.find(x => String(x.id) === a.dataset.ren);
    const name = prompt('Name this recording', r.label || '');
    if (name == null) return;
    await post('/api/sessions/' + r.id + '/note', {label: name.trim() || r.label, note: r.note || ''});
    loadSessions();
  });
  el.querySelectorAll('[data-del]').forEach(a => a.onclick = async e => {
    e.preventDefault();
    if (!confirm('Delete this recording and its files?')) return;
    await fetch('/api/sessions/' + a.dataset.del, {method: 'DELETE'});
    loadSessions();
  });
}

// ---------------------------------------------------------------- floating panels
// One panel at a time. A running baseline keeps its panel open, since it owns the recording.
function openPanel(id) {
  document.querySelectorAll('.panel').forEach(p => { if (p.id !== id) p.hidden = true; });
  const p = $(id);
  if (!p.hidden && id === 'calPanel' && calLock) return;
  p.hidden = !p.hidden;
  document.querySelectorAll('.dlink[data-panel]').forEach(b => b.classList.toggle('on', b.dataset.panel === id && !p.hidden));
  if (!p.hidden && id === 'recPanel') loadSessions();
}
function closePanels() {
  if (calLock) { $('calPanel').hidden = false; }
  document.querySelectorAll('.panel').forEach(p => { if (!(p.id === 'calPanel' && calLock)) p.hidden = true; });
  document.querySelectorAll('.dlink[data-panel]').forEach(b => b.classList.toggle('on', b.dataset.panel === 'calPanel' && calLock));
}
document.querySelectorAll('.dlink[data-panel]').forEach(b => b.onclick = () => openPanel(b.dataset.panel));
document.querySelectorAll('[data-close]').forEach(b => b.onclick = closePanels);
addEventListener('keydown', e => { if (e.key === 'Escape') closePanels(); });

// ---------------------------------------------------------------- settings
// Sensitive zone (first Fresnel zone) width at the midpoint = sqrt(wavelength x distance), wavelength ~12.5 cm.
// Top bar reminder: current distance against the recommended 100–120 cm (head plus movement fits, shoulders stay out).
function distChip() {
  const el = $('b-dist'), ok = distanceCm >= 100 && distanceCm <= 120;
  el.innerHTML = '<b>' + (distanceCm ? Math.round(distanceCm) + ' cm' : 'Set distance') + '</b>'
    + '<span class="long">' + (distanceCm ? ' apart' : '') + ' · recommended 100–120 cm</span>';
  el.title = el.textContent; el.classList.toggle('warn', !ok);
  window.wsDistance = distanceCm || 110;                 // the setup figure draws this spacing
  window.wsDistanceSet = !!distanceCm;
}
function distMsg() {
  $('distMsg').className = 'hsub';
  $('distMsg').textContent = 'Zone ≈ ' + Math.round(Math.sqrt(12.5 * distanceCm)) + ' cm wide at the head. Recommended 100–120 cm.';
}
function loadSettings() {
  api('/api/settings').then(st => {
    $('f-savedir').value = st.save_dir;
    distanceCm = st.distance_cm; if (distanceCm) { $('f-dist').value = Math.round(distanceCm); distMsg(); }
    distChip();
    const m = $('savedirMsg');
    m.className = 'hsub' + (st.missing ? ' bad' : '');
    m.textContent = st.missing ? 'Folder missing. Saving to ' + st.effective + ' for now.'
      : 'Each recording saves a CSV and a small .json with its details.';
  });
}
$('b-dist').onclick = () => openPanel('setupPanel');
$('btn-dist').onclick = async () => {
  const r = await post('/api/settings', {distance_cm: +$('f-dist').value});
  if (r.error) { $('distMsg').className = 'hsub bad'; $('distMsg').textContent = r.error; return; }
  distanceCm = r.distance_cm; distMsg(); distChip(); dirty = true;
};
$('btn-savedir').onclick = async () => {
  const r = await post('/api/settings', {save_dir: $('f-savedir').value});
  const m = $('savedirMsg');
  if (r.error) { m.className = 'hsub bad'; m.textContent = r.error; return; }
  $('f-savedir').value = r.save_dir;
  m.className = 'hsub good'; m.textContent = 'Saved.';
};

// ---------------------------------------------------------------- boot
api('/api/state').then(s => {
  const c = s.config || {};
  $('f-source').value = ['serial', 'udp'].includes(c.source) ? c.source : 'serial';
  if (c.subcarriers) $('f-sub').value = c.subcarriers;
  if (c.port) $('f-port').value = c.port;
  if (c.baud) $('f-baud').value = c.baud;
  if (c.bind) $('f-bind').value = c.bind;
  syncFields(); render(s);
});
connect();
loadSessions();
loadSettings();
