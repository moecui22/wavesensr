# Trying WaveSensr on another Mac

Everything runs on the laptop. No install, no network, no accounts — macOS's own
Python is enough, and the two boards talk only to each other.

1. Copy this folder to the laptop (AirDrop, USB stick, or download the repo zip).
2. Plug the **receiver** into the laptop by USB. Give the **sender** any USB charger.
3. Double-click **`start.command`**. The page opens by itself.
   First time only: macOS may say it can't check the file — right-click it, choose
   **Open**, then **Open** again.
4. In the page: measure the gap between the two antennas, type it into **Setup**,
   press **Start**.

That's it. Press **Record** to save a run; recordings land in the folder shown in
Setup, as a CSV and a small .json beside it.

## If nothing arrives

The status pill says what is wrong in plain words. The usual causes:

- **"No receiver found"** — the USB cable is a charge-only cable, or the wrong board
  is plugged in. The receiver is the one with `csi_recv` flashed.
- **"No packets"** — the sender has no power, or it is out of range. The pair is
  fixed to one Wi-Fi channel; they find each other, not a router.

Quit by closing the Terminal window.

## What he is looking at

Each row of the heatmap is one frequency slice of the Wi-Fi channel; each column is
a moment in time. **Raw** is the received strength in dB. **Rolling** is how much
each slice has changed against its own recent average — blue steady, red changing.
**Baseline** is the signed difference from the last 3-minute Baseline recording, so
it only means anything in the posture that baseline was recorded in.

Nothing is simulated: with no boards, the app says so and shows the setup figure.
