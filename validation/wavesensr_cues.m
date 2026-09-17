function wavesensr_cues(run, varargin)
% WAVESENSR_CUES  Head-movement cues for validating WaveSensr against a gyroscope.
%
%   wavesensr_cues(1)                  % run 1, full protocol
%   wavesensr_cues(2, 'OutDir', '/Volumes/T7/work/wavesensr')
%   wavesensr_cues(1, 'DryRun', true)  % quick check: no window, no voice, short gaps
%
% Per run: 3 sync nods -> 60 trials (six movements x 8, still x 12, shuffled,
% never more than 2 of a kind in a row) -> 3 sync nods.
% Each trial: move cue -> "Back" after HoldSec -> rest, jittered GapMin..GapMax s.
% Every cue is logged in Unix time (UTC seconds), the same clock as WaveSensr's
% raw CSV, stamped once the word is on screen. The spoken cue lags the screen by
% a tenth of a second or so, so the screen time is the one to analyse; set
% 'Voice', false if that bothers you.
% Esc stops the run and saves what was done.

p = inputParser;
p.addRequired('run', @(x) isnumeric(x) && isscalar(x));
p.addParameter('PerDirection', 8);   % per movement: left/right/up/down/tilt left/tilt right
p.addParameter('Still', 12);
p.addParameter('HoldSec', 2);
p.addParameter('GapMin', 8);
p.addParameter('GapMax', 12);
p.addParameter('Voice', true);
p.addParameter('OutDir', '');
p.addParameter('DryRun', false);
p.addParameter('Seed', []);
p.parse(run, varargin{:});
o = p.Results;
cfg = ws_config();                                      % output folder lives in ws_config.m
if isempty(o.OutDir), o.OutDir = cfg.dir; end
if o.DryRun
    o.Voice = false; o.HoldSec = 0.05; o.GapMin = 0.05; o.GapMax = 0.1;
end
if isempty(o.Seed), rng('shuffle'); else, rng(o.Seed); end

conds = [repmat("left", 1, o.PerDirection), repmat("right", 1, o.PerDirection), ...
         repmat("up", 1, o.PerDirection), repmat("down", 1, o.PerDirection), ...
         repmat("tiltL", 1, o.PerDirection), repmat("tiltR", 1, o.PerDirection), ...
         repmat("still", 1, o.Still)];
conds = shuffle_limited(conds, 2);
n = numel(conds);
words = containers.Map({'left','right','up','down','tiltL','tiltR','still'}, ...
                       {'Left','Right','Up','Down','Left ear down','Right ear down','Stay still'});

unixnow = @() posixtime(datetime('now', 'TimeZone', 'UTC'));
stamp = char(datetime('now', 'Format', 'yyyy-MM-dd_HH-mm-ss'));
outfile = fullfile(o.OutDir, sprintf('cues_run%d_%s.csv', o.run, stamp));

% ------------------------------------------------------------------ window
stopFlag = false;
if ~o.DryRun
    fig = figure('Color', 'k', 'MenuBar', 'none', 'ToolBar', 'none', 'NumberTitle', 'off', ...
                 'Name', 'WaveSensr cues', 'WindowState', 'fullscreen', ...
                 'KeyPressFcn', @(~, e) onKey(e));
    ax = axes(fig, 'Position', [0 0 1 1], 'Color', 'k', 'XLim', [0 1], 'YLim', [0 1]);
    axis(ax, 'off');
    big = text(ax, .5, .55, '', 'Color', 'w', 'FontSize', 110, 'FontWeight', 'bold', ...
               'HorizontalAlignment', 'center');
    small = text(ax, .5, .25, '', 'Color', [.6 .6 .6], 'FontSize', 28, ...
                 'HorizontalAlignment', 'center');
end
    function onKey(e)
        if strcmp(e.Key, 'escape'), stopFlag = true; end
    end
    function show(txt, sub)
        if o.DryRun, return; end
        big.String = txt; small.String = sub;
        drawnow; drawnow;                % second pass: the frame is on the display
    end
    function speak(txt)
        if o.Voice, system(sprintf('say "%s" &', txt)); end   % macOS voice, non-blocking
    end
    function waitUntil(t)                                       % responsive to Esc
        while ~stopFlag && unixnow() < t
            if ~o.DryRun, drawnow limitrate; end
            pause(0.01);
        end
    end

% ------------------------------------------------------------------ log
trial = (1:n)'; condition = conds(:);
move_cue_unix = nan(n, 1); return_cue_unix = nan(n, 1); gap_s = nan(n, 1);
sync = table(strings(0, 1), zeros(0, 1), 'VariableNames', {'event', 'unix'});

    function nods(label)
        show('Nod 3 times', 'sharp nods, then keep still');
        speak('Nod three times');
        sync = [sync; {label, unixnow()}]; %#ok<AGROW>
        waitUntil(unixnow() + ternary(o.DryRun, 0.05, 6));
        show('+', '');
        waitUntil(unixnow() + ternary(o.DryRun, 0.05, 4));
    end

% ------------------------------------------------------------------ run
show(sprintf('Run %d', o.run), 'Sit still, head on the line between the boards. Starting shortly.');
waitUntil(unixnow() + ternary(o.DryRun, 0.05, 8));
nods("sync_start");

for i = 1:n
    if stopFlag, break; end
    w = words(char(conds(i)));
    show(w, sprintf('trial %d of %d', i, n));
    move_cue_unix(i) = unixnow();        % stamped after drawnow: when the word is on screen
    speak(w);
    waitUntil(move_cue_unix(i) + o.HoldSec);
    if stopFlag, break; end
    return_cue_unix(i) = unixnow();
    if conds(i) ~= "still"
        show('Back', ''); speak('Back');
    end
    gap_s(i) = o.GapMin + rand * (o.GapMax - o.GapMin);
    waitUntil(return_cue_unix(i) + 1);
    show('+', '');
    waitUntil(return_cue_unix(i) + gap_s(i));
end
if ~stopFlag, nods("sync_end"); end

% ------------------------------------------------------------------ save
T = table(trial, condition, move_cue_unix, return_cue_unix, gap_s);
T = T(~isnan(T.move_cue_unix), :);
writetable(T, outfile);
writetable(sync, strrep(outfile, '.csv', '_sync.csv'));
if ~o.DryRun
    show(ternary(stopFlag, 'Stopped', 'Done'), sprintf('%d trials saved', height(T)));
    pause(2); close(fig);
end
fprintf('%s: %d of %d trials -> %s\n', ternary(stopFlag, 'stopped', 'done'), height(T), n, outfile);
end

function c = shuffle_limited(c, maxRun)
% Shuffle until no condition repeats more than maxRun times in a row.
for attempt = 1:10000
    c = c(randperm(numel(c)));
    runs = 1; ok = true;
    for k = 2:numel(c)
        if c(k) == c(k - 1), runs = runs + 1; else, runs = 1; end
        if runs > maxRun, ok = false; break; end
    end
    if ok, return; end
end
error('wavesensr_cues:shuffle', 'Could not find an order with at most %d in a row.', maxRun);
end

function v = ternary(cond, a, b)
if cond, v = a; else, v = b; end
end
