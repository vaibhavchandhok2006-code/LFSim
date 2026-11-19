// One search job: a built firmware variant on one track, as a single long run or a whole session.
import fs from 'node:fs';
import { Engine } from '../../src/worker/engine';
import type { OperatorScript, Wiring } from '../../src/worker/protocol';
import { NativeFirmwareBrain } from './native';
import { loadSetTrack, type SetEntry } from './tracksets';
import { parseImport } from '../../src/ui/persist';
import { runSession, type SessionPlan } from './session';
import { loadCompetition } from './competition';
import { ALL_ON, VARIATIONS, disturbancesFor } from './variations';
import type { RobotProfile } from '../../src/sim/profile';

export interface SearchJob {
  id: number; cfg: number; exe: string; wiring: Wiring; robotFile: string;
  setDir: string; entry: SetEntry; mode: 'run' | 'session'; seconds: number; variation: number;
  operator: { first?: OperatorScript; each: OperatorScript }; plan: SessionPlan; competition?: string;
}
export interface SearchResult {
  id: number; cfg: number; track: string; finished: boolean;
  time_s: number | null;      // run: time to the finish line; session: official time
  first_s: number | null;     // session: when the first finish happened (session clock)
  dist_m: number; end: string; wall_ms: number; error?: string;
}

const robots = new Map<string, RobotProfile>();
function robot(file: string): RobotProfile {
  let r = robots.get(file);
  if (!r) {
    const imp = parseImport(fs.readFileSync(file, 'utf8'));
    if (imp.kind !== 'robot') throw new Error(`${file} is not an LFSim robot file.`);
    r = imp.value; robots.set(file, r);
  }
  return r;
}

export async function runSearchJob(j: SearchJob): Promise<SearchResult> {
  const t0 = Date.now();
  const base = { id: j.id, cfg: j.cfg, track: j.entry.id };
  try {
    const profile = robot(j.robotFile);
    const track = loadSetTrack(j.setDir, j.entry, profile.axleFromFront_mm);
    const seed = (j.entry.seed % 1_000_000_007) * 7 + j.variation * 101 + 1;
    const disturbances = disturbancesFor(VARIATIONS[j.variation], seed);
    if (j.mode === 'session') {
      const r = await runSession({
        competition: loadCompetition(j.competition), seed, plan: j.plan, checkpoints: j.entry.checkpoints,
        base: { track, profile, brain: { mode: 'code', code: '', wiring: j.wiring }, flags: ALL_ON, disturbances, offLine_cm: 4, memory: {} },
        firmware: { exe: j.exe, wiring: j.wiring, operator: j.operator },
      });
      const last = r.runs[r.runs.length - 1];
      return { ...base, finished: r.finished, time_s: r.officialTime_s, first_s: r.firstFinish_s, dist_m: 0, end: last?.end ?? 'none', wall_ms: Date.now() - t0 };
    }
    const op = j.operator.first ?? j.operator.each;
    const msg = { type: 'start' as const, runId: 1, track, profile, brain: { mode: 'code' as const, code: '', wiring: j.wiring }, flags: ALL_ON, disturbances, offLine_cm: 4, memory: {}, operator: op };
    const e = new Engine(msg, { record: false, firmware: (m) => new NativeFirmwareBrain(j.exe, j.wiring, m.profile, op) });
    const s = e.sim;
    let end = 'time';
    try {
      while (s.time < j.seconds) {
        await e.advance(Math.min(j.seconds, s.time + 0.25));
        e.drain();
        const ev = s.events.find((x) => x.kind === 'finish' || x.kind === 'start-reentry' || x.kind === 'left-mat');
        if (ev) { end = ev.kind; break; }
        if (e.status !== 'running') { end = e.status; break; }
      }
    } finally { e.dispose(); }
    const finished = end === 'finish' && s.finishTime !== null && s.startTime !== null;
    return { ...base, finished, time_s: finished ? +(s.finishTime! - s.startTime!).toFixed(2) : null, first_s: null, dist_m: +s.distance.toFixed(2), end, wall_ms: Date.now() - t0 };
  } catch (err) {
    return { ...base, finished: false, time_s: null, first_s: null, dist_m: 0, end: 'error', wall_ms: Date.now() - t0, error: (err as Error).message };
  }
}
