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
export type Disturb = (px: number, py: number) => { dh_mm: number; amb: number };
const NO_DISTURB = { dh_mm: 0, amb: 0 };

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

  // disturb(px, py): disturbance at a floor point — extra sensor height from a mat bump (mm) and an ambient-light
  // shift in raw ADC counts. Undefined = clean conditions.
  read(t: Track, x: number, y: number, theta: number, disturb?: Disturb): number[] {
    for (let i = 0; i < this.n; i += 1) this.raw[i] = this.readOne(i, t, x, y, theta, disturb);
    return this.raw;
  }

  // One channel, with its own noise sample — as one ADC conversion on a real board (each analogRead is a fresh
  // conversion with fresh noise, even within the same millisecond).
  readOne(i: number, t: Track, x: number, y: number, theta: number, disturb?: Disturb): number {
    const s = this.p.sensor;
    const mid = (s.whiteRaw + s.blackRaw) / 2;
    const sigma = ((Math.abs(s.blackRaw - s.whiteRaw) * s.noise_pct) / 100);
    const [px, py] = this.position(i, x, y, theta);
    const d = disturb ? disturb(px, py) : NO_DISTURB;
    const k = contrastFactor(s.height_mm + d.dh_mm);
    const half = ((s.blackRaw - s.whiteRaw) / 2) * k;
    const ambientShift = d.amb;
    // a raised sensor also sees a wider spot
    const grow = d.dh_mm > 0 ? (spotDiameter_mm({ ...s, spot_mm: 0, height_mm: s.height_mm + d.dh_mm }) / spotDiameter_mm({ ...s, spot_mm: 0 })) : 1;
    let cov = 0;
    for (const [dx, dy, w] of this.spot) cov += w * darkAt(t, px + dx * grow, py + dy * grow);
    this.coverage[i] = cov;
    const g = this.flags.mismatch ? this.gains[i] : 1;
    let v = mid + half * g * (2 * cov - 1) + ambientShift;
    if (this.flags.noise) v += sigma * this.rng.gauss();
    return Math.round(Math.max(0, Math.min(this.maxRaw, v)));
  }
}
