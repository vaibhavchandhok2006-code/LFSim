import { describe, expect, it } from 'vitest';
import { loadCompetition } from './competition';
import { generateTrack, checkTrack, trackFromMaze } from './tracks';
import { generateMaze, renderMaze } from '../../src/track/generate';
import { buildGraph } from '../../src/track/graph';
import { loadGridMaze } from '../../src/testutil';

const c = loadCompetition();

describe('track generator', () => {
  it('is reproducible: the same seed gives the same pixels', () => {
    const a = renderMaze(generateMaze({ seed: 42 }), 0.004).gray, b = renderMaze(generateMaze({ seed: 42 }), 0.004).gray;
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    const d = renderMaze(generateMaze({ seed: 43 }), 0.004).gray;
    expect(Buffer.from(a).equals(Buffer.from(d))).toBe(false);
  });

  it('makes tracks that pass every rulebook check (12 seeds)', () => {
    const corners = new Set<string>();
    for (let s = 1; s <= 12; s += 1) {
      const t = generateTrack(s, c);
      expect(t.check.problems).toEqual([]);
      expect(t.track.measuredLineWidth_cm).toBeGreaterThanOrEqual(2.75);
      expect(t.track.measuredLineWidth_cm).toBeLessThanOrEqual(4.25);
      expect(t.check.cycles).toBeGreaterThanOrEqual(2);
      corners.add(t.maze.corner);
    }
    expect(corners.size).toBeGreaterThanOrEqual(3); // the start corner varies
  }, 120_000);

  it('the checker rejects a maze a wall follower solves easily, and a track without a finish', () => {
    // The hand-made grid maze in the tests is a perfect maze (no loops): one path only.
    const grid = loadGridMaze();
    const g = buildGraph(grid);
    expect(checkTrack(grid, g, c).problems.join(' ')).toMatch(/only one path/);
    const maze = generateMaze({ seed: 5 });
    const { track } = trackFromMaze({ ...maze, finish: { ...maze.finish, side: 0 } }, 'nofinish');
    expect(checkTrack(track, buildGraph(track), c).problems.join(' ')).toMatch(/no finish square/);
  }, 60_000);
});
