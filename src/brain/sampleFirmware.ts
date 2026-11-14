// Sample firmware shipped with LFSim: a plain PID line follower (no junction logic) for an ESP32,
// an 8-channel analog array and a TB6612FNG, with its LFSim translation. Lines end with //@Ln tags that link
// each translated line to the original source line(s), as the Claude skill produces them.

import type { Wiring } from '../worker/protocol';

export const SAMPLE_WIRING: Wiring = {
  sensorPins: [36, 39, 32, 33, 34, 35, 25, 26],
  adcChannels: [
    { unit: 1, channel: 0, gpio: 36 }, { unit: 1, channel: 3, gpio: 39 }, { unit: 1, channel: 4, gpio: 32 }, { unit: 1, channel: 5, gpio: 33 },
    { unit: 1, channel: 6, gpio: 34 }, { unit: 1, channel: 7, gpio: 35 }, { unit: 2, channel: 8, gpio: 25 }, { unit: 2, channel: 9, gpio: 26 },
  ],
  driver: { leftPwm: 16, leftIn1: 17, leftIn2: 18, rightPwm: 19, rightIn1: 21, rightIn2: 22, standby: 23, leftInvert: false, rightInvert: false },
  encoders: null,
};

export const SAMPLE_SOURCE = `// Sample: PID line follower, ESP32 + 8-sensor analog array + TB6612FNG
const int S[8] = {36, 39, 32, 33, 34, 35, 25, 26};
const int PWMA = 16, AIN1 = 17, AIN2 = 18, PWMB = 19, BIN1 = 21, BIN2 = 22, STBY = 23;
const int WHITE = 250, BLACK = 3600, THRESH = 1900;
float Kp = 0.012, Kd = 0.0012;
float base = 0.35;
float lastErr = 0;
unsigned long lastT = 0;
int blackCount = 0;
bool done = false;

void drive(float l, float r) {
  l = constrain(l, -1, 1); r = constrain(r, -1, 1);
  digitalWrite(AIN1, l >= 0); digitalWrite(AIN2, l < 0);
  digitalWrite(BIN1, r >= 0); digitalWrite(BIN2, r < 0);
  ledcWrite(PWMA, (int)(fabs(l) * 1023));
  ledcWrite(PWMB, (int)(fabs(r) * 1023));
}

void setup() {
  Serial.begin(115200);
  int outs[] = {AIN1, AIN2, BIN1, BIN2, STBY};
  for (int p : outs) pinMode(p, OUTPUT);
  digitalWrite(STBY, HIGH);
  ledcAttach(PWMA, 20000, 10);
  ledcAttach(PWMB, 20000, 10);
  Serial.println("Ready");
  lastT = millis();
}

void loop() {
  if (done) { drive(0, 0); delay(10); return; }
  float sum = 0, pos = 0; int on = 0;
  for (int i = 0; i < 8; i++) {
    int raw = analogRead(S[i]);
    float n = constrain((raw - WHITE) / float(BLACK - WHITE), 0, 1);
    sum += n; pos += n * (3.5 - i) * 12.0;   // mm, + = left
    if (raw > THRESH) on++;
  }
  if (on == 8 && millis() > 1500) { if (++blackCount > 40) { done = true; Serial.println("Finish!"); } } else blackCount = 0;
  float err = sum > 0.3 ? pos / sum : (lastErr > 0 ? 40 : -40);
  unsigned long now = millis();
  float dt = max(1UL, now - lastT) / 1000.0;
  float u = Kp * err + Kd * (err - lastErr) / dt;
  lastErr = err; lastT = now;
  drive(base - u, base + u);
  delay(2);
}
`;

export const SAMPLE_TRANSLATED = `// LFSim firmware v1 — translated from Arduino C++ (ESP32)
const S = [36, 39, 32, 33, 34, 35, 25, 26]; //@L2
const PWMA = 16, AIN1 = 17, AIN2 = 18, PWMB = 19, BIN1 = 21, BIN2 = 22, STBY = 23; //@L3
const WHITE = 250, BLACK = 3600, THRESH = 1900; //@L4
let Kp = 0.012, Kd = 0.0012; //@L5
let base = 0.35; //@L6
let lastErr = 0; //@L7
let lastT = 0; //@L8
let blackCount = 0; //@L9
let done = false; //@L10

function drive(l, r) { //@L12
  l = constrain(l, -1, 1); r = constrain(r, -1, 1); //@L13
  digitalWrite(AIN1, l >= 0 ? HIGH : LOW); digitalWrite(AIN2, l < 0 ? HIGH : LOW); //@L14
  digitalWrite(BIN1, r >= 0 ? HIGH : LOW); digitalWrite(BIN2, r < 0 ? HIGH : LOW); //@L15
  ledcWrite(PWMA, Math.trunc(Math.abs(l) * 1023)); //@L16
  ledcWrite(PWMB, Math.trunc(Math.abs(r) * 1023)); //@L17
} //@L18

async function setup() { //@L20
  Serial.begin(115200); //@L21
  const outs = [AIN1, AIN2, BIN1, BIN2, STBY]; //@L22
  for (const p of outs) pinMode(p, OUTPUT); //@L23
  digitalWrite(STBY, HIGH); //@L24
  ledcAttach(PWMA, 20000, 10); //@L25
  ledcAttach(PWMB, 20000, 10); //@L26
  Serial.println("Ready"); //@L27
  lastT = millis(); //@L28
} //@L29

async function loop() { //@L31
  if (done) { drive(0, 0); await delay(10); return; } //@L32
  let sum = 0, pos = 0, on = 0; //@L33
  for (let i = 0; i < 8; i++) { //@L34
    const raw = analogRead(S[i]); //@L35
    const n = constrain((raw - WHITE) / (BLACK - WHITE), 0, 1); //@L36
    sum += n; pos += n * (3.5 - i) * 12.0; //@L37
    if (raw > THRESH) on++; //@L38
  } //@L39
  if (on === 8 && millis() > 1500) { if (++blackCount > 40) { done = true; Serial.println("Finish!"); } } else blackCount = 0; //@L40
  const err = sum > 0.3 ? pos / sum : (lastErr > 0 ? 40 : -40); //@L41
  const now = millis(); //@L42
  const dt = Math.max(1, now - lastT) / 1000.0; //@L43
  const u = Kp * err + Kd * (err - lastErr) / dt; //@L44
  lastErr = err; lastT = now; //@L45
  drive(base - u, base + u); //@L46
  await delay(2); //@L47
} //@L48
`;

export const SAMPLE_NOTES = 'Sample firmware: a plain PID line follower with finish detection and no junction logic. All 9 hardware calls were mapped; nothing was left unmapped.';
