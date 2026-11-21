// MAGNETOMETER-GUIDED LINE FOLLOWER (no hard-coded path), translated for LFSim Code mode. //@L1-34
// See docs/FIRMWARE_API.md. Busy-wait loops get `await arduinoYield()` so the simulator can pause there (no time cost). //@L1

// ===================== PINS ===================== //@L38
const SENS = [A0, A1, A2, A3, 11];   // left ... right //@L39
const ENA = 5, IN1 = 7, IN2 = 8;        // left motor //@L40
const ENB = 6, IN3 = 9, IN4 = 10;       // right motor //@L41
const BTN_ZERO = 2, BTN_LEFT = 3, BTN_RIGHT = 4; //@L42
const LED = 13; //@L43

// ===================== TUNABLES ===================== //@L45
const LINE_LEVEL = HIGH;   // sensor output when it sees the black line //@L46
const HEADING_SIGN = 1.0;  // set to -1.0 if heading DEcreases when you turn the bot clockwise //@L47

// PID (line following) //@L49
const BASE_PWM = 130; //@L50
let KP = 0.05, KI = 0.0, KD = 0.6; //@L51

// turning / scanning //@L53
const SCAN_PWM      = 110; //@L54
const TURN_MIN_PWM  = 70; //@L55
const TURN_MAX_PWM  = 130; //@L56
const TURN_KP       = 2.0; //@L57
const TURN_TOL      = 4.0;     // deg //@L58

// timing (ms) //@L60
const ADVANCE_MS      = 90;    // keep rolling this long to classify (corner vs junction) and centre the axle //@L61
const START_IGNORE_MS = 1500;  // ignore junction/finish logic while leaving start box //@L62
const FINISH_MS       = 200;   // black patch must last this long (at BASE_PWM) //@L63
const LOCKOUT_MS      = 250;   // after a turn, don't re-detect the same junction //@L64
const LOST_MS         = 100;   // line missing this long = lost //@L65
const PIVOT_PWM = 110;                  // quick corner / recovery pivot //@L66
const CORNER_LOCKOUT_MS = 100; // after a corner, don't re-trigger //@L67

// decision logic //@L69
const ARRIVAL_TOL = 40.0;  // deg: branch within this of "back where I came from" is ignored //@L70
const MIN_ARC     = 6.0;   // deg: narrower line crossings are noise //@L71
const LOOP_TOL    = 25.0;  // deg: two decisions this close are "the same" //@L72
const LOG_N       = 24;    // junction history size //@L73
const REPEATS     = 3;     // pattern must appear this many times //@L74
const MAX_PERIOD  = 6;     // longest loop (in junctions) we look for //@L75

// ===================== GLOBALS ===================== //@L77
// magnetometer //@L78
let offX = 0, offY = 0, scaleX = 1, scaleY = 1; //@L79
let fx = 0, fy = 0; let fInit = false; //@L80
let heading0 = 0; //@L81

// sensors //@L83
const s = [false, false, false, false, false]; let cnt = 0, blobs = 0; let pos = 0; //@L84

// PID state //@L86
let lastErr = 0, integ = 0; //@L87

// navigation state //@L89
let targetBearing = 45.0; //@L90
const jLog = new Array(LOG_N).fill(0); let jCount = 0; //@L91
let invertNext = false; //@L92
let runStart = 0, lockoutUntil = 0, lostSince = 0; //@L93

// ===================== SMALL HELPERS ===================== //@L95
function wrap180(a) { //@L96
  while (a > 180.0)   a -= 360.0; //@L97
  while (a <= -180.0) a += 360.0; //@L98
  return a; //@L99
} //@L100

async function pressed(pin) { //@L102
  if (digitalRead(pin) == LOW) { //@L103
    await delay(30); //@L104
    if (digitalRead(pin) == LOW) { while (digitalRead(pin) == LOW) { await arduinoYield(); } return true; } //@L105
  } //@L106
  return false; //@L107
} //@L108

async function blinkN(n) { //@L110
  for (let i = 0; i < n; i++) { digitalWrite(LED, HIGH); await delay(150); digitalWrite(LED, LOW); await delay(150); } //@L111
} //@L112

// ===================== MOTORS ===================== //@L114
function drive(l, r) { //@L115
  l = constrain(l, -255, 255); r = constrain(r, -255, 255); //@L116
  digitalWrite(IN1, l > 0); digitalWrite(IN2, l < 0); analogWrite(ENA, Math.abs(l)); //@L117
  digitalWrite(IN3, r > 0); digitalWrite(IN4, r < 0); analogWrite(ENB, Math.abs(r)); //@L118
} //@L119

// ===================== MAGNETOMETER (QMC5883L, no library) ===================== //@L121
function qmcWrite(reg, val) { //@L122
  Wire.beginTransmission(0x0D); Wire.write(reg); Wire.write(val); Wire.endTransmission(); //@L123
} //@L124

function qmcInit() { //@L126
  qmcWrite(0x0B, 0x01);   // set/reset period //@L127
  qmcWrite(0x09, 0x1D);   // continuous, 200 Hz, 8 G range, OSR 512 //@L128
} //@L129

function readRaw(x, y) {   // x, y are int16_t& -> { value } //@L131
  Wire.beginTransmission(0x0D); Wire.write(0x00); //@L132
  if (Wire.endTransmission(false) != 0) return false; //@L133
  if (Wire.requestFrom(0x0D, 6) < 6) return false; //@L134
  x.value = Wire.read(); x.value |= Wire.read() << 8; x.value = (x.value << 16) >> 16; // int16_t //@L135
  y.value = Wire.read(); y.value |= Wire.read() << 8; y.value = (y.value << 16) >> 16; // int16_t //@L136
  Wire.read(); Wire.read();            // z ignored (bot is flat) //@L137
  return true; //@L138
} //@L139

// one filtered, calibrated update of the heading vector //@L141
function updateHeading() { //@L142
  const x = { value: 0 }, y = { value: 0 }; //@L143
  if (!readRaw(x, y)) return; //@L144
  const mx = (x.value - offX) * scaleX; //@L145
  const my = (y.value - offY) * scaleY; //@L146
  if (!fInit) { fx = mx; fy = my; fInit = true; } //@L147
  else { fx += 0.5 * (mx - fx); fy += 0.5 * (my - fy); } //@L148
} //@L149

function rawHeading() {            // degrees, arbitrary zero //@L151
  updateHeading(); //@L152
  return HEADING_SIGN * Math.atan2(fy, fx) * RAD_TO_DEG; //@L153
} //@L154

function relHeading() {            // degrees relative to the START direction, -180..180 //@L156
  return wrap180(rawHeading() - heading0); //@L157
} //@L158

// spin in place ~7 s, record min/max -> hard-iron offset + soft-iron scale //@L160
async function calibrateMag() { //@L161
  const x = { value: 0 }, y = { value: 0 }; let xmin = 32767, xmax = -32768, ymin = 32767, ymax = -32768; //@L162
  const t0 = millis(); //@L163
  drive(90, -90); //@L164
  while (millis() - t0 < 7000) { //@L165
    if (readRaw(x, y)) { //@L166
      if (x.value < xmin) xmin = x.value; if (x.value > xmax) xmax = x.value; //@L167
      if (y.value < ymin) ymin = y.value; if (y.value > ymax) ymax = y.value; //@L168
    } //@L169
    await delay(5); //@L170
  } //@L171
  drive(0, 0); //@L172
  offX = (xmax + xmin) / 2.0; offY = (ymax + ymin) / 2.0; //@L173
  const dx = (xmax - xmin) / 2.0, dy = (ymax - ymin) / 2.0; //@L174
  const avg = (dx + dy) / 2.0; //@L175
  scaleX = (dx > 1) ? avg / dx : 1; scaleY = (dy > 1) ? avg / dy : 1; //@L176
  fInit = false; //@L177
  Serial.print("Cal offsets "); Serial.print(offX, 2); Serial.print(' '); Serial.println(offY, 2); //@L178
} //@L179

// ===================== LINE SENSORS ===================== //@L181
function readSensors() { //@L182
  cnt = 0; blobs = 0; let wsum = 0; let prev = false; //@L183
  for (let i = 0; i < 5; i++) { //@L184
    s[i] = (digitalRead(SENS[i]) == LINE_LEVEL); //@L185
    if (s[i]) { cnt++; wsum += (i - 2) * 1000; if (!prev) blobs++; } //@L186
    prev = s[i]; //@L187
  } //@L188
  if (cnt) pos = wsum / cnt;      // -2000 (far left) ... +2000 (far right) //@L189
} //@L190

// wide line on one side, or two separate lines  => something to decide about //@L192
function junctionSeen() { //@L193
  if (cnt >= 4) return true; //@L194
  if (blobs >= 2) return true; //@L195
  if (cnt == 3 && (s[0] || s[4])) return true; //@L196
  return false; //@L197
} //@L198

// ===================== TURNING ===================== //@L200
async function turnToHeading(target) { //@L201
  const t0 = millis(); let ok = 0; //@L202
  while (millis() - t0 < 5000) { //@L203
    const err = wrap180(target - relHeading()); //@L204
    if (Math.abs(err) < TURN_TOL) { //@L205
      drive(0, 0); //@L206
      if (++ok >= 5) break; //@L207
      await delay(3); continue; //@L208
    } //@L209
    ok = 0; //@L210
    const sp = constrain(Math.trunc(Math.abs(err) * TURN_KP), TURN_MIN_PWM, TURN_MAX_PWM); //@L211
    if (err > 0) drive(sp, -sp); else drive(-sp, sp);   // err>0 -> target is to the right //@L212
    await arduinoYield(); //@L203
  } //@L213
  drive(0, 0); //@L214
} //@L215

// quick pivot toward one side until the centre sensor finds the line (no scan, no compass) //@L217
async function pivotToLine(dir, ms) {     // dir: +1 = right, -1 = left //@L218
  const t0 = millis(); //@L219
  drive(dir * PIVOT_PWM, -dir * PIVOT_PWM); //@L220
  while (millis() - t0 < ms) { //@L221
    readSensors(); //@L222
    if (s[2]) return true;           // keep moving; PID takes over immediately //@L223
    await arduinoYield(); //@L221
  } //@L224
  drive(0, 0); //@L225
  return false; //@L226
} //@L227

// ===================== 360 deg SCAN ===================== //@L229
// Spins right once; every arc where the centre sensor sees the line is a branch. //@L230
// Returns the number of branches, headings (relative, -180..180) in out[]. //@L231
async function scanBranches(out, maxN) { //@L232
  const MAXSEG = 8; //@L233
  const segA = new Array(MAXSEG).fill(0), segB = new Array(MAXSEG).fill(0); let nSeg = 0; //@L234

  readSensors(); //@L236
  const h0 = relHeading(); let prev = h0, swept = 0, segStart = 0; //@L237
  const startActive = s[2]; let active = startActive; //@L238
  const t0 = millis(); //@L239

  drive(SCAN_PWM, -SCAN_PWM); //@L241
  while (swept < 360.0 && millis() - t0 < 9000) { //@L242
    const h = relHeading(); //@L243
    const d = wrap180(h - prev); prev = h; //@L244
    if (d > -5) swept += d;                    // ignore tiny backward noise //@L245
    readSensors(); //@L246
    const on = s[2]; //@L247
    if (on && !active) { segStart = swept; active = true; } //@L248
    else if (!on && active) { //@L249
      active = false; //@L250
      if (swept - segStart >= MIN_ARC && nSeg < MAXSEG) { segA[nSeg] = segStart; segB[nSeg] = swept; nSeg++; } //@L251
    } //@L252
    await arduinoYield(); //@L242
  } //@L253
  drive(0, 0); //@L254

  if (active && nSeg < MAXSEG) { segA[nSeg] = segStart; segB[nSeg] = 360.0; nSeg++; } //@L256
  // the arrival line was active at both start and end of the sweep -> one branch, merge //@L257
  if (startActive && active && nSeg >= 2) { segA[0] = segA[nSeg - 1] - 360.0; nSeg--; } //@L258

  let n = 0; //@L260
  for (let i = 0; i < nSeg && n < maxN; i++) { //@L261
    const mid = (segA[i] + segB[i]) / 2.0; //@L262
    out[n++] = wrap180(h0 + mid); //@L263
  } //@L264
  return n; //@L265
} //@L266

// ===================== DECISION MEMORY / LOOP DETECTION ===================== //@L268
function logChoice(h) { //@L269
  if (jCount < LOG_N) jLog[jCount++] = h; //@L270
  else { for (let i = 1; i < LOG_N; i++) jLog[i - 1] = jLog[i]; jLog[LOG_N - 1] = h; } //@L271
} //@L272

// true if the last decisions are a pattern of period p repeated REPEATS times //@L274
function loopDetected() { //@L275
  for (let p = 1; p <= MAX_PERIOD; p++) { //@L276
    const need = Math.max(REPEATS * p, 4); //@L277
    if (jCount < need) continue; //@L278
    let match = true; //@L279
    for (let k = 0; k < need - p; k++) { //@L280
      const a = jLog[jCount - 1 - k], b = jLog[jCount - 1 - k - p]; //@L281
      if (Math.abs(wrap180(a - b)) > LOOP_TOL) { match = false; break; } //@L282
    } //@L283
    if (match) return true; //@L284
  } //@L285
  return false; //@L286
} //@L287

// best = branch closest to the destination bearing; invert -> second best //@L289
function pickBranch(c, n, invert) { //@L290
  let best = 0, second = -1; //@L291
  let eBest = Math.abs(wrap180(c[0] - targetBearing)), eSecond = 1e9; //@L292
  for (let i = 1; i < n; i++) { //@L293
    const e = Math.abs(wrap180(c[i] - targetBearing)); //@L294
    if (e < eBest) { second = best; eSecond = eBest; best = i; eBest = e; } //@L295
    else if (e < eSecond) { second = i; eSecond = e; } //@L296
  } //@L297
  return (invert && second >= 0) ? second : best; //@L298
} //@L299

// ===================== JUNCTION HANDLER ===================== //@L301
async function handleJunction(arrivalH) {      // only called for REAL junctions //@L302
  drive(0, 0); await delay(60); //@L303

  const found = new Array(8).fill(0); const nF = await scanBranches(found, 8); //@L305

  // drop the branch we arrived from //@L307
  const back = wrap180(arrivalH + 180.0); //@L308
  const cand = new Array(8).fill(0); let nC = 0; //@L309
  for (let i = 0; i < nF; i++) //@L310
    if (Math.abs(wrap180(found[i] - back)) > ARRIVAL_TOL) cand[nC++] = found[i]; //@L311

  Serial.print("JUNCTION branches="); Serial.print(nC); //@L313

  if (nC == 0) {                                  // dead end -> go back //@L315
    Serial.println(" DEAD END, u-turn"); //@L316
    await turnToHeading(back); //@L317
  } else { //@L318
    let choice; //@L319
    if (nC == 1) {                                // corner / forced move, not a decision //@L320
      choice = cand[0]; //@L321
    } else { //@L322
      const inv = invertNext; //@L323
      const b = pickBranch(cand, nC, inv); //@L324
      if (inv) { invertNext = false; jCount = 0; Serial.print(" [INVERTED]"); } //@L325
      choice = cand[b]; //@L326
      logChoice(choice); //@L327
      if (loopDetected()) { invertNext = true; Serial.print(" [LOOP -> invert next]"); } //@L328
    } //@L329
    Serial.print(" go "); Serial.println(choice, 2); //@L330
    await turnToHeading(choice); //@L331
  } //@L332
  lastErr = 0; integ = 0; //@L333
  lockoutUntil = millis() + LOCKOUT_MS; //@L334
} //@L335

// ===================== FINISH ===================== //@L337
async function finished() { //@L338
  drive(0, 0); //@L339
  Serial.print("FINISH reached. heading="); Serial.print(relHeading(), 2); //@L340
  Serial.print("  target bearing="); Serial.println(targetBearing, 2); //@L341
  while (true) { digitalWrite(LED, HIGH); await delay(200); digitalWrite(LED, LOW); await delay(200); } //@L342
} //@L343

// ===================== SETUP ===================== //@L345
async function setup() { //@L346
  Serial.begin(115200); //@L347
  for (let i = 0; i < 5; i++) pinMode(SENS[i], INPUT); //@L348
  pinMode(ENA, OUTPUT); pinMode(IN1, OUTPUT); pinMode(IN2, OUTPUT); //@L349
  pinMode(ENB, OUTPUT); pinMode(IN3, OUTPUT); pinMode(IN4, OUTPUT); //@L350
  pinMode(BTN_ZERO, INPUT_PULLUP); pinMode(BTN_LEFT, INPUT_PULLUP); pinMode(BTN_RIGHT, INPUT_PULLUP); //@L351
  pinMode(LED, OUTPUT); //@L352
  drive(0, 0); //@L353

  Wire.begin(); Wire.setClock(400000); //@L355
  qmcInit(); //@L356

  // 1) calibration (bot spins on the spot for ~7 s) //@L358
  Serial.println("Put bot on flat ground, press ZERO to calibrate compass"); //@L359
  while (!(await pressed(BTN_ZERO))) { await arduinoYield(); } //@L360
  await calibrateMag(); //@L361

  // 2) place at START, choose finish side, press ZERO to set angle = 0 and go //@L363
  Serial.println("Place bot at START. LEFT/RIGHT = finish side (default RIGHT). ZERO = go"); //@L364
  let side = +1; //@L365
  while (true) { //@L366
    updateHeading(); //@L367
    if (await pressed(BTN_LEFT))       { side = -1; await blinkN(1); } //@L368
    else if (await pressed(BTN_RIGHT)) { side = +1; await blinkN(2); } //@L369
    else if (await pressed(BTN_ZERO))  { break; } //@L370
    await delay(5); //@L371
  } //@L372
  await delay(300); //@L373
  for (let i = 0; i < 30; i++) { updateHeading(); await delay(5); } //@L374
  heading0 = rawHeading();                 // <- angle = 0 here //@L375
  targetBearing = side * 45.0;             // finish is 45 deg left (-) or right (+) //@L376
  Serial.print("Target bearing = "); Serial.println(targetBearing, 2); //@L377

  jCount = 0; invertNext = false; //@L379
  runStart = millis(); //@L380
} //@L381

// ===================== MAIN LOOP ===================== //@L383
async function loop() { //@L384
  updateHeading(); //@L385
  readSensors(); //@L386
  const now = millis(); //@L387
  const armed = (now - runStart > START_IGNORE_MS) && (now > lockoutUntil); //@L388

  // ---- something wide under the array: finish, corner or junction? ---- //@L390
  if (armed && junctionSeen()) { //@L391
    const arrivalH = relHeading(); //@L392
    let sawL = s[0], sawR = s[4], sawBar = (cnt >= 4) || (blobs >= 2); //@L393
    let blackRun = (cnt >= 4); //@L394
    const t0 = millis(), tEnd = t0 + ADVANCE_MS; //@L395

    drive(BASE_PWM, BASE_PWM);                 // keep rolling, do NOT stop //@L397
    while (true) { //@L398
      readSensors(); //@L399
      const n = millis(); //@L400
      if (s[0]) sawL = true; //@L401
      if (s[4]) sawR = true; //@L402
      if (cnt >= 4 || blobs >= 2) sawBar = true; //@L403
      if (blackRun) { //@L404
        if (cnt < 4) blackRun = false;         // black patch ended -> not the finish //@L405
        else if (n - t0 >= FINISH_MS) await finished(); //@L406
      } //@L407
      if (!blackRun && n >= tEnd) break; //@L408
      await arduinoYield(); //@L398
    } //@L409

    const straightAhead = s[1] || s[2] || s[3]; // line continues past the junction? //@L411
    const twoSided = (sawL && sawR) || sawBar;  // T / cross / fork //@L412

    if (twoSided || straightAhead) { //@L414
      await handleJunction(arrivalH);                // real junction -> 360 scan //@L415
    } else { //@L416
      const dir = sawR ? +1 : -1;                // corner: line went to the side we saw it //@L417
      await pivotToLine(dir, 700); //@L418
      lastErr = 0; integ = 0; //@L419
      lockoutUntil = millis() + CORNER_LOCKOUT_MS; //@L420
    } //@L421
    return; //@L422
  } //@L423

  // ---- lost line: overshot a corner, or dead end ---- //@L425
  if (cnt == 0) { //@L426
    if (lostSince == 0) lostSince = now; //@L427
    if (armed && now - lostSince > LOST_MS) { //@L428
      const arrivalH = relHeading(); //@L429
      const dir = (lastErr >= 0) ? +1 : -1; //@L430
      if (!(await pivotToLine(dir, 350)) && !(await pivotToLine(-dir, 700))) { //@L431
        await turnToHeading(wrap180(arrivalH + 180.0));   // true dead end: U-turn //@L432
      } //@L433
      lastErr = 0; integ = 0; lostSince = 0; //@L434
      lockoutUntil = millis() + CORNER_LOCKOUT_MS; //@L435
      return; //@L436
    } //@L437
  } else { //@L438
    lostSince = 0; //@L439
  } //@L440

  // ---- PID line following ---- //@L442
  let err; //@L443
  if (cnt > 0) err = pos; //@L444
  else err = (lastErr >= 0) ? 2500.0 : -2500.0;     // keep turning toward where the line was //@L445
  integ = constrain(integ + err, -5000, 5000); //@L446
  const corr = KP * err + KI * integ + KD * (err - lastErr); //@L447
  lastErr = err; //@L448
  drive(BASE_PWM + Math.trunc(corr), BASE_PWM - Math.trunc(corr));   // err>0: line on right -> turn right //@L449
  await delay(2); //@L450
} //@L451
