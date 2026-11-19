/* LFSim maze firmware (ESP-IDF, RMI test rig + wheel encoders).
 *
 * The robot knows nothing about the maze in advance. It follows the line, notices junctions from its sensor pattern,
 * places them on its own map using wheel-encoder odometry, and chooses where to go with a general strategy (try an
 * untried branch; otherwise go to the nearest junction that still has one). The map is saved to flash at every
 * junction, so a run that is stopped (or a later run) carries on from what the robot already knows. Once the finish
 * has been found, memory runs drive the shortest known route.
 *
 * Every tunable is in config.h and can be set at build time; LFSim Lab's search compares thousands of combinations.
 *
 * Operator: first boot — press (calibrate), sweep the bar across the line, press (save), press (go). Later boots:
 * press (go). Speed switches: GPIO 21 / GPIO 2 select memory-run speed level 0..3. */
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "config.h"
#include "hw.h"
#include "maze_map.h"
#include "swath.h"
#include "nvs.h"
#include "nvs_flash.h"

#define PI 3.14159265358979
static const double MM_PER_COUNT = PI * WHEEL_D_MM / ENC_CPR;

/* ------------------------------------------------------------------ calibration */
static struct { uint16_t magic; int16_t lo[NS], hi[NS]; } cal;

static bool cal_load(void) {
  nvs_handle_t h;
  if (nvs_open("maze", NVS_READONLY, &h) != ESP_OK) return false;
  size_t n = sizeof cal;
  esp_err_t e = nvs_get_blob(h, "cal", &cal, &n);
  nvs_close(h);
  return e == ESP_OK && n == sizeof cal && cal.magic == 0xCA1;
}
static void cal_save(void) {
  nvs_handle_t h;
  if (nvs_open("maze", NVS_READWRITE, &h) != ESP_OK) return;
  nvs_set_blob(h, "cal", &cal, sizeof cal);
  nvs_commit(h);
  nvs_close(h);
}
static void wait_press(void) {
  while (!hw_button()) hw_wait_ms(5);
  hw_wait_ms(30);
  while (hw_button()) hw_wait_ms(5);
}
static void calibrate(void) {
  for (int i = 0; i < NS; i++) { cal.lo[i] = 4095; cal.hi[i] = 0; }
  int raw[NS];
  while (!hw_button()) {
    hw_read_raw(raw);
    for (int i = 0; i < NS; i++) { if (raw[i] < cal.lo[i]) cal.lo[i] = (int16_t)raw[i]; if (raw[i] > cal.hi[i]) cal.hi[i] = (int16_t)raw[i]; }
    hw_wait_ms(2);
  }
  while (hw_button()) hw_wait_ms(5);
  cal.magic = 0xCA1;
  for (int i = 0; i < NS; i++) if (cal.hi[i] - cal.lo[i] < 200) { cal.lo[i] = 300; cal.hi[i] = 2600; } /* sweep missed it: defaults */
  cal_save();
  printf("calibrated\n");
}

/* ------------------------------------------------------------------ state of the robot */
static double X, Y, TH;          /* pose: mm, mm, rad (map frame) */
static double ODO;               /* distance driven along the path, mm */
static int32_t encL0, encR0;
static int c[NS];                /* calibrated readings 0..1000 */
static bool b[NS];               /* black? */
static int nb;                   /* black count */
static double line_mm;           /* line position, + = left of centre */
static bool line_ok;
static double base_duty;
static double last_err;
static int64_t last_us;
static uint32_t rng = SEED * 2654435761u + 1;
static double t_spin, t_creep, t_scan, t_follow, t_dead; /* time budget, s (diagnostics) */
static int n_turns, n_straight;

static int th10(void) { return norm10((int)lround(TH * 1800.0 / PI)); }
static void bar(double *sx, double *sy) { *sx = X + ARM_MM * cos(TH); *sy = Y + ARM_MM * sin(TH); }
static bool centre(void) { return b[3] || b[4]; }

static void sense(void) {
  int raw[NS];
  hw_read_raw(raw);
  int sum = 0; double w = 0;
  nb = 0;
  for (int i = 0; i < NS; i++) {
    int span = cal.hi[i] - cal.lo[i];
    int v = span > 0 ? (raw[i] - cal.lo[i]) * 1000 / span : 0;
    c[i] = v < 0 ? 0 : (v > 1000 ? 1000 : v);
    b[i] = c[i] > BLACK_ON;
    if (b[i]) nb++;
    sum += c[i];
    w += c[i] * (3.5 - i) * SPACING_MM;
  }
  line_ok = sum > 300;
  line_mm = line_ok ? w / sum : 0;
}

static void odometry(void) {
  int32_t l, r;
  hw_encoders(&l, &r);
  double dl = (l - encL0) * MM_PER_COUNT, dr = (r - encR0) * MM_PER_COUNT;
  encL0 = l; encR0 = r;
  double ds = (dl + dr) / 2, dth = (dr - dl) / TRACK_MM;
  X += ds * cos(TH + dth / 2);
  Y += ds * sin(TH + dth / 2);
  TH += dth;
  ODO += fabs(ds);
}

static double dt_s(void) {
  int64_t now = hw_us();
  double dt = (now - last_us) / 1e6;
  last_us = now;
  return dt > 0 && dt < 0.1 ? dt : LOOP_MS / 1000.0;
}

static void ramp(double target, double dt) {
  double step = ACCEL * dt;
  if (base_duty < target - step) base_duty += step;
  else if (base_duty > target + step) base_duty -= step;
  else base_duty = target;
}

/* Follow the line with PD; with no usable line, hold the heading th_ref. */
static void steer(double speed, double dt, bool use_line, double th_ref) {
  ramp(speed, dt);
  double corr;
  if (use_line && line_ok) {
    double err = line_mm;
    double d = (err - last_err) / dt;
    last_err = err;
    corr = KP * err + KD * d;
  } else {
    double e = remainder(th_ref - TH, 2 * PI);
    corr = 1.5 * e;  /* duty per rad */
    last_err = line_ok ? line_mm : 0;
  }
  double l = base_duty - corr, r = base_duty + corr;
  if (l > 1) l = 1;
  if (r > 1) r = 1;
  hw_motors(l, r);
}

/* Heading snap: most lines run along the mat's axes (right angles survive any stretching of the layout; diagonals do
 * not stay at 45°). After a long straight close to an axis, pull the heading onto it. */
static double snap_odo = 0, snap_th = 0;
static void snap_heading(void) {
#if SNAP
  if (!line_ok || nb > 3 || fabs(line_mm) > 6) { snap_odo = ODO; snap_th = TH; return; }
  if (fabs(remainder(TH - snap_th, 2 * PI)) > 3 * PI / 180) { snap_odo = ODO; snap_th = TH; return; }
  if (ODO - snap_odo < 150) return;
  double step = PI / 2, k = round(TH / step), target = k * step;
  if (fabs(TH - target) < SNAP_DEG * PI / 180) TH += 0.02 * (target - TH);
#endif
}

/* ------------------------------------------------------------------ crossings seen by the sensor bar */
typedef struct { double jx, jy, odo_end; int left, right, straight; int ne; double rel[SW_MAX_EXITS]; double ldir; bool complex; } crossing_t;
#define QN 4
static crossing_t q[QN];
static int qn;
static int det;                  /* 0 idle, 1 in a crossing, 2 looking ahead */
static double in_odo, in_sx, in_sy, white_odo, black_odo;
static int in_l, in_r;
static bool all_black_run;

enum { EV_NONE, EV_FINISH, EV_LINE_END, EV_START };

static void det_reset(void) { det = 0; qn = 0; white_odo = ODO; black_odo = ODO; all_black_run = false; }

/* Called every loop while driving forward. Queues crossings; returns EV_FINISH or EV_LINE_END. */
static int detect(void) {
  bool wide = nb >= WIDE_N || ((b[0] || b[NS - 1]) && centre() && nb >= 3);
  if (nb == 0) { if (white_odo < 0) white_odo = ODO; } else white_odo = -1;
  if (nb == NS) { if (!all_black_run) { all_black_run = true; black_odo = ODO; } } else all_black_run = false;
  if (all_black_run && hypot(X, Y) < START_SEE_MM && ODO - black_odo >= 25) return EV_START; /* the start square: the axle is still outside */
  if (all_black_run && ODO - black_odo >= FINISH_MM) return EV_FINISH;
  double sx, sy;
  bar(&sx, &sy);
  switch (det) {
    case 0:
      if (wide) { det = 1; in_odo = ODO; in_sx = sx; in_sy = sy; in_l = in_r = 0; }
      else if (white_odo >= 0 && ODO - white_odo >= DEADEND_MM) return EV_LINE_END;
      break;
    case 1:
      if (b[0] || b[1]) in_l = 1;
      if (b[NS - 1] || b[NS - 2]) in_r = 1;
      if (!wide || ODO - in_odo > 140) {
        if (qn < QN) {
          crossing_t *k = &q[qn++];
          k->jx = (in_sx + sx) / 2; k->jy = (in_sy + sy) / 2; k->odo_end = ODO;
          k->left = in_l; k->right = in_r; k->straight = -1; k->ne = -1; k->ldir = TH; k->complex = false;
        }
        det = 2;
      }
      break;
    case 2:
      if (wide) { if (qn) q[qn - 1].straight = 1; det = 1; in_odo = ODO; in_sx = sx; in_sy = sy; in_l = in_r = 0; break; }
      if (qn && ODO - q[qn - 1].odo_end >= AHEAD_MM) {
        q[qn - 1].straight = centre() || b[2] || b[5]; det = 0;
#if !SWATH
        crossing_t *k = &q[qn - 1]; k->ne = 0;
        if (k->left) k->rel[k->ne++] = 90;
        if (k->straight) k->rel[k->ne++] = 0;
        if (k->right) k->rel[k->ne++] = -90;
#endif
      }
      break;
  }
  return EV_NONE;
}

/* ------------------------------------------------------------------ the swath (junction pictures) */
static double swath_odo = -1;
static void swath_feed(void) {
#if SWATH
  if (swath_odo >= 0 && ODO - swath_odo < 1.0) return;
  swath_odo = ODO;
  double fx = cos(TH), fy = sin(TH);
  for (int i = 0; i < NS; i++) {
    double lat = (3.5 - i) * SPACING_MM;
    swath_add(X + ARM_MM * fx - lat * fy, Y + ARM_MM * fy + lat * fx, c[i], ODO, TH);
  }
  swath_prune(ODO, 450);
#endif
}
/* Read queued crossings once the bar is READ_MM past them. A crossing with nothing dark at its centre was not one. */
static void swath_resolve(bool force) {
#if SWATH
  double sx, sy;
  bar(&sx, &sy);
  for (int i = 0; i < qn; i++) {
    crossing_t *k = &q[i];
    if (k->ne >= 0) continue;
    double past = (sx - k->jx) * cos(TH) + (sy - k->jy) * sin(TH);
    if (past < READ_MM && !(force && past > 15)) continue;
    swath_reading_t r;
    swath_read(k->jx, k->jy, k->ldir, SPACING_MM / 2, &r);
    if (r.cells < 20) { printf("S t=%.2f nothing at %.0f,%.0f (cells %d, samples ok)\n", hw_us() / 1e6, k->jx, k->jy, r.cells); for (int j = i + 1; j < qn; j++) q[j - 1] = q[j]; qn--; i--; continue; }
    k->jx = r.cx; k->jy = r.cy; k->ldir = r.line_dir; k->ne = 0;
    /* the bar is past the junction now: if it sees no line, nothing goes straight on (the edge of the picture may
     * still be inside the junction's own black patch) */
    bool line_now = nb >= 1 && (b[2] || b[3] || b[4] || b[5]);
    for (int j = 0; j < r.n; j++) if (line_now || fabs(r.deg[j]) >= 30) k->rel[k->ne++] = r.deg[j];
    k->straight = 0;
    for (int j = 0; j < k->ne; j++) if (fabs(k->rel[j]) < 30) k->straight = 1;
    /* a junction the picture may get wrong: many lines, lines close together, or one line wide enough to be two */
    k->complex = k->ne >= 3;
    for (int j = 0; j < r.n; j++) if (r.width[j] > COMPLEX_WIDTH_DEG) k->complex = true;
    for (int j = 0; j + 1 < k->ne; j++) if (fabs(k->rel[j] - k->rel[j + 1]) < 65) k->complex = true;
    printf("S t=%.2f read %d:", hw_us() / 1e6, k->ne);
    for (int j = 0; j < k->ne; j++) printf(" %.0f", k->rel[j]);
    printf("\n");
  }
#endif
}

/* Before calling it a dead end: was the line only lost on a curve? Sweep right up to 100°, then left through straight
 * on to 150°; a line found there continues the one we were on. Returns true (and leaves the bar on it) if found. */
static bool line_lost_on_curve(void) {
#if LOST_SWEEP
  double start = TH;
  int64_t t0 = hw_us();
  for (int side = -1; side <= 1; side += 2) {
    double limit = side < 0 ? 100 : 150;
    bool was = centre(), left_first = !was;
    for (;;) {
      odometry(); sense(); dt_s();
      hw_motors(-side * SPEED_TURN, side * SPEED_TURN);
      double turned = (TH - start) * side;
      bool now = centre();
      if (!now) left_first = true;
      if (now && !was && left_first && turned > 15 * PI / 180 * (side < 0 ? 1 : 0)) {
        double rel = remainder(TH - start, 2 * PI) * 180 / PI;
        if (fabs(rel) < 150) { hw_motors(0, 0); t_spin += (hw_us() - t0) / 1e6; swath_clear(); swath_odo = -1; printf("line was lost on a curve (%.0f deg)\n", rel); return true; }
      }
      was = now;
      if (turned > limit * PI / 180) break;
      hw_wait_ms(LOOP_MS);
    }
  }
  hw_motors(0, 0);
  t_spin += (hw_us() - t0) / 1e6; swath_clear(); swath_odo = -1;
#endif
  return false;
}

/* ------------------------------------------------------------------ turning on the spot */
/* Spin (dir +1 = left, CCW) until the branch towards target10 is under the centre sensors: the `skip`-th line after
 * leaving the current one if it lies within COUNT_DEG of the target, or any line within CAPTURE_DEG of the target.
 * Returns the heading (tenths of a degree) where it was found, or -1 if no line was found in a full turn. */
static int spin_to_(int target10, int dir, int skip);
static int spin_to(int target10, int dir, int skip) { int64_t t0 = hw_us(); int r = spin_to_(target10, dir, skip); t_spin += (hw_us() - t0) / 1e6; n_turns++; swath_clear(); swath_odo = -1; return r; }
static int spin_to_(int target10, int dir, int skip) {
  double start = TH;
  bool was = centre(), left_first = !was;
  int seen = 0;
  base_duty = 0;
  for (;;) {
    odometry(); sense(); dt_s();
    hw_motors(-dir * SPEED_TURN, dir * SPEED_TURN);
    double turned = fabs(TH - start);
    bool now = centre();
    if (!now) left_first = true;
    if (now && !was && left_first && turned > 25 * PI / 180) {
      int h = th10(), d = abs(angle_diff10(h, target10));
      if ((seen == skip && d <= COUNT_DEG * 10) || d <= CAPTURE_DEG * 10) {
        /* the bar has reached the edge of the line: keep turning until the line is under the middle of the bar */
        double t0 = TH;
        while (fabs(TH - t0) < 30 * PI / 180) {
          odometry(); sense(); dt_s();
          if (line_ok && nb <= 4 && dir * line_mm <= 0) break;
          hw_motors(-dir * SPEED_TURN, dir * SPEED_TURN);
          hw_wait_ms(LOOP_MS);
        }
        hw_motors(0, 0);
        return th10();
      }
      seen++;
    }
    was = now;
    if (turned > 2 * PI + 0.5) { hw_motors(0, 0); return -1; }
    hw_wait_ms(LOOP_MS);
  }
}

/* A full turn on the spot, recording the heading of every line under the centre sensors. */
static int scan_(int out10[MAX_EXITS]);
static int scan(int out10[MAX_EXITS]) { int64_t t0 = hw_us(); int r = scan_(out10); t_scan += (hw_us() - t0) / 1e6; swath_clear(); swath_odo = -1; return r; }
static int scan_(int out10[MAX_EXITS]) {
  double start = TH;
  bool was = centre();
  int n = 0; double seg_start = 0; bool in_seg = false;
  base_duty = 0;
  for (;;) {
    odometry(); sense(); dt_s();
    hw_motors(-SPEED_TURN, SPEED_TURN);
    bool now = centre();
    if (now && !was) { in_seg = true; seg_start = TH; }
    if (!now && was && in_seg) {
      int mid = norm10((int)lround((seg_start + TH) / 2 * 1800 / PI));
      if (n < MAX_EXITS) out10[n++] = mid;
      in_seg = false;
    }
    was = now;
    if (TH - start > 2 * PI + 20 * PI / 180) break;
    hw_wait_ms(LOOP_MS);
  }
  hw_motors(0, 0);
  int m = 0; /* merge duplicates (the line under the bar at the start is seen again at the end) */
  for (int i = 0; i < n; i++) {
    bool dup = false;
    for (int j = 0; j < m; j++) if (abs(angle_diff10(out10[i], out10[j])) < 200) dup = true;
    if (!dup) out10[m++] = out10[i];
  }
  return m;
}

/* ------------------------------------------------------------------ the run */
static int cur_node = 0, cur_exit = 0;     /* where we left from */
static double depart_odo = 0;
static bool on_dead = false;               /* travelling back from a dead end along cur_exit */
static double dead_len = 0;                /* how far the dead end was from the junction, mm */
static double g_ahead = 0;                 /* the junction being located is this far ahead of the axle */
static bool mode_route = false;            /* memory run: drive the shortest known route */
static double speed_line;

static int rel10(int dir10) { return angle_diff10(dir10, th10()); }

/* The order in which untried branches are tried (higher = earlier). */
static double preference(int node, int dir10) {
  int r = rel10(dir10);
  switch (ORDER) {
    case 0: return r;                                   /* leftmost first */
    case 1: return -r;                                  /* rightmost first */
    case 2: return -abs(r) * 2 + (r > 0 ? 1 : 0);       /* straight, then left */
    case 3: case 10: {                                  /* away from the start */
      double a = dir10 * PI / 1800, nx = M.node[node].x, ny = M.node[node].y, d = hypot(nx, ny);
      if (d < 1) return r;
      return (cos(a) * nx + sin(a) * ny) / d * 1000 + r * 0.01;
    }
    default: rng = rng * 1103515245u + 12345u; return (double)((rng >> 8) & 0xffff);
  }
}

/* Lines of this junction met before the target when turning in direction dir (excluding the one under the bar). */
static int lines_before(int node, int target, int dir) {
  int tt = norm10(dir * rel10(M.node[node].ex[target].dir)), count = 0;
  for (int k = 0; k < M.node[node].n; k++) {
    if (k == target) continue;
    int r = norm10(dir * rel10(M.node[node].ex[k].dir));
    if (r > 250 && r < tt) count++;
  }
  return count;
}

/* ORDER 5: value every untried branch on the map: how far from the start it leads (where the finish likely is) less
 * the driving needed to reach it. Returns the exit to take now, or -1 if there is no untried branch. */
static float g_cost[MAX_NODES];
static int16_t g_first[MAX_NODES];
static int choose_global(int n) {
  map_costs(n, th10(), TURN_COST_MM, g_cost, g_first);
  double best = -1e18; int bk = -1;
  for (int i = 1; i < M.count; i++) {
    if (!isfinite(g_cost[i])) continue;
    node_t *p = &M.node[i];
    for (int k = 0; k < p->n; k++) {
      if (p->ex[k].state != EX_NEW) continue;
      double a = p->ex[k].dir * PI / 1800, ex = p->x + 250 * cos(a), ey = p->y + 250 * sin(a);
      double head = i == n ? 0 : 1;
      double v = W_FAR * hypot(ex, ey) - g_cost[i] - (i == n ? TURN_COST_MM * (abs(rel10(p->ex[k].dir)) > 300) : 0) - head;
      if (v > best) { best = v; bk = i == n ? k : g_first[i]; }
    }
  }
  return bk;
}

static int choose(int n) {
  node_t *p = &M.node[n];
  if (mode_route) {
    double cost; int goal;
    int k = map_plan(n, th10(), false, TURN_COST_MM, &cost, &goal);
    if (k >= 0) return k;
  }
#if ORDER == 5
  { int k = choose_global(n); if (k >= 0) return k; }
#endif
#if ORDER == 8 || ORDER == 9
  /* wall following that cannot loop: the first line on that side not yet driven out of this junction */
  {
    int best = -1; double bp = -1e18;
    for (int k = 0; k < p->n; k++) {
      exit_t *e = &p->ex[k];
      if ((e->state == EX_EDGE && e->to == 0) || e->state == EX_DEAD || e->used) continue;
      if (e->state == EX_EDGE && M.node[e->to].ex[e->to_exit].used && !map_has_new(e->to)) continue; /* driven both ways */
      int r = rel10(e->dir);
      double v = abs(r) > 1500 ? -1e9 : (ORDER == 8 ? r : -r);
      if (v > bp) { bp = v; best = k; }
    }
    if (best >= 0) return best;
    double cost; int goal;
    int k = map_plan(n, th10(), true, TURN_COST_MM, &cost, &goal);
    if (k >= 0) return k;
  }
#endif
#if ORDER == 6 || ORDER == 7
  /* pure wall following (6 left hand, 7 right hand): the first line on that side, explored or not; never into the
   * start square or a known dead end; back only when nothing else */
  {
    int best = -1; double bp = -1e18;
    for (int k = 0; k < p->n; k++) {
      exit_t *e = &p->ex[k];
      if ((e->state == EX_EDGE && e->to == 0) || e->state == EX_DEAD) continue;
      int r = rel10(e->dir);
      double v = abs(r) > 1500 ? -1e9 : (ORDER == 6 ? r : -r);
      if (v > bp) { bp = v; best = k; }
    }
    if (best >= 0) return best;
  }
#endif
  int best = -1; double bp = -1e18;
  for (int k = 0; k < p->n; k++) {
    if (p->ex[k].state != EX_NEW) continue;
    double v = preference(n, p->ex[k].dir);
    if (v > bp) { bp = v; best = k; }
  }
  if (best >= 0) return best;
#if ORDER == 10
  /* no untried branch here: go to the best one elsewhere (far from the start, not too far to drive) */
  { int k = choose_global(n); if (k >= 0) return k; }
#endif
#if FRONTIER
  {
    double cost; int goal;
    int k = map_plan(n, th10(), true, TURN_COST_MM, &cost, &goal);
    if (k >= 0) return k;
    k = map_plan(n, th10(), false, TURN_COST_MM, &cost, &goal);
    if (k >= 0) return k;
  }
#endif
  /* wall rule: leftmost line that does not lead into the start square; back only if nothing else */
  best = -1; bp = -1e18;
  for (int k = 0; k < p->n; k++) {
    exit_t *e = &p->ex[k];
    if ((e->state == EX_EDGE && e->to == 0) || e->state == EX_DEAD) continue;
    int r = rel10(e->dir);
    double v = abs(r) > 1500 ? -1e9 : r;
    if (v > bp) { bp = v; best = k; }
  }
  if (best >= 0) return best;
  /* nothing allowed: never stop in the maze — take any line that is not the start square, else turn back */
  for (int k = 0; k < p->n; k++) if (!(p->ex[k].state == EX_EDGE && p->ex[k].to == 0) && abs(rel10(p->ex[k].dir)) <= 1500) return k;
  for (int k = 0; k < p->n; k++) if (!(p->ex[k].state == EX_EDGE && p->ex[k].to == 0)) return k;
  return -1;
}

/* Which known junction is this? On a line we know, the one at its other end. On a new line, a known junction only if
 * it has an untried branch pointing back the way we came (closing a loop), or if it is very close. -1 = a new one. */
static int locate(double jx, double jy, int h, const int *obs, int nobs) {
  int expect = -1;
  if (cur_node >= 0 && cur_exit >= 0 && cur_exit < M.node[cur_node].n) {
    exit_t *e = &M.node[cur_node].ex[cur_exit];
    if (on_dead) expect = cur_node;
    else if (e->state == EX_EDGE && e->to != 0) expect = e->to;
  }
  if (expect >= 0 && hypot(M.node[expect].x - jx, M.node[expect].y - jy) < EXPECT_MM) {
    /* the distance driven must fit the known length of the line, or this is some other junction */
    double driven = ODO + g_ahead - depart_odo;
    double want = on_dead ? dead_len : M.node[cur_node].ex[cur_exit].len_mm;
    if (fabs(driven - want) < LEN_TOL_MM + 0.15 * want) return expect;
    printf("not the expected junction: drove %.0f mm, line is %.0f mm\n", driven, want);
  }
  /* by place and shape: a known junction nearby with a line back towards us and the branches the bar just saw */
  int back = norm10(h + 1800), best = -1;
  double bs = 1e18, driven = ODO + g_ahead - depart_odo;
  for (int i = 1; i < M.count; i++) {
    double d = hypot(M.node[i].x - jx, M.node[i].y - jy);
    if (d >= RELOC_MM) continue;
    /* we cannot have reached it yet: back at the junction just left needs a loop; any other needs at least the
     * straight-line distance */
    if (!on_dead && cur_node > 0) {
      double need = i == cur_node ? 300 : hypot(M.node[i].x - M.node[cur_node].x, M.node[i].y - M.node[cur_node].y) - 60;
      if (driven < need) continue;
    }
    int a = map_exit_near(i, back, 450);
    if (a < 0) continue;
    double score = d;
    if (M.node[i].ex[a].state == EX_NEW) score -= 40;           /* closing a loop through an untried branch */
    if (nobs >= 0) {
      /* shape: every line seen should be a known exit, and every known exit (except back) should have been seen */
      for (int j = 0; j < nobs; j++) if (map_exit_near(i, obs[j], 350) < 0) score += 60;
      for (int e = 0; e < M.node[i].n; e++) {
        if (e == a) continue;
        int seen = 0;
        for (int j = 0; j < nobs; j++) if (abs(angle_diff10(M.node[i].ex[e].dir, obs[j])) < 350) seen = 1;
        if (!seen) score += 60;
      }
    }
    if (score < bs) { bs = score; best = i; }
  }
  if (best >= 0 && bs < RELOC_MM) return best;
  int f = map_find(jx, jy, MATCH_MM);
  if (f >= 0 && f == cur_node && !on_dead && driven < 300) f = -1;
  return f;
}

/* A junction at (jx, jy), `ahead_mm` in front of the axle: update the map and choose the way on. Returns the node and
 * sets *k to the exit to take (-1: no way on). The pose is corrected if the junction is already known. */
static int junction_update(double jx, double jy, double ahead_mm, const crossing_t *cr, bool scanned, const int *dirs, int ndirs, int *k) {
  int h = th10();
  int obs[SW_MAX_EXITS], nobs = -1;
  if (cr && cr->ne >= 0) {
    int hl = norm10((int)lround(cr->ldir * 1800 / PI));
    nobs = 0;
    for (int j = 0; j < cr->ne; j++) obs[nobs++] = norm10(hl + (int)lround(cr->rel[j] * 10));
  }
  g_ahead = ahead_mm;
  int n = locate(jx, jy, h, obs, nobs);
  bool fresh = n < 0;
  if (fresh) { n = map_add_node(jx, jy); if (n < 0) { n = map_find(jx, jy, 1e9); fresh = false; } } /* map full: the nearest */
  else {
    /* Back at a known junction. Heading: the journey measured from the junction we left should point exactly at
     * this one; the angle between the two is the heading error (any line shape). Then correct the position. */
#if HEAD_GAIN_PCT > 0
    if (cur_node > 0 && cur_node != n && !on_dead) {
      double mx = M.node[n].x - M.node[cur_node].x, my = M.node[n].y - M.node[cur_node].y;
      double ox = jx - M.node[cur_node].x, oy = jy - M.node[cur_node].y;
      if (hypot(mx, my) > 150 && hypot(ox, oy) > 150) {
        double err = atan2(mx * oy - my * ox, mx * ox + my * oy); /* measured minus map */
        if (fabs(err) < 25 * PI / 180) {
          double c = -err * HEAD_GAIN_PCT / 100.0;
          TH += c;
          /* the bar's view of the junction was also rotated: rotate the measured point about the departure node */
          double rx = M.node[cur_node].x + ox * cos(c) - oy * sin(c), ry = M.node[cur_node].y + ox * sin(c) + oy * cos(c);
          X += rx - jx; Y += ry - jy; jx = rx; jy = ry;
          h = th10();
        }
      }
    }
#endif
    X += M.node[n].x - jx; Y += M.node[n].y - jy;
    int a = map_exit_near(n, norm10(h + 1800), 450);
    if (a >= 0) {
      int want = norm10(M.node[n].ex[a].dir + 1800), d = angle_diff10(want, h);
      if (abs(d) < HEAD_FIX_DEG * 10) { TH += d * PI / 1800; h = th10(); }
    }
  }
  node_t *p = &M.node[n];
  p->visits++;
  int back = norm10(h + 1800);
  int arr = map_exit_near(n, back, 450);
  if (arr < 0) arr = map_add_exit(n, back);
  if (scanned && fresh) {
    for (int i = 0; i < ndirs; i++) if (abs(angle_diff10(dirs[i], back)) > 300 && map_exit_near(n, dirs[i], 300) < 0) map_add_exit(n, dirs[i]);
  } else if (nobs >= 0 && (fresh || (KNOWN_ADD && p->n < 5))) {
    /* the lines seen leaving; on a known junction only clearly new ones are added */
    int tol = fresh ? 300 : 500;
    for (int i = 0; i < nobs; i++) if (map_exit_near(n, obs[i], tol) < 0) map_add_exit(n, obs[i]);
  }
  if (on_dead) on_dead = false;
  else if (cur_node >= 0 && cur_exit >= 0 && arr >= 0) {
    exit_t *from = &M.node[cur_node].ex[cur_exit];
    if (from->state == EX_NEW || from->state == EX_EDGE) map_link(cur_node, cur_exit, n, arr, (int)(ODO + ahead_mm - depart_odo));
  }
#if INFER_MM > 0
  /* edge inference: an untried branch pointing straight at a known junction nearby, which has an untried branch
   * pointing straight back, is that line — note it without driving it (saves exploring box sides and ladders) */
  for (int e = 0; e < M.node[n].n; e++) {
    if (M.node[n].ex[e].state != EX_NEW) continue;
    for (int m = 1; m < M.count; m++) {
      if (m == n) continue;
      double dx = M.node[m].x - M.node[n].x, dy = M.node[m].y - M.node[n].y, d = hypot(dx, dy);
      if (d > INFER_MM || d < 60) continue;
      int to10 = norm10((int)lround(atan2(dy, dx) * 1800 / PI));
      if (abs(angle_diff10(M.node[n].ex[e].dir, to10)) > INFER_DEG * 10) continue;
      int b = map_exit_near(m, norm10(to10 + 1800), INFER_DEG * 10);
      if (b < 0 || M.node[m].ex[b].state != EX_NEW) continue;
      map_link(n, e, m, b, (int)d);
      printf("inferred %d-%d (%.0f mm)\n", n, m, d);
      break;
    }
  }
#endif
  map_save();
  *k = choose(n);
  if (*k >= 0 && p->ex[*k].used < 255) p->ex[*k].used++;
  printf("J t=%.2f n=%d %s at %d,%d h=%d exits=%d -> %d pose=%.0f,%.0f,%.1f ahead=%.0f\n", hw_us() / 1e6, n, fresh ? "new" : "known", p->x, p->y, h / 10, p->n, *k, X, Y, TH * 180 / PI, ahead_mm);
  return n;
}

/* Arc turn (ARC_TURNS): inner wheel slow, outer fast, at junction speed; done when the line is under the middle of the
 * bar near the wanted heading. Returns false if it turned 60° past the target without finding the line. */
static bool arc_turn(int target10, int dir) {
  double v = SPEED_JUNCTION, k = (TRACK_MM / 2) / ARC_R_MM;
  double outer = v * (1 + k), inner = v * (1 - k);
  if (outer > 1) { inner *= 1 / outer; outer = 1; }
  int64_t t0 = hw_us();
  double start = TH;
  bool left_line = !centre();
  for (;;) {
    odometry(); sense(); dt_s();
    if (dir > 0) hw_motors(inner, outer); else hw_motors(outer, inner);
    double turned = fabs(TH - start);
    int d = abs(angle_diff10(th10(), target10));
    if (!centre()) left_line = true;
    if (left_line && turned > 20 * PI / 180 && d <= CAPTURE_DEG * 10 && line_ok && nb <= 4 && dir * line_mm <= 0) break;
    if (angle_diff10(th10(), target10) * dir > 600) { t_spin += (hw_us() - t0) / 1e6; swath_clear(); swath_odo = -1; return false; }
    hw_wait_ms(LOOP_MS);
  }
  t_spin += (hw_us() - t0) / 1e6; n_turns++;
  swath_clear(); swath_odo = -1;
  return true;
}

/* A turn found no line: look all the way round and take the line nearest the wanted heading. */
static void recover(int want10) {
  int dirs[MAX_EXITS];
  int m = scan(dirs), best = -1, bd = 99999;
  for (int i = 0; i < m; i++) { int d = abs(angle_diff10(dirs[i], want10)); if (d < bd) { bd = d; best = i; } }
  printf("recover: %d lines, nearest %d deg off\n", m, bd / 10);
  if (best >= 0) { int r = angle_diff10(dirs[best], th10()); spin_to(dirs[best], r >= 0 ? 1 : -1, 0); }
}

/* Turn on the spot onto exit k of node n (the axle is over the junction). */
static int depth = 0;
static void turn_onto(int n, int k) {
  node_t *p = &M.node[n];
  int r = rel10(p->ex[k].dir);
  if (abs(r) <= 300) return;
  int dir = r > 0 ? 1 : -1;
  if (abs(r) > 1500) dir = 1; /* turning back: always to the left */
  int got = spin_to(p->ex[k].dir, dir, lines_before(n, k, dir));
  if (got >= 0) { if (p->ex[k].state == EX_NEW) p->ex[k].dir = (int16_t)got; return; }
  /* No line at the sensor bar in that direction: the branch ends within the sensor arm's reach (a short stub). It is
   * a dead end — note it and choose again from where we stand. */
  if (p->ex[k].state == EX_NEW) { p->ex[k].state = EX_DEAD; map_save(); }
  printf("stub: branch %d of junction %d ends within reach, choosing again\n", k, n);
  if (++depth > 3) { recover(p->ex[k].dir); depth--; return; }
  int k2 = choose(n);
  if (k2 >= 0 && k2 != k) { cur_exit = k2; if (p->ex[k2].used < 255) p->ex[k2].used++; turn_onto(n, k2); }
  else recover(p->ex[k].dir);
  depth--;
}

static void stop_forever(const char *why) {
  hw_motors(0, 0);
  printf("stop: %s\n", why);
  for (;;) hw_wait_ms(100);
}

static void mark_dead_here(void) {
  if (cur_node >= 0 && cur_exit >= 0 && !on_dead) {
    exit_t *e = &M.node[cur_node].ex[cur_exit];
    if (e->state == EX_NEW) { e->state = EX_DEAD; map_save(); }
  }
}

void app_main(void) {
  nvs_flash_init();
  hw_init();
  hw_motors(0, 0);
  if (!cal_load()) { wait_press(); calibrate(); }
  if (!map_load()) map_reset();
  M.runs++;
  mode_route = M.finish_node != 255;
#if EXPLORE_MORE
  if (mode_route && hw_switches() == 0) {
    for (int i = 1; i < M.count && mode_route; i++) if (map_has_new(i)) mode_route = false;
  }
#endif
  speed_line = mode_route ? SPEED_MEMORY0 + hw_switches() * SPEED_STEP : SPEED_EXPLORE;
  printf("run %d: %s, %d junctions known, speed %.2f\n", M.runs, mode_route ? "route" : "explore", M.count - 1, speed_line);
  map_save();
  wait_press();

  hw_encoders(&encL0, &encR0);
  X = Y = TH = ODO = 0;
  last_us = hw_us();
  cur_node = 0; cur_exit = 0; depart_odo = 0;

  /* leave the start square: straight on until a normal line is under the bar */
  double ok_since = -1;
  for (;;) {
    odometry(); sense();
    steer(SPEED_JUNCTION, dt_s(), false, 0);
    if (nb >= 1 && nb <= 3) { if (ok_since < 0) ok_since = ODO; } else ok_since = -1;
    if (ok_since >= 0 && ODO - ok_since > 20) break;
    if (ODO > 600) stop_forever("no line out of the start square");
    hw_wait_ms(LOOP_MS);
  }
  det_reset();

  /* turn_pending: a junction ahead where we will turn; creep until the axle is over it */
  bool turn_pending = false;
  int pend_n = -1, pend_k = -1;
  double pend_x = 0, pend_y = 0;
  double th_hold = TH;
  for (;;) {
    odometry(); sense();
    double dt = dt_s();
    int ev = detect();
    swath_feed();
    swath_resolve(false);
    if (ev == EV_FINISH) {
      if (cur_node >= 0 && cur_exit >= 0 && !on_dead) {
        M.node[cur_node].ex[cur_exit].state = EX_FINISH;
        M.finish_node = (uint8_t)cur_node; M.finish_exit = (uint8_t)cur_exit;
        map_save();
      }
      double until = ODO + 60; /* roll fully into the square, then stop */
      while (ODO < until) { odometry(); sense(); steer(SPEED_JUNCTION, dt_s(), false, TH); hw_wait_ms(LOOP_MS); }
      stop_forever("finish");
    }
    if (ev == EV_START) {
      printf("start square ahead: turning back\n");
      hw_motors(0, 0);
      mark_dead_here();
      on_dead = true; turn_pending = false; qn = 0;
      spin_to(norm10(th10() + 1800), 1, 0);
      det_reset(); th_hold = TH; continue;
    }
    /* never drive back towards the start square on a line we do not know */
    if (hypot(X, Y) < START_GUARD_MM && cur_node != 0 && ODO - depart_odo > 50 && !turn_pending) {
      double to0 = atan2(-Y, -X);
      if (fabs(remainder(to0 - TH, 2 * PI)) < 35 * PI / 180) {
        printf("guard: start square ahead, turning back\n");
        mark_dead_here();
        on_dead = true;
        spin_to(norm10(th10() + 1800), 1, 0);
        det_reset(); th_hold = TH; continue;
      }
    }
    if (turn_pending) {
      t_creep += dt;
      double ahead = (pend_x - X) * cos(TH) + (pend_y - Y) * sin(TH);
#if ARC_TURNS
      /* turn on an arc of radius ARC_R_MM without stopping: start R·tan(θ/2) before the junction, so the sensors land on
       * the new line as the turn ends (a spin on the spot is the case R = 0) */
      {
        int want = pend_n >= 0 ? M.node[pend_n].ex[pend_k].dir : pend_k, r10 = angle_diff10(want, th10());
        double th = abs(r10) * PI / 1800;
        if (th > 30 * PI / 180 && th < 140 * PI / 180 && ahead <= ARC_R_MM * tan(th / 2)) {
          int dir = r10 > 0 ? 1 : -1;
          if (arc_turn(want, dir)) {
            turn_pending = false;
            if (pend_n >= 0) { if (M.node[pend_n].ex[pend_k].state == EX_NEW) M.node[pend_n].ex[pend_k].dir = (int16_t)th10(); depart_odo = ODO; }
            last_err = 0; det_reset(); th_hold = TH;
            hw_wait_ms(LOOP_MS);
            continue;
          }
          ahead = 0; /* the arc found nothing: finish with a spin on the spot below */
        }
      }
#endif
      steer(SPEED_JUNCTION, dt, det == 0 && nb >= 1 && nb <= 3, th_hold);
      if (ahead <= 0) {
        turn_pending = false;
        if (pend_n >= 0) { turn_onto(pend_n, pend_k); depart_odo = ODO; }
        else if (spin_to(pend_k, angle_diff10(pend_k, th10()) > 0 ? 1 : -1, 0) < 0) recover(pend_k); /* a corner */
        last_err = 0;
        det_reset(); th_hold = TH;
      }
      hw_wait_ms(LOOP_MS);
      continue;
    }
    if (ev == EV_LINE_END && qn > 0) {
      /* the line ended just after a junction (a corner or a T): read it now rather than treat it as a dead end */
      swath_resolve(true);
      if (qn > 0 && q[0].ne >= 0) { if (q[0].straight < 0) q[0].straight = 0; ev = EV_NONE; }
    }
    if (ev == EV_LINE_END) {
      double ex = X + ARM_MM * cos(TH), ey = Y + ARM_MM * sin(TH);
#if DEAD_SCAN == 2 && SWATH
      {
        /* read the floor picture where the line ended: no line leaving there = a dead end, turn back at once */
        double back = DEADEND_MM, wx = ex - back * cos(TH), wy = ey - back * sin(TH);
        swath_reading_t rd;
        swath_read(wx, wy, TH, SPACING_MM / 2, &rd);
        if (rd.n > 0) {
          /* a sharp corner: queue it as a junction and let the normal junction code turn there */
          crossing_t *k = &q[0];
          qn = 1; k->jx = rd.cx; k->jy = rd.cy; k->ldir = rd.line_dir; k->ne = 0; k->straight = 0; k->left = k->right = 0; k->odo_end = ODO;
          for (int j = 0; j < rd.n; j++) k->rel[k->ne++] = rd.deg[j];
          printf("S t=%.2f line end is a corner: %d lines\n", hw_us() / 1e6, rd.n);
          det = 0; white_odo = -1;
          hw_wait_ms(LOOP_MS);
          continue;
        }
      }
#endif
#if DEAD_SCAN == 1
      /* drive the axle to where the line ended and look around: a sharp corner continues, a dead end does not */
      double h0 = TH;
      while ((ex - X) * cos(TH) + (ey - Y) * sin(TH) > 0) { odometry(); sense(); steer(SPEED_JUNCTION, dt_s(), false, h0); hw_wait_ms(LOOP_MS); }
      hw_motors(0, 0);
      int dirs[MAX_EXITS];
      int m = scan(dirs);
      int back = norm10(th10() + 1800), others = 0;
      for (int i = 0; i < m; i++) if (abs(angle_diff10(dirs[i], back)) > 400) others++;
      if (others > 0) {
        int k, n = junction_update(X, Y, 0, NULL, true, dirs, m, &k);
        if (n < 0 || k < 0) { printf("no way on: turning back\n"); spin_to(norm10(th10() + 1800), 1, 0); depart_odo = ODO; det_reset(); th_hold = TH; continue; }
        cur_node = n; cur_exit = k;
        turn_onto(n, k);
        depart_odo = ODO; last_err = 0;
        det_reset(); th_hold = TH;
        continue;
      }
#endif
      if (line_lost_on_curve()) { det_reset(); th_hold = TH; last_err = 0; continue; }
      mark_dead_here();
      printf("dead end t=%.2f at %.0f,%.0f\n", hw_us() / 1e6, ex, ey);
      dead_len = ODO - depart_odo;
      on_dead = true;
      { int want = norm10(th10() + 1800); if (spin_to(want, 1, 0) < 0) recover(want); }
      depart_odo = ODO;
      det_reset(); th_hold = TH;
      if (cur_node > 0) {
        /* A short dead end: after turning back, the sensor bar may already be past the junction we came from, so it
         * will not be seen again. Decide there now from the map, then drive the axle onto it. */
        double jx = M.node[cur_node].x, jy = M.node[cur_node].y;
        double ahead = (jx - X) * cos(TH) + (jy - Y) * sin(TH);
        if (ahead > -20 && ahead < ARM_MM - 30 && hypot(jx - X, jy - Y) < ARM_MM) {
          int k, n = junction_update(jx, jy, ahead, NULL, false, NULL, 0, &k);
          if (n >= 0 && k >= 0) {
            cur_node = n; cur_exit = k; depart_odo = ODO + ahead;
            if (abs(rel10(M.node[n].ex[k].dir)) > 300) {
              turn_pending = true; pend_n = n; pend_k = k;
              pend_x = X + ahead * cos(TH); pend_y = Y + ahead * sin(TH);
            }
            qn = 0;
          }
        }
      }
      continue;
    }
    if (qn > 0 && q[0].straight >= 0 && q[0].ne >= 0) {
      /* a junction ahead is fully seen: decide now, before reaching it */
      crossing_t c0 = q[0];
      for (int i = 1; i < qn; i++) q[i - 1] = q[i];
      qn--;
      double ahead = (c0.jx - X) * cos(TH) + (c0.jy - Y) * sin(TH);
      int k, n;
#if SCAN_MODE || SCAN_COMPLEX
      if ((SCAN_MODE || c0.complex) && map_find(c0.jx, c0.jy, RELOC_MM) < 0) {
        /* a new junction: go to it and look around */
        double h0 = TH;
        while ((c0.jx - X) * cos(TH) + (c0.jy - Y) * sin(TH) > 0) { odometry(); sense(); steer(SPEED_JUNCTION, dt_s(), false, h0); hw_wait_ms(LOOP_MS); }
        hw_motors(0, 0);
        int dirs[MAX_EXITS];
        int m = scan(dirs);
        n = junction_update(c0.jx, c0.jy, 0, NULL, true, dirs, m, &k);
        if (n < 0 || k < 0) { printf("no way on: turning back\n"); spin_to(norm10(th10() + 1800), 1, 0); depart_odo = ODO; det_reset(); th_hold = TH; continue; }
        cur_node = n; cur_exit = k;
        turn_onto(n, k);
        depart_odo = ODO; last_err = 0;
        det_reset(); th_hold = TH;
        hw_wait_ms(LOOP_MS);
        continue;
      }
#endif
#if !CORNER_NODES
      if (c0.ne == 1 && fabs(c0.rel[0]) >= 30) {
        /* a plain corner: one way on. Turn there without a map entry; the line continues to the next junction */
        turn_pending = true; pend_n = -1; pend_k = norm10((int)lround(c0.ldir * 1800 / PI + c0.rel[0] * 10));
        pend_x = X + ahead * cos(TH); pend_y = Y + ahead * sin(TH);
        th_hold = TH; qn = 0;
        printf("C t=%.2f corner %.0f\n", hw_us() / 1e6, c0.rel[0]);
        steer(SPEED_JUNCTION, dt, false, th_hold);
        hw_wait_ms(LOOP_MS);
        continue;
      }
#endif
      double cx = c0.jx, cy = c0.jy;
      n = junction_update(cx, cy, ahead, &c0, false, NULL, 0, &k);
      if (n < 0 || k < 0) { printf("no way on: turning back\n"); spin_to(norm10(th10() + 1800), 1, 0); depart_odo = ODO; det_reset(); th_hold = TH; continue; }
      cur_node = n; cur_exit = k;
      depart_odo = ODO + ahead;
      if (abs(rel10(M.node[n].ex[k].dir)) > 300) {
        /* turning: creep to the junction (its corrected position), then spin */
        turn_pending = true; pend_n = n; pend_k = k;
        pend_x = X + ahead * cos(TH); pend_y = Y + ahead * sin(TH);
        th_hold = TH;
        qn = 0; /* what the bar saw beyond this junction is on the line we leave */
      }
    }
    t_follow += dt;
    { static int64_t last_rep = 0; if (hw_us() - last_rep > 30000000) { last_rep = hw_us();
      printf("T follow %.0f creep %.0f spin %.0f (%d) scan %.0f odo %.1f m\n", t_follow, t_creep, t_spin, n_turns, t_scan, ODO / 1000); } }
    bool use_line = det == 0 && nb <= 4;
    steer(det == 0 ? speed_line : SPEED_JUNCTION, dt, use_line, det == 0 ? TH : th_hold);
    if (det == 0) th_hold = TH;
    snap_heading();
    hw_wait_ms(LOOP_MS);
  }
}
