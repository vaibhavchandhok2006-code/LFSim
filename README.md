# LFSim — competition line follower simulator

LFSim is a free 2D simulator that runs in your browser. Build, break and tune a maze-style
line follower in software, so the real robot only needs small hardware tweaks.

It is made for competitions with loops, curves, squares, dead ends and a finish to reach
(the first target is Robo-Run at Shaastra), but nothing is tied to one event.

**Status: Phase 1 of 5.** See the roadmap below.

## What works now (Phase 1)

- **Robot** — every dimension, the straight sensor array, gear motors from their shop-page specs,
  TB6612FNG or L298N driver, battery, mass, tyre grip and encoders. The robot is drawn to scale.
- **Track** — load a clean top-down image. It is scaled to the Robo-Run mat (2.5 × 2.5 m) or a custom
  size, line width is set to 3.8 cm (or your value), and the start and finish squares are found.
- **Physics** — 1 kHz simulation of DC motors (back-EMF, stall torque, friction), the motor driver,
  battery sag, the chassis's mass and inertia, and tyre grip, so fast turns can skid.
- **Sensors** — each IR sensor averages the floor under its spot; spot size and contrast follow sensor
  height; noise and sensor-to-sensor differences are on by default. An LED above each sensor shows on/off.
- **Settings mode** — a built-in robot with PID on the analog line position (with a derivative filter),
  speed and acceleration limits, lost-line search and finish detection.
- **Rulebook timing** — the timer starts when the front edge leaves the start square and stops when it
  enters the finish. Off-line events are counted the way a judge would (all sensors on white and the
  robot moved away from the line). Re-entering the start square aborts the run.
- Play, pause, stop, single-step, 0.25× to 10× speed, path trail coloured by speed, live sensor bars,
  readouts and a 5-second graph.
- Everything autosaves in the browser. Projects (`.lfsim.json`) and robots (`.robot.json`) export and import.

## Roadmap

| Phase | Adds |
| --- | --- |
| 2. Mazes | Junction detection, left-hand, right-hand, straight-first, custom priority, LSRB (branch numbers), mapping + shortest path, memory runs, decision log |
| 3. Analysis | Full live graphs, Compare tab, CSV / video / GIF / path image export, summary report |
| 4. Code mode | Run your own firmware (Arduino C++ / ESP-IDF C) through a simulated hardware API, plus the Claude skill |
| 5. Realism and checks | Uneven lighting and mat bumps, validation against reference results |

## Run it locally

```bash
npm install
npm run dev      # open the printed localhost link
npm test         # physics and track-import tests
npm run build    # static site in dist/
```

The site deploys to GitHub Pages from `main` through `.github/workflows/deploy.yml`.

## Licence

MIT
