# Tasks

Status: Phase 1 done and verified. Working on M1 (maze algorithms).

## Done (verified)
- [x] Phase 1: robot profile, drawing, track import (Robo-Run/Custom), physics, sensors, Settings PID, run timing,
      off-line judging, autosave, project/robot import-export, GitHub Pages workflow

## M0 Docs
- [x] CLAUDE.md, PRD.md, ARCHITECTURE.md, DECISIONS.md, TASKS.md, VALIDATION.md

## M1 Mazes
- [ ] Junction graph extraction (TypeScript) + ideal shortest path overlay
- [ ] Graph-level algorithm reference results vs spec targets
- [ ] Sensor-based junction detection, 360° branch scan, turning, dead ends, finish
- [ ] Left, right, straight-first, custom priority
- [ ] LSRB with branch numbers + memory run
- [ ] Trémaux mapping + shortest path + memory run
- [ ] Decision log + markers

## M2 Worker and playback
- [ ] Simulation in a Web Worker, frame recording, playback, scrub, step
- [ ] uPlot graphs: error, PID, wheel speeds, battery, sensors

## M3 Compare and outputs
- [ ] Compare tab (table + path overlay)
- [ ] CSV, PNG, WebM, GIF, HTML report, `.track.json`; validated imports

## M4 Code mode
- [ ] Firmware hardware API + sandbox, console, side-by-side view
- [ ] Sample firmware tests; Claude skill for translation

## M5 Finish
- [ ] Disturbances; dark theme; validation results; deploy
