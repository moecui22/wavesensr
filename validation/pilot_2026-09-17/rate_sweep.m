% RATE_SWEEP  How low can the Wi-Fi sampling rate go before detection suffers?
% Thins the full-rate recording to lower rates, then scores every cue again.
% Same files as make_figures.m. Press Run.

rates = [70 50 30 20 12 6 3];                      % Hz; 12 = the radar's rate

W = readmatrix('data/wifi_task.csv', 'NumHeaderLines', 1);
t_all = W(:, 1); A_all = W(:, 2:end);
m = median(A_all, 1); live = m > 0.3 * median(m(m > 0));

C = readtable('data/cues.csv', 'TextType', 'string');
C = C(~contains(C.condition, 'baseline'), :);
C = C(C.unix_time >= t_all(1) & C.unix_time + 3 <= t_all(end), :);   % only cues the Wi-Fi recording covers
moved = C.condition ~= "still";

auc = @(p, n) mean(p(:) > n(:)', 'all') + .5 * mean(p(:) == n(:)', 'all');
out = table('Size', [numel(rates) 4], 'VariableTypes', repmat("double", 1, 4), ...
            'VariableNames', {'rate_Hz', 'AUC', 'hits_pct', 'false_alarms_pct'});

for r = 1:numel(rates)
    % keep one packet per 1/rate seconds: what the boards would have sent at that rate
    keep = [true; diff(floor((t_all - t_all(1)) * rates(r))) > 0];
    t = t_all(keep); A = A_all(keep, live); A(A <= 0) = NaN;
    dB = 20 * log10(A); dB = dB - mean(dB, 2, 'omitnan');
    fs = (numel(t) - 1) / (t(end) - t(1));
    idx = median(movstd(dB, max(3, round(fs)), 0, 1, 'omitnan'), 2, 'omitnan');   % change over ~1 s

    resp = nan(height(C), 1);
    for k = 1:height(C)
        w = t >= C.unix_time(k) & t <= C.unix_time(k) + 3;
        if any(w), resp(k) = max(idx(w)); end
    end
    s = resp(~moved); thr = median(s, 'omitnan') + 3 * 1.4826 * median(abs(s - median(s, 'omitnan')), 'omitnan');
    out(r, :) = {fs, auc(resp(moved), resp(~moved)), ...
                 100 * mean(resp(moved) > thr), 100 * mean(resp(~moved) > thr)};
end
disp(out)

figure('Color', 'w', 'Position', [100 100 520 360]);
plot(out.rate_Hz, out.AUC, 'o-', 'Color', [0 .42 .8], 'LineWidth', 1.2, 'MarkerFaceColor', [0 .42 .8]);
hold on; xline(12, ':', 'radar', 'Color', [.5 .5 .5]);
set(gca, 'XScale', 'log', 'XTick', flip(rates), 'TickDir', 'out', 'Box', 'off', 'FontSize', 11);
ylim([.5 1.02]); xlabel('sampling rate (Hz)'); ylabel('AUC');
title('Detection by sampling rate', 'FontWeight', 'normal');
exportgraphics(gcf, 'figure3_rate.png', 'Resolution', 150);
