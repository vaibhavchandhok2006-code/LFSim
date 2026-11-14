// Settings mode: the built-in reference line follower.
// Analog readings drive PID line following; junctions, dead ends and the finish use thresholded (binary) patterns.
// At a junction the robot rolls forward so its axle is over the junction, spins 360° to list every branch by angle,
// lets the chosen algorithm pick one, then turns until the line is under the centre sensors again.

import { Brain, BrainIO } from './brain';
import { JunctionView, kindOf, LsrbNavigator, Navigator, RuleNavigator, TremauxNavigator } from './navigator';

export type Algorithm = 'pid-only' | 'left-hand' | 'right-hand' | 'straight-first' | 'custom' | 'lsrb' | 'tremaux';
export const MEMORY_ALGORITHMS: Algorithm[] = ['lsrb', 'tremaux'];

export interface SettingsParams {
  version: 1;
  kp: number;            // duty per mm of line error
  ki: number;            // duty per mm·s
  kd: number;            // duty per mm/s
  iLimit: number;        // clamp on the integral term, duty
  dFilterHz: number;     // low-pass cut-off on the derivative term (0 = off); tames sensor noise
  loopHz: number;        // control loop rate
  baseSpeed: number;     // duty 0..1 on straights
  maxSpeed: number;      // duty cap per wheel
  turnSpeed: number;     // duty for in-place turns and line search
  accel: number;         // max change of base speed, duty per second
  junctionOuter: number; // outer sensors per side that must be black to call a branch
  inchForward_cm: number;
  turnMethod: 'spin-until-line' | 'timed';
  deadEndWhite_cm: number;
  finishBlack_cm: number;
  lostTimeout_s: number; // stop searching after this long without the line (line-following only mode)
  algorithm: Algorithm;
  straightFallback: 'left' | 'right';
  customOrder: string;   // e.g. "SLRB"
}

export const DEFAULT_SETTINGS: SettingsParams = {
  version: 1,
  kp: 0.012,
  ki: 0,
  kd: 0.0012,
  iLimit: 0.2,
  dFilterHz: 20,
  loopHz: 500,
  baseSpeed: 0.3,
  maxSpeed: 0.9,
  turnSpeed: 0.3,
  accel: 2.5,
  junctionOuter: 2,
  inchForward_cm: 6.5,
  turnMethod: 'spin-until-line',
  deadEndWhite_cm: 3,
  finishBlack_cm: 7,
  lostTimeout_s: 3,
  algorithm: 'left-hand',
  straightFallback: 'left',
  customOrder: 'LSRB',
};

type Mode = 'follow' | 'search' | 'inch' | 'scan' | 'turn' | 'finished' | 'lost';

const wrap = (d: number) => ((d + 180) % 360 + 360) % 360 - 180;

export class SettingsBrain implements Brain {
  readonly name = 'Settings mode';
  readonly loopHz: number;
  private prm: SettingsParams;
  private nav: Navigator | null;
  private mode: Mode = 'follow';
  private integ = 0;
  private lastErr = 0;
  private dFilt = 0;
  private lastT = 0;
  private speed = 0;
  private lastSeenSide = 0;
  private lostSince = 0;
  private blackStart: number | null = null;
  private whiteStart: number | null = null;
  private tel: Record<string, number> = {};
  // odometry pose estimate (brain frame: start = origin, heading 0, + yaw = left)
  private ox = 0; private oy = 0; private yaw = 0; private lastL = 0; private lastR = 0;
  // junction handling
  private lastJunctionOdo = -1;
  private inchStart = 0;
  private arrivalYaw = 0;
  private pattern = '';
  private scanStartYaw = 0;
  private scanOn: boolean | null = null;
  private scanIntervals: [number, number][] = [];
  private scanIntervalStart = 0;
  private scanStartedOn = false;
  private turnTarget = 0;   // degrees relative to the arrival heading
  private turnDir = 1;
  private turnFromYaw = 0;
  private turnStartMs = 0;
  private deadEnd = false;
  private stateText = '';

  constructor(prm: SettingsParams) {
    this.prm = prm;
    this.loopHz = prm.loopHz;
    const a = prm.algorithm;
    this.nav = a === 'pid-only' ? null
      : a === 'lsrb' ? new LsrbNavigator()
      : a === 'tremaux' ? new TremauxNavigator()
      : new RuleNavigator(a, { fallback: prm.straightFallback, order: prm.customOrder });
  }

  reset(io: BrainIO): void {
    this.mode = 'follow'; this.integ = 0; this.lastErr = 0; this.dFilt = 0; this.lastT = io.nowMs();
    this.speed = 0; this.lastSeenSide = 0; this.lostSince = 0; this.blackStart = null; this.whiteStart = null;
    const w = io.wheelOdometry(); this.lastL = w.left_m; this.lastR = w.right_m;
  }

  state(): string {
    if (this.stateText) return this.stateText;
    return { follow: 'Following line', search: 'Searching for line', inch: 'Junction: rolling onto it', scan: 'Junction: scanning branches', turn: 'Turning onto branch', finished: 'Finished — stopped', lost: 'Line lost — stopped' }[this.mode];
  }
  finished(): boolean { return this.mode === 'finished'; }
  telemetry(): Record<string, number> { return this.tel; }

  private odometryUpdate(io: BrainIO) {
    const w = io.wheelOdometry();
    const dl = w.left_m - this.lastL, dr = w.right_m - this.lastR;
    this.lastL = w.left_m; this.lastR = w.right_m;
    const b = io.geometry.wheelbase_mm / 1000;
    const ds = (dl + dr) / 2, dy = (dr - dl) / b;
    const mid = this.yaw + dy / 2;
    this.ox += ds * Math.cos(mid); this.oy += ds * Math.sin(mid);
    this.yaw += dy;
  }
  private yawDeg() { return (this.yaw * 180) / Math.PI; }

  tick(io: BrainIO): void {
    const p = this.prm;
    const now = io.nowMs();
    const dt = Math.max(1e-4, (now - this.lastT) / 1000);
    this.lastT = now;
    this.odometryUpdate(io);
    if (this.mode === 'finished' || this.mode === 'lost') { io.setMotors(0, 0); return; }

    const raw = io.readSensors();
    const span = io.blackRaw - io.whiteRaw;
    const n = raw.map((v) => Math.max(0, Math.min(1, (v - io.whiteRaw) / span)));
    const on = raw.map((v) => (span > 0 ? v > io.threshold : v < io.threshold));
    const N = on.length;
    const sum = n.reduce((a, b) => a + b, 0);
    const allBlack = on.every(Boolean);
    const anyOn = on.some(Boolean);
    const centreOn = on[Math.floor((N - 1) / 2)] || on[Math.ceil((N - 1) / 2)];
    const odo = io.odometry_m();
    const armed = odo > 0.25; // ignore the solid start square

    // Finish: all sensors black for a set distance while moving forward.
    if ((this.mode === 'follow' || this.mode === 'inch') && allBlack && armed) {
      if (this.blackStart === null) this.blackStart = odo;
      if (odo - this.blackStart >= p.finishBlack_cm / 100) {
        this.mode = 'finished'; this.stateText = ''; io.setMotors(0, 0);
        io.log('Finish detected: all sensors black');
        io.decision({ kind: 'finish', branches_deg: [], chosen_deg: null, rank: null, pattern: on.map((b) => (b ? 1 : 0)).join(''), note: 'all sensors black' });
        this.nav?.finished({ x: this.ox, y: this.oy, yaw_deg: this.yawDeg() }, io.memory);
        return;
      }
    } else if (this.mode !== 'inch') this.blackStart = null;

    if (this.mode === 'inch') { this.doInch(io, odo); return; }
    if (this.mode === 'scan') { this.doScan(io, centreOn); return; }
    if (this.mode === 'turn') { this.doTurn(io, centreOn); return; }
    this.stateText = '';

    // ---------------- follow ----------------
    const dv = p.accel * dt;
    this.speed += Math.max(-dv, Math.min(dv, p.baseSpeed - this.speed));

    if (this.nav && armed && odo - this.lastJunctionOdo > 0.1) {
      const k = Math.max(1, Math.min(Math.floor(N / 2) - 1, p.junctionOuter));
      const leftEdge = on.slice(0, k).every(Boolean);
      const rightEdge = on.slice(N - k).every(Boolean);
      if ((leftEdge || rightEdge) && centreOn) { this.startJunction(io, on, odo, false); return; }
      // dead end: all white for a set distance
      if (!anyOn) {
        if (this.whiteStart === null) this.whiteStart = odo;
        if (odo - this.whiteStart >= p.deadEndWhite_cm / 100) { this.startJunction(io, on, odo, true); return; }
        io.setMotors(this.speed * 0.6, this.speed * 0.6); // keep rolling straight a little
        return;
      }
      this.whiteStart = null;
    }

    if (!anyOn || sum < 0.3) {
      // Line lost (line-following only mode): spin towards the side it was last seen.
      if (this.mode !== 'search') { this.mode = 'search'; this.lostSince = now; }
      if ((now - this.lostSince) / 1000 > p.lostTimeout_s) {
        this.mode = 'lost'; io.setMotors(0, 0); io.log('Line lost for too long — stopping'); return;
      }
      const dir = this.lastSeenSide >= 0 ? 1 : -1;
      io.setMotors(-dir * p.turnSpeed, dir * p.turnSpeed);
      this.tel = { error_mm: this.lastErr, pid: 0, base: 0 };
      return;
    }
    this.mode = 'follow';

    let pos = 0;
    for (let i = 0; i < N; i += 1) pos += n[i] * io.lateral_mm[i];
    pos /= sum;
    const err = pos;
    if (Math.abs(err) > 2) this.lastSeenSide = Math.sign(err);
    this.integ = Math.max(-p.iLimit, Math.min(p.iLimit, this.integ + p.ki * err * dt));
    const deriv = (err - this.lastErr) / dt;
    this.lastErr = err;
    const a = p.dFilterHz > 0 ? dt / (dt + 1 / (2 * Math.PI * p.dFilterHz)) : 1;
    this.dFilt += a * (deriv - this.dFilt);
    const u = p.kp * err + this.integ + p.kd * this.dFilt;
    const clamp = (v: number) => Math.max(-p.maxSpeed, Math.min(p.maxSpeed, v));
    io.setMotors(clamp(this.speed - u), clamp(this.speed + u));
    this.tel = { error_mm: err, pid: u, base: this.speed };
  }

  private startJunction(io: BrainIO, on: boolean[], odo: number, deadEnd: boolean) {
    this.pattern = on.map((b) => (b ? 1 : 0)).join('');
    this.arrivalYaw = this.yawDeg();
    this.deadEnd = deadEnd;
    this.whiteStart = null;
    if (deadEnd) { this.beginScan(io); return; }
    this.mode = 'inch'; this.inchStart = odo;
  }

  private doInch(io: BrainIO, odo: number) {
    const p = this.prm;
    // Roll straight (heading held with odometry) until the axle is over the junction.
    const yawErr = wrap(this.arrivalYaw - this.yawDeg());
    const s = Math.max(0.2, this.speed * 0.7);
    const c = 0.01 * yawErr;
    io.setMotors(s - c, s + c);
    this.tel = { error_mm: 0, pid: c, base: s };
    // If everything has been black since the junction started, this may be the finish square: keep rolling until
    // the finish distance decides it.
    const maybeFinish = this.blackStart !== null && odo - this.blackStart < p.finishBlack_cm / 100;
    if (odo - this.inchStart >= p.inchForward_cm / 100 && !maybeFinish) { this.blackStart = null; this.beginScan(io); }
  }

  private beginScan(io: BrainIO) {
    this.mode = 'scan';
    this.scanStartYaw = this.yawDeg();
    this.scanOn = null; this.scanIntervals = [];
    io.setMotors(-this.prm.turnSpeed, this.prm.turnSpeed);
  }

  private doScan(io: BrainIO, centreOn: boolean) {
    const rel = this.yawDeg() - this.scanStartYaw; // 0 .. 360+, spinning left
    if (this.scanOn === null) { this.scanOn = centreOn; this.scanStartedOn = centreOn; this.scanIntervalStart = 0; }
    if (centreOn && !this.scanOn) this.scanIntervalStart = rel;
    if (!centreOn && this.scanOn) this.scanIntervals.push([this.scanIntervalStart, rel]);
    this.scanOn = centreOn;
    if (rel < 360) { io.setMotors(-this.prm.turnSpeed, this.prm.turnSpeed); this.tel = { error_mm: 0, pid: 0, base: 0 }; return; }
    // Scan complete. Join an interval that runs through the 0°/360° point.
    const iv = [...this.scanIntervals];
    if (this.scanOn) {
      if (this.scanStartedOn && iv.length && iv[0][0] === 0) iv[0] = [this.scanIntervalStart - 360, iv[0][1]];
      else iv.push([this.scanIntervalStart, rel]);
    }
    // Branch angles relative to the arrival heading (the scan started a little after arrival only in yaw drift).
    const offset = wrap(this.scanStartYaw - this.arrivalYaw);
    const centres = iv.filter(([a, b]) => b - a > 4).map(([a, b]) => wrap((a + b) / 2 + offset));
    // The line we came in on is behind us: drop the one line closest to 180° (if it is within 70° of it).
    // Picking the closest one, rather than a fixed window, copes with the axle stopping a little off the junction.
    let inIdx = -1;
    centres.forEach((c, i) => { if (Math.abs(wrap(c - 180)) < 70 && (inIdx < 0 || Math.abs(wrap(c - 180)) < Math.abs(wrap(centres[inIdx] - 180)))) inIdx = i; });
    const branches = centres.filter((_, i) => i !== inIdx).sort((a, b) => b - a); // leftmost first
    const view: JunctionView = { branches, arrivalYaw_deg: this.arrivalYaw, x: this.ox, y: this.oy };
    if (this.nav instanceof TremauxNavigator) this.nav.odometry = (this.lastL + this.lastR) / 2;
    const choice = this.nav!.choose(view, io.memory);
    io.decision({ kind: choice.kind, branches_deg: branches.map((b) => Math.round(b)), chosen_deg: Math.round(choice.angle), rank: choice.rank, pattern: this.pattern, note: `${choice.note}; lines seen at ${centres.map((c) => Math.round(c)).join(', ')}°` });
    this.lastJunctionOdo = io.odometry_m();
    this.turnTarget = choice.angle;
    this.turnFromYaw = this.yawDeg();
    this.turnStartMs = io.nowMs();
    const cur = wrap(this.yawDeg() - this.arrivalYaw);
    const delta = wrap(this.turnTarget - cur);
    this.turnDir = choice.kind === 'B' ? 1 : delta >= 0 ? 1 : -1;
    this.mode = 'turn';
    this.stateText = choice.kind === 'B' ? 'Turning around' : `Turning ${kindOf(choice.angle) === 'L' ? 'left' : kindOf(choice.angle) === 'R' ? 'right' : 'straight on'}`;
  }

  private doTurn(io: BrainIO, centreOn: boolean) {
    const p = this.prm;
    const cur = wrap(this.yawDeg() - this.arrivalYaw);
    const err = wrap(this.turnTarget - cur);
    const turned = Math.abs(this.yawDeg() - this.turnFromYaw);
    const done = p.turnMethod === 'timed'
      ? Math.abs(err) < 5
      : centreOn && Math.abs(err) < 30;
    if (done || turned > 400) { this.enterFollow(); return; }
    const s = Math.abs(err) < 40 ? p.turnSpeed * 0.7 : p.turnSpeed;
    const dir = p.turnMethod === 'timed' ? (err >= 0 ? 1 : -1) : this.turnDir;
    io.setMotors(-dir * s, dir * s);
    this.tel = { error_mm: 0, pid: 0, base: 0 };
  }

  private enterFollow() {
    this.mode = 'follow'; this.stateText = ''; this.integ = 0; this.dFilt = 0; this.lastErr = 0; this.speed = Math.min(this.speed, 0.25);
    this.whiteStart = null; this.blackStart = null;
  }
}
