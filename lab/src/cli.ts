#!/usr/bin/env node
// LFSim Lab command line.
//   npm run lab -- run --project my.lfsim.json --seconds 120 --csv out.csv --json out.json
//   npm run lab -- tracks make --out lab/tracksets/rr-2027
//   npm run lab -- bench --set lab/tracksets/rr-2027 --robot lab/examples/rmi-test-rig.robot.json
//   npm run lab -- doctor
import fs from 'node:fs';
import path from 'node:path';
import { loadCompetition, parseCompetition } from './competition';
import { makeTrackSet, recheckSet, loadTrackSet, writePng, writeSheet, type Part } from './tracksets';
import { trackStats } from './stats';
import { buildGraph } from '../../src/track/graph';
import { designFromRobot, loadDesign } from './design';
import { runBench, summarise } from './bench';
import { writeProgress, writeResults } from './report';
import { VARIATIONS } from './variations';
import { loadInputs, type InputOptions } from './inputs';
import { runHeadless } from './headless';
import { doctor } from './doctor';
import type { Algorithm } from '../../src/brain/settings';

const ALGORITHMS: Algorithm[] = ['pid-only', 'left-hand', 'right-hand', 'straight-first', 'custom', 'lsrb', 'tremaux'];

const HELP = `LFSim Lab (Phase 1)

Commands
  run           Run one simulation headless (same engine and results as the website)
  tracks make   Generate a track set (tuning + held-out tracks) from the rulebook
  tracks check  Re-check every track of a set against the rulebook
  tracks sheet  Review page: sample tracks and the set's statistics beside a reference maze
                (--set <folder> [--count 20] [--reference <track.png>])
  bench         Run a design over a track set: full 10-minute sessions, report folder
  doctor        Check Node.js, Git, a C compiler and Claude Code on this computer

tracks make options
  --out <folder>                where to write the set (PNG tracks + manifest.json)
  --tune <n> --held <n>         tracks in each part (default 300 and 200)
  --name <text>                 set name (default: the folder name)
  --workers <n>                 parallel workers (default: CPU cores − 1)
  --competition <file.json>     rules file (default: lab/competition/roborun-2027.json)

bench options
  --set <folder>                track set
  --part held|tune              which part (default held: the honest numbers)
  --robot <file.robot.json>     robot (default: LFSim's default robot), or
  --design <file.design.json>   a full design (robot, settings, switch plan)
  --algorithm <name>            maze algorithm for a robot-file design (default lsrb)
  --base-speed <0..1>           exploration speed for a robot-file design
  --dry <seconds>               2027 dry run (unscored) at the start of the 10 minutes (default 300; 0 = all scored)
  --round first|final           which round's scoring (default first)
  --competition <file.json>     rules file (default: lab/competition/roborun-2027.json)
  --variations 1|2|3            mat variations per track (default 3: clean, uneven light, harsh)
  --limit <n>                   only the first n tracks (quick check)
  --workers <n>                 parallel workers (default: CPU cores − 1; 0 = one thread)
  --out <folder>                results folder (default results/<date>-<design>)

run options
  --project <file.lfsim.json>   everything as saved from the website (Save project)
  --track <file.png|.track.json>  track image or track file (instead of / overriding the project's)
  --robot <file.robot.json>     robot file (with firmware: runs in Code mode)
  --mode settings|code          force the brain mode
  --algorithm <name>            Settings mode algorithm: ${ALGORITHMS.join(', ')}
  --seed <n>                    disturbance seed
  --memory <file.json>          robot memory from an earlier run (memory run)
  --corners x1,y1,...,x4,y4     angled photo: the mat's corners in % of the image (TL, TR, BR, BL)
  --track-png <file>            write the track as the simulator sees it (to check an import)
  --seconds <s>                 simulated time limit (default 120, max 600)
  --keep-going                  do not stop when the finish is reached
  --csv <file>                  write the per-cycle log (same columns as the website's CSV)
  --json <file>                 write the run summary
  --save-memory <file>          write the robot memory at the end (for a later --memory run)
`;

function parseArgs(argv: string[]): { cmd: string; flags: Map<string, string | true> } {
  let [cmd = 'help', ...rest] = argv;
  if (cmd === 'tracks') { cmd = `tracks ${rest[0] ?? ''}`.trim(); rest = rest.slice(1); }
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
  if (cmd === 'tracks make' || cmd === 'tracks check' || cmd === 'tracks sheet') return tracksCmd(cmd, flags);
  if (cmd === 'bench') return benchCmd(flags);
  if (cmd !== 'run') throw new Error(`Unknown command "${cmd}". Try: npm run lab -- help`);
  const known = new Set(['project', 'track', 'robot', 'mode', 'algorithm', 'seed', 'memory', 'seconds', 'keep-going', 'csv', 'json', 'save-memory', 'chunk', 'corners', 'track-png']);
  for (const k of flags.keys()) if (!known.has(k)) throw new Error(`Unknown option --${k}`);
  const mode = str(flags, 'mode');
  if (mode !== undefined && mode !== 'settings' && mode !== 'code') throw new Error('--mode must be settings or code.');
  const algorithm = str(flags, 'algorithm');
  if (algorithm !== undefined && !ALGORITHMS.includes(algorithm as Algorithm)) throw new Error(`--algorithm must be one of: ${ALGORITHMS.join(', ')}`);
  const opts: InputOptions = {
    project: str(flags, 'project'), track: str(flags, 'track'), robot: str(flags, 'robot'),
    mode: mode as InputOptions['mode'], algorithm: algorithm as Algorithm | undefined, seed: num(flags, 'seed'), memory: str(flags, 'memory'), corners: str(flags, 'corners'),
  };
  const { start, messages } = loadInputs(opts);
  for (const m of messages) process.stderr.write(`track: ${m}\n`);
  const trackPng = str(flags, 'track-png');
  if (trackPng) { // the track as the simulator sees it (after any perspective correction), to check an import
    const t = start.track, g = new Uint8ClampedArray(t.w * t.h);
    for (let i = 0; i < g.length; i += 1) g[i] = t.dark[i] > 0.5 ? 0 : 255;
    writePng(trackPng, g, t.w, t.h);
  }
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

const onlyFlags = (flags: Map<string, string | true>, known: string[]) => { for (const k of flags.keys()) if (!known.includes(k)) throw new Error(`Unknown option --${k}`); };
const competitionFrom = (flags: Map<string, string | true>) => {
  const f = str(flags, 'competition'), round = str(flags, 'round') ?? 'first';
  if (round !== 'first' && round !== 'final') throw new Error('--round must be first or final.');
  return f ? parseCompetition(fs.readFileSync(f, 'utf8'), round) : loadCompetition(undefined, round);
};

async function tracksCmd(cmd: string, flags: Map<string, string | true>): Promise<number> {
  if (cmd === 'tracks make') {
    onlyFlags(flags, ['out', 'tune', 'held', 'name', 'competition', 'workers']);
    const out = str(flags, 'out'); if (!out) throw new Error('--out <folder> is needed.');
    if (fs.existsSync(path.join(out, 'manifest.json'))) throw new Error(`${out} already holds a track set; choose a new folder.`);
    const tune = num(flags, 'tune') ?? 300, held = num(flags, 'held') ?? 200;
    if (!(Number.isInteger(tune) && Number.isInteger(held) && tune >= 0 && held >= 0 && tune <= 5000 && held <= 5000 && tune + held > 0)) throw new Error('--tune and --held must be whole numbers from 0 to 5000.');
    const c = competitionFrom(flags);
    const t0 = Date.now();
    const workers = num(flags, 'workers');
    if (workers !== undefined && !(Number.isInteger(workers) && workers >= 0 && workers <= 256)) throw new Error('--workers must be a whole number from 0 to 256.');
    const m = await makeTrackSet(out, str(flags, 'name') ?? path.basename(out), c, { tune, held }, (d, t) => { if (d % 10 === 0 || d === t) process.stdout.write(`\r${d}/${t} tracks`); }, workers);
    process.stdout.write(`\nwrote ${m.entries.length} tracks to ${out} in ${((Date.now() - t0) / 1000).toFixed(0)} s\n`);
    return 0;
  }
  if (cmd === 'tracks sheet') {
    onlyFlags(flags, ['set', 'count', 'reference']);
    const set = str(flags, 'set'); if (!set) throw new Error('--set <folder> is needed.');
    const count = num(flags, 'count') ?? 20;
    const ref = str(flags, 'reference') ?? 'public/samples/roborun-sample.png';
    const { start } = loadInputs({ track: ref });
    const file = writeSheet(set, count, trackStats(start.track, buildGraph(start.track)));
    process.stdout.write(`review sheet: ${path.resolve(file)}\n`);
    return 0;
  }
  onlyFlags(flags, ['set', 'part', 'competition']);
  const set = str(flags, 'set'); if (!set) throw new Error('--set <folder> is needed.');
  const part = str(flags, 'part'); if (part !== undefined && part !== 'tune' && part !== 'held') throw new Error('--part must be tune or held.');
  const res = recheckSet(set, competitionFrom(flags), part as Part | undefined);
  const bad = res.filter((r) => r.problems.length);
  for (const b of bad) process.stdout.write(`${b.id}: ${b.problems.join('; ')}\n`);
  process.stdout.write(`${res.length - bad.length}/${res.length} tracks pass every check\n`);
  return bad.length ? 1 : 0;
}

async function benchCmd(flags: Map<string, string | true>): Promise<number> {
  onlyFlags(flags, ['set', 'part', 'robot', 'design', 'algorithm', 'base-speed', 'dry', 'variations', 'limit', 'workers', 'out', 'competition', 'round']);
  const set = str(flags, 'set'); if (!set) throw new Error('--set <folder> is needed (make one with: npm run lab -- tracks make --out lab/tracksets/rr-2027).');
  const part = (str(flags, 'part') ?? 'held') as Part; if (part !== 'tune' && part !== 'held') throw new Error('--part must be tune or held.');
  const algorithm = str(flags, 'algorithm');
  if (algorithm !== undefined && !ALGORITHMS.includes(algorithm as Algorithm)) throw new Error(`--algorithm must be one of: ${ALGORITHMS.join(', ')}`);
  const bs = num(flags, 'base-speed'); if (bs !== undefined && !(bs > 0 && bs <= 1)) throw new Error('--base-speed must be from 0 to 1.');
  const dFile = str(flags, 'design');
  if (dFile && (flags.has('robot') || algorithm || bs !== undefined)) throw new Error('Give --design, or --robot with --algorithm/--base-speed, not both.');
  const design = dFile ? loadDesign(dFile) : designFromRobot(str(flags, 'robot') ?? null, { ...(algorithm ? { algorithm: algorithm as Algorithm } : {}), ...(bs !== undefined ? { baseSpeed: bs } : {}) });
  const dry = num(flags, 'dry');
  if (dry !== undefined) { if (!(dry >= 0 && dry <= 600)) throw new Error('--dry must be 0–600 seconds.'); design.plan.dry_s = dry; }
  const variations = num(flags, 'variations') ?? 3;
  if (![1, 2, 3].includes(variations)) throw new Error('--variations must be 1, 2 or 3.');
  const limit = num(flags, 'limit'), workers = num(flags, 'workers');
  if (limit !== undefined && !(Number.isInteger(limit) && limit > 0)) throw new Error('--limit must be a positive whole number.');
  if (workers !== undefined && !(Number.isInteger(workers) && workers >= 0 && workers <= 256)) throw new Error('--workers must be a whole number from 0 to 256.');
  const c = competitionFrom(flags);
  const m = loadTrackSet(set);
  const slug = design.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'design';
  const out = str(flags, 'out') ?? path.join('results', `${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}-${slug}`);
  fs.mkdirSync(out, { recursive: true });
  const title = `${design.name} on ${m.name} (${part})`;
  const started = Date.now();
  let finished = 0;
  process.stdout.write(`${title}: ${variations} variation(s): ${VARIATIONS.slice(0, variations).map((v) => v.name).join(', ')}\nlive progress: ${path.resolve(out, 'progress.html')}\n`);
  const results = await runBench({
    setDir: set, part, design, competition: c, variations, limit, workers,
    onProgress: (d, t, r) => {
      if (r.result?.finished) finished += 1;
      if (d % 5 === 0 || d === t) { writeProgress(out, { done: d, total: t, finished, started, title }); process.stdout.write(`\r${d}/${t} sessions, ${((finished / d) * 100).toFixed(1)} % finished`); }
    },
  });
  const wall = (Date.now() - started) / 1000;
  const summary = summarise(results, { setDir: set, part }, wall);
  writeResults(out, { results, summary, design, competition: c, setDir: set, part, variations, command: `npm run lab -- bench ${[...flags].map(([k, v]) => (v === true ? `--${k}` : `--${k} ${v}`)).join(' ')}` });
  const ci = summary.finishRateCI95;
  process.stdout.write(`\n\nfinish rate     ${(summary.finishRate * 100).toFixed(1)} % (95 % interval ${(ci[0] * 100).toFixed(1)}–${(ci[1] * 100).toFixed(1)} %)\n` +
    `official time   median ${summary.officialTime_s.median ?? '—'} s, 10–90 % ${summary.officialTime_s.p10 ?? '—'}–${summary.officialTime_s.p90 ?? '—'} s\n` +
    `sessions        ${summary.sessions} in ${summary.wall_s} s (${summary.sessionsPerMinute}/min)${summary.errors ? `, ${summary.errors} errors` : ''}\n` +
    `report          ${path.resolve(out, 'report.html')}\n`);
  return summary.errors ? 2 : 0;
}

if (process.argv[1] && /cli\.(ts|js|mjs)$/.test(process.argv[1])) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (e: unknown) => {
    process.stderr.write(`error: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  });
}
