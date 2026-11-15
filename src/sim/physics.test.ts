import { describe, expect, it } from 'vitest';
import { initialBody, Physics } from './physics';
import { DEFAULT_PROFILE } from './profile';

const flagsIdeal = { motorMismatch: false, batterySag: false, grip: true };

function run(dutyL: number, dutyR: number, seconds: number, flags = flagsIdeal) {
  const ph = new Physics(DEFAULT_PROFILE, flags);
  const s = initialBody(0, 0, 0, DEFAULT_PROFILE);
  const dt = 0.00025;
  for (let t = 0; t < seconds; t += dt) ph.step(s, dutyL, dutyR, dt);
  return { ph, s };
}

describe('physics', () => {
  it('reaches close to the motor-maths top speed in a straight line', () => {
    const { ph, s } = run(1, 1, 3);
    const v = ph.forwardSpeed(s);
    const expected = ph.nominalTopSpeed();
    // load from rolling resistance and driver resistance lowers it a few percent
    expect(v).toBeGreaterThan(expected * 0.85);
    expect(v).toBeLessThan(expected * 1.01);
  });

  it('drives straight with equal motors and no mismatch', () => {
    const { s } = run(0.6, 0.6, 2);
    expect(Math.abs(s.theta)).toBeLessThan(1e-3);
    expect(Math.abs(s.y)).toBeLessThan(1e-3);
  });

  it('curves towards the weaker motor when mismatch is on', () => {
    const { s } = run(0.6, 0.6, 2, { motorMismatch: true, batterySag: false, grip: true });
    // right motor is weaker -> turns right -> theta increases in the y-down frame
    expect(s.theta).toBeGreaterThan(0.01);
  });

  it('spins in place at the expected rate', () => {
    const { ph, s } = run(0.5, -0.5, 2);
    // Rolling without slip: yaw rate = (left - right wheel speed) / wheelbase. With the CoM off the axle the axle may
    // drift round a small circle (a common-mode wheel speed), so the two wheel speeds need not be equal and opposite.
    const expectedOmega = ((s.wL - s.wR) * ph.wheelR) / (DEFAULT_PROFILE.wheelbase_mm / 1000);
    expect(Math.abs(s.omega - expectedOmega) / expectedOmega).toBeLessThan(0.05);
    expect(Math.hypot(s.x, s.y)).toBeLessThan(0.01);
  });

  it('accelerates in a realistic time (0 to 90% in under half a second)', () => {
    const ph = new Physics(DEFAULT_PROFILE, flagsIdeal);
    const s = initialBody(0, 0, 0, DEFAULT_PROFILE);
    const top = ph.nominalTopSpeed();
    let t = 0;
    while (ph.forwardSpeed(s) < 0.9 * top * 0.95 && t < 2) { ph.step(s, 1, 1, 0.00025); t += 0.00025; }
    expect(t).toBeLessThan(0.5);
  });

  it('stays stable at low gear ratios (10:1 and 1:1): no NaN, no wheel chatter, sensible top speed', () => {
    for (const gearRatio of [10, 1]) {
      const p = { ...DEFAULT_PROFILE, motor: { ...DEFAULT_PROFILE.motor, gearRatio } };
      const ph = new Physics(p, flagsIdeal);
      const s = initialBody(0, 0, 0, p);
      let flips = 0, prev = false, maxW = 0;
      for (let t = 0; t < 2; t += 0.00025) {
        ph.step(s, 0.8, 0.8, 0.00025);
        if (t > 1 && s.slipping !== prev) flips += 1;
        prev = s.slipping;
        if (t > 1) maxW = Math.max(maxW, Math.abs(s.wL - s.wR));
      }
      expect(Number.isFinite(s.x + s.wL + s.omega)).toBe(true);
      expect(flips).toBeLessThan(5);
      expect(maxW).toBeLessThan(0.5);
      expect(ph.forwardSpeed(s)).toBeGreaterThan(0.5 * 0.8 * ph.nominalTopSpeed());
      expect(ph.forwardSpeed(s)).toBeLessThan(1.01 * ph.nominalTopSpeed());
    }
  });

  it('has a motor dead band from static friction (estimate 2.5× running friction)', () => {
    expect(Math.hypot(run(0.04, 0.04, 1).s.x, run(0.04, 0.04, 1).s.y)).toBeLessThan(1e-4);
    expect(run(0.3, 0.3, 1).s.x).toBeGreaterThan(0.05);
    const p = { ...DEFAULT_PROFILE, motor: { ...DEFAULT_PROFILE.motor, stictionFactor: 1 } };
    const ph = new Physics(p, flagsIdeal), s = initialBody(0, 0, 0, p);
    for (let t = 0; t < 1; t += 0.00025) ph.step(s, 0.08, 0.08, 0.00025);
    const sStick = run(0.08, 0.08, 1).s;
    expect(s.x).toBeGreaterThan(sStick.x); // less static friction moves further at a small duty
  });

  it('turns about the centre of mass correctly: a CoM ahead of the axle keeps a straight run straight', () => {
    const p = { ...DEFAULT_PROFILE, comOffset_mm: 20 };
    const ph = new Physics(p, flagsIdeal), s = initialBody(0, 0, 0, p);
    for (let t = 0; t < 2; t += 0.00025) ph.step(s, 0.6, 0.6, 0.00025);
    expect(Math.abs(s.theta)).toBeLessThan(1e-3);
    expect(Math.abs(s.y)).toBeLessThan(1e-3);
  });
});
