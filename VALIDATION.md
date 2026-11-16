# Validation

Results recorded only after running. Command: `npm test`.

## Physics (src/sim/physics.test.ts) — passed 2026-11-15
| Check | Expected | Result |
| --- | --- | --- |
| Straight-line top speed vs motor maths | within 85–101% | pass (1.493 m/s vs 1.495 nominal) |
| Equal motors drive straight | heading < 0.001 rad after 2 s | pass |
| Weaker right motor curves right | heading > 0.01 rad | pass |
| Spin rate vs wheel speeds (rolling, CoM off the axle) | within 5% | pass |
| 0 → 90% speed | < 0.5 s | pass |
| 10:1 and 1:1 gear ratios (D5) | finite, no slip chatter, speed sensible | pass |
| Dead band from static friction (D16) | duty 0.04 does not move; less stiction moves further | pass |
| CoM 20 mm ahead drives straight (D19) | heading < 0.001 rad | pass |
| Odometry (src/sim/odometry.test.ts, D6) | encoders: within one count; none: estimate, not exact | pass |

## Track import (src/track/importTrack.test.ts) — passed 2026-11-14
| Check | Expected | Result |
| --- | --- | --- |
| EDT exact distances | exact | pass |
| Robo-Run sample scaled | 1250 × 1250 px at 2 mm | pass |
| Line width measured | 2–4.5 cm | pass (2.6 cm) |
| Start top-left, finish bottom-right | detected | pass |
| Line normalised to 3.8 cm | 3.4–4.2 cm | pass |
| Clean image keeps threshold 128 (D7) | 128 | pass |
| Dim photo gets an Otsu threshold, line found (D7) | 30–100, 2–10 % dark | pass |
| Stretch warning, removed by a crop (D8) | warn / no warn | pass |
| Robot files with stall current 0, mass 0, PWM bits 0, 2.5 channels, negative wheel, threshold above the ADC, unknown driver (D9, src/ui/persist.test.ts) | refused with a message | pass |

## Maze graph (src/track/graph.test.ts) — passed 2026-11-14
Spec targets were measured on a 1872-px maze span; LFSim maps the whole 2048-px image to 2.5 m, so targets scale by 1872/2048.

| Check | Target (scaled) | Result |
| --- | --- | --- |
| Dead ends found | 14 | pass (14) |
| Left-hand length / decisions | ≈18.10 m / 49 | pass (17.83 m / 49) |
| Right-hand length | ≈19.65 m | pass (19.46 m) |
| Straight-first | loops, never finishes | pass (loops after 2.01 m) |
| LSRB reduced path | ≈16.45 m | pass (16.21 m) |
| Shortest path shorter than all rules | yes | pass (14.83 m) |

## Physical maze runs (src/brain/maze.test.ts, default robot, Settings mode) — passed 2026-11-15
Clean generated grid maze (6 × 6 junctions, 3.8 cm lines, `loadGridMaze`):

| Check | Target | Result |
| --- | --- | --- |
| Left-hand: finishes, code sees finish, 0 off-line, junction decisions = graph | 16 decisions, 18.82 m ±6 % | pass (16, 19.33 m, 71.6 s) |
| Right-hand: same checks | 4 decisions, 6.69 m ±6 % | pass (4, 6.98 m, 24.6 s) |
| LSRB run 2 replays and is faster | faster | pass (20.0 s vs 71.6 s) |
| Trémaux run 1 and 2 finish, run 2 no longer | yes | pass |
| Straight-first finishes | yes | pass |
| Left-hand stable at base 0.3 / 0.5 × 100 / 500 / 1000 / 2000 Hz | finish, decisions ±1, 0 crossings | pass (all 8) |

Robo-Run sample (dense features):

| Check | Target | Result |
| --- | --- | --- |
| Junction reading on straight approaches (68) | ≥ 88 % right, ≤ 3 % wrong turns | pass (94 %, 1 wrong turn) |
| Left / right / Trémaux 90 s: crossings of white to another line | 0 | pass (0) |
| A stop away from the finish is reported as such, not as finished | yes | pass |
| Straight-first does not finish | yes | pass |
| Brain IO exposes no track, graph, start or finish | yes | pass |
| Left / right / Trémaux reach the finish | — | **not met** (known gap): left-hand makes 256 right and 4 wrong decisions in 300 s; the first wrong one (bowl exit, curved arrival) starts a loop |

## Code mode (src/brain/firmware.test.ts) — passed 2026-11-14
| Check | Result |
| --- | --- |
| Sample firmware follows an S-track and prints "Finish!" | pass |
| Firmware with reversed motor signs goes off-line | pass |
| `delay(100)` spacing is 100 ms of simulated time and physics runs during it | pass |
| `fetch`, `XMLHttpRequest`, `WebSocket`, `self`, `globalThis`, storage are undefined | pass |
| Unmapped pin is reported | pass |
| `map()` Arduino maths: −7, −178, 127 (D11) | pass |
| PCNT returns ESP_OK, writes `{value}`, clear resets (D10) | pass |
| 20 back-to-back analogReads differ (fresh noise, D12) | pass |
| 100 analogReads: ESP32 ≈ 1 ms 12-bit, AVR ≈ 11.2 ms ≤ 1023 (D13) | pass |
| adc_oneshot read; MCPWM legacy 40 % and v5 60/30 % duty (D14) | pass |
| CSV lists every decision once, heading within ±180° (D15, src/worker/engine.test.ts) | pass |

## Sensors, disturbances, imports (src/sim/sensors.test.ts) — passed 2026-11-14
| Check | Result |
| --- | --- |
| Slow sweep over a line gives a monotonic S rise and fall | pass |
| Higher sensor: less contrast, wider edge | pass |
| Sensor spacing and placement | pass |
| Seeded noise is reproducible | pass |
| Uneven lighting and bumps change readings | pass |
| Project round-trip; malformed JSON, wrong version, bad numbers, non-image data rejected | pass |

## Sandbox (e2e/sandbox_escape.py, production build) — passed 2026-11-15
Escape attempts (Function constructor → global → fetch, prototype chain, dynamic `import()`) against a logging local
server: 0 requests arrived with the CSP; 1 arrived without it (confirms the test detects escapes).

## Browser smoke (e2e/smoke.py, production build) — passed 2026-11-15
Track tab with crop box; Settings run (0 off-line in 8 s); Code mode sample prints "Ready" and "Finish!"; Board
selector shown; a robot file with stall current 0 is refused; dark theme legend readable; no page or console errors.

## Browser end-to-end (headless Chromium, production build) — passed 2026-11-14
Run, scrub, LSRB memory run (117.54 s → 105.44 s), Compare overlay, Code mode sample (console "Ready", "Finish!"),
CSV / PNG / HTML report / GIF (2.0 MB) downloads, dark theme. No page or worker errors.

## LFSim Lab Phase 0 — passed 2026-11-16
| Check | Expected | Result |
| --- | --- | --- |
| Website vs command line, Settings mode (left-hand, sample track, ~8.6 s) — e2e/headless_match.py | identical CSV rows | pass (4,308 rows identical) |
| Website vs command line, Code mode (sample firmware, ~9.2 s) | identical CSV rows | pass (4,616 rows identical) after printing near-zero values without a minus sign; before that only the sign of a stopped robot's speed (about 1e-17 m/s) differed |
| Same run in chunks of 0.37 s, 2 s, 8 s (lab/src/headless.test.ts) | identical CSV | pass |
| Project file vs the same settings given as options | identical CSV | pass |
| Bad input: JPEG, no track, unknown option, bad algorithm, 9999 s, robot with mass 0 | clear error | pass |
| `npm run lab -- doctor` on Linux | all four OK | pass (Node 22.23, Git 2.43, GCC 13.3, Claude Code 2.1) |
| Speed (one core, sample track, 30 s run incl. track import) | measured | 14× real time; most of a short run is the one-off track import and junction graph (to be cached in Phase 1) |
| Windows setup guide | followed on a Windows laptop | **not yet run** — needs your laptop |
