function q = wavesensr_quality(csvfile)
% WAVESENSR_QUALITY  Rate a resting baseline recording: good, adequate or poor.
%
%   q = wavesensr_quality('WaveSensr_2026-09-17_10-00-00.csv')
%
% Three checks; the rating is the worst of the three.
%   Data      packets per second and the longest gap (boards, cable, radio)
%   Stillness % of 1-s windows noisier than 3x the recording's median second
%   Drift     median change per slice between the first and last 30 s (dB)
% Signal: dB per live slice, whole-channel gain jumps removed (the across-slice
% mean is subtracted from every packet), as in the WaveSensr display.
%
% NOT USED YET (2026-09-16): the rating is hidden until cutoffs are validated.
% The cutoffs are provisional: set them from pilot baselines (one still, one
% with deliberate fidgeting) before trusting the rating.

LIM.rate  = [50 30];     % Hz: good >= 50, adequate >= 30
LIM.gap   = [0.5 2];     % s:  good <= 0.5, adequate <= 2
LIM.noisy = [5 10];      % %:  good <= 5, adequate <= 10
LIM.drift = [1 2];       % dB: good <= 1, adequate <= 2

M = readmatrix(csvfile, 'NumHeaderLines', 1);
t = M(:, 1); A = M(:, 2:end);
if all(isnan(t)), t = (0:size(A, 1) - 1)' / 60; end   % old files: no timestamps, assume 60 Hz
t = t - t(1); dur = t(end);
if dur < 60, error('wavesensr_quality:short', 'Only %.0f s of data; a baseline needs at least 60 s.', dur); end

q.seconds = dur;
q.rate_hz = (numel(t) - 1) / dur;
q.max_gap_s = max(diff(t));

A = A(:, median(A, 1) > 0);                % drop the empty slices (band edges, centre)
A(A <= 0) = NaN;
dB = 20 * log10(A);
dB = dB - mean(dB, 2, 'omitnan');          % remove whole-channel gain jumps

n = floor(dur); w = nan(n, 1);
for s = 0:n - 1
    m = t >= s & t < s + 1;
    if nnz(m) > 5, w(s + 1) = median(std(dB(m, :), 0, 1, 'omitnan'), 'omitnan'); end
end
w = w(~isnan(w));
q.noisy_pct = 100 * mean(w > 3 * median(w));

first = mean(dB(t < 30, :), 1, 'omitnan');
last = mean(dB(t > dur - 30, :), 1, 'omitnan');
q.drift_db = median(abs(first - last), 'omitnan');

g = [grade(q.rate_hz, LIM.rate, true), grade(q.max_gap_s, LIM.gap, false), ...
     grade(q.noisy_pct, LIM.noisy, false), grade(q.drift_db, LIM.drift, false)];
names = ["data rate", "data gaps", "stillness", "drift"];
labels = ["poor", "adequate", "good"];
q.rating = labels(min(g));
q.weakest = strjoin(names(g == min(g)), ", ");
q.summary = sprintf('%s · %.0f Hz · longest gap %.2f s · noisy seconds %.0f%% · drift %.1f dB', ...
                    q.rating, q.rate_hz, q.max_gap_s, q.noisy_pct, q.drift_db);
end

function g = grade(x, lim, higherIsBetter)
% 3 = good, 2 = adequate, 1 = poor
if higherIsBetter, g = 1 + (x >= lim(2)) + (x >= lim(1));
else,              g = 1 + (x <= lim(2)) + (x <= lim(1)); end
end
