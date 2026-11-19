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

## Where it stands (19 Nov 2026, evening)
- **Junction pictures (swath).** Junctions are now read from a small picture of the floor built from every sensor
  reading (a C port of the website's method): lines leaving with their angles, the junction centre refined.
- **Search.** Two searches over 48 variants: the best finishes 61 % of single 590 s runs on tuning tracks.
- **Held-out sessions (the real test):** 10 of 24 finished (42 %), with no dry run. Nearly every failure ran out of
  time: the robot drives about 0.28 m/s and needs 250–550 s to find the finish on a 4 m maze.
- **Faster motors alone do not help:** the same firmware with 2× motors and its own search finished 42 % of single
  runs (control at speed needs work first) — input for the electronics agent.
- **Tried and kept off:** arc turns (worse as written), edge inference (no clear gain). Both are options in config.h.

## Update (19 Nov, night): finding junction mistakes automatically
A left-hand wall follower that handled every junction correctly would reach the finish in about 30 m. So the robot is
run as a pure left-hand follower and `lab/tools/lh_divergence.ts` finds the first junction where its path differs
from the ideal one. Each difference is a junction-handling bug. Fixed this way so far: short stubs (shorter than the
sensor arm), 5-way junctions (look all round), short dead ends (decide from the map), lines lost on curves (sweep),
a last-resort match that ignored the junction's shape. The robot now follows the ideal route through about 25 of
~50 junctions before its first mistake. With ~50 junctions per maze, reliability must reach ~99.9 % per junction.
The robot file now uses 200 rpm motors (the listing); held-out sessions: 10/24, quicker finishes.

## Every known algorithm, tested (19 Nov)
From the literature on line mazes and unknown-maze exploration: random mouse, wall followers, LSRB (Vannoy; arXiv
1410.4145), Trémaux / Tarry, the encoder map + Dijkstra method (arXiv 1410.4145; also how a Shaastra 2017 winner
describes theirs: explore, then the shortest path), breadth-first, Pledge, and micromouse-style flood fill / A*
towards an assumed goal. All are in the firmware (`ORDER` in config.h) and were run on the same tracks.
**Best: the map explorer with a finish-corner tie-break** (untried lines first, and among them the one pointing most
towards the finish corner; the side is set with a switch): 45 % of 60 single runs, against 38 % for the next best.
Pure wall following and LSRB fail here: one misread junction traps them in a loop. Pledge and A* towards the corner
are pulled into regions the real route leaves first.

## What would close the gap
1. Explore with less driving: the robot drives ~2× the maze's line length (revisits to reach untried branches).
2. Faster turns that still land on the right line (arc turns, fixed).
3. Faster hardware with control redesigned for speed (Phase 6 + Phase 4).
4. Run the algorithm agent (`npm run lab -- agent`) on a laptop with more cores, many rounds.

## Try it
```
npx tsx lab/tools/try-maze.ts tune-0001 run "LFSIM_FAST_IO,ORDER=8" /tmp/out
python3 lab/tools/plot_run.py tune-0001 /tmp/out.png /tmp/out --flip     # path in red, the robot's map in circles
python3 lab/tools/junction_matches.py /tmp/out tune-0001                  # how often junctions were matched wrongly
```
