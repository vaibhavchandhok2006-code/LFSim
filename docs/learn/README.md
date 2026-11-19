# How LFSim is built — a learning log

Short, plain explanations of what we build in each phase and the ideas behind it, written as we go. Read them in
order; each one says what you can try yourself.

| Part | Topic |
| --- | --- |
| [Phase 0 — running the simulator without a browser](phase-0-headless.md) | Node.js, npm, TypeScript, headless runs, determinism, CI, PATH |
| [Phase 1 — generated tracks and a full-session benchmark](phase-1-tracks-and-benchmark.md) | Seeds, maze generation, rule checks, overfitting, sessions, confidence intervals, worker threads, profiling, homography |
| [Phase 2 — your real C firmware inside the simulator](phase-2-firmware-in-the-loop.md) | Cross-compiling, a hardware shim, pipes, lock-step time, button and calibration emulation, FreeRTOS ticks |
| [Phase 5 — solving a maze it has never seen (in progress)](phase-5-maze-algorithm.md) | Junctions from sensor patterns, odometry, a map in flash, staying localised, exploration strategies, search |
