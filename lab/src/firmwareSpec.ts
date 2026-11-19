// Native firmware options for the command line and design files: sources, wiring, and what the operator does.
import fs from 'node:fs';
import type { OperatorScript, Wiring } from '../../src/worker/protocol';

const isInt = (v: unknown, lo = 0, hi = 64) => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;

// Wiring from an untrusted JSON file (same fields as in an LFSim robot file's firmware.wiring).
export function parseWiring(text: string, file = 'wiring'): Wiring {
  if (text.length > 100_000) throw new Error(`${file}: too large.`);
  const w = JSON.parse(text) as Wiring;
  const bad = (m: string) => new Error(`${file}: ${m}`);
  if (!Array.isArray(w.sensorPins) || w.sensorPins.length < 1 || w.sensorPins.length > 32 || !w.sensorPins.every((p) => isInt(p))) throw bad('sensorPins must be a list of 1–32 GPIO numbers.');
  if (!Array.isArray(w.adcChannels) || !w.adcChannels.every((a) => (a.unit === 1 || a.unit === 2) && isInt(a.channel, 0, 15) && isInt(a.gpio))) throw bad('adcChannels must be { unit: 1 | 2, channel, gpio } entries.');
  const d = w.driver;
  if (!d || ![d.leftPwm, d.leftIn1, d.leftIn2, d.rightPwm, d.rightIn1, d.rightIn2].every((p) => isInt(p)) || !(d.standby === null || isInt(d.standby)) || typeof d.leftInvert !== 'boolean' || typeof d.rightInvert !== 'boolean') throw bad('driver needs leftPwm, leftIn1, leftIn2, rightPwm, rightIn1, rightIn2 (GPIO numbers), standby (GPIO or null) and leftInvert / rightInvert (true or false).');
  if (!(w.encoders === null || w.encoders === undefined || [w.encoders.leftA, w.encoders.leftB, w.encoders.rightA, w.encoders.rightB].every((p) => isInt(p)))) throw bad('encoders must be null or { leftA, leftB, rightA, rightB }.');
  if (w.board !== undefined && w.board !== 'esp32' && w.board !== 'avr') throw bad('board must be esp32 or avr.');
  if (w.buttons !== undefined && (!Array.isArray(w.buttons) || w.buttons.length > 16 || !w.buttons.every((b) => isInt(b.gpio) && typeof b.activeLow === 'boolean'))) throw bad('buttons must be a list of { gpio, activeLow }.');
  return { ...w, encoders: w.encoders ?? null };
}
export const loadWiring = (file: string) => parseWiring(fs.readFileSync(file, 'utf8'), file);

// "4@0.3,4@3.8,4@4.3" → presses; "0.5-3.6" → the calibration sweep.
export function parseOperator(presses?: string, sweep?: string): OperatorScript | null {
  if (!presses && !sweep) return null;
  const ps = (presses ?? '').split(',').map((x) => x.trim()).filter(Boolean).map((x) => {
    const m = /^(\d+)@(\d+(?:\.\d+)?)(?::(\d+(?:\.\d+)?))?$/.exec(x);
    if (!m) throw new Error(`--presses: "${x}" should look like GPIO@seconds (e.g. 4@0.3) or GPIO@seconds:hold (4@0.3:0.2).`);
    return { gpio: Number(m[1]), at_s: Number(m[2]), ...(m[3] ? { hold_s: Number(m[3]) } : {}) };
  });
  if (ps.length > 50 || ps.some((p) => p.gpio > 64 || p.at_s > 600)) throw new Error('--presses: at most 50 presses, GPIO ≤ 64, times ≤ 600 s.');
  let sw: OperatorScript['sweep'];
  if (sweep) {
    const m = /^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/.exec(sweep.trim());
    if (!m || Number(m[2]) <= Number(m[1]) || Number(m[2]) > 600) throw new Error('--sweep should look like 0.5-3.6 (from and to, in seconds).');
    sw = { from_s: Number(m[1]), to_s: Number(m[2]) };
  }
  return { presses: ps, ...(sw ? { sweep: sw } : {}) };
}

// Pins the robot itself drives or reads: a switch or button must not sit on one of them.
export function usedPins(w: Wiring): Set<number> {
  const d = w.driver;
  const pins = [...w.sensorPins, ...w.adcChannels.map((a) => a.gpio), d.leftPwm, d.leftIn1, d.leftIn2, d.rightPwm, d.rightIn1, d.rightIn2];
  if (d.standby !== null) pins.push(d.standby);
  if (w.encoders) pins.push(w.encoders.leftA, w.encoders.leftB, w.encoders.rightA, w.encoders.rightB);
  return new Set(pins);
}

// An operator script or switch levels from an untrusted design file.
export function parseLevels(v: unknown, w: Wiring, where: string): { gpio: number; level: 0 | 1 }[] {
  if (v === undefined) return [];
  const used = usedPins(w);
  if (!Array.isArray(v) || v.length > 16) throw new Error(`${where}: levels must be a list of up to 16 { gpio, level } entries.`);
  return v.map((l: { gpio?: unknown; level?: unknown }) => {
    if (!isInt(l.gpio) || (l.level !== 0 && l.level !== 1)) throw new Error(`${where}: each level needs gpio (0–64) and level (0 or 1).`);
    if (used.has(l.gpio as number)) throw new Error(`${where}: GPIO ${l.gpio} is already a sensor, ADC, driver or encoder pin in the wiring.`);
    return { gpio: l.gpio as number, level: l.level as 0 | 1 };
  });
}
export function parseOperatorScript(v: unknown, w: Wiring, where: string): OperatorScript {
  if (!v || typeof v !== 'object') throw new Error(`${where}: expected { presses, sweep?, levels? }.`);
  const o = v as { presses?: unknown; sweep?: { from_s?: unknown; to_s?: unknown; period_s?: unknown }; levels?: unknown };
  const used = usedPins(w);
  const num = (x: unknown, lo: number, hi: number) => typeof x === 'number' && Number.isFinite(x) && x >= lo && x <= hi;
  const presses = o.presses ?? [];
  if (!Array.isArray(presses) || presses.length > 50) throw new Error(`${where}: presses must be a list of up to 50 { gpio, at_s, hold_s? }.`);
  const ps = presses.map((p: { gpio?: unknown; at_s?: unknown; hold_s?: unknown }) => {
    if (!isInt(p.gpio) || !num(p.at_s, 0, 600) || !(p.hold_s === undefined || num(p.hold_s, 0.01, 10))) throw new Error(`${where}: each press needs gpio, at_s (0–600 s) and optional hold_s.`);
    if (used.has(p.gpio as number)) throw new Error(`${where}: GPIO ${p.gpio} is already used by the sensors or driver.`);
    return { gpio: p.gpio as number, at_s: p.at_s as number, ...(p.hold_s !== undefined ? { hold_s: p.hold_s as number } : {}) };
  });
  let sweep: OperatorScript['sweep'];
  if (o.sweep !== undefined) {
    const sw = o.sweep;
    if (!num(sw.from_s, 0, 600) || !num(sw.to_s, 0, 600) || (sw.to_s as number) <= (sw.from_s as number) || !(sw.period_s === undefined || num(sw.period_s, 0.1, 10))) throw new Error(`${where}: sweep needs from_s < to_s (seconds) and optional period_s.`);
    sweep = { from_s: sw.from_s as number, to_s: sw.to_s as number, ...(sw.period_s !== undefined ? { period_s: sw.period_s as number } : {}) };
  }
  const levels = parseLevels(o.levels, w, where);
  return { presses: ps, ...(sweep ? { sweep } : {}), ...(levels.length ? { levels } : {}) };
}
