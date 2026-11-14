import { describe, expect, it } from 'vitest';
import { SensorArray } from './sensors';
import { DEFAULT_PROFILE, RobotProfile } from './profile';
import { PRESETS, Track } from '../track/track';
import { makeDisturbance } from './simulation';
import { parseImport, DEFAULTS } from '../ui/persist';

// A mat with one vertical 3.8 cm line at x = 0.5 m.
function lineTrack(): Track {
  const res = 0.002, w = 500, h = 500, dark = new Float32Array(w * h);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) dark[y * w + x] = Math.abs((x + 0.5) * res - 0.5) <= 0.019 ? 1 : 0;
  return { preset: PRESETS[1], res, w, h, dark, start: null, finish: null, startPose: { x: 0, y: 0, theta: 0 }, measuredLineWidth_cm: 3.8, imageName: 'line' };
}

const quiet = { noise: false, mismatch: false };
function sweep(p: RobotProfile) {
  const arr = new SensorArray(p, quiet);
  const t = lineTrack();
  const out: number[] = [];
  // robot faces up (-y); sensor 0 is on the robot's left (x smaller). Slide the robot across the line in x.
  for (let x = 0.3; x <= 0.7; x += 0.002) out.push(arr.read(t, x, 0.5 + p.sensorOffset_mm / 1000, -Math.PI / 2)[3]);
  return out;
}

describe('sensor model', () => {
  it('a slow sweep across the line gives a smooth S-shaped rise and fall', () => {
    const s = sweep(DEFAULT_PROFILE);
    const max = Math.max(...s), min = Math.min(...s);
    expect(max).toBeGreaterThan(3000);
    expect(min).toBeLessThan(400);
    // smooth S: rises then falls monotonically, and each edge (10% to 90%) spans several 2 mm steps, not a jump
    const peak = s.indexOf(max);
    for (let i = 1; i <= peak; i += 1) expect(s[i]).toBeGreaterThanOrEqual(s[i - 1]);
    for (let i = peak + 1; i < s.length; i += 1) expect(s[i]).toBeLessThanOrEqual(s[i - 1]);
    const inEdge = s.slice(0, peak).filter((v) => v > min + 0.1 * (max - min) && v < min + 0.9 * (max - min)).length;
    expect(inEdge).toBeGreaterThanOrEqual(2);
  });

  it('raising the sensor weakens contrast and widens the edge', () => {
    const low = sweep(DEFAULT_PROFILE);
    const high = sweep({ ...DEFAULT_PROFILE, sensor: { ...DEFAULT_PROFILE.sensor, height_mm: 14 } });
    const range = (a: number[]) => Math.max(...a) - Math.min(...a);
    expect(range(high)).toBeLessThan(range(low) * 0.8);
    const edgeWidth = (a: number[]) => { const lo = Math.min(...a), hi = Math.max(...a); return a.filter((v) => v > lo + 0.1 * (hi - lo) && v < lo + 0.9 * (hi - lo)).length; };
    expect(edgeWidth(high)).toBeGreaterThan(edgeWidth(low));
  });

  it('places sensors at the right spacing across the array', () => {
    const arr = new SensorArray(DEFAULT_PROFILE, quiet);
    const [x0, y0] = arr.position(0, 0, 0, 0), [x1, y1] = arr.position(1, 0, 0, 0);
    expect(Math.hypot(x1 - x0, y1 - y0)).toBeCloseTo(DEFAULT_PROFILE.sensor.spacing_mm / 1000, 6);
    expect(x0).toBeCloseTo(DEFAULT_PROFILE.sensorOffset_mm / 1000, 6); // ahead of the axle
    expect(y0).toBeLessThan(0); // sensor 0 is on the robot's left (−y when facing +x in the image frame)
  });

  it('noise is seeded: the same seed gives the same readings', () => {
    const t = lineTrack();
    const a = new SensorArray(DEFAULT_PROFILE, { noise: true, mismatch: true }, 3).read(t, 0.5, 0.5, 0).slice();
    const b = new SensorArray(DEFAULT_PROFILE, { noise: true, mismatch: true }, 3).read(t, 0.5, 0.5, 0).slice();
    expect(a).toEqual(b);
  });

  it('uneven lighting and mat bumps change the readings', () => {
    const t = lineTrack();
    const d = makeDisturbance(t, { lighting: { on: true, strength: 1 }, bumps: { on: true, strength: 1 }, seed: 5 }, DEFAULT_PROFILE)!;
    let changed = 0;
    for (let x = 0.05; x < 1; x += 0.05) {
      const clean = new SensorArray(DEFAULT_PROFILE, quiet).read(t, x, 0.3, 0).slice();
      const dist = new SensorArray(DEFAULT_PROFILE, quiet).read(t, x, 0.3, 0, d).slice();
      if (clean.some((v, i) => Math.abs(v - dist[i]) > 20)) changed += 1;
    }
    expect(changed).toBeGreaterThan(5);
  });
});

describe('imports are validated', () => {
  it('round-trips a project file', () => {
    const text = JSON.stringify({ lfsim: 'project', version: 1, settings: DEFAULTS, trackImage: null, runs: [], memory: null });
    const r = parseImport(text);
    expect(r.kind).toBe('project');
  });
  it('rejects malformed, wrong-version and bad-number files', () => {
    expect(() => parseImport('not json')).toThrow(/not valid JSON/);
    expect(() => parseImport(JSON.stringify({ lfsim: 'project', version: 2, settings: {} }))).toThrow(/version 2/);
    expect(() => parseImport(JSON.stringify({ ...DEFAULTS.profile, wheelbase_mm: 'wide' }))).toThrow();
    expect(() => parseImport(JSON.stringify({ lfsim: 'track', version: 1, setup: {}, image: 'javascript:alert(1)' }))).toThrow(/image/);
  });
});
