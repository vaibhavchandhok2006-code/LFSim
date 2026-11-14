# Architecture

```
 Track image ──► track/importTrack ──► Track (darkness map 2 mm/px, start/finish)
                         └──────────► track/graph ──► JunctionGraph (overlay, ideal path, validation only)

 RobotProfile + Brain settings / firmware ─► worker/simWorker (Web Worker)
        Simulation (sim/simulation): 1 kHz tick × 4 physics sub-steps
          ├─ sim/physics   motors, driver, battery, tyres, caster
          ├─ sim/sensors   spot coverage, noise, disturbances
          └─ Brain         brain/settings (Settings mode) or brain/firmware (Code mode, runs translated JS)
        Recorder: frames every 10 ms, control-tick log, events  ──► postMessage batches

 UI (React, main thread): plays frames back, scrubs, graphs (uPlot), Compare, exports
```

## Brain boundary
Brains get only `BrainIO` (Settings mode) or the firmware hardware API (Code mode): sensor readings, motor PWM,
encoder ticks, odometry estimate, time, serial log, persistent memory (EEPROM/NVS). They never see the track, graph or
finish location.

## Code mode
Translated firmware is async JavaScript (see `docs/FIRMWARE_API.md`). It runs inside the simulation worker through a
`new Function` whose parameters shadow every global except the hardware API (no `self`, `fetch`, `importScripts`,
`indexedDB`, `postMessage`). Hardware calls advance simulated time (`delay`, ADC read time, a fixed per-call cost), so
loop timing comes from the code. The UI watchdog terminates the worker if code runs 3 s of wall time without a hardware
call.

## Files
| File | Schema | Contents |
| --- | --- | --- |
| `.robot.json` | `version: 1` | RobotProfile (+ optional firmware and wiring) |
| `.track.json` | `lfsim: 'track', version: 1` | Track setup + embedded image (data URL) |
| `.lfsim.json` | `lfsim: 'project', version: 1` | All settings, track image, saved run summaries |
| `.csv` | header row | One row per control tick (columns in VALIDATION.md) |

## Storage
Settings in localStorage, track image in IndexedDB; everything else via user-controlled files.

## Deployment
Static site built by Vite; GitHub Actions → GitHub Pages (`base: './'`).
