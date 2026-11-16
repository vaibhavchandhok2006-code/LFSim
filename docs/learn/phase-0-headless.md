# Phase 0 — running the simulator without a browser

## What we built

LFSim already ran in the browser. Phase 0 made the same simulator run from a terminal (a "headless" run: no screen),
so thousands of runs can later go overnight with nobody watching:

```
npm run lab -- run --track public/samples/roborun-sample.png --seconds 60 --csv run.csv
npm run lab -- doctor
```

## The ideas behind it

**Node.js** is JavaScript outside the browser. The website's simulator is written in TypeScript (JavaScript with types),
so the same code runs in both places — no second copy that could disagree.

**npm** (Node Package Manager) installs the libraries a project lists in `package.json` (`npm ci`) and runs its named
commands (`"scripts"` in `package.json`: `npm test`, `npm run lab`). `tsx` is one such library: it runs TypeScript
directly.

**One engine, two front ends.** In the website, a Web Worker runs the simulation `Engine` and the page plays the frames
back. On the command line, `lab/src/headless.ts` creates the same `Engine` and advances it in steps. The only thing that
differs is how the track image is decoded (browser canvas vs the `pngjs` library), so the code that turns pixels into a
track was moved into one shared file, `src/track/buildTrack.ts`.

**Determinism.** A simulation is deterministic when the same inputs always give the same outputs. LFSim uses seeded
random numbers (noise, lighting, bumps): the "seed" fixes the whole sequence of random numbers, so a run can be repeated
exactly. That is what lets us prove the command line matches the website.

**How we proved it.** A browser test (`e2e/headless_match.py`) runs the website, downloads its CSV log and project
file, runs the command line on that project, and compares the logs row by row. Settings mode matched on 4,308 rows;
Code mode first differed only in "-0.0000" vs "0.0000" — the last binary digit of a tiny number (a stopped robot's
speed) is computed slightly differently by Chrome and by Node. Printing near-zero values without the sign fixed it.
Lesson: floating-point numbers are not exact; compare them at the precision that matters.

**Tests and CI.** `npm test` runs automatic checks (81 now). CI (continuous integration) means GitHub runs them again on
every change (`.github/workflows/`), so a mistake is caught before the website is updated.

**PATH and execution policy (Windows).** PATH is the list of folders Windows searches when you type a command; the
Claude installer put `claude.exe` in a folder that was not on it, so we added it. PowerShell blocks scripts by default;
`RemoteSigned` allows scripts on your own computer while still blocking unsigned downloaded ones.

## Try it

1. `npm run lab -- run --track public/samples/roborun-sample.png --algorithm right-hand --seconds 60` — compare with
   `--algorithm left-hand`.
2. Change `--seed 1` to `--seed 2` with lighting on in a saved project: the run changes; the same seed always repeats.
3. Open `run.csv` in Excel and plot `line_error_mm` against `time_s`.
