// Settings mode: the built-in reference line follower.
// Analog readings drive PID line following; junctions, dead ends and the finish use thresholded (binary) patterns.
// Junctions are read the way a real robot can read them: while it follows the line and rolls over a junction, its
// sensor readings are placed on a small map using its own odometry (see junctionMap.ts). With the axle over the
// junction, the branches connected to it are read off that map, the chosen algorithm picks one, and the robot spins
// only until it is on that branch. There is no full-circle scan.

import { Brain, BrainIO } from './brain';
const on0 = (n: number[]) => n[0] > 0.5;
const onLast = (n: number[]) => n[n.length - 1] > 0.5;
import { JunctionView, kindOf, LsrbNavigator, Navigator, RuleNavigator, TremauxNavigator } from './navigator';
import { Swath } from './junctionMap';

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
  inchMode: 'auto' | 'manual'; // auto: roll the sensor-arm length + half a line width, so the axle ends over the junction
  inchForward_cm: number;     // used when inchMode is 'manual'
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
  inchMode: 'auto',
  inchForward_cm: 10,
  turnMethod: 'spin-until-line',
  deadEndWhite_cm: 3,
  finishBlack_cm: 10,
  lostTimeout_s: 3,
  algorithm: 'left-hand',
  straightFallback: 'left',
  customOrder: 'LSRB',
};

type Mode = 'follow' | 'search' | 'inch' | 'turn' | 'finished' | 'lost';

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
  private readonly swath = new Swath();
  private leftStartAt: number | null = null;
  private nextAhead: { x: number; y: number; yaw: number } | null = null;
  private checked = false;
  private rearmAt: number | null = null;
  private retargeted = false;
  private prevJx = 1e9; private prevJy = 1e9; // centre of the last junction handled (odometry frame)
  private jx = 0; private jy = 0; private jYaw = 0; // junction centre and heading when it was first seen (odometry frame)
  private turnTarget = 0;   // degrees relative to the arrival heading
  private turnDir = 1;
  private turnFromYaw = 0;
  private turnNeed = 90;
  private turnMin = 50;
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
    this.ox = 0; this.oy = 0; this.yaw = 0; this.swath.clear(); this.lastJunctionOdo = -1; this.leftStartAt = null; this.prevJx = 1e9; this.prevJy = 1e9; this.rearmAt = null; this.nextAhead = null; this.checked = false;
  }

  state(): string {
    if (this.stateText) return this.stateText;
    return { follow: 'Following line', search: 'Searching for line', inch: 'Junction: rolling onto it', turn: 'Turning onto branch', finished: 'Finished — stopped', lost: 'Line lost — stopped' }[this.mode];
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
    // Junction and finish checks start once the robot has left the solid start square (2 cm of normal line seen).
    if (this.leftStartAt === null && !allBlack && anyOn) this.leftStartAt = odo;
    if (allBlack && this.leftStartAt !== null && odo - this.leftStartAt < 0.02) this.leftStartAt = null;
    const armed = this.leftStartAt !== null && odo - this.leftStartAt > 0.02;

    // Remember what the sensors saw along the path (for reading junctions), while following or rolling straight.
    if (this.mode === 'follow' || this.mode === 'inch') {
      const off = io.geometry.sensorOffset_mm / 1000, c = Math.cos(this.yaw), sn = Math.sin(this.yaw);
      for (let i = 0; i < N; i += 1) {
        const lat = io.lateral_mm[i] / 1000;
        this.swath.add(this.ox + off * c - lat * sn, this.oy + off * sn + lat * c, n[i], odo, this.yaw);
      }
      this.swath.prune(odo, 0.4);
    }

    // Finish: all sensors black for a set distance while moving forward.
    // The start square is black too: an all-black area within 60 cm of where the run started is not the finish.
    // Generous, because odometry drifts (wheels skid a little in every spin): tens of cm after a minute of turns.
    const nearStart = Math.hypot(this.ox, this.oy) < 0.6;
    if ((this.mode === 'follow' || this.mode === 'inch') && allBlack && armed && !nearStart) {
      if (this.blackStart === null) this.blackStart = odo;
      if (odo - this.blackStart >= p.finishBlack_cm / 100) {
        this.mode = 'finished'; this.stateText = ''; io.setMotors(0, 0);
        io.log('Finish detected: all sensors black');
        io.decision({ kind: 'finish', branches_deg: [], chosen_deg: null, rank: null, pattern: on.map((b) => (b ? 1 : 0)).join(''), note: 'all sensors black' });
        this.nav?.finished({ x: this.ox, y: this.oy, yaw_deg: this.yawDeg() }, io.memory);
        return;
      }
    } else if (this.mode !== 'inch') this.blackStart = null;

    if (this.mode === 'inch') { this.doInch(io, odo, on, n, sum); return; }
    if (this.mode === 'turn') { this.doTurn(io, centreOn, n, sum, on.filter(Boolean).length); return; }
    this.stateText = '';

    // ---------------- follow ----------------
    const dv = p.accel * dt;
    this.speed += Math.max(-dv, Math.min(dv, p.baseSpeed - this.speed));

    if (this.nav && armed) {
      // A possible junction as soon as an outermost sensor sees black together with the centre, or more of the array
      // is black than one line can cover. Whether it really is one is checked from the junction map 4 cm later.
      const black = on.filter(Boolean).length;
      const lineCovers = Math.ceil(38 / Math.max(1, Math.abs(io.lateral_mm[0] - io.lateral_mm[1]))) + 1;
      const settled = this.rearmAt === null || odo - this.rearmAt > 0.03; // 3 cm of line after a turn first
      if (settled && ((on[0] || on[N - 1]) && centreOn || black > Math.min(N - 1, lineCovers)) && this.startJunction(io, on, odo, false, this.lastErr)) return;
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

  // Returns false if this is the junction just handled (seen again by the array after the turn).
  private startJunction(io: BrainIO, on: boolean[], odo: number, deadEnd: boolean, lineErr_mm = 0): boolean {
    this.pattern = on.map((b) => (b ? 1 : 0)).join('');
    this.arrivalYaw = this.yawDeg();
    this.deadEnd = deadEnd;
    this.whiteStart = null;
    if (deadEnd) { this.jx = this.ox; this.jy = this.oy; this.decide(io, [], 0); return true; }
    // The outer sensors have just reached the branch: its centre line is about half a line width further on, and the
    // line itself is where the array last saw it (the line error, + = left).
    const off = io.geometry.sensorOffset_mm / 1000, e = lineErr_mm / 1000;
    const yaw0 = this.yaw, x0 = this.ox, y0 = this.oy;
    const c = Math.cos(yaw0), sn = Math.sin(yaw0);
    const jx = x0 + (off + 0.019) * c - e * sn, jy = y0 + (off + 0.019) * sn + e * c;
    if (Math.hypot(jx - this.prevJx, jy - this.prevJy) < 0.05) return false;
    this.jYaw = yaw0; this.jx = jx; this.jy = jy; this.arrivalYaw = (yaw0 * 180) / Math.PI;
    this.mode = 'inch'; this.inchStart = odo; this.checked = false; this.retargeted = false;
    return true;
  }

  private doInch(io: BrainIO, odo: number, on: boolean[], n: number[], sum: number) {
    const p = this.prm;
    // Roll onto the junction. Auto: steer the axle to the junction centre (from odometry); while the array still sees a
    // single line (the one being followed), follow it instead, so a curve or a crooked arrival is tracked. Manual: roll
    // the set distance holding the heading.
    const dx = this.jx - this.ox, dy = this.jy - this.oy;
    const auto = p.inchMode !== 'manual';
    const spacing = Math.abs(io.lateral_mm[0] - io.lateral_mm[1]);
    const black = on.filter(Boolean).length;
    const single = black >= 1 && black <= Math.ceil(38 / Math.max(1, spacing)) && !on[0] && !on[on.length - 1];
    // Slow down over the last few cm so the robot stops on the centre instead of rolling past it (matters at a slow
    // loop rate or a high base speed).
    const remaining = Math.max(0, dx * Math.cos(this.yaw) + dy * Math.sin(this.yaw));
    const s = auto ? Math.min(Math.max(0.2, this.speed * 0.7), 0.14 + 3 * remaining) : Math.max(0.2, this.speed * 0.7);
    let c: number;
    let pos = 0;
    if (sum > 0.3) { for (let i = 0; i < n.length; i += 1) pos += n[i] * io.lateral_mm[i]; pos /= sum; }
    if (auto && single && sum > 0.3 && Math.abs(pos) < 1.5 * spacing) {
      c = Math.max(-0.08, Math.min(0.08, p.kp * pos * 0.7)); // gentle: a branch passing under the array must not pull it
    } else {
      const aim = auto ? (Math.atan2(dy, dx) * 180) / Math.PI : this.arrivalYaw;
      c = Math.max(-0.2, Math.min(0.2, 0.02 * wrap(aim - this.yawDeg())));
    }
    io.setMotors(s - c, s + c);
    this.tel = { error_mm: 0, pid: c, base: s };
    // If everything has been black since the junction started, this may be the finish square: keep rolling until
    // the finish distance decides it.
    const maybeFinish = this.blackStart !== null && odo - this.blackStart < p.finishBlack_cm / 100;
    const travelled = odo - this.inchStart;
    // 4 cm on, check it really is a junction: a curve or the robot drifting sideways also lights an end sensor. If the
    // map shows only the line carrying on (no side branch, no fork ahead), go back to following.
    if (!this.checked && travelled >= 0.04 && this.pattern !== 'ahead') {
      this.checked = true;
      const spacing = Math.abs(io.lateral_mm[0] - io.lateral_mm[1]) / 1000;
      const half = Math.max(...io.lateral_mm.map(Math.abs)) / 1000 + spacing / 2;
      const r0 = this.swath.read(this.jx, this.jy, this.jYaw, spacing / 2, half, 0.02);
      const sideOrFork = r0.exits.some((x) => Math.abs(x.deg) > 30 || x.width > 0.055);
      if (!sideOrFork && r0.exits.length >= 1) { this.prevJx = this.jx; this.prevJy = this.jy; this.enterFollow(); this.speed = Math.max(this.speed, 0.2); return; }
    }
    const arrived = auto ? (dx * Math.cos(this.yaw) + dy * Math.sin(this.yaw) <= 0.003 || travelled > io.geometry.sensorOffset_mm / 1000 + 0.06) : travelled >= p.inchForward_cm / 100;
    if (arrived && !maybeFinish) {
      this.blackStart = null;
      const spacing = Math.abs(io.lateral_mm[0] - io.lateral_mm[1]) / 1000;
      const half = Math.max(...io.lateral_mm.map(Math.abs)) / 1000 + spacing / 2;
      const ahead = io.geometry.sensorOffset_mm / 1000 - Math.hypot(this.jx - this.ox, this.jy - this.oy) * 0;
      const r = this.swath.read(this.jx, this.jy, this.jYaw, spacing / 2, half, Math.max(0.03, ahead));
      const ref = r.incoming === null ? 0 : wrap(r.incoming - 180);
      // Only a straight line on: a wide spot or a crooked crossing of the same line, not a junction.
      if (r.incoming !== null && r.branches.length === 1 && Math.abs(r.branches[0]) < 20) {
        this.lastJunctionOdo = odo; this.enterFollow(); this.speed = Math.max(this.speed, 0.2); return;
      }
      const lineYaw = wrap((this.jYaw * 180) / Math.PI + ref);
      // Triggered early (a curve lit an end sensor before the junction): nothing branches off near the presumed
      // centre, but something does further ahead. Move the centre there and roll on (once per junction).
      const sideNear = r.exits.some((x) => Math.abs(x.deg) > 25 && x.along <= 0.045);
      const sideFar = r.exits.filter((x) => Math.abs(x.deg) > 25 && x.along > 0.045);
      if (!sideNear && sideFar.length && !this.retargeted && r.incoming !== null) {
        const first = sideFar.reduce((a, b) => (b.along < a.along ? b : a));
        const jAlong = Math.max(0.03, first.along - Math.abs(first.lat) / Math.tan((Math.max(25, Math.min(90, Math.abs(first.deg))) * Math.PI) / 180));
        const ly = (lineYaw * Math.PI) / 180;
        this.retargeted = true;
        this.jx += jAlong * Math.cos(ly); this.jy += jAlong * Math.sin(ly); this.jYaw = ly; this.arrivalYaw = lineYaw;
        this.inchStart = odo;
        return;
      }
      // Going straight on, another junction may already be under the array (closer than the sensor arm): roll on to
      // it and read it from the same map.
      this.nextAhead = null;
      const side = r.exits.filter((x) => Math.abs(x.deg) > 25 && x.along > 0.045);
      if (side.length) {
        const first = side.reduce((a, b) => (b.along < a.along ? b : a));
        const jAlong = Math.max(0.035, first.along - Math.abs(first.lat) / Math.tan((Math.max(25, Math.min(90, Math.abs(first.deg))) * Math.PI) / 180));
        const ly = (lineYaw * Math.PI) / 180;
        this.nextAhead = { x: this.jx + jAlong * Math.cos(ly), y: this.jy + jAlong * Math.sin(ly), yaw: ly };
      }
      this.decide(io, r.branches, lineYaw);
    }
  }

  // branches: degrees relative to the incoming line (+ = left); lineYaw: the incoming line's heading in the brain frame.
  private decide(io: BrainIO, branches: number[], lineYaw: number) {
    if (this.deadEnd) lineYaw = this.yawDeg();
    this.arrivalYaw = lineYaw;
    const view: JunctionView = { branches, arrivalYaw_deg: this.arrivalYaw, x: this.ox, y: this.oy };
    if (this.nav instanceof TremauxNavigator) this.nav.odometry = (this.lastL + this.lastR) / 2;
    const choice = this.nav!.choose(view, io.memory);
    io.decision({ kind: choice.kind, branches_deg: branches.map((b) => Math.round(b)), chosen_deg: Math.round(choice.angle), rank: choice.rank, pattern: this.pattern,
      note: `${choice.note}; ${branches.length ? `branches at ${branches.map((b) => Math.round(b)).join(', ')}°` : 'no branch (dead end)'}` });
    this.lastJunctionOdo = io.odometry_m();
    this.prevJx = this.jx; this.prevJy = this.jy;
    this.turnTarget = choice.angle;
    this.turnFromYaw = this.yawDeg();
    this.turnStartMs = io.nowMs();
    const cur = wrap(this.yawDeg() - this.arrivalYaw);
    const delta = wrap(this.turnTarget - cur);
    if (choice.kind === 'S' && Math.abs(delta) < 20) {
      if (this.nextAhead) {
        const n2 = this.nextAhead; this.nextAhead = null;
        this.prevJx = this.jx; this.prevJy = this.jy;
        this.jx = n2.x; this.jy = n2.y; this.jYaw = n2.yaw; this.arrivalYaw = (n2.yaw * 180) / Math.PI;
        this.pattern = 'ahead'; this.deadEnd = false; this.mode = 'inch'; this.inchStart = io.odometry_m();
        return;
      }
      this.enterFollow(); this.speed = Math.max(this.speed, 0.2); return;
    }
    this.turnDir = choice.kind === 'B' ? 1 : delta >= 0 ? 1 : -1;
    this.turnNeed = choice.kind === 'B' ? 180 : Math.abs(delta);
    // Lines met earlier in the spin belong to other branches: accept a line only past halfway from the previous branch
    // (in the spin direction) to the chosen one. The straight-on line counts as a branch at 0°.
    this.turnMin = this.turnNeed < 35 ? 0 : Math.max(0, this.turnNeed - 40);
    if (choice.kind !== 'B' && this.turnNeed >= 35) {
      const withStraight = branches.some((b) => Math.abs(b) < 25) ? branches : [0, ...branches];
      const rel = withStraight.map((b) => this.turnDir * wrap(b - (choice.angle - delta)));
      const before = rel.filter((r) => r > 2 && r < this.turnNeed - 2);
      if (before.length) this.turnMin = Math.max(this.turnMin, (Math.max(...before) + this.turnNeed) / 2);
    }
    this.swath.clear(); // a spin adds odometry error: start a fresh map on the new line
    this.mode = 'turn';
    this.stateText = choice.kind === 'B' ? 'Turning around' : `Turning ${kindOf(choice.angle) === 'L' ? 'left' : kindOf(choice.angle) === 'R' ? 'right' : 'straight on'}`;
  }

  private doTurn(io: BrainIO, centreOn: boolean, n: number[], sum: number, black: number) {
    const p = this.prm;
    const cur = wrap(this.yawDeg() - this.arrivalYaw);
    const err = wrap(this.turnTarget - cur);
    const turned = Math.abs(this.yawDeg() - this.turnFromYaw);
    let pos = 0;
    if (sum > 0) { for (let i = 0; i < n.length; i += 1) pos += n[i] * io.lateral_mm[i]; pos /= sum; }
    const spacing = Math.abs(io.lateral_mm[0] - io.lateral_mm[1]);
    // Spin until the line is centred under the array near the chosen branch's direction. Slow down as the line comes
    // into view so the spin stops on it instead of sweeping past.
    const done = p.turnMethod === 'timed'
      ? Math.abs(err) < 5
      // Take the first single line centred under the array once the spin is within 40° of the branch. A short branch
      // may bend away before the array (on its sensor arm) reaches it, so the line may be found beyond the branch angle.
      : centreOn && Math.abs(pos) <= spacing && this.turnDir * (this.yawDeg() - this.turnFromYaw) >= this.turnMin;
    if (done || turned > 400) { if (turned > 400) io.log('Turn: no line found after a full circle'); io.setMotors(0, 0); this.enterFollow(); this.rearmAt = io.odometry_m(); return; }
    const near = p.turnMethod === 'timed' ? Math.abs(err) < 25 : (sum > 0.3 && Math.abs(err) < 50);
    const s = near ? p.turnSpeed * 0.55 : Math.abs(err) < 40 ? p.turnSpeed * 0.7 : p.turnSpeed;
    const dir = p.turnMethod === 'timed' ? (err >= 0 ? 1 : -1) : this.turnDir;
    io.setMotors(-dir * s, dir * s);
    this.tel = { error_mm: pos, pid: 0, base: 0 };
  }

  private enterFollow() {
    this.mode = 'follow'; this.stateText = ''; this.integ = 0; this.dFilt = 0; this.lastErr = 0; this.speed = Math.min(this.speed, 0.25);
    this.whiteStart = null; this.blackStart = null;
  }
}
