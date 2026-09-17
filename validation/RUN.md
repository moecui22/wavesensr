# WaveSensr validation — run sheet

Copy this whole folder to the testing computer. Nothing inside needs editing except
`ws_config.m`, and only if MATLAB is not on the same machine as WaveSensr.

In MATLAB: `cd` into this folder (or add it to the path). Logs are written to
`runs/` beside the scripts.

## Before the participant arrives

1. Boards on their stands at eye height, antennas up, chip faces towards each
   other, **100–120 cm apart**, head centred between them. Measure antenna to
   antenna and type it into WaveSensr → Setup.
2. Start WaveSensr on the Mac (`/usr/bin/python3 server.py`, then
   <http://localhost:8777>), press **Start**, confirm packets are arriving.
3. Fit the gyroscope on the head and start its recording.
4. In MATLAB:

```matlab
ws_check
```

It must print `ready`. The line that matters most is **clock**: if MATLAB and
WaveSensr are on different machines and their clocks differ by more than a
quarter of a second, stop and fix the time before recording anything.

## The session

```matlab
wavesensr_baseline('P01')     % 3 min resting baseline, instructions + 10 s countdown
wavesensr_cues(1)             % 44 trials: left/right/up/down x 8, still x 12, ~9 min
wavesensr_cues(2)             % a second run if there is time
```

`wavesensr_baseline` drives WaveSensr itself — it starts and stops the recording
over HTTP, so don't press Record by hand. `wavesensr_cues` does **not**: start
the WaveSensr recording before the run and stop it after.

Esc stops either script and saves what was done. Add `'DryRun', true` to either
one for a 10-second rehearsal with no window and no voice.

Both runs begin and end with **3 sync nods**. Do them properly — they are the
check that the gyroscope, the video and WaveSensr agree.

## What each run leaves behind

| File | Where | What |
|---|---|---|
| `WS_<date>_<time>.csv` + `.json` | WaveSensr's save folder | Wi-Fi, one row per packet, Unix time |
| `baseline_<P>_<stamp>.csv` | `runs/` | baseline start/end, Unix time |
| `cues_run<n>_<stamp>.csv` | `runs/` | every cue, Unix time, stamped when the word hits the screen |
| gyroscope csv | wherever the gyroscope saves | Unix time + 3 axes |
| video | camera | for the eyeball check |

All four clocks are Unix seconds, so nothing needs aligning by hand.

## Afterwards

```matlab
R = wavesensr_vs_gyro('WS_20260917_131132.csv', 'gyro_run1.csv')
```

Prints hit rate, false alarms, d′, AUC, latency and whether bigger turns give
bigger responses, and plots the two streams with the movements marked. A bare
file name is looked up in `runs/`. `R.clock_offset_s` is the leftover offset
measured from the data — anything past a few tenths of a second means a clock
problem, not a detection failure.

## Notes

- The spoken cue lags the screen by about a tenth of a second. The screen time is
  the one in the log; use `'Voice', false` if you'd rather have neither.
- Run the baseline again if the participant shifts posture — the Baseline view
  is only meaningful in the posture it was recorded in.
