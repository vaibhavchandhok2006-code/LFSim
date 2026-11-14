// Differential-drive robot physics: DC gear motors, motor driver, battery, tyre grip, caster drag.
// World frame = image frame: x right, y down, metres. theta = heading angle; heading = (cos, sin).

import { G, RobotProfile, yawInertia } from './profile';

const KGCM_TO_NM = 0.0980665;

export interface MotorDerived {
  R: number;   // winding resistance, ohm
  Kt: number;  // output torque per amp, N·m/A
  Ke: number;  // back-EMF per output rad/s, V·s/rad
  Jw: number;  // reflected rotor + wheel inertia at the wheel, kg·m²
  tauF: number; // internal friction torque at the output (gearbox + brushes), N·m
}

export interface DriverDerived { fixedDrop: number; rOn: number; maxCurrent: number }

export function deriveMotor(p: RobotProfile, scale = 1): MotorDerived {
  const m = p.motor;
  const R = m.ratedV / m.stallCurrent_A;
  const Kt = (m.stallTorque_kgcm * KGCM_TO_NM * scale) / m.stallCurrent_A;
  const omega0 = (m.noLoadRpm * 2 * Math.PI) / 60;
  // Real gear motors draw ~6% of stall current with no load (gearbox + brush friction).
  // The shop's no-load rpm already includes that loss, so back-EMF is fitted to it.
  const i0 = 0.06 * m.stallCurrent_A;
  const Ke = ((m.ratedV - i0 * R) / omega0) / scale;
  const tauF = Kt * i0;
  // Small gear motor: rotor inertia ~5e-9 kg·m² reflected through the gearbox, plus the wheel itself.
  const gr = Math.max(1, m.gearRatio);
  const r = p.wheelDiameter_mm / 2000;
  const Jw = 5e-9 * gr * gr + 0.5 * 0.01 * r * r;
  return { R, Kt, Ke, Jw, tauF };
}

// Datasheet-based driver models: TB6612FNG ~0.5 ohm per switch (two in the path), 1.2 A continuous / 3.2 A peak.
// L298N: bipolar output stage, roughly 1.8 V total drop plus a little resistance, 2 A per channel.
export function deriveDriver(p: RobotProfile): DriverDerived {
  return p.driver === 'TB6612FNG'
    ? { fixedDrop: 0, rOn: 1.0, maxCurrent: 3.2 }
    : { fixedDrop: 1.8, rOn: 0.5, maxCurrent: 2.0 };
}

export interface BodyState {
  x: number; y: number; theta: number;  // pose
  vx: number; vy: number; omega: number; // world velocity, yaw rate
  wL: number; wR: number;               // wheel angular speeds, rad/s (positive = forward)
  angL: number; angR: number;           // wheel angles, rad (for encoders and drawing)
  iL: number; iR: number;               // motor currents, A
  vBatt: number;                        // battery terminal voltage
  used_mAh: number;
  slipping: boolean;
}

export function initialBody(x: number, y: number, theta: number, p: RobotProfile): BodyState {
  return { x, y, theta, vx: 0, vy: 0, omega: 0, wL: 0, wR: 0, angL: 0, angR: 0, iL: 0, iR: 0, vBatt: p.battery.fullV, used_mAh: 0, slipping: false };
}

export interface PhysicsFlags { motorMismatch: boolean; batterySag: boolean; grip: boolean }

export class Physics {
  readonly p: RobotProfile;
  readonly mL: MotorDerived;
  readonly mR: MotorDerived;
  readonly drv: DriverDerived;
  readonly mass: number;
  readonly inertia: number;
  readonly wheelR: number;
  readonly half: number;
  readonly wheelLoad: number;   // normal force per drive wheel, N
  readonly casterLoad: number;  // normal force on the caster, N
  flags: PhysicsFlags;

  constructor(p: RobotProfile, flags: PhysicsFlags) {
    this.p = p;
    this.flags = flags;
    this.mL = deriveMotor(p, 1);
    this.mR = deriveMotor(p, flags.motorMismatch ? 1 - p.motor.mismatch_pct / 100 : 1);
    this.drv = deriveDriver(p);
    this.mass = p.mass_g / 1000;
    this.inertia = yawInertia(p);
    this.wheelR = p.wheelDiameter_mm / 2000;
    this.half = p.wheelbase_mm / 2000;
    // Static load split between the wheel axle and the caster from the centre-of-mass position.
    const c = p.casterOffset_mm, d = p.comOffset_mm;
    let casterShare = c !== 0 ? d / c : 0;
    casterShare = Math.min(0.6, Math.max(0, casterShare));
    this.casterLoad = this.mass * G * casterShare;
    this.wheelLoad = (this.mass * G * (1 - casterShare)) / 2;
  }

  private quantise(duty: number): number {
    const steps = 2 ** this.p.pwmBits - 1;
    const d = Math.max(-1, Math.min(1, duty));
    return Math.round(d * steps) / steps;
  }

  private motorCurrent(m: MotorDerived, duty: number, w: number, vb: number): number {
    // Average H-bridge output voltage, minus the driver drop, against back-EMF.
    const vApplied = duty * vb;
    const drop = Math.sign(vApplied) * Math.min(Math.abs(vApplied), this.drv.fixedDrop);
    let i = (vApplied - drop - m.Ke * w) / (m.R + this.drv.rOn);
    if (duty === 0) i = 0; // coast: both driver outputs off, no current flows
    const lim = this.drv.maxCurrent;
    return Math.max(-lim, Math.min(lim, i));
  }

  // Advance by dt seconds with the given PWM duties (-1..1). Call with dt <= 0.5 ms.
  step(s: BodyState, dutyL: number, dutyR: number, dt: number): void {
    const p = this.p;
    const dL = this.quantise(dutyL), dR = this.quantise(dutyR);

    // Battery: open-circuit voltage falls slowly with charge used; terminal voltage sags with current.
    const soc = Math.max(0, 1 - s.used_mAh / p.battery.capacity_mAh);
    const vOpen = p.battery.nominalV - 0.3 + (p.battery.fullV - p.battery.nominalV + 0.3) * soc;
    const draw = Math.abs(s.iL * dL) + Math.abs(s.iR * dR);
    s.vBatt = this.flags.batterySag ? vOpen - p.battery.internalR_ohm * draw : p.battery.fullV;

    s.iL = this.motorCurrent(this.mL, dL, s.wL, s.vBatt);
    s.iR = this.motorCurrent(this.mR, dR, s.wR, s.vBatt);
    s.used_mAh += (draw * dt * 1000) / 3600;
    const fric = (m: MotorDerived, w: number) => m.tauF * Math.tanh(w / 0.5);
    const tauL = this.mL.Kt * s.iL - fric(this.mL, s.wL);
    const tauR = this.mR.Kt * s.iR - fric(this.mR, s.wR);

    const c = Math.cos(s.theta), sn = Math.sin(s.theta);
    const hx = c, hy = sn;          // heading
    const lx = sn, ly = -c;         // left (y-down frame)
    const mu = this.flags.grip ? p.grip : 5;

    let Fx = 0, Fy = 0, Mz = 0;
    let slipping = false;
    const wheel = (side: 1 | -1, w: number, tau: number): number => {
      const rx = side * this.half * lx, ry = side * this.half * ly;
      const ux = s.vx - s.omega * ry, uy = s.vy + s.omega * rx; // contact point velocity
      const uLong = ux * hx + uy * hy;
      const uLat = ux * lx + uy * ly;
      const N = this.wheelLoad;
      // Stiff linear tyre up to the friction circle (saturates at ~1.5 cm/s slip).
      const k = (mu * N) / 0.015;
      let fLong = k * (w * this.wheelR - uLong);
      let fLat = -k * uLat;
      const mag = Math.hypot(fLong, fLat), lim = mu * N;
      if (mag > lim) { fLong *= lim / mag; fLat *= lim / mag; slipping = true; }
      // rolling resistance of the tyre
      fLong -= 0.01 * N * Math.tanh(uLong / 0.01);
      const fx = fLong * hx + fLat * lx, fy = fLong * hy + fLat * ly;
      Fx += fx; Fy += fy; Mz += rx * fy - ry * fx;
      return (tau - fLong * this.wheelR) / (side === 1 ? this.mL.Jw : this.mR.Jw);
    };
    const aL = wheel(1, s.wL, tauL);
    const aR = wheel(-1, s.wR, tauR);

    // Caster: rolling drag along its own velocity (it swivels, so no side force).
    const cr = p.casterOffset_mm / 1000;
    const cx_ = cr * hx, cy_ = cr * hy;
    const ucx = s.vx - s.omega * cy_, ucy = s.vy + s.omega * cx_;
    const us = Math.hypot(ucx, ucy);
    if (us > 1e-6) {
      const f = 0.04 * this.casterLoad * Math.tanh(us / 0.01);
      const fx = (-f * ucx) / us, fy = (-f * ucy) / us;
      Fx += fx; Fy += fy; Mz += cx_ * fy - cy_ * fx;
    }

    // Integrate (semi-implicit Euler). Wheel axle centre is the reference point.
    s.wL += aL * dt; s.wR += aR * dt;
    s.vx += (Fx / this.mass) * dt;
    s.vy += (Fy / this.mass) * dt;
    s.omega += (Mz / this.inertia) * dt;
    s.x += s.vx * dt; s.y += s.vy * dt; s.theta += s.omega * dt;
    s.angL += s.wL * dt; s.angR += s.wR * dt;
    s.slipping = slipping;
  }

  // Forward speed along the heading, m/s.
  forwardSpeed(s: BodyState): number {
    return s.vx * Math.cos(s.theta) + s.vy * Math.sin(s.theta);
  }

  // Theoretical top speed at full battery and full duty (no-load rpm scaled by voltage).
  nominalTopSpeed(): number {
    const i0 = this.mL.tauF / this.mL.Kt;
    const v = this.p.battery.fullV - this.drv.fixedDrop - i0 * (this.mL.R + this.drv.rOn);
    const omega = v / this.mL.Ke;
    return omega * this.wheelR;
  }
}
