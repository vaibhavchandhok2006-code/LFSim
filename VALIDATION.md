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
| Windows setup guide (2026-11-16, your HP laptop) | doctor all OK | pass (Node 26.13, Git 2.56, MSYS2 GCC 16.2, Claude Code 2.1.325); fixes needed on the way: add C:\Users\<you>\.local\bin to PATH after the Claude installer, and allow scripts with Set-ExecutionPolicy -Scope CurrentUser RemoteSigned |

## LFSim Lab Phase 1 — built 2026-11-18 (sample approval pending)
| Check | Expected | Result |
| --- | --- | --- |
| Competition file loads and rejects bad schema, version, ranges, types (lab/src/competition.test.ts) | clear errors | pass |
| Rulebook worked example (40 s, 2 off-line, 3 restarts, 2 adjustments) | formula result | 56 s by the formula; the rulebook prints 54 s (its arithmetic slip, see DECISIONS.md) |
| Generator reproducible: same seed, same pixels; different seed differs | identical / different | pass |
| Track set rr-v1: 500 tracks (300 tuning, 200 held-out) pass every rule check (`tracks check`) | 500 / 500 | pass. Checks: 2.5 m mat, line 3–4 cm, start square in a corner cell, one exit from the start, one pathway into the finish, all lines connected, ≥ 2 routes, neither wall follower finds the finish within 1.5 × the shortest route |
| Tuning and held-out tracks never share a seed; a manifest that mixes them or points outside the set is refused | refused | pass |
| A saved track loads back bit-identical to the generated one | identical | pass |
| Statistics: the reference maze inside the generated 10–90 % range (24 sample tracks) | inside | pass: junctions 38–62 (reference 59), line length 26.9–32.6 m (32.0), loops 23–35 (28), curved share 0.08–0.15 (0.14), dead ends 4–13 (12) |
| Sample tracks look like Shaastra mazes (you review `sheet.html`) | approved | **pending** |
| Session rules, one test each (lab/src/session.test.ts): explore then memory runs, official time = best score, cut-off run not counted; re-entry aborts and counts a restart; restart penalty and the alternative counting rule; 10-minute limit includes setup; never leaving the start is not a restart; reproducible with varied placement | pass | pass (6 tests) |
| Benchmark: one thread vs worker threads give identical session results | identical | pass |
| Replay: a failed run's project file, run headless, ends the same way at the same time | within 0.01 s | pass |
| Photo import: an angled render of a generated maze, flattened from its corners, matches the top-down maze | < 12 % pixel difference, same start, junctions within 10 % | pass; corners validated in files; browser drag test (e2e/photo_import.py) on the Shaastra event photo: perspective corrected, start and finish found |
| Website = command line after Phase 1 changes (e2e/headless_match.py) | identical CSV rows | pass (Settings 4,174 rows, Code 4,474 rows) |
| Speed target (estimate: 50 sessions/min on 8 cores) | ≥ 50/min | 22.1 sessions/min on this 2-core machine (≈ 11 per core); about 80/min expected on 8 cores. Faster after caching the junction graph and the `darkAt` change (4.4 → 11.3 per core, results bit-identical) |
| What-if report, current robot (RMI test rig profile, Settings mode, Trémaux, default switch ladder), 200 held-out tracks × 3 variations | report | 15.5 % of sessions finish (95 % interval 12.8–18.6 %); median official time 68.6 s (10–90 %: 29.7–124.2 s); median first finish 148 s into the session; 5.0 restarts per session. Runs in failed sessions ended by: operator gave up 999, stopped away from the finish 879, re-entered the start square 929. Clean / uneven light / harsh: 15.0 / 17.0 / 14.5 %. On 12 tracks LSRB: 2 of 12 sessions, Trémaux 4 of 12 |

## Robo-Run 2027 rulebook update — 2026-11-18
| Check | Expected | Result |
| --- | --- | --- |
| 2027 round 1 example: 40 s, 2 line crossings, 3 restarts, 4 adjustments | 68 s | 68 s (test) |
| 2027 final example: 40 s, 2 crossings, 1 restart, 4 adjustments, 2 blocks uncleared | 108 s | 108 s (test) |
| 2026 rules still load (10 × 10, N/20 × run time) | 56 s by its formula | pass |
| Dry run: unscored, restarts/switch changes not counted, memory carries into the actual run | as rulebook | pass (session test) |
| Switch change in the scored part = 1 adjustment (+3 s) | as rulebook | pass (session test: score = run time + 5 N + 2 r + 3 e) |
| Checkpoints: run stopped short scores (time + penalties) / C; best by furthest C | as rulebook | pass (session test) |
| Track set rr-2027: 500 tracks, 4 m mat, all pass the rule checks at generation, 3 checkpoints each | 500 / 500 | pass. Median 129 junctions, 73 m of line, 69 loops; junctions per m² like the reference maze. Finish at the far end in about 80 % of mazes. Made in 1,043 s on 2 workers |
| Sample tracks look like Shaastra 2027 mazes | your review | **pending** |
| What-if, RMI test rig, Trémaux, 300 s dry run, 40 held-out 4 m tracks × 3 variations | report | 4.2 % of sessions finish (95 % interval 1.8–9.4 %), median official time 223 s; sessions without a finish reached checkpoint C ≥ 1 in 65 of 115 (C1 36, C2 16, C3 13). Run ends: stopped away 194, re-entry 170, gave up 118. 18 sessions/min on 2 cores |

## Generator v3 (route style) — 2026-11-19
| Check | Expected | Result |
| --- | --- | --- |
| Feature counts within the reference budget (test, 6 mazes) | within | pass |
| Set rr-2027 v3: 500 tracks pass the rule checks at generation | 500 / 500 | pass (1,740 s on 2 workers; most tries are rejected by the hidden-finish rule) |
| Average per maze vs the sample maze (sample in brackets) | similar or a little more | zigzag 1.3 (1), half-circle bump 1.4 (1), rectangles 4.4 (≈ 8; the photos show 3–6), comb 1.0 (1), circles 0.9 (2; photos 0–3), diamond/V 0.5 (1), triangle chain 0.3 (1), meander 0.1 (1), S-bend 0.2 (1), oval 0.1 (0–1 on photos), stubs 2.9, diagonals 2.4 (≈ 6), rounded corners 2.0. Junctions median 31 (10–90 %: 23–38), dead ends 11, loops 10, line length 30 m (sample 32 m). Long features (meander, S-bend, triangles) are often dropped when they would touch another line |
| Sample tracks look like Shaastra mazes | your review | **pending** |
| What-if, RMI test rig, Trémaux, 300 s dry run, 40 held-out tracks × 3 variations | report | 3.3 % of sessions finish (95 % interval 1.3–8.3 %) |

## Track sets as variations of the real maze (generator v4) — 2026-11-19
| Check | Expected | Result |
| --- | --- | --- |
| The real Shaastra sample against the rule checker | passes (it is a real maze) | failed the old hidden-finish rule (left-hand 1.20 ×, right-hand 1.31 × the shortest route) → rule recalibrated; now passes |
| Variations reproducible; easy / normal / hard all pass the rule checks on the 4 m mat (test, 10 seeds) | pass | pass |
| Set rr-2027 v4: 500 variations (149 easy, 198 normal, 153 hard) | all pass | 500 / 500 in 383 s on 2 workers. Median junctions: easy 58, normal 62, hard 64 (sample 59); dead ends: easy 6, normal 12, hard 12 (sample 12) |
| Variations look like the Shaastra maze | your review | **pending** |
| What-if, RMI test rig, Trémaux, 300 s dry run, 40 held-out variations × 3 | report | 0 of 120 sessions finish (95 % interval 0–3.1 %). 773 runs aborted by re-entering the start square: on this maze's layout the exploration keeps coming back into the start square. Main target for Phase 5 (algorithm) |

## New shapes and staged track sets — 2026-11-19
| Check | Expected | Result |
| --- | --- | --- |
| Novel-style mazes use chevrons, Y-forks, ladders, circles on the line and crossings, with 2.5 cm gaps, and pass every rule (test, 6 mazes) | pass | pass |
| Mixed sets: about half the tracks are variations at `--mix 0.5` (2,000 seeds) | 45–55 % | pass |
| Track groups tune / held / novel never share a seed; the report shows the finish rate per style | pass | pass (tests) |
| Stage 1 set rr-2027: 500 variations of the Shaastra maze (default) | all pass | 500 / 500 in 367 s |

## Phase 2: firmware in the loop — 2026-11-19
| Check | Expected | Result |
| --- | --- | --- |
| Reference firmware, C (native, FreeRTOS 1000 Hz) vs its JS translation (Code mode), sample + 19 variations, 12 s each | byte-identical engine logs | identical on all 20 tracks (test) |
| RMI test-rig firmware, unchanged, with presses on GPIO 4 at 0.3 / 3.8 / 4.3 s and a sweep 0.5–3.6 s | calibrates, starts after the third press, drives | starts at > 4.2 s, drives > 1 m (test); CLI: 10.44 m in 40 s simulated, 27× real time |
| Firmware with a compile error | clear error with the GCC message, no run | pass (test) |
| Both examples built with ESP-IDF v5.2 for ESP32 (GitHub workflow esp32.yml) | build succeeds | success (run 44388197038) |
| Flash (NVS) keeps i32, blob and string values between runs; wrong type and over-long names are refused; switch levels read back | as on the chip | pass (test) |
| A session with native firmware: each run a reset, flash counts the resets, plan stays on explore until a finish | pass | pass (test, 22 runs) |
| RMI firmware, whole sessions, 6 held-out stage-1 tracks | runs without errors | 6 sessions in 52 s; 0 finishes; 122 of 124 runs leave the mat (plain line follower, no maze logic) |

## Phase 5 (in progress) — 2026-11-19
| Check | Expected | Result |
| --- | --- | --- |
| Generated tracks: a line touches the start and the finish square | all | v5: 0 of 500 (bug); v6: 500 of 500 |
| Fast native I/O vs exact mode, same 60 s run | same behaviour | same junctions and positions within ~2 cm (sensor noise drawn per tick); 3–6.5× faster |
| Maze firmware, single 590 s runs, left-hand loop-proof strategy, 8 tuning tracks | finish | 2 of 8 (estimate of current state; not yet a benchmark) |
| Junction identity over a 590 s run | 0 wrong matches | 4–11 wrong matches (lab/tools/junction_matches.py) — open |
| Search 1 (24 variants, successive halving to 36 tuning tracks, single 590 s runs) | rank variants | best 22/36 = 61 % (ORDER=3 away-from-start, explore 0.8, junction 0.5, turn 0.6); leaderboard in lab/firmware/examples/maze/search-2026-11-19.csv |
| Full sessions, best values, no dry run (dry_s 0), 12 tuning tracks not used in the search (tune-0113…0124) | finish | 7/12 = 58 % (95 % interval about 32–81 %); every failure ran out of time |
| Same with a 300 s / 480 s dry run | finish | 3/12 and 0/12: the memory route run takes 165–185 s on this slow robot, and a split exploration restarts from the start |
| Search 2 (24 variants: turn/junction/explore speeds, strategies 3/5/8, W_FAR, turn cost, read distance, KP) | improve on the defaults | none did: the defaults stay best at 22/36 = 61 % (lab/firmware/examples/maze/search-2026-11-19b.csv) |
| **Held-out**: full sessions, no dry run, 24 held-out tracks never used in tuning | ≥ 95 % (goal) | **10/24 = 42 %** (95 % interval about 24–61 %); 13 ran out of time, 1 stuck; finish times 204–565 s |
| Arc turns (ARC_TURNS=1), 2 tracks | faster than stop-and-spin | worse (spin time 68 → 223 s): kept off, for the agent to fix |
| What-if: 2× motor speed, own search (24 variants, up to 24 tracks) | more finishes | worse: best 10/24 = 42 % of single runs (finish 243 s mean vs 282 s); best gains at the edge of the range — control must be redesigned for speed |
| Edge inference (INFER_MM 0 / 300 / 450), 12 tuning tracks | more finishes | 9 / 8 / fewer of 12 — no clear gain, kept off |
| Wall-follower divergence (lab/tools/lh_divergence.ts), 12 tracks, left-hand runs | match the ideal route to the finish | first wrong junction after 3–34 matched junctions (of 44–57); classes found and fixed: short stubs, 5-way junctions, short dead ends, lines lost on curves |
| Held-out sessions after the junction fixes (200 rpm robot, DEAD_SCAN=2) | ≥ 95 % | 10/24 = 42 %; finishes faster (145–165 s for the quickest); all failures out of time |
