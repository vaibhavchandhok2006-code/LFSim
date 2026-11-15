// Robot Profile: every physical input that describes a robot.
// Units are in the field names. All lengths in mm unless noted.

export type DriverModel = 'TB6612FNG' | 'L298N';

export interface SensorArrayProfile {
  channels: number;          // number of IR sensors in the straight array
  spacing_mm: number;        // centre-to-centre distance between neighbouring sensors
  height_mm: number;         // height of the sensor face above the floor
  spot_mm: number;           // diameter of the floor spot each sensor sees; 0 = estimate from height
  adcBits: number;           // ADC resolution, e.g. 12 -> 0..4095
  whiteRaw: number;          // raw reading over white at the reference height (5 mm)
  blackRaw: number;          // raw reading over black at the reference height (5 mm)
  noise_pct: number;         // 1-sigma noise as % of the white-black range
  mismatch_pct: number;      // sensor-to-sensor gain spread, %
  threshold: number;         // raw value that counts as "on the line" (LED on)
}

export interface MotorProfile {
  ratedV: number;            // rated voltage of the gear motor
  noLoadRpm: number;         // output-shaft rpm at rated voltage, no load
  stallTorque_kgcm: number;  // output-shaft stall torque at rated voltage
  stallCurrent_A: number;    // stall current at rated voltage
  gearRatio: number;         // sets the reflected rotor inertia (acceleration, braking); encoder CPR is per wheel revolution
  mismatch_pct: number;      // how much weaker the right motor is than the left
  stictionFactor?: number;   // static (breakaway) friction ÷ running friction in the gearbox; estimate 2.5 → a small dead band
}

export interface RobotProfile {
  version: 1;
  name: string;
  // Geometry
  wheelbase_mm: number;      // wheel centre to wheel centre
  wheelDiameter_mm: number;
  wheelWidth_mm: number;
  length_mm: number;         // overall length
  width_mm: number;          // overall width
  axleFromFront_mm: number;  // distance from the front edge of the robot back to the wheel axle
  sensorOffset_mm: number;   // sensor array distance ahead of the wheel axle
  casterOffset_mm: number;   // caster position from the axle (+ ahead, - behind)
  comOffset_mm: number;      // centre of mass from the axle (+ ahead)
  sensor: SensorArrayProfile;
  motor: MotorProfile;
  driver: DriverModel;
  pwmFreq_Hz: number;
  pwmBits: number;
  battery: { fullV: number; nominalV: number; capacity_mAh: number; internalR_ohm: number };
  mass_g: number;
  inertia_kgm2: number;      // yaw inertia about the axle centre; 0 = estimate from mass and footprint
  grip: number;              // tyre friction coefficient on the mat
  encoders: { present: boolean; usedInCode: boolean; cpr: number };
}

// A typical small competition robot (ESP32 + 8-channel analog array + TB6612FNG + N20 motors + 2S LiPo).
// Every value is editable in the app; values not from a datasheet are reasonable estimates.
export const DEFAULT_PROFILE: RobotProfile = {
  version: 1,
  name: 'My line follower',
  wheelbase_mm: 120,
  wheelDiameter_mm: 34,
  wheelWidth_mm: 12,
  length_mm: 170,
  width_mm: 140,
  axleFromFront_mm: 110,
  sensorOffset_mm: 85,
  casterOffset_mm: -50,
  comOffset_mm: -10,
  sensor: {
    channels: 8,
    spacing_mm: 12,
    height_mm: 6,
    spot_mm: 0,
    adcBits: 12,
    whiteRaw: 250,
    blackRaw: 3600,
    noise_pct: 1.5,
    mismatch_pct: 4,
    threshold: 1900,
  },
  motor: {
    ratedV: 6,
    noLoadRpm: 600,
    stallTorque_kgcm: 0.6,
    stallCurrent_A: 1.6,
    gearRatio: 50,
    mismatch_pct: 3,
    stictionFactor: 2.5,
  },
  driver: 'TB6612FNG',
  pwmFreq_Hz: 20000,
  pwmBits: 10,
  battery: { fullV: 8.4, nominalV: 7.4, capacity_mAh: 850, internalR_ohm: 0.15 },
  mass_g: 320,
  inertia_kgm2: 0,
  grip: 0.9,
  encoders: { present: true, usedInCode: false, cpr: 350 },
};

export const G = 9.80665;

// Estimated spot diameter on the floor for a typical reflective IR sensor:
// a couple of mm at contact, widening roughly 1 mm per mm of height.
export function spotDiameter_mm(s: SensorArrayProfile): number {
  return s.spot_mm > 0 ? s.spot_mm : 2 + 1.0 * s.height_mm;
}

// Contrast falls as the sensor rises: 1.0 at the 5 mm reference height.
export function contrastFactor(height_mm: number): number {
  const h0 = 14; // height at which contrast has roughly halved
  const ref = 1 / (1 + (5 / h0) ** 2);
  return 1 / (1 + (height_mm / h0) ** 2) / ref;
}

// Yaw inertia estimate: a uniform plate of the footprint, about its centre, shifted to the axle.
export function yawInertia(p: RobotProfile): number {
  if (p.inertia_kgm2 > 0) return p.inertia_kgm2;
  const m = p.mass_g / 1000;
  const L = p.length_mm / 1000, W = p.width_mm / 1000;
  const centreFromAxle = (p.axleFromFront_mm - p.length_mm / 2) / 1000;
  return (m * (L * L + W * W)) / 12 + m * centreFromAxle * centreFromAxle;
}

// Straight-array sensor lateral positions in mm, index 0 = leftmost, positive = left of centre.
export function sensorLateral_mm(s: SensorArrayProfile): number[] {
  const n = s.channels;
  return Array.from({ length: n }, (_, i) => ((n - 1) / 2 - i) * s.spacing_mm);
}

export function sizeCheck(p: RobotProfile, maxL_mm: number, maxW_mm: number) {
  return { ok: p.length_mm <= maxL_mm && p.width_mm <= maxW_mm, maxL_mm, maxW_mm };
}
