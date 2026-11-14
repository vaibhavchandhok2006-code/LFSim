// Settings mode: the built-in reference line follower.
// Analog readings drive PID line following; junction, dead-end and finish logic use thresholded (binary) patterns.

import { Brain, BrainIO } from './brain';

export type Algorithm = 'pid-only' | 'left-hand' | 'right-hand' | 'straight-first' | 'custom' | 'lsrb' | 'tremaux';

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
  lostTimeout_s: number; // stop searching after this long without the line
  algorithm: Algorithm;
}

export const DEFAULT_SETTINGS: SettingsParams = {
  version: 1,
  kp: 0.012,
  ki: 0,
  kd: 0.0012,
  iLimit: 0.2,
  dFilterHz: 20,
  loopHz: 500,
  baseSpeed: 0.42,
  maxSpeed: 0.9,
  turnSpeed: 0.35,
  accel: 2.5,
  junctionOuter: 2,
  inchForward_cm: 8,
  turnMethod: 'spin-until-line',
  deadEndWhite_cm: 4,
  finishBlack_cm: 7,
  lostTimeout_s: 3,
  algorithm: 'pid-only',
};

type Mode = 'follow' | 'search' | 'finished' | 'lost';

export class SettingsBrain implements Brain {
  readonly name = 'Settings mode';
  readonly loopHz: number;
  private prm: SettingsParams;
  private mode: Mode = 'follow';
  private integ = 0;
  private lastErr = 0;
  private dFilt = 0;
  private lastT = 0;
  private speed = 0;
  private lastSeenSide = 0;
  private lostSince = 0;
  private blackStart: number | null = null;
  private tel: Record<string, number> = {};

  constructor(prm: SettingsParams) {
    this.prm = prm;
    this.loopHz = prm.loopHz;
  }

  reset(io: BrainIO): void {
    this.mode = 'follow'; this.integ = 0; this.lastErr = 0; this.dFilt = 0; this.lastT = io.nowMs();
    this.speed = 0; this.lastSeenSide = 0; this.lostSince = 0; this.blackStart = null;
  }

  state(): string {
    return { follow: 'Following line', search: 'Searching for line', finished: 'Finished — stopped', lost: 'Line lost — stopped' }[this.mode];
  }
  finished(): boolean { return this.mode === 'finished'; }
  telemetry(): Record<string, number> { return this.tel; }

  tick(io: BrainIO): void {
    const p = this.prm;
    const now = io.nowMs();
    const dt = Math.max(1e-4, (now - this.lastT) / 1000);
    this.lastT = now;
    if (this.mode === 'finished' || this.mode === 'lost') { io.setMotors(0, 0); return; }

    const raw = io.readSensors();
    const span = io.blackRaw - io.whiteRaw;
    const n = raw.map((v) => Math.max(0, Math.min(1, (v - io.whiteRaw) / span)));
    const on = raw.map((v) => (span > 0 ? v > io.threshold : v < io.threshold));
    const sum = n.reduce((a, b) => a + b, 0);
    const allBlack = on.every(Boolean);
    const anyOn = on.some(Boolean);

    // Finish: all sensors black for a set distance (armed after leaving the start area).
    const odo = io.odometry_m();
    if (allBlack && odo > 0.3) {
      if (this.blackStart === null) this.blackStart = odo;
      if (odo - this.blackStart >= p.finishBlack_cm / 100) {
        this.mode = 'finished'; io.setMotors(0, 0); io.log('Finish detected: all sensors black'); return;
      }
    } else this.blackStart = null;

    // Ramp base speed (acceleration limit).
    const target = p.baseSpeed;
    const dv = p.accel * dt;
    this.speed += Math.max(-dv, Math.min(dv, target - this.speed));

    if (!anyOn || sum < 0.3) {
      // Line lost: spin towards the side it was last seen.
      if (this.mode !== 'search') { this.mode = 'search'; this.lostSince = now; }
      if ((now - this.lostSince) / 1000 > p.lostTimeout_s) {
        this.mode = 'lost'; io.setMotors(0, 0); io.log('Line lost for too long — stopping'); return;
      }
      const dir = this.lastSeenSide >= 0 ? 1 : -1; // + = line was on the left
      io.setMotors(-dir * p.turnSpeed, dir * p.turnSpeed);
      this.tel = { error_mm: this.lastErr, pid: 0, base: 0 };
      return;
    }
    this.mode = 'follow';

    // Weighted-average line position, mm (+ = line is left of centre).
    let pos = 0;
    for (let i = 0; i < n.length; i += 1) pos += n[i] * io.lateral_mm[i];
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
}
