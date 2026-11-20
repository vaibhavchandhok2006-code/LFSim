// A processed track: a darkness map in real units, plus start/finish squares.

export interface RectPx { x0: number; y0: number; x1: number; y1: number }

export interface Pose { x: number; y: number; theta: number } // metres, radians; image frame (x right, y down)

export interface TrackPreset {
  id: 'roborun' | 'custom';
  name: string;
  width_m: number;
  height_m: number;
  lineWidth_cm: number;
  maxRobotL_mm: number;
  maxRobotW_mm: number;
}

export const PRESETS: TrackPreset[] = [
  { id: 'roborun', name: 'Robo-Run (Shaastra)', width_m: 2.5, height_m: 2.5, lineWidth_cm: 3.8, maxRobotL_mm: 200, maxRobotW_mm: 200 },
  { id: 'custom', name: 'Custom', width_m: 2.5, height_m: 2.5, lineWidth_cm: 3.8, maxRobotL_mm: 250, maxRobotW_mm: 250 },
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
  const g = (x: number, y: number) => (x < 0 || y < 0 || x >= t.w || y >= t.h ? 0 : t.dark[y * t.w + x]);
  return (
    g(x0, y0) * (1 - ax) * (1 - ay) + g(x0 + 1, y0) * ax * (1 - ay) +
    g(x0, y0 + 1) * (1 - ax) * ay + g(x0 + 1, y0 + 1) * ax * ay
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
