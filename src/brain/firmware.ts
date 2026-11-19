// Code mode: runs skill-translated firmware (async JavaScript, see docs/FIRMWARE_API.md) against simulated hardware.
// The firmware drives simulated time: every hardware call costs a little time, delay() runs physics for that long,
// so the control-loop rate comes from the code itself. The firmware sees only the hardware API below.

import { Brain, BrainIO } from './brain';
import { RobotProfile } from '../sim/profile';
import type { Simulation } from '../sim/simulation';
import type { OperatorScript, Wiring } from '../worker/protocol';

const TICK = 0.001;
// Seconds of simulated CPU time per call. analogRead: ESP32 ≈ 10 µs, AVR (Uno/Nano at 16 MHz, prescaler 128) ≈ 112 µs.
const COST = { analogRead: 10e-6, analogReadAvr: 112e-6, digital: 0.2e-6, call: 0.5e-6, loopOverhead: 5e-6 };
const ESP_OK = 0, ESP_ERR_INVALID_ARG = 0x102;

export class FirmwareStop extends Error {}

// Names the firmware may not reach. They are passed as `undefined` parameters to the compiled function so the
// firmware cannot see them even by accident; the worker also deletes network APIs from its global scope.
const BLOCKED = ['self', 'globalThis', 'window', 'document', 'fetch', 'XMLHttpRequest', 'WebSocket', 'importScripts', 'indexedDB',
  'caches', 'postMessage', 'close', 'navigator', 'location', 'localStorage', 'sessionStorage', 'EventSource', 'Worker'];

export class FirmwareBrain implements Brain {
  readonly name: string = 'Code mode';
  readonly loopHz = 0; // the firmware drives time itself
  private sim!: Simulation;
  private profile: RobotProfile;
  protected wiring: Wiring;
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
  private stoppedSince: number | null = null;
  private lineBuf = '';
  private lastLine = '';
  protected compiled: { setup?: () => Promise<void>; loop?: () => Promise<void>; app_main?: () => Promise<void> } | null = null;

  private operator: OperatorScript | null;
  private nextPress = 0;
  private pressEvents: { t: number; gpio: number; down: boolean }[] = [];
  private intrType = new Map<number, number>(); // ESP-IDF gpio_config intr_type per pin (1 pos, 2 neg, 3 any edge)

  constructor(code: string, wiring: Wiring, profile: RobotProfile, operator: OperatorScript | null = null) {
    this.code = code; this.wiring = wiring; this.profile = profile; this.operator = operator;
    // Buttons rest at their released level; the operator's presses become timed edges.
    for (const b of wiring.buttons ?? []) this.pinLevel.set(b.gpio, b.activeLow ? 1 : 0);
    for (const l of operator?.levels ?? []) this.pinLevel.set(l.gpio, l.level ? 1 : 0);
    for (const p of operator?.presses ?? []) {
      this.pressEvents.push({ t: p.at_s, gpio: p.gpio, down: true }, { t: p.at_s + (p.hold_s ?? 0.15), gpio: p.gpio, down: false });
    }
    this.pressEvents.sort((a, b) => a.t - b.t);
    this.avr = wiring.board === 'avr';
    // The board's ADC sets the numbers the code reads: AVR is always 10-bit; ESP32 reads 12-bit by default.
    this.readBits = this.avr ? 10 : 12;
  }
  private avr: boolean;
  private pcntOffset = new Map<number, number>();     // PCNT unit -> count at the last clear
  private mcpwmSignal = new Map<string, number>();     // legacy "unit:signal" -> gpio
  private mcpwm5: { timers: { period: number }[]; ops: { timer: number }[]; cmps: { op: number; value: number }[]; gens: { op: number; gpio: number; cmp: number | null; force: number | null }[] } = { timers: [], ops: [], cmps: [], gens: [] };

  attach(sim: Simulation) { this.sim = sim; }
  // Flash storage shared by every run of a session (EEPROM / Preferences / NVS all live in sim.memory).
  protected flash(): Record<string, unknown> { const m = this.sim.memory as { prefs?: Record<string, unknown> }; m.prefs ??= {}; return m.prefs; }

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
      this.operatorStep();
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
    while (!this.gate && !this.done && !this.failure) await new Promise((r) => (typeof setImmediate === 'function' ? setImmediate(r) : setTimeout(r, 0)));
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

  // ---------------- fast native I/O (LFSim Lab) ----------------
  // One snapshot of everything a firmware reads, valid until the next physics tick: run `flush_s` of CPU time the
  // firmware spent since its last call, then `first_s` (the read that asked), then read every sensor and encoder.
  // Readings within one physics tick are the same physics state, so a native firmware can answer its other reads from
  // this copy, adding their CPU cost itself (lab/firmware/shim, LFSIM_FAST_IO).
  protected snapshot(flush_s: number, first_s: number) {
    this.runPhysics(Math.max(0, flush_s));
    this.runPhysics(Math.max(0, first_s));
    const sensors = this.wiring.sensorPins.map((_, i) => this.scaleRead(this.sensorRaw(i)));
    const c = this.counts();
    const pcnt = [...this.pcntOffset.keys()].sort((a, b) => a - b).map((u) => {
      const raw = (u === 0 ? c.L : c.R) - (this.pcntOffset.get(u) ?? 0);
      return { unit: u, count: ((raw + 32768) % 65536 + 65536) % 65536 - 32768 };
    });
    return { tickLeft_s: TICK - this.pending, now_us: Math.floor((this.sim.time + this.pending) * 1e6), sensors, pcnt,
      costAdc_s: this.avr ? COST.analogReadAvr : COST.analogRead, costCall_s: COST.call };
  }
  protected spend(seconds: number) { this.runPhysics(Math.max(0, seconds)); }

  // ---------------- operator: buttons and the calibration sweep ----------------
  private operatorStep() {
    while (this.nextPress < this.pressEvents.length && this.pressEvents[this.nextPress].t <= this.sim.time + 1e-9) {
      const ev = this.pressEvents[this.nextPress++];
      const b = (this.wiring.buttons ?? []).find((x) => x.gpio === ev.gpio);
      const activeLow = b ? b.activeLow : true;
      const level = ev.down === activeLow ? 0 : 1;
      const prev = this.pinLevel.get(ev.gpio) ?? (activeLow ? 1 : 0);
      if (level === prev) continue;
      this.pinLevel.set(ev.gpio, level);
      const falling = level === 0;
      for (const isr of this.isrs) {
        if (isr.pin !== ev.gpio) continue;
        const t = this.intrType.get(ev.gpio);
        const fire = isr.mode === 'CHANGE' || t === 3 || (falling ? isr.mode === 'FALLING' || t === 2 : isr.mode === 'RISING' || t === 1);
        if (fire) isr.fn();
      }
    }
  }
  // During a hand sweep, a line passes back and forth under the sensor bar (the robot itself does not move).
  private sweepRaw(i: number): number | null {
    const sw = this.operator?.sweep;
    if (!sw || this.sim.time < sw.from_s || this.sim.time > sw.to_s) return null;
    const s = this.profile.sensor, n = s.channels, pitch = s.spacing_mm / 1000;
    const xi = (i - (n - 1) / 2) * pitch;
    const half = ((n - 1) / 2) * pitch + 0.03;
    const line = half * Math.sin((2 * Math.PI * (this.sim.time - sw.from_s)) / (sw.period_s ?? 1.2));
    const w = 0.019; // half line width
    const cov = Math.max(0, Math.min(1, (w + 0.004 - Math.abs(xi - line)) / 0.008));
    return Math.round(s.whiteRaw + (s.blackRaw - s.whiteRaw) * cov);
  }

  // ---------------- motors ----------------
  private applyMotors() {
    const w = this.wiring.driver;
    const lvl = (p: number) => this.pinLevel.get(p) ?? 0;
    const stby = w.standby === null ? 1 : lvl(w.standby);
    const tb = this.profile.driver === 'TB6612FNG';
    // Driver truth tables. TB6612FNG: IN1/IN2 = H/L or L/H drives with PWM high and SHORT-BRAKES with PWM low;
    // H/H short-brakes; L/L or STBY low coasts. L298N (PWM on EN): IN1 = IN2 with EN high is a fast stop (brake);
    // EN low coasts.
    const side = (pwm: number, in1: number, in2: number, inv: boolean) => {
      const duty = this.pwmPinDuty.get(pwm) ?? (lvl(pwm) ? 1 : 0);
      const a = lvl(in1), b = lvl(in2);
      let d = 0, brake = false;
      if (stby && a && !b) d = duty; else if (stby && !a && b) d = -duty;
      if (stby && a && b) brake = tb || duty > 0;
      else if (stby && a !== b && duty === 0) brake = tb;
      return { d: inv ? -d : d, brake };
    };
    const L = side(w.leftPwm, w.leftIn1, w.leftIn2, w.leftInvert), R = side(w.rightPwm, w.rightIn1, w.rightIn2, w.rightInvert);
    this.sim.dutyL = L.d; this.sim.dutyR = R.d;
    this.sim.brakeL = L.brake; this.sim.brakeR = R.brake;
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
  private sensorRaw(i: number): number {
    const sw = this.sweepRaw(i);
    if (sw !== null) return sw;
    const b = this.sim.body;
    return this.sim.sensors.readOne(i, this.sim.track, b.x, b.y, b.theta, this.sim.disturb);
  }
  // The robot profile describes the sensor in counts of a profile.sensor.adcBits-bit ADC; the board converts with its
  // own resolution.
  private scaleRead(v: number) {
    const shift = this.readBits - this.profile.sensor.adcBits;
    return shift >= 0 ? v << shift : v >> -shift;
  }
  private analogReadPin(pin: number): number {
    this.cost(this.avr ? COST.analogReadAvr : COST.analogRead);
    const i = this.wiring.sensorPins.indexOf(pin);
    if (i < 0) throw new Error(`analogRead(${pin}): pin ${pin} is not a sensor pin in the wiring settings.`);
    return this.scaleRead(this.sensorRaw(i));
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
  protected api(): Record<string, unknown> {
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
      if (i >= 0) { const v = self.sensorRaw(i); const s = self.profile.sensor; return (s.blackRaw >= s.whiteRaw ? v > s.threshold : v < s.threshold) ? 1 : 0; }
      return self.pinLevel.get(pin) ?? 0;
    };
    const setPwmPin = (pin: number, duty: number, bits: number) => { self.pwmPinDuty.set(pin, Math.max(0, Math.min(1, duty / (2 ** bits - 1)))); };
    const ledcWrite = (chOrPin: number, duty: number) => {
      self.cost(COST.call);
      const pin = self.ledcChannelPin.has(chOrPin) ? self.ledcChannelPin.get(chOrPin)! : chOrPin; // Arduino-ESP32 2.x uses channels, 3.x uses pins
      setPwmPin(pin, duty, self.ledcBits.get(chOrPin) ?? self.ledcBits.get(pin) ?? self.profile.pwmBits);
    };
    const pcntRead = (unit: number) => {
      const c = self.counts(), raw = (unit === 0 ? c.L : c.R) - (self.pcntOffset.get(unit) ?? 0);
      return ((raw + 32768) % 65536 + 65536) % 65536 - 32768; // int16_t wraps
    };
    const mcpwm5Apply = () => {
      const m = self.mcpwm5;
      m.gens.forEach((g) => {
        const cmp = g.cmp ?? m.cmps.findIndex((c) => c.op === g.op);
        const c = m.cmps[cmp];
        const period = m.timers[m.ops[g.op]?.timer ?? 0]?.period ?? 1000;
        const duty = g.force !== null ? g.force : c ? Math.min(1, c.value / period) : 0;
        self.pwmPinDuty.set(g.gpio, duty);
      });
    };
    let rnd = 12345;
    const api: Record<string, unknown> = {
      HIGH: 1, LOW: 0, INPUT: 0, OUTPUT: 1, INPUT_PULLUP: 2, INPUT_PULLDOWN: 3, RISING: 'RISING', FALLING: 'FALLING', CHANGE: 'CHANGE',
      portTICK_PERIOD_MS: 1, pdMS_TO_TICKS: (ms: number) => ms, pdTRUE: 1, pdFALSE: 0,
      LEDC_LOW_SPEED_MODE: 0, LEDC_HIGH_SPEED_MODE: 1,
      pinMode: () => self.cost(COST.call),
      gpio_set_direction: () => self.cost(COST.call), gpio_reset_pin: () => self.cost(COST.call),
      // gpio_config: records each pin's interrupt type (GPIO_INTR_POSEDGE 1, NEGEDGE 2, ANYEDGE 3) for button presses.
      gpio_config: (cfg?: { pin_bit_mask?: number | string; intr_type?: number }) => {
        self.cost(COST.call);
        const mask = BigInt(cfg?.pin_bit_mask ?? 0);
        for (let p = 0; p < 64; p += 1) if ((mask >> BigInt(p)) & 1n) self.intrType.set(p, Number(cfg?.intr_type ?? 0));
        return ESP_OK;
      },
      gpio_install_isr_service: () => ESP_OK,
      gpio_isr_handler_add: (pin: number, fn: (arg?: unknown) => void, arg?: unknown) => { self.isrs.push({ pin, fn: () => fn(arg), mode: 'IDF' }); return ESP_OK; },
      gpio_isr_handler_remove: (pin: number) => { self.isrs = self.isrs.filter((i) => i.pin !== pin); return ESP_OK; },
      gpio_set_intr_type: (pin: number, t: number) => { self.intrType.set(pin, t); return ESP_OK; },
      gpio_intr_enable: () => ESP_OK, gpio_intr_disable: () => ESP_OK, gpio_set_pull_mode: () => ESP_OK, gpio_pullup_en: () => ESP_OK, gpio_pulldown_dis: () => ESP_OK,
      digitalWrite, gpio_set_level: digitalWrite,
      digitalRead, gpio_get_level: digitalRead,
      analogRead: (pin: number) => self.analogReadPin(pin),
      analogReadResolution: (bits: number) => { if (!self.avr) self.readBits = Math.max(9, Math.min(12, Math.trunc(bits))); }, // AVR has no such call: stays 10-bit
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
      // ESP-IDF v5 one-shot ADC. ADC_UNIT_1 = 0, ADC_UNIT_2 = 1 (the wiring lists units 1 and 2).
      ADC_UNIT_1: 0, ADC_UNIT_2: 1, ADC_ATTEN_DB_0: 0, ADC_ATTEN_DB_2_5: 1, ADC_ATTEN_DB_6: 2, ADC_ATTEN_DB_11: 3, ADC_ATTEN_DB_12: 3,
      ADC_BITWIDTH_DEFAULT: 12, ADC_BITWIDTH_12: 12, ADC_BITWIDTH_10: 10, ADC_BITWIDTH_9: 9,
      ADC_WIDTH_BIT_12: 12, ADC_WIDTH_BIT_10: 10, ADC_WIDTH_BIT_9: 9,
      ...Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`ADC_CHANNEL_${i}`, i])),
      ...Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`ADC1_CHANNEL_${i}`, i])),
      ...Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`ADC2_CHANNEL_${i}`, i])),
      adc_oneshot_new_unit: (cfg: { unit_id?: number }, out: { value: unknown }) => {
        self.cost(COST.call);
        const unit = (cfg?.unit_id ?? 0) + 1;
        if (unit !== 1 && unit !== 2) return ESP_ERR_INVALID_ARG;
        out.value = { unit }; return ESP_OK;
      },
      adc_oneshot_config_channel: (h: { unit: number }, _ch: number, cfg?: { bitwidth?: number }) => {
        self.cost(COST.call);
        if (cfg?.bitwidth && cfg.bitwidth >= 9 && cfg.bitwidth <= 12) self.readBits = cfg.bitwidth;
        return h ? ESP_OK : ESP_ERR_INVALID_ARG;
      },
      adc_oneshot_read: (h: { unit: number }, ch: number, out: { value: number }) => {
        const m = self.wiring.adcChannels.find((a) => a.unit === h?.unit && a.channel === ch);
        if (!m) throw new Error(`adc_oneshot_read(ADC${h?.unit}, channel ${ch}): not mapped to a sensor in the wiring settings.`);
        out.value = self.analogReadPin(m.gpio); return ESP_OK;
      },
      adc_oneshot_del_unit: () => ESP_OK,
      // Legacy MCPWM driver (ESP-IDF 4.x): signals MCPWM0A=0, MCPWM0B=1, MCPWM1A=2 … ; duty in percent.
      MCPWM_UNIT_0: 0, MCPWM_UNIT_1: 1, MCPWM_TIMER_0: 0, MCPWM_TIMER_1: 1, MCPWM_TIMER_2: 2, MCPWM_OPR_A: 0, MCPWM_OPR_B: 1,
      MCPWM0A: 0, MCPWM0B: 1, MCPWM1A: 2, MCPWM1B: 3, MCPWM2A: 4, MCPWM2B: 5, MCPWM_DUTY_MODE_0: 0, MCPWM_DUTY_MODE_1: 1, MCPWM_UP_COUNTER: 1,
      mcpwm_gpio_init: (unit: number, signal: number, gpio: number) => { self.mcpwmSignal.set(`${unit}:${signal}`, gpio); return ESP_OK; },
      mcpwm_init: () => ESP_OK, mcpwm_start: () => ESP_OK, mcpwm_stop: () => ESP_OK, mcpwm_set_duty_type: () => ESP_OK, mcpwm_set_frequency: () => ESP_OK,
      mcpwm_set_duty: (unit: number, timer: number, op: number, pct: number) => {
        self.cost(COST.call);
        const g = self.mcpwmSignal.get(`${unit}:${timer * 2 + op}`);
        if (g === undefined) return ESP_ERR_INVALID_ARG;
        self.pwmPinDuty.set(g, Math.max(0, Math.min(1, Number(pct) / 100))); return ESP_OK;
      },
      mcpwm_set_signal_low: (unit: number, timer: number, op: number) => { const g = self.mcpwmSignal.get(`${unit}:${timer * 2 + op}`); if (g !== undefined) self.pwmPinDuty.set(g, 0); return ESP_OK; },
      mcpwm_set_signal_high: (unit: number, timer: number, op: number) => { const g = self.mcpwmSignal.get(`${unit}:${timer * 2 + op}`); if (g !== undefined) self.pwmPinDuty.set(g, 1); return ESP_OK; },
      // ESP-IDF v5 MCPWM (timer → operator → comparator → generator). Supported subset: up-counting timer, generator
      // high at timer empty and low at its comparator (the usual PWM set-up); duty = compare value ÷ period ticks.
      mcpwm_new_timer: (cfg: { period_ticks?: number }, out: { value: number }) => { self.mcpwm5.timers.push({ period: Math.max(1, cfg?.period_ticks ?? 1000) }); out.value = self.mcpwm5.timers.length - 1; return ESP_OK; },
      mcpwm_new_operator: (_cfg: unknown, out: { value: number }) => { self.mcpwm5.ops.push({ timer: 0 }); out.value = self.mcpwm5.ops.length - 1; return ESP_OK; },
      mcpwm_operator_connect_timer: (op: number, timer: number) => { if (self.mcpwm5.ops[op]) self.mcpwm5.ops[op].timer = timer; return ESP_OK; },
      mcpwm_new_comparator: (op: number, _cfg: unknown, out: { value: number }) => { self.mcpwm5.cmps.push({ op, value: 0 }); out.value = self.mcpwm5.cmps.length - 1; return ESP_OK; },
      mcpwm_new_generator: (op: number, cfg: { gen_gpio_num: number }, out: { value: number }) => { self.mcpwm5.gens.push({ op, gpio: cfg.gen_gpio_num, cmp: null, force: null }); out.value = self.mcpwm5.gens.length - 1; mcpwm5Apply(); return ESP_OK; },
      mcpwm_generator_set_action_on_timer_event: () => ESP_OK,
      mcpwm_generator_set_action_on_compare_event: (gen: number, ev: { comparator?: number }) => { const g = self.mcpwm5.gens[gen]; if (g && ev?.comparator !== undefined) g.cmp = ev.comparator; mcpwm5Apply(); return ESP_OK; },
      mcpwm_generator_set_actions_on_compare_event: (gen: number, ...evs: { comparator?: number }[]) => { const g = self.mcpwm5.gens[gen]; const e = evs.find((x) => x?.comparator !== undefined); if (g && e) g.cmp = e.comparator!; mcpwm5Apply(); return ESP_OK; },
      MCPWM_GEN_TIMER_EVENT_ACTION: (dir: number, ev: number, act: number) => ({ dir, ev, act }),
      MCPWM_GEN_COMPARE_EVENT_ACTION: (dir: number, comparator: number, act: number) => ({ dir, comparator, act }),
      MCPWM_TIMER_DIRECTION_UP: 0, MCPWM_TIMER_EVENT_EMPTY: 0, MCPWM_GEN_ACTION_HIGH: 2, MCPWM_GEN_ACTION_LOW: 1, MCPWM_TIMER_COUNT_MODE_UP: 0, MCPWM_TIMER_CLK_SRC_DEFAULT: 0,
      mcpwm_timer_enable: () => ESP_OK, mcpwm_timer_start_stop: () => ESP_OK, MCPWM_TIMER_START_NO_STOP: 1,
      mcpwm_comparator_set_compare_value: (cmp: number, ticks: number) => { self.cost(COST.call); const c = self.mcpwm5.cmps[cmp]; if (!c) return ESP_ERR_INVALID_ARG; c.value = Math.max(0, Number(ticks)); mcpwm5Apply(); return ESP_OK; },
      mcpwm_generator_set_force_level: (gen: number, level: number) => { const g = self.mcpwm5.gens[gen]; if (!g) return ESP_ERR_INVALID_ARG; g.force = level < 0 ? null : level ? 1 : 0; mcpwm5Apply(); return ESP_OK; },
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
      // Legacy PCNT driver: esp_err_t pcnt_get_counter_value(unit, int16_t *count). Unit 0 = left wheel, 1 = right.
      PCNT_UNIT_0: 0, PCNT_UNIT_1: 1, ESP_OK, ESP_ERR_INVALID_ARG,
      pcnt_unit_config: () => { self.cost(COST.call); return ESP_OK; },
      pcnt_counter_pause: () => ESP_OK, pcnt_counter_resume: () => ESP_OK, pcnt_set_filter_value: () => ESP_OK, pcnt_filter_enable: () => ESP_OK,
      pcnt_get_counter_value: (unit: number, out?: { value: number }) => {
        self.cost(COST.call);
        if (unit !== 0 && unit !== 1) return ESP_ERR_INVALID_ARG;
        if (out) out.value = pcntRead(unit);
        return ESP_OK;
      },
      pcnt_counter_clear: (unit: number) => {
        if (unit !== 0 && unit !== 1) return ESP_ERR_INVALID_ARG;
        const c = self.counts(); self.pcntOffset.set(unit, unit === 0 ? c.L : c.R); return ESP_OK;
      },
      // ESP-IDF v5 pulse counter: handles are unit numbers in creation order (first = left wheel).
      pcnt_new_unit: (_cfg: unknown, out: { value: unknown }) => { const id = (self.pcntOffset.size ? Math.max(...self.pcntOffset.keys()) + 1 : 0); self.pcntOffset.set(id, 0); out.value = id; return ESP_OK; },
      pcnt_new_channel: (_u: unknown, _cfg: unknown, out?: { value: unknown }) => { if (out) out.value = {}; return ESP_OK; },
      pcnt_channel_set_edge_action: () => ESP_OK, pcnt_channel_set_level_action: () => ESP_OK, pcnt_unit_set_glitch_filter: () => ESP_OK,
      pcnt_unit_enable: () => ESP_OK, pcnt_unit_start: () => ESP_OK, pcnt_unit_stop: () => ESP_OK,
      pcnt_unit_clear_count: (u: number) => { const c = self.counts(); self.pcntOffset.set(u, u === 0 ? c.L : c.R); return ESP_OK; },
      pcnt_unit_get_count: (u: number, out: { value: number }) => { self.cost(COST.call); out.value = pcntRead(u); return ESP_OK; },
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
      // Arduino map(): long integer maths — the product is divided with truncation toward zero, then out_min added.
      map: (x: number, a: number, b: number, c: number, d: number) => {
        const [X, A, B, C, D] = [x, a, b, c, d].map(Math.trunc);
        if (B === A) throw new Error('map(): in_min equals in_max (division by zero).');
        return Math.trunc(((X - A) * (D - C)) / (B - A)) + C;
      },
      random: (a: number, b?: number) => { rnd = (rnd * 1103515245 + 12345) & 0x7fffffff; const lo = b === undefined ? 0 : a, hi = b === undefined ? a : b; return lo + (rnd % Math.max(1, hi - lo)); },
      randomSeed: (s: number) => { rnd = s | 0; },
    };
    return api;
  }

  protected compile(): { setup?: () => Promise<void>; loop?: () => Promise<void>; app_main?: () => Promise<void> } {
    const api = this.api();
    const names = Object.keys(api);
    const body = `"use strict";\n${this.code}\nreturn { setup: typeof setup === 'function' ? setup : undefined, loop: typeof loop === 'function' ? loop : undefined, app_main: typeof app_main === 'function' ? app_main : undefined };`;
    // eslint-disable-next-line no-new-func
    const fn = new Function(...names, ...BLOCKED, body) as (...a: unknown[]) => FirmwareBrain['compiled'];
    return fn(...names.map((n) => api[n]), ...BLOCKED.map(() => undefined))!;
  }
  // Called when the run is over (native firmware: stop its process).
  dispose(): void {
  }
}
