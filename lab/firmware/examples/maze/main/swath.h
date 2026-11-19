/* Junction reading from the sensor swath (C port of LFSim's src/brain/junctionMap.ts).
 * While the robot drives, every sensor reading is placed at the sensor's position in the robot's odometry frame. At a
 * junction those readings form a small picture of the floor; the lines leaving the junction are read off it, with
 * their angles, without a 360° scan. */
#ifndef MAZE_SWATH_H
#define MAZE_SWATH_H
#include <stdint.h>

#define SW_MAX_EXITS 6

typedef struct {
  int n;                          /* lines leaving (the incoming line excluded), within ±135° of straight on */
  double deg[SW_MAX_EXITS];       /* their directions, degrees relative to the incoming line, + = left */
  double width[SW_MAX_EXITS];     /* angular spread of each line's edge cells, degrees (wide = maybe two lines) */
  double cx, cy;                  /* refined junction centre, mm (odometry frame) */
  double line_dir;                /* direction of the incoming line, rad */
  int cells;                      /* connected dark cells (0 = nothing dark at the centre) */
} swath_reading_t;

void swath_clear(void);
/* x, y: sensor position (mm); dark 0..1000; odo: distance driven (mm); heading (rad) */
void swath_add(double x, double y, int dark, double odo, double heading);
void swath_prune(double odo_now, double keep_mm);
void swath_read(double cx, double cy, double heading, double paint_mm, swath_reading_t *out);
#endif
