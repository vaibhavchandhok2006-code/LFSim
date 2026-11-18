import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { loadCompetition, parseCompetition, timeScore } from './competition';

const text = fs.readFileSync(new URL('../competition/roborun.json', import.meta.url), 'utf8');

describe('competition profile', () => {
  it('loads the Robo-Run rules from the rulebook', () => {
    const c = loadCompetition();
    expect(c.mat.gridN).toBe(10);
    expect(c.mat.cell_cm).toBe(25);
    expect(c.mat.lineWidth_cm).toEqual({ min: 3, max: 4 });
    expect(c.bot.maxLength_mm).toBe(200);
    expect(c.session.access_s).toBe(600);
    expect(c.session.reentryAbortsRun).toBe(true);
  });
  // The rulebook's example prints 54 s, but its own formula gives 40 + (2/20)·40 + 3·2 + 2·3 = 56 s (an arithmetic slip
  // in the rulebook; see DECISIONS.md). The formula is followed.
  it("follows the rulebook's formula on its worked example (40 s, 2 off-line, 3 restarts, 2 adjustments)", () => {
    expect(timeScore(loadCompetition(), 40, 2, 3, 2)).toBeCloseTo(56, 9);
    expect(timeScore(loadCompetition(), 40, 0, 0, 0)).toBe(40);
  });
  it('rejects a wrong schema, version, ranges and types', () => {
    const bad = (f: (j: any) => void) => { const j = JSON.parse(text); f(j); return () => parseCompetition(JSON.stringify(j)); };
    expect(bad((j) => { j.schema = 'x'; })).toThrow(/schema/);
    expect(bad((j) => { j.version = 2; })).toThrow(/version/);
    expect(bad((j) => { j.mat.gridN = 1000; })).toThrow(/gridN/);
    expect(bad((j) => { j.mat.lineWidth_cm.max = 2; })).toThrow(/max/);
    expect(bad((j) => { j.scoring.restartCounts = 'never'; })).toThrow(/restartCounts/);
    expect(bad((j) => { j.operator.estimate = false; })).toThrow(/estimate/);
    expect(bad((j) => { j.bot.maxWidth_mm = '200'; })).toThrow(/maxWidth/);
    expect(() => parseCompetition('x'.repeat(300_000))).toThrow(/too large/);
  });
});
