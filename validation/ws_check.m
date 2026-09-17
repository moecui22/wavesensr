function ok = ws_check()
% WS_CHECK  Run this once on the testing computer before every session.
% Checks the things that quietly ruin a run: WaveSensr unreachable, board
% distance not entered, no packets arriving, the log folder not writable, and
% above all the clock: if MATLAB and WaveSensr are on different machines and
% their clocks disagree, every cue time is wrong by that amount.

c = ws_config();
ok = true;
fprintf('WaveSensr check · %s\n', datestr(now, 'yyyy-mm-dd HH:MM:SS'));
fprintf('  url    %s\n  logs   %s\n', c.url, c.dir);

% ---------------------------------------------------------------- reachable
w = weboptions('Timeout', 10);
now_ = @() posixtime(datetime('now', 'TimeZone', 'UTC'));
try
    st = webread([c.url '/api/state'], w);            % warm-up: the first call is always slow
catch
    fprintf(2, '  FAIL   not reachable. Start server.py, and if it is on another machine use its address in ws_config.m.\n');
    ok = false; return
end
best = Inf;
for k = 1:3                                            % the quickest round trip gives the tightest bound
    t0 = now_(); st = webread([c.url '/api/state'], w); t1 = now_();
    if t1 - t0 < best, best = t1 - t0; mid = (t0 + t1) / 2; srv = st; end
end
st = srv;

% ---------------------------------------------------------------- clocks
if isfield(st, 'server_time')
    off = st.server_time - mid;                        % + means WaveSensr is ahead
    fprintf('  clock  %+.3f s (round trip %.0f ms)\n', off, 1000 * best);
    if abs(off) > 0.25
        fprintf(2, '  FAIL   the two clocks differ by %.2f s. Turn on network time on both machines, or subtract this from every cue time.\n', off);
        ok = false;
    end
else
    fprintf(2, '  WARN   this WaveSensr is too old to report its time; update it to check the clocks.\n');
end

% ---------------------------------------------------------------- streaming
if ~st.running
    fprintf(2, '  FAIL   not streaming. Press Start in WaveSensr.\n'); ok = false;
elseif st.fs_meas > 0
    fprintf('  rate   %.0f Hz\n', st.fs_meas);
else
    fprintf(2, '  FAIL   no packets. Check the receiver USB and that the sender has power.\n'); ok = false;
end

% ---------------------------------------------------------------- distance
s = webread([c.url '/api/settings'], weboptions('Timeout', 10));
if isempty(s.distance_cm)
    fprintf(2, '  FAIL   board distance not entered. Measure antenna to antenna and type it into Setup (100-120 cm).\n'); ok = false;
else
    fprintf('  boards %.0f cm apart, saving to %s\n', s.distance_cm, s.effective);
end

% ---------------------------------------------------------------- log folder
try
    f = fullfile(c.dir, '.writetest'); fid = fopen(f, 'w'); fclose(fid); delete(f);
catch
    fprintf(2, '  FAIL   cannot write to %s\n', c.dir); ok = false;
end

% ---------------------------------------------------------------- audio
try, sound(zeros(100, 1), 8000); catch, fprintf(2, '  WARN   no audio device; run with ''Voice'', false.\n'); end

if ok, fprintf('  ready\n'); else, fprintf(2, '  not ready\n'); end
end
