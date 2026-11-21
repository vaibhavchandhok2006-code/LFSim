// Messages between the UI and the simulation worker.

import { DecisionEvent, SimEvent, SimFlags } from '../sim/simulation';
import { RobotProfile } from '../sim/profile';
import { SettingsParams } from '../brain/settings';
import { Track } from '../track/track';

export type BrainSpec =
  | { mode: 'settings'; settings: SettingsParams }
  | { mode: 'code'; code: string; wiring: Wiring };

// How the robot's pins are connected (Code mode). Pins are GPIO numbers as used in the firmware.
export interface Wiring {
  sensorPins: number[];            // leftmost sensor first
  adcChannels: { unit: 1 | 2; channel: number; gpio: number }[]; // for adc1_get_raw / adc2_get_raw
  driver: {
    leftPwm: number; leftIn1: number; leftIn2: number;
    rightPwm: number; rightIn1: number; rightIn2: number;
    standby: number | null;        // TB6612FNG STBY pin (null = tied high)
    leftInvert: boolean; rightInvert: boolean;
  };
  encoders: { leftA: number; leftB: number; rightA: number; rightB: number } | null;
  // Board: sets analogRead timing and resolution. ESP32: ~10 µs, 12-bit (analogReadResolution can change it).
  // AVR (Arduino Uno/Nano): ~112 µs per analogRead, always 10-bit. Optional for older files (default ESP32).
  board?: 'esp32' | 'avr';
  // Push buttons the firmware reads with digitalRead. activeLow: the pin reads LOW while pressed (button to GND with
  // INPUT_PULLUP), otherwise HIGH while pressed. Optional for older files (no buttons).
  buttons?: ButtonPin[];
  // I²C compass. QMC5883L at address 0x0D, X axis pointing forward; yAxis says where its Y arrow points.
  // It reports the robot's true heading (no noise, no motor interference). Optional for older files (none).
  magnetometer?: { chip: 'QMC5883L'; yAxis: 'left' | 'right' } | null;
  // Operator script: what the person at the track does, at simulated times from power-on (button presses, putting
  // the robot back at the start). Optional for older files (nothing).
  operator?: OperatorStep[];
}

export interface ButtonPin { name: string; pin: number; activeLow: boolean }
export type OperatorStep =
  | { at_s: number; action: 'press'; button: string; hold_s: number }
  | { at_s: number; action: 'place-at-start' };

export interface StartMsg {
  type: 'start';
  runId: number;
  track: Track;
  profile: RobotProfile;
  brain: BrainSpec;
  flags: SimFlags;
  disturbances: Disturbances;
  offLine_cm: number;
  memory: Record<string, unknown>;
}
export interface AdvanceMsg { type: 'advance'; runId: number; until: number }
export interface StopMsg { type: 'stop'; runId: number; at: number }
export interface CsvMsg { type: 'csv'; runId: number; until: number }
export type ToWorker = StartMsg | AdvanceMsg | StopMsg | CsvMsg;

export interface Disturbances {
  lighting: { on: boolean; strength: number }; // 0..1: how much ambient light varies across the mat
  bumps: { on: boolean; strength: number };    // 0..1: how high mat folds lift the sensors (up to 6 mm)
  seed: number;
}

// Frame layout (Float32): see FRAME_FIELDS; sensor raw values follow.
export const FRAME_FIELDS = ['t', 'x', 'y', 'theta', 'angL', 'angR', 'v', 'vL', 'vR', 'dutyL', 'dutyR', 'vBatt', 'iL', 'iR', 'slip', 'off', 'err', 'pid', 'state', 'extraH'] as const;
export const F = Object.fromEntries(FRAME_FIELDS.map((k, i) => [k, i])) as Record<(typeof FRAME_FIELDS)[number], number>;

export interface FramesMsg {
  type: 'frames';
  runId: number;
  stride: number;
  frames: Float32Array;            // n × stride
  states: string[];                // full state-name table (index = state field)
  events: SimEvent[];              // new events since the last message
  decisions: DecisionEvent[];      // new decisions
  console: { t: number; text: string }[]; // serial output (Code mode)
  time: number;                    // simulated time computed so far
  status: 'running' | 'finished' | 'stopped' | 'error';
  error?: string;
  memory?: Record<string, unknown>; // sent when the run ends
  idealHz: number;                 // frame rate of the recording
}
export interface CsvResultMsg { type: 'csv'; runId: number; csv: string }
export type FromWorker = FramesMsg | CsvResultMsg;
