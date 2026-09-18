# Pilot, 17 Sep 2026

One session, one participant (the author), testing whether WaveSensr detects cued head
movements as reliably as a head-worn gyroscope. Everything is aligned on Unix time.

**Result:** AUC 1.00 for both sensors across the 59 trials the Wi-Fi recording covered (48 movement, 11 still; the first cue came before it started);
hits 100%, false alarms 9%; no loss from the first half to the second; unchanged when
the Wi-Fi is thinned from 70 Hz to 3 Hz. Boards were 200 cm apart.

**What it doesn't show yet:** the movements were large (100–200 °/s), so this is a
ceiling, not a limit. n = 1. Latency isn't measurable with the centred 1 s window.

## Files

| | |
|---|---|
| `data/wifi_task.csv` | WaveSensr during the cues: `unix_time, s1…s128`, 70 Hz |
| `data/wifi_baseline.csv` | WaveSensr during the 3 min resting calibration |
| `data/gyro.csv` | Phidget IMU on the head: `unix_time_s`, accel (g), `gyro_x/y/z_dps`, 125 Hz |
| `data/cues.csv` | each cue: `unix_time` (word on screen), `back_unix_time` (word cleared) |
| `make_figures.m` | figures 1 and 2 — open this folder in MATLAB and press Run |
| `rate_sweep.m` | figure 3: detection at 70 → 3 Hz |

The session was run with `../lab/run_experiment_wavesensr.m` (PsychToolbox): 3 min rest,
60 cued trials (left, right, up, down, left/right ear to shoulder ×8, 12 still), 3 min rest.
