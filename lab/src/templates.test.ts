import { describe, expect, it } from 'vitest';
import { loadCompetition } from './competition';
import { generateTemplateTrack, levelFor, loadTemplate } from './tracks';
import { templateVariant } from './templates';
import { renderMaze } from '../../src/track/generate';
import { DEFAULT_TEMPLATE } from './tracksets';

const c = loadCompetition();

describe('variations of a real maze', () => {
  it('traces the Shaastra sample into lines with a start and a finish square', () => {
    const t = loadTemplate(DEFAULT_TEMPLATE);
    expect(t.lines.length).toBeGreaterThan(60);
    expect(t.start.x).toBeLessThan(0.4); // top-left corner on the sample
    expect(t.finish.x).toBeGreaterThan(2);
  });

  it('is reproducible: the same seed gives the same pixels', () => {
    const t = loadTemplate(DEFAULT_TEMPLATE);
    const a = renderMaze(templateVariant(t, { seed: 5, level: 'normal', size_m: 4, lineWidth_cm: [3, 4] }), 0.008).gray;
    const b = renderMaze(templateVariant(t, { seed: 5, level: 'normal', size_m: 4, lineWidth_cm: [3, 4] }), 0.008).gray;
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it('easy, normal and hard variations all pass the rule checks on the 4 m mat; easy has fewer dead ends than hard', () => {
    const levels = new Set<string>();
    const dead: Record<string, number[]> = { easy: [], normal: [], hard: [] };
    for (let s = 1; s <= 10; s += 1) {
      const v = generateTemplateTrack(s, c, [DEFAULT_TEMPLATE]);
      expect(v.check.problems).toEqual([]);
      expect(v.track.w * v.track.res).toBeCloseTo(4, 2);
      levels.add(v.level);
      dead[v.level].push(v.check.deadEnds);
      expect(levelFor(s)).toBe(v.level);
    }
    expect(levels.size).toBe(3);
    const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    expect(mean(dead.easy)).toBeLessThan(mean(dead.hard));
  }, 300_000);
});
