// Runs a simulation and records it. Used by the Web Worker and directly by tests (no DOM needed).

import { DecisionEvent, makeDisturbance, SimEvent, Simulation } from '../sim/simulation';
import { SettingsBrain } from '../brain/settings';
import { Brain } from '../brain/brain';
import { F, FRAME_FIELDS, FramesMsg, StartMsg } from './protocol';
import { FirmwareBrain } from '../brain/firmware';

export const RECORD_LIMIT_S = 600; // technical cap on one recording (see DECISIONS.md)

export class Engine {
  readonly sim: Simulation;
  readonly runId: number;
  readonly stride: number;
  readonly recordDt: number;
  private nextRecord = 0;
  private frames: number[] = [];
  private states: string[] = [];
  private stateIdx = new Map<string, number>();
  private sentEvents = 0;
  private sentDecisions = 0;
  private consoleOut: { t: number; text: string }[] = [];
  private csvRows: string[] = [];
  private csvDecIdx = 0;
  private csvHeader: string;
  status: FramesMsg['status'] = 'running';
  error: string | undefined;
  private firmware: FirmwareBrain | null = null;

  // record = false skips frames and CSV rows (headless benchmarks that only need the outcome).
  private readonly recordOn: boolean;
  // opts.firmware: build the firmware brain another way (LFSim Lab: native C firmware in its own process).
  constructor(msg: StartMsg, opts: { record?: boolean; firmware?: (msg: StartMsg) => FirmwareBrain } = {}) {
    this.recordOn = opts.record ?? true;
    this.runId = msg.runId;
    let brain: Brain;
    if (msg.brain.mode === 'settings') brain = new SettingsBrain(msg.brain.settings);
    else { this.firmware = opts.firmware ? opts.firmware(msg) : new FirmwareBrain(msg.brain.code, msg.brain.wiring, msg.profile, msg.operator ?? null); brain = this.firmware; }
    this.sim = new Simulation(msg.track, msg.profile, brain, msg.flags, { distance_cm: msg.offLine_cm }, msg.memory);
    this.sim.disturb = makeDisturbance(msg.track, msg.disturbances, msg.profile);
    this.sim.onConsole = (t, text) => this.consoleOut.push({ t, text });
    if (this.firmware) this.firmware.attach(this.sim);
    const n = msg.profile.sensor.channels;
    this.stride = FRAME_FIELDS.length + n;
    this.recordDt = msg.brain.mode === 'settings' ? 1 / msg.brain.settings.loopHz : 0.002;
    this.csvHeader = ['time_s', 'x_m', 'y_m', 'heading_deg', 'speed_mps', 'wheelL_mps', 'wheelR_mps', 'pwmL', 'pwmR', 'battery_V',
      ...Array.from({ length: n }, (_, i) => `sensor${i + 1}_raw`), 'line_error_mm', 'pid_output', 'state', 'decision'].join(',');
    this.record();
    this.nextRecord = this.recordDt;
  }

  private stateId(s: string): number {
    let i = this.stateIdx.get(s);
    if (i === undefined) { i = this.states.length; this.states.push(s); this.stateIdx.set(s, i); }
    return i;
  }

  private record() {
    if (!this.recordOn) return;
    const s = this.sim, b = s.body, ph = s.physics;
    const tel = s.brain.telemetry();
    const state = s.brain.state();
    const row = [s.time, b.x, b.y, b.theta, b.angL, b.angR, ph.forwardSpeed(b), b.wL * ph.wheelR, b.wR * ph.wheelR, s.dutyL, s.dutyR,
      b.vBatt, b.iL, b.iR, b.slipping ? 1 : 0, s.isOffLine ? 1 : 0, tel.error_mm ?? NaN, tel.pid ?? NaN, this.stateId(state), 0, ...s.sensors.raw];
    for (const v of row) this.frames.push(v);
    // Every decision made since the previous row goes on this row (several are joined with "|"), so none is lost.
    const newDec = s.decisions.slice(this.csvDecIdx).map((d) => d.kind).join('|');
    this.csvDecIdx = s.decisions.length;
    const heading = ((((b.theta * 180) / Math.PI + 180) % 360) + 360) % 360 - 180; // wrapped to -180..180
    // Fixed decimals, and never "-0.0000": a value that rounds to zero prints as zero whatever its sign. (Browsers and
    // Node can differ in the last bit of a tiny residual such as the speed of a stopped robot.)
    const fx = (v: number, d: number) => { const t = v.toFixed(d); return /^-0\.?0*$/.test(t) ? t.slice(1) : t; };
    this.csvRows.push([fx(s.time, 4), fx(b.x, 4), fx(b.y, 4), fx(heading, 2), fx(row[F.v], 4), fx(row[F.vL], 4), fx(row[F.vR], 4),
      fx(s.dutyL, 4), fx(s.dutyR, 4), fx(b.vBatt, 3), ...s.sensors.raw, Number.isNaN(row[F.err]) ? '' : fx(row[F.err], 2), Number.isNaN(row[F.pid]) ? '' : fx(row[F.pid], 4),
      `"${state.replace(/"/g, '""')}"`, newDec].join(','));
  }

  private stepOnce() {
    this.sim.tick();
    if (this.sim.time + 1e-9 >= this.nextRecord) { this.nextRecord += this.recordDt; this.record(); }
  }

  // Advance until simulated time reaches `until` or the run ends. Async so Code mode can await hardware calls.
  // Release anything the run holds (a native firmware process).
  dispose(): void { this.firmware?.dispose(); }

  async advance(until: number): Promise<void> {
    const s = this.sim;
    try {
      if (this.firmware) await this.firmware.runUntil(until, () => this.afterTick());
      else while (s.time < until && s.status !== 'finished' && s.status !== 'stopped') this.stepOnce();
    } catch (e) {
      this.status = 'error';
      this.error = e instanceof Error ? e.message : String(e);
      s.stop();
    }
    if (s.time >= RECORD_LIMIT_S && s.status === 'running') {
      s.stop();
      s.events.push({ t: s.time, kind: 'log', text: `Recording limit (${RECORD_LIMIT_S / 60} min) reached`, x: s.body.x, y: s.body.y });
    }
    if (this.status !== 'error') this.status = s.status === 'finished' ? 'finished' : s.status === 'stopped' ? 'stopped' : 'running';
    if (this.status !== 'running' && !this.finalRecorded) { this.finalRecorded = true; this.record(); } // last frame at the end time
  }
  private finalRecorded = false;

  // Code mode calls this after each physics tick it runs.
  afterTick() {
    if (this.sim.time + 1e-9 >= this.nextRecord) { this.nextRecord += this.recordDt; this.record(); }
  }

  stopAt(t: number) {
    // The user pressed Stop at playback time t: the run ends there.
    this.sim.stop();
    this.status = this.status === 'error' ? 'error' : 'stopped';
    void t;
  }

  drain(): FramesMsg {
    const s = this.sim;
    const events: SimEvent[] = s.events.slice(this.sentEvents);
    const decisions: DecisionEvent[] = s.decisions.slice(this.sentDecisions);
    this.sentEvents = s.events.length; this.sentDecisions = s.decisions.length;
    const frames = new Float32Array(this.frames);
    this.frames = [];
    const out: FramesMsg = {
      type: 'frames', runId: this.runId, stride: this.stride, frames, states: this.states.slice(), events, decisions,
      console: this.consoleOut.splice(0), time: s.time, status: this.status, error: this.error, idealHz: 1 / this.recordDt,
    };
    // Memory (EEPROM/NVS) is sent once the robot has reached the finish, so a memory run is available without waiting
    // for the user to press Stop.
    if (this.status !== 'running' || s.finishTime !== null) out.memory = JSON.parse(JSON.stringify(s.memory));
    return out;
  }

  csv(until: number): string {
    const rows = this.csvRows.filter((r) => Number(r.slice(0, r.indexOf(','))) <= until + 1e-9);
    return [this.csvHeader, ...rows].join('\n');
  }
}
