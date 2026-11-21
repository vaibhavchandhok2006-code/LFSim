# LFSim firmware format (Code mode)

LFSim runs your robot's own code. You (or the LFSim Claude skill) translate the C/C++ firmware into **LFSim firmware
JavaScript**: the same functions, variables and control flow, written so the simulator can run it.

## Rules for translated code

1. Define `async function setup()` and `async function loop()` (Arduino), or `async function app_main()` (ESP-IDF).
   LFSim calls `setup()` once, then `loop()` forever; or `app_main()` once.
2. Any user function that waits (calls `delay`, `vTaskDelay`, `delayMicroseconds`, or another waiting function) must be
   `async`, and every call to it must be `await`ed. Non-waiting helpers can stay normal functions.
3. Keep names and structure. End each line with `//@L<n>` (or `//@L<n>-<m>`) naming the original source line(s) it came
   from; LFSim uses this to link the side-by-side view.
4. C types become `let`/`const`; integer division needs `Math.trunc(a / b)`; casts like `(int)x` become `Math.trunc(x)`;
   `fabs` → `Math.abs`; `HIGH`/`LOW` stay as written; pass-by-pointer outputs become `{ value }` objects (see `adc2_get_raw`, `nvs_get_i32`).
5. Never invent hardware behaviour. If a call is not in the list below, report it as unmapped.
6. `yield()` is a reserved word in JavaScript: translate Arduino `yield()` to `await arduinoYield()`.

## Hardware API

| Firmware call | In LFSim |
| --- | --- |
| `pinMode`, `gpio_set_direction`, `gpio_config`, `gpio_reset_pin` | accepted (no effect) |
| `analogRead(pin)` | sensor at that pin (wiring: sensor pins, leftmost first). Each call is a fresh conversion with its own noise. Board ESP32: 10 µs, 12-bit; board AVR (Uno/Nano): 112 µs, 10-bit |
| `analogReadResolution(bits)` | ESP32 only (9–12 bits); ignored on AVR |
| `adc1_get_raw(ch)`, `adc2_get_raw(ch, width, out)` | sensor mapped to that ADC channel (wiring) |
| `adc_oneshot_new_unit({unit_id}, out)`, `adc_oneshot_config_channel(h, ch, cfg)`, `adc_oneshot_read(h, ch, out)`, `adc_oneshot_del_unit` | ESP-IDF v5 one-shot ADC; `ADC_UNIT_1` = wiring unit 1; return `ESP_OK` |
| `digitalRead(pin)`, `gpio_get_level(pin)` | sensor pins return the thresholded value; button pins follow the operator script (see below); other pins return the last written level |
| `digitalWrite(pin, v)`, `gpio_set_level(pin, v)` | driver direction pins and standby (TB6612FNG / L298N truth table) |
| `analogWrite(pin, v)`, `analogWriteResolution(bits)` | PWM duty on a driver PWM pin (8-bit default) |
| `ledcSetup(ch, f, bits)` + `ledcAttachPin(pin, ch)` + `ledcWrite(ch, d)` | Arduino-ESP32 2.x PWM |
| `ledcAttach(pin, f, bits)` + `ledcWrite(pin, d)` | Arduino-ESP32 3.x PWM |
| `ledc_timer_config`, `ledc_channel_config`, `ledc_set_duty` + `ledc_update_duty` | ESP-IDF PWM |
| `mcpwm_gpio_init(unit, MCPWMxA/B, gpio)`, `mcpwm_init`, `mcpwm_set_duty(unit, timer, op, percent)`, `mcpwm_set_signal_low/high`, `mcpwm_start/stop` | ESP-IDF 4.x MCPWM (legacy driver) |
| `mcpwm_new_timer({period_ticks}, out)`, `mcpwm_new_operator`, `mcpwm_operator_connect_timer`, `mcpwm_new_comparator`, `mcpwm_new_generator(op, {gen_gpio_num}, out)`, `mcpwm_generator_set_action_on_compare_event`, `mcpwm_comparator_set_compare_value`, `mcpwm_generator_set_force_level`, `mcpwm_timer_enable`, `mcpwm_timer_start_stop` | ESP-IDF v5 MCPWM, usual set-up only: generator high at timer empty, low at its comparator; duty = compare value ÷ period ticks. Handles are `{ value }` outputs |
| `millis`, `micros`, `esp_timer_get_time`, `xTaskGetTickCount` | simulated clock |
| `await delay(ms)`, `await vTaskDelay(ticks)` (1 tick = 1 ms), `await delayMicroseconds(us)`, `await ets_delay_us(us)` | the code waits while physics runs |
| `attachInterrupt(pin, isr, RISING/FALLING/CHANGE)`, `digitalPinToInterrupt`, `detachInterrupt` | encoder channel A edges; channel B reads HIGH when the wheel turns forward |
| `pcnt_get_counter_value(unit, out)`, `pcnt_counter_clear(unit)`, `pcnt_unit_config`, pause/resume/filter calls | legacy PCNT: unit 0 = left encoder, 1 = right; returns `ESP_OK`, the count goes into `out.value` (int16, wraps), clear resets it |
| `pcnt_new_unit(cfg, out)`, `pcnt_unit_get_count(u, out)`, `pcnt_unit_clear_count(u)`, channel/enable/start calls | ESP-IDF v5 PCNT: units in creation order (first = left) |
| `Serial.begin/print/println/printf`, `printf`, `ESP_LOGI/W/E` | console, time-stamped |
| `EEPROM.begin/read/write/update/put/get/commit`, `Preferences`, `nvs_get_i32`, `nvs_set_i32` | memory kept for "Run again with memory" |
| `Wire.begin`, `Wire.setClock(hz)`, `Wire.beginTransmission(addr)`, `Wire.write(b)`, `Wire.endTransmission(stop)`, `Wire.requestFrom(addr, n)`, `Wire.available`, `Wire.read` | Arduino I²C master. Only the simulated QMC5883L compass answers (address `0x0D`); `endTransmission` returns 0, or 2 for any other address; buffer 32 bytes. Costs 9 bit times per byte at the set clock (default 100 kHz) plus about 10 µs (estimate) |
| `A0`–`A7` | Arduino analog pin numbers for the board: AVR `A0` = 14 … `A7` = 21; ESP32 `A0` = 36, `A3` = 39, `A4` = 32, `A5` = 33, `A6` = 34, `A7` = 35 |
| `PI`, `HALF_PI`, `TWO_PI`, `DEG_TO_RAD`, `RAD_TO_DEG` | Arduino constants |
| `constrain`, `map`, `random`, `randomSeed` | Arduino helpers; `map` uses Arduino's long-integer maths (`map(1, 0, 3, -10, 0)` = −7) |
| `HIGH`, `LOW`, `INPUT`, `OUTPUT`, `INPUT_PULLUP`, `RISING`, `FALLING`, `CHANGE`, `portTICK_PERIOD_MS`, `pdMS_TO_TICKS` | constants |

## Timing
Every call costs a little simulated CPU time (`analogRead` 10 µs on ESP32 or 112 µs on AVR, `digitalRead`/`digitalWrite`
0.2 µs on ESP32 or about 4 µs on AVR (estimate), an I²C transaction as above, other calls about 0.5 µs, each `loop()`
pass 5 µs);
`delay()` and friends run physics for their duration. The loop rate therefore comes from your code. If the code runs for
4 s of real time without returning from `loop()` or awaiting a delay, LFSim stops it and says why.

A loop that waits for something without calling `delay` (a button, a timer: `while (digitalRead(BTN) == LOW) {}`) still
moves simulated time on through the cost of its calls, but add `await arduinoYield()` inside it so the simulator can
pause there; it costs no simulated time. Floating-point maths time is not modelled (on an AVR `atan2` takes about
0.1–0.2 ms).

## Buttons and the operator script
Wiring `buttons` lists push buttons: `{ "name": "ZERO", "pin": 2, "activeLow": true }`. `activeLow` means the pin reads
`LOW` while the button is held (button to GND with `INPUT_PULLUP`). Nobody clicks during a run: the simulation runs
ahead of the screen. Instead the wiring's `operator` script says what the person at the track does, in simulated
seconds from power-on:

| Step | Meaning |
| --- | --- |
| `{ "at_s": 0.5, "action": "press", "button": "ZERO", "hold_s": 0.1 }` | hold the button down from 0.5 s to 0.6 s |
| `{ "at_s": 8, "action": "place-at-start" }` | pick the robot up and put it on the start pose, still. Use it before the run (for example after a compass calibration spin): the run timer, distance and off-line count start again. Battery charge, wheel angles and memory are kept |

In the Code panel the script is written one step per line: `0.5 press ZERO`, `8.5 press RIGHT 0.2` (hold 0.2 s),
`8 place-at-start`.

## Compass (QMC5883L)
Wiring `"magnetometer": { "chip": "QMC5883L", "yAxis": "left" }` adds a QMC5883L (the chip on most GY-271 boards) at
I²C address `0x0D`, mounted flat with its X arrow pointing forward. Registers: data `0x00`–`0x05` (X, Y, Z, low byte
first, signed 16-bit), status `0x06` (DRDY), control `0x09` (mode, output rate 10/50/100/200 Hz, range 2 G = 12000
counts/gauss or 8 G = 3000), `0x0A` (soft reset, pointer roll-over), `0x0B`, chip ID `0x0D` = `0xFF`. Data stays zero
until continuous mode is set and is held between samples at the output rate.

It reports the robot's **true heading**: no noise, no hard- or soft-iron error, no interference from the motors. A real
compass on a robot needs calibration and is disturbed by motors and batteries, so treat results as "if the heading were
perfect". The field is Earth's near Tiruchirappalli (estimate: 0.40 gauss horizontal, 0.08 gauss down), with north =
up on the track image. With the Y arrow `left`, `atan2(y, x)` grows when the robot turns right (clockwise from above);
with `right` it shrinks.

## Sandbox
The firmware runs inside the simulation's Web Worker. It cannot see the page, the network (`fetch`, `XMLHttpRequest`,
`WebSocket`), storage (`indexedDB`, `localStorage`) or `self`/`globalThis`; these names are `undefined` to it.

## "Code saw the finish"
LFSim reports that your code recognised the finish when it holds both motors at zero for 0.5 s after the robot has
driven at least 30 cm **and** the robot is at the finish (within one robot length of the finish square). Stopping
anywhere else is reported as "stopped away from the finish". The run itself never ends on its own: press Stop.

## Robot file with firmware
A `.robot.json` may carry the firmware:
```json
{ "version": 1, "name": "...", "wheelbase_mm": 120, "...": "...",
  "firmware": { "source": "original C/C++", "sourceLang": "Arduino C++ (ESP32)", "translated": "LFSim JS", "notes": "mapping summary",
    "wiring": { "board": "esp32", "sensorPins": [36,39,32,33,34,35,25,26], "adcChannels": [{ "unit": 1, "channel": 0, "gpio": 36 }],
      "driver": { "leftPwm": 16, "leftIn1": 17, "leftIn2": 18, "rightPwm": 19, "rightIn1": 21, "rightIn2": 22, "standby": 23, "leftInvert": false, "rightInvert": false },
      "encoders": null,
      "buttons": [{ "name": "GO", "pin": 2, "activeLow": true }],
      "magnetometer": { "chip": "QMC5883L", "yAxis": "left" },
      "operator": [{ "at_s": 0.5, "action": "press", "button": "GO", "hold_s": 0.1 }] } } }
```
`buttons`, `magnetometer` and `operator` are optional. Imported files are checked: names, pins (0–255), times (0–600 s),
holds (0–60 s), and every pressed button must be listed.

A complete example: `examples/magnetometer-maze/` (an Arduino Uno maze sketch with a QMC5883L and three buttons).

