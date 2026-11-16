import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadInputs } from './inputs';
import { runHeadless } from './headless';
import { main } from './cli';
import { DEFAULTS } from '../../src/ui/persist';

const SAMPLE = 'public/samples/roborun-sample.png';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-'));

describe('headless runs (LFSim Lab Phase 0)', () => {
  it('give the same log however the run is chunked', async () => {
    const csv = async (chunk: number) => {
      const { start } = loadInputs({ track: SAMPLE, algorithm: 'left-hand' });
      return (await runHeadless(start, { seconds: 8, chunk_s: chunk, stopAtFinish: false })).engine.csv(Infinity);
    };
    const a = await csv(2);
    expect(a.split('\n').length).toBeGreaterThan(3000);
    expect(await csv(0.37)).toBe(a);
    expect(await csv(8)).toBe(a);
  }, 60000);

  it('a project file gives the same run as the same settings given directly', async () => {
    const image = `data:image/png;base64,${fs.readFileSync(SAMPLE).toString('base64')}`;
    const settings = structuredClone(DEFAULTS);
    settings.settings.algorithm = 'right-hand';
    settings.disturbances = { lighting: { on: true, strength: 0.5 }, bumps: { on: false, strength: 0 }, seed: 42 };
    const proj = path.join(tmp, 'p.lfsim.json');
    fs.writeFileSync(proj, JSON.stringify({ lfsim: 'project', version: 1, settings, trackImage: image, runs: [] }));
    const viaProject = await runHeadless(loadInputs({ project: proj }).start, { seconds: 5 });
    const direct = loadInputs({ track: SAMPLE, algorithm: 'right-hand', seed: 42 });
    direct.start.disturbances = settings.disturbances;
    const viaFlags = await runHeadless(direct.start, { seconds: 5 });
    expect(viaProject.engine.csv(Infinity)).toBe(viaFlags.engine.csv(Infinity));
  }, 60000);

  it('the command line writes the CSV and summary and reports the run', async () => {
    const csv = path.join(tmp, 'out.csv'), json = path.join(tmp, 'out.json');
    const code = await main(['run', '--track', SAMPLE, '--seconds', '3', '--csv', csv, '--json', json]);
    expect(code).toBe(0);
    expect(fs.readFileSync(csv, 'utf8').split('\n')[0]).toContain('time_s,x_m,y_m');
    const s = JSON.parse(fs.readFileSync(json, 'utf8'));
    expect(s.status).toBe('time-limit');
    expect(s.simTime_s).toBeCloseTo(3, 2);
    expect(s.runTime_s).toBeNull();
  }, 60000);

  it('refuses bad input with a clear message', async () => {
    const jpg = path.join(tmp, 't.jpg');
    fs.writeFileSync(jpg, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0]));
    expect(() => loadInputs({ track: jpg })).toThrow('only PNG');
    expect(() => loadInputs({})).toThrow('No track image');
    await expect(main(['run', '--track', SAMPLE, '--bogus'])).rejects.toThrow('Unknown option --bogus');
    await expect(main(['run', '--track', SAMPLE, '--algorithm', 'zigzag'])).rejects.toThrow('--algorithm must be one of');
    await expect(main(['run', '--track', SAMPLE, '--seconds', '9999'])).rejects.toThrow('between 0 and 600');
    const bad = path.join(tmp, 'bad.robot.json');
    fs.writeFileSync(bad, JSON.stringify({ ...DEFAULTS.profile, mass_g: 0 }));
    expect(() => loadInputs({ track: SAMPLE, robot: bad })).toThrow('out of range');
  });
});
