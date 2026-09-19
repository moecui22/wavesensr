% EXPLORE_PILOT  What else is in the Wi-Fi data, beyond "something moved"?
% EEG-style: the 109 usable slices are channels, the cues are events.
%   1. Direction  - does the slice pattern tell left from right from up...?
%   2. Speed      - do faster movements make the Wi-Fi fluctuate faster (in time)?
%   3. Frequency  - which slices (which part of the 2.4 GHz band) respond, and does
%                   a faster movement move the response to higher-frequency slices?
% Same four files as make_figures.m. Press Run.

rng(1);                                                       % reproducible permutations

%% ---------------------------------------------------------------- read
W = readmatrix('data/wifi_task.csv', 'NumHeaderLines', 1);
t = W(:, 1); A = W(:, 2:end);
m = median(A, 1); live = m > 0.3 * median(m(m > 0));
fMHz = 2432 + (0:127) * 0.3125; fMHz = fMHz(live);           % HT40 on channel 11: 2432-2472 MHz
A = A(:, live); A(A <= 0) = NaN;
dB = 20 * log10(A); dB = dB - mean(dB, 2, 'omitnan');        % remove whole-channel gain jumps
fs = (numel(t) - 1) / (t(end) - t(1));

G = readtable('data/gyro.csv');
tg = G.unix_time_s;
speed = sqrt(sum([G.gyro_x_dps G.gyro_y_dps G.gyro_z_dps] .^ 2, 2));

C = readtable('data/cues.csv', 'TextType', 'string');
C = C(~contains(C.condition, 'baseline'), :);
C = C(C.unix_time - 1 >= t(1) & C.back_unix_time <= t(end), :);   % cues the Wi-Fi covers
M = C(C.condition ~= "still", :);
kinds = ["left" "right" "up" "down" "tilt left" "tilt right"];
y = arrayfun(@(c) find(kinds == c), M.condition);
n = height(M);

%% ---------------------------------------------------------------- 1. direction
% One pattern per trial: the slice-by-slice shift from just before the cue to the
% held position (1 s after the cue until the word clears). Signed, 109 numbers.
seg = @(a, b) mean(dB(t >= a & t < b, :), 1, 'omitnan');
X = zeros(n, numel(fMHz));
for i = 1:n
    X(i, :) = seg(M.unix_time(i) + 1.0, M.back_unix_time(i)) - seg(M.unix_time(i) - 1.0, M.unix_time(i));
end
X(isnan(X)) = 0;

[acc, pred] = loo_centroid(X, y);
perm = zeros(1000, 1);
for k = 1:1000, perm(k) = loo_centroid(X, y(randperm(n))); end
p_acc = (sum(perm >= acc) + 1) / 1001;
CM = accumarray([y pred], 1, [6 6]);

% is each movement's pattern reproducible? odd vs even trials of the same movement
rel = zeros(6, 1);
for k = 1:6
    ix = find(y == k);
    rel(k) = corr_(mean(X(ix(1:2:end), :), 1), mean(X(ix(2:2:end), :), 1));
end

%% ---------------------------------------------------------------- 2. speed vs temporal frequency
gpk = zeros(n, 1); cent = zeros(n, 1); bandc = zeros(n, 1);
Pall = []; win = 1.5;
for i = 1:n
    a = M.unix_time(i);
    gpk(i) = max(speed(tg >= a & tg <= a + 2));               % how fast the head turned
    s = dB(t >= a & t < a + win, :);                           % the outward movement
    s(isnan(s)) = 0; s = detrend(s);
    N = size(s, 1);
    h = 0.5 - 0.5 * cos(2 * pi * (0:N-1)' / (N - 1));         % Hann window
    P = abs(fft(s .* h)) .^ 2;
    P = mean(P(1:floor(N / 2), :), 2);
    f = (0:floor(N / 2) - 1)' * fs / N;
    band = f >= 0.5 & f <= 15;
    cent(i) = sum(f(band) .* P(band)) / sum(P(band));          % where the fluctuation power sits
    Pall(:, i) = interp1(f, P / sum(P(band)), (0.5:0.25:15)'); %#ok<SAGROW>
    r = abs(X(i, :));
    bandc(i) = sum(fMHz .* r) / sum(r);                        % which part of the band responded
end
[rho_f, p_f] = spearman_perm(gpk, cent);
[rho_b, p_b] = spearman_perm(gpk, bandc);

%% ---------------------------------------------------------------- report
fprintf('\n%d movement trials, %d slices, %.0f Hz\n', n, numel(fMHz), fs);
fprintf('1. DIRECTION  decoded %.0f%% (chance 17%%), permutation p = %.3f\n', 100 * acc, p_acc);
fprintf('   pattern reproducibility (odd vs even trials): %s\n', ...
        strjoin(compose('%s %.2f', kinds', rel), ', '));
fprintf('2. SPEED      faster turn -> faster Wi-Fi fluctuation: rho = %.2f, p = %.3f\n', rho_f, p_f);
fprintf('   median fluctuation frequency %.1f Hz (slow half) vs %.1f Hz (fast half)\n', ...
        median(cent(gpk <= median(gpk))), median(cent(gpk > median(gpk))));
fprintf('3. FREQUENCY  faster turn -> higher-frequency slices: rho = %.2f, p = %.3f\n', rho_b, p_b);

%% ---------------------------------------------------------------- figures
ink = [.15 .15 .15]; blue = [0 .42 .8]; orange = [.85 .33 .1];

figure('Color', 'w', 'Position', [60 60 520 460]);
imagesc(CM ./ sum(CM, 2)); colormap(gca, flipud(gray)); clim([0 1]);
for r = 1:6, for c = 1:6
    if CM(r, c), text(c, r, num2str(CM(r, c)), 'HorizontalAlignment', 'center', ...
                      'Color', ink + (CM(r, c) / sum(CM(r, :)) > .5) * .8, 'FontSize', 11); end
end, end
set(gca, 'XTick', 1:6, 'XTickLabel', kinds, 'YTick', 1:6, 'YTickLabel', kinds, ...
         'TickLength', [0 0], 'FontSize', 10); xtickangle(30);
xlabel('decoded'); ylabel('cued');
title(sprintf('Direction, %.0f%% correct', 100 * acc), 'FontWeight', 'normal');
exportgraphics(gcf, 'figure4_direction.png', 'Resolution', 150);

figure('Color', 'w', 'Position', [60 60 900 380]);
tiledlayout(1, 2, 'TileSpacing', 'compact', 'Padding', 'compact');
nexttile; scatter(gpk, cent, 28, blue, 'filled', 'MarkerFaceAlpha', .7);
xlabel('head speed (deg/s)'); ylabel('Wi-Fi fluctuation (Hz)'); box off; set(gca, 'TickDir', 'out');
title(sprintf('Speed, rho %.2f', rho_f), 'FontWeight', 'normal');
nexttile; hold on
ff = (0.5:0.25:15)'; slow = gpk <= median(gpk);
plot(ff, mean(Pall(:, slow), 2), 'Color', ink, 'LineWidth', 1.4);
plot(ff, mean(Pall(:, ~slow), 2), 'Color', orange, 'LineWidth', 1.4);
text(ff(8), mean(Pall(8, slow), 2), '  slow turns', 'Color', ink, 'VerticalAlignment', 'bottom');
text(ff(14), mean(Pall(14, ~slow), 2), '  fast turns', 'Color', orange, 'VerticalAlignment', 'bottom');
set(gca, 'XScale', 'log', 'YScale', 'log', 'TickDir', 'out', 'XTick', [0.5 1 2 5 10 15]); box off
xlabel('fluctuation frequency (Hz)'); ylabel('share of power');
title('Spectrum by speed', 'FontWeight', 'normal');
exportgraphics(gcf, 'figure5_speed.png', 'Resolution', 150);

figure('Color', 'w', 'Position', [60 60 900 360]);
% on the true frequency grid: dropped slices (band edges, centre, the fade) stay as gaps
S = nan(6, 128); for k = 1:6, S(k, live) = mean(X(y == k, :), 1); end
fAll = 2432 + (0:127) * 0.3125;
imagesc(fAll, 1:6, S, 'AlphaData', ~isnan(S)); lim = max(abs(S(:)));
colormap(gca, coolwarm_); clim([-lim lim]); cb = colorbar; cb.Label.String = 'dB shift';
xline(2452, ':', 'centre', 'Color', [.4 .4 .4], 'LabelVerticalAlignment', 'bottom');
xline(2441.4, ':', 'fade', 'Color', [.4 .4 .4], 'LabelVerticalAlignment', 'bottom');
set(gca, 'YTick', 1:6, 'YTickLabel', kinds, 'TickDir', 'out', 'FontSize', 10); box off
xlabel('slice frequency (MHz)');
title('Which slices respond', 'FontWeight', 'normal');
exportgraphics(gcf, 'figure6_slices.png', 'Resolution', 150);

%% ---------------------------------------------------------------- helpers
function [acc, pred] = loo_centroid(X, y)
% leave one trial out; call it the movement whose average pattern it correlates with best
n = numel(y); pred = zeros(n, 1); ks = unique(y)';
for i = 1:n
    tr = true(n, 1); tr(i) = false; best = -Inf;
    for k = ks
        r = corr_(X(i, :), mean(X(tr & y == k, :), 1));
        if r > best, best = r; pred(i) = k; end
    end
end
acc = mean(pred == y);
end

function r = corr_(a, b)
a = a - mean(a); b = b - mean(b);
r = sum(a .* b) / sqrt(sum(a .^ 2) * sum(b .^ 2));
end

function [rho, p] = spearman_perm(a, b)
% Spearman correlation, p from 5000 shuffles (no toolbox needed)
ra = tiedrank_(a); rb = tiedrank_(b);
rho = corr_(ra(:)', rb(:)');
null = zeros(5000, 1);
for k = 1:5000, null(k) = corr_(ra(:)', rb(randperm(numel(rb)))'); end
p = (sum(abs(null) >= abs(rho)) + 1) / 5001;
end

function r = tiedrank_(x)
[~, i] = sort(x); r = zeros(size(x)); r(i) = 1:numel(x);
[u, ~, g] = unique(x); for k = 1:numel(u), r(g == k) = mean(r(g == k)); end
end

function m = coolwarm_
b = [.23 .30 .75]; w = [.95 .95 .95]; r = [.71 .02 .15];
t = linspace(0, 1, 128)';
m = [b + (w - b) .* t; w + (r - w) .* t];
end
