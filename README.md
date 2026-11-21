# LFSim — competition line follower simulator

LFSim is a free 2D simulator that runs in your browser. Build, break and tune a maze-style
line follower in software, so the real robot only needs small hardware tweaks.

It is made for competitions with loops, curves, squares, dead ends and a finish to reach
(the first target is Robo-Run at Shaastra), but nothing is tied to one event.

**Status: v1 complete (Phases 1–5).**

## What it does

- **Robot** — every dimension, the straight sensor array, gear motors from their shop-page specs,
  TB6612FNG or L298N driver, battery, mass, tyre grip and optional encoders, drawn to scale.
- **Track** — load a clean top-down image; it is scaled to the Robo-Run mat (2.5 × 2.5 m) or a custom size,
  the line set to 3.8 cm, and the start and finish squares found. The ideal shortest path can be overlaid.
- **Physics** — 1 kHz simulation of DC motors, driver, battery sag, mass, inertia and tyre grip (fast turns skid).
- **Sensors** — spot averaging, height-dependent contrast, noise and sensor mismatch; optional uneven lighting
  and mat folds/bumps.
- **Settings mode** — PID line following; junctions read from what the sensors saw while rolling over them (no look-around spin); seven maze algorithms: left-hand, right-hand,
  straight-first, custom priority, LSRB (branch numbers counted from the left) and Trémaux mapping, with
  memory runs for LSRB and Trémaux.
- **Code mode** — run your own Arduino / ESP-IDF firmware, translated to LFSim firmware JS
  (see [docs/FIRMWARE_API.md](docs/FIRMWARE_API.md)), against a simulated ESP32 (or Arduino Uno/Nano) + driver, in a locked-down sandbox, with a serial console
  and a side-by-side view of the original code. Also an I²C QMC5883L compass and push buttons driven by an operator
  script; example: `examples/magnetometer-maze/`.
- **Rulebook timing** — timer from leaving start to entering finish, judge-style off-line count (including crossing
  white to another line), start-square re-entry logged. No auto-stop: you stop the run.
- **Analysis** — timeline scrub and step, live graphs (error/PID, wheel speeds/PWM, battery, raw sensors),
  decision log with map markers, Compare tab with path overlays.
- **Exports** — HTML report, CSV, PNG path image, WebM video, GIF clip, robot / track / project files
  (imports are validated).

## Roadmap

| Version | Adds |
| --- | --- |
| v2 | Track editor, auto-tuning, share links |
| v3 | 3D view |

## Run it locally

```bash
npm install
npm run dev      # open the printed localhost link
npm test         # physics, sensors, track, maze, firmware tests
npm run build    # static site in dist/
```

The site deploys to GitHub Pages from `main` through `.github/workflows/deploy.yml`.

## Licence

MIT

## LFSim Lab

A command-line companion that tests robot designs on many tracks without a browser, on the way to an optimiser and AI
agents that design a Robo-Run robot. Status: Phase 0 done. See [lab/README.md](lab/README.md) and the
[LFSim Lab spec](docs/lab/SPEC.md).

## Documentation

All documents are listed in [docs/README.md](docs/README.md), including a [learning log](docs/learn/README.md) that
explains how each part is built.
