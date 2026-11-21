import { describe, expect, it } from 'vitest';
import { formatButtons, formatOperator, parseButtons, parseOperator, wiringExtrasProblems } from './operator';
import { SAMPLE_WIRING } from './sampleFirmware';
import type { Wiring } from '../worker/protocol';

describe('operator script and buttons', () => {
  it('parses, sorts and formats steps', () => {
    const { steps, errors } = parseOperator('8 place-at-start\n0.5 press ZERO # calibrate\n\n9.5 press GO 0.3');
    expect(errors).toEqual([]);
    expect(steps).toEqual([
      { at_s: 0.5, action: 'press', button: 'ZERO', hold_s: 0.1 },
      { at_s: 8, action: 'place-at-start' },
      { at_s: 9.5, action: 'press', button: 'GO', hold_s: 0.3 },
    ]);
    expect(parseOperator(formatOperator(steps)).steps).toEqual(steps);
  });
  it('reports bad lines', () => {
    expect(parseOperator('x press A').errors.length).toBe(1);
    expect(parseOperator('1 jump').errors.length).toBe(1);
    expect(parseOperator('1 press A -2').errors.length).toBe(1);
    expect(parseOperator('700 press A').errors.length).toBe(1);
  });
  it('parses buttons', () => {
    const r = parseButtons('ZERO=2, LEFT=3 RIGHT=4', true);
    expect(r.errors).toEqual([]);
    expect(formatButtons(r.buttons)).toBe('ZERO=2 LEFT=3 RIGHT=4');
    expect(parseButtons('ZERO:2', true).errors.length).toBe(1);
  });
  it('checks imported wiring extras', () => {
    const ok: Wiring = { ...SAMPLE_WIRING, buttons: [{ name: 'GO', pin: 2, activeLow: true }], magnetometer: { chip: 'QMC5883L', yAxis: 'left' }, operator: [{ at_s: 1, action: 'press', button: 'GO', hold_s: 0.1 }] };
    expect(wiringExtrasProblems(ok)).toEqual([]);
    expect(wiringExtrasProblems(SAMPLE_WIRING)).toEqual([]);
    const bad = (p: object) => wiringExtrasProblems({ ...ok, ...p } as Wiring).length;
    expect(bad({ magnetometer: { chip: 'HMC5883L', yAxis: 'left' } })).toBe(1);
    expect(bad({ operator: [{ at_s: 1, action: 'press', button: 'NOPE', hold_s: 0.1 }] })).toBe(1);
    expect(bad({ operator: [{ at_s: 1, action: 'teleport' }] })).toBe(1);
    expect(bad({ buttons: [{ name: 'GO', pin: 36, activeLow: true }] })).toBeGreaterThan(0); // sensor pin
    expect(bad({ buttons: 'GO=2' })).toBeGreaterThan(0); // not a list (and GO is then unknown)
  });
});
