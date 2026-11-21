# Example: magnetometer-guided maze line follower (Arduino Uno)

| File | What it is |
| --- | --- |
| `line_follower_maze.ino` | the original sketch (Uno, 5 digital IR sensors, L298N, QMC5883L compass, buttons ZERO/LEFT/RIGHT) |
| `line_follower_maze.lfsim.js` | its translation for LFSim Code mode (lines tagged `//@L<n>` with the source line) |
| `make-robot.ts` | builds the robot file: `npx tsx examples/magnetometer-maze/make-robot.ts` |
| `magnetometer-maze.robot.json` | robot + firmware + wiring + operator script; import it on the website's Robot tab |

## Run it
- Website: Robot → Import robot → `magnetometer-maze.robot.json` → Run (4× or 10× speed helps).
- Command line: `npm run lab -- run --track public/samples/roborun-sample.png --robot examples/magnetometer-maze/magnetometer-maze.robot.json --seconds 240`

## What the robot file assumes
- Chassis, wheels and motors: the RMI test rig (200 rpm N20, 43 mm wheels, sensors 117 mm ahead of the axle).
- Estimates: 5-sensor array spacing 18 mm and height 8 mm, mass 265 g, L298N driver model, AVR `digitalRead` ≈ 4 µs.
- Compass: true heading (no noise, offsets or motor interference), X arrow forward, Y arrow left, so `HEADING_SIGN = 1`.
- Operator script: ZERO at 0.5 s (7 s calibration spin), put back on the start at 8 s, RIGHT at 8.5 s (the sample
  track's finish is about 42° to the right of the start direction), ZERO at 9.5 s (go). Edit it in Brain → Code mode.

## Result on the sample track (21 Nov 2026)
It runs as written but does not reach the finish within 240 s. See `docs/learn/compass-buttons-operator.md` for why:
turns stall at `TURN_MIN_PWM = 70`, the 117 mm sensor arm makes the 360° scan sweep a 23 cm circle short of the
junction, corners on a 3.8 cm line look like junctions, and the 200 ms black-patch finish test fires on a wide junction
(about 132 s, away from the finish).
