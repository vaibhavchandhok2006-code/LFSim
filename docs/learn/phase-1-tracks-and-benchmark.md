# Phase 1 — generated tracks and a full-session benchmark

## What we built

Phase 1 turns the simulator into a test bench. It can make hundreds of Robo-Run mazes, play a robot through a whole
10-minute session on each, and report how often it finishes and how fast.

```
npm run lab -- tracks make --out lab/tracksets/rr-2027          # 300 tuning + 200 held-out mazes
npm run lab -- tracks sheet --set lab/tracksets/rr-2027         # review page: do they look real?
npm run lab -- bench --set lab/tracksets/rr-2027 --robot lab/examples/rmi-test-rig.robot.json --algorithm tremaux
```

Parts:

| Part | File | Idea |
| --- | --- | --- |
| Rules as data | `lab/competition/roborun-2027.json` | The rulebook's numbers in a file the program reads, so another event is a new file, not new code |
| Track generator | `src/track/generate.ts` | Carve a maze on a grid, then draw each piece as a real feature |
| Track checker | `lab/src/tracks.ts` | Prove every maze follows the rules before using it |
| Session simulator | `lab/src/session.ts` | Play 10 minutes the way a team would |
| Benchmark | `lab/src/bench.ts` | Many sessions on all CPU cores, then statistics |
| Photo import | `src/track/warp.ts` | Flatten an angled photo using its four corners |

## The ideas behind it

**Seeds and reproducibility.** Every maze comes from a number (its seed). The same seed always draws the same maze,
pixel for pixel, so a result can always be checked again. A random-number generator is really a long fixed sequence;
the seed picks where in it you start.

**Generating a maze.** Points are laid on a 7 × 7 grid. A *spanning tree* joins them all without loops (a random
depth-first walk: go to an unvisited neighbour, back up when stuck). Then a few extra links add loops, because the
rulebook expects several paths to the finish. Each link is drawn as a feature seen on real Shaastra mazes: zigzag,
arc, S-bend, rectangle, oval, diamond, triangles, dead-end stub, comb; corners may be rounded and junctions drawn as
rings with spokes. A *contact check* then looks for lines that come too close by accident and draws those pieces
plain instead.

**Checking against the rules.** Each maze is imported exactly like a photo would be (the same code), and its
*junction graph* (junctions = nodes, lines between them = edges) is checked: start square in a corner, one pathway
into the finish, everything connected, at least two routes, and the finish not easy for a simple wall follower. A
maze that breaks a rule is replaced by the next seed. While building this, the checker found a real bug in the
junction finder: where thinned lines leave a small blob, it missed the junction. That is fixed for the website too.

**Tuning set vs held-out set.** We tune on 300 mazes and judge on 200 others that never share a seed with them. If
we judged on the same mazes we tuned on, the score would flatter the design. This is called *overfitting*: like
practising only last year's exam paper.

**Simulating a whole session.** The rulebook scores the best run in 10 minutes, not one run. The session simulator
plays it like a team would. The robot explores until it has a route in memory, then does memory runs, moving to a
faster speed switch after each success and back after a failure. Re-entering the start square aborts a run (rulebook).
The operator also aborts a run that is stuck, lost or too slow. Placing and fetching the robot take time (estimates).
Each run gets the rulebook's time score: run time × (1 + off-line ÷ 20) + 2 s per restart.

Finding: the rulebook's own worked example prints 54 s, but its formula gives 56 s. We follow the formula. It is
worth asking the organisers which one they use.

**Statistics with an honest interval.** If 190 of 200 sessions finish, the true rate could still be a bit above or
below 95 %. A *confidence interval* (Wilson's method) gives the range the true rate probably lies in. The target counts
as met only when the bottom of that range is at least 95 %.

**Parallel runs.** Sessions do not depend on each other, so each CPU core runs its own (Node *worker threads*). The
tests check that one core and many cores give exactly the same numbers.

**Making it fast.** A profiler showed most of the time went into one tiny function, the one that reads how dark the mat
is under a sensor. It runs millions of times per session and created a small helper function on every call. Writing
it out directly, with the same arithmetic in the same order, made sessions 2.7× faster with bit-identical results.

**Flattening a photo.** A flat mat photographed at an angle becomes a general four-sided shape. A *homography*, the
3 × 3 transform a camera applies to a plane, maps those four corners back to a square. You mark the corners, and every
pixel of the top-down track is looked up in the photo through that transform.

## Try it

1. Make a small set (`--tune 6 --held 6`) and open `sheet.html` in the set's folder.
2. Benchmark with `--algorithm lsrb` and then with `--algorithm tremaux`, and compare the two `report.html` files.
3. Open one of the `projects/*.lfsim.json` files from a results folder in the LFSim website and watch the failed run.
4. In the website, load a frame from a competition video, press *Mark the mat's corners*, and drag 1–4 onto the mat.

## Update: the 2027 rulebook

The Shaastra 2027 rules changed the problem, and because the rules live in a data file, most of the update was data,
not code:

- **Bigger mat:** 16 × 16 squares of 25 cm = 4 m × 4 m (was 2.5 m). Generated mazes grow from a 7 × 7 to an 11 × 11
  junction lattice; the junction density per square metre stays like the reference maze.
- **New penalties:** 5 s per line crossing (instead of a share of the run time), 2 s per restart, 3 s per adjustment.
  Changing a switch counts as an adjustment, so climbing a speed ladder now costs time. Both worked examples in the
  rulebook (68 s and 108 s) are unit tests.
- **Dry run:** the 10 minutes can start with an unscored dry run. A maze-solving robot explores during it and then
  races from memory in the scored part. How long the dry run should be is a design choice the optimiser will tune.
- **Checkpoints:** a robot that does not finish is ranked by the furthest checkpoint it reached, with
  (time + penalties) ÷ C.
- **Finish position:** on real Shaastra mazes the finish is at the far end of the mat, usually near a bottom corner.
  The generator now does that for 80 % of mazes and keeps some finishes inside the maze for variety.

Lesson: keep rules as data and test them against the rulebook's own examples. When the rulebook changes, the tests
show exactly what moved.
