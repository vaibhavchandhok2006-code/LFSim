// Simulated QMC5883L 3-axis magnetometer (the chip on most GY-271 boards), register-level, as the firmware sees it
// over I²C at address 0x0D. It reports the robot's TRUE heading: no noise, no hard/soft-iron error, no motor
// interference. That is a deliberate simplification ("assume we know the heading"), not a model of a real compass.
//
// Frames. The track image frame has x right and y down, so the robot's theta grows when it turns clockwise (seen
// from above). Magnetic north is taken as "up" on the track image (estimate: on a real mat it is wherever north is;
// only the difference between headings matters to the firmware). Heading psi = clockwise angle from north.
// The chip is mounted flat with its X arrow pointing forward. Field in chip axes:
//   X = H cos(psi),  Y = H sin(psi) if the Y arrow points left, -H sin(psi) if it points right,  Z = vertical part.
// So with Y left, atan2(Y, X) = psi grows on a right turn.

export const QMC_ADDR = 0x0d;
// Earth's field near Tiruchirappalli (estimate, about 10.8° N): horizontal ≈ 0.40 gauss, vertical ≈ 0.08 gauss down.
export const FIELD_H_GAUSS = 0.40;
export const FIELD_Z_GAUSS = 0.08;

const ODR_HZ = [10, 50, 100, 200];          // control register 0x09 bits 3:2
const LSB_PER_GAUSS = [12000, 3000];        // range 2 G or 8 G (bits 5:4 = 00 or 01)

export class Qmc5883l {
  readonly regs = new Uint8Array(0x0e);
  private ptr = 0;
  private sampleIdx = -1;
  constructor(private readonly yLeft: boolean) { this.regs[0x0d] = 0xff; } // chip ID register reads 0xFF

  private get continuous() { return (this.regs[0x09] & 0x03) === 0x01; }

  // An I²C write: the first byte sets the register pointer, the rest are written from there on (pointer increments).
  write(bytes: number[]): void {
    if (!bytes.length) return;
    this.ptr = bytes[0] & 0xff;
    for (const b of bytes.slice(1)) {
      if (this.ptr === 0x0a && b & 0x80) { this.regs.fill(0); this.regs[0x0d] = 0xff; this.sampleIdx = -1; } // soft reset
      else if (this.ptr >= 0x09 && this.ptr <= 0x0b) this.regs[this.ptr] = b & 0xff;
      this.ptr = (this.ptr + 1) % this.regs.length;
    }
  }

  // An I²C read of n bytes from the pointer at simulated time t (s), robot heading theta (rad, image frame).
  read(n: number, t: number, theta: number): number[] {
    this.update(t, theta);
    const out: number[] = [];
    for (let k = 0; k < n; k += 1) {
      out.push(this.regs[this.ptr]);
      if (this.ptr === 0x05) this.regs[0x06] &= ~0x01; // reading the data clears DRDY
      const rollover = (this.regs[0x0a] & 0x40) !== 0;
      this.ptr = rollover && this.ptr === 0x06 ? 0 : (this.ptr + 1) % this.regs.length;
    }
    return out;
  }

  // In continuous mode a new sample is taken at every output-data-rate tick; between ticks the data registers hold.
  private update(t: number, theta: number) {
    if (!this.continuous) return;
    const odr = ODR_HZ[(this.regs[0x09] >> 2) & 3];
    const idx = Math.floor(t * odr + 1e-9);
    if (idx === this.sampleIdx) return;
    this.sampleIdx = idx;
    const lsb = LSB_PER_GAUSS[(this.regs[0x09] >> 4) & 3] ?? 3000;
    const v = headingField(theta, this.yLeft).map((g) => Math.max(-32768, Math.min(32767, Math.round(g * lsb))));
    v.forEach((c, i) => { const u = c & 0xffff; this.regs[2 * i] = u & 0xff; this.regs[2 * i + 1] = u >> 8; });
    this.regs[0x06] |= 0x01; // DRDY
  }
}

// Field in chip axes (gauss) for robot heading theta (image frame, rad).
export function headingField(theta: number, yLeft: boolean): [number, number, number] {
  const psi = theta + Math.PI / 2; // clockwise from "up" (north)
  const x = FIELD_H_GAUSS * Math.cos(psi);
  const y = (yLeft ? 1 : -1) * FIELD_H_GAUSS * Math.sin(psi);
  // Z axis = X × Y: up when Y points left, down when Y points right. The field points down (northern hemisphere).
  const z = (yLeft ? -1 : 1) * FIELD_Z_GAUSS;
  return [x, y, z];
}
