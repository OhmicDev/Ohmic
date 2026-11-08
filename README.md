# Ohmic

A web app for setting up, tuning and riding VESC-based motor controllers (scooters, e-bikes, boards), in the
browser over USB (Web Serial) or Bluetooth (Web Bluetooth). It installs as an app and works offline.

Ohmic is free software under the GPL-3.0-or-later. It builds on the open-source VESC firmware and VESC Tool by
Benjamin Vedder and contributors, and is not affiliated with or endorsed by the VESC project. VESC is a
registered trademark of Benjamin Vedder.

No hardware nearby? Pick **Demo scooter** on the Connect screen: a simulated scooter with two controllers
(one on the cable, one on CAN) that rides a loop. Everything in the app can be tried on it.

## What it does

The app has five tabs:

- **Ride**: speed, battery, power, temperatures and trip, live, with ride mode, regen and ABS switches. Until a
  vehicle is set up, it starts with a link into Setup.
- **Setup**: the four steps for a new build or new parts, in order, each leading to the next: motor detection,
  throttle and brake, motor direction, battery. Then how it rides (ride modes, regen, ABS, AI Tune), and
  **Config**: every motor and app setting VESC Tool has, with search, undo, XML import and export, and backups.
- **Live**: every value the controllers report, charts, faults with what to do, and the VESC terminal.
- **AI Tune**: a tuning assistant that proposes changes you review (see below).
- **More**: ride logs with GPS, motor sounds, calculators, motor control on the bench, firmware updates,
  LispBM scripts, packages from the VESC package archive, BMS cells and balancing, IMU orientation and
  calibration, the CAN bus devices and traffic monitor, and the app's **Settings** (look, units, connection,
  vehicle, language, AI Tune privacy, your data, developer options).

Every write goes the same way: the value is checked against VESC's limits (a bad value is refused, never
quietly changed), you see exactly what changes, a backup is made, the change is written, read back and
compared. Nothing is written and no firmware installed while a wheel turns. Motor commands run only while you
hold the button. A firmware version Ohmic doesn't know opens read-only.

## Browsers

| | USB | Bluetooth | Everything else |
| --- | --- | --- | --- |
| Chrome, Edge (Windows, macOS, Linux, ChromeOS) | Yes | Yes | Yes |
| Chrome on Android | No (use Bluetooth) | Yes | Yes |
| Firefox | No | No | Yes, with the demo |
| Safari, any iPhone or iPad browser | No | No (Bluefy has Web Bluetooth) | Yes, with the demo |

USB and Bluetooth need the page on `localhost` or HTTPS.

## Run it

Needs Node 24 or later.

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # production build in dist/
npm run preview      # serve dist/ on http://localhost:4173
```

## Tests

```bash
npm test             # unit and flow tests (Vitest) against the simulated scooter
npm run test:e2e     # builds, then runs the browser tests (Playwright) on the build
npm run lint         # oxlint
```

The browser tests drive an installed Microsoft Edge, so nothing extra is downloaded. To use Chrome instead,
set `PW_CHANNEL=chrome`; for Playwright's own Chromium, run `npx playwright install chromium` and set
`PW_CHANNEL=chromium`. They cover the first-run intro, the tabs and where each page belongs, keyboard use,
themes, names on every control, the guided setup from the dashboard, the settings write flow (including
refusals while riding and for bad values), LispBM, packages, CAN, BMS, IMU, offline use, and a performance
check: the Ride screen at 50 Hz with the CPU slowed four times.

Tests prove the app's logic against a simulator, not against a real controller. Before a release, go
through the [hardware checklist](docs/hardware-checklist.md) on real hardware.

## Deploy

```bash
npm run build
npm run server       # serves dist/ and the /api routes on PORT (8787), Node 24+
```

Put it behind HTTPS (a reverse proxy such as Caddy or nginx). Set `TRUST_PROXY=1` there so rate limits see
the visitor's address. The app itself is static; the server is only needed for AI Tune and the package
archive, so `dist/` can also go on any static host if you don't need those.

### GitHub Pages

The workflow in `.github/workflows/pages.yml` publishes the app to GitHub Pages on every push to `main`,
after the lint and unit tests pass.

1. Create a **public** repository on GitHub (free accounts only publish Pages from public ones) and push
   this project to it.
2. In the repository, open **Settings › Pages** and set **Source** to **GitHub Actions**.
3. Push to `main`, or run the workflow from the **Actions** tab. The site appears at
   `https://<username>.github.io/<repository>/`.

The workflow builds for that sub-folder by setting `BASE_PATH`. To try the same build locally:
`BASE_PATH=ohmic npm run build`.

GitHub Pages only serves files, so two things need the server and don't work there: AI Tune (it runs its
scripted demo instead) and the online package list (packages can still be opened from a `.vescpkg` file).
Never put an API key in the site itself; anyone could read it.

## AI Tune

AI Tune is a tuning assistant (Anthropic's Claude) that reads your setup and proposes changes you review. The
conversation and tools run in the browser; the server holds the API key and relays each step to Claude.

```bash
cp .env.example .env    # then put your key in ANTHROPIC_API_KEY
npm run server          # http://localhost:8787 (also serves dist/)
```

Get a key at https://console.anthropic.com. During development, `npm run dev` forwards `/api` to that
server. Without a server, AI Tune runs a **scripted demo** (not AI) so the change cards and test mode can
still be tried.

Server settings (environment or `.env`):

| Variable | Default | |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | | Required for AI Tune |
| `AI_MODEL` | `claude-opus-5-5` | Model to use |
| `AI_ACCESS_CODE` | | If set, riders must enter it in More › Settings › AI Tune |
| `AI_RATE_PER_MIN` / `AI_RATE_PER_HOUR` | 30 / 300 | Model calls per IP (one message can take several) |
| `TRUST_PROXY` | | `1` to take the client IP from `X-Forwarded-For` behind a reverse proxy |
| `PORT` | 8787 | |

Set `AI_ACCESS_CODE` if the site is public, since every visitor otherwise uses your key.

### Safety

The assistant can't write anything itself. Its proposals go through checks in code before the rider sees
them: VESC's ranges, no new config problems (such as motor current above the absolute limit), battery current
within what the pack and BMS deliver (no raise while that's unknown), temperature limits not above defaults,
cut-offs not below safe per-cell voltages, a list of off-limits settings (motor detection values, protection,
wiring), and at most 10 changes. Live limits can be tried as a test mode (memory only; a power cycle undoes
it); anything else is written through the normal review, backup, write and read-back. Nothing is applied
while a wheel turns. Every proposal and what the rider did with it is logged.

The rider can turn AI Tune off, and choose whether live data, ride summaries and fault history are shared
(More › Settings › AI Tune).

## Package archive

VESC's package archive is served over plain HTTP, which an HTTPS page can't load, so the server fetches it
from VESC's server, checks it and caches it for an hour at `/api/pkg/archive`. The app keeps the
last copy it got, so the package list also works offline. `.vescpkg` files can always be installed from disk.

## Offline and installing

The app is a PWA: after the first visit everything works offline except AI Tune and firmware downloads (a
firmware file you already have still installs). Install it from the browser's menu (*Install app* or *Add to
Home screen*). When a new version is deployed, the app offers to reload, and waits while a write is running.

## Your data

Everything stays in the browser (IndexedDB and local storage): settings backups, ride logs, ride modes, fault
history, motor sounds, AI history and app settings. More › Settings › Your data exports all of it as one file
and imports it on another device or browser. The AI access code is never exported. More › Settings › Developer
keeps a protocol log of every packet, for bug reports.

## Languages

The interface text for the app shell, settings, onboarding and notices is in `src/i18n/en.ts`; most page text
is still inline English. To add a language, copy `en.ts` to e.g. `de.ts`, translate the values (missing keys
fall back to English), and add it to `CATALOGS` and `LANGUAGES` in `src/i18n/index.ts`.

## Credits

- [VESC firmware](https://github.com/vedderb/bldc) and [VESC Tool](https://github.com/vedderb/vesc_tool) by
  Benjamin Vedder and contributors (GPL-3.0): the protocol, and the parameter definitions in
  `vendor/vesc_tool`, copied unchanged (see its README).
- [VESC firmware archive](https://github.com/vedderb/vesc_fw_archive) and the
  [VESC package archive](https://github.com/vedderb/vesc_pkg), downloaded at run time.
- React, TanStack Router, Zustand, Dexie, uPlot, Leaflet with OpenStreetMap tiles (© OpenStreetMap
  contributors), Lucide icons, Archivo and JetBrains Mono fonts, Tailwind CSS, Vite, Workbox.
- AI Tune uses Anthropic's Claude through the official SDK.

## License

GPL-3.0-or-later. See [LICENSE](LICENSE).
