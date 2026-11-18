// A whole Robo-Run session: 10 minutes of maze access, run after run, as an operator would play it. Exploration runs
// until the robot has a route in memory, then memory runs at switch-selected speeds. Re-entering the start square
// aborts a run; the operator also aborts a run that is stuck, lost, off the mat or taking too long. Every run gets the
// rulebook's time score; the official time is the best one.
import { Engine } from '../../src/worker/engine';
import type { StartMsg } from '../../src/worker/protocol';
import type { SettingsParams } from '../../src/brain/settings';
import { Rng } from '../../src/sim/sensors';
import { timeScore, type Competition } from './competition';

// One position of the robot's switches: the settings it changes (speeds, algorithm). In Code mode switches are read by
// the firmware (Phase 2); here they apply to Settings mode.
export interface SwitchSetting { name: string; settings: Partial<SettingsParams> }

export interface SessionPlan {
  explore: SwitchSetting;        // used until the robot holds a complete route in memory
  memory: SwitchSetting[];       // memory-run settings, safest first; the operator moves up after a success
}

export type RunEnd = 'finished' | 'reentry' | 'stopped-away' | 'left-mat' | 'stuck' | 'gave-up' | 'never-left' | 'session-over' | 'error';

export interface RunRecord {
  index: number;
  switch: string;
  phase: 'explore' | 'memory';
  begin_s: number;          // session clock when the robot was released
  end: RunEnd;
  elapsed_s: number;        // from release to the end of the run
  runTime_s: number | null; // timer: start line to finish square
  offLine: number;
  restartsBefore: number;   // restarts counted against this run
  score_s: number | null;   // rulebook time score (finished runs only)
  where: { x: number; y: number }; // where the run ended
  note: string;
}

export interface SessionResult {
  finished: boolean;
  officialTime_s: number | null;
  bestRun: number | null;
  firstFinish_s: number | null;       // session clock when the first run reached the finish
  runs: RunRecord[];
  restarts: number;
  sessionUsed_s: number;
  closestToFinish_m: number;           // tie-break for robots that never finish (rulebook)
  memory: Record<string, unknown>;     // the robot's memory at the end (its route, once found)
}

export interface SessionOptions {
  base: Omit<StartMsg, 'type' | 'runId'>; // track, robot, brain (Settings), flags, mat disturbances
  plan: SessionPlan;
  competition: Competition;
  seed: number;                 // placement jitter per run
  placement?: { pos_mm: number; angle_deg: number }; // how precisely the operator places the robot (estimate)
}

const CHUNK = 0.05;

export async function runSession(o: SessionOptions): Promise<SessionResult> {
  const c = o.competition, op = c.operator;
  if (o.base.brain.mode !== 'settings') throw new Error('Session simulation drives Settings mode in Phase 1 (Code mode switches arrive with Phase 2).');
  const baseSettings = o.base.brain.settings;
  const track = o.base.track;
  const fin = track.finish;
  const fx = fin ? ((fin.x0 + fin.x1) / 2) * track.res : 0, fy = fin ? ((fin.y0 + fin.y1) / 2) * track.res : 0;
  const rng = new Rng((o.seed >>> 0) * 2246822519 + 3);
  const place = o.placement ?? { pos_mm: 4, angle_deg: 2 };
  let clock = 0;
  let memory: Record<string, unknown> = JSON.parse(JSON.stringify(o.base.memory ?? {}));
  let restarts = 0;
  let current: string | null = null;
  let level = 0;                 // index into plan.memory
  let ceiling = o.plan.memory.length - 1; // highest level that has not failed
  const runs: RunRecord[] = [];
  let closest = Infinity;

  const hasRoute = () => Object.values(memory).some((v) => typeof v === 'object' && v !== null && (v as { complete?: boolean }).complete === true);

  for (let index = 0; index < 200; index += 1) {
    const phase: 'explore' | 'memory' = hasRoute() ? 'memory' : 'explore';
    const sw = phase === 'explore' ? o.plan.explore : o.plan.memory[Math.min(level, o.plan.memory.length - 1)];
    if (current !== null && current !== sw.name) clock += op.switchChange_s;
    current = sw.name;
    clock += op.setup_s;
    const budget = c.session.access_s - clock;
    if (budget <= 1) break;

    const jitter = { x: rng.gauss() * place.pos_mm / 1000, y: rng.gauss() * place.pos_mm / 1000, th: (rng.gauss() * place.angle_deg * Math.PI) / 180 };
    const sp = track.startPose;
    const runTrack = { ...track, startPose: { x: sp.x + jitter.x, y: sp.y + jitter.y, theta: sp.theta + jitter.th } };
    const settings: SettingsParams = { ...baseSettings, ...sw.settings };
    const e = new Engine({ type: 'start', runId: index + 1, ...o.base, track: runTrack, brain: { mode: 'settings', settings }, memory }, { record: false });
    const s = e.sim;
    let end: RunEnd | null = null;
    let endT = 0;
    let note = '';
    let seenEv = 0;
    let lastProgT = 0, lastDist = 0;
    const limit = Math.min(budget, op.giveUpAfter_s);
    while (end === null) {
      await e.advance(Math.min(limit, s.time + CHUNK));
      e.drain();
      for (; seenEv < s.events.length; seenEv += 1) {
        const ev = s.events[seenEv];
        if (ev.kind === 'finish') { end = 'finished'; endT = ev.t; break; }
        if (ev.kind === 'start-reentry' && c.session.reentryAbortsRun) { end = 'reentry'; endT = ev.t; note = 'Re-entered the start square: run aborted (rulebook)'; break; }
        if (ev.kind === 'code-stopped') { end = 'stopped-away'; endT = ev.t; note = ev.text; break; }
        if (ev.kind === 'left-mat') { end = 'left-mat'; endT = ev.t; note = 'Left the mat'; break; }
      }
      if (end) break;
      if (e.status === 'error') { end = 'error'; endT = s.time; note = e.error ?? 'error'; break; }
      if (s.startTime === null && s.time >= op.leaveStartWithin_s) { end = 'never-left'; endT = s.time; note = 'Did not leave the start square'; break; }
      if (s.distance - lastDist >= op.stuckDistance_cm / 100) { lastDist = s.distance; lastProgT = s.time; }
      else if (s.time - lastProgT >= op.stuckWindow_s) {
        if (s.startTime === null) { end = 'never-left'; endT = s.time; note = 'Did not leave the start square'; break; }
        end = 'stuck'; endT = s.time; note = `No progress for ${op.stuckWindow_s} s`; break; }
      if (s.time >= limit - 1e-9) { end = limit < op.giveUpAfter_s ? 'session-over' : 'gave-up'; endT = s.time; note = end === 'gave-up' ? `Operator gave up after ${op.giveUpAfter_s} s` : 'Session time ran out'; break; }
    }
    // The timer stopped at the finish line, but the robot only saves its route once its own code sees the finish
    // square: let it run on (a few seconds at most) as it would on the mat before the operator picks it up.
    if (end === 'finished') {
      while (!s.brain.finished() && s.time < endT + 3 && e.status === 'running') { await e.advance(s.time + CHUNK); e.drain(); }
    }
    const b = s.body;
    if (fin) closest = Math.min(closest, Math.hypot(b.x - fx, b.y - fy));
    const left = s.startTime !== null;
    const finished = end === 'finished' && s.startTime !== null && s.finishTime !== null;
    const runTime = finished ? s.finishTime! - s.startTime! : null;
    const counted = c.scoring.restartCounts === 'all-runs-before' ? runs.filter((r) => r.end !== 'never-left').length : restarts;
    const score = runTime !== null ? timeScore(c, runTime, s.offLineCount, counted, 0) : null;
    runs.push({
      index, switch: sw.name, phase, begin_s: +clock.toFixed(3), end: end!, elapsed_s: +endT.toFixed(3),
      runTime_s: runTime !== null ? +runTime.toFixed(3) : null, offLine: s.offLineCount, restartsBefore: counted,
      score_s: score !== null ? +score.toFixed(3) : null, where: { x: +b.x.toFixed(3), y: +b.y.toFixed(3) }, note,
    });
    clock += end === 'finished' ? s.time : endT;
    if (end === 'session-over') break;
    clock += op.retrieve_s;
    // A run that left the start square and was aborted is a restart (rulebook: the operator returns it to the start).
    if (!finished && left) restarts += 1;
    memory = JSON.parse(JSON.stringify(s.memory));
    if (phase === 'memory') {
      if (finished) { if (level < ceiling) level += 1; }
      else { ceiling = Math.max(0, level - 1); level = ceiling; }
    }
  }
  const valid = runs.filter((r) => r.score_s !== null);
  const best = valid.length ? valid.reduce((a, r) => (r.score_s! < a.score_s! ? r : a)) : null;
  const firstFin = runs.find((r) => r.end === 'finished');
  return {
    finished: !!best,
    officialTime_s: best ? best.score_s : null,
    bestRun: best ? best.index : null,
    firstFinish_s: firstFin ? +(firstFin.begin_s + firstFin.elapsed_s).toFixed(3) : null,
    runs, restarts,
    sessionUsed_s: +Math.min(c.session.access_s, clock).toFixed(3),
    closestToFinish_m: +(best ? 0 : closest).toFixed(3),
    memory,
  };
}
