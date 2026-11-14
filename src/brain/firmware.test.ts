import { describe, expect, it } from 'vitest';
import { Engine } from '../worker/engine';
import { DEFAULT_PROFILE } from '../sim/profile';
import { DEFAULT_FLAGS } from '../sim/simulation';
import { PRESETS, Track } from '../track/track';
import { startPoseFor } from '../track/importTrack';
import { SAMPLE_TRANSLATED, SAMPLE_WIRING } from './sampleFirmware';

// A simple test track: start square, a gentle S-curve 3.8 cm line, finish square. 2.5 m × 1.0 m at 2 mm/px.
function sTrack(): Track {
  const res = 0.002, w = 1250, h = 500;
  const dark = new Float32Array(w * h);
  const yAt = (x: number) => 0.5 + 0.18 * Math.sin(((x - 0.35) / 1.8) * 2 * Math.PI);
  for (let py = 0; py < h; py += 1) for (let px = 0; px < w; px += 1) {
    const x = (px + 0.5) * res, y = (py + 0.5) * res;
    let on = false;
    if (x >= 0.35 && x <= 2.15) { let best = 1; for (let dx = -0.04; dx <= 0.04; dx += 0.004) { const xx = x + dx; if (xx < 0.35 || xx > 2.15) continue; best = Math.min(best, Math.hypot(dx, y - yAt(xx))); } on = best <= 0.019; }
    if (x >= 0.1 && x <= 0.35 && Math.abs(y - 0.5) <= 0.125) on = true;   // start square
    if (x >= 2.15 && x <= 2.4 && Math.abs(y - yAt(2.15)) <= 0.125) on = true; // finish square
    dark[py * w + px] = on ? 1 : 0;
  }
  const t: Track = {
    preset: { ...PRESETS[1], width_m: 2.5, height_m: 1.0 }, res, w, h, dark,
    start: { x0: 0.1 / res, y0: (0.5 - 0.125) / res, x1: 0.35 / res, y1: (0.5 + 0.125) / res },
    finish: { x0: 2.15 / res, y0: (yAt(2.15) - 0.125) / res, x1: 2.4 / res, y1: (yAt(2.15) + 0.125) / res },
    startPose: { x: 0, y: 0, theta: 0 }, measuredLineWidth_cm: 3.8, imageName: 's-track',
  };
  t.startPose = startPoseFor(t, DEFAULT_PROFILE.axleFromFront_mm / 1000);
  return t;
}

const track = sTrack();
async function runCode(code: string, seconds: number) {
  const e = new Engine({
    type: 'start', runId: 1, track, profile: DEFAULT_PROFILE, brain: { mode: 'code', code, wiring: SAMPLE_WIRING },
    flags: DEFAULT_FLAGS, disturbances: { lighting: { on: false, strength: 0 }, bumps: { on: false, strength: 0 }, seed: 1 }, offLine_cm: 4, memory: {},
  });
  const logs: string[] = [];
  e.sim.onConsole = (t, s) => logs.push(`${t.toFixed(3)} ${s}`);
  for (let t = 0; t < seconds && e.status === 'running'; t += 1) await e.advance(t + 1);
  return { e, logs };
}

describe('Code mode', () => {
  it('the known-good sample firmware completes the track and stops itself', async () => {
    const { e, logs } = await runCode(SAMPLE_TRANSLATED, 30);
    expect(e.error).toBeUndefined();
    expect(e.sim.finishTime).not.toBeNull();
    expect(e.sim.brain.finished()).toBe(true);
    expect(logs.some((l) => l.endsWith('Finish!'))).toBe(true);
  }, 30000);

  it('a broken firmware (wrong sign on Kp and Kd) fails plausibly: leaves the line, never finishes', async () => {
    const broken = SAMPLE_TRANSLATED.replace('let Kp = 0.012, Kd = 0.0012;', 'let Kp = -0.012, Kd = -0.0012;');
    const { e } = await runCode(broken, 15);
    expect(e.sim.finishTime).toBeNull();
    expect(e.sim.offLineCount).toBeGreaterThan(0);
  }, 30000);

  it('delay() blocks the code while physics keeps running', async () => {
    const code = `
      async function setup() { pinMode(23, OUTPUT); digitalWrite(23, HIGH); digitalWrite(17, HIGH); digitalWrite(21, HIGH); ledcAttach(16, 20000, 10); ledcAttach(19, 20000, 10); }
      async function loop() { ledcWrite(16, 600); ledcWrite(19, 600); Serial.println(millis()); await delay(100); }`;
    const { e, logs } = await runCode(code, 2);
    const times = logs.map((l) => Number(l.split(' ')[1])).slice(0, 5);
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(100);
    expect(times[1] - times[0]).toBeLessThanOrEqual(101);
    expect(e.sim.distance).toBeGreaterThan(0.3); // the robot kept driving during the delays
  }, 30000);

  it('firmware cannot reach the page, network or storage', async () => {
    const code = `
      async function setup() {
        Serial.println([typeof self, typeof globalThis, typeof fetch, typeof XMLHttpRequest, typeof postMessage, typeof indexedDB, typeof localStorage, typeof importScripts].join(','));
      }
      async function loop() { await delay(10); }`;
    const { logs } = await runCode(code, 1);
    expect(logs[0].split(' ')[1]).toBe('undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined');
  });

  it('an unmapped pin is reported, not invented', async () => {
    const code = `async function setup() {} async function loop() { analogRead(99); await delay(1); }`;
    const { e } = await runCode(code, 1);
    expect(e.sim.events.some((x) => x.text.includes('pin 99 is not a sensor pin'))).toBe(true);
  });
});
