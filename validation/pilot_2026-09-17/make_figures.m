% MAKE_FIGURES  WaveSensr vs gyroscope, one session.
% Reads the four files in data\, lines them up on Unix time, draws two figures.
% Run it from this folder: just press Run.

wifiFile = 'data/wifi_task.csv';        % WaveSensr during the cued movements
baseFile = 'data/wifi_baseline.csv';    % WaveSensr during the 3 min resting calibration
gyroFile = 'data/gyro.csv';             % head gyroscope
cueFile  = 'data/cues.csv';             % what was on the screen, and when

%% ---------------------------------------------------------------- read
% WaveSensr: column 1 is Unix time, the rest are one amplitude per frequency slice.
W  = readmatrix(wifiFile,  'NumHeaderLines', 1);
B  = readmatrix(baseFile,  'NumHeaderLines', 1);
t_wifi = W(:, 1);
A = W(:, 2:end);
Abase = B(:, 2:end);

% Keep the slices that carry signal. Empty ones (band edges, centre) read 0, and a
% few very weak ones make dB noisy enough to swamp the colour scale, so set the bar
% at 30% of the typical slice.
m = median(A, 1);
live = m > 0.3 * median(m(m > 0)) & median(Abase, 1) > 0;
A     = A(:, live);      A(A <= 0)     = NaN;
Abase = Abase(:, live);  Abase(Abase <= 0) = NaN;

dB     = 20 * log10(A);
dBbase = 20 * log10(Abase);
dB     = dB     - mean(dB,     2, 'omitnan');      % remove whole-channel gain jumps (AGC)
dBbase = dBbase - mean(dBbase, 2, 'omitnan');

ref  = mean(dBbase, 1, 'omitnan');                 % the calibration: mean dB per slice at rest
Dev  = dB - ref;                                   % baseline corrected, per slice  <- the heatmap
wifi_base = sqrt(mean(Dev .^ 2, 2, 'omitnan'));    % RMS across slices              <- the line

fs = (numel(t_wifi) - 1) / (t_wifi(end) - t_wifi(1));
wifi_roll = median(movstd(dB, round(fs), 0, 1, 'omitnan'), 2, 'omitnan');   % change over 1 s

% Gyroscope: Unix time and three axes in deg/s.
G = readtable(gyroFile);
t_gyro  = G.unix_time_s;
gyroRMS = sqrt(mean([G.gyro_x_dps G.gyro_y_dps G.gyro_z_dps] .^ 2, 2));

% Cues: one row per trial, plus the two resting blocks.
C = readtable(cueFile, 'TextType', 'string');
C = C(~contains(C.condition, 'baseline'), :);
t_cue = C.unix_time;
moved = C.condition ~= "still";

x = [t_cue(1) - 10, C.back_unix_time(end) + 10];   % the window all three share

%% ---------------------------------------------------------------- figure 1: own units
figure('Color', 'w', 'Position', [60 60 1250 820]);
tiledlayout(3, 1, 'TileSpacing', 'compact', 'Padding', 'compact');

nexttile; hold on
cue_lines(t_cue, moved);
plot(t_gyro, gyroRMS, 'k', 'LineWidth', .4);
ylabel('deg/s'); title('Gyroscope', 'FontWeight', 'normal'); tidy(x);

nexttile; hold on
cue_lines(t_cue, moved);
plot(t_wifi, wifi_base, 'Color', [.85 .33 .1], 'LineWidth', .5);
ylabel('dB'); title('WaveSensr, baseline corrected', 'FontWeight', 'normal'); tidy(x);

nexttile
step = max(1, round(numel(t_wifi) / 2000));        % thin in time so it draws quickly
imagesc(t_wifi(1:step:end), 1:size(Dev, 2), Dev(1:step:end, :)');
set(gca, 'YDir', 'normal'); colormap(gca, coolwarm);
lim = quantile(abs(Dev(:)), .98);                  % one weak slice should not set the scale
clim([-lim lim]);
c = colorbar; c.Label.String = 'dB from calibration';
ylabel('slice'); xlabel('unix time (s)');
title('WaveSensr, every slice', 'FontWeight', 'normal'); tidy(x);

exportgraphics(gcf, 'figure1_units.png', 'Resolution', 150);

%% ---------------------------------------------------------------- figure 2: z-scores
z = @(v) (v - mean(v, 'omitnan')) / std(v, 'omitnan');

figure('Color', 'w', 'Position', [60 60 1250 430]); hold on
cue_lines(t_cue, moved);
h1 = plot(t_gyro, z(gyroRMS), 'Color', [.15 .15 .15 .75], 'LineWidth', .4);
h2 = plot(t_wifi, z(wifi_roll), 'Color', [0 .42 .8 .85], 'LineWidth', .5);
h3 = plot(t_wifi, z(wifi_base), 'Color', [.85 .33 .1 .6], 'LineWidth', .5);
legend([h1 h2 h3], {'gyroscope', 'WaveSensr, rolling', 'WaveSensr, baseline'}, ...
       'Box', 'off', 'Location', 'northeast');
ylabel('z'); xlabel('unix time (s)');
title('Both sensors, standardised', 'FontWeight', 'normal'); tidy(x);

exportgraphics(gcf, 'figure2_zscore.png', 'Resolution', 150);

%% ---------------------------------------------------------------- helpers
function cue_lines(t_cue, moved)
% a reference line at every cue: blue where a movement was asked for, grey for "still"
for k = 1:numel(t_cue)
    c = [0 .42 .8 .30]; if ~moved(k), c = [.55 .55 .55 .40]; end
    xline(t_cue(k), '-', 'Color', c, 'LineWidth', .6);
end
end

function tidy(x)
% few marks: the ends of the y range, round numbers on x
a = gca;
box off; a.TickDir = 'out'; a.FontSize = 11; a.XGrid = 'off'; a.YGrid = 'off';
xlim(x);
step = 100 * max(1, round(diff(x) / 400));
a.XTick = ceil(x(1) / step) * step : step : x(2);
a.XAxis.Exponent = 0; xtickformat('%.0f');
yl = a.YLim; a.YTick = unique([floor(yl(1)) 0 floor(yl(2))]);
end

function m = coolwarm
% blue - white - red, for a signed quantity
b = [.23 .30 .75]; w = [.95 .95 .95]; r = [.71 .02 .15];
t = linspace(0, 1, 128)';
m = [b + (w - b) .* t; w + (r - w) .* t];
end
