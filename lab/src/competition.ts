// A competition's rules as data (rulebook → JSON), checked on load. Robo-Run is the first; other events are new files.
import fs from 'node:fs';

export type RestartRule = 'aborted-runs-before' | 'all-runs-before';

export interface Competition {
  schema: 'lfsim-lab/competition';
  version: 1;
  id: string;
  name: string;
  source: string;
  mat: { gridN: number; cell_cm: number; lineWidth_cm: { min: number; max: number }; enclosed: boolean; lineColour: string };
  start: { square: string; startLine: string; timerStarts: string };
  finish: { singlePathway: boolean; hiddenFromSimpleFollower: boolean; timerStops: string };
  bot: { maxLength_mm: number; maxWidth_mm: number; weightChangeAllowed: boolean };
  session: { access_s: number; includesAdjustments: boolean; everyExitIsNewRun: boolean; reentryAbortsRun: boolean; officialTime: string };
  scoring: { offLineDivisor: number; restart_s: number; adjustment_s: number; restartCounts: RestartRule };
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
const str = (v: unknown, path: string): string => {
  if (typeof v !== 'string' || v.length > 500) throw new Error(`${path} must be text (at most 500 characters).`);
  return v;
};
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

// Validate an untrusted competition file. Throws with the first problem found.
export function parseCompetition(text: string): Competition {
  if (text.length > 200_000) throw new Error('Competition file too large.');
  const j = obj(JSON.parse(text), 'competition');
  if (j.schema !== 'lfsim-lab/competition') throw new Error('Not a competition file (schema must be "lfsim-lab/competition").');
  if (j.version !== 1) throw new Error(`Unsupported competition file version ${String(j.version)} (this build reads version 1).`);
  const mat = obj(j.mat, 'mat'), lw = obj(mat.lineWidth_cm, 'mat.lineWidth_cm');
  const start = obj(j.start, 'start'), finish = obj(j.finish, 'finish'), bot = obj(j.bot, 'bot');
  const ses = obj(j.session, 'session'), sc = obj(j.scoring, 'scoring'), op = obj(j.operator, 'operator');
  const lwMin = num(lw.min, 'mat.lineWidth_cm.min', 0.5, 10), lwMax = num(lw.max, 'mat.lineWidth_cm.max', 0.5, 10);
  if (lwMax < lwMin) throw new Error('mat.lineWidth_cm.max must not be below min.');
  const rc = sc.restartCounts;
  if (rc !== 'aborted-runs-before' && rc !== 'all-runs-before') throw new Error('scoring.restartCounts must be "aborted-runs-before" or "all-runs-before".');
  if (op.estimate !== true) throw new Error('operator.estimate must be true (operator timings are estimates).');
  return {
    schema: 'lfsim-lab/competition', version: 1,
    id: str(j.id, 'id'), name: str(j.name, 'name'), source: str(j.source, 'source'),
    mat: {
      gridN: Math.round(num(mat.gridN, 'mat.gridN', 2, 30)), cell_cm: num(mat.cell_cm, 'mat.cell_cm', 5, 100),
      lineWidth_cm: { min: lwMin, max: lwMax }, enclosed: bool(mat.enclosed, 'mat.enclosed'), lineColour: str(mat.lineColour, 'mat.lineColour'),
    },
    start: { square: str(start.square, 'start.square'), startLine: str(start.startLine, 'start.startLine'), timerStarts: str(start.timerStarts, 'start.timerStarts') },
    finish: {
      singlePathway: bool(finish.singlePathway, 'finish.singlePathway'), hiddenFromSimpleFollower: bool(finish.hiddenFromSimpleFollower, 'finish.hiddenFromSimpleFollower'),
      timerStops: str(finish.timerStops, 'finish.timerStops'),
    },
    bot: {
      maxLength_mm: num(bot.maxLength_mm, 'bot.maxLength_mm', 50, 1000), maxWidth_mm: num(bot.maxWidth_mm, 'bot.maxWidth_mm', 50, 1000),
      weightChangeAllowed: bool(bot.weightChangeAllowed, 'bot.weightChangeAllowed'),
    },
    session: {
      access_s: num(ses.access_s, 'session.access_s', 10, 3600), includesAdjustments: bool(ses.includesAdjustments, 'session.includesAdjustments'),
      everyExitIsNewRun: bool(ses.everyExitIsNewRun, 'session.everyExitIsNewRun'), reentryAbortsRun: bool(ses.reentryAbortsRun, 'session.reentryAbortsRun'),
      officialTime: str(ses.officialTime, 'session.officialTime'),
    },
    scoring: {
      offLineDivisor: num(sc.offLineDivisor, 'scoring.offLineDivisor', 1, 1000), restart_s: num(sc.restart_s, 'scoring.restart_s', 0, 600),
      adjustment_s: num(sc.adjustment_s, 'scoring.adjustment_s', 0, 600), restartCounts: rc,
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

export function loadCompetition(file = new URL('../competition/roborun.json', import.meta.url)): Competition {
  return parseCompetition(fs.readFileSync(file, 'utf8'));
}

// The rulebook's time score for one successful run.
export function timeScore(c: Competition, runTime_s: number, offLine: number, restarts: number, adjustments: number): number {
  return runTime_s + (offLine / c.scoring.offLineDivisor) * runTime_s + restarts * c.scoring.restart_s + adjustments * c.scoring.adjustment_s;
}
