import { describe, expect, it } from 'vitest';
import { loadGridMaze } from '../testutil';
import { Simulation } from './simulation';
import { DEFAULT_PROFILE, RobotProfile } from './profile';
import { Brain, BrainIO } from '../brain/brain';

// A brain that drives straight at a fixed duty and records the odometry the robot reports.
class Straight implements Brain {
  readonly name = 'straight'; readonly loopHz = 500; last = 0;
  constructor(private duty: number) {}
  reset() {} finished() { return false; } state() { return 'driving'; } telemetry() { return {}; }
  tick(io: BrainIO) { io.setMotors(this.duty, this.duty); this.last = io.odometry_m(); }
}

function drive(profile: RobotProfile, duty: number, seconds: number) {
  const brain = new Straight(duty);
  const s = new Simulation(loadGridMaze(), profile, brain);
  s.advance(seconds);
  return { s, odo: brain.last, truth: s.distance };
}

describe('odometry seen by Settings-mode brains', () => {
  it('with encoders: counts are exact to one count', () => {
    const { odo, truth } = drive(DEFAULT_PROFILE, 0.4, 1);
    expect(Math.abs(odo - truth)).toBeLessThan(0.005);
  });

  it('without encoders: only an estimate from the commanded duty (not the true distance)', () => {
    const p = { ...DEFAULT_PROFILE, encoders: { ...DEFAULT_PROFILE.encoders, present: false } };
    const { odo, truth } = drive(p, 0.4, 1);
    expect(odo).toBeGreaterThan(0);
    expect(Math.abs(odo - truth)).toBeGreaterThan(0.005);       // not exact any more
    expect(Math.abs(odo - truth) / truth).toBeLessThan(0.5);    // but in the right range
  });
});
