# LFSim Lab

Finds the best Robo-Run line follower by testing designs on many tracks without a browser. Spec:
[LFSim Lab — Spec v1](https://claude.ai/artifact/7noPMWNsUYry7sCm8jCajX).

Status: **Phase 2 done** (your C firmware runs unchanged inside the simulator). **Phase 1 done** (updated to the Shaastra Robo-Run 2027 rulebook: 4 m mat, dry run, new penalties, checkpoints) — generated Robo-Run track sets, full 10-minute session benchmark with a report, photo
import from four corners. Phase 0: the simulator runs from the command line with the same results as the website.
Next: Phase 2 (your real C firmware compiled and run inside the simulator).

```
npm run lab -- help
npm run lab -- doctor                                   # check Node, Git, gcc, Claude Code
npm run lab -- run --project my.lfsim.json --seconds 120 --csv run.csv --json run.json
npm run lab -- run --track public/samples/roborun-sample.png --robot my.robot.json
npm run lab -- run --track public/samples/roborun-sample.png --robot lab/examples/rmi-test-rig.robot.json \
  --firmware lab/firmware/examples/rmi-test-rig/main/main.c --wiring lab/firmware/examples/rmi-test-rig/main/wiring.json \
  --presses 4@0.3,4@3.8,4@4.3 --sweep 0.5-3.6 --serial serial.txt
# whole sessions / benchmarks with your C firmware (a design file names the sources, wiring and operator steps)
npm run lab -- bench --set lab/tracksets/rr-2027 --part held --design lab/examples/rmi-native.design.json --limit 6
npm run lab -- run --track photo.png --corners 47.5,37.8,96.6,53.1,73.6,103.3,1.6,69.7 --track-png flat.png

npm run lab -- tracks make --out lab/tracksets/rr-2027        # 300 tuning + 200 held-out variations of the Shaastra maze
npm run lab -- tracks check --set lab/tracksets/rr-2027
npm run lab -- tracks sheet --set lab/tracksets/rr-2027       # review page with samples and statistics
npm run lab -- bench --set lab/tracksets/rr-2027 --robot lab/examples/rmi-test-rig.robot.json --algorithm tremaux
```

A benchmark writes a results folder (default `results/<date>-<design>/`): `report.html` (finish rate with a 95 %
interval, official times, by variation, by track feature, why sessions failed), `progress.html` (open it while the
job runs; it reloads itself), `summary.json`, `benchmark.csv` (one row per session), `runs.csv` (one row per run),
`design.json`, and `projects/*.lfsim.json`: failed runs you can open in the LFSim website to watch.

Track sets and results are not committed (they are regenerated from seeds); see `.gitignore`.

Windows setup: [docs/WINDOWS_SETUP.md](docs/WINDOWS_SETUP.md).

| Folder | Holds |
| --- | --- |
| `src/cli.ts` | Command line (`run`, `tracks make/check/sheet`, `bench`, `doctor`) |
| `competition/roborun-2027.json` | Robo-Run rules as data (sizes, session, penalties; operator timings are estimates) |
| `src/competition.ts` | Loads and checks a competition file; the rulebook's time score |
| `src/tracks.ts` | Generated track → imported like an image → checked against the rules |
| `src/templates.ts` | Variations of a real maze: trace, fit to the mat, rotate / mirror, stretch, easy / normal / hard |
| `src/tracksets.ts`, `trackWorker.ts` | Track sets (PNG + manifest, made on all cores), tuning / held-out split, checkpoints, review sheet |
| `src/stats.ts` | Track statistics (junctions, loops, dead ends, curves) for real and generated tracks |
| `src/session.ts` | A whole 10-minute session: exploration, memory runs, aborts, penalties, official time |
| `src/design.ts` | Design files (robot + settings + switch plan) |
| `src/variations.ts` | Mat variations (clean, uneven light, harsh) |
| `src/bench.ts`, `benchJob.ts`, `benchWorker.ts` | Parallel benchmark on worker threads, summary statistics |
| `src/report.ts` | Results folder, HTML report, live progress page, replay projects |
| `examples/` | Your robot's profile (no firmware) |
| `firmware/shim/` | Stand-in ESP-IDF headers and `shim.c`: hardware calls go to the simulator over a pipe |
| `firmware/examples/` | ESP-IDF projects: your RMI test-rig firmware (unchanged) and a reference firmware in C + its JS translation |
| `src/native.ts` | Builds firmware with GCC (cached), runs it in lock-step through Code mode's hardware model |
| `src/firmwareSpec.ts` | Wiring files, button presses and calibration sweep options |
| `references/` | Reference photos of real mazes (kept local, not committed) |
| `src/inputs.ts` | Reads project / track / robot files (validated like the website) |
| `src/headless.ts` | Runs the website's simulation Engine without a browser |
| `src/image.ts` | PNG decoding in Node |
| `src/doctor.ts` | Setup checks with fixes |

The simulator code is shared with the website (`src/`); the track is built by `src/track/buildTrack.ts` in both. The
maze generator (`src/track/generate.ts`) and the photo flattening (`src/track/warp.ts`) are plain TypeScript in `src/`
so the website can use them too.

## Design files with C firmware

A design can name C firmware instead of Settings-mode values (see `examples/rmi-native.design.json`):

```json
"firmware": {
  "sources": ["../firmware/examples/rmi-test-rig/main/main.c"],
  "wiring": "../firmware/examples/rmi-test-rig/main/wiring.json",
  "defines": ["CONFIG_FREERTOS_HZ=1000"],
  "operator": {
    "first": { "presses": [{ "gpio": 4, "at_s": 0.3 }], "sweep": { "from_s": 0.5, "to_s": 3.6 } },
    "each":  { "presses": [{ "gpio": 4, "at_s": 0.3 }] }
  }
}
```

- Paths are relative to the design file. `first` is what the operator does before the first run, `each` before
  every later run (leave `first` out to use `each` every time).
- Each run is a **reset**: the firmware starts fresh (RAM empty), but **flash (NVS) keeps** what earlier runs saved,
  so a maze robot can store its route with `nvs_set_blob` and read it back on the next run.
- **Switches**: a plan step can set GPIO levels, e.g. `"memory": [{ "name": "fast", "settings": {}, "levels": [{ "gpio": 27, "level": 1 }] }]`.
  The firmware reads them with `gpio_get_level`. Changing switches in the scored part counts as an adjustment (2027).
- The operator moves from the explore setting to the memory settings after the robot has finished once.
- Pins used by the sensors, ADC, driver or encoders can't be used for switches or buttons (checked on load).
