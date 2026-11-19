// Search: try many build-time variants of a firmware (values for its config.h names) on a track set and rank them.
// Successive halving: every variant is tried on a few tracks; the best third goes on to more tracks, and so on.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { buildFirmware } from './native';
import { parseWiring, parseOperatorScript } from './firmwareSpec';
import { loadTrackSet, type Part } from './tracksets';
import type { SessionPlan } from './session';
import type { SearchJob, SearchResult } from './searchJob';
import { runSearchJob } from './searchJob';
import { Rng } from '../../src/sim/sensors';

export interface SearchSpace {
  schema: 'lfsim-lab/search'; version: 1;
  sources: string[]; wiring: string; robot: string; defines?: string[];
  operator: { first?: unknown; each: unknown };
  plan?: SessionPlan;
  base?: Record<string, number>;
  params: Record<string, number[]>;
  set: string; part?: Part;
  mode?: 'run' | 'session'; seconds?: number;
  samples?: number; rounds?: number[]; keep?: number; seed?: number; variation?: number;
}

const NAME = /^[A-Z_][A-Z0-9_]*$/;

export function loadSpace(file: string) {
  const text = fs.readFileSync(file, 'utf8');
  if (text.length > 200_000) throw new Error(`${file}: too large.`);
  const s = JSON.parse(text) as SearchSpace;
  const dir = path.dirname(path.resolve(file));
  const bad = (m: string) => new Error(`${file}: ${m}`);
  if (s.schema !== 'lfsim-lab/search' || s.version !== 1) throw bad('not a version-1 search file.');
  if (!Array.isArray(s.sources) || !s.sources.length || s.sources.length > 50 || !s.sources.every((x) => typeof x === 'string' && /\.c$/.test(x))) throw bad('sources must list .c files.');
  const numMap = (o: unknown, what: string) => {
    if (o === undefined) return {};
    if (!o || typeof o !== 'object') throw bad(`${what} must be an object.`);
    for (const [k, v] of Object.entries(o)) if (!NAME.test(k) || typeof v !== 'number' || !Number.isFinite(v)) throw bad(`${what}.${k} must be a NAME: number.`);
    return o as Record<string, number>;
  };
  const base = numMap(s.base, 'base');
  if (!s.params || typeof s.params !== 'object') throw bad('params missing.');
  for (const [k, v] of Object.entries(s.params)) {
    if (!NAME.test(k) || !Array.isArray(v) || v.length < 1 || v.length > 50 || !v.every((x) => typeof x === 'number' && Number.isFinite(x))) throw bad(`params.${k} must be a list of 1–50 numbers.`);
  }
  if (Object.keys(s.params).length > 40) throw bad('at most 40 params.');
  const defines = s.defines ?? [];
  if (!Array.isArray(defines) || !defines.every((x) => typeof x === 'string' && /^[A-Za-z_][A-Za-z0-9_]*(=[A-Za-z0-9_.\-]*)?$/.test(x))) throw bad('defines must be NAME or NAME=value.');
  const wiring = parseWiring(fs.readFileSync(path.resolve(dir, s.wiring), 'utf8'), s.wiring);
  const operator = {
    ...(s.operator?.first !== undefined ? { first: parseOperatorScript(s.operator.first, wiring, `${file} operator.first`) } : {}),
    each: parseOperatorScript(s.operator?.each, wiring, `${file} operator.each`),
  };
  const mode = s.mode ?? 'run';
  if (mode !== 'run' && mode !== 'session') throw bad('mode must be run or session.');
  const seconds = s.seconds ?? 590;
  if (!(seconds >= 10 && seconds <= 3600)) throw bad('seconds must be 10–3600.');
  const rounds = s.rounds ?? [6, 18, 54];
  if (!Array.isArray(rounds) || !rounds.length || rounds.length > 6 || !rounds.every((r, i) => Number.isInteger(r) && r >= 1 && r <= 2000 && (i === 0 || r > rounds[i - 1]))) throw bad('rounds must be increasing track counts.');
  const plan: SessionPlan = s.plan ?? { explore: { name: 'explore', settings: {} }, memory: [{ name: 'memory', settings: {} }], dry_s: 300, giveUp_s: 600 };
  return {
    sources: s.sources.map((x) => path.resolve(dir, x)), wiring, robot: path.resolve(dir, s.robot), defines, operator, plan, base,
    params: s.params, setDir: path.resolve(dir, s.set), part: s.part ?? 'tune', mode, seconds, rounds,
    samples: Math.max(1, Math.min(5000, Math.round(s.samples ?? 40))), keep: Math.max(0.05, Math.min(0.9, s.keep ?? 0.34)),
    seed: s.seed ?? 1, variation: Math.max(0, Math.min(2, Math.round(s.variation ?? 0))),
  };
}
export type Space = ReturnType<typeof loadSpace>;

// Distinct random combinations of the param values (the first is all first values, a reference point).
export function sampleConfigs(sp: Space, n: number): Record<string, number>[] {
  const keys = Object.keys(sp.params);
  const total = keys.reduce((a, k) => a * sp.params[k].length, 1);
  const rng = new Rng(sp.seed * 7919 + 13);
  const seen = new Set<string>(), out: Record<string, number>[] = [];
  const add = (c: Record<string, number>) => { const k = JSON.stringify(c); if (!seen.has(k)) { seen.add(k); out.push(c); } };
  add(Object.fromEntries(keys.map((k) => [k, sp.params[k][0]])));
  for (let tries = 0; out.length < Math.min(n, total) && tries < n * 50; tries += 1) {
    add(Object.fromEntries(keys.map((k) => [k, sp.params[k][Math.floor(rng.next() * sp.params[k].length)]])));
  }
  return out;
}

export interface Ranked { cfg: number; values: Record<string, number>; tried: number; finished: number; rate: number; meanTime: number | null; meanDist: number }
export function rank(cfgs: Record<string, number>[], results: SearchResult[]): Ranked[] {
  return cfgs.map((values, cfg) => {
    const r = results.filter((x) => x.cfg === cfg);
    const fin = r.filter((x) => x.finished);
    const times = fin.map((x) => x.time_s ?? 0);
    return { cfg, values, tried: r.length, finished: fin.length, rate: r.length ? fin.length / r.length : 0,
      meanTime: times.length ? +(times.reduce((a, b) => a + b, 0) / times.length).toFixed(1) : null,
      meanDist: r.length ? +(r.reduce((a, x) => a + x.dist_m, 0) / r.length).toFixed(1) : 0 };
  }).filter((x) => x.tried > 0).sort((a, b) => b.rate - a.rate || (a.meanTime ?? 1e9) - (b.meanTime ?? 1e9));
}

async function pool(jobs: SearchJob[], workers: number, onResult: (r: SearchResult) => void): Promise<void> {
  if (workers === 0) { for (const j of jobs) onResult(await runSearchJob(j)); return; }
  await new Promise<void>((resolve, reject) => {
    let next = 0, live = 0;
    const start = () => {
      const w = new Worker(new URL('./searchWorker.ts', import.meta.url), { execArgv: ['--import', 'tsx'] });
      live += 1;
      const feed = () => { if (next < jobs.length) w.postMessage(jobs[next++]); else { w.terminate(); live -= 1; if (live === 0) resolve(); } };
      w.on('message', (r: SearchResult) => { onResult(r); feed(); });
      w.on('error', reject);
      feed();
    };
    for (let k = 0; k < Math.min(workers, jobs.length); k += 1) start();
    if (!jobs.length) resolve();
  });
}

export async function runSearch(sp: Space, outDir: string, o: { workers?: number; samples?: number; log?: (s: string) => void } = {}) {
  const log = o.log ?? (() => {});
  fs.mkdirSync(outDir, { recursive: true });
  const cfgs = sampleConfigs(sp, o.samples ?? sp.samples);
  const set = loadTrackSet(sp.setDir);
  const tracks = set.entries.filter((e) => e.part === sp.part);
  if (tracks.length < sp.rounds[sp.rounds.length - 1]) log(`note: the set has ${tracks.length} ${sp.part} tracks; rounds are capped to that.\n`);
  const exes = cfgs.map((c) => buildFirmware(sp.sources, { defines: ['LFSIM_FAST_IO', ...sp.defines, ...Object.entries({ ...sp.base, ...c }).map(([k, v]) => `${k}=${v}`)] }).exe);
  const results: SearchResult[] = [];
  const stream = fs.createWriteStream(path.join(outDir, 'results.jsonl'));
  let alive = cfgs.map((_, i) => i);
  let done = 0;
  const workers = o.workers ?? Math.max(1, os.availableParallelism() - 1);
  const t0 = Date.now();
  for (let r = 0; r < sp.rounds.length && alive.length; r += 1) {
    const from = r === 0 ? 0 : Math.min(tracks.length, sp.rounds[r - 1]), to = Math.min(tracks.length, sp.rounds[r]);
    const jobs: SearchJob[] = [];
    for (const cfg of alive) for (const entry of tracks.slice(from, to)) {
      jobs.push({ id: jobs.length, cfg, exe: exes[cfg], wiring: sp.wiring, robotFile: sp.robot, setDir: sp.setDir, entry, mode: sp.mode, seconds: sp.seconds, variation: sp.variation, operator: sp.operator, plan: sp.plan });
    }
    log(`round ${r + 1}: ${alive.length} variants × ${to - from} new tracks = ${jobs.length} ${sp.mode}s\n`);
    await pool(jobs, workers, (res) => {
      results.push(res); stream.write(JSON.stringify(res) + '\n'); done += 1;
      if (done % 10 === 0) log(`  ${done} done, ${((Date.now() - t0) / 60000).toFixed(1)} min\n`);
    });
    const ranked = rank(cfgs, results).filter((x) => alive.includes(x.cfg));
    writeBoard(outDir, sp, rank(cfgs, results));
    if (r < sp.rounds.length - 1) alive = ranked.slice(0, Math.max(1, Math.ceil(ranked.length * sp.keep))).map((x) => x.cfg);
    log(`  best so far: ${fmt(ranked[0])}\n`);
  }
  stream.end();
  const board = rank(cfgs, results);
  return { board, results, minutes: (Date.now() - t0) / 60000 };
}

const fmt = (x?: Ranked) => x ? `${x.finished}/${x.tried} finished (${(x.rate * 100).toFixed(0)} %), mean time ${x.meanTime ?? '—'} s, ${Object.entries(x.values).map(([k, v]) => `${k}=${v}`).join(' ')}` : '—';

function writeBoard(outDir: string, sp: Space, board: Ranked[]) {
  const keys = Object.keys(sp.params);
  const csv = ['rank,finished,tried,rate,mean_time_s,mean_dist_m,' + keys.join(','), ...board.map((b, i) => [i + 1, b.finished, b.tried, b.rate.toFixed(3), b.meanTime ?? '', b.meanDist, ...keys.map((k) => b.values[k])].join(','))];
  fs.writeFileSync(path.join(outDir, 'leaderboard.csv'), csv.join('\n') + '\n');
  const best = board[0];
  if (best) fs.writeFileSync(path.join(outDir, 'best.json'), JSON.stringify({ finished: best.finished, tried: best.tried, rate: best.rate, meanTime_s: best.meanTime, defines: { ...sp.base, ...best.values } }, null, 2));
}
export { fmt as formatRanked };
