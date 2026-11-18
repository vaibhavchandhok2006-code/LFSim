// Run-to-run variations of the mat and robot (F9). Placement jitter is applied by the session itself.
import type { Disturbances } from '../../src/worker/protocol';
import type { SimFlags } from '../../src/sim/simulation';

export interface Variation { name: string; lighting: number; bumps: number }
export const VARIATIONS: Variation[] = [
  { name: 'clean', lighting: 0, bumps: 0 },
  { name: 'uneven light', lighting: 0.5, bumps: 0.3 },
  { name: 'harsh', lighting: 1, bumps: 0.6 },
];
export const ALL_ON: SimFlags = { motorMismatch: true, batterySag: true, grip: true, noise: true, mismatch: true };

export function disturbancesFor(v: Variation, seed: number): Disturbances {
  return { lighting: { on: v.lighting > 0, strength: v.lighting }, bumps: { on: v.bumps > 0, strength: v.bumps }, seed };
}
