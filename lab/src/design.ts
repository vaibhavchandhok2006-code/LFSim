// A design: the robot, its settings and the session plan (switch table). Phase 1 designs drive Settings mode.
import fs from 'node:fs';
import { DEFAULT_PROFILE, profileProblems, type RobotProfile } from '../../src/sim/profile';
import { DEFAULT_SETTINGS, type SettingsParams } from '../../src/brain/settings';
import { parseImport } from '../../src/ui/persist';
import type { SessionPlan } from './session';

export interface Design {
  schema: 'lfsim-lab/design';
  version: 1;
  name: string;
  robot: RobotProfile;
  settings: SettingsParams;
  plan: SessionPlan;
  notes: string;
}

// The default session plan: explore at the design's base speed, then memory runs on a ladder of faster speeds.
export function defaultPlan(s: SettingsParams): SessionPlan {
  const b = s.baseSpeed;
  const ladder = [b + 0.1, b + 0.2, b + 0.3].map((v) => Math.min(s.maxSpeed, +v.toFixed(2))).filter((v, i, a) => a.indexOf(v) === i);
  return { explore: { name: `explore ${b}`, settings: {} }, memory: ladder.map((v) => ({ name: `memory ${v}`, settings: { baseSpeed: v } })) };
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
  return { ...d, robot: { ...DEFAULT_PROFILE, ...d.robot }, settings: { ...DEFAULT_SETTINGS, ...d.settings } };
}
