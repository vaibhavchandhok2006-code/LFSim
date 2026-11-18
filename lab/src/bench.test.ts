import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadCompetition } from './competition';
import { makeTrackSet, loadTrackSet, loadSetTrack, recheckSet } from './tracksets';
import { generateTrack } from './tracks';
import { designFromRobot } from './design';
import { runBench, summarise, wilson } from './bench';
import { writeResults } from './report';
import { loadInputs } from './inputs';
import { runHeadless } from './headless';
import { parseImport } from '../../src/ui/persist';

// The 2026 rules (2.5 m mazes) keep this test quick; the 2027 4 m mazes are covered in tracks.test.ts.
const c = loadCompetition(new URL('../competition/roborun-2026.json', import.meta.url));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-set-'));
const design = designFromRobot(new URL('../examples/rmi-test-rig.robot.json', import.meta.url).pathname, { algorithm: 'tremaux' });

beforeAll(async () => { await makeTrackSet(dir, 'test-set', c, { tune: 2, held: 3 }, undefined, 0); }, 600_000);

describe('track sets', () => {
  it('keeps tuning and held-out tracks apart and every track passes the checks', () => {
    const m = loadTrackSet(dir);
    expect(m.entries.filter((e) => e.part === 'tune').length).toBe(2);
    expect(m.entries.filter((e) => e.part === 'held').length).toBe(3);
    const tune = new Set(m.entries.filter((e) => e.part === 'tune').map((e) => Math.floor(e.seed / 1000)));
    for (const e of m.entries.filter((x) => x.part === 'held')) expect(tune.has(Math.floor(e.seed / 1000))).toBe(false);
    expect(recheckSet(dir, c).every((r) => r.problems.length === 0)).toBe(true);
  }, 120_000);

  it('a saved track loads back exactly as generated', () => {
    const m = loadTrackSet(dir);
    const e = m.entries[0];
    const fromFile = loadSetTrack(dir, e);
    const fresh = generateTrack(Math.floor(e.seed / 1000), c).track;
    expect(Buffer.from(fromFile.dark.buffer).equals(Buffer.from(fresh.dark.buffer))).toBe(true);
    expect(fromFile.startPose).toEqual(fresh.startPose);
  }, 60_000);

  it('rejects a manifest that mixes the parts or names files outside the set', () => {
    const bad = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-bad-'));
    const m = loadTrackSet(dir);
    fs.writeFileSync(path.join(bad, 'manifest.json'), JSON.stringify({ ...m, entries: [{ ...m.entries[0], file: '../../etc/passwd' }] }));
    expect(() => loadTrackSet(bad)).toThrow(/bad track file name/);
    fs.writeFileSync(path.join(bad, 'manifest.json'), JSON.stringify({ ...m, entries: [m.entries[0], { ...m.entries[0], id: 'held-0009', part: 'held' }] }));
    expect(() => loadTrackSet(bad)).toThrow(/shares a seed/);
  });
});

describe('benchmark', () => {
  it('gives the same results in one thread and on worker threads; writes a results folder; failed runs replay exactly', async () => {
    const one = await runBench({ setDir: dir, part: 'held', design, competition: c, variations: 2, workers: 0 });
    const par = await runBench({ setDir: dir, part: 'held', design, competition: c, variations: 2, workers: 2 });
    expect(par.map((r) => r.result)).toEqual(one.map((r) => r.result));
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-res-'));
    const summary = summarise(one, { setDir: dir, part: 'held' }, 1);
    expect(summary.sessions).toBe(6);
    writeResults(out, { results: one, summary, design, competition: c, setDir: dir, part: 'held', variations: 2, command: 'test' });
    for (const f of ['summary.json', 'benchmark.csv', 'runs.csv', 'design.json', 'report.html']) expect(fs.existsSync(path.join(out, f))).toBe(true);
    expect(fs.readFileSync(path.join(out, 'benchmark.csv'), 'utf8').trim().split('\n').length).toBe(7);
    // Replay: a failed run's project file, run headless for the same time, ends at the same place.
    const projects = fs.readdirSync(path.join(out, 'projects'));
    let replayed = 0;
    for (const p of projects.slice(0, 3)) {
      const file = path.join(out, 'projects', p);
      expect(parseImport(fs.readFileSync(file, 'utf8')).kind).toBe('project');
      const [, trackId, v, run] = /^(.+)-v(\d)-run(\d+)\.lfsim\.json$/.exec(p)!;
      const rec = one.find((r) => r.trackId === trackId && r.variation === Number(v))!.result!.runs[Number(run)];
      if (rec.phase !== 'explore') continue;
      const { start } = loadInputs({ project: file });
      const { engine } = await runHeadless(start, { seconds: rec.elapsed_s, stopAtFinish: false });
      expect(Math.hypot(engine.sim.body.x - rec.where.x, engine.sim.body.y - rec.where.y)).toBeLessThan(0.02);
      replayed += 1;
    }
    expect(replayed).toBeGreaterThanOrEqual(1);
  }, 600_000);

  it('Wilson interval', () => {
    expect(wilson(0, 0)).toEqual([0, 0]);
    const [lo, hi] = wilson(190, 200);
    expect(lo).toBeGreaterThan(0.9); expect(lo).toBeLessThan(0.95); expect(hi).toBeGreaterThan(0.95);
  });
});
