import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { buildFirmware, NativeFirmwareBrain } from './native';
import { loadInputs } from './inputs';
import { runHeadless } from './headless';
import { loadTrackSet, loadSetTrack, makeTrackSet } from './tracksets';
import { loadCompetition } from './competition';
import type { StartMsg, Wiring } from '../../src/worker/protocol';
import os from 'node:os';
import path from 'node:path';

const REF = new URL('../firmware/examples/reference/main/', import.meta.url).pathname;
const RIG = new URL('../firmware/examples/rmi-test-rig/main/main.c', import.meta.url).pathname;
const ROBOT = new URL('../examples/rmi-test-rig.robot.json', import.meta.url).pathname;
// The reference firmware is written for a 1 kHz FreeRTOS tick (pdMS_TO_TICKS(2) = 2), like Code mode assumes.
let refExe = '';
beforeAll(() => { refExe = buildFirmware([path.join(REF, 'main.c')], { defines: ['CONFIG_FREERTOS_HZ=1000'] }).exe; }, 120_000);

// Same track, robot and settings; one run as the JavaScript translation (Code mode), one as the compiled C.
const wiringOf = (dir: string): Wiring => JSON.parse(fs.readFileSync(path.join(dir, 'wiring.json'), 'utf8'));
async function both(track: string | null, trackObj: StartMsg['track'] | null, seconds: number) {
  const { start } = loadInputs({ ...(track ? { track } : { track: 'public/samples/roborun-sample.png' }), robot: ROBOT });
  const wiring = wiringOf(REF);
  const code = fs.readFileSync(path.join(REF, 'main.js'), 'utf8');
  const js = { ...start, ...(trackObj ? { track: trackObj } : {}), brain: { mode: 'code' as const, code, wiring } };
  const a = await runHeadless(js, { seconds, stopAtFinish: false });
  const b = await runHeadless(js, { seconds, stopAtFinish: false, firmware: (m) => new NativeFirmwareBrain(refExe, wiring, m.profile, null) });
  return { js: a, c: b };
}

describe('native firmware in the loop', () => {
  it('reference firmware: compiled C and its JavaScript translation give identical runs (sample + 19 generated tracks)', async () => {
    // A small set of 4 m variations, made for the test.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'native-set-'));
    await makeTrackSet(dir, 't', loadCompetition(), { tune: 19, held: 0 }, undefined, 0);
    const m = loadTrackSet(dir);
    const tracks = [null, ...m.entries.map((e) => loadSetTrack(dir, e))];
    let rows = 0;
    for (const t of tracks) {
      const { js, c } = await both(null, t, 12);
      expect(c.summary.status, c.summary.error ?? '').not.toBe('error');
      const cj = js.engine.csv(Infinity), cc = c.engine.csv(Infinity);
      expect(cc.split('\n').length).toBeGreaterThan(1000);
      expect(cc).toBe(cj);
      expect(c.summary.distance_m).toBe(js.summary.distance_m);
      rows += cc.split('\n').length;
    }
    expect(rows).toBeGreaterThan(20 * 1000);
  }, 900_000);

  it("runs the RMI firmware unchanged: button presses start calibration, the sweep calibrates, the third press runs", async () => {
    const exe = buildFirmware([RIG]).exe;
    const { start } = loadInputs({ track: 'public/samples/roborun-sample.png', robot: ROBOT });
    const wiring = wiringOf(path.dirname(RIG));
    const operator = { presses: [{ gpio: 4, at_s: 0.3 }, { gpio: 4, at_s: 3.8 }, { gpio: 4, at_s: 4.3 }], sweep: { from_s: 0.5, to_s: 3.6 } };
    const lines: string[] = [];
    const msg = { ...start, brain: { mode: 'code' as const, code: '', wiring }, operator };
    const { engine, summary } = await runHeadless(msg, { seconds: 10, stopAtFinish: false, firmware: (m) => {
      const b = new NativeFirmwareBrain(exe, wiring, m.profile, operator);
      return b;
    } });
    void lines;
    expect(summary.status).not.toBe('error');
    expect(engine.sim.startTime).toBeGreaterThan(4.2); // left the start square only after the RUN press
    expect(summary.distance_m).toBeGreaterThan(1);
  }, 120_000);

  it('reports compile errors and calls that are not simulated', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bad-fw-'));
    fs.writeFileSync(path.join(dir, 'main.c'), 'void app_main(void) { int x = ; }\n');
    expect(() => buildFirmware([path.join(dir, 'main.c')])).toThrow(/did not compile/);
    expect(() => buildFirmware([path.join(dir, 'missing.c')])).toThrow(/not found/);
  });
});

describe('native firmware: flash and switches', () => {
  it('NVS keeps values between runs (as flash between power cycles); switch levels reach gpio_get_level', async () => {
    const exe = buildFirmware([new URL('../firmware/tests/nvs_switch.c', import.meta.url).pathname]).exe;
    const { start } = loadInputs({ track: 'public/samples/roborun-sample.png', robot: ROBOT });
    const wiring = wiringOf(REF);
    let memory: Record<string, unknown> = {};
    const outs: string[][] = [];
    for (const level of [1, 0] as const) {
      const operator = { presses: [], levels: [{ gpio: 27, level }] };
      const lines: string[] = [];
      const msg = { ...start, brain: { mode: 'code' as const, code: '', wiring }, operator, memory };
      const { engine, summary } = await runHeadless(msg, { seconds: 0.5, stopAtFinish: false, onConsole: (_t, l) => lines.push(l), firmware: (m) => new NativeFirmwareBrain(exe, wiring, m.profile, operator) });
      expect(summary.status, summary.error ?? '').not.toBe('error');
      memory = JSON.parse(JSON.stringify(engine.sim.memory));
      outs.push(lines);
    }
    expect(outs[0]).toContain('get runs: not-found 0');
    expect(outs[0]).toContain('switch: 1');
    expect(outs[0]).toContain('i32 read as u8: not-found');
    expect(outs[0]).toContain('key too long: rejected');
    expect(outs[1]).toContain('get runs: ok 1');
    expect(outs[1]).toContain('route 4 bytes: LSRB');
    expect(outs[1]).toContain('name (4): rmi');
    expect(outs[1]).toContain('switch: 0');
  }, 120_000);
});

describe('agent-written firmware guard', () => {
  it('refuses process, file and network calls, inline assembly and system headers; comments do not count', async () => {
    const { checkUntrusted } = await import('./native');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-'));
    const f = (name: string, text: string) => { const p = path.join(dir, name); fs.writeFileSync(p, text); return p; };
    expect(checkUntrusted([f('ok.c', '/* system("x") in a comment */ int a(void) { return abs(-1); } // fopen(')])).toEqual([]);
    expect(checkUntrusted([f('a.c', 'void f(void) { system("rm -rf /"); }')]).join()).toMatch(/process/);
    expect(checkUntrusted([f('b.c', 'void f(void) { FILE *x = fopen("a", "w"); }')]).join()).toMatch(/file/);
    expect(checkUntrusted([f('c.c', '#include <sys/socket.h>\n')]).join()).toMatch(/system header/);
    expect(checkUntrusted([f('d.c', 'void f(void) { __asm__("nop"); }')]).join()).toMatch(/assembly/);
  });
});
