// Junction map from the sensor swath — what a real robot can know about a junction without a 360° scan.
//
// While the robot follows the line and rolls over a junction, every sensor reading is placed at the sensor's position
// in the robot's own odometry frame. When the axle reaches the junction, those readings form a small local map: a band
// as wide as the sensor array along the path driven. Branches are the dark regions that are CONNECTED to the junction
// centre and leave it in some direction; a line nearby that is not connected (across white) is ignored. Directions are
// measured as close to the junction as the band allows, so they do not depend on the sensor arm length.
//
// Uses only: sensor readings, sensor geometry and the robot's odometry (wheel encoders, or an estimate without them).


const CELL = 0.004;     // m
const HALF = 0.12;      // m, map half-size around the junction centre
const N = Math.round((2 * HALF) / CELL) + 1;

export interface JunctionExit { deg: number; along: number; lat: number; width: number } // relative to the incoming line, metres
export interface JunctionReading {
  branches: number[];
  exits: JunctionExit[]; // where each branch leaves the seen area   // degrees relative to the incoming line's direction (+ = left), incoming line excluded
  incoming: number | null; // direction of the incoming line, relative to the robot's arrival heading (≈ 180)
  connectedCells: number;
}

export class Swath {
  private xs: number[] = []; private ys: number[] = []; private ds: number[] = []; private odo: number[] = []; private hs: number[] = [];
  private start = 0;

  clear() { this.xs = []; this.ys = []; this.ds = []; this.odo = []; this.hs = []; this.start = 0; }

  // x, y: sensor position (m, odometry frame); dark: 0..1; odo: distance driven; heading: robot heading (rad)
  add(x: number, y: number, dark: number, odo: number, heading: number) {
    this.xs.push(x); this.ys.push(y); this.ds.push(dark); this.odo.push(odo); this.hs.push(heading);
  }

  // Keep only readings from the last `keep_m` of travel.
  prune(odoNow: number, keep_m: number) {
    while (this.start < this.odo.length && this.odo[this.start] < odoNow - keep_m) this.start += 1;
    if (this.start > 20000) {
      this.xs = this.xs.slice(this.start); this.ys = this.ys.slice(this.start); this.ds = this.ds.slice(this.start); this.odo = this.odo.slice(this.start); this.hs = this.hs.slice(this.start);
      this.start = 0;
    }
  }

  get size() { return this.xs.length - this.start; }

  // cx, cy: junction centre; heading: arrival heading (rad, odometry frame); paint_m: radius each reading covers
  // (half the sensor spacing, so neighbouring sensor tracks join); halfWidth_m: half the swath width (array half-width);
  // ahead_m: how far past the centre the array has seen.
  read(cx: number, cy: number, heading: number, paint_m: number, halfWidth_m: number, ahead_m: number): JunctionReading {
    // 1. Paint the map: each reading covers the strip between it and its neighbouring sensors (across the direction of
    //    travel only, so lines are not widened along it). Each cell holds the average of the readings over it
    //    (-1 = never seen), so a dark reading next to white ones does not widen the line.
    const sum = new Float32Array(N * N), cntA = new Uint16Array(N * N);
    for (let i = this.start; i < this.xs.length; i += 1) {
      const px = this.xs[i] - cx + HALF, py = this.ys[i] - cy + HALF;
      if (px < -paint_m || py < -paint_m || px > 2 * HALF + paint_m || py > 2 * HALF + paint_m) continue;
      const d = this.ds[i], nx = -Math.sin(this.hs[i]), ny = Math.cos(this.hs[i]);
      for (let t = -paint_m; t <= paint_m + 1e-9; t += CELL / 2) {
        const gx = Math.round((px + t * nx) / CELL), gy = Math.round((py + t * ny) / CELL);
        if (gx < 0 || gy < 0 || gx >= N || gy >= N) continue;
        const k = gy * N + gx;
        sum[k] += d; if (cntA[k] < 65535) cntA[k] += 1;
      }
    }
    const map = new Float32Array(N * N);
    for (let k = 0; k < N * N; k += 1) map[k] = cntA[k] ? sum[k] / cntA[k] : -1;
    // 2. Flood fill the dark region connected to the centre (start from the nearest dark cell within 3 cm).
    const c0 = Math.round(HALF / CELL);
    let seed = -1, bestD = Infinity;
    const sr = Math.round(0.03 / CELL);
    for (let dy = -sr; dy <= sr; dy += 1) for (let dx = -sr; dx <= sr; dx += 1) {
      const k = (c0 + dy) * N + (c0 + dx), d2 = dx * dx + dy * dy;
      if (map[k] > 0.5 && d2 < bestD) { bestD = d2; seed = k; }
    }
    const conn = new Uint8Array(N * N);
    let count = 0;
    if (seed >= 0) {
      const stack = [seed]; conn[seed] = 1;
      while (stack.length) {
        const k = stack.pop()!; count += 1;
        const x = k % N, y = (k - x) / N;
        for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= N || yy >= N) continue;
          const kk = yy * N + xx;
          if (!conn[kk] && map[kk] > 0.5) { conn[kk] = 1; stack.push(kk); }
        }
      }
    }
    // 3. Look round the junction: in each direction, is there connected line in a band as far out as the swath
    //    allows (side directions are limited by the array width, forward by how far the array has gone)?
    // Refine the centre. Sideways: onto the axis of the incoming line (seen 2.5–6 cm behind). Along the path: onto the
    // middle of the side branches (dark area well clear of the incoming line within 4 cm). The first estimate, made the
    // moment the junction was seen, can be a line width off.
    const hcos = Math.cos(heading), hsin = Math.sin(heading);
    let latSum = 0, latN = 0;
    for (let k = 0; k < N * N; k += 1) {
      if (!conn[k]) continue;
      const x = (k % N - c0) * CELL, y = (Math.floor(k / N) - c0) * CELL;
      const along = x * hcos + y * hsin, lat = -x * hsin + y * hcos;
      if (along <= -0.025 && along >= -0.06 && Math.abs(lat) < 0.04) { latSum += lat; latN += 1; }
    }
    const latOff = latN > 10 ? latSum / latN : 0;
    let alSum = 0, alN = 0;
    for (let k = 0; k < N * N; k += 1) {
      if (!conn[k]) continue;
      const x = (k % N - c0) * CELL, y = (Math.floor(k / N) - c0) * CELL;
      const along = x * hcos + y * hsin, lat = -x * hsin + y * hcos - latOff;
      if (Math.abs(lat) > 0.028 && Math.abs(lat) < 0.045 && Math.abs(along) < 0.04) { alSum += along; alN += 1; }
    }
    const alOff = alN > 6 ? Math.max(-0.015, Math.min(0.015, alSum / alN)) : 0;
    const fx = c0 + (alOff * hcos - latOff * hsin) / CELL, fy = c0 + (alOff * hsin + latOff * hcos) / CELL;
    // The incoming line's direction: fit an axis to the line 2.5–9 cm behind the centre (the robot may have arrived
    // crooked). Without enough of it in view, use the arrival heading.
    let mx = 0, my = 0, mn = 0;
    const back: number[] = [];
    for (let k = 0; k < N * N; k += 1) {
      if (!conn[k]) continue;
      const x = (k % N - fx) * CELL, y = (Math.floor(k / N) - fy) * CELL;
      const along = x * hcos + y * hsin, lat = -x * hsin + y * hcos;
      if (along <= -0.025 && along >= -0.09 && Math.abs(lat) < 0.035) { mx += x; my += y; mn += 1; back.push(x, y); }
    }
    let lineDir = heading;
    if (mn >= 15) {
      mx /= mn; my /= mn;
      let sxx = 0, syy = 0, sxy = 0;
      for (let i = 0; i < back.length; i += 2) { const dx = back[i] - mx, dy = back[i + 1] - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
      let a = 0.5 * Math.atan2(2 * sxy, sxx - syy);           // principal axis (either way along it)
      if (Math.cos(a - heading) < 0) a += Math.PI;           // point it forward
      const dev = Math.atan2(Math.sin(a - heading), Math.cos(a - heading));
      if (Math.abs(dev) < (35 * Math.PI) / 180) lineDir = a;  // trust it only near the heading
    }
    const lc = Math.cos(lineDir), ls = Math.sin(lineDir);
    // Leave out the incoming line itself behind the junction, so its edges (which can run along the side of the swath)
    // are not taken for branches. Branches must connect to the centre without going along it.
    const conn2 = new Uint8Array(N * N);
    {
      const ki = Math.round(fy) * N + Math.round(fx);
      let start = conn[ki] ? ki : -1;
      if (start < 0) { let bd = Infinity; for (let k = 0; k < N * N; k += 1) if (conn[k]) { const d2 = (k % N - fx) ** 2 + (Math.floor(k / N) - fy) ** 2; if (d2 < bd) { bd = d2; start = k; } } }
      // The incoming line's extent across, measured 2.5–6 cm behind. If it runs off the seen area on one side (the
      // array was not centred on it), it may be wider there than seen: leave out everything beyond on that side too.
      let lo = Infinity, hi = -Infinity, loOpen = false, hiOpen = false;
      for (let k = 0; k < N * N; k += 1) {
        if (!conn[k]) continue;
        const x = (k % N - fx) * CELL, y = (Math.floor(k / N) - fy) * CELL;
        const al = x * lc + y * ls, la = -x * ls + y * lc;
        if (al > -0.025 || al < -0.06 || Math.abs(la) > 0.06) continue;
        if (la < lo) lo = la; if (la > hi) hi = la;
      }
      if (!Number.isFinite(lo)) { lo = -0.028; hi = 0.028; }
      const seenAt = (al: number, la: number) => {
        const gx = Math.round(fx + (al * lc - la * ls) / CELL), gy = Math.round(fy + (al * ls + la * lc) / CELL);
        return gx >= 0 && gy >= 0 && gx < N && gy < N && map[gy * N + gx] >= 0;
      };
      for (const al of [-0.03, -0.04, -0.05]) { if (!seenAt(al, hi + 2 * CELL)) hiOpen = true; if (!seenAt(al, lo - 2 * CELL)) loOpen = true; }
      const cLo = loOpen ? -0.06 : Math.max(-0.045, lo - 0.008), cHi = hiOpen ? 0.06 : Math.min(0.045, hi + 0.008);
      const blocked = (k: number) => {
        const x = (k % N - fx) * CELL, y = (Math.floor(k / N) - fy) * CELL;
        const la = -x * ls + y * lc;
        return x * lc + y * ls < -0.022 && la > Math.min(-0.022, cLo) && la < Math.max(0.022, cHi);
      };
      if (start >= 0) {
        const st = [start]; conn2[start] = 1;
        while (st.length) {
          const k = st.pop()!; const x = k % N, y = (k - x) / N;
          for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
            const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= N || yy >= N) continue;
            const kk = yy * N + xx;
            if (!conn2[kk] && conn[kk] && !blocked(kk)) { conn2[kk] = 1; st.push(kk); }
          }
        }
      }
    }
    // 3. Branches leave the junction through the edge of the area the sensors have seen (the sides of the swath, its
    //    front end or its back end). Find the connected dark cells on that edge, group them, and take each group's
    //    direction from the junction centre.
    // An edge cell counts only if the unseen area lies straight outward from the junction centre: a line that runs
    // along the side of the swath (e.g. the incoming line after a crooked approach) is not leaving the junction.
    const frontier = new Uint8Array(N * N);
    for (let k = 0; k < N * N; k += 1) {
      if (!conn2[k]) continue;
      const x = k % N, y = (k - x) / N;
      const vx = x - fx, vy = y - fy, L = Math.hypot(vx, vy);
      if (L < 1e-6) continue;
      let out = false;
      for (const step of [1, 2]) {
        const xx = Math.round(x + (vx / L) * step), yy = Math.round(y + (vy / L) * step);
        if (xx < 0 || yy < 0 || xx >= N || yy >= N || map[yy * N + xx] < 0) { out = true; break; }
        if (map[yy * N + xx] <= 0.5) break; // white outward: the line ends here, not unseen
      }
      if (out) frontier[k] = 1;
    }
    const dbg = (globalThis as { __lfsimJunctionDebug?: (s: string) => void }).__lfsimJunctionDebug;
    if (dbg) {
      const rows: string[] = [];
      for (let y = N - 1; y >= 0; y -= 1) { let r = ''; for (let x = 0; x < N; x += 1) { const k = y * N + x; r += x === Math.round(fx) && y === Math.round(fy) ? '*' : frontier[k] ? 'F' : conn[k] ? '#' : map[k] > 0.5 ? 'o' : map[k] >= 0 ? '.' : ' '; } rows.push(r); }
      let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9; for (let i = this.start; i < this.xs.length; i += 1) { x0 = Math.min(x0, this.xs[i] - cx); x1 = Math.max(x1, this.xs[i] - cx); y0 = Math.min(y0, this.ys[i] - cy); y1 = Math.max(y1, this.ys[i] - cy); }
      dbg('h=' + ((heading * 180) / Math.PI).toFixed(0) + ` samples ${this.xs.length - this.start} x ${x0.toFixed(3)}..${x1.toFixed(3)} y ${y0.toFixed(3)}..${y1.toFixed(3)}\n` + rows.join('\n'));
    }
    // Group the edge cells: cells along the edge that touch (a one-cell gap allowed, the swath edge is ragged) are
    // one line leaving. Each line's direction is the axis of its dark cells between the centre and the edge.
    const MIN_DIST = 0.03; // edge cells closer than this to the centre belong to the junction itself
    const lc2 = Math.cos(lineDir), ls2 = Math.sin(lineDir);
    const compOf = new Int32Array(N * N).fill(-1);
    const comps: number[][] = [];
    for (let k = 0; k < N * N; k += 1) {
      if (!frontier[k] || compOf[k] >= 0) continue;
      const gx0 = (k % N - fx) * CELL, gy0 = (Math.floor(k / N) - fy) * CELL;
      if (Math.hypot(gx0, gy0) < MIN_DIST) continue;
      const id = comps.length, cells: number[] = [k]; compOf[k] = id;
      for (let q = 0; q < cells.length; q += 1) {
        const x = cells[q] % N, y = (cells[q] - x) / N;
        for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) {
          const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= N || yy >= N) continue;
          const kk = yy * N + xx;
          if (!frontier[kk] || compOf[kk] >= 0) continue;
          if (Math.hypot((xx - fx) * CELL, (yy - fy) * CELL) < MIN_DIST) continue;
          compOf[kk] = id; cells.push(kk);
        }
      }
      comps.push(cells);
    }
    const runs: number[] = [];
    const runExit: JunctionExit[] = [];
    const wrapR = (r: number) => Math.atan2(Math.sin(r), Math.cos(r));
    for (const cells of comps) {
      if (cells.length < 2) continue;
      let sx = 0, sy = 0, lo = 1, hi = -1, amin = Infinity, amax = -Infinity;
      for (const k of cells) { const gx = (k % N - fx) * CELL, gy = (Math.floor(k / N) - fy) * CELL; sx += gx; sy += gy; }
      sx /= cells.length; sy /= cells.length;
      const cAng = Math.atan2(sy, sx);
      for (const k of cells) {
        const gx = (k % N - fx) * CELL, gy = (Math.floor(k / N) - fy) * CELL;
        const d = wrapR(Math.atan2(gy, gx) - cAng); amin = Math.min(amin, d); amax = Math.max(amax, d);
        const lt = -gx * ls2 + gy * lc2; lo = Math.min(lo, lt); hi = Math.max(hi, lt);
      }
      const rOut = Math.hypot(sx, sy);
      // Dark cells of this line: connected cells in the sector of its edge cells, from 2.5 cm out to the edge.
      const pts: number[] = [];
      let mx = 0, my = 0;
      for (let k = 0; k < N * N; k += 1) {
        if (!conn2[k]) continue;
        const gx = (k % N - fx) * CELL, gy = (Math.floor(k / N) - fy) * CELL, r = Math.hypot(gx, gy);
        if (r < 0.025 || r > rOut + 0.01) continue;
        const d = wrapR(Math.atan2(gy, gx) - cAng);
        if (d < amin - 0.17 || d > amax + 0.17) continue;
        pts.push(gx, gy); mx += gx; my += gy;
      }
      let dir = cAng;
      const m = pts.length / 2;
      if (m >= 10) {
        mx /= m; my /= m;
        let sxx = 0, syy = 0, sxy = 0;
        for (let i = 0; i < pts.length; i += 2) { const dx = pts[i] - mx, dy = pts[i + 1] - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
        const tr = sxx + syy, det = sxx * syy - sxy * sxy;
        const l1 = tr / 2 + Math.sqrt(Math.max(0, (tr * tr) / 4 - det)), l2 = tr - l1;
        let ax = 0.5 * Math.atan2(2 * sxy, sxx - syy);
        if (Math.cos(ax - cAng) < 0) ax += Math.PI;
        // Use the axis only if the cells form a clear line pointing roughly at the edge cells.
        if (amax - amin > (30 * Math.PI) / 180 && l1 > 3 * Math.max(l2, 1e-9) && Math.abs(wrapR(ax - cAng)) < (40 * Math.PI) / 180) dir = ax;
      }
      let deg = (wrapR(dir - lineDir) * 180) / Math.PI;
      if (deg > 180) deg -= 360;
      runs.push(deg);
      runExit.push({ deg, along: sx * lc2 + sy * ls2, lat: -sx * ls2 + sy * lc2, width: hi > lo ? hi - lo : 0 });
    }
    void ahead_m; void halfWidth_m;
    // 5. Directions are relative to the incoming line; anything left straight behind is the incoming line itself.
    const wrap = (d: number) => ((d + 180) % 360 + 360) % 360 - 180;
    // A robot cannot tell lines behind it at a junction from the one it came on: only directions within 135° of
    // straight on count as branches.
    const branches = runs.map(wrap).filter((d) => Math.abs(d) <= 135).sort((a, b) => b - a);
    const exits = runExit.map((e) => ({ ...e, deg: wrap(e.deg) })).filter((e) => Math.abs(e.deg) <= 135);
    const incoming = wrap(((lineDir - heading) * 180) / Math.PI + 180);
    return { branches, exits, incoming, connectedCells: count };
  }
}
