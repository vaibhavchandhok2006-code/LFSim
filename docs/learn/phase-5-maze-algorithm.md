# Phase 5 — teaching the robot to solve a maze it has never seen (in progress)

## The goal
Finish at least 95 % of 10-minute Robo-Run sessions on mazes the robot has never seen, with logic that works on any
maze: no turn sequence written for one track. Then make the official time fast.

## What the robot can know
Only what its own hardware tells it: 8 line sensors, two wheel encoders (counts per wheel turn), a clock, a button,
two switches and flash memory. Never the track image or the finish position.

## The ideas

**Junctions from the sensor pattern.** On a plain line 2–3 sensors see black. When more do (or an outer sensor and the
centre), something crosses: the robot notes whether the left or right side saw black, then looks 3 cm further on for a
line straight ahead. The junction is where the middle of that wide patch was.

**The sensor arm problem.** The sensor bar is 117 mm in front of the wheels. To turn onto a branch the robot first
drives on until its axle is over the junction, then spins on the spot until the branch is under the middle of the bar.

**Odometry.** Each encoder count is π × 43 mm / 1050 of wheel travel. Average of both wheels = distance; difference
÷ track width = turn. Adding these up every 2 ms gives the robot's position and heading — dead reckoning. It drifts:
tyres slip and small errors add up.

**A map.** Every junction becomes a node with the directions of its lines; every line driven becomes an edge with
its length. The map is saved to flash at every junction, so the next run continues from it.

**Staying localised (the hard part).** Drift makes the robot's position wrong, so recognising "I have been here
before" needs more than position:
- on a known line, the junction at its far end is expected — but only if the distance driven fits the line's length;
- otherwise a known junction nearby only matches if its shape fits (a line pointing back the way we came, the same
  branches the sensors just saw), and if it could have been reached at all;
- heading is corrected from each junction-to-junction journey: the measured journey should point exactly at the known
  junction; the angle between them is the heading error (works on curves and zigzags too);
- on long straight lines along the mat's axes the heading is pulled onto the axis.

**Not driving into the start square.** The start square is black like the finish. A big black area near where the
run began must be the start: turn back while the axle is still outside (the rule is judged on the axle).

**Exploring.** Several strategies, chosen at build time: left/right-hand wall following, wall following that never
drives the same line twice in the same direction (so it cannot loop forever around a box), "away from the start",
and a whole-map choice. Once the finish is found, memory runs drive the shortest known route (Dijkstra, with a cost
for each turn).

**Searching for the best version.** `npm run lab -- search --space lab/firmware/examples/maze/search.json` builds
many variants (each value in config.h can be set at build time) and tries them on the tuning tracks: all variants on
a few tracks, the best third on more, and so on (successive halving).

## Where it stands (19 Nov 2026)
- Single 590 s exploration runs reach the finish on about 2 of 8 tuning tracks.
- The main problem: in long runs the robot still sometimes matches a junction to the wrong known one, or makes a
  second copy of it; its map then stops matching the maze. Fixing junction identity is the next step.
- The robot is slow (about 0.25 m/s while following): a 4 m maze takes most of a session to explore.

## Try it
```
npx tsx lab/tools/try-maze.ts tune-0001 run "LFSIM_FAST_IO,ORDER=8" /tmp/out
python3 lab/tools/plot_run.py tune-0001 /tmp/out.png /tmp/out --flip     # path in red, the robot's map in circles
python3 lab/tools/junction_matches.py /tmp/out tune-0001                  # how often junctions were matched wrongly
```
