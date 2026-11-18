// A processed track: a darkness map in real units, plus start/finish squares.

export interface RectPx { x0: number; y0: number; x1: number; y1: number }

export interface Pose { x: number; y: number; theta: number } // metres, radians; image frame (x right, y down)

export interface TrackPreset {
  id: 'roborun' | 'roborun-2027' | 'custom';
  name: string;
  width_m: number;
  height_m: number;
  lineWidth_cm: number;
  maxRobotL_mm: number;
  maxRobotW_mm: number;
}

export const PRESETS: TrackPreset[] = [
  { id: 'roborun', name: 'Robo-Run 2026 (Shaastra)', width_m: 2.5, height_m: 2.5, lineWidth_cm: 3.8, maxRobotL_mm: 200, maxRobotW_mm: 200 },
  { id: 'custom', name: 'Custom', width_m: 2.5, height_m: 2.5, lineWidth_cm: 3.8, maxRobotL_mm: 250, maxRobotW_mm: 250 },
  { id: 'roborun-2027', name: 'Robo-Run 2027 (Shaastra)', width_m: 4, height_m: 4, lineWidth_cm: 3.5, maxRobotL_mm: 200, maxRobotW_mm: 200 },
];

export interface Track {
  preset: TrackPreset;
  res: number;            // metres per pixel of the darkness map
  w: number; h: number;   // map size in pixels
  dark: Float32Array;     // 0 = white mat, 1 = black line
  start: RectPx | null;
  finish: RectPx | null;
  startPose: Pose;
  measuredLineWidth_cm: number; // line width found in the image before normalising
  imageName: string;
}

// Bilinear darkness lookup at a world point in metres. Off the mat counts as white.
export function darkAt(t: Track, xm: number, ym: number): number {
  const fx = xm / t.res - 0.5, fy = ym / t.res - 0.5;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const ax = fx - x0, ay = fy - y0;
  // Same arithmetic, in the same order, as a straightforward version; written without a helper closure because this
  // is the simulator's hottest function (19 samples per sensor per brain tick).
  const w = t.w, h = t.h, d = t.dark;
  let g00 = 0, g10 = 0, g01 = 0, g11 = 0;
  if (x0 >= 0 && y0 >= 0 && x0 + 1 < w && y0 + 1 < h) {
    const i = y0 * w + x0;
    g00 = d[i]; g10 = d[i + 1]; g01 = d[i + w]; g11 = d[i + w + 1];
  } else {
    const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : d[y * w + x]);
    g00 = at(x0, y0); g10 = at(x0 + 1, y0); g01 = at(x0, y0 + 1); g11 = at(x0 + 1, y0 + 1);
  }
  return (
    g00 * (1 - ax) * (1 - ay) + g10 * ax * (1 - ay) +
    g01 * (1 - ax) * ay + g11 * ax * ay
  );
}

export function inRect(t: Track, r: RectPx | null, xm: number, ym: number): boolean {
  if (!r) return false;
  const px = xm / t.res, py = ym / t.res;
  return px >= r.x0 && px <= r.x1 && py >= r.y0 && py <= r.y1;
}

// Distance in metres from a world point to the nearest line pixel, within maxM (returns maxM if none).
export function distanceToLine(t: Track, xm: number, ym: number, maxM: number): number {
  const cx = Math.round(xm / t.res), cy = Math.round(ym / t.res);
  const R = Math.ceil(maxM / t.res);
  let best = R * R + 1;
  for (let dy = -R; dy <= R; dy += 1) {
    const y = cy + dy; if (y < 0 || y >= t.h) continue;
    for (let dx = -R; dx <= R; dx += 1) {
      const x = cx + dx; if (x < 0 || x >= t.w) continue;
      const d2 = dx * dx + dy * dy;
      if (d2 < best && t.dark[y * t.w + x] > 0.5) best = d2;
    }
  }
  return Math.min(maxM, Math.sqrt(best) * t.res);
}
