# LFSim — handoff (15 Nov 2026)

Live app: https://vaibhavchandhok2006-code.github.io/LFSim/ · Spec: `docs/LFSim_Spec_v1.pdf` (then PRD.md, DECISIONS.md).

## Where we are

- **Phases 1–5 (v1 build): done** and deployed earlier (track import, physics, sensors, Settings mode, Code mode
  firmware sandbox, exports, docs, FIRMWARE_API.md).
- **Current phase: fixing the Independent Test Report** (`LFSim — Independent Test Report.pdf`, 21 defects D1–D21,
  tested commit 0f156da). Work is task by task; see the status table below.

## Test-report status

| Defect | What | Status |
|---|---|---|
| D3 (critical) | Firmware sandbox escape (Function → global → fetch, dynamic import) | **Fixed.** CSP meta tag in the build (`vite.config.ts`), sim worker started from a blob URL, network/storage globals removed along the whole prototype chain of `self` (`src/worker/simWorker.ts`). Escape script `e2e/sandbox_escape.py` → 0 requests reach a local server. |
| D1 (critical) | 360° scan turned onto unconnected lines; judge missed white crossings | **Fixed.** Scan removed. New realistic junction reading from a sensor "swath" map built while driving (`src/brain/junctionMap.ts`). New `ShortcutJudge` (`src/sim/judge.ts`) counts "crossed white to another line" as off-line. |
| D2 (critical) | Maze outcome chaotic | **Partly fixed.** Clean grid maze: left/right/LSRB/Trémaux/straight-first all finish, junction count = graph, distance within 6 %, stable at base 0.3–0.5 × 100–1000 Hz (tests in `src/brain/maze.test.ts`). **Robo-Run sample: algorithms still do not finish** (see known bugs). |
| D4 | "Code saw finish" = any stop | **Fixed.** Stop away from finish → `code-stopped` event "not at the finish". |
| D20 | Automatic run end | **Fixed.** No auto stop; start-square re-entry only logged; memory saved at finish. |
| D17 | Settings mode coasts on stop | **Fixed.** TB6612 duty 0 = brake in Settings mode. |
| D5, D16, D19 | Low-gear-ratio instability, no stiction, forces about axle | **In progress, NOT merged.** Draft in `wip/physics_com_stiction_substeps.patch` (adaptive sub-steps, CoM dynamics, stiction 2.5× estimate). Bug found: spin in place becomes asymmetric with a CoM offset (wL 35.8 vs wR −45.8 rad/s) — CoM velocity conversion needs checking before applying. |
| D6 | No encoders → exact odometry | To do: dead-reckon from commanded duty when encoders absent (`src/sim/simulation.ts` `wheelOdometry`). |
| D7, D8, D9 | Fixed 128 threshold; non-square images stretched; robot-file numbers not range-checked | To do (`src/track/importTrack.ts`, `src/ui/loadTrack.ts`, robot import validation). |
| D10–D14 | PCNT API, Arduino `map()`, per-read noise, board ADC timing, adc_oneshot/mcpwm | To do (`src/brain/firmware.ts`, FIRMWARE_API.md). |
| D15, D18, D21 | CSV decision column/heading wrap; PWM freq no effect; loop rate cap 1000 Hz + dark legend | To do (`src/ui/exports.ts`, BrainPanel/RobotPanel, styles). |

## What works now (verified)

- `npm test`: 7 files, 52 tests pass. `npm run build` passes.
- Settings brain: realistic junction reading (no scan), auto inch onto the junction, spin-until-line with a minimum
  angle from neighbouring branches, start square not taken as finish within 60 cm (odometry), finish = 10 cm all black.
- On straight approaches to Robo-Run junctions: ≥ 88 % of readings right, ≤ 3 % wrong turns (test).

## Known bugs / limits

1. Robo-Run sample: no algorithm finishes in Settings mode. Misreads at dense features: the 5-way junction near
   (0.44, 1.03) m (branches 45° apart merge), the ring with spokes (1.3–1.7, 0.55–0.9), curved arrivals (bowl near
   0.79, 0.66). Left-hand's first wrong decision is at the 5-way junction (~41 s).
2. Odometry drift (wheel skid in spins) is tens of cm after a minute; right-hand can stop in the start square
   (reported honestly as "not at the finish").
3. Base speed 0.7 with default PID gains loses the line (tuning limit, counted as off-line).
4. Guide doc artifact still mentions the 360° scan — update when shipping.

## Key decisions (why)

- No look-around scan: user said 360° turns are not realistic in competitions; the report flagged it (D1).
- Brains never see the track/graph (CLAUDE.md); the graph is only the reference/judge.
- Clean grid maze (`loadGridMaze` in `src/testutil.ts`) used for exact algorithm tests; Robo-Run sample used for
  honesty tests (no shortcuts, reading accuracy).
- CSP + blob worker because GitHub Pages cannot send headers.

## File structure (main)

- `src/sim/` physics, sensors, simulation loop, `judge.ts` (shortcut judge).
- `src/brain/` `settings.ts` (Settings brain), `junctionMap.ts` (swath junction reading), `navigator.ts`
  (left/right/LSRB/Trémaux), `firmware.ts` (Code mode runtime).
- `src/track/` import, darkness map, junction graph (`graph.ts`: buildGraph, runRule, turnAngle).
- `src/worker/` sim worker (sandbox lockdown), engine. `src/ui/` React panels.
- `e2e/` Playwright sandbox-escape check. `wip/` unfinished physics patch + diagnostic tests
  (`decision_audit`, `junction_exam` — rename to `src/*.test.ts` to run).

## Exact next steps

1. Fix the CoM spin asymmetry in `wip/physics_com_stiction_substeps.patch`, apply it, add tests: 10:1 and 1:1 gear
   ratios stable, dead band ~10 % duty, spin symmetric with CoM offset. (D5/D16/D19)
2. D6 dead-reckoning odometry without encoders.
3. D7 Otsu threshold (must not change clean images), D8 aspect warning + crop box, D9 range checks with messages.
4. D10–D14 firmware API fixes + tests; update FIRMWARE_API.md.
5. D15, D18, D21 small fixes.
6. BrainPanel: inchMode auto/manual field, remove "junction scan" wording; show finishBlack default 10 cm.
7. Optional: better reading at dense junctions (split merged edge groups, curved-arrival line direction).
8. Full verify (tests, build, browser e2e incl. sandbox script, Code mode sample prints Ready/Finish!), update
   VALIDATION.md, DECISIONS.md, TASKS.md, README, guide doc; commit and push.
