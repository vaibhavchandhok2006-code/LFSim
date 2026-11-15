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

// Allowed ranges for every profile number: [min, max, whole number?]. Imported robot files are untrusted and a zero or
// negative value (stall current 0, mass 0, PWM bits 0, 2.5 channels…) would break the physics with NaN.
export const PROFILE_RANGES: Record<string, [number, number, boolean?]> = {
  wheelbase_mm: [20, 500], wheelDiameter_mm: [5, 200], wheelWidth_mm: [1, 100], length_mm: [20, 1000], width_mm: [20, 1000],
  axleFromFront_mm: [0, 1000], sensorOffset_mm: [0, 500], casterOffset_mm: [-500, 500], comOffset_mm: [-300, 300],
  'sensor.channels': [2, 32, true], 'sensor.spacing_mm': [1, 50], 'sensor.height_mm': [0.5, 50], 'sensor.spot_mm': [0, 50],
  'sensor.adcBits': [6, 16, true], 'sensor.whiteRaw': [0, 65535], 'sensor.blackRaw': [0, 65535], 'sensor.noise_pct': [0, 50],
  'sensor.mismatch_pct': [0, 50], 'sensor.threshold': [0, 65535],
  'motor.ratedV': [1, 48], 'motor.noLoadRpm': [1, 100000], 'motor.stallTorque_kgcm': [0.001, 100], 'motor.stallCurrent_A': [0.01, 100],
  'motor.gearRatio': [1, 10000], 'motor.mismatch_pct': [0, 50], 'motor.stictionFactor': [1, 10],
  pwmFreq_Hz: [1, 200000], pwmBits: [1, 16, true],
  'battery.fullV': [1, 60], 'battery.nominalV': [1, 60], 'battery.capacity_mAh': [1, 100000], 'battery.internalR_ohm': [0, 10],
  mass_g: [10, 20000], inertia_kgm2: [0, 10], grip: [0.05, 3], 'encoders.cpr': [1, 100000, true],
};

// Every problem with a profile, in plain words (empty = fine).
export function profileProblems(p: RobotProfile): string[] {
  const out: string[] = [];
  const get = (path: string) => path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], p);
  for (const [path, [lo, hi, whole]] of Object.entries(PROFILE_RANGES)) {
    const v = get(path);
    if (v === undefined && path === 'motor.stictionFactor') continue; // optional
    if (typeof v !== 'number' || !Number.isFinite(v)) { out.push(`${path} must be a number.`); continue; }
    if (v < lo || v > hi) out.push(`${path} is ${v}; it must be between ${lo} and ${hi}.`);
    else if (whole && !Number.isInteger(v)) out.push(`${path} is ${v}; it must be a whole number.`);
  }
  const adcMax = 2 ** p.sensor.adcBits - 1;
  for (const k of ['whiteRaw', 'blackRaw', 'threshold'] as const) if (p.sensor[k] > adcMax) out.push(`sensor.${k} is ${p.sensor[k]}, more than a ${p.sensor.adcBits}-bit ADC can read (${adcMax}).`);
  if (p.battery.nominalV > p.battery.fullV) out.push('battery.nominalV must not be above battery.fullV.');
  if (p.driver !== 'TB6612FNG' && p.driver !== 'L298N') out.push(`driver must be TB6612FNG or L298N (got ${String(p.driver)}).`);
  return out;
}
