# LFSim algorithm agent — instructions for Claude Code

You improve the maze-solving firmware of a line-following robot for Shaastra Robo-Run 2027, in a simulator.
You work in rounds. In each round make ONE focused improvement, check it, and stop. The runner measures your version
on tuning tracks and keeps it only if it finishes more mazes (or finishes as many, faster).

## The goal
Finish at least 95 % of 10-minute sessions on mazes the robot has never seen, then lower the official time.

## The firmware
`lab/firmware/examples/maze/main/` — ESP-IDF C for the RMI test rig (8 analog sensors, TB6612FNG, N20 motors with
encoders, ESP32): `main.c` (behaviour), `swath.c` (junction pictures), `maze_map.c` (map, flash, route planning),
`hw.c` (hardware), `config.h` (every tunable). Read `docs/learn/phase-5-maze-algorithm.md` first.

## Rules (the runner rejects versions that break them)
- General logic only. Nothing written for one particular maze: no turn sequences, coordinates or track ids.
- The robot knows only what its hardware tells it (sensors, encoders, clock, button, switches, flash). Never the
  track image, the junction graph or the finish position.
- Only edit files in `lab/firmware/examples/maze/main/`. Keep it valid ESP-IDF C that builds for a real ESP32.
- No file, process, network or system calls in the firmware (no `system`, `popen`, `fork`, `exec*`, `fopen`, `open`,
  `socket`, `asm`, `#include <unistd.h>` or `<sys/...>`). The runner refuses to build code that contains them.
- Keep it simple enough for a 2nd-year student to read; comment the ideas.

## Tools (run from the repository root)
- One track, one long run: `npx tsx lab/tools/try-maze.ts tune-0003 run "LFSIM_FAST_IO" /tmp/a`
  (writes `/tmp/a/tune-0003.serial.txt` and `.csv`; add `,NAME=value` to try a config value)
- Picture of the path and the robot's map: `python3 lab/tools/plot_run.py tune-0003 /tmp/a.png /tmp/a --flip`
  then open the image.
- Wrong junction matches: `python3 lab/tools/junction_matches.py /tmp/a tune-0003`
- A few tracks: list several ids, comma-separated. Use tracks `tune-0001` … `tune-0300` only (never `held-*`).
- Each run of 590 s takes about 15 s. Do not run more than about 12 runs per round.

## The best signal: wall-follower divergence
A left-hand wall follower that handles every junction correctly reaches the finish on these mazes (about 30 m). So
run the firmware as a pure left-hand follower and find the first junction where it goes wrong:
```
npx tsx lab/tools/try-maze.ts tune-0211,tune-0212,tune-0213 run "LFSIM_FAST_IO,ORDER=6" /tmp/lh
npx tsx lab/tools/lh_divergence.ts tune-0211 /tmp/lh      # "matched the first N" and where it first went wrong
```
Then read the serial log around that time (`awk '$1>50 && $1<60' /tmp/lh/tune-0211.serial.txt`) and fix the cause
in general. Classes fixed so far: short stubs, 5-way junctions (look-around), short dead ends (decide from the map),
lines lost on curves (sweep). Per-junction reliability must reach about 99.9 % for 95 % finishes.

## How to work in a round
1. Read `lab/agent/state.md` (scores so far and what earlier rounds tried) — do not repeat a failed idea.
2. Look at failures of the current version: run 2–4 tracks it fails on, plot them, find the cause.
3. Make one change that fixes that cause in a general way.
4. Re-run the same tracks to see that it helps; build must stay free of warnings.
5. Append 3–6 lines to `lab/agent/state.md`: what you saw, what you changed, what you expect. Then stop.
