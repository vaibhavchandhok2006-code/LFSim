# Decisions

| Date | Decision | Reason |
| --- | --- | --- |
| 2026-11-14 | Track image processing is our own TypeScript (EDT, thresholding, thinning) instead of OpenCV.js | Same results for the few operations needed; avoids an ~8 MB download; testable in Node |
| 2026-11-14 | Physics steps at 1 kHz with 4 sub-steps (0.25 ms) | Tyre model is stiff; sub-steps keep it stable while the brain and timing stay on the 1 kHz tick |
| 2026-11-14 | Gear motors include a no-load current of 6% of stall current | Real gear motors draw current with no load; the shop's no-load rpm already includes this loss, so back-EMF is fitted to it |
| 2026-11-14 | Driver models: TB6612FNG = 1.0 Ω path, 3.2 A peak; L298N = 1.8 V drop + 0.5 Ω, 2 A | Datasheet typical values |
| 2026-11-14 | Spot diameter estimate = 2 mm + 1.0 × height; contrast halves around 14 mm height | Typical reflective IR sensor optics; labelled as estimate and editable |
| 2026-11-14 (superseded 2026-11-15) | ~~Re-entering the start square aborts the run~~ — now only logged as an event | Spec: no automatic stop; the user stops the run (test report D20) |
| 2026-11-15 | Settings-mode brain without encoders gets odometry estimated from the commanded duty × no-load wheel speed (60 ms lag), not the true wheel rotation | Spec: "assume we know the speed"; the true rotation was exact odometry the robot could not have (report D6) |
| 2026-11-15 | Junctions in Settings mode are read from a map of what the sensors saw while rolling onto the junction (odometry frame), not a 360° scan | The scan turned onto unconnected lines 85 mm away (report D1) and is not done in competitions (user) |
| 2026-11-14 | Simulation runs ahead in a Web Worker and records frames; the UI plays them back | Enables timeline scrub, keeps the UI smooth, and gives Code mode a place to run |
| 2026-11-14 | Recording cap of 10 minutes of simulated time per run | Memory limit for recorded frames; not a rule-based auto-stop. The run is marked "recording limit reached" |
| 2026-11-14 | Code-mode firmware format: async JavaScript (`await` on hardware calls) | Lets `delay()` block the robot's code while physics continues, and lets `while(1)` loops (common in ESP-IDF) run without freezing the browser |
| 2026-11-14 | Start-square re-entry (abort) is judged on the robot's axle centre, not its front edge | A robot spinning at a junction near the start swings its nose over the square; a judge counts the robot driving back in, not a nose overhang |
| 2026-11-14 | Spec maze targets scaled by 1872/2048 in tests | Spec numbers were measured on the maze span; LFSim maps the full image edge to 2.5 m |
| 2026-11-14 | Trémaux matches revisited junctions by position (15 cm) and branch shape | Odometry drifts; shape stops two nearby junctions being merged |
| 2026-11-14 | Frames are recorded at the brain's loop rate (firmware: 1 kHz) | Keeps CSV and graphs at the robot's own rate without storing every 0.25 ms sub-step |
| 2026-11-14 | Firmware calls cost simulated CPU time (analogRead 10 µs, other calls ~0.5 µs, loop 5 µs); 2026-11-15: board setting, AVR analogRead 112 µs and 10-bit | Loop rate then comes from the code, as on the real board (report D13) |
| 2026-11-15 | "Code saw the finish" = both motors held at zero for 0.5 s after 30 cm **and** within one robot length of the finish; a stop elsewhere is reported as "stopped away from the finish" | Report D4: any stop anywhere used to count |
| 2026-11-14 | Dependencies added: uPlot (graphs), gifenc (GIF export) | Small, maintained, no network use; WebM uses the browser's MediaRecorder |
| 2026-11-14 | Firmware runs in the per-run simulation worker with network and storage globals removed | Spec requires a sandbox; one worker per run keeps runs isolated |
| 2026-11-14 | Code mode: TB6612FNG short-brakes at zero PWM with a direction set (and on IN1 = IN2 = high); L298N brakes on IN1 = IN2 with EN high; STBY low or IN1 = IN2 = low coasts | Datasheet truth tables. Before this, zero duty always coasted, so a firmware that clamps the inside wheel to 0 turned far wider than the real robot |
| 2026-11-15 | Built pages carry a Content-Security-Policy meta tag; the sim worker starts from a blob URL; network/storage globals are removed along the worker's prototype chain | GitHub Pages cannot send headers; the firmware reached `fetch` through `Function` and the prototype chain and could `import()` (report D3) |
| 2026-11-15 | A shortcut judge compares the robot with the junction graph and counts "crossed white to another line" as off-line | Report D1: the judge missed white crossings |
| 2026-11-15 | Physics: each step split to stay inside the wheel/tyre time constant; forces and moments about the centre of mass; gearbox static friction 2.5× running (estimate, editable) | Report D5, D19, D16 |
| 2026-11-15 | Image threshold: 128 for clean images, Otsu's method otherwise; stretch warning and crop box | Report D7, D8; clean images import exactly as before |
| 2026-11-15 | Robot numbers range-checked (`PROFILE_RANGES`) on import and in the Robot tab; runs blocked while out of range | Report D9 |
| 2026-11-15 | PWM frequency kept but labelled: the motor model averages the PWM, so it does not change a run (warning below 1 kHz) | Report D18: an inert field must say so |
| 2026-11-15 | Settings brain may run up to 2 kHz: its schedule is checked every 0.25 ms physics sub-step | Spec allows 2 kHz loops (report D21) |
| 2026-11-15 | LSRB path reduction uses only turn angles measured at each junction, not odometry heading | Heading drift spoiled the reduction on long runs |
| 2026-11-15 | Algorithm tests use a clean generated grid maze (`loadGridMaze`) for exact comparisons with the graph; the Robo-Run sample is used for honesty checks | Exact reference behaviour needs junctions the robot can read unambiguously |
| 2026-11-15 | All-black within 60 cm of the start (odometry) is the start square, not the finish; finish needs 10 cm of all-black (was 7) | Big multi-way junctions are several cm of black; the start square was taken for the finish |
