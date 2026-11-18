// Run one simulation without a browser: the same Engine the website's worker runs, advanced in chunks.
import type { FirmwareBrain } from '../../src/brain/firmware';
import { Engine } from '../../src/worker/engine';
import type { StartMsg } from '../../src/worker/protocol';

export interface RunOptions {
  firmware?: (msg: StartMsg) => FirmwareBrain; // native firmware (LFSim Lab Phase 2)
  seconds: number;          // simulated time limit
  chunk_s?: number;         // advance step (does not change results; the website uses 2 s)
  stopAtFinish?: boolean;   // end once the robot reached the finish and its brain stopped (default true)
}

export interface RunSummary {
  status: 'finished' | 'stopped' | 'time-limit' | 'error';
  error?: string;
  simTime_s: number;
  reachedFinish: boolean;
  runTime_s: number | null;
  score_s: number | null;
  offLine: number;
  distance_m: number;
  decisions: number;
  codeStoppedAway: boolean;
  events: { t: number; kind: string; text: string }[];
  memory: Record<string, unknown>;
}

export async function runHeadless(start: Omit<StartMsg, 'type' | 'runId'>, o: RunOptions): Promise<{ engine: Engine; summary: RunSummary }> {
  if (!(o.seconds > 0 && o.seconds <= 600)) throw new Error('seconds must be between 0 and 600 (the 10-minute recording limit).');
  const e = new Engine({ type: 'start', runId: 1, ...start }, { firmware: o.firmware });
  const chunk = o.chunk_s ?? 2;
  const stopAtFinish = o.stopAtFinish ?? true;
  let t = 0;
  while (e.status === 'running' && e.sim.time < o.seconds - 1e-9) {
    t = Math.min(o.seconds, t + chunk);
    await e.advance(t);
    e.drain(); // frames are for the website's playback; drop them to keep memory flat
    if (stopAtFinish && e.sim.finishTime !== null && e.sim.brain.finished()) break;
  }
  const s = e.sim;
  const summary: RunSummary = {
    status: e.status === 'error' ? 'error' : e.status === 'running' ? (s.finishTime !== null ? 'finished' : 'time-limit') : e.status,
    error: e.error,
    simTime_s: +s.time.toFixed(4),
    reachedFinish: s.finishTime !== null,
    // Only a run that reached the finish has a run time and a score (the simulator's runTime() is elapsed time otherwise).
    runTime_s: s.finishTime !== null ? s.runTime() : null,
    score_s: s.finishTime !== null ? s.score() : null,
    offLine: s.offLineCount,
    distance_m: +s.distance.toFixed(4),
    decisions: s.decisions.filter((d) => d.kind !== 'finish').length,
    codeStoppedAway: s.events.some((ev) => ev.kind === 'code-stopped'),
    events: s.events.filter((ev) => ev.kind !== 'log').map((ev) => ({ t: +ev.t.toFixed(3), kind: ev.kind, text: ev.text })),
    memory: JSON.parse(JSON.stringify(s.memory)),
  };
  e.dispose(); // stop a native firmware process (the results stay in the engine)
  return { engine: e, summary };
}
