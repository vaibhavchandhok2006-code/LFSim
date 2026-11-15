import { describe, expect, it } from 'vitest';
import { loadSampleTrack } from '../testutil';
import { chooseThreshold, edt, processTrack, resampleGray } from './importTrack';
import { PRESETS } from './track';

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

describe('threshold and image shape (test report D7, D8)', () => {
  // A dim photo: grey paper at 100, line at 30. The fixed 128 would make the whole mat black.
  const W = 400;
  const dim = new Uint8ClampedArray(W * W).fill(100);
  for (let y = 190; y < 210; y += 1) for (let x = 20; x < 380; x += 1) dim[y * W + x] = 30;

  it('a clean image keeps the fixed midpoint threshold', () => {
    const clean = new Uint8ClampedArray(W * W).fill(255);
    for (let y = 190; y < 210; y += 1) for (let x = 20; x < 380; x += 1) clean[y * W + x] = 0;
    expect(chooseThreshold(resampleGray(clean, W, W, 200, 200))).toEqual({ threshold: 128, clean: true });
  });

  it('a dim image gets an Otsu threshold between paper and line', () => {
    const t = chooseThreshold(resampleGray(dim, W, W, 200, 200));
    expect(t.clean).toBe(false);
    expect(t.threshold).toBeGreaterThan(30);
    expect(t.threshold).toBeLessThan(100);
    const { track, report } = processTrack(dim, W, W, { ...PRESETS[1], width_m: 1, height_m: 1 }, { normaliseWidth: false });
    const darkShare = track.dark.reduce((a, b) => a + b, 0) / track.dark.length;
    expect(darkShare).toBeGreaterThan(0.02);
    expect(darkShare).toBeLessThan(0.1);
    expect(report.messages.join(' ')).toContain('Otsu');
  });

  it('warns when the image shape does not match the track, and a crop fixes it', () => {
    const wide = new Uint8ClampedArray(600 * 300).fill(255);
    const preset = { ...PRESETS[1], width_m: 1, height_m: 1 };
    expect(processTrack(wide, 600, 300, preset).report.messages.join(' ')).toContain('stretched');
    const cropped = processTrack(wide, 600, 300, preset, { crop: { x0: 150, y0: 0, x1: 450, y1: 300 } });
    expect(cropped.report.messages.join(' ')).not.toContain('stretched');
  });
});
