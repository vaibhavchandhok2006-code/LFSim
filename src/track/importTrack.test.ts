import { describe, expect, it } from 'vitest';
import { loadSampleTrack } from '../testutil';
import { edt } from './importTrack';

describe('distance transform', () => {
  it('matches exact distances on a small grid', () => {
    const w = 7, h = 5, src = new Uint8Array(w * h);
    src[2 * w + 3] = 1;
    const d = edt(src, w, h);
    expect(d[2 * w + 3]).toBe(0);
    expect(d[2 * w + 6]).toBeCloseTo(3);
    expect(d[0]).toBeCloseTo(Math.hypot(3, 2));
  });
});

describe('Robo-Run sample import', () => {
  const t = loadSampleTrack();

  it('scales to 2.5 m at 2 mm per pixel', () => {
    expect(t.w).toBe(1250);
    expect(t.h).toBe(1250);
  });

  it('measures a sensible line width in the image', () => {
    expect(t.measuredLineWidth_cm).toBeGreaterThan(2);
    expect(t.measuredLineWidth_cm).toBeLessThan(4.5);
  });

  it('finds the start square top-left and the finish square bottom-right', () => {
    expect(t.start).not.toBeNull();
    expect(t.finish).not.toBeNull();
    expect((t.start!.x0 + t.start!.x1) / 2).toBeLessThan(t.w * 0.2);
    expect((t.start!.y0 + t.start!.y1) / 2).toBeLessThan(t.h * 0.2);
    expect((t.finish!.x0 + t.finish!.x1) / 2).toBeGreaterThan(t.w * 0.8);
    expect((t.finish!.y0 + t.finish!.y1) / 2).toBeGreaterThan(t.h * 0.8);
  });

  it('starts facing right, out of the start square', () => {
    expect(Math.abs(t.startPose.theta)).toBeLessThan(0.01);
  });

  it('normalises the line to about 3.8 cm', () => {
    // walk across a vertical line segment: the left edge of the big left rectangle
    const y = Math.round(t.h * 0.55);
    let best = 0, run = 0;
    for (let x = 0; x < t.w * 0.2; x += 1) {
      if (t.dark[y * t.w + x] > 0.5) { run += 1; best = Math.max(best, run); } else run = 0;
    }
    expect(best * t.res * 100).toBeGreaterThan(3.4);
    expect(best * t.res * 100).toBeLessThan(4.2);
  });
});
