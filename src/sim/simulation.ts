// The simulation loop: fixed 1 kHz ticks (4 physics sub-steps each), the brain called at its own loop rate,
// run timing per the rulebook, off-line detection, and the path trail.

import { Brain, BrainIO, DecisionRecord } from '../brain/brain';
import { Track, inRect, distanceToLine } from '../track/track';
import { buildGraph } from '../track/graph';
import { ShortcutJudge } from './judge';
import { BodyState, initialBody, Physics, PhysicsFlags } from './physics';
import { RobotProfile } from './profile';
import { Disturb, Rng, SensorArray, SensorFlags } from './sensors';

export interface SimFlags extends PhysicsFlags, SensorFlags {}
export const DEFAULT_FLAGS: SimFlags = { motorMismatch: true, batterySag: true, grip: true, noise: true, mismatch: true };

export interface OffLineRule { distance_cm: number }

export interface TrailPoint { x: number; y: number; v: number; off: boolean }
export interface SimEvent { t: number; kind: 'start' | 'finish' | 'offline' | 'online' | 'brain-finished' | 'code-stopped' | 'log' | 'left-mat' | 'start-reentry'; text: string; x: number; y: number }

export interface DecisionEvent extends DecisionRecord { t: number; x: number; y: number }

export type RunStatus = 'ready' | 'running' | 'finished' | 'stopped';

const TICK = 0.001;   // 1 kHz
const SUB = 4;        // physics sub-steps per tick

export class Simulation {
  readonly track: Track;
  readonly profile: RobotProfile;
  readonly physics: Physics;
  readonly sensors: SensorArray;
  readonly brain: Brain;
  readonly body: BodyState;
  readonly offRule: OffLineRule;
  time = 0;                       // s since power-on
  status: RunStatus = 'ready';
  startTime: number | null = null;
  finishTime: number | null = null;
  distance = 0;                   // m travelled by the axle centre
  offLineCount = 0;
  isOffLine = false;
  dutyL = 0; dutyR = 0;
  brakeL = false; brakeR = false; // short brake at zero duty (set by the firmware driver model)
  trail: TrailPoint[] = [];
  events: SimEvent[] = [];
  history: Record<string, number>[] = []; // sampled every 10 ms for graphs
  decisions: DecisionEvent[] = [];
  readonly memory: Record<string, unknown>; // EEPROM/NVS contents, kept for a memory run
  disturb: Disturb | undefined;
  onConsole: ((t: number, text: string) => void) | null = null;
  private nextBrain = 0;
  private nextSample = 0;
  private io: BrainIO;
  private leftMat = false;
  private readonly judge: ShortcutJudge | null;
  private offSinceJudge = false;   // an off-line event was counted since the judge last saw the axle on a line
  private brainWasFinished = false;
  private inStart = true;

  constructor(track: Track, profile: RobotProfile, brain: Brain, flags: SimFlags = DEFAULT_FLAGS, offRule: OffLineRule = { distance_cm: 4 }, memory: Record<string, unknown> = {}) {
    this.track = track;
    this.memory = memory;
    this.profile = profile;
    this.physics = new Physics(profile, flags);
    this.sensors = new SensorArray(profile, flags);
    this.brain = brain;
    this.offRule = offRule;
    const sp = track.startPose;
    this.body = initialBody(sp.x, sp.y, sp.theta, profile);
    this.io = this.makeIO();
    this.sensors.read(track, this.body.x, this.body.y, this.body.theta);
    let judge: ShortcutJudge | null = null;
    try { judge = new ShortcutJudge(track, buildGraph(track)); } catch { judge = null; }
    this.judge = judge;
    brain.reset(this.io);
  }

  private makeIO(): BrainIO {
    const s = this.profile.sensor;
    const sim = this;
    return {
      channels: s.channels,
      lateral_mm: this.sensors.lateral.map((v) => v * 1000),
      adcMax: this.sensors.maxRaw,
      whiteRaw: s.whiteRaw,
      blackRaw: s.blackRaw,
      threshold: s.threshold,
      geometry: { wheelbase_mm: this.profile.wheelbase_mm, wheelDiameter_mm: this.profile.wheelDiameter_mm, sensorOffset_mm: this.profile.sensorOffset_mm },
      wheelOdometry: () => {
        const r = sim.physics.wheelR;
        const e = sim.profile.encoders;
        if (e.present && e.usedInCode) {
          const k = e.cpr / (2 * Math.PI);
          return { left_m: (Math.floor(sim.body.angL * k) / k) * r, right_m: (Math.floor(sim.body.angR * k) / k) * r };
        }
        return { left_m: sim.body.angL * r, right_m: sim.body.angR * r };
      },
      memory: this.memory,
      decision: (rec) => { sim.decisions.push({ ...rec, t: sim.time, x: sim.body.x, y: sim.body.y }); },
      readSensors: () => sim.sensors.read(sim.track, sim.body.x, sim.body.y, sim.body.theta, sim.disturb).slice(),
      nowMs: () => sim.time * 1000,
      // Settings mode drives the robot like a typical motor function: direction pins set, PWM = |duty|. On a TB6612FNG
      // a duty of 0 is then a short brake; on an L298N (PWM on EN) it coasts.
      setMotors: (l, r) => { sim.dutyL = l; sim.dutyR = r; const tb = sim.profile.driver === 'TB6612FNG'; sim.brakeL = tb && l === 0; sim.brakeR = tb && r === 0; },
      encoders: () => {
        const e = sim.profile.encoders;
        if (!e.present || !e.usedInCode) return null;
        const k = e.cpr / (2 * Math.PI);
        return { left: Math.floor(sim.body.angL * k), right: Math.floor(sim.body.angR * k), cpr: e.cpr };
      },
      odometry_m: () => (sim.body.angL + sim.body.angR) / 2 * sim.physics.wheelR,
      log: (msg) => { sim.event('log', msg); sim.onConsole?.(sim.time, msg); },
    };
  }

  private event(kind: SimEvent['kind'], text: string) {
    this.events.push({ t: this.time, kind, text, x: this.body.x, y: this.body.y });
  }

  // Axle within one robot length of the finish square.
  private nearFinish(): boolean {
    const f = this.track.finish;
    if (!f) return false;
    const res = this.track.res, m = this.profile.length_mm / 1000;
    const x = this.body.x, y = this.body.y;
    return x >= f.x0 * res - m && x <= f.x1 * res + m && y >= f.y0 * res - m && y <= f.y1 * res + m;
  }

  frontPoint(): [number, number] {
    const f = this.profile.axleFromFront_mm / 1000;
    return [this.body.x + f * Math.cos(this.body.theta), this.body.y + f * Math.sin(this.body.theta)];
  }

  runTime(): number | null {
    if (this.startTime === null) return null;
    return (this.finishTime ?? this.time) - this.startTime;
  }

  // Robo-Run time score: run time + (N/20) x run time.
  score(): number | null {
    const t = this.runTime();
    return t === null ? null : t + (this.offLineCount / 20) * t;
  }

  stop() { if (this.status === 'running' || this.status === 'ready') this.status = 'stopped'; }

  // Advance the simulation by one 1 ms tick.
  tick(): void {
    if (this.status === 'finished' || this.status === 'stopped') return;
    this.status = 'running';
    if (this.time >= this.nextBrain) {
      this.brain.tick(this.io);
      this.nextBrain += 1 / this.brain.loopHz;
    }
    const b = this.body;
    const px = b.x, py = b.y;
    const h = TICK / SUB;
    for (let k = 0; k < SUB; k += 1) this.physics.step(b, this.dutyL, this.dutyR, h, this.brakeL, this.brakeR);
    this.time += TICK;
    this.distance += Math.hypot(b.x - px, b.y - py);

    // Rulebook timing: starts when the front edge leaves the start square, stops when it enters the finish.
    const [fx, fy] = this.frontPoint();
    if (this.startTime === null && this.track.start && !inRect(this.track, this.track.start, fx, fy)) {
      this.startTime = this.time; this.event('start', 'Front edge crossed the start line');
    }
    if (this.startTime !== null && this.finishTime === null && inRect(this.track, this.track.finish, fx, fy)) {
      this.finishTime = this.time; this.event('finish', 'Front edge entered the finish square');
    }
    // Re-entering the start square is logged (judged on the axle centre, so a nose swinging over it during a turn
    // does not count). The run is not ended: the spec has no automatic stop.
    const inStart = inRect(this.track, this.track.start, b.x, b.y);
    if (inStart && !this.inStart && this.startTime !== null && this.finishTime === null && this.distance > 0.3) {
      this.event('start-reentry', 'Re-entered the start square');
    }
    this.inStart = inStart;
    // "Code saw the finish": the robot's own code stopped it at the finish. A stop anywhere else is logged as such.
    const fin = this.brain.finished();
    if (fin && !this.brainWasFinished) {
      if (this.finishTime !== null || this.nearFinish()) this.event('brain-finished', 'Robot code recognised the finish and stopped');
      else this.event('code-stopped', `Robot code stopped the robot at (${b.x.toFixed(2)}, ${b.y.toFixed(2)}) m, not at the finish`);
    }
    this.brainWasFinished = fin;

    if (this.time >= this.nextSample) {
      this.nextSample += 0.01;
      this.sample();
    }
  }

  private sample() {
    const b = this.body;
    const v = this.physics.forwardSpeed(b);
    // Off-line as a judge sees it: every sensor on white AND the axle centre has moved away from the line.
    const allWhite = this.sensors.coverage.every((c) => c < 0.2);
    if (!this.isOffLine) {
      if (allWhite && this.startTime !== null && distanceToLine(this.track, b.x, b.y, this.offRule.distance_cm / 100 + 0.01) > this.offRule.distance_cm / 100) {
        this.isOffLine = true; this.offLineCount += 1; this.event('offline', `Off the line (#${this.offLineCount})`);
      }
    } else if (this.sensors.coverage.some((c) => c > 0.5)) {
      this.isOffLine = false; this.event('online', 'Back on the line');
    }
    if (this.isOffLine) this.offSinceJudge = true;
    if (this.judge && this.startTime !== null) {
      const ignore = inRect(this.track, this.track.start, b.x, b.y) || inRect(this.track, this.track.finish, b.x, b.y);
      const shortcut = this.judge.update(b.x, b.y, ignore);
      if (shortcut && !this.offSinceJudge) {
        this.offLineCount += 1; this.event('offline', `Off the line (#${this.offLineCount}): crossed white to another line`);
      }
      if (this.judge.onLine && !this.isOffLine) this.offSinceJudge = false;
    }
    const t = this.track;
    const outside = b.x < 0 || b.y < 0 || b.x > t.w * t.res || b.y > t.h * t.res;
    if (outside && !this.leftMat) { this.leftMat = true; this.event('left-mat', 'Robot left the mat'); }
    this.trail.push({ x: b.x, y: b.y, v, off: this.isOffLine });
    const tel = this.brain.telemetry();
    this.history.push({
      t: this.time, v, wL: b.wL * this.physics.wheelR, wR: b.wR * this.physics.wheelR,
      dutyL: this.dutyL, dutyR: this.dutyR, vBatt: b.vBatt, ...tel,
    });
    if (this.history.length > 60000) this.history.splice(0, 10000);
  }

  // Run as many ticks as fit in a wall-clock budget for the requested sim time.
  advance(simSeconds: number): void {
    const ticks = Math.round(simSeconds / TICK);
    for (let i = 0; i < ticks; i += 1) {
      this.tick();
      if (this.status === 'finished' || this.status === 'stopped') break;
    }
  }
}

// Disturbance field: smooth uneven lighting and mat folds (bands across the mat that lift the sensors).
export function makeDisturbance(track: Track, d: { lighting: { on: boolean; strength: number }; bumps: { on: boolean; strength: number }; seed: number }, profile: RobotProfile): Disturb | undefined {
  if (!d.lighting.on && !d.bumps.on) return undefined;
  const rng = new Rng(d.seed || 1);
  const W = track.w * track.res, H = track.h * track.res;
  const waves = Array.from({ length: 4 }, () => ({ kx: (0.5 + rng.next() * 2.5) * (2 * Math.PI) / W, ky: (0.5 + rng.next() * 2.5) * (2 * Math.PI) / H, ph: rng.next() * 6.28, a: 0.5 + rng.next() * 0.5 }));
  const norm = waves.reduce((s, w) => s + w.a, 0);
  const range = Math.abs(profile.sensor.blackRaw - profile.sensor.whiteRaw);
  // up to 25% of the white-black range of brightness change at full strength
  const ampl = d.lighting.on ? d.lighting.strength * 0.25 * range : 0;
  const folds = d.bumps.on ? Array.from({ length: 5 }, () => {
    const horizontal = rng.next() < 0.5;
    return { horizontal, pos: (0.15 + rng.next() * 0.7) * (horizontal ? H : W), width: 0.06 + rng.next() * 0.06 };
  }) : [];
  const lift = d.bumps.strength * 6; // mm at the crest
  const sign = profile.sensor.blackRaw >= profile.sensor.whiteRaw ? -1 : 1; // brighter light reads more "white"
  return (px, py) => {
    let amb = 0;
    if (ampl) { let s = 0; for (const w of waves) s += w.a * Math.sin(w.kx * px + w.ky * py + w.ph); amb = sign * ampl * (s / norm); }
    let dh = 0;
    for (const f of folds) {
      const dist = Math.abs((f.horizontal ? py : px) - f.pos);
      if (dist < f.width / 2) dh = Math.max(dh, lift * Math.cos((Math.PI * dist) / f.width));
    }
    return { dh_mm: dh, amb };
  };
}

export function foldBands(track: Track, d: { bumps: { on: boolean; strength: number }; seed: number }) {
  // same draws as makeDisturbance, for drawing the folds on the track
  if (!d.bumps.on) return [];
  const rng = new Rng(d.seed || 1);
  const W = track.w * track.res, H = track.h * track.res;
  for (let i = 0; i < 4; i += 1) { rng.next(); rng.next(); rng.next(); rng.next(); }
  return Array.from({ length: 5 }, () => {
    const horizontal = rng.next() < 0.5;
    return { horizontal, pos: (0.15 + rng.next() * 0.7) * (horizontal ? H : W), width: 0.06 + rng.next() * 0.06 };
  });
}
