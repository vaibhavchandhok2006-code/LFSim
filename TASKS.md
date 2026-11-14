# Tasks

Status: v1 (Phases 1–5) implemented and verified (34 automated tests, browser end-to-end run). Next: real-robot reality check.

## Done (verified)
- [x] Phase 1: robot profile, drawing, track import (Robo-Run/Custom), physics, sensors, Settings PID, run timing,
      off-line judging, autosave, project/robot import-export, GitHub Pages workflow
- [x] M0 Docs: CLAUDE.md, PRD.md, ARCHITECTURE.md, DECISIONS.md, TASKS.md, VALIDATION.md, docs/FIRMWARE_API.md
- [x] M1 Mazes: junction graph + ideal path overlay; graph reference results vs spec targets; sensor-based junction
      detection with 360° scan; left, right, straight-first, custom priority; LSRB with branch numbers + memory run;
      Trémaux mapping + shortest path + memory run; decision log + markers
- [x] M2 Worker and playback: simulation in a Web Worker, frame recording, playback, scrub, step; uPlot graphs
- [x] M3 Compare and outputs: Compare tab with path overlay; CSV, PNG, WebM, GIF, HTML report, `.track.json`; validated imports
- [x] M4 Code mode: firmware hardware API + sandbox, serial console, side-by-side view, sample firmware tests,
      LFSim Claude skill (proposed for saving)
- [x] M5: uneven lighting and mat folds/bumps; dark theme; validation results recorded

## Known gaps (v1)
- [ ] Right-hand rule loops physically on the sample map (graph-level run finishes); see VALIDATION.md
- [ ] Firmware with an infinite loop and no `delay`/`await` is stopped by the 4 s watchdog rather than run
- [ ] Reality check against a real robot's logs (spec: later, via the skill)

## Later versions (not v1)
- v2: track editor, auto-tuning, share links. v3: 3D view.
