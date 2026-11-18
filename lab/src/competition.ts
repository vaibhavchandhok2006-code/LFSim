// A competition's rules as data (rulebook → JSON), checked on load. Robo-Run 2027 is the default; the 2026 edition is
// kept for comparison. Other events are new files.
import fs from 'node:fs';

export type RestartRule = 'aborted-runs-before' | 'all-runs-before';
export type Round = 'first' | 'final';

// How one round turns a run into a time score. Off-line is either a fixed penalty per time (2027: 5 s) or a share
// of the run time (2026: N/20 × run time); exactly one of the two is set.
export interface Scoring {
  offLine_s: number | null;
  offLineDivisor: number | null;
  restart_s: number;
  adjustment_s: number;
  blockUncleared_s: number;
  restartCounts: RestartRule;
  switchChangeIsAdjustment: boolean; // 2027: touching the bot to change a switch is an adjustment
}

export interface Competition {
  schema: 'lfsim-lab/competition';
  version: 2;
  id: string;
  name: string;
  source: string;
  mat: { gridN: number; cell_cm: number; lineWidth_cm: { min: number; max: number }; enclosed: boolean; lineColour: string };
  start: { square: string; startLine: string; timerStarts: string };
  finish: { singlePathway: boolean; hiddenFromSimpleFollower: boolean; timerStops: string; location: string };
  bot: { maxLength_mm: number; maxWidth_mm: number; weightChangeAllowed: boolean; cameraAllowed: boolean };
  session: {
    access_s: number; calibration_s: number; includesAdjustments: boolean; everyExitIsNewRun: boolean; reentryAbortsRun: boolean;
    officialTime: string; dryRunAllowed: boolean;
  };
  rounds: { first: Scoring; final: Scoring };
  round: Round;      // the round being simulated
  scoring: Scoring;  // = rounds[round]
  checkpoints: { used: boolean; nonFinisherScore: string; notes?: string };
  finalRound: { blocks: boolean; block_cm?: number; colour?: string; placement?: string; cleared?: string; notes: string };
  allowedAfterReveal: string[];
  notAllowedAfterReveal: string[];
  // Not in any rulebook: how the operator behaves. Estimates, editable.
  operator: {
    estimate: true; setup_s: number; retrieve_s: number; switchChange_s: number;
    giveUpAfter_s: number; stuckWindow_s: number; stuckDistance_cm: number; leaveStartWithin_s: number; notes: string;
  };
}

const num = (v: unknown, path: string, lo: number, hi: number): number => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) throw new Error(`${path} must be a number from ${lo} to ${hi}.`);
  return v;
};
const numOrNull = (v: unknown, path: string, lo: number, hi: number): number | null => (v === null ? null : num(v, path, lo, hi));
const str = (v: unknown, path: string): string => {
  if (typeof v !== 'string' || v.length > 500) throw new Error(`${path} must be text (at most 500 characters).`);
  return v;
};
const optStr = (v: unknown, path: string): string | undefined => (v === undefined ? undefined : str(v, path));
const bool = (v: unknown, path: string): boolean => {
  if (typeof v !== 'boolean') throw new Error(`${path} must be true or false.`);
  return v;
};
const obj = (v: unknown, path: string): Record<string, unknown> => {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error(`${path} must be an object.`);
  return v as Record<string, unknown>;
};
const strList = (v: unknown, path: string): string[] => {
  if (!Array.isArray(v) || v.length > 50) throw new Error(`${path} must be a list (at most 50 items).`);
  return v.map((x, i) => str(x, `${path}[${i}]`));
};

function parseScoring(v: unknown, path: string): Scoring {
  const s = obj(v, path);
  const offLine_s = numOrNull(s.offLine_s, `${path}.offLine_s`, 0, 600), offLineDivisor = numOrNull(s.offLineDivisor, `${path}.offLineDivisor`, 1, 1000);
  if ((offLine_s === null) === (offLineDivisor === null)) throw new Error(`${path}: set exactly one of offLine_s and offLineDivisor (the other null).`);
  const rc = s.restartCounts;
  if (rc !== 'aborted-runs-before' && rc !== 'all-runs-before') throw new Error(`${path}.restartCounts must be "aborted-runs-before" or "all-runs-before".`);
  return {
    offLine_s, offLineDivisor,
    restart_s: num(s.restart_s, `${path}.restart_s`, 0, 600), adjustment_s: num(s.adjustment_s, `${path}.adjustment_s`, 0, 600),
    blockUncleared_s: num(s.blockUncleared_s, `${path}.blockUncleared_s`, 0, 600), restartCounts: rc,
    switchChangeIsAdjustment: bool(s.switchChangeIsAdjustment, `${path}.switchChangeIsAdjustment`),
  };
}

// Validate an untrusted competition file. Throws with the first problem found.
export function parseCompetition(text: string, round: Round = 'first'): Competition {
  if (text.length > 200_000) throw new Error('Competition file too large.');
  const j = obj(JSON.parse(text), 'competition');
  if (j.schema !== 'lfsim-lab/competition') throw new Error('Not a competition file (schema must be "lfsim-lab/competition").');
  if (j.version !== 2) throw new Error(`Unsupported competition file version ${String(j.version)} (this build reads version 2).`);
  if (round !== 'first' && round !== 'final') throw new Error('The round must be "first" or "final".');
  const mat = obj(j.mat, 'mat'), lw = obj(mat.lineWidth_cm, 'mat.lineWidth_cm');
  const start = obj(j.start, 'start'), finish = obj(j.finish, 'finish'), bot = obj(j.bot, 'bot');
  const ses = obj(j.session, 'session'), rounds = obj(j.rounds, 'rounds'), op = obj(j.operator, 'operator');
  const cp = obj(j.checkpoints, 'checkpoints'), fr = obj(j.finalRound, 'finalRound');
  const lwMin = num(lw.min, 'mat.lineWidth_cm.min', 0.5, 10), lwMax = num(lw.max, 'mat.lineWidth_cm.max', 0.5, 10);
  if (lwMax < lwMin) throw new Error('mat.lineWidth_cm.max must not be below min.');
  if (op.estimate !== true) throw new Error('operator.estimate must be true (operator timings are estimates).');
  const r = { first: parseScoring(rounds.first, 'rounds.first'), final: parseScoring(rounds.final, 'rounds.final') };
  return {
    schema: 'lfsim-lab/competition', version: 2,
    id: str(j.id, 'id'), name: str(j.name, 'name'), source: str(j.source, 'source'),
    mat: {
      gridN: Math.round(num(mat.gridN, 'mat.gridN', 2, 30)), cell_cm: num(mat.cell_cm, 'mat.cell_cm', 5, 100),
      lineWidth_cm: { min: lwMin, max: lwMax }, enclosed: bool(mat.enclosed, 'mat.enclosed'), lineColour: str(mat.lineColour, 'mat.lineColour'),
    },
    start: { square: str(start.square, 'start.square'), startLine: str(start.startLine, 'start.startLine'), timerStarts: str(start.timerStarts, 'start.timerStarts') },
    finish: {
      singlePathway: bool(finish.singlePathway, 'finish.singlePathway'), hiddenFromSimpleFollower: bool(finish.hiddenFromSimpleFollower, 'finish.hiddenFromSimpleFollower'),
      timerStops: str(finish.timerStops, 'finish.timerStops'), location: str(finish.location, 'finish.location'),
    },
    bot: {
      maxLength_mm: num(bot.maxLength_mm, 'bot.maxLength_mm', 50, 1000), maxWidth_mm: num(bot.maxWidth_mm, 'bot.maxWidth_mm', 50, 1000),
      weightChangeAllowed: bool(bot.weightChangeAllowed, 'bot.weightChangeAllowed'), cameraAllowed: bool(bot.cameraAllowed, 'bot.cameraAllowed'),
    },
    session: {
      access_s: num(ses.access_s, 'session.access_s', 10, 3600), calibration_s: num(ses.calibration_s, 'session.calibration_s', 0, 600),
      includesAdjustments: bool(ses.includesAdjustments, 'session.includesAdjustments'),
      everyExitIsNewRun: bool(ses.everyExitIsNewRun, 'session.everyExitIsNewRun'), reentryAbortsRun: bool(ses.reentryAbortsRun, 'session.reentryAbortsRun'),
      officialTime: str(ses.officialTime, 'session.officialTime'), dryRunAllowed: bool(ses.dryRunAllowed, 'session.dryRunAllowed'),
    },
    rounds: r, round, scoring: r[round],
    checkpoints: { used: bool(cp.used, 'checkpoints.used'), nonFinisherScore: str(cp.nonFinisherScore, 'checkpoints.nonFinisherScore'), notes: optStr(cp.notes, 'checkpoints.notes') },
    finalRound: {
      blocks: bool(fr.blocks, 'finalRound.blocks'), block_cm: fr.block_cm === undefined ? undefined : num(fr.block_cm, 'finalRound.block_cm', 1, 50),
      colour: optStr(fr.colour, 'finalRound.colour'), placement: optStr(fr.placement, 'finalRound.placement'), cleared: optStr(fr.cleared, 'finalRound.cleared'),
      notes: str(fr.notes, 'finalRound.notes'),
    },
    allowedAfterReveal: strList(j.allowedAfterReveal, 'allowedAfterReveal'),
    notAllowedAfterReveal: strList(j.notAllowedAfterReveal, 'notAllowedAfterReveal'),
    operator: {
      estimate: true,
      setup_s: num(op.setup_s, 'operator.setup_s', 0, 120), retrieve_s: num(op.retrieve_s, 'operator.retrieve_s', 0, 120),
      switchChange_s: num(op.switchChange_s, 'operator.switchChange_s', 0, 120), giveUpAfter_s: num(op.giveUpAfter_s, 'operator.giveUpAfter_s', 5, 600),
      stuckWindow_s: num(op.stuckWindow_s, 'operator.stuckWindow_s', 1, 120), stuckDistance_cm: num(op.stuckDistance_cm, 'operator.stuckDistance_cm', 0.5, 100),
      leaveStartWithin_s: num(op.leaveStartWithin_s, 'operator.leaveStartWithin_s', 1, 120), notes: str(op.notes, 'operator.notes'),
    },
  };
}

export const DEFAULT_COMPETITION = new URL('../competition/roborun-2027.json', import.meta.url);

export function loadCompetition(file: URL | string = DEFAULT_COMPETITION, round: Round = 'first'): Competition {
  return parseCompetition(fs.readFileSync(file, 'utf8'), round);
}

// The rulebook's time score for one successful run of the competition's selected round.
export function timeScore(c: Competition, runTime_s: number, offLine: number, restarts: number, adjustments: number, blocksUncleared = 0): number {
  const s = c.scoring;
  const offLinePenalty = s.offLine_s !== null ? offLine * s.offLine_s : (offLine / s.offLineDivisor!) * runTime_s;
  return runTime_s + offLinePenalty + restarts * s.restart_s + adjustments * s.adjustment_s + blocksUncleared * s.blockUncleared_s;
}

// 2027: a bot that does not reach the destination scores (time + penalties) / C, C = value of the furthest
// checkpoint it covered. Lower is better, as for finishers; finishers always rank first.
export function checkpointScore(c: Competition, elapsed_s: number, offLine: number, restarts: number, adjustments: number, C: number): number | null {
  if (!c.checkpoints.used || C <= 0) return null;
  return timeScore(c, elapsed_s, offLine, restarts, adjustments) / C;
}
