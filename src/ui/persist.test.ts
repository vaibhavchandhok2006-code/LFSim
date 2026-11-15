import { describe, expect, it } from 'vitest';
import { parseImport } from './persist';
import { DEFAULT_PROFILE } from '../sim/profile';

// Test report D9: robot files with impossible numbers must be refused with a clear message, not run into NaN.
describe('robot file range checks', () => {
  const file = (patch: (p: Record<string, any>) => void) => { const p = JSON.parse(JSON.stringify(DEFAULT_PROFILE)); patch(p); return JSON.stringify(p); };

  it('accepts the default robot', () => {
    expect(parseImport(file(() => {})).kind).toBe('robot');
  });

  for (const [what, patch, words] of [
    ['stall current 0', (p: any) => { p.motor.stallCurrent_A = 0; }, 'motor.stallCurrent_A'],
    ['mass 0', (p: any) => { p.mass_g = 0; }, 'mass_g'],
    ['PWM bits 0', (p: any) => { p.pwmBits = 0; }, 'pwmBits'],
    ['2.5 channels', (p: any) => { p.sensor.channels = 2.5; }, 'whole number'],
    ['negative wheel', (p: any) => { p.wheelDiameter_mm = -34; }, 'wheelDiameter_mm'],
    ['threshold above the ADC range', (p: any) => { p.sensor.adcBits = 10; p.sensor.whiteRaw = 100; p.sensor.blackRaw = 900; p.sensor.threshold = 2000; }, '10-bit'],
    ['unknown driver', (p: any) => { p.driver = 'DRV8833'; }, 'driver'],
  ] as const) {
    it(`refuses ${what}`, () => {
      expect(() => parseImport(file(patch))).toThrow(words);
    });
  }
});
