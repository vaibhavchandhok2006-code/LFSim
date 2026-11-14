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
    const wheelV = s.wL * ph.wheelR;
    const expectedOmega = (2 * wheelV) / DEFAULT_PROFILE.wheelbase_mm * 1000;
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
});
