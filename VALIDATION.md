# Validation

Results recorded only after running. Command: `npm test`.

## Physics (src/sim/physics.test.ts) — passed 2026-11-14
| Check | Expected | Result |
| --- | --- | --- |
| Straight-line top speed vs motor maths | within 85–101% | pass (1.493 m/s vs 1.495 nominal) |
| Equal motors drive straight | heading < 0.001 rad after 2 s | pass |
| Weaker right motor curves right | heading > 0.01 rad | pass |
| Spin rate vs wheelbase | within 5% | pass |
| 0 → 90% speed | < 0.5 s | pass |

## Track import (src/track/importTrack.test.ts) — passed 2026-11-14
| Check | Expected | Result |
| --- | --- | --- |
| EDT exact distances | exact | pass |
| Robo-Run sample scaled | 1250 × 1250 px at 2 mm | pass |
| Line width measured | 2–4.5 cm | pass (2.6 cm) |
| Start top-left, finish bottom-right | detected | pass |
| Line normalised to 3.8 cm | 3.4–4.2 cm | pass |

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

## Physical maze runs (src/brain/maze.test.ts, default robot and Settings) — passed 2026-11-14
| Check | Expected | Result |
| --- | --- | --- |
| Left-hand finishes, code sees finish, 0 off-line | yes | pass (117.5 s, 12.6 m, 58 decisions) |
| LSRB run 2 (memory) faster than run 1 | yes | pass (105.4 s vs 117.5 s, 11.5 m) |
| Trémaux run 1 and run 2 finish | yes | pass (117.5 s; 113.4 s, 12.2 m) |
| Straight-first does not finish in 120 s | yes | pass |
| Brain IO exposes no track, graph, start or finish | yes | pass |

Physical distances are shorter than graph lengths: the robot cuts corners and the scan sees nearby lines. Physical
right-hand loops in the inner-left section of the sample (the graph run finishes): recorded as a known difference, not hidden.

## Code mode (src/brain/firmware.test.ts) — passed 2026-11-14
| Check | Result |
| --- | --- |
| Sample firmware follows an S-track and prints "Finish!" | pass |
| Firmware with reversed motor signs goes off-line | pass |
| `delay(100)` spacing is 100 ms of simulated time and physics runs during it | pass |
| `fetch`, `XMLHttpRequest`, `WebSocket`, `self`, `globalThis`, storage are undefined | pass |
| Unmapped pin is reported | pass |

## Sensors, disturbances, imports (src/sim/sensors.test.ts) — passed 2026-11-14
| Check | Result |
| --- | --- |
| Slow sweep over a line gives a monotonic S rise and fall | pass |
| Higher sensor: less contrast, wider edge | pass |
| Sensor spacing and placement | pass |
| Seeded noise is reproducible | pass |
| Uneven lighting and bumps change readings | pass |
| Project round-trip; malformed JSON, wrong version, bad numbers, non-image data rejected | pass |

## Browser end-to-end (headless Chromium, production build) — passed 2026-11-14
Run, scrub, LSRB memory run (117.54 s → 105.44 s), Compare overlay, Code mode sample (console "Ready", "Finish!"),
CSV / PNG / HTML report / GIF (2.0 MB) downloads, dark theme. No page or worker errors.
