# Tasks

Status (18 Nov 2026): LFSim Lab Phase 1 built (sample approval pending). Phase 0 done 16 Nov. Earlier (15 Nov 2026): v1 implemented, and all 21 defects of the Independent Test Report addressed — 20 fixed and
verified, D2 fixed on clean mazes with a documented limit on the dense Robo-Run sample. 77 automated tests pass;
browser smoke test passes. Next: reality check against the real robot.

## Done (verified)
- [x] Phase 1–5 (v1): robot profile, track import, physics, sensors, Settings mode + seven algorithms, worker
      playback, graphs, Compare, exports, Code mode + sandbox, disturbances, dark theme
- [x] Test report D3 sandbox escape; D1 no scan + shortcut judge; D4 / D20 honest finish and no auto-stop;
      D17 brake; D5 / D16 / D19 physics; D6 odometry estimate; D7 / D8 / D9 imports; D10–D14 firmware API;
      D15 CSV; D18 PWM frequency labelled; D21 2 kHz loop and legend colour
- [x] D2: grid maze — every algorithm finishes like the graph; stable over base 0.3–0.5 × 100–2000 Hz

## Known gaps
- [ ] Robo-Run sample in Settings mode: the algorithms do not finish. 94 % of junctions are read right on straight
      approaches, but a few dense features are misread: the 5-way junction near (0.44, 1.03) m (branches 45° apart
      merge in a 9.6 cm-wide sensor swath), the ring with spokes, and junctions reached along a tight curve (bowl
      exit near (0.79, 0.66) m). One wrong turn sends a wall follower round a loop.
- [ ] Odometry drift (wheel skid in spins) is tens of cm after a minute of turns
- [ ] Base speed 0.7 with the default PID gains loses the line (tuning, counted as off-line)
- [ ] Firmware with an infinite loop and no `delay`/`await` is stopped by the 4 s watchdog rather than run
- [ ] Reality check against a real robot's logs

## LFSim Lab (spec: LFSim Lab — Spec v1)
- [x] Phase 0: command line (`npm run lab`), headless runs identical to the website, setup doctor, Windows setup guide,
      CI on Linux (pull requests and branches)
- [x] Phase 1: competition profile (rules as data), track generator + rule checker, track sets (300 tuning / 200
      held-out), full 10-minute session simulation, parallel benchmark with report, live progress page, replay projects,
      review sheet, photo import from four corners (website + command line)
- [x] Robo-Run 2027 rulebook: 4 m mat, new penalties, dry run, switch changes as adjustments, checkpoints; finish at the
      far end on most generated mazes (generator v2), new track set `rr-2027`
- [x] Track sets in stages: stage 1 = variations of the Shaastra maze (default); stage 2 = + route-style mazes;
      stage 3 = + novel-style group (new shapes, tighter gaps). Report: finish rate by style
- [ ] Later: move to stage 2, then stage 3, as the robot's finish rate on stage 1 rises
- [ ] Phase 1 sign-off: you review ~20 sample tracks (`tracks sheet`) and confirm they look like Shaastra mazes
- [ ] Later: final-round yellow blocks (pushing physics, colour sensor), loop-case checkpoint placement
- [ ] Ask the organisers: over what span restarts and adjustments are counted; checkpoint places and values; whether a switch change before the first actual run is an adjustment
- [x] Phase 2: your ESP-IDF C firmware compiled with GCC against a hardware shim and run unchanged in the simulator
      (`run --firmware`); button presses with interrupts and a calibration sweep; C = JS proved on 20 tracks;
      both examples build for ESP32 in CI (esp32.yml)
- [x] Sessions and benchmarks with native firmware (design files), flash (NVS) kept between runs, switches as GPIO levels
- [ ] Later in Phase 2 scope: Arduino .ino (C++ shim); PCNT,
      extra FreeRTOS tasks; a sandbox for AI-written native code (before Phase 5)
- [ ] Phase 3 (calibration): waiting for a working robot
- [ ] Phase 5 (algorithm agent) — in progress
  - [x] Generator v6: squares joined to the maze (all earlier rr-2027 results were invalid)
  - [x] Maze firmware in C (lab/firmware/examples/maze): junctions, odometry map in flash, route planning, start-square guard, strategies
  - [x] Fast native I/O (32× real time); PCNT in the shim; `lab search` (successive halving over config.h values)
  - [ ] Junction identity: no wrong matches or duplicates over a 10-minute session (now 4–11 wrong matches per run)
  - [ ] ≥ 95 % finish over full sessions on held-out tracks, then faster
  - [ ] Algorithm agent loop (Claude Code on the laptop) with a sandbox for AI-written code
- [ ] Phase 4 (optimiser) after Phase 5; 6–8: see the spec
- Findings for later phases: the current robot with LSRB / Trémaux often drives back into the start square (aborts
  the run) and explores slowly on dense mazes — work for the algorithm agent (Phase 5)

## Later versions (not v1)
- v2: track editor, auto-tuning, share links; better junction reading at dense features. v3: 3D view.
