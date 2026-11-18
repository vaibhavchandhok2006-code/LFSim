# LFSim Lab — Spec v1

15 Nov 2026 · Vaibhav Chandhok · Living copy: <https://claude.ai/artifact/7noPMWNsUYry7sCm8jCajX>
(this file is the repository copy; when the two differ, the newer dated change wins and both are updated).

## Summary and goal

LFSim Lab is a laptop tool built on LFSim that searches for the best Robo-Run line follower: control values, sensor and
body geometry, maze logic, electronics and chassis. It tests every candidate on hundreds of generated Robo-Run tracks and
keeps what finishes most often, then what is fastest.

The end output is one results folder per design: flashable C code (ESP-IDF and Arduino), the robot file and values, a
wiring diagram + pin table, a KiCad schematic, circuit checks, a parts list with links and prices, a STEP + STL
chassis, and a validation report.

Target: at least 95 % of runs finish on generated tracks the system never tuned on, over a full simulated 10-minute
Robo-Run session; among designs that reach it, the lowest median official time wins (official time = run time +
off-line penalty (N/20 × run time) + 2 s per restart + 3 s per adjustment). "Definite to win" is not a claim the system
makes; it reports measured numbers, and after calibration, the measured sim-to-real error.

## Users and use cases

First user: Vaibhav, building a Robo-Run robot for Shaastra (event in 1–3 months). Later: any team, running it with
their own Claude Code; so setup and outputs are documented from the start.

1. **Optimise for my parts (Mode A).** Design only from parts I or the RMI club have; I confirm each proposed part. The
   chassis can be reprinted; wheels and motors are only real catalogue parts.
2. **Optimise with a budget (Mode B).** Buy parts from Robu.in, Robocraze or Amazon India; the whole robot including
   battery stays within ₹6,000 (tools, filament and shipping excluded).
3. **What-if.** Give a fixed design and get its report: finish rate, times, where and why it fails.
4. **Add tracks.** Feed in Shaastra track images (2024, 2025, 2026 so far), including angled photos from videos, to
   check that generated mazes look real.
5. **Calibrate.** Load real-robot test logs so the simulator matches the robot, and see the remaining error.

## Scope

**In (v1 of LFSim Lab):** Robo-Run competition profile from the rulebook (stored as data so other events can be added
later) · track generator + track-image import with perspective correction · headless benchmark of a design over a whole
simulated 10-minute session · calibration from real-robot logs · running the real C firmware inside the simulator ·
parameter optimiser (control values; geometry and parts by mode) · algorithm agent (Claude Code writes and improves maze
logic in C) · electronics agent (parts, budget, wiring, KiCad schematic, circuit checks) · CAD generator (parametric
chassis, STEP + STL) · results folder, live progress page, results viewer in the LFSim website.

**Out:** layouts other than 2-wheel differential drive + caster (no 4WD, no suction fan) · custom PCB layout · paid AI
APIs · ordering parts automatically · other bots on the maze at the same time.

**Later versions:** other competitions' rulebooks; 4WD and suction-fan physics; custom PCB layout; public packaging and
setup wizard.

## Robo-Run rules used (Shaastra Robo-Run 2027 rulebook; updated 2026-11-18)

Mat **16 × 16 grid of 25 cm squares (4 m × 4 m)**, enclosed; lines black on white, 3–4 cm; start square fully black
in a corner; start line between the first and second squares; timer from the front edge crossing the start line to
the front edge entering the destination; the destination is at the end of the maze track, has one pathway, a simple
line follower cannot easily find it, multiple paths exist; features: 45° and 90° turns, intersections, dead ends,
curves, curved turns (¼ or ½ circle), junctions. Bot at most 20 × 20 cm, self-contained, no camera. 10 minutes of
access including adjustments (plus 1 minute of calibration, not counted); the 10 minutes are either 1 dry run (x min,
not scored) + 1 actual run (10 − x min) or 2 actual runs (best counts); multiple runs; every exit from the start square
is a new run; re-entering the start square aborts the run (restart penalty). First round time score = run time + 5 s
per line crossing + 2 s per restart + 3 s per adjustment (changing switches, batteries, sensors or speed settings
counts as an adjustment). Bots that do not reach the destination score (time + penalties) / C, C = value of the
furthest checkpoint covered. Final round: restart 8 s, adjustment 5 s, and 15 s per yellow 10 cm block not pushed off
its yellow square (blocks sit at dead ends; a cleared square becomes a checkpoint) — stored as data, not yet
simulated. No reprogramming after the maze is shown; switches (algorithm, speed) allowed; weight may not change. The
2026 edition (10 × 10 grid, off-line N/20 × run time) is kept as `roborun-2026.json`.

## Inputs, outputs and file formats

| File | Format | Holds |
| --- | --- | --- |
| Competition profile | `competition/roborun-2027.json` (and `roborun-2026.json`) | The rules above as data: sizes, session length, penalties, abort rule, allowed changes |
| Track | `.track.json` (LFSim) + PNG | Top-down image at 2 mm/px, squares, generator seed and features |
| Track set | `tracksets/<name>/` | Tracks split into tuning and held-out, plus a manifest and feature statistics |
| Reference images | PNG/JPEG + 4 corner points | Shaastra photos, rectified to top-down |
| Parts catalogue | `parts/catalogue.json` | Part, type, numbers for LFSim (rpm, torque, mass…), price, shop link, date checked, source |
| Availability | `parts/have.json` | Parts confirmed available (Mode A), filled from checkpoint answers |
| Design | `.design.json` | Robot file + firmware ref + values + switch table + mode + parts used |
| Firmware | `firmware/esp-idf/main.c`, `firmware/arduino/robot.ino` | The code to flash, plus the hardware shim used in the simulator |
| Calibration logs | CSV from the robot's serial | Raw test data; calibration report |
| Results folder | `results/<date>-<name>/` | report.html, design files, code, wiring.svg + pins.md, schematic.kicad_sch, spice/, parts.csv, chassis.step, chassis.stl, benchmark.csv, replays |

All files carry a schema version and are validated on load (as in LFSim).

## Functional requirements

**Tracks.** F1 — generate valid Robo-Run tracks from a seed (grid, line width, corner start square, start line, one
pathway into the destination, at least two routes, all reachable). F2 — include the features seen on real mazes: T,
cross, corner, dead end, 45° diagonals, curves and arcs, zigzags/V, loops, rings with spokes, multi-way junctions, short
segments; mix and difficulty set per track set. F3 — destination placed so a plain line follower does not easily reach
it (checked with the junction graph). F4 — import a photo: mark the mat's 4 corners, warp to top-down, import as in
LFSim. F5 — feature statistics measured on reference images and generated sets; the user approves about 20 samples per
generator version. F6 — tuning and held-out tracks never mix.

**Benchmark.** F7 — run any design on any track set without a browser, on all CPU cores, reproducibly. F8 — simulate the
whole 10-minute session (exploration and memory runs, switch changes, restarts and penalties, re-entry aborts, best
official time). F9 — run variations (sensor noise, lighting, bumps, battery sag, motor mismatch, small placement
errors). F10 — score: finish rate first, then median official time; also off-line count, restarts, where runs fail;
what-if report for any design. F11 — every run can be replayed in the LFSim website.

**Firmware in the loop.** F12 — the exact ESP-IDF C and Arduino C++ firmware is compiled for the simulator against a
hardware shim and run in lock-step with the physics. F13 — the same source builds for the ESP32 unchanged.

**Calibration.** F14 — calibration test firmware (straight run, spin, sensor sweep, one corner) logging CSV over serial.
F15 — import logs, fit the uncertain robot numbers, report remaining error; until then designs are marked "not
calibrated".

**Parameter optimiser.** F16 — search control values in every mode (Kp, Ki, Kd, D filter, loop rate, speeds,
acceleration, junction settings, look-ahead). F17 — search geometry and parts by mode (Mode A: available parts only,
wheels and motors discrete; Mode B: catalogue within budget). F18 — hard limits: 20 × 20 cm, parts fit, printable.
F19 — produce the switch table for the event.

**Algorithm agent.** F20 — Claude Code (non-interactive, Pro plan) writes maze logic in C using only what a real robot
has (sensors, encoders, timers, memory, switches). F21 — loop: propose → compile → benchmark → read failures → revise;
every version kept with its score; best checked on held-out tracks. F22 — first finish an unseen maze within the
session, then cut the official time. F23 — checkpoints before a new algorithm family and at the end of each round.

**Electronics agent.** F24 — parts catalogue from Robu.in, Robocraze, Amazon India (dated prices). F25 — Mode A:
propose parts and ask which the club has; Mode B: choose within ₹6,000. F26 — wiring diagram + pin table, KiCad
schematic, circuit checks (power, currents, drops, sensor levels, level shifting; SPICE where it applies). F27 — part
numbers feed back into the robot file; re-benchmark.

**CAD.** F28 — parametric chassis (STEP + STL, 220 × 220 mm bed). F29 — CAD mass and centre of mass feed back.

**Orchestration.** F30 — one command per job; results folder. F31 — local live-progress page. F32 — LFSim website opens a
results folder. F33 — checkpoints pause and ask in the Claude Code chat; jobs resume.

**How the agents depend on each other.** The agents are separate parts of one program that work through a shared design
file and the benchmark, not by free conversation. Outer loop: electronics → CAD → design file (choices + limits). Inner
loop for that hardware: algorithm agent → parameter optimiser → benchmark, with failures fed back. A hardware change is
kept only if the score improves after the inner loop re-tunes the code. F34 — each agent writes its choices and the
limits they create. F35 — hardware is scored only after re-tuning. F36 — a change re-runs only what depends on it, in
order. F37 — a design that breaks a hard limit is invalid; otherwise the higher score wins; every decision is logged.

| If this changes | It affects |
| --- | --- |
| Electronics (motors, sensors, battery, pins) | Speed and torque limits → PID and speeds; sensor count and ADC → what the algorithm can read; sizes and mass → chassis |
| Chassis (wheelbase, sensor offset, mass) | Turning and look-ahead → PID and junction timing; space → which parts fit |
| Algorithm | Which speeds and values work; whether encoders or extra switches are worth having |
| Parameters | Nothing upstream; they adapt to everything else |

## Non-functional requirements

Reliability first (each module tested before the next depends on it) · reproducible (seeds and versions) · honest
(estimates labelled, uncalibrated designs say so, targets not met reported as not met) · no overfitting (final numbers
from held-out tracks only) · Windows laptop with overnight jobs, also Linux (CI) · speed (estimate): 50 full sessions
per minute on 8 cores · no paid API · nothing leaves the laptop except Claude Code calls and shop look-ups · resumable
jobs · AI-written firmware runs only in the simulator until the user flashes it.

## Architecture and tech stack

| Part | Choice | Why |
| --- | --- | --- |
| Simulator core | LFSim's TypeScript sim, run in Node.js | Same physics as the website |
| Parallel runs | Node worker threads | Overnight jobs on a laptop |
| Firmware in the loop | User's C compiled natively (GCC via MSYS2 on Windows) against an LFSim hardware shim, lock-step over a pipe | Tests the exact code that is flashed |
| Track generator | TypeScript, grid-based graph → drawn image, seeded | Valid by construction, reproducible |
| Photo import | 4-corner perspective warp in the Track tab | Angled video frames become top-down tracks |
| Optimiser | CMA-ES + discrete search over parts | Good for noisy, expensive objectives |
| AI agents | Claude Code, non-interactive, driven by the job runner | Covered by the Pro plan |
| Electronics | KiCad schematic files by script; ngspice | Free, standard, editable |
| CAD | CadQuery parametric chassis → STEP + STL | Free, scriptable |
| Code home | `lab/` inside the LFSim repo | Reuses the simulator |

## Phases

| Phase | Delivers | Done when |
| --- | --- | --- |
| 0. Setup | Windows setup; simulator from the command line | Headless = website for the same seed; CI on Linux — **done 2026-11-16** |
| 1. Tracks + benchmark | Competition profile, track generator, photo import, track sets, session simulation, what-if report, live page, results viewer | 500 tracks pass the checker; statistics within reference ranges; samples approved; every rule tested; speed target; what-if report for the current robot — **built 2026-11-18** (sample approval pending; see VALIDATION.md) |
| 2. Firmware in the loop | Hardware shim; C compiled and run in the sim; ESP32 build | main.c matches its JS translation on 20 tracks; ESP32 build in CI (**done 2026-11-19**: a reference firmware in C and in JS gives identical logs on 20 tracks; the RMI firmware runs unchanged; both build for ESP32) |
| 3. Calibration | Test firmware, log import, fit, report | Straight ±5 %, spin ±10 %, sensors ±10 % (targets, estimate) |
| 4. Parameter optimiser | Control and Mode A geometry search; switch table | Beats the hand-tuned baseline on held-out tracks beyond run-to-run spread |
| 5. Algorithm agent | Claude Code loop for maze logic in C | ≥ 95 % finish over full sessions on held-out tracks, then faster |
| 6. Electronics agent | Catalogue, availability, budget choice, wiring, KiCad, checks | ERC clean, checks pass, within budget, re-benchmarked |
| 7. CAD | Parametric chassis | Fits 20 × 20 cm and the bed; mass fed back |
| 8. Full loop + report | One command to results folder | All outputs; final design run on the real robot with measured error |

Timing (estimate): Phases 0–2 about 3 weeks; Phase 3 when the robot is free; Phase 4 about 2 weeks; Phase 5 about 3 weeks.

## Validation plan

Every claim comes from a measurement with a stated tolerance, recorded in `VALIDATION.md`: headless = website · tracks
valid (100 %) · tracks look real (statistics + your review) · session rules (one test per rule) · firmware in the loop
faithful · sim matches robot (calibration) · design meets target (≥ 200 held-out tracks × 3 variations, with a
confidence interval) · optimiser helps · electronics sound · CAD fits · real robot agrees.

## Assumptions, risks and open questions

Assumptions (confirmed 2026-11-16): the name "LFSim Lab"; 500 tracks per set (300 tuning, 200 held out), 3 variations;
the timing above. Risks: sim gap before calibration; overfitting to generated tracks; hard junction features; Claude
Pro limits; shop pages changing; native C setup on Windows. Open: when the robot is free for calibration.

## Decisions log

See the living spec and `DECISIONS.md`. Key ones: command-line jobs on the Windows laptop · Claude Pro only · Modes A and
B (₹6,000) · real catalogue wheels and motors · Phase 1 = tracks + benchmark · rulebook + Shaastra images · finish rate
then official time, ≥ 95 % held-out · full 10-minute session · ESP-IDF and Arduino, real C compiled for the sim ·
algorithm agent free within the rules · system decides switches · checkpoints in Claude Code · wiring + KiCad +
circuit checks, no PCB · STEP + STL · 2WD + caster only · Robu.in, Robocraze, Amazon India · Robo-Run first · code in
the LFSim repo · me first, public later · what-if mode · phases measured on held-out tracks.
