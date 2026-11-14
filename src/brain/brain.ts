// The robot-brain interface. Settings mode and Code mode both implement Brain,
// and both talk to the robot only through BrainIO: the same things real firmware can see and do.
// Brains never receive the track, its junction graph or the finish location.

export interface DecisionRecord {
  kind: 'L' | 'S' | 'R' | 'B' | 'finish';
  branches_deg: number[];     // branch angles found, + = left of the arrival heading
  chosen_deg: number | null;
  rank: number | null;        // branch number counted from the left (0 = leftmost)
  pattern: string;            // sensor on/off pattern when the junction was detected, e.g. "11110000"
  note: string;               // algorithm-specific detail
}

export interface BrainIO {
  readonly channels: number;
  readonly lateral_mm: number[];   // sensor positions across the array, + = left
  readonly adcMax: number;
  readonly whiteRaw: number;       // calibration values the firmware would have measured
  readonly blackRaw: number;
  readonly threshold: number;
  readonly geometry: { wheelbase_mm: number; wheelDiameter_mm: number; sensorOffset_mm: number };
  readSensors(): number[];         // raw ADC values, index 0 = leftmost
  nowMs(): number;                 // time since power-on, ms (like millis())
  setMotors(left: number, right: number): void; // PWM duty -1..1 (negative = reverse)
  encoders(): { left: number; right: number; cpr: number } | null; // null if the robot has no encoders
  // Distance each wheel has rolled, m: from encoder ticks if fitted, otherwise the known wheel speed (spec).
  wheelOdometry(): { left_m: number; right_m: number };
  odometry_m(): number;            // distance travelled estimate (mean of the wheels)
  memory: Record<string, unknown>; // EEPROM/NVS: kept between a run and its memory run
  decision(rec: DecisionRecord): void; // report a junction decision for the log (position added by the simulator)
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
