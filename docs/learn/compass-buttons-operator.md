# A compass, buttons and an "operator" in Code mode

## What we built

Code mode can now run firmware that talks to an **I²C compass** (a QMC5883L) and waits for **push buttons**. The first
user is a magnetometer-guided maze sketch for an Arduino Uno (`examples/magnetometer-maze/`): it calibrates its compass,
waits for you to choose the finish side with a button, then at every junction spins 360°, records the compass heading of
each branch and takes the one closest to the finish direction.

Try it: open the website → **Robot** → **Import robot** → `examples/magnetometer-maze/magnetometer-maze.robot.json` →
**Run**. The console shows the calibration, "Target bearing = 45" and each "JUNCTION branches=… go …".

## The ideas behind it

**I²C** is a two-wire bus (SDA data, SCL clock) where one master (the Arduino) talks to many small chips, each with a
7-bit address. A transaction is: start, address, then bytes, each acknowledged (ACK) by the receiver. On Arduino:

```
Wire.beginTransmission(0x0D); Wire.write(0x00); Wire.endTransmission(false); // "point at register 0"
Wire.requestFrom(0x0D, 6);                                                    // read 6 bytes from there
```

`endTransmission` returns 0 when the chip acknowledged, 2 when nobody answered at that address. Each byte is 9 clock
ticks (8 bits + ACK), so at 400 kHz six bytes take about 0.15 ms. LFSim charges that time to the firmware.

**Registers.** A sensor chip is a small table of numbered bytes. You write a register number to choose where to start,
then read or write from there; the number steps on by itself. The QMC5883L keeps X, Y and Z in registers 0–5, two bytes
each, low byte first. Two bytes make a **signed 16-bit** number: `x = low | (high << 8)`, and in JavaScript
`(x << 16) >> 16` restores the sign that C's `int16_t` gives for free.

**From field to heading.** Earth's magnetic field has a horizontal part pointing north. A chip lying flat measures that
part along its own X and Y axes, so `atan2(y, x)` is the angle between the robot and north. Turning the robot turns the
reading. Only *changes* matter to the sketch: it stores the reading at the start as "0°".

**Why real compasses are hard.** Motors, batteries and screws have their own fields (hard-iron offset) and bend Earth's
field (soft-iron). That is what the sketch's 7-second spin is for: the readings trace a circle whose centre is the
offset. LFSim's chip reports the true heading with none of that, because the question was "what if the heading were
perfect?". Its calibration finds offsets of zero.

**Buttons and pull-ups.** A button wired to GND with `INPUT_PULLUP` reads HIGH when free and LOW when pressed
("active low"). Code usually checks twice, 30 ms apart, to ignore contact bounce.

**Why an operator script, not on-screen buttons.** The simulation runs ahead of what you see on screen, so a click would
land at the wrong simulated moment. Runs must also repeat exactly. So the person at the track is written down as a
script with times: press ZERO at 0.5 s, put the robot back on the start at 8 s, press RIGHT at 8.5 s, press ZERO at 9.5 s.
"Put back on the start" also restarts the run timer, as a real run starts only after calibration.

## What the run showed

The sketch runs as written, but on this robot and the sample track it does not reach the finish, for reasons
that have nothing to do with the compass:

- `TURN_MIN_PWM = 70` is below what the modelled 200 rpm N20s through an L298N need to move (about 85; the L298N
  drop and gearbox friction are estimates). Turns that slow down near their target stall until the 5 s timeout.
- The sensors sit 117 mm ahead of the axle (RMI rig). The scan spins about the axle, so the sensors sweep a
  circle 23 cm across that starts about 10 cm short of the junction and can cross neighbouring lines.
- On a 3.8 cm line every 90° corner covers 4 of the 5 sensors, so corners are treated as junctions and get a full
  scan (about 5 s each).
- "Finish" is 4+ sensors black for 200 ms, which a wide junction or the start square can also give.

Those are the next things to fix in the algorithm or the robot, and the simulator can now test each fix.
