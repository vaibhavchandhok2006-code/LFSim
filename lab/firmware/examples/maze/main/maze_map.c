/* Map storage, flash persistence and route planning (Dijkstra over junction + arrival direction). */
#include "maze_map.h"
#include <math.h>
#include <stdlib.h>
#include <string.h>
#include "nvs.h"
#include "nvs_flash.h"

#define MAGIC 0x4C4D
#define VERSION 3
maze_map_t M;

int norm10(int a) { a %= 3600; return a < 0 ? a + 3600 : a; }
int angle_diff10(int a, int b) { int d = norm10(a - b); return d >= 1800 ? d - 3600 : d; }

void map_reset(void) {
  memset(&M, 0, sizeof M);
  M.magic = MAGIC; M.version = VERSION;
  M.finish_node = 255; M.finish_exit = 255;
  /* node 0 is the start square: one exit, straight ahead (heading 0) */
  M.count = 1;
  M.node[0].n = 1;
  M.node[0].ex[0].dir = 0;
  M.node[0].ex[0].state = EX_NEW;
}

int map_find(double x, double y, double radius_mm) {
  int best = -1; double bd = radius_mm;
  for (int i = 1; i < M.count; i++) {
    double d = hypot(M.node[i].x - x, M.node[i].y - y);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

int map_add_node(double x, double y) {
  if (M.count >= MAX_NODES) return -1;
  node_t *n = &M.node[M.count];
  memset(n, 0, sizeof *n);
  n->x = (int16_t)lround(x); n->y = (int16_t)lround(y);
  return M.count++;
}

int map_exit_near(int n, int dir10, int tol10) {
  int best = -1, bd = tol10 + 1;
  for (int k = 0; k < M.node[n].n; k++) {
    int d = abs(angle_diff10(M.node[n].ex[k].dir, dir10));
    if (d < bd) { bd = d; best = k; }
  }
  return best;
}

int map_add_exit(int n, int dir10) {
  node_t *p = &M.node[n];
  if (p->n >= MAX_EXITS) return -1;
  exit_t *e = &p->ex[p->n];
  memset(e, 0, sizeof *e);
  e->dir = (int16_t)norm10(dir10);
  e->state = EX_NEW;
  return p->n++;
}

void map_link(int a, int ea, int b, int eb, int len_mm) {
  if (len_mm > 65000) len_mm = 65000;
  exit_t *x = &M.node[a].ex[ea], *y = &M.node[b].ex[eb];
  x->state = EX_EDGE; x->to = (uint8_t)b; x->to_exit = (uint8_t)eb; x->len_mm = (uint16_t)len_mm;
  y->state = EX_EDGE; y->to = (uint8_t)a; y->to_exit = (uint8_t)ea; y->len_mm = (uint16_t)len_mm;
}

bool map_has_new(int n) {
  for (int k = 0; k < M.node[n].n; k++) if (M.node[n].ex[k].state == EX_NEW) return true;
  return false;
}

bool map_load(void) {
  nvs_handle_t h;
  if (nvs_open("maze", NVS_READONLY, &h) != ESP_OK) return false;
  size_t len = sizeof M;
  esp_err_t e = nvs_get_blob(h, "map", &M, &len);
  nvs_close(h);
  if (e != ESP_OK || len != sizeof M || M.magic != MAGIC || M.version != VERSION || M.count < 1 || M.count > MAX_NODES) { map_reset(); return false; }
  return true;
}

void map_save(void) {
  nvs_handle_t h;
  if (nvs_open("maze", NVS_READWRITE, &h) != ESP_OK) return;
  nvs_set_blob(h, "map", &M, sizeof M);
  nvs_commit(h);
  nvs_close(h);
}

/* States: (node, exit we arrived by). Cost of leaving by exit k: line length + turn cost if the direction changes. */
#define NSTATE (MAX_NODES * MAX_EXITS)
static float dist[NSTATE];
static int16_t first_exit[NSTATE];
static uint8_t done[NSTATE];

int map_plan(int from, int head10, bool goal_new, double turn_cost_mm, double *cost_mm, int *goal_node) {
  for (int i = 0; i < NSTATE; i++) { dist[i] = INFINITY; done[i] = 0; first_exit[i] = -1; }
  /* The start state: at `from`, heading head10. Expand its exits directly. */
  double best = INFINITY; int best_first = -1, best_node = -1;
  /* goal check at the start node itself */
  #define TURN(h_in, dir_out) (abs(angle_diff10((dir_out), (h_in))) > 300 ? turn_cost_mm : 0.0)
  for (int k = 0; k < M.node[from].n; k++) {
    exit_t *e = &M.node[from].ex[k];
    double c0 = TURN(head10, e->dir);
    if (e->state == EX_NEW && goal_new && c0 < best) { best = c0; best_first = k; best_node = from; }
    if (e->state == EX_FINISH && !goal_new && c0 < best) { best = c0; best_first = k; best_node = from; }
    if (e->state != EX_EDGE || e->to == 0) continue; /* never plan back into the start square */
    int s = e->to * MAX_EXITS + e->to_exit;
    double c = c0 + e->len_mm;
    if (c < dist[s]) { dist[s] = (float)c; first_exit[s] = (int16_t)k; }
  }
  for (;;) {
    int u = -1; float du = INFINITY;
    for (int i = 0; i < NSTATE; i++) if (!done[i] && dist[i] < du) { du = dist[i]; u = i; }
    if (u < 0 || du >= best) break;
    done[u] = 1;
    int n = u / MAX_EXITS, arr = u % MAX_EXITS;
    int h_in = norm10(M.node[n].ex[arr].dir + 1800); /* heading on arrival = opposite of the exit we came in by */
    for (int k = 0; k < M.node[n].n; k++) {
      if (k == arr) continue;
      exit_t *e = &M.node[n].ex[k];
      double c0 = du + TURN(h_in, e->dir);
      if (e->state == EX_NEW && goal_new && c0 < best) { best = c0; best_first = first_exit[u]; best_node = n; }
      if (e->state == EX_FINISH && !goal_new && c0 < best) { best = c0; best_first = first_exit[u]; best_node = n; }
      if (e->state != EX_EDGE || e->to == 0) continue;
      int s = e->to * MAX_EXITS + e->to_exit;
      double c = c0 + e->len_mm;
      if (c < dist[s]) { dist[s] = (float)c; first_exit[s] = first_exit[u]; }
    }
  }
  if (cost_mm) *cost_mm = best;
  if (goal_node) *goal_node = best_node;
  return best_first;
}

void map_costs(int from, int head10, double turn_cost_mm, float *cost, int16_t *first) {
  for (int i = 0; i < NSTATE; i++) { dist[i] = INFINITY; done[i] = 0; first_exit[i] = -1; }
  for (int i = 0; i < M.count; i++) { cost[i] = INFINITY; first[i] = -1; }
  cost[from] = 0;
  for (int k = 0; k < M.node[from].n; k++) {
    exit_t *e = &M.node[from].ex[k];
    if (e->state != EX_EDGE || e->to == 0) continue;
    int s = e->to * MAX_EXITS + e->to_exit;
    double c = TURN(head10, e->dir) + e->len_mm;
    if (c < dist[s]) { dist[s] = (float)c; first_exit[s] = (int16_t)k; }
  }
  for (;;) {
    int u = -1; float du = INFINITY;
    for (int i = 0; i < NSTATE; i++) if (!done[i] && dist[i] < du) { du = dist[i]; u = i; }
    if (u < 0) break;
    done[u] = 1;
    int n = u / MAX_EXITS, arr = u % MAX_EXITS;
    if (du < cost[n]) { cost[n] = du; first[n] = first_exit[u]; }
    int h_in = norm10(M.node[n].ex[arr].dir + 1800);
    for (int k = 0; k < M.node[n].n; k++) {
      if (k == arr) continue;
      exit_t *e = &M.node[n].ex[k];
      if (e->state != EX_EDGE || e->to == 0) continue;
      int s = e->to * MAX_EXITS + e->to_exit;
      double c = du + TURN(h_in, e->dir) + e->len_mm;
      if (c < dist[s]) { dist[s] = (float)c; first_exit[s] = first_exit[u]; }
    }
  }
}
