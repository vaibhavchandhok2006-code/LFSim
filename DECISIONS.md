# Decisions

| Date | Decision | Reason |
| --- | --- | --- |
| 2026-11-14 | Track image processing is our own TypeScript (EDT, thresholding, thinning) instead of OpenCV.js | Same results for the few operations needed; avoids an ~8 MB download; testable in Node |
| 2026-11-14 | Physics steps at 1 kHz with 4 sub-steps (0.25 ms) | Tyre model is stiff; sub-steps keep it stable while the brain and timing stay on the 1 kHz tick |
| 2026-11-14 | Gear motors include a no-load current of 6% of stall current | Real gear motors draw current with no load; the shop's no-load rpm already includes this loss, so back-EMF is fitted to it |
| 2026-11-14 | Driver models: TB6612FNG = 1.0 Ω path, 3.2 A peak; L298N = 1.8 V drop + 0.5 Ω, 2 A | Datasheet typical values |
| 2026-11-14 | Spot diameter estimate = 2 mm + 1.0 × height; contrast halves around 14 mm height | Typical reflective IR sensor optics; labelled as estimate and editable |
| 2026-11-14 | Re-entering the start square after leaving it aborts the run | Robo-Run rule ("run is aborted and reset") |
| 2026-11-14 | Settings-mode brain without encoders gets wheel-rotation odometry | Spec: "assume we know the speed" when the robot has no encoders |
| 2026-11-14 | Junctions in Settings mode use a 360° scan around the axle to list branches by angle | Works for diagonals, acute angles and multi-way junctions; gives exact branch numbers counted from the left for LSRB |
| 2026-11-14 | Simulation runs ahead in a Web Worker and records frames; the UI plays them back | Enables timeline scrub, keeps the UI smooth, and gives Code mode a place to run |
| 2026-11-14 | Recording cap of 10 minutes of simulated time per run | Memory limit for recorded frames; not a rule-based auto-stop. The run is marked "recording limit reached" |
| 2026-11-14 | Code-mode firmware format: async JavaScript (`await` on hardware calls) | Lets `delay()` block the robot's code while physics continues, and lets `while(1)` loops (common in ESP-IDF) run without freezing the browser |
| 2026-11-14 | Start-square re-entry (abort) is judged on the robot's axle centre, not its front edge | A robot spinning at a junction near the start swings its nose over the square; a judge counts the robot driving back in, not a nose overhang |
