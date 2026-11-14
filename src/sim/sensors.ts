// IR reflectance sensor model: each sensor averages the floor darkness over a circular spot,
// blends between its white and black readings, and adds noise.

import { contrastFactor, RobotProfile, sensorLateral_mm, spotDiameter_mm } from './profile';
import { darkAt, Track } from '../track/track';

// Deterministic pseudo-random generator so runs are repeatable.
export class Rng {
  private s: number;
  constructor(seed = 12345) { this.s = seed >>> 0 || 1; }
  next(): number { // uniform 0..1
    this.s ^= this.s << 13; this.s ^= this.s >>> 17; this.s ^= this.s << 5;
    return ((this.s >>> 0) % 1_000_000) / 1_000_000;
  }
  gauss(): number {
    const u = Math.max(1e-9, this.next()), v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
}

export interface SensorFlags { noise: boolean; mismatch: boolean }

export class SensorArray {
  readonly n: number;
  readonly lateral: number[];        // m, + = left
  readonly offset: number;           // m ahead of axle
  private spot: [number, number, number][]; // sample points (dx, dy in m, weight)
  private gains: number[];
  private rng: Rng;
  private p: RobotProfile;
  flags: SensorFlags;
  readonly maxRaw: number;
  raw: number[];                     // latest raw readings
  coverage: number[];                // latest true darkness under each spot (0..1)

  constructor(p: RobotProfile, flags: SensorFlags, seed = 7) {
    this.p = p;
    this.flags = flags;
    this.n = p.sensor.channels;
    this.lateral = sensorLateral_mm(p.sensor).map((v) => v / 1000);
    this.offset = p.sensorOffset_mm / 1000;
    this.maxRaw = 2 ** p.sensor.adcBits - 1;
    this.rng = new Rng(seed);
    // Spot sample pattern: centre + two rings, weighted towards the centre (sensor response falls off at the edge).
    const r = spotDiameter_mm(p.sensor) / 2000;
    const pts: [number, number, number][] = [[0, 0, 1]];
    for (const [ring, count, w] of [[0.5, 6, 0.8], [0.95, 12, 0.45]] as const) {
      for (let k = 0; k < count; k += 1) {
        const a = (2 * Math.PI * k) / count + ring;
        pts.push([Math.cos(a) * r * ring, Math.sin(a) * r * ring, w]);
      }
    }
    const total = pts.reduce((s, q) => s + q[2], 0);
    this.spot = pts.map(([x, y, w]) => [x, y, w / total]);
    this.gains = Array.from({ length: this.n }, () => 1 + (this.rng.next() * 2 - 1) * (p.sensor.mismatch_pct / 100));
    this.raw = new Array(this.n).fill(0);
    this.coverage = new Array(this.n).fill(0);
  }

  // World position of sensor i for a robot pose.
  position(i: number, x: number, y: number, theta: number): [number, number] {
    const c = Math.cos(theta), s = Math.sin(theta);
    const lat = this.lateral[i];
    return [x + this.offset * c + lat * s, y + this.offset * s - lat * c];
  }

  // heightDelta_mm: extra height from a mat bump under the array (disturbance), 0 normally.
  read(t: Track, x: number, y: number, theta: number, heightDelta_mm = 0, ambientShift = 0): number[] {
    const s = this.p.sensor;
    const k = contrastFactor(s.height_mm + heightDelta_mm);
    const mid = (s.whiteRaw + s.blackRaw) / 2;
    const half = ((s.blackRaw - s.whiteRaw) / 2) * k;
    const sigma = ((Math.abs(s.blackRaw - s.whiteRaw) * s.noise_pct) / 100);
    for (let i = 0; i < this.n; i += 1) {
      const [px, py] = this.position(i, x, y, theta);
      let cov = 0;
      for (const [dx, dy, w] of this.spot) cov += w * darkAt(t, px + dx, py + dy);
      this.coverage[i] = cov;
      const g = this.flags.mismatch ? this.gains[i] : 1;
      let v = mid + half * g * (2 * cov - 1) + ambientShift;
      if (this.flags.noise) v += sigma * this.rng.gauss();
      this.raw[i] = Math.round(Math.max(0, Math.min(this.maxRaw, v)));
    }
    return this.raw;
  }
}
