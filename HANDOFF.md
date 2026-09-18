# WaveSensr — quick start

Runs on your laptop. No internet, no account. The boards don't use your Wi-Fi.

## Run it (Windows)

1. Download: **Code → Download ZIP**, unzip.
2. Receiver (**28:84:85:a4:3a:a8**) into USB. Sender on any charger.
3. Double-click **`start.bat`**. The page opens.
4. **Setup** → type the antenna-to-antenna distance (100–120 cm).

Mac: double-click `start.command` instead.

If "No packets": check the sender has power. If "No receiver": try another USB cable.

## The views

- **Raw** — signal strength per frequency slice
- **Rolling** — how much each slice is changing (blue steady, red moving)
- **Baseline** — difference from the last 3-min calibration

## Results so far

`validation/pilot_2026-09-17/` — data, figures, one-press MATLAB scripts.
Cued head movements vs gyroscope: **AUC 1.00**, same down to 3 Hz. One person, large movements.

## The boards

Stock Espressif [esp-csi](https://github.com/espressif/esp-csi) `get-started` examples,
commit `8633d67`, ESP-IDF v5.4.4, ESP32-S3. Channel 11, 40 MHz, 100 packets/s.
To reflash: `idf.py set-target esp32s3 && idf.py build && idf.py -p COM5 flash`
in `csi_send` or `csi_recv`.
