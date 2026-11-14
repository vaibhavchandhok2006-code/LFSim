import { describe, expect, it } from 'vitest';
import { loadSampleTrack } from '../testutil';
import { Simulation } from '../sim/simulation';
import { DEFAULT_PROFILE } from '../sim/profile';
import { Algorithm, DEFAULT_SETTINGS, SettingsBrain } from './settings';

const t = loadSampleTrack();
function run(algorithm: Algorithm, seconds: number, memory: Record<string, unknown> = {}) {
  const sim = new Simulation(t, DEFAULT_PROFILE, new SettingsBrain({ ...DEFAULT_SETTINGS, algorithm }), undefined, undefined, memory);
  sim.advance(seconds);
  return sim;
}

describe('physical maze runs on the Robo-Run sample (Settings mode defaults)', () => {
  it('left-hand reaches the finish and the code recognises it', () => {
    const s = run('left-hand', 300);
    expect(s.finishTime).not.toBeNull();
    expect(s.brain.finished()).toBe(true);
    expect(s.offLineCount).toBe(0);
  });

  it('LSRB: run 2 replays the stored branch numbers and is faster than run 1', () => {
    const mem: Record<string, unknown> = {};
    const r1 = run('lsrb', 300, mem);
    expect(r1.finishTime).not.toBeNull();
    expect((mem.lsrb as { complete: boolean }).complete).toBe(true);
    const r2 = run('lsrb', 300, mem);
    expect(r2.finishTime).not.toBeNull();
    expect(r2.runTime()!).toBeLessThan(r1.runTime()!);
    expect(r2.decisions[0].note).toContain('replay');
  });

  it('Trémaux: run 1 maps and finishes, run 2 follows the stored shortest path', () => {
    const mem: Record<string, unknown> = {};
    const r1 = run('tremaux', 400, mem);
    expect(r1.finishTime).not.toBeNull();
    const r2 = run('tremaux', 400, mem);
    expect(r2.finishTime).not.toBeNull();
    expect(r2.distance).toBeLessThanOrEqual(r1.distance * 1.02);
  });

  it('straight-first gets stuck circling (does not reach the finish in 2 minutes)', () => {
    const s = run('straight-first', 120);
    expect(s.finishTime).toBeNull();
  });

  it('the brain never receives the track: its IO has no track, graph or finish fields', () => {
    const s = run('left-hand', 0.01);
    const io = (s as unknown as { io: Record<string, unknown> }).io;
    for (const k of Object.keys(io)) expect(['track', 'graph', 'finish', 'start']).not.toContain(k);
  });
});
