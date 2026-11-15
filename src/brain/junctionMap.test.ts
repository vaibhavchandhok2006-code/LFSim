import { describe, expect, it } from 'vitest';
import { Swath } from './junctionMap';

// Synthetic junctions: lines are 3.8 cm wide. The robot drives along +x (heading 0) on the line y = 0, its array
// (8 sensors, 12 mm apart, 85 mm ahead of the axle) sampling a darkness function; the junction centre is at x = 0.
type Shape = (x: number, y: number) => number;
const W = 0.019;
const seg = (ax: number, ay: number, bx: number, by: number): Shape => (x, y) => {
  const vx = bx - ax, vy = by - ay, L2 = vx * vx + vy * vy;
  const t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / L2));
  return Math.hypot(x - (ax + t * vx), y - (ay + t * vy)) <= W ? 1 : 0;
};
const ray = (deg: number, len = 0.4): Shape => seg(0, 0, len * Math.cos((deg * Math.PI) / 180), len * Math.sin((deg * Math.PI) / 180));
const union = (...s: Shape[]): Shape => (x, y) => Math.max(...s.map((f) => f(x, y)));
const incoming = seg(-0.5, 0, 0, 0);

function readJunction(shape: Shape, opts: { skewDeg?: number; channels?: number; spacing?: number; offset?: number; lateralErr?: number } = {}) {
  const ch = opts.channels ?? 8, sp = opts.spacing ?? 0.012, off = opts.offset ?? 0.085;
  const sk = ((opts.skewDeg ?? 0) * Math.PI) / 180;
  const sw = new Swath();
  // drive straight along the (possibly skewed) heading until the axle reaches the junction centre
  for (let d = -0.35; d <= 0.0001; d += 0.0006) {
    const axleX = d * Math.cos(sk), axleY = (opts.lateralErr ?? 0) + d * Math.sin(sk);
    for (let i = 0; i < ch; i += 1) {
      const lat = ((ch - 1) / 2 - i) * sp; // + = left
      const sx = axleX + off * Math.cos(sk) - lat * Math.sin(sk), sy = axleY + off * Math.sin(sk) + lat * Math.cos(sk);
      sw.add(sx, sy, shape(sx, sy), d + 0.35, sk);
    }
  }
  const half = ((ch - 1) / 2) * sp + sp / 2;
  return sw.read(0, 0, sk, sp / 2, half, off).branches.map(Math.round);
}

describe('junction map from the sensor swath', () => {
  it('reads a T (left and right, no straight)', () => {
    const b = readJunction(union(incoming, seg(0, -0.4, 0, 0.4)));
    expect(b.length).toBe(2);
    expect(b[0]).toBeGreaterThan(70); expect(b[1]).toBeLessThan(-70);
  });
  it('reads a cross', () => {
    const b = readJunction(union(incoming, seg(0, -0.4, 0, 0.4), ray(0)));
    expect(b.length).toBe(3);
    expect(Math.abs(b[1])).toBeLessThan(15);
  });
  it('reads a left corner and a right corner', () => {
    expect(readJunction(union(incoming, ray(90)))).toHaveLength(1);
    expect(readJunction(union(incoming, ray(90)))[0]).toBeGreaterThan(70);
    expect(readJunction(union(incoming, ray(-90)))[0]).toBeLessThan(-70);
  });
  it('separates a 45° branch from the straight line', () => {
    const b = readJunction(union(incoming, ray(0), ray(45)));
    expect(b).toHaveLength(2);
    expect(b[0]).toBeGreaterThan(30); expect(b[0]).toBeLessThan(72);
    expect(Math.abs(b[1])).toBeLessThan(15);
  });
  it('ignores a line 4 cm away that is not connected', () => {
    // straight on, plus a parallel stub on the left separated by a 4 cm white gap
    const b = readJunction(union(incoming, ray(0), seg(-0.1, 0.019 + 0.04 + 0.019, 0.2, 0.019 + 0.04 + 0.019)));
    expect(b).toEqual([expect.any(Number)]);
    expect(Math.abs(b[0])).toBeLessThan(15);
  });
  it('is not fooled by arriving 15° crooked', () => {
    const b = readJunction(union(incoming, seg(0, -0.4, 0, 0.4)), { skewDeg: 15 });
    expect(b.length).toBe(2);
    expect(b[0]).toBeGreaterThan(65); expect(b[0]).toBeLessThan(115);
    expect(b[1]).toBeLessThan(-65); expect(b[1]).toBeGreaterThan(-115);
  });
  it('works with a long sensor arm and wider spacing (117 mm, 15 mm)', () => {
    const b = readJunction(union(incoming, ray(90), ray(0)), { offset: 0.117, spacing: 0.015 });
    expect(b).toHaveLength(2);
  });
});
