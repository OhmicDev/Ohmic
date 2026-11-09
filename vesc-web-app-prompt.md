# Build prompt: web app that replaces VESC Tool, with an AI tuning tab

> **How to use:** open an empty folder in Claude Code (or another AI coding tool) and paste everything below the line. It's written to be built in phases, so let it finish one phase, test it, then say "next phase".
> Replace `[APP NAME]` with your own name for the app.

---

## 1. Role and goal

You are a senior full-stack engineer who also knows VESC motor controllers well. Build **[APP NAME]**: a web app (installable PWA) that can fully replace VESC Tool for riders and builders of e-scooters, e-bikes, e-skateboards, onewheels and other light EVs that run VESC-based controllers.

It must:

1. Connect to the controller over **USB cable** (Web Serial) or **Bluetooth LE** (Web Bluetooth), and reach other controllers on the same **CAN bus** through the one it's connected to.
2. Cover **everything VESC Tool does**: live data, the full motor and app config, setup wizards, motor detection, firmware updates, terminal, backups, logs, LispBM, packages, BMS, IMU, CAN tools.
3. Do it **better**: modern UI that works on phone, tablet and desktop; plain-language help on every setting; review screen before every write; automatic backups; ride modes you can switch mid-ride; ride logs with GPS maps; calculators.
4. Include an **AI Tune tab**: an agent that reads the controller's specs, config, live data and ride logs, asks the rider what they want ("more power", "more range", "smoother", "climb hills"...), and proposes safe, specific config changes that the rider reviews and applies.

## 2. Hard rules

These are not optional. If a feature conflicts with one, the rule wins.

1. **Nothing is written to the controller without a review step.** Every write (manual edit, wizard, profile, AI) goes through one pipeline: validate → show a diff dialog ("Write 3 changes to the device?" with each parameter's old → new value) → save an automatic backup → write → read back and verify → show the result. Edits stay local until the user presses Write.
2. **Validate every value in code**: type, the parameter's min/max from its definition, and hardware limits. Out-of-range values are rejected, not clamped silently.
3. **No config writes or firmware updates while the motor is spinning** (|ERPM| above a small threshold). Show why the button is disabled.
4. **Motor test commands need a dead-man control** (hold-to-run, or "latch" that times out). Stop immediately on release, disconnect, tab hidden, lost keep-alive, or Escape. A big Stop button is always visible on motor-control screens. Send keep-alive (`COMM_ALIVE`) well inside the controller's app timeout.
5. **Unknown firmware = read-only.** If the app doesn't have parameter definitions for the connected firmware version, show live data and a clear warning, but never guess a config layout and write it.
6. **Stay compatible with VESC Tool**: import/export its XML config files, import its CSV logs, use the same protocol. A user must be able to go back to VESC Tool at any time.
7. **Name and license**: don't call the app "VESC Tool" or use its logo. "For VESC® controllers" is fine (VESC is a registered trademark of Benjamin Vedder). VESC Tool and the VESC firmware are GPL-3.0; if you port code or bundle their parameter files, keep the project GPL-3.0 compatible (simplest: make the repo GPL-3.0) and credit them.
8. **Don't copy the reference app's look.** The vibe is described below; the name, logo, fonts, icon set, card layouts and screen compositions must be our own.

## 3. Look and feel (the vibe, not a copy)

- **Instrument-panel dark theme**: near-black surfaces, a faint dot-grid/blueprint texture on large empty areas, thin hairline borders, rounded glassy cards.
- **Big bright numbers**: the hero value (speed) is huge, bright and has a soft glow. Every number uses tabular figures so it doesn't jitter while updating; values tween smoothly.
- **Small uppercase letter-spaced labels** above values, and a muted hint line under each value that gives it meaning: "limit 60 A", "73 % headroom", "4.12 V per cell", "limits at 85 °C", "2,300 motor rpm".
- **One accent colour the user picks** (default electric cyan; offer lime, amber, red, violet, white and a custom picker). Used sparingly: active states, live dot, chart lines, primary buttons.
- **Layout**: phone = bottom tab bar (Connect, Config, Dashboard, Live data, More). Tablet/desktop = slim icon rail on the left, a section tree for config, content on the right, and a live-data strip across the top of config pages. Works from 360 px wide to ultrawide, portrait and landscape. No horizontal scrolling.
- **Feel**: hardware-like and calm. Smooth transitions, satisfying press states on hold buttons, clear warning colours (amber = caution, red = danger) that never get used for decoration.
- Choose our own fonts (a clean grotesk for UI plus a font with good tabular numerals), our own icon set (e.g. Lucide or Phosphor) and our own logo.
- Also ship a light theme, metric/imperial units, and make text translatable (start with English).

## 4. Tech stack

- **React + TypeScript + Vite**, strict TypeScript.
- **Tailwind CSS** with design tokens as CSS variables (accent colour is one variable).
- **Zustand** for app state, **TanStack Router** for routes.
- **uPlot** for high-rate realtime charts (it handles thousands of points smoothly); a lighter chart lib is fine for static summaries.
- **Leaflet + OpenStreetMap** tiles for ride maps.
- **Dexie (IndexedDB)** for backups, ride logs, profiles, settings. Never use localStorage for anything important.
- **vite-plugin-pwa** so it installs to the home screen and works offline (except AI and firmware downloads).
- **Vitest** for unit tests, **Playwright** for end-to-end tests against a simulated device.
- **Small server** (Node or a serverless function on Vercel/Cloudflare) only for the AI proxy and optional firmware/package mirroring. Everything else runs in the browser.

**Browser support (show this honestly in the UI):**
- Chrome / Edge on Windows, macOS, Linux, ChromeOS: USB + Bluetooth.
- Chrome on Android: Bluetooth (USB support on Android is limited; detect and explain).
- iPhone/iPad Safari: neither Web Serial nor Web Bluetooth exists. Show a friendly screen explaining this, mention BLE-capable browsers like Bluefy, and keep live features working in demo mode. Structure the transport layer so a later Capacitor native wrapper can add iOS Bluetooth without touching the rest of the app.
- Must be served over HTTPS.

## 5. Architecture

### 5.1 Transport layer

One interface, several implementations:

```ts
interface Transport {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  write(bytes: Uint8Array): Promise<void>;
  onData(cb: (bytes: Uint8Array) => void): () => void;
  onDisconnect(cb: (reason: string) => void): () => void;
  readonly kind: 'serial' | 'ble' | 'mock';
}
```

- **SerialTransport** (Web Serial): 115200 baud, remembers granted ports, auto-reconnects when the same port comes back.
- **BleTransport** (Web Bluetooth): Nordic UART Service, the one VESC Express and VESC BLE modules use:
  - Service `6e400001-b5a3-f393-e0a9-e50e24dcca9e`
  - RX (we write) `6e400002-b5a3-f393-e0a9-e50e24dcca9e`
  - TX (we get notifications) `6e400003-b5a3-f393-e0a9-e50e24dcca9e`
  - Split writes into 20-byte chunks by default (allow larger if the device supports it), queue writes so they never overlap, and reassemble notifications into a byte stream. Remember devices and reconnect automatically.
- **MockTransport**: a simulated controller that answers real protocol packets with realistic, changing data (a virtual ride: speed, current, voltage sag, temperatures rising, a fault now and then). Used for development, Playwright tests and a "Try demo" button for people without hardware.
- Optional later: TCP to VESC Express/TCP hub through a small local WebSocket bridge (browsers can't open raw TCP).

### 5.2 VESC protocol

Treat the official source as the truth and port from it. Verify every command ID and byte layout against it; don't trust memory, including the hints below.

- `github.com/vedderb/bldc` (firmware): `datatypes.h` (the `COMM_PACKET_ID` enum and config structs), `comm/commands.c` (reply layouts), `confgenerator.c/.h` (config serialization and signatures), `packet.c` and `crc.c` (framing).
- `github.com/vedderb/vesc_tool`: `commands.cpp` (how each command is sent and parsed), `vescinterface.cpp`, `bleuart.cpp`, the parameter XML files (search the repo for `parameters_mcconf.xml` and `parameters_appconf.xml`; there's one set per firmware version), and wherever it gets its firmware files.
- `github.com/vedderb/vesc_pkg` (packages) and `github.com/vedderb/vesc_express` (BLE/WiFi bridge).

Framing (verify): start byte `0x02` + 1-byte length for short packets, `0x03` + 2-byte length for longer (and `0x04` + 3 bytes), then payload, CRC16 (CCITT/XMODEM, poly 0x1021, big-endian), end byte `0x03`. The decoder must handle packets split across many chunks, several packets in one chunk, and garbage between packets (resync on bad CRC).

Commands you'll need early (IDs from `datatypes.h`, verify): `COMM_FW_VERSION` (0), `COMM_GET_VALUES` (4), `COMM_SET_DUTY` (5), `COMM_SET_CURRENT` (6), `COMM_SET_CURRENT_BRAKE` (7), `COMM_SET_RPM` (8), `COMM_SET_POS` (9), `COMM_SET_HANDBRAKE` (10), `COMM_SET_MCCONF` (13), `COMM_GET_MCCONF` (14), `COMM_GET_MCCONF_DEFAULT` (15), `COMM_SET_APPCONF` (16), `COMM_GET_APPCONF` (17), `COMM_GET_APPCONF_DEFAULT` (18), `COMM_TERMINAL_CMD` (20), `COMM_PRINT` (21), `COMM_REBOOT` (29), `COMM_ALIVE` (30), `COMM_FORWARD_CAN` (34), `COMM_GET_VALUES_SETUP` (47), `COMM_SET_MCCONF_TEMP` (48), `COMM_SET_MCCONF_TEMP_SETUP` (49), `COMM_GET_VALUES_SELECTIVE` (50), `COMM_DETECT_APPLY_ALL_FOC` (58), `COMM_PING_CAN` (62), `COMM_GET_IMU_DATA` (65), plus the firmware-upload, LispBM, BMS, custom-config and package commands as later phases need them.

Build a typed `VescClient` on top: request/response matching with timeouts and retries, a command queue so polling never starves user commands, CAN forwarding as a parameter on every call (`target: 'local' | canId`), and an event stream for unsolicited packets (`COMM_PRINT`, LispBM output, detection progress).

### 5.3 Config system (the hardest part, get it right first)

- A build-time script turns VESC Tool's parameter XML files into JSON per firmware version: name (e.g. `l_current_max`), display name, group path (General › Current), type, unit, scale, min, max, default, enum options, description, and serialization order.
- Firmware version + config signature from the device picks the definition set. No match → read-only mode (rule 5).
- Serializer/deserializer for mcconf and appconf driven by those definitions. **Round-trip test**: real config dumps from each supported firmware must deserialize and re-serialize byte-for-byte identical. Collect dumps from real hardware and commit them as test fixtures.
- Support custom configs that devices/packages expose (fetched from the device as XML).
- Target VESC firmware 6.x first (6.02, 6.05, 6.06), then add older versions if there's demand.

### 5.4 Device model

- On connect: read firmware version (hardware name, UUID, firmware version, hardware type), ping CAN to list other devices, read config of each, and show them in a device switcher ("Local", "CAN 11", "CAN 20", plus "All" for combined dashboard values).
- Profiles, writes and firmware updates can target one device or all devices on the bus.

### 5.5 Storage

IndexedDB tables: devices (by UUID), backups, profiles/ride modes, ride logs (samples stored in compact chunks), app settings, AI conversations. Export/import everything as one file.

## 6. Features, screen by screen

### 6.1 Connect
- Big "Connect via USB" and "Connect via Bluetooth" buttons, "Try demo", list of remembered devices with last-seen time.
- Status chip in the header everywhere: transport, device name, voltage, battery %, live dot.
- Clear errors in plain words ("Bluetooth is off", "This browser can't use USB, try Chrome or Edge", "Another app is using this port").

### 6.2 Dashboard (rider view)
- Hero speed with unit, battery % (from voltage and cell count, or from the BMS when present) and estimated range (remaining Wh ÷ recent Wh per km).
- Grid of cards: battery voltage (+ volts per cell), battery current (+ limit), power (+ peak), motor current (+ limit), duty (+ headroom), ERPM (+ motor RPM), motor temp and controller temp (+ limit), each with its hint line.
- Trip row: distance, riding time, average speed, trip average.
- Ride-mode switcher (Eco / Normal / Sport / custom) that works mid-ride.
- Fullscreen and landscape layout; "All" mode combines multiple controllers.
- Speed from ERPM: `ERPM ÷ (motor poles ÷ 2) ÷ gear ratio × wheel circumference`.

### 6.3 Ride modes / profiles
- Each profile sets a chosen subset of settings; every setting has "Default" (use the shared value) or a custom value, with a plain-language explanation (e.g. field weakening: "More top speed than the battery voltage alone allows, by pushing current against the magnets at high duty").
- Typical settings: motor current, battery current, power/regen scale, max speed/ERPM, field weakening, MTPA, throttle curve.
- Switching applies temporarily (`COMM_SET_MCCONF_TEMP...`, not saved to flash) to every controller on the bus; "make permanent" goes through the normal write pipeline.
- Ship 3 starter profiles plus a few templates (Beginner, Commute, Range, Hill, Track).

### 6.4 Config editor (Motor and App)
- Full tree matching the firmware's groups: General (General, Sensors, Current, Voltage, RPM, Wattage, Temperature, BMS, Advanced), BLDC, DC, FOC (General, Sensorless, Hall sensors, Encoder, HFI, Advanced), PID controllers, Additional info (wheel diameter, gear ratio, motor poles, battery type/cells/capacity). App config: General, PPM, ADC, UART, Nunchuk/remote, NRF, PAS, IMU, and any app the firmware exposes.
- Search across all parameters by name, internal name or description. "Changed only" filter. Compare against defaults or against any backup.
- Each row: display name, internal name in small mono text, input with unit and −/+ steppers or slider or toggle or dropdown, help button (plain-language explanation + the original description), reset-to-default, changed marker.
- Undo/redo, Read, Write (rule 1), discard local changes.
- Helpers on the relevant pages:
  - **Battery cut-off helper**: chemistry (Li-ion / LiFePO₄), cells in series, "cautious" vs "max range" → start and end cut-off voltages, shown per cell.
  - **Current limit helper**: cells in parallel × cell continuous rating, BMS limit → safe battery current.
  - **Speed helper**: wheel size, gear ratio, poles, KV → top speed at full/nominal voltage.
- Live data strip at the top (battery current, motor current, power, duty, ERPM, temps) so you see the effect of changes.

### 6.5 Setup wizards (visual, step-by-step, with a progress stepper)
- **Motor setup**: motor size preset, battery, wheel/gear → run FOC detection (`COMM_DETECT_APPLY_ALL_FOC`, optionally on all CAN devices) with a live animation and live ERPM/amps/elapsed time, and the warning "Keep clear of the motor until it's done, wheel off the ground". Show detected R, L, flux linkage, KV estimate, hall table, and let the user accept or retry.
- **Input setup**: PPM / ADC / UART remote, live view of decoded input while the user moves the throttle and brake, auto-calibrate min/center/max, choose throttle curve.
- **Direction**: spin each motor briefly (dead-man), "is this forward?", invert per motor.
- **Battery**, **hall sensors**, **encoder** wizards.

### 6.6 Live data
- Signals grouped: Currents (motor, battery, Id, Iq), Duty & speed, Voltages, Thermals, Position, IMU. Tap a signal to add it to the plot.
- Each signal shows current value and min…max seen. Rate selector (5 / 10 / 20 Hz and higher over USB). Pause, zoom, time window, export CSV.
- Faults panel: fault code in plain English, when it happened, likely causes and fixes.
- Advanced: sampled data / experiment plots for debugging (phase currents, voltages).

### 6.7 Motor control (bench testing)
- Modes: Current, Duty, RPM, Position, Brake, Handbrake. Value input with quick presets (10 / 25 / 50 / 75 / 100 % of a safe test limit).
- Hold-to-run button and "Latch on" with auto-timeout; keyboard: Space = run, ↑/↓ = adjust, Esc = stop.
- "Also drive" CAN devices, "Stop all" button.
- Live response chart (motor current, battery current, duty) and readouts (ERPM, position, temps).

### 6.8 Ride logs
- Record at 5 / 10 / 20 Hz with optional phone GPS (Geolocation API) and IMU.
- Ride list: date, duration, distance, top speed, Wh used, delete.
- Ride detail: map with the route coloured by speed (or power, current, temp), synced charts (Speed, Current, Battery, Temp, Duty) and a scrubber that moves a marker on the map.
- Import VESC Tool CSV logs; export CSV and GPX.

### 6.9 Calculators
Range, top speed, pack energy (Wh), charge time, gear ratio, current-to-power, and "what if" (e.g. "what if I go 13S → 16S").

### 6.10 Firmware
- Shows current firmware and hardware, matched automatically.
- Sources: official firmware archive (the same source VESC Tool uses), custom file, bootloader.
- Update one device or every device on the CAN bus at once, with per-device progress.
- Safety: hardware match check, battery voltage check, "don't disconnect" warning, verify after. Flag "no hardware limits" builds as experts-only with an extra confirm.

### 6.11 Backups
Automatic backup before every write, labelled with time, device and what changed. Restore (through the write pipeline), compare two backups, export/import VESC Tool XML, share as a file.

### 6.12 Terminal
VESC terminal commands with history, autocomplete of common commands (`help`, `faults`, `hw_status`...), and printed output.

### 6.13 Advanced
- **LispBM**: code editor with syntax highlighting, upload / run / stop, console output, REPL, memory stats, examples.
- **Packages**: browse, install, update, remove VESC packages from the official package archive. Packages whose UI is written in QML can't render in a browser: show their config through the custom-config editor instead and say so.
- **BMS**: cell voltages, balancing state, temps, SoC, for VESC BMS.
- **IMU**: live 3D orientation, calibration.
- **CAN**: device list, IDs, status, CAN analyzer/monitor.
- **Motor sound player**: play tones and short tunes through the motor windings using the firmware's FOC tone playback (check what the connected firmware's LispBM extensions offer). Library of tunes and effects, user-added tunes, volume in amps, preview on the phone speaker first. Only plays when the motor is stopped, with a hard current cap.

### 6.14 Settings
Accent colour, light/dark, units, language, data export/import, AI settings (on/off, what data it may see), developer options (protocol log viewer).

## 7. AI Tune tab

### 7.1 What the rider sees
- A chat panel with goal chips: **More power**, **More range**, **Smoother throttle**, **Better hill climbing**, **Cooler motor**, **Fix cut-outs**, **Beginner-safe**, **Explain my fault**.
- A "Vehicle profile" card the AI fills in from the device and asks the rider to complete.
- AI proposals show as **change cards**: each parameter with old → new value, a one-line reason, and the expected tradeoff ("+15 % acceleration, about −5 % range, motor runs warmer"). Buttons: **Apply as test mode** (temporary, not saved), **Apply permanently** (normal write pipeline, rule 1), **Edit**, **Reject**.
- After a test ride the rider taps "How did that go?" and the AI reads the new log and refines.

### 7.2 What the AI knows
From the device (read automatically): hardware name and limits, firmware version, full motor and app config, detected motor values (R, L, flux linkage, poles, KV estimate), battery settings, wheel and gear setup, CAN devices, recent faults, and a summary of recent ride logs (peak battery/motor current, voltage sag, top temps, duty headroom, Wh per km).

From the rider (asked once, stored in the vehicle profile): vehicle type, battery config (series × parallel), cell model and continuous discharge rating, BMS current limit, pack capacity, motor model/rated power, wheel size, rider weight, terrain, riding style, region (for legal limits).

### 7.3 Agent tools (run in the browser, because they need the device)

| Tool | What it does |
|---|---|
| `get_device_snapshot` | Hardware, firmware, limits, key config values, vehicle profile, CAN devices |
| `search_params` | Find parameters by keyword; returns names, units, ranges, current values |
| `get_params` | Current values + definitions (min, max, default, description) for given names |
| `get_live_telemetry` | Summary of the last N seconds of live data |
| `get_ride_summary` | Stats and notable events from the latest or a chosen ride log |
| `get_fault_history` | Recent faults with time and conditions |
| `calculate` | Speed, range, battery current, power calculators |
| `propose_config_changes` | `{ summary, risk_level, changes: [{ param, target, new_value, reason, tradeoff }] }` → renders change cards. **Does not write.** |
| `update_vehicle_profile` | Saves rider-provided specs |

The AI has **no tool** that writes config directly or moves the motor. Applying always takes a tap from the rider and goes through the same write pipeline as manual edits.

### 7.4 Guardrails enforced in code (not only in the prompt)
- Reject any proposed value outside the parameter's min/max or the hardware limits.
- Battery current must not exceed what the rider's pack can deliver (cells in parallel × continuous rating, and the BMS limit). If the specs are unknown, cap at the current value and have the AI ask.
- Temperature limits can't be raised above the firmware defaults. Battery cut-offs can't go below safe per-cell values for the chemistry.
- A blocklist of parameters the AI may never touch (for example fault/protection disables, hardware-limit overrides). Keep it in one file.
- Max 10 changes per proposal. No proposals applied while the motor is spinning.
- Log every AI proposal and what the rider did with it.

### 7.5 Claude API setup
- **Server proxy holds the API key.** The browser never sees it. Rate-limit per user/IP. Use the official `@anthropic-ai/sdk` package on the server, not raw fetch and not an OpenAI-compatible shim.
- **The browser runs the agent loop** (the tools need the device): browser → `/api/ai` with the conversation → server calls Claude and streams the reply back → when the reply contains `tool_use` blocks, the browser runs them locally and sends all the `tool_result` blocks back in **one** user message → repeat until the model ends its turn. Append the model's full `content` array to the history each turn, not just its text.
- Model: `claude-opus-5-5` (make it an environment variable).
- `thinking: { type: "adaptive" }` and set `output_config: { effort: "high" }` explicitly (this model defaults to `medium`). Don't send `budget_tokens`, `temperature`, or an assistant prefill; this model rejects them.
- Stream with `client.messages.stream(...)` and show text as it arrives; `max_tokens` around 16000.
- Tool use: `tool_choice` `auto` only (forced tool choice returns an error on this model), `strict: true` on every tool with `additionalProperties: false`, and validate every tool input against its schema before running it.
- Check `stop_reason` before running tools: handle `max_tokens`, and `refusal` (show a polite message). Turn on server-side fallback with beta header `server-side-fallback-2026-07-01` and `fallbacks: "default"`.
- Prompt caching: keep the system prompt, tool definitions and the parameter reference identical between requests and mark them with `cache_control`; put changing data (snapshots, telemetry) only in messages.
- Tell the rider what data is sent to the AI, and let them turn the feature off.

### 7.6 Draft system prompt for the tuning agent

```
You are the tuning assistant inside [APP NAME], a configurator for VESC-based motor
controllers on e-scooters, e-bikes, e-skateboards and similar light EVs. You help the
rider get the behavior they ask for — more power, more range, smoother feel, a cooler
motor — by reading their controller's setup, live data and ride logs, and proposing
specific parameter changes.

How you work:
- Start from facts. Call get_device_snapshot before advising. If you need a spec the
  device can't tell you (cells in parallel, cell model or rating, BMS limit, motor
  model, wheel size), ask the rider. If they don't know, say what you'll assume and why.
- You can only change settings through propose_config_changes. You cannot write to the
  controller; the rider reviews and applies every change. Never say a change was applied
  unless a tool result says so.
- Keep proposals small and focused. For each change, say in plain words what it does and
  what it costs (range, heat, wear, smoothness).
- Stay inside every parameter's range and the hardware limits in the snapshot. Keep
  battery current at or below what the pack and BMS can deliver continuously. Don't raise
  temperature limits above the defaults or set battery cut-offs below safe per-cell values.
  If the rider asks for more than that, explain which limit it would break and the risks
  (battery fire, BMS cut-out mid-ride, motor or controller damage), then offer the
  strongest option that stays safe.
- Prefer test-first: suggest applying as a temporary test mode, a short test ride, and a
  look at the log before making it permanent.
- After a test ride, read the ride summary: peak battery and motor current, voltage sag,
  temperatures, duty headroom, faults. Adjust from what the data shows.
- If the rider's region is known and a change goes past local legal speed or power
  limits, mention it once; the choice is theirs.
- Be brief and concrete, use the rider's units, and skip jargon unless they use it.
```

## 8. Build order

Finish and test each phase before starting the next. At the end of each phase, list what works, what's mocked, and what needs real hardware to check.

1. **Foundation**: project setup, design system and tokens, app shell (bottom tabs / side rail), transport interface, MockTransport, packet codec with tests, `COMM_FW_VERSION`, `COMM_GET_VALUES`, Connect screen, Dashboard on mock data.
2. **Real connections**: SerialTransport, BleTransport, auto-reconnect, CAN ping and device switcher.
3. **Config**: XML → JSON pipeline, serializer with round-trip tests, config editor, write pipeline with diff dialog, backups, XML import/export.
4. **Live data, terminal, faults.**
5. **Wizards and profiles**: motor detection, input setup, direction, battery helper, ride modes with temporary writes.
6. **Motor control panel and firmware updater.**
7. **Ride logs, GPS map, CSV import/export, calculators.**
8. **AI Tune tab**: server proxy, tools, guardrails, change cards, test-mode flow.
9. **Advanced**: LispBM, packages, BMS, IMU, CAN tools, motor sound player.
10. **Polish**: PWA/offline, accessibility (keyboard, screen reader labels, contrast), performance (60 fps live data on a mid-range phone), light theme, translations, onboarding.

## 9. Definition of done

- Codec tests: CRC, short/long packets, packets split across BLE chunks, several packets per chunk, garbage and resync.
- Config round-trip byte-identical for every supported firmware's fixtures.
- Playwright tests on MockTransport: connect, dashboard updates, edit → review → write → verify, backup restore, profile switch, AI proposal → apply as test mode.
- Write pipeline proven to block: out-of-range values, writes while spinning, unknown firmware.
- Manual hardware checklist written in the repo and run: USB, BLE via VESC Express, BLE via a BLE module, two controllers on CAN, motor detection, config write + readback, profile switching while riding, firmware update on a spare board, log recording with GPS on a phone.
- README: supported browsers, how to run, how to deploy, how to set the AI API key, credits and license.
