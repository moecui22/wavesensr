# WaveSensr vs gyroscope — validation plan (2026-09-17)

**Question:** does WaveSensr detect a head movement when the gyroscope says one happened, and stay quiet when it didn't?
**Framing:** criterion validity with signal detection. The gyroscope is the criterion; WaveSensr is the measure.

## 0. Unknowns to confirm before the session
- [ ] Gyroscope: model, sampling rate, file format, and that it logs **Unix time**
- [ ] Where the MATLAB cue script runs, and whether its clock is the same machine as WaveSensr
- [ ] Steel sound booth confirmed: both boards **inside**, door closed for every recording
- [ ] Gyroscope radio: Bluetooth would transmit in WaveSensr's 2.4 GHz band inside the booth

## Environment: steel sound booth (not the home room used on 2026-09-16)
Home testing checks the software only; the booth needs its own room check and thresholds.

| | Effect | What to do |
|---|---|---|
| Metal walls shield outside radio | Neighbouring Wi-Fi, Bluetooth and corridor traffic can't get in → fewer false alarms | — |
| Metal walls reflect | Many bounces: movements may change the signal more, patterns are more complex, some slices sit in dead spots | Expect a different quiet level than at home |
| Door open vs closed | Two different radio rooms | Room check **door closed**; after sitting down and closing the door, **wait ~30 s** before trial 1 |
| Small space | Boards may not fit 2–4 m apart; close range can trigger receiver gain changes | Boards as far apart as the booth allows, not touching walls; keep "Remove gain jumps" on |
| 2.4 GHz devices inside | A **Bluetooth gyroscope** transmits in WaveSensr's band, from inside the box | Confirm the gyro's radio; prefer wired or log-to-memory |
| Cables through the door | Can stop the seal and act as an antenna | Route through a penetration panel if the booth has one |

Log in each recording's name or note: **door state, board positions, where the Mac sits.**

## Board placement (fill in with the booth's dimensions)
The sensitive zone is a round, rugby-ball shape along the line between the boards (the first Fresnel zone), widest halfway, tapering to each board.

- Wavelength λ ≈ 0.125 m at 2.4 GHz
- **Width at the middle = √(λ × D)**, where D is the distance between the boards
- Width at distance x from one board: **2 · √(λ · x · (D − x) / D)**

| D (boards apart) | Width = height at the middle |
|---|---|
| 1 m | ≈ 35 cm |
| 2 m | ≈ 50 cm |
| 3 m | ≈ 61 cm |
| 4 m | ≈ 71 cm |

Rules: head at the midpoint and at board height · boards as far apart as the booth allows, not touching walls · same door state for every recording.

Booth dimensions: _to be added_

## 1. Setup (≈15 min)
1. Boards on stands at **eye height**, upright, antenna up, faces toward each other, **100–120 cm apart** (antenna to antenna); head centred on the line. Cables strain-relieved. Enter the distance in Setup.
2. Receiver on the Mac; start WaveSensr in **Live**; check the packet rate is steady (~60 Hz).
3. Setup → **Save recordings to** the study folder.
4. Gyroscope on the head, fixed (headband), logging.
5. **Resting baseline:** participant seated, door closed. In MATLAB, `wavesensr_baseline('P01', 'OutDir', '<study folder>')` shows the instructions, counts down 10 s, then records 3 min of resting state (head still, eyes free). No quality rating yet; that comes from later analysis.

## 2. Protocol (≈12 min per run)
| Element | Plan |
|---|---|
| Trials | **44 per run**: 32 movement (left, right, up, down × 8) + **12 no-movement** catch trials (27%) |
| Order | Randomised; no more than 2 of the same kind in a row |
| Trial | Cue (1 s) → **move, hold ~1 s, return** → rest |
| Gap | **8–12 s, jittered** (uniform) |
| Posture | Torso still, hands in lap, eyes on a fixation point |
| Sync | **3 sharp nods** at the start and at the end of each run |
| Runs | 2 runs, short break between |

**Cue script:** `vitals/validation/wavesensr_cues.m` — `wavesensr_cues(1, 'OutDir', '<study folder>')`. Full-screen word + spoken cue (macOS voice), Esc stops and saves. Writes `cues_run<N>_<time>.csv` (trial, condition, move_cue_unix, return_cue_unix, gap_s) and `..._sync.csv` (sync nod times). Dry-run tested 2026-09-16; the full-screen window and voice still need one real try.

MATLAB logs per trial: `trial, condition, cue_unix, move_cue_unix, return_cue_unix`, with `t = posixtime(datetime('now','TimeZone','UTC'))`.

## 3. Files per run
- WaveSensr: `WS_<yyyymmdd>_<hhmmss>.csv` (`unix_time, s1…s128`, ~60 Hz) plus a `.json` with its label, times and board distance
- Gyroscope: native file with Unix time
- MATLAB: `cues_run<N>.csv`

## 4. Analysis
1. **Clock alignment.** Cross-correlate gyro angular speed with the WaveSensr movement signal over the sync nods; the start nods give the offset, the end nods the drift.
2. **WaveSensr movement signal.** dB per live slice → remove whole-channel gain jumps (subtract the across-slice mean) → **per-trial baseline correction** (−1 to 0 s before the cue) → RMS across slices.
3. **Gyroscope truth.** Angular speed magnitude; movement onset = first crossing of a threshold (e.g. 20 °/s, fixed before looking at WaveSensr).
4. **Detection.** Epoch −1 to +3 s. Peak WaveSensr signal per trial → **hit rate, false-alarm rate, d′, ROC AUC** (catch trials give the false alarms).
5. **Timing.** WaveSensr onset − gyro onset, per trial.
6. **Size.** Gyro peak speed and angle vs WaveSensr peak (Spearman).
7. **Direction (exploratory).** Classify left/right/up/down from the 114-slice pattern, leave-one-trial-out. Expect weak: one board pair has no directional geometry.

## 5. Success criteria (set now, before data)
- **AUC ≥ 0.80** for movement vs no movement
- **Hit rate ≥ 80% at false-alarm rate ≤ 20%**
- **Median latency < 300 ms**
- Direction: reported as exploratory, no criterion

## 6. Risks
| Risk | Guard |
|---|---|
| USB cable drops | Tape it; WaveSensr reconnects, gaps show in `unix_time` |
| Gain jumps look like movement | Removed in analysis step 2 |
| Torso or shoulder movement | Instructions; exclude trials where gyro shows movement on catch trials |
| Clock mismatch | Sync nods at start and end |
| Someone enters the room | Note time; exclude affected trials |
