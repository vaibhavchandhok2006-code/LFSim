import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { loadCompetition, parseCompetition, timeScore, checkpointScore } from './competition';

const file27 = new URL('../competition/roborun-2027.json', import.meta.url);
const file26 = new URL('../competition/roborun-2026.json', import.meta.url);
const text = fs.readFileSync(file27, 'utf8');

describe('competition profile', () => {
  it('loads the Robo-Run 2027 rules by default', () => {
    const c = loadCompetition();
    expect(c.id).toBe('roborun-2027');
    expect(c.mat.gridN).toBe(16); // 16 × 16 squares of 25 cm = 4 m
    expect(c.mat.cell_cm).toBe(25);
    expect(c.mat.lineWidth_cm).toEqual({ min: 3, max: 4 });
    expect(c.bot.maxLength_mm).toBe(200);
    expect(c.bot.cameraAllowed).toBe(false);
    expect(c.session.access_s).toBe(600);
    expect(c.session.calibration_s).toBe(60);
    expect(c.session.dryRunAllowed).toBe(true);
    expect(c.scoring.switchChangeIsAdjustment).toBe(true);
    expect(c.checkpoints.used).toBe(true);
  });
  it("first round: the rulebook's example (40 s, 2 line crossings, 3 restarts, 4 adjustments) = 68 s", () => {
    expect(timeScore(loadCompetition(), 40, 2, 3, 4)).toBe(68);
  });
  it("final round: the rulebook's example (… 1 restart, 4 adjustments, 2 blocks uncleared) = 108 s", () => {
    expect(timeScore(loadCompetition(file27, 'final'), 40, 2, 1, 4, 2)).toBe(108);
  });
  it('2026 edition kept: 10 × 10 grid, off-line as a share of run time (its example computes to 56 s, printed 54 s)', () => {
    const c = loadCompetition(file26);
    expect(c.mat.gridN).toBe(10);
    expect(timeScore(c, 40, 2, 3, 2)).toBeCloseTo(56, 9);
  });
  it('non-finishers: (time + penalties) / C', () => {
    expect(checkpointScore(loadCompetition(), 100, 1, 0, 0, 3)).toBeCloseTo(35, 9);
    expect(checkpointScore(loadCompetition(file26), 100, 1, 0, 0, 3)).toBeNull();
  });
  it('rejects a wrong schema, version, ranges and types', () => {
    const bad = (f: (j: any) => void) => { const j = JSON.parse(text); f(j); return () => parseCompetition(JSON.stringify(j)); };
    expect(bad((j) => { j.schema = 'x'; })).toThrow(/schema/);
    expect(bad((j) => { j.version = 1; })).toThrow(/version/);
    expect(bad((j) => { j.mat.gridN = 1000; })).toThrow(/gridN/);
    expect(bad((j) => { j.mat.lineWidth_cm.max = 2; })).toThrow(/max/);
    expect(bad((j) => { j.rounds.first.restartCounts = 'never'; })).toThrow(/restartCounts/);
    expect(bad((j) => { j.rounds.final.offLineDivisor = 20; })).toThrow(/exactly one/);
    expect(bad((j) => { j.operator.estimate = false; })).toThrow(/estimate/);
    expect(bad((j) => { j.bot.maxWidth_mm = '200'; })).toThrow(/maxWidth/);
    expect(() => parseCompetition(text, 'semi' as never)).toThrow(/round/);
    expect(() => parseCompetition('x'.repeat(300_000))).toThrow(/too large/);
  });
});
