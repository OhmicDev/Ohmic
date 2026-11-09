# Hardware checklist

The automated tests (`npm test`, `npm run test:e2e`) run against the simulated scooter. They prove the app's
logic, not that a real controller agrees with it. Go through this list on real hardware before a release, and
again for each new firmware version or controller family.

## Before you start

- [ ] A controller on the bench with the **wheel off the ground** (or the motor unloaded), on a current-limited
      supply or a battery with a fuse.
- [ ] A copy of its settings made with VESC Tool (*Backup configuration* or *Save XML* for motor and app).
      Ohmic makes its own backups, but a second one from another tool is the point of this exercise.
- [ ] VESC Tool on a laptop nearby, to check what Ohmic wrote.
- [ ] Note what you test on in the table at the end: controller, firmware, connection, browser and device.

## Connection

- [ ] USB in Chrome or Edge on a computer: connects, shows hardware, firmware and UUID.
- [ ] Bluetooth through a VESC Express or NRF module in Chrome or Edge, on a computer and on Android.
- [ ] Pull the USB cable while connected: the app says so, freezes values, and reconnects by itself when the
      cable is back (with *Reconnect automatically* on).
- [ ] Other controllers on the CAN bus show up, with the right IDs and firmware.
- [ ] A firmware Ohmic doesn't know (for example a newer one): the controller opens **read-only**; nothing can
      be written.

## Settings (Config)

- [ ] Motor and app settings read back with the same values VESC Tool shows (spot-check 10, including a
      scaled one such as a percentage, and an enum).
- [ ] Change one value, *Review & write*: the dialog shows exactly that change; after writing it says
      *Written and verified*; VESC Tool shows the new value.
- [ ] Type a value outside VESC's range: it's refused with the range shown, and not changed.
- [ ] Spin the motor (by hand or with Motor control): *Review & write* is held back with the reason, until the
      wheel stops.
- [ ] A backup appears under Backups after each write; restoring it puts the old values back (check in VESC Tool).
- [ ] Export XML from Ohmic and load it in VESC Tool, and the other way round: same values.
- [ ] Dual motor (two controllers over CAN): a change written to both is verified on both.

## Motor control, setup and detection

- [ ] Motor control: the motor runs only while the button is held, and stops when it's released.
- [ ] While holding, pull the USB cable: the motor stops within the firmware's timeout.
- [ ] While holding, switch to another browser tab or lock the phone: the motor stops.
- [ ] Setup › Motor detection: results are close to VESC Tool's on the same motor.
- [ ] While detection measures, the motor current and speed on screen move (the controller keeps answering
      during detection; if they stay at 0 on this firmware, note it).
- [ ] Go through Setup's four steps in order on a fresh controller: each one leads to the next, and Ride stops
      suggesting setup once all four are done.
- [ ] Setup › Input: throttle and brake calibration match what the controller sees.
- [ ] Setup › Direction: the reverse switch changes direction as shown.

## Firmware update (use a spare controller)

- [ ] The right firmware file is offered for the hardware; the download shows progress.
- [ ] Update over USB: the controller restarts on the new version and its settings are still readable.
- [ ] Update a controller on the CAN bus through the one on the cable.
- [ ] The update won't start while a wheel turns.
- [ ] A firmware file you choose yourself (`.bin`) that doesn't name this hardware needs an extra, explicit
      confirmation before it can be installed.

## Live, ride and logs

- [ ] Ride and Live values match VESC Tool's realtime data (voltage, currents, ERPM, duty, temperatures).
- [ ] A fault on the controller (for example under-voltage on a bench supply) shows on Ride and under Faults.
- [ ] On a phone, record a ride with GPS: map, speed and charts look right afterwards; export works.
- [ ] Ride modes, ABS and regen settings change what the controller does as described (on the bench first).
- [ ] Motor sounds play through the motor.

## LispBM scripts

- [ ] Upload and run a script (for example the Hello example): it runs, `print` output appears in the console.
- [ ] The REPL evaluates an expression and prints the result (`(+ 1 2)` gives `3`).
- [ ] Stats show CPU, heap and memory use, and global variable bindings, while a script runs.
- [ ] Stop stops it; Run stored starts the script saved on the controller; Remove erases it (VESC Tool agrees).
- [ ] Upload is refused while a wheel turns.

## Packages

- [ ] The package archive loads (needs `npm run server` or the deployed server).
- [ ] Install a package with its own settings: it runs, and its settings appear under Packages. VESC Tool shows
      the same package installed.
- [ ] Change one of its settings, write it: *Written and verified*, and VESC Tool shows the new value.
- [ ] Remove it: the script and its settings are gone in VESC Tool too.
- [ ] A package with a VESC Tool screen (QML) shows the note that its screen only runs in VESC Tool.

## BMS (VESC BMS or a controller that reports one)

- [ ] Cell count and every cell voltage match the BMS's own tool within 5 mV.
- [ ] Balancing marks the same cells the BMS is balancing.
- [ ] Temperatures, current, state of charge and health match.
- [ ] Without a BMS on the bus, the page says so instead of showing zeros.

## IMU

- [ ] Tilt the controller nose up: pitch goes the same way as in VESC Tool's IMU page. Roll right: roll goes the
      same way. Turn it: yaw changes. If a sign is reversed compared with VESC Tool, note it.
- [ ] The 3D board follows the controller smoothly, without jumps at ±180° yaw.
- [ ] Calibrate on level ground: the values shown match what VESC Tool's calibration gives (within a degree and
      a small offset), and after writing the board reads level.
- [ ] A mounting yaw outside the allowed range is refused.

## CAN bus

- [ ] The device list matches VESC Tool's CAN scan.
- [ ] Start the monitor: frames from the other controllers appear and decode (STATUS 1–6 values look right).
- [ ] Send a ping (ID `11xx`, data the sender ID): a PONG comes back.
- [ ] Motor command and setting frames (duty, current, RPM, current limits, battery cut, power switch, bus
      speed) can't be sent.
- [ ] Stop the monitor: the controller's CAN mode is back to what it was (check the app setting in VESC Tool).
- [ ] Pull the cable while the monitor runs, then reconnect: Ohmic says it switched the mode back, and it did.
- [ ] Power-cycle the controller while the monitor runs: it comes back in its own CAN mode (the switch is never
      stored).

## App

- [ ] Install to the home screen (Android) or as an app (desktop): it opens on its own window.
- [ ] Go offline (flight mode) and open the app: everything but firmware downloads works,
      including the demo and the last package list.
- [ ] After a new deploy, the app offers to reload, and never while a write is running.
- [ ] Ride at 50 Hz on a mid-range Android phone: numbers glide, nothing stutters, and the phone doesn't get
      hot within 10 minutes.
- [ ] Light and dark themes, each accent: everything readable outdoors in daylight (light theme).
- [ ] Screen reader (TalkBack on Android, NVDA or Narrator on Windows): connect, read live values, change and
      write a setting.
- [ ] Keyboard only on a computer: every screen and dialog can be used, focus is always visible.

## Results

| Date | Tester | Controller (hardware) | Firmware | Connection | Browser and device | Result | Notes |
| ---- | ------ | --------------------- | -------- | ---------- | ------------------ | ------ | ----- |
|      |        |                       |          |            |                    |        |       |
