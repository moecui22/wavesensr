# Running WaveSensr on your own laptop

Everything runs on the laptop. Nothing is uploaded, no account, no internet.

**The two boards do not use your Wi-Fi.** The sender broadcasts and the receiver
listens on a fixed channel, so they work on any network or none at all — a
different office, a different router, an aeroplane. The receiver never joins
anything (it runs in sniffer mode; you can see `ic_enable_sniffer` in its startup
log). Leave your own Wi-Fi as it is.

## Windows

1. **Python** — if `python` isn't already installed, get it from
   <https://www.python.org/downloads/> and **tick "Add python.exe to PATH"** on the
   first screen of the installer. That tick is the only thing that usually goes wrong.
2. **Download** the project: green **Code** button → **Download ZIP**, then unzip it
   somewhere normal like Documents. Run it from a real folder, not from inside the zip.
3. **Plug the receiver in** by USB. Windows 10 and 11 need no driver for it. Give the
   sender any USB charger — phone charger, laptop port, power bank.
4. **Double-click `start.bat`.** It installs one small package (pyserial) the first
   time, starts the app and opens the page.
   If Windows says "Windows protected your PC": **More info** → **Run anyway**.
5. In the page: measure the gap between the two antennas in cm, type it into
   **Setup**, then press **Start**.

No firewall prompt: the app only listens on this machine.

## Mac

Same, without steps 1 and 4: double-click **`start.command`** (the first time,
right-click it → **Open** → **Open**). macOS needs nothing installed.

## Using it

**Start** streams, **Record** saves a run as a CSV plus a small .json beside it, in
the folder shown in Setup. **Calibrate** records a 3-minute resting baseline.

The heatmap: each row is one frequency slice of the Wi-Fi channel, each column a
moment in time. **Raw** is received strength in dB. **Rolling** is how much each
slice has changed against its own recent average — blue steady, red changing.
**Baseline** is the signed difference from the last Baseline recording, so it only
means anything in the posture that baseline was recorded in.

Nothing is ever simulated. With no boards attached the app says so and shows the
setup figure instead.

## If nothing arrives

The status pill says what's wrong in plain words.

- **"No receiver found"** — usually a charge-only USB cable, or the sender board is
  plugged in instead of the receiver. The app tries every serial port by itself, so
  you shouldn't have to pick one.
- **"No packets"** — the sender has no power, or it's too far away.
- Boards more than about 2 m apart, or a wall between them, will also look like this.

Quit by closing the terminal window.

## How the two boards were programmed

Both boards are **Freenove ESP32-S3** running Espressif's own CSI examples, unmodified:
[esp-csi](https://github.com/espressif/esp-csi) at commit `8633d67` (22 Apr 2026),
`examples/get-started/`, built with **ESP-IDF v5.4.4** for target `esp32s3`.

| Board | Example | MAC | Where it goes |
|---|---|---|---|
| **Receiver** | `csi_recv` | 28:84:85:a4:3a:a8 | USB to the laptop |
| **Sender** | `csi_send` | 28:84:85:a7:94:50 | any USB charger |

The settings that matter, all in each example's `main/app_main.c`:

| Setting | Value | Meaning |
|---|---|---|
| `CONFIG_LESS_INTERFERENCE_CHANNEL` | 11 | Wi-Fi channel both boards use (must match) |
| `CONFIG_WIFI_BANDWIDTH` | `WIFI_BW_HT40` | 40 MHz wide: 128 frequency slices per packet, ~114 usable |
| `CONFIG_ESP_NOW_RATE` | MCS0, long guard | the slowest, most robust rate |
| `CONFIG_SEND_FREQUENCY` (sender) | 100 | packets per second; ~60–85 arrive, depending on other traffic |
| `CONFIG_CSI_SEND_MAC` | 1a:00:00:00:00:00 | the sender's identity; the receiver keeps packets from this address only, so no other Wi-Fi gets recorded |
| `CONFIG_GAIN_CONTROL` (receiver) | 1 | the receiver's automatic gain is on — amplitudes are relative, not calibrated |

The sender broadcasts ESP-NOW packets; the receiver listens in sniffer mode and
prints each packet's channel estimate over USB as a `CSI_DATA` line, which
WaveSensr reads. Neither board joins a network.

### To reflash or change a setting

Install ESP-IDF v5.4.4 (on Windows, Espressif's installer gives you an
"ESP-IDF Command Prompt"), then:

```bash
git clone https://github.com/espressif/esp-csi.git
cd esp-csi && git checkout 8633d67
cd examples/get-started/csi_send        # or csi_recv for the other board
idf.py set-target esp32s3
idf.py build
idf.py -p COM5 flash monitor             # the board's port; /dev/cu.usbmodem… on a Mac
```

To change the packet rate, edit `CONFIG_SEND_FREQUENCY` in
`csi_send/main/app_main.c` and reflash **the sender only**. To move channel, change
`CONFIG_LESS_INTERFERENCE_CHANNEL` in **both** and reflash both — a mismatch looks
exactly like "No packets".

You probably don't need to change the rate: detection in the first session was
identical from 70 Hz down to 3 Hz (`rate_sweep.m`), so for head movement the
default is already far more than enough. Record at the full rate and thin it in
analysis if you want a lower one.
