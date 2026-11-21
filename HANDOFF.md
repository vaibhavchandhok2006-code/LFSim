# LFSim — handoff (16 Nov 2026)

Live app: https://vaibhavchandhok2006-code.github.io/LFSim/ · Spec: `docs/LFSim_Spec_v1.pdf` (then PRD.md, DECISIONS.md).

## Where we are
- **21 Nov 2026: Code mode compass + buttons.** Arduino `Wire` with a simulated QMC5883L (true heading), push buttons
  driven by an operator script (timed presses, put back at the start), `A0`–`A7`. Example: the user's Uno maze sketch
  in `examples/magnetometer-maze/` runs on the website and the command line; it does not finish the sample track
  (see that folder's README). Repo was reset to the end of LFSim Lab Phase 0 on 20 Nov (backup branch
  `backup/before-reset-2026-11-20`); Phase 1 restarts from scratch with review checkpoints.
- v1 (Phases 1–5) done.
- **Independent Test Report: all 21 defects addressed.** 20 fixed and verified; D2 fixed on clean mazes, with a
  documented limit on the dense Robo-Run sample (below). 77 automated tests and the browser smoke test pass.
- **LFSim Lab** (spec: `docs/lab/SPEC.md`): Phase 0 done 2026-11-16 — headless command line identical to the website,
  Windows laptop set up and checked (`npm run lab -- doctor` all OK). Next: Phase 1 (competition profile, track
  generator, photo import, 10-minute session benchmark, what-if report). Shaastra reference images: 2024, 2025, 2026
  (3–4 images, to be sent).
- Reality check against the real robot when it is free (LFSim Lab Phase 3).

## What changed for the test report
| Defect | Fix |
| --- | --- |
| D1 | No 360° scan. Junctions read from a map of what the sensors saw while rolling on (`src/brain/junctionMap.ts`). Shortcut judge (`src/sim/judge.ts`). |
| D2 | Grid maze: all algorithms finish like the graph, stable at base 0.3–0.5 × 100–2000 Hz. Robo-Run sample: see known gaps. |
| D3 | CSP meta tag, blob-URL worker, network/storage globals removed along the prototype chain. |
| D4, D20, D17 | Honest "code saw the finish"; no automatic run end; TB6612 brakes in Settings mode. |
| D5, D16, D19 | Adaptive physics sub-steps, gearbox stiction (estimate 2.5×, editable), forces about the CoM. |
| D6 | No encoders → odometry estimated from commanded duty. |
| D7, D8, D9 | Otsu threshold for non-clean images (clean unchanged), stretch warning + crop box, robot range checks. |
| D10–D14 | PCNT (ESP_OK + `{value}`, clear), Arduino `map()`, fresh noise per read, Board setting (ESP32 / AVR), `adc_oneshot_*`, MCPWM legacy + v5. |
| D15, D18, D21 | CSV keeps every decision + wrapped heading; PWM frequency labelled honestly; loop rate to 2 kHz; readable legend. |

## Known gaps
1. Robo-Run sample, Settings mode: algorithms do not reach the finish. 94 % of straight-approach junctions read right;
   misreads at the 5-way junction (0.44, 1.03) m, the ring with spokes, and the bowl exit (curved arrival). One wrong
   turn makes a wall follower loop. Code mode (your own firmware) is unaffected.
2. Odometry drift after a minute of turns (tens of cm); start-square exclusion is 60 cm.
3. Base 0.7 with default PID gains loses the line.

## Diagnostics kept
`wip/decision_audit.test.ts.txt` (checks each real-run decision against the graph) and
`wip/junction_exam.test.ts.txt` (approaches every junction). Copy to `src/zz_*.test.ts` to run; delete after.

## Next steps
1. Reality check: run the RMI robot file and the real robot on the same track, compare speed/time.
2. Optional: improve dense-junction reading (split merged edge groups by length; curved-arrival line direction).
3. v2 features.
