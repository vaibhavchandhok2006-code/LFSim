// Builds magnetometer-maze.robot.json from the original sketch and its LFSim translation.
// Run: npx tsx examples/magnetometer-maze/make-robot.ts
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_PROFILE, profileProblems, type RobotProfile } from '../../src/sim/profile';
import type { Wiring } from '../../src/worker/protocol';
import { wiringExtrasProblems } from '../../src/brain/operator';

const dir = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(dir, 'line_follower_maze.ino'), 'utf8');
const translated = fs.readFileSync(path.join(dir, 'line_follower_maze.lfsim.js'), 'utf8');

// Chassis, wheels and motors from the RMI test rig; the rest follows the sketch's hardware list. Estimates are marked.
const profile: RobotProfile = {
  ...DEFAULT_PROFILE,
  name: 'Magnetometer maze bot (Uno + L298N + QMC5883L)',
  wheelbase_mm: 140, wheelDiameter_mm: 43, wheelWidth_mm: 13,
  length_mm: 165, width_mm: 165, axleFromFront_mm: 127, sensorOffset_mm: 117, casterOffset_mm: 70, comOffset_mm: 15,
  sensor: {
    channels: 5, spacing_mm: 18, height_mm: 8, spot_mm: 0,          // ESTIMATE: typical 5-channel digital IR module
    adcBits: 12, whiteRaw: 300, blackRaw: 2600, noise_pct: 1.5, mismatch_pct: 8, threshold: 1450, // comparator trip point (estimate)
  },
  motor: { ratedV: 6, noLoadRpm: 200, stallTorque_kgcm: 0.35, stallCurrent_A: 0.23, gearRatio: 150, mismatch_pct: 2, stictionFactor: 2.5 },
  driver: 'L298N',
  pwmFreq_Hz: 980, pwmBits: 8,                                       // Uno analogWrite on pins 5 and 6
  battery: { fullV: 8.4, nominalV: 7.4, capacity_mAh: 850, internalR_ohm: 0.15 },
  mass_g: 265,                                                        // ESTIMATE: rig 215 g + Uno and L298N
  inertia_kgm2: 0, grip: 0.8,
  encoders: { present: false, usedInCode: false, cpr: 1050 },
};

const wiring: Wiring = {
  board: 'avr',
  sensorPins: [14, 15, 16, 17, 11],                                   // A0, A1, A2, A3, 11 (left -> right)
  adcChannels: [],
  driver: { leftPwm: 5, leftIn1: 7, leftIn2: 8, rightPwm: 6, rightIn1: 9, rightIn2: 10, standby: null, leftInvert: false, rightInvert: false },
  encoders: null,
  buttons: [{ name: 'ZERO', pin: 2, activeLow: true }, { name: 'LEFT', pin: 3, activeLow: true }, { name: 'RIGHT', pin: 4, activeLow: true }],
  magnetometer: { chip: 'QMC5883L', yAxis: 'left' },
  operator: [
    { at_s: 0.5, action: 'press', button: 'ZERO', hold_s: 0.1 },      // start the 7 s compass calibration spin
    { at_s: 8.0, action: 'place-at-start' },                          // put it back on the start, facing the track
    { at_s: 8.5, action: 'press', button: 'RIGHT', hold_s: 0.1 },     // finish side (sample track: about 42° right)
    { at_s: 9.5, action: 'press', button: 'ZERO', hold_s: 0.1 },      // set heading 0 and go
  ],
};

const notes = [
  'Translated from line_follower_maze.ino (Arduino Uno, 5 digital IR sensors, L298N, QMC5883L).',
  'Simulated compass: QMC5883L at 0x0D on Wire, X arrow forward, Y arrow left, so heading grows on a right turn (HEADING_SIGN = 1). It gives the TRUE heading: no noise, no offsets, no motor interference. The 7 s calibration still runs and finds offsets near 0.',
  'Buttons ZERO=2, LEFT=3, RIGHT=4 read LOW while pressed. The operator script presses them: ZERO at 0.5 s (calibrate), robot put back on the start at 8 s, RIGHT at 8.5 s (finish side), ZERO at 9.5 s (go). Change RIGHT to LEFT for a track whose finish is to the left.',
  'Added "await arduinoYield()" inside busy-wait loops (button waits, turn, pivot, scan, junction roll) so the simulator can pause there; it adds no simulated time.',
  'F("...") strings became plain strings; Serial.print(float) prints 2 decimals as on Arduino; int16_t reads are sign-extended.',
  'Estimates: 5-sensor array spacing 18 mm, height 8 mm and trip point; mass 265 g; L298N model; AVR digitalRead about 4 µs. Chassis, wheels and motors are the RMI rig values (200 rpm N20, 150:1 estimate).',
  'Not modelled: AVR float maths time (atan2 is about 0.1-0.2 ms on a real Uno), LED 13 (no on-screen LED).',
].join('\n');

const problems = [...profileProblems(profile), ...wiringExtrasProblems(wiring)];
if (problems.length) throw new Error(problems.join('\n'));
const file = { ...profile, firmware: { source, sourceLang: 'Arduino C++ (Uno)', translated, notes, wiring } };
fs.writeFileSync(path.join(dir, 'magnetometer-maze.robot.json'), JSON.stringify(file, null, 2) + '\n');
console.log('wrote magnetometer-maze.robot.json');
