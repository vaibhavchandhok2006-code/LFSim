import { describe, expect, it } from 'vitest';
import { loadSampleTrack } from '../testutil';
import { buildGraph, cancelDeadEnds, runRule, shortestPath } from './graph';

// Spec targets were measured on the same map with the maze spanning 1872 of 2048 image pixels.
// LFSim scales the whole image to 2.5 m (spec: image edges = track edges), so lengths scale by 1872/2048.
const SCALE = 1872 / 2048;
const target = (m: number) => m * SCALE;
const within = (v: number, t: number, pct: number) => Math.abs(v - t) / t <= pct / 100;

describe('junction graph of the Robo-Run sample', () => {
  const g = buildGraph(loadSampleTrack());

  it('finds every line end (12 dead ends + start + finish)', () => {
    const ends = [...g.nodes.values()].filter((n) => n.degree === 1).length;
    expect(ends).toBe(14);
    expect(g.start).not.toBeNull();
    expect(g.finish).not.toBeNull();
  });

  it('left-hand reaches the finish: ~19.8 m (scaled) and 49 decisions', () => {
    const r = runRule(g, 'left');
    expect(r.ok).toBe(true);
    expect(within(r.length_m, target(19.8), 5)).toBe(true);
    expect(r.decisions.length).toBe(49);
  });

  it('right-hand reaches the finish: ~21.5 m (scaled)', () => {
    const r = runRule(g, 'right');
    expect(r.ok).toBe(true);
    expect(within(r.length_m, target(21.5), 5)).toBe(true);
  });

  it('straight-first (left fallback) loops in the "0" of 2026', () => {
    const r = runRule(g, 'straight-left');
    expect(r.ok).toBe(false);
    expect(r.length_m).toBeLessThan(2.5);
  });

  it('LSRB run 2 (left-hand with dead ends cancelled): ~18.0 m (scaled)', () => {
    const r = cancelDeadEnds(runRule(g, 'left').route);
    const len = r.reduce((a, x) => a + g.edges[x.edge].length_m, 0);
    expect(within(len, target(18.0), 5)).toBe(true);
  });

  it('shortest path is shorter than every rule-based route', () => {
    const s = shortestPath(g);
    expect(s.ok).toBe(true);
    expect(s.length_m).toBeLessThan(cancelDeadEnds(runRule(g, 'left').route).reduce((a, x) => a + g.edges[x.edge].length_m, 0));
  });
});
