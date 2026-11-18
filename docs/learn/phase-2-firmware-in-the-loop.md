# Phase 2 — your real C firmware inside the simulator

## What we built

Until now the simulator ran either its own Settings brain, or a JavaScript *translation* of your firmware (Code mode).
A translation can differ from the original. Phase 2 runs **the C code you flash**, unchanged:

```
npm run lab -- run --track public/samples/roborun-sample.png --robot lab/examples/rmi-test-rig.robot.json \
  --firmware lab/firmware/examples/rmi-test-rig/main/main.c --wiring lab/firmware/examples/rmi-test-rig/main/wiring.json \
  --presses 4@0.3,4@3.8,4@4.3 --sweep 0.5-3.6 --seconds 40 --serial serial.txt
```

## The ideas behind it

**Compiling for a different computer.** Your `main.c` normally becomes ESP32 machine code. Here GCC compiles it for
your laptop instead. It still calls `gpio_set_level`, `adc_oneshot_read`, `vTaskDelay`… so we supply our own versions
of those functions: a *shim* (`lab/firmware/shim`). The shim's header files have the same names and types as ESP-IDF's
(`driver/gpio.h`, `esp_adc/adc_oneshot.h`, `freertos/task.h`…), so your code compiles without a single change.

**Hardware calls as messages.** Each shim function sends one line to the simulator, for example
`{"f":"gpio_set_level","a":[17,1]}`. Calls that return something (`adc_oneshot_read`, `esp_timer_get_time`) wait for
the answer. The firmware runs as its own program and talks to the simulator through a *pipe* (its standard input and
output). This is called **hardware-in-the-loop** testing, or here *software*-in-the-loop: the real software, simulated
hardware.

**Lock-step time.** The firmware does not run on a clock of its own. Simulated time only moves inside hardware calls:
each call costs a few microseconds (an ESP32 ADC read about 10 µs) and `vTaskDelay` runs the physics for that long.
So the loop rate comes from your code, exactly as on the chip, and every run is repeatable.

**One hardware model, two front ends.** The simulator answers the C calls with the same code that answers the
JavaScript translation in Code mode. The proof: a reference firmware written once in C and once in JavaScript gives a
byte-identical log on 20 tracks (more than 20,000 rows).

**Buttons and calibration.** Your firmware waits for button presses: one to start calibrating, one to save, one to run,
with an interrupt on GPIO 4 and a 300 ms debounce. The simulator plays the operator: it pulls GPIO 4 low at the given
times (firing your interrupt handler), and during the sweep it makes a line pass back and forth under the sensor bar,
as when you sweep the robot by hand.

**Ticks.** FreeRTOS counts time in ticks. ESP-IDF's default is 100 ticks per second, so `vTaskDelay(1)` waits 10 ms and
`pdMS_TO_TICKS(5)` is 0 (no wait at all). The simulator uses the same default; give `--freertos-hz 1000` if your
sdkconfig sets 1000 Hz.

**Same source for the chip.** The example folders are normal ESP-IDF projects. A GitHub workflow builds them with
Espressif's official toolchain on every change, so the code the simulator tests is code that also compiles for the
ESP32.

**Safety note.** Native firmware runs as an ordinary program on your computer, unlike JavaScript Code mode, which runs
in a browser sandbox. That is fine for your own code. Code written by an AI agent (Phase 5) will be reviewed and
sandboxed before it runs this way.

## Try it

1. Run the command above and open `serial.txt`: your own `ESP_LOG` lines, with simulated times.
2. Change `BASE_SPEED` in a copy of `main.c`, run again, and compare the distance and off-line count.
3. Remove the third press from `--presses`: the robot calibrates but never starts, as on the real board.
