import { describe, expect, it } from 'vitest';
import { applyH, homography, quadProblem, type Quad } from './warp';
import { generateMaze, renderMaze } from './generate';
import { buildTrackFromRgba } from './buildTrack';
import { buildGraph } from './graph';
import { DEFAULT_TRACK_SETUP, parseImport, DEFAULTS } from '../ui/persist';
import { DEFAULT_PROFILE } from '../sim/profile';

describe('perspective correction', () => {
  it('the homography maps the four corners exactly', () => {
    const src: Quad = [[120, 80], [900, 140], [980, 700], [30, 610]];
    const dst: Quad = [[0, 0], [1250, 0], [1250, 1250], [0, 1250]];
    const h = homography(src, dst);
    for (let k = 0; k < 4; k += 1) {
      const [u, v] = applyH(h, src[k][0], src[k][1]);
      expect(u).toBeCloseTo(dst[k][0], 6); expect(v).toBeCloseTo(dst[k][1], 6);
    }
  });

  it('rejects crossed, reversed or degenerate corners', () => {
    expect(quadProblem([[0, 0], [10, 0], [10, 10], [0, 10]])).toBeNull();
    expect(quadProblem([[0, 0], [10, 10], [10, 0], [0, 10]])).toMatch(/cross/);
    expect(quadProblem([[0, 0], [0, 10], [10, 10], [10, 0]])).toMatch(/wrong way/);
    expect(quadProblem([[0, 0], [5, 0], [10, 0], [0, 10]])).toMatch(/line/);
  });

  it('an angled photo of a maze, flattened from its corners, gives back the same maze', () => {
    // Make a "photo": the maze seen at an angle (forward warp of a clean render into a trapezoid in a larger frame).
    const maze = generateMaze({ seed: 77 });
    const clean = renderMaze(maze, 0.004); // 625 × 625
    const PW = 900, PH = 600;
    const quad: Quad = [[300, 60], [760, 140], [860, 560], [40, 470]];
    // forward: for each photo pixel, find where it lies on the mat (inverse of quad → mat).
    const h = homography(quad, [[0, 0], [clean.width, 0], [clean.width, clean.height], [0, clean.height]]);
    const rgba = new Uint8ClampedArray(PW * PH * 4);
    for (let y = 0; y < PH; y += 1) for (let x = 0; x < PW; x += 1) {
      const [u, v] = applyH(h, x + 0.5, y + 0.5);
      const ui = Math.floor(u), vi = Math.floor(v);
      const g = ui >= 0 && vi >= 0 && ui < clean.width && vi < clean.height ? clean.gray[vi * clean.width + ui] : 140; // floor
      const i = (y * PW + x) * 4; rgba[i] = rgba[i + 1] = rgba[i + 2] = g; rgba[i + 3] = 255;
    }
    const corners = quad.map(([x, y]) => [(x / PW) * 100, (y / PH) * 100]) as [number, number][];
    const setup = { ...DEFAULT_TRACK_SETUP, normaliseWidth: false, corners };
    const { track: flat, messages } = buildTrackFromRgba(rgba, PW, PH, setup, DEFAULT_PROFILE);
    expect(messages[0]).toMatch(/Perspective corrected/);
    const cleanRgba = new Uint8ClampedArray(clean.width * clean.height * 4);
    for (let i = 0; i < clean.gray.length; i += 1) { cleanRgba[i * 4] = cleanRgba[i * 4 + 1] = cleanRgba[i * 4 + 2] = clean.gray[i]; cleanRgba[i * 4 + 3] = 255; }
    const { track: ref } = buildTrackFromRgba(cleanRgba, clean.width, clean.height, { ...DEFAULT_TRACK_SETUP, normaliseWidth: false }, DEFAULT_PROFILE);
    // Same pixels to within a thin edge band, and the same start/finish and junction count.
    let diff = 0, ink = 0;
    for (let i = 0; i < ref.dark.length; i += 1) { ink += ref.dark[i]; if (ref.dark[i] !== flat.dark[i]) diff += 1; }
    expect(diff / ink).toBeLessThan(0.12);
    expect(flat.start && ref.start).toBeTruthy();
    expect(Math.abs(flat.start!.x0 - ref.start!.x0)).toBeLessThan(6);
    const jr = [...buildGraph(ref).nodes.values()].filter((n) => n.degree >= 3).length;
    const jf = [...buildGraph(flat).nodes.values()].filter((n) => n.degree >= 3).length;
    expect(Math.abs(jf - jr)).toBeLessThanOrEqual(Math.ceil(jr * 0.1));
  }, 60_000);

  it('files: corners are checked on import', () => {
    const proj = (corners: unknown) => JSON.stringify({ lfsim: 'project', version: 1, settings: { ...DEFAULTS, track: { ...DEFAULT_TRACK_SETUP, corners } }, trackImage: null, runs: [], memory: null });
    expect(() => parseImport(proj([[0, 0], [100, 0], [100, 100], [0, 100]]))).not.toThrow();
    expect(() => parseImport(proj(null))).not.toThrow();
    expect(() => parseImport(proj([[0, 0], [100, 0], [100, 100]]))).toThrow(/four/);
    expect(() => parseImport(proj([[0, 0], [100, 100], [100, 0], [0, 100]]))).toThrow(/cross/);
    expect(() => parseImport(proj([[0, 0], [1e9, 0], [100, 100], [0, 100]]))).toThrow(/four/);
  });
});
