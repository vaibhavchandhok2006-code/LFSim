// Turn a top-down track image into a Track: scale to the preset's real size, find the line width,
// normalise it to the preset width, and find the start and finish squares.
// Pure functions on luminance arrays so the same code runs in the browser and in tests.

import { Pose, RectPx, Track, TrackPreset } from './track';

export const MAP_RES = 0.002; // 2 mm per pixel

// Exact Euclidean distance transform (Felzenszwalb & Huttenlocher). Returns distance in pixels
// from every pixel to the nearest pixel where src[i] is true.
export function edt(src: Uint8Array, w: number, h: number): Float32Array {
  const INF = 1e12;
  const f = new Float64Array(Math.max(w, h));
  const d = new Float64Array(Math.max(w, h));
  const v = new Int32Array(Math.max(w, h));
  const z = new Float64Array(Math.max(w, h) + 1);
  const g = new Float64Array(w * h);
  const pass = (n: number) => {
    let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q < n; q += 1) {
      let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) { k -= 1; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
      k += 1; v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < n; q += 1) { while (z[k + 1] < q) k += 1; d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]; }
  };
  for (let x = 0; x < w; x += 1) {
    for (let y = 0; y < h; y += 1) f[y] = src[y * w + x] ? 0 : INF;
    pass(h);
    for (let y = 0; y < h; y += 1) g[y * w + x] = d[y];
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) f[x] = g[y * w + x];
    pass(w);
    for (let x = 0; x < w; x += 1) out[y * w + x] = Math.sqrt(d[x]);
  }
  return out;
}

// Area-average resample of a luminance image (0..255) to w x h.
export function resampleGray(src: Uint8ClampedArray | Uint8Array, sw: number, sh: number, w: number, h: number, crop?: RectPx): Float32Array {
  const cx0 = crop ? crop.x0 : 0, cy0 = crop ? crop.y0 : 0;
  const cw = crop ? crop.x1 - crop.x0 : sw, ch = crop ? crop.y1 - crop.y0 : sh;
  const out = new Float32Array(w * h);
  const sx = cw / w, sy = ch / h;
  for (let y = 0; y < h; y += 1) {
    const y0 = cy0 + y * sy, y1 = y0 + sy;
    for (let x = 0; x < w; x += 1) {
      const x0 = cx0 + x * sx, x1 = x0 + sx;
      let sum = 0, area = 0;
      for (let yy = Math.floor(y0); yy < Math.ceil(y1); yy += 1) {
        if (yy < 0 || yy >= sh) continue;
        const wy = Math.min(y1, yy + 1) - Math.max(y0, yy);
        for (let xx = Math.floor(x0); xx < Math.ceil(x1); xx += 1) {
          if (xx < 0 || xx >= sw) continue;
          const wx = Math.min(x1, xx + 1) - Math.max(x0, xx);
          sum += src[yy * sw + xx] * wx * wy; area += wx * wy;
        }
      }
      out[y * w + x] = area > 0 ? sum / area : 255;
    }
  }
  return out;
}

export function rgbaToGray(data: Uint8ClampedArray): Uint8ClampedArray {
  const g = new Uint8ClampedArray(data.length / 4);
  for (let i = 0, j = 0; j < g.length; i += 4, j += 1) {
    const a = data[i + 3] / 255; // transparent counts as white
    const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    g[j] = lum * a + 255 * (1 - a);
  }
  return g;
}

interface Component { x0: number; y0: number; x1: number; y1: number; n: number }

function components(mask: Uint8Array, w: number, h: number): Component[] {
  const seen = new Uint8Array(w * h);
  const out: Component[] = [];
  const stack: number[] = [];
  for (let i = 0; i < w * h; i += 1) {
    if (!mask[i] || seen[i]) continue;
    const c: Component = { x0: w, y0: h, x1: 0, y1: 0, n: 0 };
    stack.push(i); seen[i] = 1;
    while (stack.length) {
      const j = stack.pop()!;
      const x = j % w, y = (j - x) / w;
      c.n += 1; c.x0 = Math.min(c.x0, x); c.x1 = Math.max(c.x1, x); c.y0 = Math.min(c.y0, y); c.y1 = Math.max(c.y1, y);
      for (const k of [j - 1, j + 1, j - w, j + w]) {
        if (k < 0 || k >= w * h || seen[k] || !mask[k]) continue;
        if ((k === j - 1 && x === 0) || (k === j + 1 && x === w - 1)) continue;
        seen[k] = 1; stack.push(k);
      }
    }
    out.push(c);
  }
  return out;
}

export interface ImportOptions {
  crop?: RectPx;          // area of the source image that is the track (default: whole image)
  normaliseWidth?: boolean;
  imageName?: string;
}

export interface ImportReport {
  squares: RectPx[];
  messages: string[];
}

export function processTrack(gray: Uint8ClampedArray | Uint8Array, sw: number, sh: number, preset: TrackPreset, opt: ImportOptions = {}): { track: Track; report: ImportReport } {
  const res = MAP_RES;
  const w = Math.round(preset.width_m / res), h = Math.round(preset.height_m / res);
  const lum = resampleGray(gray, sw, sh, w, h, opt.crop);
  const messages: string[] = [];

  // Binary line mask: dark = line. Threshold halfway between typical paper and tape.
  let black = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i += 1) black[i] = lum[i] < 128 ? 1 : 0;

  // Line width: twice the distance-to-white along the ridge of the line.
  const white = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i += 1) white[i] = black[i] ? 0 : 1;
  const dIn = edt(white, w, h); // inside black: distance to nearest white
  const ridge: number[] = [];
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      const i = y * w + x, v = dIn[i];
      if (v < 1.5) continue;
      if (v >= dIn[i - 1] && v >= dIn[i + 1] && v >= dIn[i - w] && v >= dIn[i + w]) ridge.push(v);
    }
  }
  ridge.sort((a, b) => a - b);
  const halfPx = ridge.length ? ridge[Math.floor(ridge.length * 0.4)] : (preset.lineWidth_cm / 200) / res;
  const measured_cm = (2 * halfPx - 1) * res * 100;
  messages.push(`Line width in the image: about ${measured_cm.toFixed(1)} cm at this scale.`);

  // Start/finish squares: solid black blobs much thicker than a line.
  const coreR = Math.max(3 * halfPx, 0.04 / res);
  const core = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i += 1) core[i] = dIn[i] >= coreR ? 1 : 0;
  const squares: RectPx[] = components(core, w, h)
    .filter((c) => c.n > 4)
    .map((c) => ({ x0: c.x0 - coreR, y0: c.y0 - coreR, x1: c.x1 + coreR, y1: c.y1 + coreR }));

  // Normalise line width to the preset width (structure unchanged, only thickness).
  if (opt.normaliseWidth !== false && ridge.length) {
    const targetHalf = (preset.lineWidth_cm / 200) / res;
    const delta = targetHalf - (halfPx - 0.5);
    if (Math.abs(delta) >= 0.5) {
      if (delta > 0) {
        const dOut = edt(black, w, h); // white pixels: distance to nearest black
        const nb = new Uint8Array(w * h);
        for (let i = 0; i < w * h; i += 1) nb[i] = black[i] || dOut[i] <= delta ? 1 : 0;
        black = nb;
      } else {
        const nb = new Uint8Array(w * h);
        for (let i = 0; i < w * h; i += 1) nb[i] = black[i] && dIn[i] > -delta ? 1 : 0;
        black = nb;
      }
      messages.push(`Line width normalised to ${preset.lineWidth_cm} cm.`);
    }
  }
  const dark = new Float32Array(w * h);
  for (let i = 0; i < w * h; i += 1) dark[i] = black[i];

  // Start = the square nearest a corner of the mat; finish = the other square farthest from it.
  const centre = (r: RectPx) => [(r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2];
  const cornerDist = (r: RectPx) => {
    const [cx, cy] = centre(r);
    return Math.min(Math.hypot(cx, cy), Math.hypot(w - cx, cy), Math.hypot(cx, h - cy), Math.hypot(w - cx, h - cy));
  };
  let start: RectPx | null = null, finish: RectPx | null = null;
  if (squares.length) {
    start = [...squares].sort((a, b) => cornerDist(a) - cornerDist(b))[0];
    const others = squares.filter((s) => s !== start);
    if (others.length) {
      const [sx, sy] = centre(start);
      finish = others.sort((a, b) => Math.hypot(centre(b)[0] - sx, centre(b)[1] - sy) - Math.hypot(centre(a)[0] - sx, centre(a)[1] - sy))[0];
    }
  }
  if (!start) messages.push('No start square found — place the robot by hand.');
  if (!finish) messages.push('No finish square found — runs will not be timed to a finish.');

  const track: Track = {
    preset, res, w, h, dark, start, finish,
    startPose: { x: preset.width_m / 2, y: preset.height_m / 2, theta: 0 },
    measuredLineWidth_cm: measured_cm,
    imageName: opt.imageName ?? 'track',
  };
  return { track, report: { squares, messages } };
}

// Robot pose inside the start square, facing where the line leaves it, front edge just inside.
export function startPoseFor(t: Track, axleFromFront_m: number): Pose {
  const s = t.start;
  if (!s) return t.startPose;
  const cx = (s.x0 + s.x1) / 2, cy = (s.y0 + s.y1) / 2;
  // Look in a ring just outside the square for line pixels.
  const ring = Math.round(0.015 / t.res);
  let sx = 0, sy = 0, n = 0;
  for (let y = Math.floor(s.y0 - ring); y <= s.y1 + ring; y += 1) {
    for (let x = Math.floor(s.x0 - ring); x <= s.x1 + ring; x += 1) {
      if (x < 0 || y < 0 || x >= t.w || y >= t.h) continue;
      const inside = x >= s.x0 - 1 && x <= s.x1 + 1 && y >= s.y0 - 1 && y <= s.y1 + 1;
      if (inside || t.dark[y * t.w + x] < 0.5) continue;
      sx += x; sy += y; n += 1;
    }
  }
  let theta = n ? Math.atan2(sy / n - cy, sx / n - cx) : 0;
  // Snap to the nearest axis if close (tracks are drawn on a grid).
  const q = Math.round(theta / (Math.PI / 2)) * (Math.PI / 2);
  if (Math.abs(theta - q) < 0.17) theta = q;
  // Distance from the square centre to its edge along the heading.
  const halfW = ((s.x1 - s.x0) / 2) * t.res, halfH = ((s.y1 - s.y0) / 2) * t.res;
  const c = Math.cos(theta), sn = Math.sin(theta);
  const edge = Math.min(Math.abs(c) > 1e-6 ? halfW / Math.abs(c) : Infinity, Math.abs(sn) > 1e-6 ? halfH / Math.abs(sn) : Infinity);
  const back = Math.max(0, axleFromFront_m - edge + 0.01);
  return { x: cx * t.res - back * c, y: cy * t.res - back * sn, theta };
}
