# LFSim — project instructions

Source of truth: `docs/LFSim_Spec_v1.pdf` (spec v1, 14 Nov 2026), then `PRD.md`, then `DECISIONS.md`.

## Commands
- `npm run dev` — dev server
- `npm test` — Vitest (physics, sensors, track import, graph, algorithms, code mode)
- `npm run build` — type-check + production build to `dist/`
- `npm run lab -- run|doctor|help` — LFSim Lab command line (`lab/`); `npm run typecheck:lab` type-checks it
- LFSim Lab spec: https://claude.ai/artifact/7noPMWNsUYry7sCm8jCajX (Phases 0–8); Lab code lives in `lab/` and reuses `src/`
- Deploy: push to `main`; GitHub Actions builds and publishes to GitHub Pages.

## Architecture boundaries (do not break)
- `src/sim/` physics, sensors, simulation loop. No React, no DOM.
- `src/brain/` robot brains. They see the robot ONLY through `BrainIO` / the firmware hardware API.
  Never pass the track, the junction graph or the finish position to a brain.
- `src/track/` image import, darkness map, junction graph. The graph is for overlays, the ideal path and validation only.
- `src/worker/` the simulation worker and the sandboxed firmware worker.
- `src/ui/` React components. Rendering only; no physics.
- Fixed 1 kHz simulation step, SI units internally (m, s, kg, N, rad, V, A). Convert at the UI boundary.
- Seeded randomness (`Rng`) everywhere so runs are reproducible.

## Conventions
- Units in names: `_mm`, `_cm`, `_m`, `_s`, `_Hz`, `_V`.
- Every estimate is labelled as an estimate in the UI and editable.
- No auto-stop: a run ends at the finish (timer), when the brain stops, or on the user's Stop. Recording has a technical cap (see DECISIONS.md).
- No backend, no network calls, no analytics.
- Imported files are untrusted: validate schema version, types, ranges and sizes.

## Documentation (keep current, the repo will be public)
- Every phase or feature updates: `docs/learn/` (a short plain-language page on what was built and the ideas behind it),
  `TASKS.md`, `VALIDATION.md`, `DECISIONS.md`, `HANDOFF.md`, and the relevant README or setup guide.
- `docs/README.md` indexes all documents; `docs/lab/SPEC.md` is the repo copy of the LFSim Lab spec.

## Safety
- Never force-push or rewrite history. Commit focused checkpoints.
- Firmware code runs only in the sandbox worker, never on the main thread.
