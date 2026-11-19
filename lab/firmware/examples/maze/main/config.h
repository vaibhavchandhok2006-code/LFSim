/* LFSim maze firmware: every tunable in one place. Each value can be overridden at build time (-DNAME=value), which is
 * how LFSim Lab's search tries thousands of variants without editing the code. Units are in the names. */
#ifndef MAZE_CONFIG_H
#define MAZE_CONFIG_H

/* ---- robot geometry (RMI test rig; calibrate on the real robot in Phase 3) */
#ifndef WHEEL_D_MM
#define WHEEL_D_MM 43.0          /* wheel diameter */
#endif
#ifndef TRACK_MM
#define TRACK_MM 140.0           /* distance between the wheel contact points */
#endif
#ifndef ENC_CPR
#define ENC_CPR 1050             /* encoder counts per wheel revolution */
#endif
#ifndef ARM_MM
#define ARM_MM 117.0             /* sensor bar ahead of the axle */
#endif
#ifndef SPACING_MM
#define SPACING_MM 15.0          /* between neighbouring sensors */
#endif

/* ---- control loop and line following */
#ifndef LOOP_MS
#define LOOP_MS 2                /* control period (FreeRTOS ticks at 1 kHz) */
#endif
#ifndef SPEED_EXPLORE
#define SPEED_EXPLORE 0.8       /* duty 0..1 on lines while exploring */
#endif
#ifndef SPEED_MEMORY0
#define SPEED_MEMORY0 0.8        /* duty on the memory run, switch level 0..3 */
#endif
#ifndef SPEED_STEP
#define SPEED_STEP 0.1           /* each switch level adds this */
#endif
#ifndef SPEED_JUNCTION
#define SPEED_JUNCTION 0.35       /* duty while crossing a junction and creeping to it */
#endif
#ifndef SPEED_TURN
#define SPEED_TURN 0.5          /* duty of each wheel while spinning in place */
#endif
#ifndef KP
#define KP 0.04                  /* duty per mm of line error */
#endif
#ifndef KD
#define KD 0.0012                /* duty per mm/s of error change */
#endif
#ifndef ACCEL
#define ACCEL 2.0                /* max change of the base duty per second */
#endif

/* ---- reading the line */
#ifndef BLACK_ON
#define BLACK_ON 500             /* calibrated reading (0..1000) above which a sensor sees black */
#endif
#ifndef WIDE_N
#define WIDE_N 6                 /* this many black sensors (or an outer one plus the centre) = something crosses */
#endif
#ifndef FINISH_MM
#define FINISH_MM 90.0           /* all black for this long = the finish square */
#endif
#ifndef DEADEND_MM
#define DEADEND_MM 35.0          /* all white for this long = the line ended */
#endif
#ifndef AHEAD_MM
#define AHEAD_MM 30.0            /* after a crossing, look this far on for a line straight ahead */
#endif

/* ---- junctions */
#ifndef SWATH
#define SWATH 1                  /* 1: read junctions from the swath picture (angles); 0: left/straight/right pattern */
#endif
#ifndef READ_MM
#define READ_MM 80.0             /* read the picture once the bar is this far past the junction */
#endif
#ifndef SCAN_MODE
#define SCAN_MODE 0              /* 0: read branches from the pattern while passing; 1: spin once at each new junction */
#endif
#ifndef SCAN_COMPLEX
#define SCAN_COMPLEX 1           /* 1: look all the way round at a new junction the picture may get wrong */
#endif
#ifndef COMPLEX_WIDTH_DEG
#define COMPLEX_WIDTH_DEG 40.0   /* a line whose edge cells spread wider than this may be two lines */
#endif
#ifndef CAPTURE_DEG
#define CAPTURE_DEG 40.0         /* while turning, a line within this of the target heading is the branch */
#endif
#ifndef ARC_TURNS
#define ARC_TURNS 0              /* 1: turn onto a branch on an arc without stopping (ARC_R_MM); 0: stop and spin */
#endif
#ifndef ARC_R_MM
#define ARC_R_MM 60.0            /* arc radius: the inner wheel turns at (1 - track/2/R) of the outer's speed ratio */
#endif
#ifndef COUNT_DEG
#define COUNT_DEG 70.0           /* ...or the expected line by count, if it is within this of the target */
#endif
#ifndef DEAD_SCAN
#define DEAD_SCAN 2              /* at a line end: 1 drive to it and look around (finds sharp corners); 0 turn back at once */
#endif
#ifndef LOST_SWEEP
#define LOST_SWEEP 1             /* before a dead end: sweep right and left for a line lost on a curve */
#endif
#ifndef KNOWN_ADD
#define KNOWN_ADD 0              /* 1: a known junction may gain a branch seen on a later pass (60° from the known ones) */
#endif

/* ---- map */
#ifndef MATCH_MM
#define MATCH_MM 60.0            /* a junction this close to a known one is the same junction */
#endif
#ifndef EXPECT_MM
#define EXPECT_MM 250.0          /* on a known line, the junction at its end is accepted within this distance */
#endif
#ifndef LEN_TOL_MM
#define LEN_TOL_MM 60.0          /* a known line's junction must come after its length ± this (+15 %) */
#endif
#ifndef RELOC_MM
#define RELOC_MM 150.0           /* a known junction this close with a matching shape is the same junction */
#endif
#ifndef HEAD_FIX_DEG
#define HEAD_FIX_DEG 0.0         /* at a known junction, correct the heading from the arrival line if within this (0 = off) */
#endif
#ifndef HEAD_GAIN_PCT
#define HEAD_GAIN_PCT 70         /* heading correction from junction-to-junction journeys, % of the measured error */
#endif
#ifndef SNAP
#define SNAP 1                   /* 1: straighten the heading to the mat's axes while on a straight line */
#endif
#ifndef SNAP_DEG
#define SNAP_DEG 6.0
#endif
#ifndef START_SEE_MM
#define START_SEE_MM 600.0       /* a large black area within this of where the run began is the start square: turn back */
#endif
#ifndef CORNER_NODES
#define CORNER_NODES 1           /* 1: plain corners (one way on) are junctions on the map; 0: just turn */
#endif
#ifndef START_GUARD_MM
#define START_GUARD_MM 250.0     /* never drive towards the start square inside this distance on an unknown line */
#endif

/* ---- strategy */
#ifndef ORDER
#define ORDER 3                  /* which new branch first: 0 left, 1 right, 2 straight, 3 away from start, 4 random,
                                    5 best untried branch on the whole map (W_FAR), 6 pure left hand, 7 pure right hand,
                                    8 left hand but each line once per direction, then the nearest untried branch,
                                    9 the same with the right hand, 10 away from start here, else the best untried
                                    branch on the map (W_FAR) */
#endif
#ifndef W_FAR
#define W_FAR 1.0                /* ORDER 5: mm of driving worth spending per mm further from the start a branch leads */
#endif
#ifndef SEED
#define SEED 1
#endif
#ifndef FRONTIER
#define FRONTIER 1               /* 1: when a junction has no new branch, go to the nearest one that has; 0: wall rule */
#endif
#ifndef EXPLORE_MORE
#define EXPLORE_MORE 0           /* 1: after the finish is found, explore branches that could give a shorter route */
#endif
#ifndef INFER_MM
#define INFER_MM 0               /* edge inference up to this length (0 = off); see main.c */
#endif
#ifndef INFER_DEG
#define INFER_DEG 10             /* both branches must point at each other within this */
#endif
#ifndef TURN_COST_MM
#define TURN_COST_MM 120.0       /* route planning: a turn costs as much as this much straight line */
#endif

/* ---- pins (wiring.json) */
#define PIN_BUTTON 4
#define PIN_SW0 21               /* speed switch bit 0 */
#define PIN_SW1 2                /* speed switch bit 1 */

#endif
