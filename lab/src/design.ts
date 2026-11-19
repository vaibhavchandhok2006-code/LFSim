// A design: the robot, its settings and the session plan (switch table). Phase 1 designs drive Settings mode.
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_PROFILE, profileProblems, type RobotProfile } from '../../src/sim/profile';
import { DEFAULT_SETTINGS, type SettingsParams } from '../../src/brain/settings';
import { parseImport } from '../../src/ui/persist';
import type { SessionPlan } from './session';
import type { OperatorScript, Wiring } from '../../src/worker/protocol';
import { parseWiring, parseOperatorScript, parseLevels } from './firmwareSpec';

// Native C firmware for a design (Phase 2). Each run is a reset of the robot: RAM starts empty, flash (NVS) keeps
// what earlier runs saved. 'first' is what the operator does before the first run (e.g. calibrate), 'each' before
// every later run; a switch setting's levels are added to it.
export interface DesignFirmware {
  sources: string[];            // C files; in a design file, relative to the design file
  wiring: Wiring;               // in a design file: an object or the path of a wiring.json
  defines?: string[];           // e.g. CONFIG_FREERTOS_HZ=1000
  operator: { first?: OperatorScript; each: OperatorScript };
  exe?: string;                 // set once built (not stored)
}

export interface Design {
  schema: 'lfsim-lab/design';
  version: 1;
  name: string;
  robot: RobotProfile;
  settings: SettingsParams;
  plan: SessionPlan;
  firmware?: DesignFirmware;      // when present, the robot runs this C firmware instead of Settings mode
  notes: string;
}

// The default session plan: a dry run (2027: unscored) to explore at the design's base speed, then scored memory runs
// on a ladder of faster speeds. Each switch change in the scored part costs an adjustment penalty, so the ladder is
// short. The dry-run length is a design choice (the optimiser will tune it); default 5 minutes (estimate).
export function defaultPlan(s: SettingsParams): SessionPlan {
  const b = s.baseSpeed;
  const ladder = [b + 0.1, b + 0.2].map((v) => Math.min(s.maxSpeed, +v.toFixed(2))).filter((v, i, a) => a.indexOf(v) === i);
  return { explore: { name: `explore ${b}`, settings: {} }, memory: ladder.map((v) => ({ name: `memory ${v}`, settings: { baseSpeed: v } })), dry_s: 300 };
}

export function designFromRobot(robotFile: string | null, overrides: Partial<SettingsParams> = {}, name?: string): Design {
  let robot: RobotProfile = structuredClone(DEFAULT_PROFILE);
  if (robotFile) {
    const imp = parseImport(fs.readFileSync(robotFile, 'utf8'));
    if (imp.kind !== 'robot') throw new Error(`${robotFile} is not an LFSim robot file.`);
    robot = imp.value;
  }
  const settings: SettingsParams = { ...DEFAULT_SETTINGS, algorithm: 'lsrb', ...overrides };
  return { schema: 'lfsim-lab/design', version: 1, name: name ?? robot.name, robot, settings, plan: defaultPlan(settings), notes: 'Phase 1 design: Settings mode, default switch ladder.' };
}

export function loadDesign(file: string): Design {
  const text = fs.readFileSync(file, 'utf8');
  if (text.length > 5_000_000) throw new Error('Design file too large.');
  const d = JSON.parse(text) as Design;
  if (d.schema !== 'lfsim-lab/design' || d.version !== 1) throw new Error(`${file}: not a version-1 design file.`);
  const problems = profileProblems({ ...DEFAULT_PROFILE, ...d.robot });
  if (problems.length) throw new Error(`${file}: robot values out of range: ${problems.slice(0, 3).join(' ')}`);
  if (!d.plan?.explore || !Array.isArray(d.plan.memory) || d.plan.memory.length === 0 || d.plan.memory.length > 8) throw new Error(`${file}: the plan needs an explore setting and 1–8 memory settings.`);
  if (d.plan.dry_s !== undefined && !(typeof d.plan.dry_s === 'number' && d.plan.dry_s >= 0 && d.plan.dry_s <= 600)) throw new Error(`${file}: plan.dry_s must be 0–600 seconds.`);
  let firmware: DesignFirmware | undefined;
  if (d.firmware !== undefined) firmware = parseDesignFirmware(d.firmware as unknown, path.dirname(path.resolve(file)), file);
  for (const sw of [d.plan.explore, ...d.plan.memory]) {
    if (typeof sw.name !== 'string' || sw.name.length > 60) throw new Error(`${file}: every switch setting needs a name (≤ 60 characters).`);
    if (sw.levels !== undefined) {
      if (!firmware) throw new Error(`${file}: switch levels need a firmware section.`);
      sw.levels = parseLevels(sw.levels, firmware.wiring, `${file} (${sw.name})`);
    }
  }
  return { ...d, robot: { ...DEFAULT_PROFILE, ...d.robot }, settings: { ...DEFAULT_SETTINGS, ...d.settings }, ...(firmware ? { firmware } : {}) };
}

function parseDesignFirmware(v: unknown, dir: string, file: string): DesignFirmware {
  const f = v as { sources?: unknown; wiring?: unknown; defines?: unknown; operator?: { first?: unknown; each?: unknown } };
  if (!Array.isArray(f.sources) || f.sources.length < 1 || f.sources.length > 50 || !f.sources.every((x) => typeof x === 'string' && /\.c$/i.test(x))) throw new Error(`${file}: firmware.sources must list 1–50 .c files.`);
  const sources = (f.sources as string[]).map((x) => path.resolve(dir, x));
  for (const x of sources) if (!fs.existsSync(x)) throw new Error(`${file}: firmware source not found: ${x}`);
  let wiring: Wiring;
  if (typeof f.wiring === 'string') wiring = parseWiring(fs.readFileSync(path.resolve(dir, f.wiring), 'utf8'), f.wiring);
  else if (f.wiring && typeof f.wiring === 'object') wiring = parseWiring(JSON.stringify(f.wiring), `${file} firmware.wiring`);
  else throw new Error(`${file}: firmware.wiring must be a wiring object or the path of a wiring.json.`);
  const defines = f.defines ?? [];
  if (!Array.isArray(defines) || defines.length > 20 || !defines.every((x) => typeof x === 'string' && /^[A-Za-z_][A-Za-z0-9_]*(=[A-Za-z0-9_.\-]*)?$/.test(x))) throw new Error(`${file}: firmware.defines must be NAME or NAME=value entries.`);
  if (!f.operator || f.operator.each === undefined) throw new Error(`${file}: firmware.operator.each is needed (what the operator does before each run; { "presses": [] } for nothing).`);
  const operator = {
    ...(f.operator.first !== undefined ? { first: parseOperatorScript(f.operator.first, wiring, `${file} firmware.operator.first`) } : {}),
    each: parseOperatorScript(f.operator.each, wiring, `${file} firmware.operator.each`),
  };
  return { sources, wiring, defines: defines as string[], operator };
}
