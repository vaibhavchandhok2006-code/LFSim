/*
  MAGNETOMETER-GUIDED LINE FOLLOWER  (no hard-coded path)
  --------------------------------------------------------
  Hardware assumed (change the pins below if yours differ):
    - Arduino Uno / Nano
    - 5-channel digital IR line sensor array (left -> right)
    - L298N (or similar) dual motor driver, 2 DC gear motors
    - QMC5883L magnetometer (GY-271 board) on I2C (A4 = SDA, A5 = SCL)
        (If your board is HMC5883L, only qmcInit()/readMag() need changing.)
    - 3 push buttons to GND (INPUT_PULLUP): ZERO, LEFT, RIGHT

  IDEA
    1. Heading is measured by the magnetometer, relative to the direction
       the bot faced at START (set to 0 deg by the ZERO button).
       Right turn = positive angle, left turn = negative angle.
    2. The finish is in a known direction: +45 deg (RIGHT button) or
       -45 deg (LEFT button) from the start heading.  This is the
       "targetBearing".
    3. Normal driving = PID on the IR array.
    4. Scanning is CONDITIONAL, so the bot stays fast:
         - corner (line bends to ONE side, nothing ahead): quick pivot, no scan
         - lost line: quick pivot search; if nothing found = dead end, 180 deg U-turn, no scan
         - real junction (bar on BOTH sides = T / cross, a fork with 2 separate
           lines, or a side branch with the line also continuing straight):
           stop, spin 360 deg and record the heading of every line crossed
           (the magnetometer gives the angle of each branch).
       It removes the branch it came from, then picks the branch whose
       heading is closest to targetBearing.
    5. Every real decision (2+ exits) is stored.  If the stored sequence
       repeats (period 1..MAX_PERIOD, REPEATS times) the bot is in a loop,
       so at the NEXT junction it inverts its decision (takes the
       second-best branch) and the history is cleared.
    6. Finish = a big black patch (4-5 sensors on) that lasts FINISH_MS.
*/

#include <Wire.h>

// ===================== PINS =====================
const uint8_t SENS[5] = {A0, A1, A2, A3, 11};   // left ... right
const uint8_t ENA = 5, IN1 = 7, IN2 = 8;        // left motor
const uint8_t ENB = 6, IN3 = 9, IN4 = 10;       // right motor
const uint8_t BTN_ZERO = 2, BTN_LEFT = 3, BTN_RIGHT = 4;
const uint8_t LED = 13;

// ===================== TUNABLES =====================
const uint8_t LINE_LEVEL = HIGH;   // sensor output when it sees the black line
const float   HEADING_SIGN = 1.0;  // set to -1.0 if heading DEcreases when you turn the bot clockwise

// PID (line following)
const int   BASE_PWM = 130;
float KP = 0.05, KI = 0.0, KD = 0.6;

// turning / scanning
const int   SCAN_PWM      = 110;
const int   TURN_MIN_PWM  = 70;
const int   TURN_MAX_PWM  = 130;
const float TURN_KP       = 2.0;
const float TURN_TOL      = 4.0;     // deg

// timing (ms)
const unsigned long ADVANCE_MS      = 90;    // keep rolling this long to classify (corner vs junction) and centre the axle
const unsigned long START_IGNORE_MS = 1500;  // ignore junction/finish logic while leaving start box
const unsigned long FINISH_MS       = 200;   // black patch must last this long (at BASE_PWM)
const unsigned long LOCKOUT_MS      = 250;   // after a turn, don't re-detect the same junction
const unsigned long LOST_MS         = 100;   // line missing this long = lost
const int   PIVOT_PWM = 110;                  // quick corner / recovery pivot
const unsigned long CORNER_LOCKOUT_MS = 100; // after a corner, don't re-trigger

// decision logic
const float ARRIVAL_TOL = 40.0;  // deg: branch within this of "back where I came from" is ignored
const float MIN_ARC     = 6.0;   // deg: narrower line crossings are noise
const float LOOP_TOL    = 25.0;  // deg: two decisions this close are "the same"
const int   LOG_N       = 24;    // junction history size
const int   REPEATS     = 3;     // pattern must appear this many times
const int   MAX_PERIOD  = 6;     // longest loop (in junctions) we look for

// ===================== GLOBALS =====================
// magnetometer
float offX = 0, offY = 0, scaleX = 1, scaleY = 1;
float fx = 0, fy = 0; bool fInit = false;
float heading0 = 0;

// sensors
bool  s[5]; int cnt = 0, blobs = 0; float pos = 0;

// PID state
float lastErr = 0, integ = 0;

// navigation state
float targetBearing = 45.0;
float jLog[LOG_N]; int jCount = 0;
bool  invertNext = false;
unsigned long runStart = 0, lockoutUntil = 0, lostSince = 0;

// ===================== SMALL HELPERS =====================
float wrap180(float a) {
  while (a > 180.0)   a -= 360.0;
  while (a <= -180.0) a += 360.0;
  return a;
}

bool pressed(uint8_t pin) {
  if (digitalRead(pin) == LOW) {
    delay(30);
    if (digitalRead(pin) == LOW) { while (digitalRead(pin) == LOW) {} return true; }
  }
  return false;
}

void blinkN(int n) {
  for (int i = 0; i < n; i++) { digitalWrite(LED, HIGH); delay(150); digitalWrite(LED, LOW); delay(150); }
}

// ===================== MOTORS =====================
void drive(int l, int r) {
  l = constrain(l, -255, 255); r = constrain(r, -255, 255);
  digitalWrite(IN1, l > 0); digitalWrite(IN2, l < 0); analogWrite(ENA, abs(l));
  digitalWrite(IN3, r > 0); digitalWrite(IN4, r < 0); analogWrite(ENB, abs(r));
}

// ===================== MAGNETOMETER (QMC5883L, no library) =====================
void qmcWrite(uint8_t reg, uint8_t val) {
  Wire.beginTransmission(0x0D); Wire.write(reg); Wire.write(val); Wire.endTransmission();
}

void qmcInit() {
  qmcWrite(0x0B, 0x01);   // set/reset period
  qmcWrite(0x09, 0x1D);   // continuous, 200 Hz, 8 G range, OSR 512
}

bool readRaw(int16_t &x, int16_t &y) {
  Wire.beginTransmission(0x0D); Wire.write(0x00);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom((uint8_t)0x0D, (uint8_t)6) < 6) return false;
  x = Wire.read(); x |= (int16_t)Wire.read() << 8;
  y = Wire.read(); y |= (int16_t)Wire.read() << 8;
  Wire.read(); Wire.read();            // z ignored (bot is flat)
  return true;
}

// one filtered, calibrated update of the heading vector
void updateHeading() {
  int16_t x, y;
  if (!readRaw(x, y)) return;
  float mx = (x - offX) * scaleX;
  float my = (y - offY) * scaleY;
  if (!fInit) { fx = mx; fy = my; fInit = true; }
  else { fx += 0.5 * (mx - fx); fy += 0.5 * (my - fy); }
}

float rawHeading() {            // degrees, arbitrary zero
  updateHeading();
  return HEADING_SIGN * atan2(fy, fx) * RAD_TO_DEG;
}

float relHeading() {            // degrees relative to the START direction, -180..180
  return wrap180(rawHeading() - heading0);
}

// spin in place ~7 s, record min/max -> hard-iron offset + soft-iron scale
void calibrateMag() {
  int16_t x, y; int16_t xmin = 32767, xmax = -32768, ymin = 32767, ymax = -32768;
  unsigned long t0 = millis();
  drive(90, -90);
  while (millis() - t0 < 7000) {
    if (readRaw(x, y)) {
      if (x < xmin) xmin = x; if (x > xmax) xmax = x;
      if (y < ymin) ymin = y; if (y > ymax) ymax = y;
    }
    delay(5);
  }
  drive(0, 0);
  offX = (xmax + xmin) / 2.0; offY = (ymax + ymin) / 2.0;
  float dx = (xmax - xmin) / 2.0, dy = (ymax - ymin) / 2.0;
  float avg = (dx + dy) / 2.0;
  scaleX = (dx > 1) ? avg / dx : 1; scaleY = (dy > 1) ? avg / dy : 1;
  fInit = false;
  Serial.print(F("Cal offsets ")); Serial.print(offX); Serial.print(' '); Serial.println(offY);
}

// ===================== LINE SENSORS =====================
void readSensors() {
  cnt = 0; blobs = 0; long wsum = 0; bool prev = false;
  for (int i = 0; i < 5; i++) {
    s[i] = (digitalRead(SENS[i]) == LINE_LEVEL);
    if (s[i]) { cnt++; wsum += (long)(i - 2) * 1000L; if (!prev) blobs++; }
    prev = s[i];
  }
  if (cnt) pos = wsum / (float)cnt;      // -2000 (far left) ... +2000 (far right)
}

// wide line on one side, or two separate lines  => something to decide about
bool junctionSeen() {
  if (cnt >= 4) return true;
  if (blobs >= 2) return true;
  if (cnt == 3 && (s[0] || s[4])) return true;
  return false;
}

// ===================== TURNING =====================
void turnToHeading(float target) {
  unsigned long t0 = millis(); int ok = 0;
  while (millis() - t0 < 5000) {
    float err = wrap180(target - relHeading());
    if (fabsf(err) < TURN_TOL) {
      drive(0, 0);
      if (++ok >= 5) break;
      delay(3); continue;
    }
    ok = 0;
    int sp = constrain((int)(fabsf(err) * TURN_KP), TURN_MIN_PWM, TURN_MAX_PWM);
    if (err > 0) drive(sp, -sp); else drive(-sp, sp);   // err>0 -> target is to the right
  }
  drive(0, 0);
}

// quick pivot toward one side until the centre sensor finds the line (no scan, no compass)
bool pivotToLine(int dir, unsigned long ms) {     // dir: +1 = right, -1 = left
  unsigned long t0 = millis();
  drive(dir * PIVOT_PWM, -dir * PIVOT_PWM);
  while (millis() - t0 < ms) {
    readSensors();
    if (s[2]) return true;           // keep moving; PID takes over immediately
  }
  drive(0, 0);
  return false;
}

// ===================== 360 deg SCAN =====================
// Spins right once; every arc where the centre sensor sees the line is a branch.
// Returns the number of branches, headings (relative, -180..180) in out[].
int scanBranches(float out[], int maxN) {
  const int MAXSEG = 8;
  float segA[MAXSEG], segB[MAXSEG]; int nSeg = 0;

  readSensors();
  float h0 = relHeading(), prev = h0, swept = 0, segStart = 0;
  bool startActive = s[2], active = startActive;
  unsigned long t0 = millis();

  drive(SCAN_PWM, -SCAN_PWM);
  while (swept < 360.0 && millis() - t0 < 9000) {
    float h = relHeading();
    float d = wrap180(h - prev); prev = h;
    if (d > -5) swept += d;                    // ignore tiny backward noise
    readSensors();
    bool on = s[2];
    if (on && !active) { segStart = swept; active = true; }
    else if (!on && active) {
      active = false;
      if (swept - segStart >= MIN_ARC && nSeg < MAXSEG) { segA[nSeg] = segStart; segB[nSeg] = swept; nSeg++; }
    }
  }
  drive(0, 0);

  if (active && nSeg < MAXSEG) { segA[nSeg] = segStart; segB[nSeg] = 360.0; nSeg++; }
  // the arrival line was active at both start and end of the sweep -> one branch, merge
  if (startActive && active && nSeg >= 2) { segA[0] = segA[nSeg - 1] - 360.0; nSeg--; }

  int n = 0;
  for (int i = 0; i < nSeg && n < maxN; i++) {
    float mid = (segA[i] + segB[i]) / 2.0;
    out[n++] = wrap180(h0 + mid);
  }
  return n;
}

// ===================== DECISION MEMORY / LOOP DETECTION =====================
void logChoice(float h) {
  if (jCount < LOG_N) jLog[jCount++] = h;
  else { for (int i = 1; i < LOG_N; i++) jLog[i - 1] = jLog[i]; jLog[LOG_N - 1] = h; }
}

// true if the last decisions are a pattern of period p repeated REPEATS times
bool loopDetected() {
  for (int p = 1; p <= MAX_PERIOD; p++) {
    int need = max(REPEATS * p, 4);
    if (jCount < need) continue;
    bool match = true;
    for (int k = 0; k < need - p; k++) {
      float a = jLog[jCount - 1 - k], b = jLog[jCount - 1 - k - p];
      if (fabsf(wrap180(a - b)) > LOOP_TOL) { match = false; break; }
    }
    if (match) return true;
  }
  return false;
}

// best = branch closest to the destination bearing; invert -> second best
int pickBranch(float c[], int n, bool invert) {
  int best = 0, second = -1;
  float eBest = fabsf(wrap180(c[0] - targetBearing)), eSecond = 1e9;
  for (int i = 1; i < n; i++) {
    float e = fabsf(wrap180(c[i] - targetBearing));
    if (e < eBest) { second = best; eSecond = eBest; best = i; eBest = e; }
    else if (e < eSecond) { second = i; eSecond = e; }
  }
  return (invert && second >= 0) ? second : best;
}

// ===================== JUNCTION HANDLER =====================
void handleJunction(float arrivalH) {      // only called for REAL junctions
  drive(0, 0); delay(60);

  float found[8]; int nF = scanBranches(found, 8);

  // drop the branch we arrived from
  float back = wrap180(arrivalH + 180.0);
  float cand[8]; int nC = 0;
  for (int i = 0; i < nF; i++)
    if (fabsf(wrap180(found[i] - back)) > ARRIVAL_TOL) cand[nC++] = found[i];

  Serial.print(F("JUNCTION branches=")); Serial.print(nC);

  if (nC == 0) {                                  // dead end -> go back
    Serial.println(F(" DEAD END, u-turn"));
    turnToHeading(back);
  } else {
    float choice;
    if (nC == 1) {                                // corner / forced move, not a decision
      choice = cand[0];
    } else {
      bool inv = invertNext;
      int b = pickBranch(cand, nC, inv);
      if (inv) { invertNext = false; jCount = 0; Serial.print(F(" [INVERTED]")); }
      choice = cand[b];
      logChoice(choice);
      if (loopDetected()) { invertNext = true; Serial.print(F(" [LOOP -> invert next]")); }
    }
    Serial.print(F(" go ")); Serial.println(choice);
    turnToHeading(choice);
  }
  lastErr = 0; integ = 0;
  lockoutUntil = millis() + LOCKOUT_MS;
}

// ===================== FINISH =====================
void finished() {
  drive(0, 0);
  Serial.print(F("FINISH reached. heading=")); Serial.print(relHeading());
  Serial.print(F("  target bearing=")); Serial.println(targetBearing);
  while (true) { digitalWrite(LED, HIGH); delay(200); digitalWrite(LED, LOW); delay(200); }
}

// ===================== SETUP =====================
void setup() {
  Serial.begin(115200);
  for (int i = 0; i < 5; i++) pinMode(SENS[i], INPUT);
  pinMode(ENA, OUTPUT); pinMode(IN1, OUTPUT); pinMode(IN2, OUTPUT);
  pinMode(ENB, OUTPUT); pinMode(IN3, OUTPUT); pinMode(IN4, OUTPUT);
  pinMode(BTN_ZERO, INPUT_PULLUP); pinMode(BTN_LEFT, INPUT_PULLUP); pinMode(BTN_RIGHT, INPUT_PULLUP);
  pinMode(LED, OUTPUT);
  drive(0, 0);

  Wire.begin(); Wire.setClock(400000);
  qmcInit();

  // 1) calibration (bot spins on the spot for ~7 s)
  Serial.println(F("Put bot on flat ground, press ZERO to calibrate compass"));
  while (!pressed(BTN_ZERO)) { }
  calibrateMag();

  // 2) place at START, choose finish side, press ZERO to set angle = 0 and go
  Serial.println(F("Place bot at START. LEFT/RIGHT = finish side (default RIGHT). ZERO = go"));
  int side = +1;
  while (true) {
    updateHeading();
    if (pressed(BTN_LEFT))       { side = -1; blinkN(1); }
    else if (pressed(BTN_RIGHT)) { side = +1; blinkN(2); }
    else if (pressed(BTN_ZERO))  { break; }
    delay(5);
  }
  delay(300);
  for (int i = 0; i < 30; i++) { updateHeading(); delay(5); }
  heading0 = rawHeading();                 // <- angle = 0 here
  targetBearing = side * 45.0;             // finish is 45 deg left (-) or right (+)
  Serial.print(F("Target bearing = ")); Serial.println(targetBearing);

  jCount = 0; invertNext = false;
  runStart = millis();
}

// ===================== MAIN LOOP =====================
void loop() {
  updateHeading();
  readSensors();
  unsigned long now = millis();
  bool armed = (now - runStart > START_IGNORE_MS) && (now > lockoutUntil);

  // ---- something wide under the array: finish, corner or junction? ----
  if (armed && junctionSeen()) {
    float arrivalH = relHeading();
    bool sawL = s[0], sawR = s[4], sawBar = (cnt >= 4) || (blobs >= 2);
    bool blackRun = (cnt >= 4);
    unsigned long t0 = millis(), tEnd = t0 + ADVANCE_MS;

    drive(BASE_PWM, BASE_PWM);                 // keep rolling, do NOT stop
    while (true) {
      readSensors();
      unsigned long n = millis();
      if (s[0]) sawL = true;
      if (s[4]) sawR = true;
      if (cnt >= 4 || blobs >= 2) sawBar = true;
      if (blackRun) {
        if (cnt < 4) blackRun = false;         // black patch ended -> not the finish
        else if (n - t0 >= FINISH_MS) finished();
      }
      if (!blackRun && n >= tEnd) break;
    }

    bool straightAhead = s[1] || s[2] || s[3]; // line continues past the junction?
    bool twoSided = (sawL && sawR) || sawBar;  // T / cross / fork

    if (twoSided || straightAhead) {
      handleJunction(arrivalH);                // real junction -> 360 scan
    } else {
      int dir = sawR ? +1 : -1;                // corner: line went to the side we saw it
      pivotToLine(dir, 700);
      lastErr = 0; integ = 0;
      lockoutUntil = millis() + CORNER_LOCKOUT_MS;
    }
    return;
  }

  // ---- lost line: overshot a corner, or dead end ----
  if (cnt == 0) {
    if (lostSince == 0) lostSince = now;
    if (armed && now - lostSince > LOST_MS) {
      float arrivalH = relHeading();
      int dir = (lastErr >= 0) ? +1 : -1;
      if (!pivotToLine(dir, 350) && !pivotToLine(-dir, 700)) {
        turnToHeading(wrap180(arrivalH + 180.0));   // true dead end: U-turn
      }
      lastErr = 0; integ = 0; lostSince = 0;
      lockoutUntil = millis() + CORNER_LOCKOUT_MS;
      return;
    }
  } else {
    lostSince = 0;
  }

  // ---- PID line following ----
  float err;
  if (cnt > 0) err = pos;
  else err = (lastErr >= 0) ? 2500.0 : -2500.0;     // keep turning toward where the line was
  integ = constrain(integ + err, -5000, 5000);
  float corr = KP * err + KI * integ + KD * (err - lastErr);
  lastErr = err;
  drive(BASE_PWM + (int)corr, BASE_PWM - (int)corr);   // err>0: line on right -> turn right
  delay(2);
}
