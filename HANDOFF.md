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
