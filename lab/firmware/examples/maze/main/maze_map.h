/* The robot's own map of the maze, built from encoder odometry: junctions (nodes) with the directions of the lines
 * leaving them (exits), and which exit leads where. Kept in flash so the next run continues from it. */
#ifndef MAZE_MAP_H
#define MAZE_MAP_H
#include <stdbool.h>
#include <stdint.h>

#define MAX_NODES 200
#define MAX_EXITS 6
enum { EX_NEW = 0, EX_EDGE = 1, EX_DEAD = 2, EX_FINISH = 3 };

typedef struct __attribute__((packed)) {
  int16_t dir;      /* heading of the line leaving the junction, tenths of a degree, map frame [0, 3600) */
  uint8_t state;    /* EX_NEW untried, EX_EDGE leads to node `to`, EX_DEAD dead end, EX_FINISH leads to the finish */
  uint8_t to;       /* node at the other end (EX_EDGE) */
  uint8_t to_exit;  /* which exit of `to` we arrive by */
  uint16_t len_mm;  /* driven length of the line */
  uint8_t used;     /* times the robot has left the junction by this exit */
} exit_t;

typedef struct __attribute__((packed)) {
  int16_t x, y;     /* mm, map frame: start = origin, x forward at the start, y to the left */
  uint8_t n;        /* number of exits */
  uint8_t visits;
  exit_t ex[MAX_EXITS];
} node_t;

typedef struct __attribute__((packed)) {
  uint16_t magic, version;
  uint8_t count;
  uint8_t finish_node, finish_exit; /* 255 = not found yet */
  uint8_t runs;
  node_t node[MAX_NODES];
} maze_map_t;

extern maze_map_t M;

int angle_diff10(int a, int b);            /* a - b wrapped to [-1800, 1800) tenths of a degree */
int norm10(int a);                         /* wrap to [0, 3600) */
void map_reset(void);
int map_find(double x, double y, double radius_mm);
int map_add_node(double x, double y);
int map_exit_near(int n, int dir10, int tol10);
int map_add_exit(int n, int dir10);
void map_link(int a, int ea, int b, int eb, int len_mm);
bool map_load(void);
void map_save(void);
bool map_has_new(int n);

/* Route planning on the known lines. From node `from`, arriving with heading `head10`, to a goal: a node with an
 * untried exit (goal_new), or the finish exit. Returns the exit to take now (or -1), and the cost in *cost_mm. */
int map_plan(int from, int head10, bool goal_new, double turn_cost_mm, double *cost_mm, int *goal_node);
/* Cost of reaching every junction from `from` (heading head10) over known lines, and the exit to take first. */
void map_costs(int from, int head10, double turn_cost_mm, float *cost, int16_t *first);
#endif
