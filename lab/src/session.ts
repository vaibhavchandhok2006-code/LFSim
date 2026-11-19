// A whole Robo-Run session: 10 minutes of maze access, run after run, as an operator would play it.
// Robo-Run 2027: the 10 minutes may be split into a dry run (x minutes, not scored — free exploration) and an actual
// run (the rest, scored), or used entirely as actual runs. Exploration runs continue until the robot holds a route in
// memory, then memory runs at switch-selected speeds. Re-entering the start square aborts a run (restart); the
// operator also stops runs that are stuck, lost, off the mat or taking too long. Touching the bot to change a switch is
// an adjustment (+3 s in round 1). Finished runs get the time score; runs that stop short get (time + penalties) / C
// for the furthest checkpoint covered. The official result is the best finished run, else the best checkpoint score.
import { Engine } from '../../src/worker/engine';
import type { OperatorScript, StartMsg, Wiring } from '../../src/worker/protocol';
import { NativeFirmwareBrain } from './native';
import type { SettingsParams } from '../../src/brain/settings';
import { Rng } from '../../src/sim/sensors';
import { checkpointScore, timeScore, type Competition } from './competition';

// One position of the robot's switches: the settings it changes (speeds, algorithm). In Code mode switches are read by
// the firmware (Phase 2); here they apply to Settings mode.
// One switch position: Settings-mode values, and/or GPIO levels that the firmware reads (native firmware designs).
export interface SwitchSetting { name: string; settings: Partial<SettingsParams>; levels?: { gpio: number; level: 0 | 1 }[] }

export interface SessionPlan {
  explore: SwitchSetting;        // used until the robot holds a complete route in memory
  memory: SwitchSetting[];       // memory-run settings, safest first; the operator moves up after a success
  dry_s?: number;                // 2027: length of the unscored dry run at the start (0 or absent = all actual)
}

// A checkpoint on the track (positions and values are told to teams at the start of the match).
export interface Checkpoint { x: number; y: number; C: number }
export const CHECKPOINT_RADIUS_M = 0.15; // the bot's centre within this distance counts as covering it (assumption)

export type RunEnd = 'finished' | 'reentry' | 'stopped-away' | 'left-mat' | 'stuck' | 'gave-up' | 'never-left' | 'session-over' | 'dry-over' | 'error';

export interface RunRecord {
  index: number;
  switch: string;
  phase: 'explore' | 'memory';
  period: 'dry' | 'actual';
  begin_s: number;          // session clock when the robot was released
  end: RunEnd;
  elapsed_s: number;        // from release to the end of the run
  runTime_s: number | null; // timer: start line to finish square
  offLine: number;
  restartsBefore: number;   // restarts counted against this run (actual period only)
  adjustmentsBefore: number; // adjustments (switch changes) counted against this run (actual period only)
  checkpoint: number;       // value C of the furthest checkpoint covered (0 = none)
  score_s: number | null;   // rulebook time score (finished actual runs only)
  checkpointScore: number | null; // (time + penalties) / C for actual runs stopped short with C > 0
  where: { x: number; y: number }; // where the run ended
  note: string;
}

export interface SessionResult {
  finished: boolean;
  officialTime_s: number | null;
  bestRun: number | null;
  bestCheckpoint: { C: number; score: number; run: number } | null; // for sessions without a finish
  firstFinish_s: number | null;       // session clock when the first run reached the finish (any period)
  runs: RunRecord[];
  restarts: number;                   // in the actual period
  adjustments: number;                // in the actual period
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
  checkpoints?: Checkpoint[];
  // Native C firmware (Phase 2): each run starts a fresh firmware process (a reset), flash carries over.
  firmware?: { exe: string; wiring: Wiring; operator: { first?: OperatorScript; each: OperatorScript } };
}

const CHUNK = 0.05;

export async function runSession(o: SessionOptions): Promise<SessionResult> {
  const c = o.competition, op = c.operator;
  if (!o.firmware && o.base.brain.mode !== 'settings') throw new Error('Session simulation drives Settings mode or native firmware (give options.firmware).');
  const dry = c.session.dryRunAllowed ? Math.max(0, Math.min(c.session.access_s, o.plan.dry_s ?? 0)) : 0;
  const baseSettings = o.base.brain.mode === 'settings' ? o.base.brain.settings : null;
  const track = o.base.track;
  const fin = track.finish;
  const fx = fin ? ((fin.x0 + fin.x1) / 2) * track.res : 0, fy = fin ? ((fin.y0 + fin.y1) / 2) * track.res : 0;
  const cps = c.checkpoints.used ? (o.checkpoints ?? []) : [];
  const rng = new Rng((o.seed >>> 0) * 2246822519 + 3);
  const place = o.placement ?? { pos_mm: 4, angle_deg: 2 };
  let clock = 0;
  let memory: Record<string, unknown> = JSON.parse(JSON.stringify(o.base.memory ?? {}));
  let restarts = 0, adjustments = 0;
  let current: string | null = null;
  let level = 0;                 // index into plan.memory
  let ceiling = o.plan.memory.length - 1; // highest level that has not failed
  const runs: RunRecord[] = [];
  let closest = Infinity;

  // Settings mode marks a complete route in memory. Firmware memory is the firmware's own business: the operator
  // switches to memory runs once the robot has finished once (they saw it reach the finish).
  const hasRoute = () => o.firmware ? runs.some((r) => r.end === 'finished')
    : Object.values(memory).some((v) => typeof v === 'object' && v !== null && (v as { complete?: boolean }).complete === true);

  for (let index = 0; index < 300; index += 1) {
    const phase: 'explore' | 'memory' = hasRoute() ? 'memory' : 'explore';
    const sw = phase === 'explore' ? o.plan.explore : o.plan.memory[Math.min(level, o.plan.memory.length - 1)];
    if (current !== null && current !== sw.name) {
      clock += op.switchChange_s;
      // Touching the bot to change a switch is an adjustment (2027). Changes during the dry run are not scored.
      if (clock >= dry && c.scoring.switchChangeIsAdjustment) adjustments += 1;
    }
    current = sw.name;
    clock += op.setup_s;
    if (clock < dry && dry - clock <= 1) clock = dry; // too little dry time left for a run: the actual run starts
    const period: 'dry' | 'actual' = clock < dry ? 'dry' : 'actual';
    const periodEnd = period === 'dry' ? dry : c.session.access_s;
    const budget = periodEnd - clock;
    if (budget <= 1) break;

    const jitter = { x: rng.gauss() * place.pos_mm / 1000, y: rng.gauss() * place.pos_mm / 1000, th: (rng.gauss() * place.angle_deg * Math.PI) / 180 };
    const sp = track.startPose;
    const runTrack = { ...track, startPose: { x: sp.x + jitter.x, y: sp.y + jitter.y, theta: sp.theta + jitter.th } };
    let e: Engine;
    if (o.firmware) {
      const fw = o.firmware;
      const script = index === 0 && fw.operator.first ? fw.operator.first : fw.operator.each;
      const operator: OperatorScript = { ...script, levels: [...(script.levels ?? []), ...(sw.levels ?? [])] };
      e = new Engine({ type: 'start', runId: index + 1, ...o.base, track: runTrack, brain: { mode: 'code', code: '', wiring: fw.wiring }, memory, operator },
        { record: false, firmware: (m) => new NativeFirmwareBrain(fw.exe, fw.wiring, m.profile, operator) });
    } else {
      const settings: SettingsParams = { ...baseSettings!, ...sw.settings };
      e = new Engine({ type: 'start', runId: index + 1, ...o.base, track: runTrack, brain: { mode: 'settings', settings }, memory }, { record: false });
    }
    const s = e.sim;
    let end: RunEnd | null = null;
    let endT = 0;
    let note = '';
    let seenEv = 0;
    let lastProgT = 0, lastDist = 0;
    let reached = 0;
    const limit = Math.min(budget, op.giveUpAfter_s);
    try {
    const covered = () => { for (const cp of cps) if (cp.C > reached && Math.hypot(s.body.x - cp.x, s.body.y - cp.y) < CHECKPOINT_RADIUS_M) reached = cp.C; };
    while (end === null) {
      await e.advance(Math.min(limit, s.time + CHUNK));
      e.drain();
      covered();
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
        end = 'stuck'; endT = s.time; note = `No progress for ${op.stuckWindow_s} s`; break;
      }
      if (s.time >= limit - 1e-9) {
        end = limit < op.giveUpAfter_s ? (period === 'dry' ? 'dry-over' : 'session-over') : 'gave-up';
        endT = s.time;
        note = end === 'gave-up' ? `Operator gave up after ${op.giveUpAfter_s} s` : end === 'dry-over' ? 'Dry run time ended' : 'Session time ran out';
        break;
      }
    }
    // The timer stopped at the finish line, but the robot only saves its route once its own code sees the finish
    // square: let it run on (a few seconds at most) as it would on the mat before the operator picks it up.
    if (end === 'finished') {
      while (!s.brain.finished() && s.time < endT + 3 && e.status === 'running') { await e.advance(s.time + CHUNK); e.drain(); covered(); }
    }
    } finally { e.dispose(); } // stop the firmware process; the run's results stay in e.sim
    const b = s.body;
    if (fin) closest = Math.min(closest, Math.hypot(b.x - fx, b.y - fy));
    const left = s.startTime !== null;
    const finished = end === 'finished' && s.startTime !== null && s.finishTime !== null;
    const runTime = finished ? s.finishTime! - s.startTime! : null;
    const scored = period === 'actual';
    const rCount = c.scoring.restartCounts === 'all-runs-before' ? runs.filter((r) => r.period === 'actual' && r.end !== 'never-left').length : restarts;
    const score = scored && runTime !== null ? timeScore(c, runTime, s.offLineCount, rCount, adjustments) : null;
    // A run stopped short (not by re-entry, which aborts it, nor by the clock) scores by its furthest checkpoint.
    const stoppedShort = scored && !finished && left && reached > 0 && (end === 'stopped-away' || end === 'left-mat' || end === 'stuck' || end === 'gave-up');
    const cpScore = stoppedShort ? checkpointScore(c, Math.max(0, endT - s.startTime!), s.offLineCount, rCount, adjustments, reached) : null;
    runs.push({
      index, switch: sw.name, phase, period, begin_s: +clock.toFixed(3), end: end!, elapsed_s: +endT.toFixed(3),
      runTime_s: runTime !== null ? +runTime.toFixed(3) : null, offLine: s.offLineCount, restartsBefore: scored ? rCount : 0,
      adjustmentsBefore: scored ? adjustments : 0, checkpoint: reached,
      score_s: score !== null ? +score.toFixed(3) : null, checkpointScore: cpScore !== null ? +cpScore.toFixed(3) : null,
      where: { x: +b.x.toFixed(3), y: +b.y.toFixed(3) }, note,
    });
    clock += end === 'finished' ? s.time : endT;
    if (end === 'session-over') break;
    clock += op.retrieve_s;
    // A run that left the start square and was aborted is a restart (rulebook: the operator returns it to the start).
    if (scored && !finished && left) restarts += 1;
    memory = JSON.parse(JSON.stringify(s.memory));
    if (end === 'dry-over') { clock = Math.max(clock, dry); continue; }
    if (phase === 'memory') {
      if (finished) { if (level < ceiling) level += 1; }
      else { ceiling = Math.max(0, level - 1); level = ceiling; }
    }
  }
  const valid = runs.filter((r) => r.score_s !== null);
  const best = valid.length ? valid.reduce((a, r) => (r.score_s! < a.score_s! ? r : a)) : null;
  // Without a finish: the furthest checkpoint first, then the lower score (rulebook tie-break order).
  const cpRuns = runs.filter((r) => r.checkpointScore !== null);
  const bestCp = cpRuns.length ? cpRuns.reduce((a, r) => (r.checkpoint > a.checkpoint || (r.checkpoint === a.checkpoint && r.checkpointScore! < a.checkpointScore!) ? r : a)) : null;
  const firstFin = runs.find((r) => r.end === 'finished');
  return {
    finished: !!best,
    officialTime_s: best ? best.score_s : null,
    bestRun: best ? best.index : null,
    bestCheckpoint: !best && bestCp ? { C: bestCp.checkpoint, score: bestCp.checkpointScore!, run: bestCp.index } : null,
    firstFinish_s: firstFin ? +(firstFin.begin_s + firstFin.elapsed_s).toFixed(3) : null,
    runs, restarts, adjustments,
    sessionUsed_s: +Math.min(c.session.access_s, clock).toFixed(3),
    closestToFinish_m: +(best ? 0 : closest).toFixed(3),
    memory,
  };
}
