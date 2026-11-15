import { describe, expect, it } from 'vitest';
import { Engine } from './engine';
import { loadGridMaze } from '../testutil';
import { DEFAULT_PROFILE } from '../sim/profile';
import { DEFAULT_FLAGS } from '../sim/simulation';
import { DEFAULT_SETTINGS } from '../brain/settings';

// Test report D15: the CSV must carry every junction decision and a wrapped heading.
describe('CSV log', () => {
  it('lists every decision once and keeps heading within ±180°', async () => {
    const e = new Engine({
      type: 'start', runId: 1, track: loadGridMaze(), profile: DEFAULT_PROFILE, brain: { mode: 'settings', settings: { ...DEFAULT_SETTINGS, algorithm: 'left-hand' } },
      flags: DEFAULT_FLAGS, disturbances: { lighting: { on: false, strength: 0 }, bumps: { on: false, strength: 0 }, seed: 1 }, offLine_cm: 4, memory: {},
    });
    for (let t = 0; t < 30 && e.status === 'running'; t += 1) await e.advance(t + 1);
    const lines = e.csv(1e9).split('\n');
    const head = lines[0].split(','), hi = head.indexOf('heading_deg');
    const rows = lines.slice(1).map((l) => l.split(','));
    const decs = rows.map((r) => r[r.length - 1]).filter(Boolean).flatMap((d) => d.split('|'));
    expect(e.sim.decisions.length).toBeGreaterThan(5);
    expect(decs).toEqual(e.sim.decisions.map((d) => d.kind));
    for (const r of rows) { const h = Number(r[hi]); expect(h).toBeGreaterThanOrEqual(-180); expect(h).toBeLessThanOrEqual(180); }
  }, 120000);
});
