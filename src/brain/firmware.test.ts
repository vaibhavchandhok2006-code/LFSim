import { describe, expect, it } from 'vitest';
import { Engine } from '../worker/engine';
import { DEFAULT_PROFILE } from '../sim/profile';
import { DEFAULT_FLAGS } from '../sim/simulation';
import { PRESETS, Track } from '../track/track';
import { startPoseFor } from '../track/importTrack';
import { SAMPLE_TRANSLATED, SAMPLE_WIRING } from './sampleFirmware';
import type { Wiring } from '../worker/protocol';

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
async function runCode(code: string, seconds: number, wiring: Wiring = SAMPLE_WIRING) {
  const e = new Engine({
    type: 'start', runId: 1, track, profile: DEFAULT_PROFILE, brain: { mode: 'code', code, wiring },
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

// Test report D10–D14: hardware API details that must behave like the real calls.
describe('Code mode hardware API', () => {
  const drive = `digitalWrite(23, 1); digitalWrite(17, 1); digitalWrite(18, 0); digitalWrite(21, 1); digitalWrite(22, 0);`;

  it('map() uses Arduino long-integer maths', async () => {
    const { logs } = await runCode(`async function setup() { Serial.println(map(1, 0, 3, -10, 0)); Serial.println(map(-100, -255, 255, -255, 0)); Serial.println(map(512, 0, 1023, 0, 255)); }
      async function loop() { await delay(1000); }`, 1);
    expect(logs.map((l) => l.split(' ')[1])).toEqual(['-7', '-178', '127']);
  });

  it('PCNT: returns ESP_OK, writes the count to {value}, and clear resets it', async () => {
    const wiring = { ...SAMPLE_WIRING, encoders: { leftA: 4, leftB: 5, rightA: 12, rightB: 13 } };
    const { logs } = await runCode(`async function setup() {
        ${drive} analogWrite(16, 120); analogWrite(19, 120); await delay(500);
        const c = { value: -1 }; const r = pcnt_get_counter_value(PCNT_UNIT_0, c); Serial.println([r, c.value].join(' '));
        Serial.println([pcnt_counter_clear(PCNT_UNIT_0)].join(' ')); pcnt_get_counter_value(PCNT_UNIT_0, c); Serial.println([c.value].join(' '));
        Serial.println([pcnt_get_counter_value(7, c)].join(' ')); }
      async function loop() { await delay(1000); }`, 1, wiring);
    const [first, cleared, after, bad] = logs.map((l) => l.slice(l.indexOf(' ') + 1));
    const [r, v] = first.split(' ').map(Number);
    expect(r).toBe(0);
    expect(v).toBeGreaterThan(20);
    expect(cleared).toBe('0');
    expect(Math.abs(Number(after))).toBeLessThan(3);
    expect(Number(bad)).not.toBe(0);
  });

  it('every analogRead is a fresh conversion with its own noise', async () => {
    const { logs } = await runCode(`async function setup() { const v = []; for (let i = 0; i < 20; i++) v.push(analogRead(36)); Serial.println(new Set(v).size); }
      async function loop() { await delay(1000); }`, 1);
    expect(Number(logs[0].split(' ')[1])).toBeGreaterThan(3);
  });

  it('board setting: AVR analogRead takes ~112 µs and is 10-bit; ESP32 ~10 µs and 12-bit', async () => {
    const code = `async function setup() { const t0 = micros(); let mx = 0; for (let i = 0; i < 100; i++) mx = Math.max(mx, analogRead(36)); Serial.println([micros() - t0, mx].join(' ')) }
      async function loop() { await delay(1000); }`;
    const esp = (await runCode(code, 1)).logs[0].split(' ').slice(1).map(Number);
    const avr = (await runCode(code, 1, { ...SAMPLE_WIRING, board: 'avr' })).logs[0].split(' ').slice(1).map(Number);
    expect(esp[0]).toBeGreaterThan(900); expect(esp[0]).toBeLessThan(1200);
    expect(avr[0]).toBeGreaterThan(11000); expect(avr[0]).toBeLessThan(11500);
    expect(avr[1]).toBeLessThanOrEqual(1023);
    expect(esp[1]).toBeGreaterThan(1023);
  });

  it('ESP-IDF v5 adc_oneshot reads a mapped channel', async () => {
    const { logs } = await runCode(`async function app_main() {
        const h = { value: null }; Serial.println([adc_oneshot_new_unit({ unit_id: ADC_UNIT_1 }, h)].join(' '))
        adc_oneshot_config_channel(h.value, ADC_CHANNEL_0, { atten: ADC_ATTEN_DB_12, bitwidth: ADC_BITWIDTH_12 });
        const v = { value: -1 }; Serial.println([adc_oneshot_read(h.value, ADC_CHANNEL_0, v), v.value].join(' ')) }`, 1);
    expect(logs[0].endsWith(' 0')).toBe(true);
    const [r, v] = logs[1].split(' ').slice(1).map(Number);
    expect(r).toBe(0); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(4095);
  });

  it('MCPWM: legacy and v5 drivers set the motor duty', async () => {
    const legacy = await runCode(`async function app_main() { ${drive}
        mcpwm_gpio_init(MCPWM_UNIT_0, MCPWM0A, 16); mcpwm_gpio_init(MCPWM_UNIT_0, MCPWM0B, 19);
        mcpwm_init(MCPWM_UNIT_0, MCPWM_TIMER_0, { frequency: 20000 });
        mcpwm_set_duty(MCPWM_UNIT_0, MCPWM_TIMER_0, MCPWM_OPR_A, 40); mcpwm_set_duty(MCPWM_UNIT_0, MCPWM_TIMER_0, MCPWM_OPR_B, 40);
        await vTaskDelay(300); }`, 1);
    expect(legacy.e.sim.dutyL).toBeCloseTo(0.4, 2);
    expect(legacy.e.sim.distance).toBeGreaterThan(0.02);
    const v5 = await runCode(`async function app_main() { ${drive}
        const t = { value: 0 }; mcpwm_new_timer({ period_ticks: 1000 }, t);
        const op = { value: 0 }; mcpwm_new_operator({}, op); mcpwm_operator_connect_timer(op.value, t.value);
        const ca = { value: 0 }, cb = { value: 0 }; mcpwm_new_comparator(op.value, {}, ca); mcpwm_new_comparator(op.value, {}, cb);
        const ga = { value: 0 }, gb = { value: 0 }; mcpwm_new_generator(op.value, { gen_gpio_num: 16 }, ga); mcpwm_new_generator(op.value, { gen_gpio_num: 19 }, gb);
        mcpwm_generator_set_action_on_compare_event(ga.value, MCPWM_GEN_COMPARE_EVENT_ACTION(MCPWM_TIMER_DIRECTION_UP, ca.value, MCPWM_GEN_ACTION_LOW));
        mcpwm_generator_set_action_on_compare_event(gb.value, MCPWM_GEN_COMPARE_EVENT_ACTION(MCPWM_TIMER_DIRECTION_UP, cb.value, MCPWM_GEN_ACTION_LOW));
        mcpwm_timer_enable(t.value); mcpwm_timer_start_stop(t.value, MCPWM_TIMER_START_NO_STOP);
        mcpwm_comparator_set_compare_value(ca.value, 600); mcpwm_comparator_set_compare_value(cb.value, 300);
        await vTaskDelay(100); }`, 1);
    expect(v5.e.sim.dutyL).toBeCloseTo(0.6, 2);
    expect(v5.e.sim.dutyR).toBeCloseTo(0.3, 2);
  });
});

describe('Code mode: Wire compass, buttons and the operator script', () => {
  const avr: Wiring = {
    ...SAMPLE_WIRING, board: 'avr', sensorPins: [14, 15, 16, 17, 18, 19, 20, 21],
    buttons: [{ name: 'GO', pin: 2, activeLow: true }],
    magnetometer: { chip: 'QMC5883L', yAxis: 'left' },
    operator: [{ at_s: 0.5, action: 'press', button: 'GO', hold_s: 0.2 }, { at_s: 3, action: 'place-at-start' }],
  };

  it('reads the button through the operator script and the heading over I²C', async () => {
    const code = `
      function heading() {
        Wire.beginTransmission(0x0D); Wire.write(0x00); if (Wire.endTransmission(false) != 0) return NaN;
        if (Wire.requestFrom(0x0D, 6) < 6) return NaN;
        let x = Wire.read(); x |= Wire.read() << 8; x = (x << 16) >> 16;
        let y = Wire.read(); y |= Wire.read() << 8; y = (y << 16) >> 16;
        return Math.atan2(y, x) * RAD_TO_DEG;
      }
      async function setup() {
        Serial.println('pins ' + A0 + ' ' + A7);
        Wire.begin(); Wire.setClock(400000);
        Wire.beginTransmission(0x1E); Serial.println('other ' + Wire.endTransmission());
        Wire.beginTransmission(0x0D); Wire.write(0x09); Wire.write(0x1D); Wire.endTransmission();
        while (digitalRead(2) == HIGH) { await arduinoYield(); }
        Serial.println('pressed at ' + millis());
        const h0 = heading();
        digitalWrite(23, HIGH);                                                 // TB6612 standby off
        digitalWrite(17, HIGH); digitalWrite(18, LOW); analogWrite(16, 90);    // left forward
        digitalWrite(21, LOW); digitalWrite(22, HIGH); analogWrite(19, 90);    // right back: turn right
        await delay(120);
        analogWrite(16, 0); analogWrite(19, 0);
        await delay(200);
        Serial.println('turned ' + ((heading() - h0 + 540) % 360 - 180).toFixed(0));
      }
      async function loop() { await delay(100); }`;
    const { e, logs } = await runCode(code, 4, avr);
    expect(e.error).toBeUndefined();
    expect(logs.some((l) => l.endsWith('pins 14 21'))).toBe(true);
    expect(logs.some((l) => l.endsWith('other 2'))).toBe(true);                  // nothing at 0x1E
    const at = Number(logs.find((l) => l.includes('pressed at'))!.split(' ').pop());
    expect(at).toBeGreaterThanOrEqual(500); expect(at).toBeLessThan(510);
    const turned = Number(logs.find((l) => l.includes('turned'))!.split(' ').pop());
    expect(turned).toBeGreaterThan(20); expect(turned).toBeLessThan(170);
    const bodyTurn = (e.sim.body.theta - track.startPose.theta) * 180 / Math.PI;
    expect(bodyTurn).toBeCloseTo(0, 3); // (pose was reset at 3 s)                                  // right turn = positive (Y arrow left)
    // the operator put the robot back on the start pose at 3 s
    expect(e.sim.events.some((ev) => ev.text.includes('back at the start'))).toBe(true);
    expect(e.sim.body.x).toBeCloseTo(track.startPose.x, 3);
    expect(e.sim.startTime).toBeNull();
  });

  it('runs the magnetometer maze example to its first junction scan', async () => {
    const fs = await import('node:fs');
    const { parseImport } = await import('../ui/persist');
    const imp = parseImport(fs.readFileSync('examples/magnetometer-maze/magnetometer-maze.robot.json', 'utf8'));
    if (imp.kind !== 'robot' || !imp.code?.wiring || !imp.code.translated) throw new Error('not a robot file with firmware');
    const { e, logs } = await runCode(imp.code.translated, 25, imp.code.wiring);
    expect(e.error).toBeUndefined();
    expect(logs.some((l) => l.includes('Cal offsets'))).toBe(true);
    expect(logs.some((l) => l.endsWith('Target bearing = 45'))).toBe(true);
    expect(e.sim.distance).toBeGreaterThan(0.3); // it drove off after the ZERO press
  }, 30000);
});
