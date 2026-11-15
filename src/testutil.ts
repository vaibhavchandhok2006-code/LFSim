// Test helpers (Node only): load the sample Robo-Run track from public/samples.
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { processTrack, rgbaToGray, startPoseFor } from './track/importTrack';
import { PRESETS, Track } from './track/track';
import { DEFAULT_PROFILE } from './sim/profile';

let cached: Track | null = null;

export function loadSampleTrack(): Track {
  if (cached) return cached;
  const png = PNG.sync.read(readFileSync(new URL('../public/samples/roborun-sample.png', import.meta.url)));
  const gray = rgbaToGray(new Uint8ClampedArray(png.data));
  const { track } = processTrack(gray, png.width, png.height, PRESETS[0], { imageName: 'roborun-sample.png' });
  track.startPose = startPoseFor(track, DEFAULT_PROFILE.axleFromFront_mm / 1000);
  cached = track;
  return track;
}

// A clean grid maze (Node tests): 6 x 6 junction grid, 36 cm apart, 3.8 cm lines, a perfect maze carved with a fixed
// seed, start square at the top-left corner and finish square at the bottom-right. Clean 90° T's, crosses, corners and
// dead ends only — the kind of maze where the junction readings can be checked exactly.
let gridCached: Track | null = null;
export function loadGridMaze(): Track {
  if (gridCached) return gridCached;
  const W = 1250, res = 0.002, N = 6, pitch = 0.36, o = 0.25;
  const gray = new Uint8ClampedArray(W * W).fill(255);
  const seg = (ax: number, ay: number, bx: number, by: number) => {
    const x0 = Math.floor((Math.min(ax, bx) - 0.02) / res), x1 = Math.ceil((Math.max(ax, bx) + 0.02) / res);
    const y0 = Math.floor((Math.min(ay, by) - 0.02) / res), y1 = Math.ceil((Math.max(ay, by) + 0.02) / res);
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
    for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) {
      const px = (x + 0.5) * res, py = (y + 0.5) * res;
      const t = L2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L2)) : 0;
      if (Math.hypot(px - ax - t * dx, py - ay - t * dy) <= 0.019) gray[y * W + x] = 0;
    }
  };
  const box = (cx: number, cy: number, s: number) => {
    for (let y = Math.floor((cy - s / 2) / res); y < (cy + s / 2) / res; y += 1) for (let x = Math.floor((cx - s / 2) / res); x < (cx + s / 2) / res; x += 1) gray[y * W + x] = 0;
  };
  const P = (i: number) => o + pitch * i;
  // perfect maze by depth-first carving with a small fixed LCG
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const seen = new Set<number>([0]); const stack = [0];
  while (stack.length) {
    const c = stack[stack.length - 1], ci = c % N, cj = Math.floor(c / N);
    const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([a, b]) => [ci + a, cj + b]).filter(([i, j]) => i >= 0 && j >= 0 && i < N && j < N && !seen.has(j * N + i));
    if (!nb.length) { stack.pop(); continue; }
    const [i, j] = nb[Math.floor(rnd() * nb.length)];
    seg(P(ci), P(cj), P(i), P(j)); seen.add(j * N + i); stack.push(j * N + i);
  }
  seg(0.1, P(0), P(0), P(0)); box(0.1, P(0), 0.18);                     // start square left of the top-left junction
  seg(P(N - 1), P(N - 1), 2.4, P(N - 1)); box(2.4, P(N - 1), 0.18);       // finish square right of the bottom-right one
  const { track } = processTrack(gray, W, W, PRESETS[0], { imageName: 'grid-maze' });
  track.startPose = startPoseFor(track, DEFAULT_PROFILE.axleFromFront_mm / 1000);
  gridCached = track;
  return track;
}
