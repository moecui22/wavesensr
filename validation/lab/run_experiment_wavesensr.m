function run_experiment_wavesensr(subjID, varargin)
% RUN_EXPERIMENT_WAVESENSR  One session for the radar / WaveSensr / gyroscope
% comparison. Built on run_experiment_radar, with six movements, still trials,
% and three resting minutes at each end.
%
%   run_experiment_wavesensr('ws01a1')
%   run_experiment_wavesensr('test', 'DryRun', true)     % no screen, seconds, no recording
%
% Session (about 14 minutes):
%   1. 3 min resting baseline, after a 10 s countdown - the calibration WaveSensr uses
%   2. 3 nods, 60 cued trials, 3 nods
%   3. 3 min resting baseline again, to see what drifted during the session
%
% Six movements x 8 + 12 still trials, shuffled, never more than two of a kind in a
% row. Each trial: the word appears - move and hold - the word clears - return to
% centre - rest, 6 to 8 s. Every event is stamped in Unix time, the clock the radar
% and WaveSensr both write. 'o' stops the run and saves what was done.
%
% WaveSensr saves three recordings: 'Baseline <subj> pre', the cue block, and
% 'Baseline <subj> post'. Leave the radar and the gyroscope running across all three.

p = inputParser;
p.addRequired('subjID', @(x) ischar(x) || isstring(x));
p.addParameter('PerCond', 8);                    % trials per movement
p.addParameter('Still', 12);                     % catch trials: the false-alarm rate needs these
p.addParameter('HoldSec', 2);                    % how long the head stays turned
p.addParameter('GapMin', 6);
p.addParameter('GapMax', 8);
p.addParameter('BaselineSec', 180);              % the resting block at each end
p.addParameter('Countdown', 10);
p.addParameter('Url', 'http://localhost:8777');  % WaveSensr; '' to leave it alone
p.addParameter('OutDir', '');
p.addParameter('DryRun', false);
p.parse(subjID, varargin{:});
o = p.Results;
o.subjID = char(o.subjID);
if o.DryRun
	o.HoldSec = .05; o.GapMin = .05; o.GapMax = .1; o.BaselineSec = .2; o.Countdown = 0; o.Url = '';
end
if isempty(o.OutDir), o.OutDir = fullfile(fileparts(fileparts(mfilename('fullpath'))), 'logs'); end
if ~exist(o.OutDir, 'dir'), mkdir(o.OutDir); end

cons_txt = {'left' 'right' 'up' 'down' 'tilt left' 'tilt right' 'still'};
words    = {'Left' 'Right' 'Up' 'Down' 'Left ear down' 'Right ear down' 'Stay still'};
cons = shuffle_limited([repelem((1:6)', o.PerCond); repmat(7, o.Still, 1)], 2);
nTrials = numel(cons);
IOIs = round((o.GapMin + rand(nTrials, 1) * (o.GapMax - o.GapMin)) * 100) / 100;

shandle = [];
uxtime = nan(nTrials, 1); uxback = nan(nTrials, 1); done = 0;
ev = struct();
try
	if ~o.DryRun
		PsychDefaultSetup(2);
		keysOfInterest = zeros(1, 256);
		keysOfInterest(KbName('o')) = 1;
		KbName('UnifyKeyNames');
		KbQueueCreate; KbQueueStart;
		Screen('Preference', 'SkipSyncTests', 1);
		% same opening sequence as run_experiment_radar, which is known to work on that PC
		screens = Screen('Screens');
		screenNumber = max(screens);
		shandle = Screen('Openwindow', screenNumber, [100 100 100], [], [], 2);
		Screen(shandle, 'FillRect', [100 100 100]);
		Screen('Flip', shandle);
		Screen('TextSize', shandle, 60);
		Screen('HideCursorHelper', shandle); HideCursor;
	end

	% ---------------------------------------------------------- 1. resting baseline
	ev.base_pre = rest_block(o, shandle, ['Baseline ' o.subjID ' pre']);

	% ---------------------------------------------------------- 2. cued movements
	rec = record(o, o.subjID, 'head movement cues');
	draw(o, shandle, 'Three nods');
	ev.sync_start = unixnow(); wait_(4);
	draw(o, shandle, ''); wait_(2);

	for ii = 1 : nTrials
		draw(o, shandle, words{cons(ii)});
		uxtime(ii) = unixnow();                      % stamped once the word is on screen
		wait_(o.HoldSec);
		draw(o, shandle, '');
		uxback(ii) = unixnow();
		done = ii;
		if ~o.DryRun
			[~, keyEvents] = KbQueueCheck;
			if any(keyEvents(logical(keysOfInterest))), break; end
		end
		wait_(IOIs(ii) - o.HoldSec);
	end

	draw(o, shandle, 'Three nods');
	ev.sync_end = unixnow(); wait_(4);
	draw(o, shandle, '');
	stop_rec(o, rec);

	% ---------------------------------------------------------- 3. resting baseline again
	ev.base_post = rest_block(o, shandle, ['Baseline ' o.subjID ' post']);

	draw(o, shandle, 'Done. Thank you.'); wait_(3);
	close_screen(o);
catch err
	close_screen(o);                                 % cleanup must never hide the real error
	stop_all(o);
	rethrow(err)
end

% ------------------------------------------------------------------ save
k = 1:done;
ev.uxtime = uxtime(k); ev.uxback = uxback(k); ev.IOIs = IOIs(k);
ev.cons = cons(k); ev.cons_txt = {cons_txt}; ev.subjID = o.subjID;
save(fullfile(o.OutDir, [o.subjID '_cues.mat']), '-struct', 'ev')

f = fullfile(o.OutDir, [o.subjID '_cues.csv']);
fid = fopen(f, 'w');
fprintf(fid, 'unix_time,trial,condition,back_unix_time\n');
fprintf(fid, '%.4f,0,baseline_pre_start,%.4f\n', ev.base_pre(1), ev.base_pre(2));
for ii = k
	fprintf(fid, '%.4f,%d,%s,%.4f\n', uxtime(ii), ii, cons_txt{cons(ii)}, uxback(ii));
end
fprintf(fid, '%.4f,0,baseline_post_start,%.4f\n', ev.base_post(1), ev.base_post(2));
fclose(fid);
fprintf('%d trials, %.1f min in all. Logs: %s\n', done, (ev.base_post(2) - ev.base_pre(1)) / 60, o.OutDir);
end

% ------------------------------------------------------------------ blocks
function span = rest_block(o, h, label)
% Three resting minutes: instructions, countdown, then a blank screen. Head still,
% eyes free - the same baseline the WaveSensr app records when you press Calibrate.
rec = record(o, label, 'resting baseline');
draw(o, h, sprintf(['Sit still for %d minutes.\n\nHead still, hands on the desk.\n' ...
                    'Let your eyes move freely over the screen.\nBreathe normally.'], ...
                   round(o.BaselineSec / 60)));
wait_(6);
for s = o.Countdown : -1 : 1
	draw(o, h, sprintf('%d', s));
	wait_(1);
end
draw(o, h, '');
t0 = unixnow();
wait_(o.BaselineSec);
span = [t0 unixnow()];
stop_rec(o, rec);
end

% ------------------------------------------------------------------ helpers
function t = unixnow()
t = posixtime(datetime('now', 'TimeZone', 'UTC'));
end

function wait_(s)
persistent hasPTB
if isempty(hasPTB), hasPTB = exist('WaitSecs', 'file') > 0; end   % so a dry run needs no PsychToolbox
if s <= 0, return; end
if hasPTB, WaitSecs(s); else, pause(s); end
end

function draw(o, h, txt)
if o.DryRun || isempty(h), return; end
DrawFormattedText(h, txt, 'center', 'center', [255 255 255]);
Screen('Flip', h);
end

function close_screen(o)
if o.DryRun, return; end
try
	sca;
catch
end
try
	KbQueueStop;
catch
end
end

function rec = record(o, label, note)
rec = false;
if isempty(o.Url), return; end
try
	webwrite([o.Url '/api/record/start'], struct('label', label, 'note', note), ...
	         weboptions('MediaType', 'application/json', 'Timeout', 20));
	rec = true;
catch
	warning('WaveSensr did not start recording at %s. The run continues; press Record by hand.', o.Url);
end
end

function stop_rec(o, rec)
if ~rec, return; end
stop_all(o);
end

function stop_all(o)
if isempty(o.Url), return; end
try
	webwrite([o.Url '/api/record/stop'], struct(), weboptions('MediaType', 'application/json', 'Timeout', 20));
catch
	warning('WaveSensr did not stop the recording; stop it in the app.');
end
end

function v = shuffle_limited(v, maxRun)
for attempt = 1:500
	v = v(randperm(numel(v)));
	run = 1; ok = true;
	for k = 2:numel(v)
		if v(k) == v(k-1), run = run + 1; else, run = 1; end
		if run > maxRun, ok = false; break; end
	end
	if ok, return; end
end
end
