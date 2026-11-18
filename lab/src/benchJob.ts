// One benchmark job: a design on one track of a set, under one variation, for a whole session.
import { loadSetTrack, type SetEntry } from './tracksets';
import { runSession, type SessionResult } from './session';
import { VARIATIONS, ALL_ON, disturbancesFor } from './variations';
import type { Design } from './design';
import type { Competition } from './competition';
import type { Track } from '../../src/track/track';

export interface Job { jobId: number; setDir: string; entry: SetEntry; variation: number; design: Design; competition: Competition }
export interface JobResult { jobId: number; trackId: string; variation: number; result?: SessionResult; error?: string; wall_ms: number }

const cache = new Map<string, Track>();
export function jobSeed(entry: SetEntry, variation: number) { return (entry.seed % 1_000_000_007) * 7 + variation * 101 + 1; }

export async function runJob(j: Job): Promise<JobResult> {
  const t0 = Date.now();
  try {
    const key = `${j.setDir}|${j.entry.id}|${j.design.robot.axleFromFront_mm}`;
    let track = cache.get(key);
    if (!track) { track = loadSetTrack(j.setDir, j.entry, j.design.robot.axleFromFront_mm); if (cache.size > 40) cache.clear(); cache.set(key, track); }
    const seed = jobSeed(j.entry, j.variation);
    const result = await runSession({
      competition: j.competition, seed, plan: j.design.plan,
      base: {
        track, profile: j.design.robot, brain: { mode: 'settings', settings: j.design.settings }, flags: ALL_ON,
        disturbances: disturbancesFor(VARIATIONS[j.variation], seed), offLine_cm: 4, memory: {},
      },
    });
    return { jobId: j.jobId, trackId: j.entry.id, variation: j.variation, result, wall_ms: Date.now() - t0 };
  } catch (e) {
    return { jobId: j.jobId, trackId: j.entry.id, variation: j.variation, error: (e as Error).message, wall_ms: Date.now() - t0 };
  }
}
