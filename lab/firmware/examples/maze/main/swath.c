/* Junction reading from the sensor swath — C port of LFSim src/brain/junctionMap.ts (same steps, mm units).
 * Memory: about 40 KB of static RAM (ESP32 has 320 KB). */
#include "swath.h"
#include <math.h>
#include <string.h>

#define PI 3.14159265358979
#define CELL 4.0                  /* mm */
#define HALF 120.0                /* mm, map half-size around the junction centre */
#define N 61                      /* (2 * HALF / CELL) + 1 */
#define NN (N * N)
#define MAXS 3072                 /* samples kept (8 per mm of travel at most) */

static float sx_[MAXS], sy_[MAXS], so_[MAXS], sh_[MAXS];
static uint8_t sd_[MAXS];
static int head = 0, count = 0;   /* ring buffer: newest at head - 1 */

void swath_clear(void) { head = 0; count = 0; }
void swath_add(double x, double y, int dark, double odo, double heading) {
  sx_[head] = (float)x; sy_[head] = (float)y; so_[head] = (float)odo; sh_[head] = (float)heading;
  sd_[head] = (uint8_t)(dark < 0 ? 0 : dark > 1000 ? 250 : dark / 4);
  head = (head + 1) % MAXS;
  if (count < MAXS) count++;
}
void swath_prune(double odo_now, double keep_mm) {
  while (count > 0) {
    int oldest = (head - count + MAXS) % MAXS;
    if (so_[oldest] >= odo_now - keep_mm) break;
    count--;
  }
}

static float sum[NN], map[NN];
static uint16_t cnt[NN];
static uint8_t conn[NN], conn2[NN], frontier[NN];
static int16_t comp_of[NN], stack_[NN];

static double wrap_r(double r) { return atan2(sin(r), cos(r)); }

void swath_read(double cx, double cy, double heading, double paint_mm, swath_reading_t *out) {
  memset(out, 0, sizeof *out);
  out->cx = cx; out->cy = cy; out->line_dir = heading;
  /* 1. paint: each reading covers the strip across the travel between it and its neighbours; cells average */
  memset(sum, 0, sizeof sum); memset(cnt, 0, sizeof cnt);
  for (int j = 0; j < count; j++) {
    int i = (head - count + j + MAXS) % MAXS;
    double px = sx_[i] - cx + HALF, py = sy_[i] - cy + HALF;
    if (px < -paint_mm - 10 || py < -paint_mm - 10 || px > 2 * HALF + paint_mm + 10 || py > 2 * HALF + paint_mm + 10) continue;
    double d = sd_[i] / 250.0, hx = cos(sh_[i]), hy = sin(sh_[i]), nx = -hy, ny = hx;
    for (double a = 0; a <= 2.01; a += CELL / 2) {
      for (double t = -paint_mm; t <= paint_mm + 1e-9; t += CELL / 2) {
        int gx = (int)lround((px + t * nx + a * hx) / CELL), gy = (int)lround((py + t * ny + a * hy) / CELL);
        if (gx < 0 || gy < 0 || gx >= N || gy >= N) continue;
        int k = gy * N + gx;
        sum[k] += (float)d; if (cnt[k] < 65535) cnt[k]++;
      }
    }
  }
  for (int k = 0; k < NN; k++) map[k] = cnt[k] ? sum[k] / cnt[k] : -1.0f;
  /* 2. flood fill the dark region connected to the centre (from the nearest dark cell within 3 cm) */
  int c0 = (int)lround(HALF / CELL), seed = -1, best = 1 << 30, sr = (int)lround(30 / CELL);
  for (int dy = -sr; dy <= sr; dy++) for (int dx = -sr; dx <= sr; dx++) {
    int k = (c0 + dy) * N + (c0 + dx), d2 = dx * dx + dy * dy;
    if (map[k] > 0.5f && d2 < best) { best = d2; seed = k; }
  }
  memset(conn, 0, sizeof conn);
  int cells = 0;
  if (seed >= 0) {
    int sp = 0; stack_[sp++] = (int16_t)seed; conn[seed] = 1;
    while (sp) {
      int k = stack_[--sp]; cells++;
      int x = k % N, y = k / N;
      for (int dy = -1; dy <= 1; dy++) for (int dx = -1; dx <= 1; dx++) {
        int xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= N || yy >= N) continue;
        int kk = yy * N + xx;
        if (!conn[kk] && map[kk] > 0.5f) { conn[kk] = 1; stack_[sp++] = (int16_t)kk; }
      }
    }
  }
  out->cells = cells;
  if (!cells) return;
  /* 3. refine the centre: sideways onto the incoming line's axis (seen 2.5–6 cm behind), along onto the side branches */
  double hc = cos(heading), hs = sin(heading), lat_sum = 0, al_sum = 0;
  int lat_n = 0, al_n = 0;
  for (int k = 0; k < NN; k++) {
    if (!conn[k]) continue;
    double x = (k % N - c0) * CELL, y = (k / N - c0) * CELL, al = x * hc + y * hs, la = -x * hs + y * hc;
    if (al <= -25 && al >= -60 && fabs(la) < 40) { lat_sum += la; lat_n++; }
  }
  double lat_off = lat_n > 10 ? lat_sum / lat_n : 0;
  for (int k = 0; k < NN; k++) {
    if (!conn[k]) continue;
    double x = (k % N - c0) * CELL, y = (k / N - c0) * CELL, al = x * hc + y * hs, la = -x * hs + y * hc - lat_off;
    if (fabs(la) > 28 && fabs(la) < 45 && fabs(al) < 40) { al_sum += al; al_n++; }
  }
  double al_off = al_n > 6 ? fmax(-15, fmin(15, al_sum / al_n)) : 0;
  double fx = c0 + (al_off * hc - lat_off * hs) / CELL, fy = c0 + (al_off * hs + lat_off * hc) / CELL;
  out->cx = cx + (fx - c0) * CELL; out->cy = cy + (fy - c0) * CELL;
  /* the incoming line's direction: principal axis of the line 2.5–9 cm behind (trusted within 35° of the heading) */
  double mx = 0, my = 0; int mn = 0;
  for (int k = 0; k < NN; k++) {
    if (!conn[k]) continue;
    double x = (k % N - fx) * CELL, y = (k / N - fy) * CELL, al = x * hc + y * hs, la = -x * hs + y * hc;
    if (al <= -25 && al >= -90 && fabs(la) < 35) { mx += x; my += y; mn++; }
  }
  double line_dir = heading;
  if (mn >= 15) {
    mx /= mn; my /= mn;
    double sxx = 0, syy = 0, sxy = 0;
    for (int k = 0; k < NN; k++) {
      if (!conn[k]) continue;
      double x = (k % N - fx) * CELL, y = (k / N - fy) * CELL, al = x * hc + y * hs, la = -x * hs + y * hc;
      if (!(al <= -25 && al >= -90 && fabs(la) < 35)) continue;
      double dx = x - mx, dy = y - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
    }
    double a = 0.5 * atan2(2 * sxy, sxx - syy);
    if (cos(a - heading) < 0) a += PI;
    if (fabs(wrap_r(a - heading)) < 35 * PI / 180) line_dir = a;
  }
  out->line_dir = line_dir;
  double lc = cos(line_dir), ls = sin(line_dir);
  /* 4. leave out the incoming line behind the junction: branches must connect to the centre without going along it */
  memset(conn2, 0, sizeof conn2);
  {
    int ki = (int)lround(fy) * N + (int)lround(fx), start = (ki >= 0 && ki < NN && conn[ki]) ? ki : -1;
    if (start < 0) {
      double bd = 1e18;
      for (int k = 0; k < NN; k++) if (conn[k]) { double d2 = (k % N - fx) * (k % N - fx) + (k / N - fy) * (k / N - fy); if (d2 < bd) { bd = d2; start = k; } }
    }
    double lo = 1e9, hi = -1e9;
    for (int k = 0; k < NN; k++) {
      if (!conn[k]) continue;
      double x = (k % N - fx) * CELL, y = (k / N - fy) * CELL, al = x * lc + y * ls, la = -x * ls + y * lc;
      if (al > -25 || al < -60 || fabs(la) > 60) continue;
      if (la < lo) lo = la;
      if (la > hi) hi = la;
    }
    if (lo > hi) { lo = -28; hi = 28; }
    int lo_open = 0, hi_open = 0;
    for (int s = 0; s < 3; s++) {
      double al = -30 - 10 * s;
      for (int side = 0; side < 2; side++) {
        double la = side ? hi + 2 * CELL : lo - 2 * CELL;
        int gx = (int)lround(fx + (al * lc - la * ls) / CELL), gy = (int)lround(fy + (al * ls + la * lc) / CELL);
        int seen = gx >= 0 && gy >= 0 && gx < N && gy < N && map[gy * N + gx] >= 0;
        if (!seen) { if (side) hi_open = 1; else lo_open = 1; }
      }
    }
    double c_lo = lo_open ? -60 : fmax(-45, lo - 8), c_hi = hi_open ? 60 : fmin(45, hi + 8);
    if (start >= 0) {
      int sp = 0; stack_[sp++] = (int16_t)start; conn2[start] = 1;
      while (sp) {
        int k = stack_[--sp], x = k % N, y = k / N;
        for (int dy = -1; dy <= 1; dy++) for (int dx = -1; dx <= 1; dx++) {
          int xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= N || yy >= N) continue;
          int kk = yy * N + xx;
          if (conn2[kk] || !conn[kk]) continue;
          double gx = (xx - fx) * CELL, gy = (yy - fy) * CELL, la = -gx * ls + gy * lc, al = gx * lc + gy * ls;
          int blocked = al < -55 || (al < -22 && la > fmin(-22, c_lo) && la < fmax(22, c_hi));
          if (!blocked) { conn2[kk] = 1; stack_[sp++] = (int16_t)kk; }
        }
      }
    }
  }
  /* 5. branches leave through the edge of the seen area: connected dark cells whose outward neighbour is unseen */
  memset(frontier, 0, sizeof frontier);
  for (int k = 0; k < NN; k++) {
    if (!conn2[k]) continue;
    int x = k % N, y = k / N;
    double vx = x - fx, vy = y - fy, L = hypot(vx, vy);
    if (L < 1e-6) continue;
    for (int step = 1; step <= 2; step++) {
      int xx = (int)lround(x + vx / L * step), yy = (int)lround(y + vy / L * step);
      if (xx < 0 || yy < 0 || xx >= N || yy >= N || map[yy * N + xx] < 0) { frontier[k] = 1; break; }
      if (map[yy * N + xx] <= 0.5f) break; /* white outward: the line ends here */
    }
  }
  /* group edge cells (gaps of two cells allowed) and take each group's direction */
  const double MIN_DIST = 30;
  for (int k = 0; k < NN; k++) comp_of[k] = -1;
  int ncomp = 0;
  for (int k0 = 0; k0 < NN; k0++) {
    if (!frontier[k0] || comp_of[k0] >= 0) continue;
    if (hypot((k0 % N - fx) * CELL, (k0 / N - fy) * CELL) < MIN_DIST) continue;
    int qh = 0, qt = 0; stack_[qt++] = (int16_t)k0; comp_of[k0] = (int16_t)ncomp;
    double csx = 0, csy = 0; int ncell = 0;
    while (qh < qt) {
      int k = stack_[qh++], x = k % N, y = k / N;
      csx += (x - fx) * CELL; csy += (y - fy) * CELL; ncell++;
      for (int dy = -3; dy <= 3; dy++) for (int dx = -3; dx <= 3; dx++) {
        int xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= N || yy >= N) continue;
        int kk = yy * N + xx;
        if (!frontier[kk] || comp_of[kk] >= 0) continue;
        if (hypot((xx - fx) * CELL, (yy - fy) * CELL) < MIN_DIST) continue;
        comp_of[kk] = (int16_t)ncomp; stack_[qt++] = (int16_t)kk;
      }
    }
    int id = ncomp++;
    if (ncell < 2) continue;
    csx /= ncell; csy /= ncell;
    double c_ang = atan2(csy, csx), amin = 1e9, amax = -1e9;
    for (int k = 0; k < NN; k++) {
      if (comp_of[k] != id) continue;
      double d = wrap_r(atan2((k / N - fy) * CELL, (k % N - fx) * CELL) - c_ang);
      if (d < amin) amin = d;
      if (d > amax) amax = d;
    }
    double r_out = hypot(csx, csy), px = 0, py = 0;
    int m = 0;
    for (int k = 0; k < NN; k++) {
      if (!conn2[k]) continue;
      double gx = (k % N - fx) * CELL, gy = (k / N - fy) * CELL, r = hypot(gx, gy);
      if (r < 25 || r > r_out + 10) continue;
      double d = wrap_r(atan2(gy, gx) - c_ang);
      if (d < amin - 0.17 || d > amax + 0.17) continue;
      px += gx; py += gy; m++;
    }
    double dir = c_ang;
    if (m >= 10) {
      px /= m; py /= m;
      double sxx = 0, syy = 0, sxy = 0;
      for (int k = 0; k < NN; k++) {
        if (!conn2[k]) continue;
        double gx = (k % N - fx) * CELL, gy = (k / N - fy) * CELL, r = hypot(gx, gy);
        if (r < 25 || r > r_out + 10) continue;
        double d = wrap_r(atan2(gy, gx) - c_ang);
        if (d < amin - 0.17 || d > amax + 0.17) continue;
        double dx = gx - px, dy = gy - py; sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
      }
      double tr = sxx + syy, det = sxx * syy - sxy * sxy;
      double l1 = tr / 2 + sqrt(fmax(0, tr * tr / 4 - det)), l2 = tr - l1;
      double ax = 0.5 * atan2(2 * sxy, sxx - syy);
      if (cos(ax - c_ang) < 0) ax += PI;
      if (amax - amin > 30 * PI / 180 && l1 > 3 * fmax(l2, 1e-9) && fabs(wrap_r(ax - c_ang)) < 40 * PI / 180) dir = ax;
    }
    double deg = wrap_r(dir - line_dir) * 180 / PI;
    if (fabs(deg) <= 135 && out->n < SW_MAX_EXITS) { out->width[out->n] = (amax - amin) * 180 / PI; out->deg[out->n++] = deg; }
  }
  /* leftmost first */
  for (int i = 0; i < out->n; i++) for (int j = i + 1; j < out->n; j++) if (out->deg[j] > out->deg[i]) { double t = out->deg[i]; out->deg[i] = out->deg[j]; out->deg[j] = t; t = out->width[i]; out->width[i] = out->width[j]; out->width[j] = t; }
}
