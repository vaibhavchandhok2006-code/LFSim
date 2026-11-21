import { describe, expect, it } from 'vitest';
import { Qmc5883l, headingField, FIELD_H_GAUSS } from './qmc5883l';

const int16 = (lo: number, hi: number) => ((lo | (hi << 8)) << 16) >> 16;
function xy(chip: Qmc5883l, t: number, theta: number) {
  chip.write([0x00]);
  const b = chip.read(6, t, theta);
  return [int16(b[0], b[1]), int16(b[2], b[3]), int16(b[4], b[5])];
}

describe('QMC5883L model', () => {
  it('reads zeros until continuous mode is set, then the field at the set range', () => {
    const c = new Qmc5883l(true);
    expect(xy(c, 0, 0)).toEqual([0, 0, 0]);
    c.write([0x09, 0x1d]); // continuous, 200 Hz, 8 G
    const [x, y] = xy(c, 0.01, 0);
    expect(Math.hypot(x, y)).toBeCloseTo(FIELD_H_GAUSS * 3000, -1);
    c.write([0x09, 0x0d]); // 2 G range: 4x the counts
    const [x2, y2] = xy(c, 0.02, 0);
    expect(Math.hypot(x2, y2)).toBeCloseTo(FIELD_H_GAUSS * 12000, -1);
    c.write([0x0d]);
    expect(c.read(1, 0.02, 0)).toEqual([0xff]); // chip ID
  });

  it('heading from atan2(y, x) grows on a right (clockwise) turn with the Y arrow left, and shrinks with it right', () => {
    const left = new Qmc5883l(true), right = new Qmc5883l(false);
    left.write([0x09, 0x1d]); right.write([0x09, 0x1d]);
    const h = (c: Qmc5883l, th: number, t: number) => { const [x, y] = xy(c, t, th); return Math.atan2(y, x); };
    const d = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
    // theta grows clockwise in the image frame (y down)
    expect(d(h(left, 0.3, 0.1), h(left, 0, 0.0))).toBeCloseTo(0.3, 2);
    expect(d(h(right, 0.3, 0.1), h(right, 0, 0.0))).toBeCloseTo(-0.3, 2);
  });

  it('holds data between output-data-rate ticks (10 Hz)', () => {
    const c = new Qmc5883l(true);
    c.write([0x09, 0x01]); // continuous, 10 Hz
    const a = xy(c, 0.0, 0);
    expect(xy(c, 0.05, 1.0)).toEqual(a);     // same 100 ms sample
    expect(xy(c, 0.1, 1.0)).not.toEqual(a);  // next sample
  });

  it('field components follow the documented mounting', () => {
    const [x, y] = headingField(-Math.PI / 2, true); // facing up the image = north
    expect(x).toBeCloseTo(FIELD_H_GAUSS); expect(y).toBeCloseTo(0);
  });
});
