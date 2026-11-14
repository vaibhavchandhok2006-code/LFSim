// The robot-brain interface. Settings mode and Code mode both implement Brain,
// and both talk to the robot only through BrainIO: the same things real firmware can see and do.

export interface BrainIO {
  readonly channels: number;
  readonly lateral_mm: number[];   // sensor positions across the array, + = left
  readonly adcMax: number;
  readonly whiteRaw: number;       // calibration values the firmware would have measured
  readonly blackRaw: number;
  readonly threshold: number;
  readSensors(): number[];         // raw ADC values, index 0 = leftmost
  nowMs(): number;                 // time since power-on, ms (like millis())
  setMotors(left: number, right: number): void; // PWM duty -1..1 (negative = reverse)
  encoders(): { left: number; right: number; cpr: number } | null; // null if the robot has no encoders
  odometry_m(): number;            // distance travelled estimate (encoders, or known speed when none)
  log(msg: string): void;          // like Serial.print
}

export interface Brain {
  readonly name: string;
  readonly loopHz: number;
  reset(io: BrainIO): void;
  tick(io: BrainIO): void;
  state(): string;                 // short human-readable state for the UI
  finished(): boolean;             // true once the brain believes it reached the finish and stopped
  telemetry(): Record<string, number>; // values to graph: error, pid output, etc.
}
