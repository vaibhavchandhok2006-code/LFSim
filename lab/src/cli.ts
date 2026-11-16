#!/usr/bin/env node
// LFSim Lab command line. Phase 0: run a simulation without a browser, and check the computer's setup.
//   npm run lab -- run --project my.lfsim.json --seconds 120 --csv out.csv --json out.json
//   npm run lab -- run --track public/samples/roborun-sample.png --robot my.robot.json --algorithm left-hand
//   npm run lab -- doctor
import fs from 'node:fs';
import { loadInputs, type InputOptions } from './inputs';
import { runHeadless } from './headless';
import { doctor } from './doctor';
import type { Algorithm } from '../../src/brain/settings';

const ALGORITHMS: Algorithm[] = ['pid-only', 'left-hand', 'right-hand', 'straight-first', 'custom', 'lsrb', 'tremaux'];

const HELP = `LFSim Lab (Phase 0)

Commands
  run       Run one simulation headless (same engine and results as the website)
  doctor    Check Node.js, Git, a C compiler and Claude Code on this computer

run options
  --project <file.lfsim.json>   everything as saved from the website (Save project)
  --track <file.png|.track.json>  track image or track file (instead of / overriding the project's)
  --robot <file.robot.json>     robot file (with firmware: runs in Code mode)
  --mode settings|code          force the brain mode
  --algorithm <name>            Settings mode algorithm: ${ALGORITHMS.join(', ')}
  --seed <n>                    disturbance seed
  --memory <file.json>          robot memory from an earlier run (memory run)
  --seconds <s>                 simulated time limit (default 120, max 600)
  --keep-going                  do not stop when the finish is reached
  --csv <file>                  write the per-cycle log (same columns as the website's CSV)
  --json <file>                 write the run summary
  --save-memory <file>          write the robot memory at the end (for a later --memory run)
`;

function parseArgs(argv: string[]): { cmd: string; flags: Map<string, string | true> } {
  const [cmd = 'help', ...rest] = argv;
  const flags = new Map<string, string | true>();
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (!a.startsWith('--')) throw new Error(`Unexpected argument: ${a}`);
    const k = a.slice(2);
    const next = rest[i + 1];
    if (next !== undefined && !next.startsWith('--')) { flags.set(k, next); i += 1; } else flags.set(k, true);
  }
  return { cmd, flags };
}

const str = (f: Map<string, string | true>, k: string): string | undefined => {
  const v = f.get(k);
  if (v === true) throw new Error(`--${k} needs a value.`);
  return v;
};
const num = (f: Map<string, string | true>, k: string): number | undefined => {
  const v = str(f, k);
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`--${k} must be a number.`);
  return n;
};

export async function main(argv: string[]): Promise<number> {
  const { cmd, flags } = parseArgs(argv);
  if (cmd === 'help' || flags.has('help')) { process.stdout.write(HELP); return 0; }
  if (cmd === 'doctor') {
    const { checks, ok } = doctor();
    for (const c of checks) process.stdout.write(`${c.ok ? 'OK     ' : 'MISSING'} ${c.name.padEnd(18)} ${c.found}  — needed for ${c.needed}${c.ok ? '' : `\n        fix: ${c.fix}`}\n`);
    return ok ? 0 : 1;
  }
  if (cmd !== 'run') throw new Error(`Unknown command "${cmd}". Try: npm run lab -- help`);
  const known = new Set(['project', 'track', 'robot', 'mode', 'algorithm', 'seed', 'memory', 'seconds', 'keep-going', 'csv', 'json', 'save-memory', 'chunk']);
  for (const k of flags.keys()) if (!known.has(k)) throw new Error(`Unknown option --${k}`);
  const mode = str(flags, 'mode');
  if (mode !== undefined && mode !== 'settings' && mode !== 'code') throw new Error('--mode must be settings or code.');
  const algorithm = str(flags, 'algorithm');
  if (algorithm !== undefined && !ALGORITHMS.includes(algorithm as Algorithm)) throw new Error(`--algorithm must be one of: ${ALGORITHMS.join(', ')}`);
  const opts: InputOptions = {
    project: str(flags, 'project'), track: str(flags, 'track'), robot: str(flags, 'robot'),
    mode: mode as InputOptions['mode'], algorithm: algorithm as Algorithm | undefined, seed: num(flags, 'seed'), memory: str(flags, 'memory'),
  };
  const { start, messages } = loadInputs(opts);
  for (const m of messages) process.stderr.write(`track: ${m}\n`);
  const t0 = Date.now();
  const { engine, summary } = await runHeadless(start, { seconds: num(flags, 'seconds') ?? 120, chunk_s: num(flags, 'chunk'), stopAtFinish: !flags.has('keep-going') });
  const wall = (Date.now() - t0) / 1000;
  const csv = str(flags, 'csv'), json = str(flags, 'json'), mem = str(flags, 'save-memory');
  if (csv) fs.writeFileSync(csv, engine.csv(Infinity) + '\n');
  if (json) fs.writeFileSync(json, JSON.stringify({ ...summary, wall_s: wall }, null, 2) + '\n');
  if (mem) fs.writeFileSync(mem, JSON.stringify(summary.memory, null, 2) + '\n');
  const fmt = (v: number | null) => (v === null ? '—' : `${v.toFixed(2)} s`);
  process.stdout.write(
    `status        ${summary.status}${summary.error ? ` (${summary.error})` : ''}\n` +
    `reached finish ${summary.reachedFinish ? 'yes' : 'no'}${summary.codeStoppedAway ? ' (code stopped the robot away from the finish)' : ''}\n` +
    `run time      ${fmt(summary.runTime_s)}\nscore         ${fmt(summary.score_s)}\noff the line  ${summary.offLine}\n` +
    `distance      ${summary.distance_m.toFixed(2)} m\ndecisions     ${summary.decisions}\nsimulated     ${summary.simTime_s.toFixed(2)} s in ${wall.toFixed(1)} s (${(summary.simTime_s / wall).toFixed(0)}× real time)\n`,
  );
  return summary.status === 'error' ? 2 : 0;
}

if (process.argv[1] && /cli\.(ts|js|mjs)$/.test(process.argv[1])) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (e: unknown) => {
    process.stderr.write(`error: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  });
}
