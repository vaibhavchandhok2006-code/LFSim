import { describe, expect, it } from 'vitest';
import { loadCompetition, type Competition } from './competition';
import { runSession, type SessionPlan } from './session';
import { trackFromMaze } from './tracks';
import { loadGridMaze } from '../../src/testutil';
import { DEFAULTS } from '../../src/ui/persist';
import type { GeneratedMaze } from '../../src/track/generate';
import type { Track } from '../../src/track/track';

const app = structuredClone(DEFAULTS);
const base = (track: Track, memory: Record<string, unknown> = {}, settings = {}) => ({
  track, profile: app.profile, brain: { mode: 'settings' as const, settings: { ...app.settings, algorithm: 'lsrb' as const, ...settings } },
  flags: app.flags, disturbances: app.disturbances, offLine_cm: app.offLine_cm, memory,
});
const plan: SessionPlan = { explore: { name: 'explore', settings: { baseSpeed: 0.3 } }, memory: [{ name: 'mem-0.4', settings: { baseSpeed: 0.4 } }, { name: 'mem-0.55', settings: { baseSpeed: 0.55 } }] };
const comp = (f: (c: Competition) => void = () => {}) => { const c = loadCompetition(); f(c); return c; };

// A dead-end line out of the start square: the robot turns round at the end and drives back into the start square.
const deadEnd = (): Track => {
  const m: GeneratedMaze = {
    seed: 0, size_m: 2.5, lineWidth_m: 0.035, corner: 'top-left', features: {}, nodes: 0, edges: 0, loops: 0, attempts: 0,
    elements: [{ owner: 'a', pts: [[0.125, 0.125], [0.9, 0.125]] }, { owner: 'b', pts: [[2.1, 2.125], [2.0, 2.125]] }],
    start: { x: 0.125, y: 0.125, side: 0.2 }, finish: { x: 2.25, y: 2.125, side: 0.2 },
  };
  return trackFromMaze(m, 'dead-end').track;
};

describe('session simulation (Robo-Run rules)', () => {
  it('explores, then runs from memory at faster switch settings; official time = best time score', async () => {
    const r = await runSession({ competition: comp(), seed: 1, base: base(loadGridMaze()), plan });
    expect(r.finished).toBe(true);
    expect(r.runs[0].phase).toBe('explore');
    expect(r.runs[1].phase).toBe('memory');
    expect(r.runs[1].runTime_s!).toBeLessThan(r.runs[0].runTime_s! * 0.5);
    const scores = r.runs.filter((x) => x.score_s !== null).map((x) => x.score_s!);
    expect(r.officialTime_s).toBe(Math.min(...scores));
    expect(r.runs.at(-1)!.end).toBe('session-over'); // the run cut by the 10-minute limit does not count
    expect(r.runs.at(-1)!.score_s).toBeNull();
    expect(r.sessionUsed_s).toBeLessThanOrEqual(600);
  }, 120_000);

  it('re-entering the start square aborts the run and counts a restart; never reaching the finish is reported', async () => {
    const r = await runSession({ competition: comp(), seed: 1, base: base(deadEnd(), {}, { algorithm: 'left-hand' }), plan });
    expect(r.finished).toBe(false);
    expect(r.runs[0].end).toBe('reentry');
    expect(r.restarts).toBe(r.runs.filter((x) => x.end === 'reentry').length);
    expect(r.closestToFinish_m).toBeGreaterThan(1);
  }, 120_000);

  it('restart penalty: 2 s per restart counted before the run (rule switchable)', async () => {
    const c = comp((x) => { x.scoring.restartCounts = 'all-runs-before'; });
    const r = await runSession({ competition: c, seed: 1, base: base(loadGridMaze()), plan });
    for (const run of r.runs.filter((x) => x.score_s !== null)) {
      expect(run.restartsBefore).toBe(run.index);
      expect(run.score_s!).toBeCloseTo(run.runTime_s! * (1 + run.offLine / 20) + 2 * run.index, 2);
    }
  }, 120_000);

  it('the 10-minute limit includes setup: a session too short for the exploration run has no valid time', async () => {
    const short = await runSession({ competition: comp((x) => { x.session.access_s = 60; }), seed: 1, base: base(loadGridMaze()), plan });
    expect(short.finished).toBe(false);
    expect(short.runs[0].end).toBe('session-over');
    const enough = await runSession({ competition: comp((x) => { x.session.access_s = 90; }), seed: 1, base: base(loadGridMaze()), plan });
    expect(enough.finished).toBe(true);
    expect(enough.runs.length).toBe(1);
  }, 120_000);

  it('a robot that never leaves the start square is not a run and not a restart', async () => {
    const r = await runSession({ competition: comp((x) => { x.session.access_s = 60; }), seed: 1, base: base(loadGridMaze(), {}, { baseSpeed: 0, maxSpeed: 0, turnSpeed: 0 }), plan: { ...plan, explore: { name: 'explore', settings: { baseSpeed: 0 } } } });
    expect(r.runs[0].end).toBe('never-left');
    expect(r.restarts).toBe(0);
  }, 120_000);

  it('is reproducible, and placement varies between runs', async () => {
    const a = await runSession({ competition: comp((x) => { x.session.access_s = 150; }), seed: 3, base: base(loadGridMaze()), plan });
    const b = await runSession({ competition: comp((x) => { x.session.access_s = 150; }), seed: 3, base: base(loadGridMaze()), plan });
    expect(b).toEqual(a);
    const times = a.runs.filter((x) => x.phase === 'memory' && x.runTime_s !== null).map((x) => x.runTime_s);
    expect(new Set(times).size).toBe(times.length); // no two runs identical
  }, 120_000);
});
