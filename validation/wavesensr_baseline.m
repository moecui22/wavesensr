function T = wavesensr_baseline(participant, varargin)
% WAVESENSR_BASELINE  Resting baseline: instructions on screen, 10 s countdown,
% 3 min resting state (head still, eyes free), recorded by WaveSensr.
%
%   wavesensr_baseline('P01')
%   wavesensr_baseline('P01', 'OutDir', '/Volumes/T7/work/wavesensr')
%   wavesensr_baseline('P00', 'DryRun', true)   % no window, voice or WaveSensr
%
% Before: WaveSensr running (http://localhost:8777), Live streaming, board
% distance entered in Setup. Participant seated, door closed.
% Keys: Space starts (experimenter), Esc stops.
% Run it again for another baseline; each run is its own WaveSensr recording.
% Log: baseline_<participant>_<stamp>.csv in OutDir, times in Unix seconds.

p = inputParser;
p.addRequired('participant', @(x) ischar(x) || isstring(x));
p.addParameter('Seconds', 180);
p.addParameter('Countdown', 10);
p.addParameter('Url', '');
p.addParameter('Voice', true);
p.addParameter('OutDir', '');
p.addParameter('DryRun', false);
p.parse(participant, varargin{:});
o = p.Results;
cfg = ws_config();                       % url and output folder live in ws_config.m
if isempty(o.Url), o.Url = cfg.url; end
if isempty(o.OutDir), o.OutDir = cfg.dir; end
o.participant = char(o.participant);
if o.DryRun, o.Voice = false; o.Seconds = 0.2; o.Countdown = 0; end

unixnow = @() posixtime(datetime('now', 'TimeZone', 'UTC'));
stamp = char(datetime('now', 'Format', 'yyyy-MM-dd_HH-mm-ss'));
outfile = fullfile(o.OutDir, sprintf('baseline_%s_%s.csv', o.participant, stamp));
json = weboptions('MediaType', 'application/json', 'Timeout', 20);

% ------------------------------------------------------------------ WaveSensr ready?
if ~o.DryRun
    try
        st = webread([o.Url '/api/state']);
        cfg = webread([o.Url '/api/settings']);
    catch
        error('wavesensr_baseline:offline', 'WaveSensr is not reachable at %s. Start it first.', o.Url);
    end
    if ~st.running, error('wavesensr_baseline:stopped', 'WaveSensr is not streaming. Press Start in Live.'); end
    if isempty(cfg.distance_cm), error('wavesensr_baseline:distance', 'Enter the board distance in WaveSensr Setup.'); end
end

% ------------------------------------------------------------------ window
stopFlag = false; goFlag = false;
if ~o.DryRun
    fig = figure('Color', 'k', 'MenuBar', 'none', 'ToolBar', 'none', 'NumberTitle', 'off', ...
                 'Name', 'WaveSensr baseline', 'WindowState', 'fullscreen', ...
                 'KeyPressFcn', @(~, e) onKey(e));
    ax = axes(fig, 'Position', [0 0 1 1], 'Color', 'k', 'XLim', [0 1], 'YLim', [0 1]);
    axis(ax, 'off');
    big = text(ax, .5, .78, '', 'Color', 'w', 'FontSize', 56, 'FontWeight', 'bold', 'HorizontalAlignment', 'center');
    body = text(ax, .5, .45, '', 'Color', 'w', 'FontSize', 30, 'HorizontalAlignment', 'center', 'LineSpacing', 1.6);
    foot = text(ax, .5, .1, '', 'Color', [.6 .6 .6], 'FontSize', 22, 'HorizontalAlignment', 'center');
end
    function onKey(e)
        if strcmp(e.Key, 'escape'), stopFlag = true; end
        if strcmp(e.Key, 'space'), goFlag = true; end
    end
    function show(t1, t2, t3)
        if o.DryRun, return; end
        big.String = t1; body.String = t2; foot.String = t3;
        drawnow;
    end
    function speak(txt)
        if o.Voice, system(sprintf('say "%s" &', txt)); end
    end
    function waitUntil(t)
        while ~stopFlag && unixnow() < t
            if ~o.DryRun, drawnow limitrate; end
            pause(0.02);
        end
    end

rules = {'Sit back, feet flat, hands resting on the desk.', ...
         'Let your eyes move freely over the screen.', ...
         'Breathe normally and keep your head still.', ...
         'Please don''t talk. Blinking is fine.'};

% ------------------------------------------------------------------ run
show('Resting baseline', sprintf('%s\n', rules{:}), ...
     sprintf('%d minutes · the experimenter will start', round(o.Seconds / 60)));
goFlag = o.DryRun;
while ~goFlag && ~stopFlag, drawnow limitrate; pause(0.02); end

for c = o.Countdown:-1:1                    % settle in; recording starts at zero
    if stopFlag, break; end
    show(sprintf('%d', c), 'Get comfortable and keep still.', 'Starting soon');
    waitUntil(unixnow() + 1);
end

start_unix = NaN; end_unix = NaN; session_id = NaN;
if ~stopFlag
    if ~o.DryRun
        r = webwrite([o.Url '/api/record/start'], ...
                     struct('label', sprintf('Baseline %s', o.participant), 'note', 'resting baseline'), json);
        session_id = r.session_id;
    end
    speak('Starting. Please keep still.');
    show('', '', '');                       % blank screen: eyes free, head still
    start_unix = unixnow();
    waitUntil(start_unix + o.Seconds);
    end_unix = unixnow();
    if ~o.DryRun, webwrite([o.Url '/api/record/stop'], struct(), json); end
    if ~stopFlag, speak('Done. Thank you.'); end
end
completed = ~stopFlag;

% ------------------------------------------------------------------ save
T = table(string(o.participant), start_unix, end_unix, session_id, completed, ...
          'VariableNames', {'participant', 'start_unix', 'end_unix', 'session_id', 'completed'});
writetable(T, outfile);
show(ternary(completed, 'Thank you', 'Stopped'), 'Please stay seated.', '');
fprintf('%s: %s -> %s\n', ternary(completed, 'Baseline done', 'Stopped'), o.participant, outfile);
if ~o.DryRun, pause(2); close(fig); end
end

function v = ternary(cond, a, b)
if cond, v = a; else, v = b; end
end
