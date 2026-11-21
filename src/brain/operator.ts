// Buttons, magnetometer and the operator script (Code mode): text format for the app and checks for imported files.
//
// Operator script, one step per line, times in seconds of simulated time from power-on:
//   0.5 press ZERO          press the button named ZERO for 0.1 s (default hold)
//   8.5 press RIGHT 0.2     press RIGHT for 0.2 s
//   7.8 place-at-start      put the robot back on the start pose (pre-run: the run timer and counters restart)
// Blank lines and text after # are ignored.

import type { ButtonPin, OperatorStep, Wiring } from '../worker/protocol';

export const DEFAULT_HOLD_S = 0.1;
const MAX_STEPS = 200;
const MAX_BUTTONS = 16;

export function formatOperator(steps: OperatorStep[] | undefined): string {
  return (steps ?? []).map((s) => (s.action === 'press'
    ? `${s.at_s} press ${s.button}${s.hold_s !== DEFAULT_HOLD_S ? ` ${s.hold_s}` : ''}`
    : `${s.at_s} place-at-start`)).join('\n');
}

export function parseOperator(text: string): { steps: OperatorStep[]; errors: string[] } {
  const steps: OperatorStep[] = [];
  const errors: string[] = [];
  text.split('\n').forEach((raw, i) => {
    const line = raw.replace(/#.*/, '').trim();
    if (!line) return;
    const [t, action, a, b, ...rest] = line.split(/\s+/);
    const at_s = Number(t);
    if (!Number.isFinite(at_s) || at_s < 0 || at_s > 600) { errors.push(`Line ${i + 1}: time must be 0–600 s.`); return; }
    if (action === 'press' && a && /^[A-Za-z_][\w-]{0,23}$/.test(a) && !rest.length) {
      const hold_s = b === undefined ? DEFAULT_HOLD_S : Number(b);
      if (!Number.isFinite(hold_s) || hold_s <= 0 || hold_s > 60) { errors.push(`Line ${i + 1}: hold must be 0–60 s.`); return; }
      steps.push({ at_s, action: 'press', button: a, hold_s });
    } else if (action === 'place-at-start' && a === undefined) {
      steps.push({ at_s, action: 'place-at-start' });
    } else errors.push(`Line ${i + 1}: expected "<time> press <BUTTON> [hold]" or "<time> place-at-start".`);
  });
  if (steps.length > MAX_STEPS) errors.push(`At most ${MAX_STEPS} steps.`);
  return { steps: steps.sort((p, q) => p.at_s - q.at_s), errors };
}

// "ZERO=2 LEFT=3 RIGHT=4" <-> buttons
export function formatButtons(b: ButtonPin[] | undefined): string { return (b ?? []).map((x) => `${x.name}=${x.pin}`).join(' '); }
export function parseButtons(text: string, activeLow: boolean): { buttons: ButtonPin[]; errors: string[] } {
  const buttons: ButtonPin[] = [];
  const errors: string[] = [];
  for (const tok of text.split(/[\s,]+/).filter(Boolean)) {
    const m = tok.match(/^([A-Za-z_][\w-]{0,23})=(\d{1,3})$/);
    if (!m) { errors.push(`"${tok}" should look like NAME=pin.`); continue; }
    buttons.push({ name: m[1], pin: Number(m[2]), activeLow });
  }
  if (buttons.length > MAX_BUTTONS) errors.push(`At most ${MAX_BUTTONS} buttons.`);
  return { buttons, errors };
}

// Checks for the optional wiring parts in an imported (untrusted) file. Returns problems; empty = fine.
export function wiringExtrasProblems(w: Wiring): string[] {
  const out: string[] = [];
  const isPin = (p: unknown) => Number.isInteger(p) && (p as number) >= 0 && (p as number) <= 255;
  if (w.buttons !== undefined) {
    if (!Array.isArray(w.buttons) || w.buttons.length > MAX_BUTTONS) out.push(`buttons must be a list of at most ${MAX_BUTTONS}.`);
    else w.buttons.forEach((b, i) => {
      if (!b || typeof b.name !== 'string' || !/^[A-Za-z_][\w-]{0,23}$/.test(b.name) || !isPin(b.pin) || typeof b.activeLow !== 'boolean') out.push(`buttons[${i}] needs a name, a pin (0–255) and activeLow true/false.`);
      else if (w.sensorPins.includes(b.pin)) out.push(`Button ${b.name} uses pin ${b.pin}, which is also a sensor pin.`);
    });
  }
  if (w.magnetometer !== undefined && w.magnetometer !== null) {
    const m = w.magnetometer as { chip?: unknown; yAxis?: unknown };
    if (typeof m !== 'object' || m.chip !== 'QMC5883L' || (m.yAxis !== 'left' && m.yAxis !== 'right')) out.push('magnetometer must be null or { "chip": "QMC5883L", "yAxis": "left" | "right" }.');
  }
  if (w.operator !== undefined) {
    if (!Array.isArray(w.operator) || w.operator.length > MAX_STEPS) out.push(`operator must be a list of at most ${MAX_STEPS} steps.`);
    else {
      const names = new Set(Array.isArray(w.buttons) ? w.buttons.map((b) => b?.name) : []);
      w.operator.forEach((s, i) => {
        const at = (s as { at_s?: unknown })?.at_s;
        if (typeof at !== 'number' || !Number.isFinite(at) || at < 0 || at > 600) { out.push(`operator[${i}].at_s must be 0–600 s.`); return; }
        if (s.action === 'press') {
          if (typeof s.button !== 'string' || !names.has(s.button)) out.push(`operator[${i}] presses "${String(s.button)}", which is not in buttons.`);
          if (typeof s.hold_s !== 'number' || !Number.isFinite(s.hold_s) || s.hold_s <= 0 || s.hold_s > 60) out.push(`operator[${i}].hold_s must be 0–60 s.`);
        } else if (s.action !== 'place-at-start') out.push(`operator[${i}].action must be "press" or "place-at-start".`);
      });
    }
  }
  return out;
}
