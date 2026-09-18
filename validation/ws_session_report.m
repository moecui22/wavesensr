function R = ws_session_report(wifiCsv, gyroCsv, cueCsv, baselineCsv)
% WS_SESSION_REPORT  One session, end to end: does WaveSensr see the cued movements
% as reliably as the gyroscope, and does it stay that good all session?
%
%   R = ws_session_report(wifi, gyro, cues, baselineWifi)
%
% Everything is aligned by Unix time, the clock all three files write.
% Truth here is the CUE LOG (what the participant was told to do), not a threshold
% on the gyroscope, so "still" trials are a real null rather than a leftover gap.

W = readmatrix(wifiCsv, 'NumHeaderLines', 1);
tw = W(:, 1); A = W(:, 2:end);
live = median(A, 1) > 0; A = A(:, live); A(A <= 0) = NaN;   % drop the empty slices
dB = 20 * log10(A);
dB = dB - mean(dB, 2, 'omitnan');                            % remove whole-channel gain jumps
fsW = (numel(tw) - 1) / (tw(end) - tw(1));

perSlice = movstd(dB, round(fsW), 0, 1, 'omitnan');          % 1 s change, per slice
wifi = median(perSlice, 2, 'omitnan');                       % one movement index

G = readtable(gyroCsv);
names = G.Properties.VariableNames;
tg = G.(names{find(cellfun(@(n) ~isempty(regexpi(n, 'unix')), names), 1)});
gx = find(~cellfun(@isempty, regexpi(names, '^gyro[_ ]?[xyz]')));
speed = sqrt(sum(G{:, gx} .^ 2, 2));                         % angular speed, deg/s

C = readtable(cueCsv, 'TextType', 'string');
isBase = contains(C.condition, 'baseline');
base_pre  = [C.unix_time(C.condition == "baseline_pre_start")  C.back_unix_time(C.condition == "baseline_pre_start")];
base_post = [C.unix_time(C.condition == "baseline_post_start") C.back_unix_time(C.condition == "baseline_post_start")];
T = C(~isBase, :);
moved = T.condition ~= "still";

% ------------------------------------------------------------------ per trial
peak = @(sig, t, a, b) pk_(sig(t >= a & t <= b));
resp = arrayfun(@(a) peak(wifi, tw, a, a + 3), T.unix_time);         % WaveSensr, 0..3 s after the cue
gyroPk = arrayfun(@(a) peak(speed, tg, a, a + 3), T.unix_time);      % gyroscope, same window
ok = ~isnan(resp);
R.n_trials = sum(ok); R.n_moved = sum(moved & ok); R.n_still = sum(~moved & ok);

R.auc_wifi = auc_(resp(moved & ok), resp(~moved & ok));              % cued movement vs cued stillness
R.auc_gyro = auc_(gyroPk(moved & ok), gyroPk(~moved & ok));
still_lvl = median(resp(~moved & ok)); spread = 1.4826 * median(abs(resp(~moved & ok) - still_lvl));
thr = still_lvl + 3 * spread;
R.threshold = thr;
R.hit_rate = mean(resp(moved & ok) > thr);
R.false_alarm_rate = mean(resp(~moved & ok) > thr);
R.dprime = z_(clip(R.hit_rate)) - z_(clip(R.false_alarm_rate));

% consistency: how much does the same movement vary from trial to trial?
kinds = unique(T.condition(moved));
R.by_kind = table(kinds, zeros(size(kinds)), zeros(size(kinds)), zeros(size(kinds)), ...
                  'VariableNames', {'movement', 'median_dB', 'cv', 'auc'});
for k = 1:numel(kinds)
    m = ok & T.condition == kinds(k);
    R.by_kind.median_dB(k) = median(resp(m));
    R.by_kind.cv(k) = std(resp(m)) / mean(resp(m));                  % spread relative to size
    R.by_kind.auc(k) = auc_(resp(m), resp(~moved & ok));
end

% stability: first half against second half, and how far the channel drifted
h = ok & moved; i1 = find(h, floor(sum(h)/2)); i2 = setdiff(find(h), i1);
R.auc_first_half = auc_(resp(i1), resp(~moved & ok));
R.auc_second_half = auc_(resp(i2), resp(~moved & ok));
R.size_rho = spearman_(gyroPk(h), resp(h));

% drift: the same slices, before and after the session
if nargin > 3 && ~isempty(baselineCsv)
    B = readmatrix(baselineCsv, 'NumHeaderLines', 1);
    bA = B(:, 2:end); bA = bA(:, live); bA(bA <= 0) = NaN;
    bdB = 20 * log10(bA); bdB = bdB - mean(bdB, 2, 'omitnan');
    ref = mean(bdB, 1, 'omitnan');                                   % the calibration
    dev = sqrt(mean((dB - ref) .^ 2, 2, 'omitnan'));                 % how far from it, per sample
    bdev = sqrt(mean((bdB - ref) .^ 2, 2, 'omitnan'));            % the wobble inside the calibration itself
    R.drift_pre_dB  = median(bdev);
    R.drift_post_dB = median(dev(tw >= base_post(1) & tw <= base_post(2)));
else
    dev = nan(size(tw)); R.drift_pre_dB = NaN; R.drift_post_dB = NaN;
end

fprintf(['\n%d trials (%d movement, %d still), %.0f Hz\n' ...
         'AUC  WaveSensr %.2f   gyroscope %.2f\n' ...
         'hits %.0f%%  false alarms %.0f%%  d'' %.2f\n' ...
         'stability: first half %.2f, second half %.2f\n' ...
         'drift from calibration: %.2f dB at the start, %.2f dB at the end\n'], ...
        R.n_trials, R.n_moved, R.n_still, fsW, R.auc_wifi, R.auc_gyro, ...
        100*R.hit_rate, 100*R.false_alarm_rate, R.dprime, ...
        R.auc_first_half, R.auc_second_half, R.drift_pre_dB, R.drift_post_dB);
disp(R.by_kind)

% ------------------------------------------------------------------ figures
% Figure 1: each sensor in its own units. Figure 2: both as z-scores on one axis,
% which is where the timing agreement is visible. A reference line at every cue.
t0 = 0;                                  % x is Unix time itself
gyroRMS = sqrt(mean(G{:, gx} .^ 2, 2));
xl = [T.unix_time(1) - 10, T.back_unix_time(end) + 10];
when = string(datetime(t0, 'ConvertFrom', 'posixtime', 'Format', 'd MMM yyyy, HH:mm'));
wifiName = sprintf('WaveSensr  ·  RMS across %d live slices, baseline corrected', sum(live));

f1 = figure('Color', 'w', 'Position', [60 60 1250 620]);
tiledlayout(2, 1, 'TileSpacing', 'compact', 'Padding', 'compact');
nexttile; hold on
cuelines(T, moved, t0, gyroRMS);
plot(tg - t0, gyroRMS, 'Color', [.15 .15 .15], 'LineWidth', .4);
ylabel('deg/s'); title('Gyroscope', 'FontWeight', 'normal'); strip_(gca);
nexttile; hold on
cuelines(T, moved, t0, dev);
plot(tw - t0, dev, 'Color', [.85 .33 .1], 'LineWidth', .5);
ylabel('dB'); xlabel('unix time (s)');
title('WaveSensr, baseline corrected', 'FontWeight', 'normal'); strip_(gca);
for a = findobj(f1, 'Type', 'axes')', xlim(a, xl); strip_(a); end
sgtitle(sprintf('Head movements, cue by cue   ·   AUC %.2f', R.auc_wifi), 'FontSize', 13);

f2 = figure('Color', 'w', 'Position', [60 60 1250 420]);
zg = zscore_(gyroRMS); zr = zscore_(wifi); zw = zscore_(dev);
hold on
cuelines(T, moved, t0, [zg; zr; zw]);
h1 = plot(tg - t0, zg, 'Color', [.15 .15 .15 .75], 'LineWidth', .4);
h2 = plot(tw - t0, zr, 'Color', [0 .42 .8 .85], 'LineWidth', .5);
h3 = plot(tw - t0, zw, 'Color', [.85 .33 .1 .7], 'LineWidth', .5);
ylabel('z'); xlabel('unix time (s)'); xlim(xl);
legend([h1 h2 h3], {'gyroscope', 'WaveSensr, rolling', 'WaveSensr, baseline'}, ...
       'Box', 'off', 'Location', 'northeast', 'FontSize', 10);
title('Both sensors, standardised', 'FontWeight', 'normal', 'FontSize', 13);
strip_(gca);

f = f1; R.figures = [f1 f2];
R.figure = f;
end

% ------------------------------------------------------------------ helpers
function cuelines(T, moved, t0, sig)
% a reference line at every cue: blue where a movement was asked for, grey for "still"
sig = sig(~isnan(sig));
lo = min(min(sig), 0); hi = max(sig) * 1.05;
for k = 1:height(T)
    x = T.unix_time(k) - t0;
    c = [0 .42 .8 .35]; if ~moved(k), c = [.55 .55 .55 .45]; end
    plot([x x], [lo hi], '-', 'Color', c, 'LineWidth', .6);
end
ylim([lo hi]);
end
function z = zscore_(x)
z = (x - mean(x, 'omitnan')) / std(x, 'omitnan');
end
function strip_(a)
% as few marks as carry the meaning: ends of the y range, round numbers on x
box(a, 'off'); a.XGrid = 'off'; a.YGrid = 'off'; a.TickDir = 'out';
a.FontSize = 11; a.LineWidth = .75; a.Color = 'none';
yl = a.YLim; a.YTick = unique([0 floor(yl(2))]); a.YLim = [min(yl(1), 0) yl(2)];
xl = a.XLim; step = 100 * max(1, round(diff(xl) / 400));       % round numbers, four or five of them
a.XTick = ceil(xl(1) / step) * step : step : xl(2);
a.XAxis.Exponent = 0; xtickformat(a, '%.0f');
end
function v = pk_(x)
x = x(~isnan(x));
if isempty(x), v = NaN; else, v = max(x); end
end
function p = clip(p), p = min(max(p, .01), .99); end
function z = z_(p), z = -sqrt(2) * erfcinv(2 * p); end
function a = auc_(pos, neg)
P = reshape(pos, [], 1); N = reshape(neg, 1, []);
a = mean(P > N, 'all') + .5 * mean(P == N, 'all');
end
function q = prctile_(x, ps)
x = sort(x(~isnan(x))); n = numel(x);
q = interp1((0.5:n-0.5) / n * 100, x, ps, 'linear', 'extrap');
end
function rho = spearman_(a, b)
ok = ~isnan(a) & ~isnan(b); a = tiedrank_(a(ok)); b = tiedrank_(b(ok));
rho = sum((a - mean(a)) .* (b - mean(b))) / sqrt(sum((a - mean(a)).^2) * sum((b - mean(b)).^2));
end
function r = tiedrank_(x)
[~, i] = sort(x); r = zeros(size(x)); r(i) = 1:numel(x);
[u, ~, g] = unique(x); for k = 1:numel(u), r(g == k) = mean(r(g == k)); end
end
