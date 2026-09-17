# WaveSensr recap (draft)

## 1. Mechanisms

WaveSensr senses human movement with ordinary Wi-Fi. Two small boards form the sensor: one sends Wi-Fi packets, the other receives them. They use the **2.4 GHz** band, which runs from **2,400 to 2,483.5 MHz**, and sense on a **40 MHz** slice of it (**2,432–2,472 MHz**), just under half the band. That slice is divided into **128 frequency slices** of 0.3125 MHz each. For every packet, the receiving chip measures, in each slice, how strongly the signal arrived compared with what was sent (**received ÷ sent**).

Anything that doesn't move, like furniture, gives a **steady** signal, which WaveSensr subtracts as the room's baseline. What remains is **change over time**: large movements appear as brief, strong bursts, while breathing and heartbeat appear as slow, small rhythms. Because breathing, heartbeat and body movements differ in **frequency, shape and timing** — though their frequency bands partly overlap — combining these cues lets us attribute a change between conditions to specific human activity rather than to the room.

In testing, after the room and resting-state calibrations, WaveSensr records about **60 snapshots per second** (a sampling frequency of **≈ 60 Hz**, measured at 60–63 Hz in the office and up to ~78 Hz at home, so analyses align on each snapshot's timestamp). Each snapshot is a row of **128 strengths**, one per slice. Comparing these rows with the baseline, and with each other over time, reveals the changes caused by human movement.

## 2. The summary CSV

*(next)*
