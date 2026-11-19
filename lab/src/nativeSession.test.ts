import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { buildFirmware } from './native';
import { loadDesign } from './design';
import { loadInputs } from './inputs';
import { runSession } from './session';
import { loadCompetition } from './competition';
import { ALL_ON } from './variations';
import { parseOperatorScript } from './firmwareSpec';

const here = (p: string) => new URL(p, import.meta.url).pathname;
const DESIGN = here('../examples/rmi-native.design.json');

describe('sessions with native firmware', () => {
  it('each run is a reset: flash carries over, switch levels follow the plan (explore → memory after a finish)', async () => {
    const d = loadDesign(DESIGN);
    const exe = buildFirmware([here('../firmware/tests/nvs_switch.c')]).exe;
    const { start } = loadInputs({ track: 'public/samples/roborun-sample.png', robot: here('../examples/rmi-test-rig.robot.json') });
    const c = loadCompetition();
    const r = await runSession({
      competition: c, seed: 1, plan: { explore: { name: 'explore', settings: {}, levels: [{ gpio: 27, level: 1 }] }, memory: [{ name: 'fast', settings: {}, levels: [{ gpio: 27, level: 0 }] }], dry_s: 60 },
      base: { ...start, flags: ALL_ON, memory: {} },
      firmware: { exe, wiring: d.firmware!.wiring, operator: { each: { presses: [] } } },
    });
    // The test firmware never drives: every run ends "did not leave the start square", and flash counts the resets.
    expect(r.runs.length).toBeGreaterThan(5);
    expect(r.runs.every((x) => x.end === 'never-left' || x.end === 'session-over')).toBe(true); // the last run may hit the session's end
    expect(r.runs.every((x) => x.switch === 'explore')).toBe(true); // never finished → never moved to memory runs
    const flash = (r.memory as { prefs: Record<string, { hex: string }> }).prefs;
    const runs = Buffer.from(flash['nvs/maze/runs'].hex, 'hex').readInt32LE(0);
    expect(runs).toBe(r.runs.length);
  }, 300_000);

  it('the RMI firmware runs whole sessions unchanged (calibrated before every run)', async () => {
    const d = loadDesign(DESIGN);
    d.firmware!.exe = buildFirmware(d.firmware!.sources).exe;
    const { start } = loadInputs({ track: 'public/samples/roborun-sample.png', robot: here('../examples/rmi-test-rig.robot.json') });
    const r = await runSession({
      competition: loadCompetition(), seed: 3, plan: d.plan, base: { ...start, flags: ALL_ON, memory: {} },
      firmware: { exe: d.firmware!.exe, wiring: d.firmware!.wiring, operator: d.firmware!.operator },
    });
    expect(r.runs.length).toBeGreaterThan(1);
    expect(r.runs.filter((x) => x.end === 'error')).toEqual([]);
    expect(r.runs.some((x) => x.end !== 'never-left')).toBe(true); // it leaves the start square after calibrating
  }, 600_000);

  it('rejects unsafe design inputs: switches on sensor pins, bad presses, missing sources', () => {
    const w = loadDesign(DESIGN).firmware!.wiring;
    expect(() => parseOperatorScript({ presses: [], levels: [{ gpio: w.sensorPins[0], level: 1 }] }, w, 'x')).toThrow(/already/);
    expect(() => parseOperatorScript({ presses: [{ gpio: 4, at_s: -1 }] }, w, 'x')).toThrow(/at_s/);
    expect(() => parseOperatorScript({ presses: [], sweep: { from_s: 3, to_s: 1 } }, w, 'x')).toThrow(/sweep/);
    expect(path.isAbsolute(loadDesign(DESIGN).firmware!.sources[0])).toBe(true);
  });
});
