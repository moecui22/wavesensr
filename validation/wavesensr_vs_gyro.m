function R = wavesensr_vs_gyro(wifiCsv, gyroCsv, varargin)
% WAVESENSR_VS_GYRO  Does WaveSensr see the head movements the gyroscope recorded?
%
%   R = wavesensr_vs_gyro('WS_20260917_131132.csv', 'gyro_run1.csv')
%   R = wavesensr_vs_gyro(w, g, 'GyroThresh', 25, 'Plot', true)
%
% Both files carry Unix time, so they line up directly; the script also measures
% the residual offset by cross-correlation and reports it (a large one means a
% clock problem, not a detection problem).
%
% WaveSensr signal: dB per live slice -> remove whole-channel gain jumps (subtract
% the across-slice mean) -> 1 s moving standard deviation per slice -> median
% across slices. That is "how much the pattern is changing", the quantity the
% Rolling view draws.
% Gyroscope truth: angular speed magnitude; movement = above GyroThresh deg/s.
%
% Outputs (R): hit rate, false-alarm rate, d', AUC, median latency, and the
% correlation between movement size and WaveSensr response.

p = inputParser;
p.addParameter('GyroThresh', 20);        % deg/s: above this the head is moving
p.addParameter('MinGap', 0.5);           % s: movements closer than this are one event
p.addParameter('Window', 1.0);           % s: the moving window for both signals
p.addParameter('Epoch', [-1 3]);         % s around each movement onset
p.addParameter('Plot', true);
p.parse(varargin{:});
o = p.Results;

% ------------------------------------------------------------------ load
wifiCsv = find_file(wifiCsv); gyroCsv = find_file(gyroCsv);
W = readmatrix(wifiCsv, 'NumHeaderLines', 1);
tw = W(:, 1); A = W(:, 2:end);
A = A(:, median(A, 1) > 0); A(A <= 0) = NaN;          % drop the empty slices
dB = 20 * log10(A);
dB = dB - mean(dB, 2, 'omitnan');                      % remove whole-channel gain jumps
fsW = (numel(tw) - 1) / (tw(end) - tw(1));

G = readtable(gyroCsv);
gv = G{:, vartype('numeric')};
names = G.Properties.VariableNames(vartype_idx(G));
tcol = find(median(gv, 1, 'omitnan') > 1e9, 1);        % the Unix time column
if isempty(tcol), error('wavesensr_vs_gyro:time', 'No Unix time column in %s.', gyroCsv); end
tg = gv(:, tcol);
axesIdx = pick_axes(names, gv, tcol);
speed = sqrt(sum(gv(:, axesIdx) .^ 2, 2));             % angular speed magnitude
if median(speed, 'omitnan') < 0.2, speed = rad2deg(speed); end   % rad/s files
fsG = (numel(tg) - 1) / (tg(end) - tg(1));

% ------------------------------------------------------------------ signals on one clock
t0 = max(tw(1), tg(1)); t1 = min(tw(end), tg(end));
if t1 - t0 < 10, error('wavesensr_vs_gyro:overlap', 'The two files overlap by only %.1f s.', t1 - t0); end
grid_t = (t0:0.02:t1)';                                % 50 Hz common grid

wifi = movstd_rows(dB, round(o.Window * fsW));         % per slice, then across slices
wifi = median(wifi, 2, 'omitnan');
wifi = interp1(tw, wifi, grid_t, 'linear', 'extrap');
gyro = interp1(tg, movmean(speed, round(o.Window * fsG / 2)), grid_t, 'linear', 'extrap');

lag = xcorr_lag(zscore_(gyro), zscore_(wifi), 250);    % residual clock offset, +/- 5 s
R.clock_offset_s = lag * 0.02;
R.rates = [fsW fsG];
R.overlap_s = t1 - t0;

% ------------------------------------------------------------------ movement events from the gyroscope
moving = gyro > o.GyroThresh;
d = diff([false; moving; false]);
onsets = grid_t(d == 1); offsets = grid_t(find(d == -1) - 1);
keep = [true; onsets(2:end) - offsets(1:end-1) > o.MinGap];   % merge events split by a dip
onsets = onsets(keep); offsets = offsets([keep(2:end); true]);
R.n_movements = numel(onsets);

% quiet stretches: at least 2 s clear of any movement, for the false-alarm rate
quiet = true(size(grid_t));
for k = 1:numel(onsets), quiet(grid_t > onsets(k) - 1 & grid_t < offsets(k) + 2) = false; end

% ------------------------------------------------------------------ detection
base = median(wifi(quiet), 'omitnan');                 % the still level
mad_ = 1.4826 * median(abs(wifi(quiet) - base), 'omitnan');
R.still_level = base; R.still_spread = mad_;
peak = @(a, b) max(wifi(grid_t >= a & grid_t <= b));
hits = arrayfun(@(s) peak(s + o.Epoch(1) * 0, s + o.Epoch(2)), onsets);   % peak 0..+3 s
nq = floor(sum(quiet) / (3 / 0.02));                   % same-length quiet windows
qt = grid_t(quiet); qsig = wifi(quiet);
falses = arrayfun(@(k) max(qsig((k - 1) * 150 + 1 : min(k * 150, numel(qsig)))), 1:nq)';

thr = base + 4 * mad_;                                 % provisional cutoff
R.threshold = thr;
R.hit_rate = mean(hits > thr);
R.false_alarm_rate = mean(falses > thr);
R.dprime = z_(min(max(R.hit_rate, .01), .99)) - z_(min(max(R.false_alarm_rate, .01), .99));
R.auc = auc_(hits, falses);

% latency: first crossing of the cutoff after each onset
lat = nan(size(onsets));
for k = 1:numel(onsets)
    w = grid_t >= onsets(k) & grid_t <= onsets(k) + o.Epoch(2);
    i = find(wifi(w) > thr, 1);
    tt = grid_t(w);
    if ~isempty(i), lat(k) = tt(i) - onsets(k); end
end
R.latency_median_ms = 1000 * median(lat, 'omitnan');
R.latency_iqr_ms = 1000 * diff(prctile_(lat(~isnan(lat)), [25 75]));

% size: does a bigger turn give a bigger response?
gpeak = arrayfun(@(a, b) max(gyro(grid_t >= a & grid_t <= b)), onsets, offsets);
[R.size_rho, R.size_p] = spearman_(gpeak, hits);

fprintf(['%d movements over %.0f s · clock offset %+.2f s\n' ...
         'hits %.0f%% · false alarms %.0f%% · d'' %.2f · AUC %.2f\n' ...
         'latency %.0f ms (IQR %.0f) · size rho %.2f (p = %.3f)\n'], ...
        R.n_movements, R.overlap_s, R.clock_offset_s, 100 * R.hit_rate, ...
        100 * R.false_alarm_rate, R.dprime, R.auc, R.latency_median_ms, R.latency_iqr_ms, ...
        R.size_rho, R.size_p);

if o.Plot
    figure('Color', 'w', 'Name', 'WaveSensr vs gyroscope');
    tiledlayout(2, 1, 'TileSpacing', 'compact');
    nexttile; plot(grid_t - t0, gyro, 'k'); hold on; yline(o.GyroThresh, ':');
    ylabel('head speed (deg/s)'); title('Gyroscope'); xlim([0 R.overlap_s]); box off
    nexttile; plot(grid_t - t0, wifi, 'Color', [0 .4 .8]); hold on; yline(thr, ':');
    for k = 1:numel(onsets), xline(onsets(k) - t0, 'Color', [.85 .33 .1 .35]); end
    ylabel('WaveSensr change (dB)'); xlabel('time (s)'); title('WaveSensr, movements marked');
    xlim([0 R.overlap_s]); box off
end
end

% ------------------------------------------------------------------ helpers
function f = find_file(f)
% a bare file name is looked up in the logs folder, so you can pass just the name
if exist(f, 'file'), return; end
c = ws_config(); alt = fullfile(c.dir, f);
if exist(alt, 'file'), f = alt; return; end
error('wavesensr_vs_gyro:missing', 'No such file: %s (also looked in %s).', f, c.dir);
end
function idx = vartype_idx(T)
idx = varfun(@isnumeric, T, 'OutputFormat', 'uniform');
end
function idx = pick_axes(names, gv, tcol)
% the three gyroscope axes: named gx/gy/gz or wx/wy/wz, else the three most variable columns
hit = find(~cellfun(@isempty, regexpi(names, '^(gyro)?[gw]?[_ ]?[xyz]$')));
hit = hit(hit ~= tcol);
if numel(hit) >= 3, idx = hit(1:3); return; end
v = std(gv, 0, 1, 'omitnan'); v(tcol) = -Inf;
[~, ord] = sort(v, 'descend'); idx = sort(ord(1:3));
end
function M = movstd_rows(X, w)
M = movstd(X, w, 0, 1, 'omitnan');
end
function z = z_(p)
% inverse normal, without the Statistics toolbox
z = -sqrt(2) * erfcinv(2 * p);
end
function q = prctile_(x, ps)
x = sort(x(:)); n = numel(x);
q = interp1((0.5:n-0.5) / n * 100, x, ps, 'linear', 'extrap');
end
function [rho, p] = spearman_(a, b)
ok = ~isnan(a) & ~isnan(b); a = tiedrank_(a(ok)); b = tiedrank_(b(ok)); n = numel(a);
rho = sum((a - mean(a)) .* (b - mean(b))) / sqrt(sum((a - mean(a)).^2) * sum((b - mean(b)).^2));
t = rho * sqrt((n - 2) / max(1e-12, 1 - rho^2));          % two-sided, normal approximation
p = erfc(abs(t) / sqrt(2));
end
function r = tiedrank_(x)
[~, i] = sort(x); r = zeros(size(x)); r(i) = 1:numel(x);
[u, ~, g] = unique(x); for k = 1:numel(u), r(g == k) = mean(r(g == k)); end
end
function z = zscore_(x)
z = (x - mean(x, 'omitnan')) / std(x, 'omitnan');
end
function lag = xcorr_lag(a, b, maxlag)
a(isnan(a)) = 0; b(isnan(b)) = 0;
[c, l] = xcorr(a, b, maxlag, 'coeff');
[~, i] = max(c); lag = l(i);
end
function a = auc_(pos, neg)
% area under the ROC: the chance a movement scores above a quiet window
P = reshape(pos, [], 1); N = reshape(neg, 1, []);
a = mean(P > N, 'all') + .5 * mean(P == N, 'all');
end
