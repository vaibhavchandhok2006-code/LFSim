# LFSim v1 — product requirements

Extracted from `docs/LFSim_Spec_v1.pdf`. Numbers in brackets refer to spec sections.

## Goal
A free, browser-based 2D simulator where anyone can build, break and tune a maze-style competition line follower in
software so the real robot needs only small hardware tweaks. First target: Robo-Run at Shaastra; not tied to one event.

## Users
Anyone building a line follower. Public, open-source, no login. Laptop-first; phones view saved results only.

## v1 success criteria
1. Enter robot dimensions and motor specs, load a track image, pick an algorithm, watch it run — within 5 minutes.
2. Run your own firmware logic (skill-translated) and see where it fails.
3. PID gains and speeds tuned in LFSim transfer to hardware with small adjustments (checked later with real logs).
4. Settings are saved, exported and imported.

## Functional requirements
| Area | Requirement |
| --- | --- |
| Robot | All profile inputs (geometry, array, motors, driver, battery, mass, grip, encoders with 3 cases); drawing from dimensions with one LED per sensor |
| Track | PNG/JPG import; image edges = track edges, optional box; threshold, scale to preset, normalise line width; junction graph; Robo-Run + Custom presets; start/finish auto-detect with override; drag/rotate placement |
| Settings brain | Analog weighted PID; binary patterns for junctions, dead ends, finish; all listed parameters |
| Code brain | Skill-translated JS; simulated hardware API; side-by-side view; serial console; EEPROM/NVS kept between memory runs; loop timing from the code itself |
| Algorithms | Left-hand, right-hand, straight-first (L or R fallback), custom priority, LSRB (branch numbers, memory run), Trémaux/mapping + shortest path (memory run), own code |
| Physics | 1 kHz; DC motor model; driver drop and current limit (TB6612FNG, L298N); battery sag; mass, inertia, grip, slip; caster drag |
| Sensors | Spot coverage, blend, noise; height sets spot and contrast; sensor-to-sensor spread; LEDs |
| Disturbances | Uneven lighting; mat folds/bumps — each with switch and strength |
| Run rules | Start at front edge leaving start; timer stops at front edge entering finish; code-recognised finish reported separately; manual Stop only; off-line judged as a human would (4 cm default); penalty (N/20)×time |
| UI | Tabs Robot, Track, Brain, Simulate, Compare; play/pause/stop/step/reset; 0.25–10×; scrub; live graphs; decision log; console; score panel; light and dark themes |
| Outputs | HTML summary report (printable); CSV per control tick; WebM; GIF; PNG path image |
| Saving | Autosave (IndexedDB); `.robot.json`, `.track.json` (image embedded), `.lfsim.json` project, `.csv` logs |

## Out of scope for v1
4-wheel skid steer, CAD image, real C/C++ to WebAssembly, real-log sensor mode, in-app AI, track editor, share links,
auto-tuning, 3D, MicroPython, full 10-minute session, restart/adjustment penalties.

## Validation targets (spec, Validation and testing)
Robo-Run sample map: left-hand ≈ 19.8 m / 49 decisions; right-hand ≈ 21.5 m; straight-first loops in the "0" of 2026;
LSRB run 2 ≈ 18.0 m — reproduce within a few percent.
