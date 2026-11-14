// Code mode: runs skill-translated firmware (async JavaScript, see docs/FIRMWARE_API.md) against simulated hardware.
// The firmware drives simulated time: every hardware call costs a little time, delay() runs physics for that long,
// so the control-loop rate comes from the code itself. The firmware sees only the hardware API below.

import { Brain, BrainIO } from './brain';
import { RobotProfile } from '../sim/profile';
import type { Simulation } from '../sim/simulation';
import type { Wiring } from '../worker/protocol';

const TICK = 0.001;
const COST = { analogRead: 10e-6, digital: 0.2e-6, call: 0.5e-6, loopOverhead: 5e-6 }; // seconds of simulated CPU time

export class FirmwareStop extends Error {}

// Names the firmware may not reach. They are passed as `undefined` parameters to the compiled function so the
// firmware cannot see them even by accident; the worker also deletes network APIs from its global scope.
const BLOCKED = ['self', 'globalThis', 'window', 'document', 'fetch', 'XMLHttpRequest', 'WebSocket', 'importScripts', 'indexedDB',
  'caches', 'postMessage', 'close', 'navigator', 'location', 'localStorage', 'sessionStorage', 'EventSource', 'Worker'];

export class FirmwareBrain implements Brain {
  readonly name = 'Code mode';
  readonly loopHz = 0; // the firmware drives time itself
  private sim!: Simulation;
  private profile: RobotProfile;
  private wiring: Wiring;
  private code: string;
  private pending = 0;              // simulated CPU time not yet run as physics, s
  private until = 0;
  private gate: (() => void) | null = null;
  private afterTick: () => void = () => {};
  private started = false;
  private done = false;
  private failure: Error | null = null;
  private pinLevel = new Map<number, number>();
  private pwmPinDuty = new Map<number, number>(); // pin -> 0..1
  private ledcChannelPin = new Map<number, number>();
  private ledcBits = new Map<number, number>();  // channel or pin -> resolution
  private analogWriteBits = 8;
  private readBits: number;
  private isrs: { pin: number; fn: () => void; mode: string }[] = [];
  private lastCount = { L: 0, R: 0 };
  private sensorCacheT = -1;
  private sensorCache: number[] = [];
  private stoppedSince: number | null = null;
  private lineBuf = '';
  private lastLine = '';
  private compiled: { setup?: () => Promise<void>; loop?: () => Promise<void>; app_main?: () => Promise<void> } | null = null;

  constructor(code: string, wiring: Wiring, profile: RobotProfile) {
    this.code = code; this.wiring = wiring; this.profile = profile;
    this.readBits = profile.sensor.adcBits;
  }

  attach(sim: Simulation) { this.sim = sim; }

  // Brain interface (most of it is unused: the firmware runs itself)
  reset(_io: BrainIO): void {}
  tick(_io: BrainIO): void {}
  state(): string { return this.failure ? `Code error: ${this.failure.message}` : this.lastLine ? `Running · ${this.lastLine.slice(0, 40)}` : 'Running firmware'; }
  telemetry(): Record<string, number> { return {}; }
  // "Recognised the finish and stopped": the code holds both motors at zero for 0.5 s after driving at least 30 cm.
  finished(): boolean { return this.stoppedSince !== null && this.sim.time - this.stoppedSince >= 0.5 && this.sim.distance > 0.3; }

  // ---------------- time ----------------
  private runPhysics(seconds: number): void {
    this.pending += seconds;
    while (this.pending >= TICK) {
      this.pending -= TICK;
      this.applyMotors();
      this.sim.tick();
      this.fireEncoderInterrupts();
      const both0 = this.sim.dutyL === 0 && this.sim.dutyR === 0;
      if (both0) { if (this.stoppedSince === null) this.stoppedSince = this.sim.time; } else this.stoppedSince = null;
      this.afterTick();
      if (this.sim.status === 'finished' || this.sim.status === 'stopped') throw new FirmwareStop('run ended');
    }
  }
  private async yieldIfDue(): Promise<void> {
    if (this.sim.status === 'finished' || this.sim.status === 'stopped') throw new FirmwareStop('run ended');
    if (this.sim.time >= this.until) await new Promise<void>((res) => { this.gate = res; });
  }
  private cost(s: number) { this.runPhysics(s); }

  // Called by the engine: run the firmware until simulated time reaches `until`.
  async runUntil(until: number, afterTick: () => void): Promise<void> {
    this.until = until; this.afterTick = afterTick;
    if (this.failure) throw this.failure;
    if (!this.started) { this.started = true; this.main(); }
    else if (this.gate) { const g = this.gate; this.gate = null; g(); }
    // wait until the firmware parks at the gate again, ends, or fails
    while (!this.gate && !this.done && !this.failure) await new Promise((r) => setTimeout(r, 0));
    if (this.failure) throw this.failure;
  }

  private async main() {
    try {
      this.compiled = this.compile();
      const c = this.compiled;
      if (c.app_main) { await c.app_main(); }
      else {
        if (c.setup) await c.setup();
        if (!c.loop) throw new Error('The firmware defines neither loop() nor app_main().');
        for (;;) { this.cost(COST.loopOverhead); await this.yieldIfDue(); await c.loop(); }
      }
      // app_main returned: the chip idles
      for (;;) { this.runPhysics(0.01); await this.yieldIfDue(); }
    } catch (e) {
      if (e instanceof FirmwareStop) { this.done = true; return; }
      this.failure = e instanceof Error ? e : new Error(String(e));
      this.sim.events.push({ t: this.sim.time, kind: 'log', text: `Firmware error: ${this.failure.message}`, x: this.sim.body.x, y: this.sim.body.y });
    }
  }

  // ---------------- motors ----------------
  private applyMotors() {
    const w = this.wiring.driver;
    const lvl = (p: number) => this.pinLevel.get(p) ?? 0;
    const stby = w.standby === null ? 1 : lvl(w.standby);
    const side = (pwm: number, in1: number, in2: number, inv: boolean) => {
      const duty = this.pwmPinDuty.get(pwm) ?? (lvl(pwm) ? 1 : 0);
      const a = lvl(in1), b = lvl(in2);
      let d = 0;
      if (stby && a && !b) d = duty; else if (stby && !a && b) d = -duty; // both high = brake, both low = coast: no drive
      return inv ? -d : d;
    };
    this.sim.dutyL = side(w.leftPwm, w.leftIn1, w.leftIn2, w.leftInvert);
    this.sim.dutyR = side(w.rightPwm, w.rightIn1, w.rightIn2, w.rightInvert);
  }

  // ---------------- encoders (interrupts on channel A, B gives direction) ----------------
  private counts() {
    const e = this.profile.encoders, k = e.cpr / (2 * Math.PI);
    return { L: Math.floor(this.sim.body.angL * k), R: Math.floor(this.sim.body.angR * k) };
  }
  private fireEncoderInterrupts() {
    const enc = this.wiring.encoders;
    if (!enc || !this.profile.encoders.present || !this.isrs.length) return;
    const c = this.counts();
    for (const [side, a, b] of [['L', enc.leftA, enc.leftB], ['R', enc.rightA, enc.rightB]] as const) {
      const diff = c[side] - this.lastCount[side];
      if (!diff) continue;
      this.pinLevel.set(b, diff > 0 ? 1 : 0);
      for (let k = 0; k < Math.abs(diff); k += 1) {
        for (const isr of this.isrs) if (isr.pin === a) { isr.fn(); if (isr.mode === 'CHANGE') isr.fn(); }
      }
      this.lastCount[side] = c[side];
    }
  }

  // ---------------- sensors ----------------
  private sensorsNow(): number[] {
    if (this.sensorCacheT !== this.sim.time) {
      this.sensorCache = this.sim.sensors.read(this.sim.track, this.sim.body.x, this.sim.body.y, this.sim.body.theta, this.sim.disturb).slice();
      this.sensorCacheT = this.sim.time;
    }
    return this.sensorCache;
  }
  private scaleRead(v: number) {
    const shift = this.readBits - this.profile.sensor.adcBits;
    return shift >= 0 ? v << shift : v >> -shift;
  }
  private analogReadPin(pin: number): number {
    this.cost(COST.analogRead);
    const i = this.wiring.sensorPins.indexOf(pin);
    if (i < 0) throw new Error(`analogRead(${pin}): pin ${pin} is not a sensor pin in the wiring settings.`);
    return this.scaleRead(this.sensorsNow()[i]);
  }

  // ---------------- serial ----------------
  private serialWrite(text: string) {
    this.lineBuf += text;
    let k: number;
    while ((k = this.lineBuf.indexOf('\n')) >= 0) {
      const line = this.lineBuf.slice(0, k).replace(/\r$/, '');
      this.lineBuf = this.lineBuf.slice(k + 1);
      this.lastLine = line;
      this.sim.onConsole?.(this.sim.time, line);
    }
  }

  // ---------------- the hardware API handed to the firmware ----------------
  private api(): Record<string, unknown> {
    const self = this;
    const fmt = (f: string, ...a: unknown[]) => { let i = 0; return String(f).replace(/%[-+ 0#]*\d*(?:\.\d+)?[lh]*([dfisuxXc%])/g, (m, t) => (t === '%' ? '%' : t === 'f' ? Number(a[i++]).toFixed(Number((m.match(/\.(\d+)/) ?? [0, 6])[1])) : t === 'x' ? Number(a[i++]).toString(16) : t === 'X' ? Number(a[i++]).toString(16).toUpperCase() : t === 'c' ? String.fromCharCode(Number(a[i++])) : String(t === 'd' || t === 'i' || t === 'u' ? Math.trunc(Number(a[i++])) : a[i++]))); };
    const mem = () => { const m = self.sim.memory as { eeprom?: number[]; prefs?: Record<string, unknown> }; m.eeprom ??= []; m.prefs ??= {}; return m as { eeprom: number[]; prefs: Record<string, unknown> }; };
    const delay = async (ms: number) => { self.runPhysics(Math.max(0, Number(ms)) / 1000); await self.yieldIfDue(); };
    const millis = () => Math.floor((self.sim.time + self.pending) * 1000);
    const micros = () => Math.floor((self.sim.time + self.pending) * 1e6);
    const digitalWrite = (pin: number, v: number) => { self.cost(COST.digital); self.pinLevel.set(pin, v ? 1 : 0); self.pwmPinDuty.delete(pin); };
    const digitalRead = (pin: number) => {
      self.cost(COST.digital);
      const i = self.wiring.sensorPins.indexOf(pin);
      if (i >= 0) { const v = self.sensorsNow()[i]; const s = self.profile.sensor; return (s.blackRaw >= s.whiteRaw ? v > s.threshold : v < s.threshold) ? 1 : 0; }
      return self.pinLevel.get(pin) ?? 0;
    };
    const setPwmPin = (pin: number, duty: number, bits: number) => { self.pwmPinDuty.set(pin, Math.max(0, Math.min(1, duty / (2 ** bits - 1)))); };
    const ledcWrite = (chOrPin: number, duty: number) => {
      self.cost(COST.call);
      const pin = self.ledcChannelPin.has(chOrPin) ? self.ledcChannelPin.get(chOrPin)! : chOrPin; // Arduino-ESP32 2.x uses channels, 3.x uses pins
      setPwmPin(pin, duty, self.ledcBits.get(chOrPin) ?? self.ledcBits.get(pin) ?? self.profile.pwmBits);
    };
    let rnd = 12345;
    const api: Record<string, unknown> = {
      HIGH: 1, LOW: 0, INPUT: 0, OUTPUT: 1, INPUT_PULLUP: 2, INPUT_PULLDOWN: 3, RISING: 'RISING', FALLING: 'FALLING', CHANGE: 'CHANGE',
      portTICK_PERIOD_MS: 1, pdMS_TO_TICKS: (ms: number) => ms, pdTRUE: 1, pdFALSE: 0,
      LEDC_LOW_SPEED_MODE: 0, LEDC_HIGH_SPEED_MODE: 1,
      pinMode: () => self.cost(COST.call),
      gpio_set_direction: () => self.cost(COST.call), gpio_config: () => self.cost(COST.call), gpio_reset_pin: () => self.cost(COST.call),
      digitalWrite, gpio_set_level: digitalWrite,
      digitalRead, gpio_get_level: digitalRead,
      analogRead: (pin: number) => self.analogReadPin(pin),
      analogReadResolution: (bits: number) => { self.readBits = bits; },
      adc1_config_width: () => self.cost(COST.call), adc1_config_channel_atten: () => self.cost(COST.call), adc2_config_channel_atten: () => self.cost(COST.call),
      adc1_get_raw: (ch: number) => {
        const m = self.wiring.adcChannels.find((a) => a.unit === 1 && a.channel === ch);
        if (!m) throw new Error(`adc1_get_raw(${ch}): ADC1 channel ${ch} is not mapped to a sensor in the wiring settings.`);
        return self.analogReadPin(m.gpio);
      },
      adc2_get_raw: (ch: number, _w: unknown, out?: { value: number }) => {
        const m = self.wiring.adcChannels.find((a) => a.unit === 2 && a.channel === ch);
        if (!m) throw new Error(`adc2_get_raw(${ch}): ADC2 channel ${ch} is not mapped to a sensor in the wiring settings.`);
        const v = self.analogReadPin(m.gpio); if (out) out.value = v; return v;
      },
      analogWrite: (pin: number, v: number) => { self.cost(COST.call); setPwmPin(pin, v, self.analogWriteBits); },
      analogWriteResolution: (bits: number) => { self.analogWriteBits = bits; },
      ledcSetup: (ch: number, _f: number, bits: number) => { self.ledcBits.set(ch, bits); },
      ledcAttachPin: (pin: number, ch: number) => { self.ledcChannelPin.set(ch, pin); },
      ledcAttach: (pin: number, _f: number, bits: number) => { self.ledcBits.set(pin, bits); return true; },
      ledcAttachChannel: (pin: number, _f: number, bits: number, ch: number) => { self.ledcChannelPin.set(ch, pin); self.ledcBits.set(ch, bits); return true; },
      ledcWrite,
      ledc_timer_config: (cfg: { duty_resolution?: number; timer_num?: number }) => { (self as unknown as { idfBits: number }).idfBits = cfg?.duty_resolution ?? self.profile.pwmBits; },
      ledc_channel_config: (cfg: { gpio_num: number; channel: number; duty?: number }) => {
        self.ledcChannelPin.set(cfg.channel, cfg.gpio_num);
        self.ledcBits.set(cfg.channel, (self as unknown as { idfBits?: number }).idfBits ?? self.profile.pwmBits);
        if (cfg.duty !== undefined) ledcWrite(cfg.channel, cfg.duty);
      },
      ledc_set_duty: (_mode: number, ch: number, duty: number) => { (self as unknown as { pendingDuty: Map<number, number> }).pendingDuty ??= new Map(); (self as unknown as { pendingDuty: Map<number, number> }).pendingDuty.set(ch, duty); },
      ledc_update_duty: (_mode: number, ch: number) => { const pd = (self as unknown as { pendingDuty?: Map<number, number> }).pendingDuty; if (pd?.has(ch)) ledcWrite(ch, pd.get(ch)!); },
      millis, micros, esp_timer_get_time: micros, xTaskGetTickCount: millis,
      delay, vTaskDelay: delay,
      delayMicroseconds: async (us: number) => { self.runPhysics(Math.max(0, Number(us)) / 1e6); await self.yieldIfDue(); },
      ets_delay_us: async (us: number) => { self.runPhysics(Math.max(0, Number(us)) / 1e6); await self.yieldIfDue(); },
      taskYIELD: async () => { await self.yieldIfDue(); }, arduinoYield: async () => { await self.yieldIfDue(); },
      Serial: {
        begin: () => {}, print: (v: unknown, d?: number) => self.serialWrite(typeof v === 'number' && d !== undefined && !Number.isInteger(v) ? v.toFixed(d) : String(v)),
        println: (v: unknown = '', d?: number) => self.serialWrite((typeof v === 'number' && d !== undefined && !Number.isInteger(v) ? v.toFixed(d) : String(v)) + '\n'),
        printf: (f: string, ...a: unknown[]) => self.serialWrite(fmt(f, ...a)), available: () => 0, read: () => -1,
      },
      printf: (f: string, ...a: unknown[]) => self.serialWrite(fmt(f, ...a)),
      ESP_LOGI: (tag: string, f: string, ...a: unknown[]) => self.serialWrite(`I (${millis()}) ${tag}: ${fmt(f, ...a)}\n`),
      ESP_LOGW: (tag: string, f: string, ...a: unknown[]) => self.serialWrite(`W (${millis()}) ${tag}: ${fmt(f, ...a)}\n`),
      ESP_LOGE: (tag: string, f: string, ...a: unknown[]) => self.serialWrite(`E (${millis()}) ${tag}: ${fmt(f, ...a)}\n`),
      attachInterrupt: (pin: number, fn: () => void, mode: string) => { self.isrs.push({ pin, fn, mode }); self.lastCount = self.counts(); },
      digitalPinToInterrupt: (p: number) => p,
      detachInterrupt: (pin: number) => { self.isrs = self.isrs.filter((i) => i.pin !== pin); },
      pcnt_get_counter_value: (unit: number) => { const c = self.counts(); return unit === 0 ? c.L : c.R; },
      pcnt_counter_clear: () => {},
      EEPROM: {
        begin: () => true, commit: () => true, length: () => 4096,
        read: (a: number) => mem().eeprom[a] ?? 255, write: (a: number, v: number) => { mem().eeprom[a] = v & 255; }, update: (a: number, v: number) => { mem().eeprom[a] = v & 255; },
        put: (a: number, v: unknown) => { mem().prefs[`@${a}`] = JSON.parse(JSON.stringify(v)); return v; },
        get: (a: number, dflt: unknown) => (mem().prefs[`@${a}`] ?? dflt),
      },
      Preferences: class {
        begin() { return true; } end() {} clear() { mem().prefs = {}; return true; }
        putInt(k: string, v: number) { mem().prefs[k] = v; return 4; } getInt(k: string, d = 0) { return (mem().prefs[k] as number) ?? d; }
        putFloat(k: string, v: number) { mem().prefs[k] = v; return 4; } getFloat(k: string, d = 0) { return (mem().prefs[k] as number) ?? d; }
        putString(k: string, v: string) { mem().prefs[k] = v; return v.length; } getString(k: string, d = '') { return (mem().prefs[k] as string) ?? d; }
        putBytes(k: string, v: number[]) { mem().prefs[k] = [...v]; return v.length; } getBytes(k: string, buf: number[]) { const v = (mem().prefs[k] as number[]) ?? []; v.forEach((x, i) => { buf[i] = x; }); return v.length; }
        isKey(k: string) { return k in mem().prefs; }
      },
      nvs_get_i32: (k: string, out: { value: number }) => { const v = mem().prefs[k]; if (v === undefined) return 1; out.value = v as number; return 0; },
      nvs_set_i32: (k: string, v: number) => { mem().prefs[k] = v; return 0; },
      constrain: (x: number, a: number, b: number) => Math.min(b, Math.max(a, x)),
      map: (x: number, a: number, b: number, c: number, d: number) => Math.trunc(((x - a) * (d - c)) / (b - a) + c),
      random: (a: number, b?: number) => { rnd = (rnd * 1103515245 + 12345) & 0x7fffffff; const lo = b === undefined ? 0 : a, hi = b === undefined ? a : b; return lo + (rnd % Math.max(1, hi - lo)); },
      randomSeed: (s: number) => { rnd = s | 0; },
    };
    return api;
  }

  private compile() {
    const api = this.api();
    const names = Object.keys(api);
    const body = `"use strict";\n${this.code}\nreturn { setup: typeof setup === 'function' ? setup : undefined, loop: typeof loop === 'function' ? loop : undefined, app_main: typeof app_main === 'function' ? app_main : undefined };`;
    // eslint-disable-next-line no-new-func
    const fn = new Function(...names, ...BLOCKED, body) as (...a: unknown[]) => FirmwareBrain['compiled'];
    return fn(...names.map((n) => api[n]), ...BLOCKED.map(() => undefined))!;
  }
}
