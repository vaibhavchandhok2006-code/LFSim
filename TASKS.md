# Tasks

Status (16 Nov 2026): LFSim Lab Phase 0 done. Earlier (15 Nov 2026): v1 implemented, and all 21 defects of the Independent Test Report addressed — 20 fixed and
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
- [ ] Phase 1: competition profile, track generator, photo import, track sets, 10-minute session benchmark, what-if report
      (note: cache the track import and junction graph per track — they take most of a short run's time)
- [ ] Phase 2–8: see the spec

## Later versions (not v1)
- v2: track editor, auto-tuning, share links; better junction reading at dense features. v3: 3D view.
