// Benchmark: run a design over a track set (one part) × variations, on all CPU cores, and summarise.
import os from 'node:os';
import { Worker } from 'node:worker_threads';
import type { Competition } from './competition';
import type { Design } from './design';
import { loadTrackSet, type Part } from './tracksets';
import { runJob, type Job, type JobResult } from './benchJob';
import { VARIATIONS } from './variations';
import { buildFirmware } from './native';

export interface BenchOptions {
  setDir: string; part: Part; design: Design; competition: Competition;
  variations: number;        // how many of VARIATIONS to use (1–3)
  limit?: number;            // first N tracks of the part (quick checks)
  workers?: number;          // default: CPU cores − 1 (at least 1); 0 = run in this thread
  onProgress?: (done: number, total: number, last: JobResult) => void;
}

export async function runBench(o: BenchOptions): Promise<JobResult[]> {
  const m = loadTrackSet(o.setDir);
  let entries = m.entries.filter((e) => e.part === o.part);
  if (o.limit) entries = entries.slice(0, o.limit);
  if (!entries.length) throw new Error(`The set has no ${o.part} tracks.`);
  const nv = Math.max(1, Math.min(VARIATIONS.length, Math.round(o.variations)));
  // Native firmware: compile once here (cached by source hash); the workers only start the built program.
  if (o.design.firmware && !o.design.firmware.exe) o.design.firmware.exe = buildFirmware(o.design.firmware.sources, { defines: o.design.firmware.defines }).exe;
  const jobs: Job[] = [];
  for (const entry of entries) for (let v = 0; v < nv; v += 1) jobs.push({ jobId: jobs.length, setDir: o.setDir, entry, variation: v, design: o.design, competition: o.competition });
  const results: JobResult[] = new Array(jobs.length);
  let done = 0;
  const nw = o.workers ?? Math.max(1, os.availableParallelism() - 1);
  if (nw === 0) {
    for (const j of jobs) { const r = await runJob(j); results[r.jobId] = r; done += 1; o.onProgress?.(done, jobs.length, r); }
    return results;
  }
  await new Promise<void>((resolve, reject) => {
    let next = 0;
    const pool: Worker[] = [];
    const feed = (w: Worker) => { if (next < jobs.length) w.postMessage(jobs[next++]); };
    for (let k = 0; k < Math.min(nw, jobs.length); k += 1) {
      const w = new Worker(new URL('./benchWorker.ts', import.meta.url), { execArgv: ['--import', 'tsx'] });
      w.on('message', (r: JobResult) => {
        results[r.jobId] = r; done += 1; o.onProgress?.(done, jobs.length, r);
        if (done === jobs.length) { for (const p of pool) void p.terminate(); resolve(); } else feed(w);
      });
      w.on('error', (e) => { for (const p of pool) void p.terminate(); reject(e); });
      pool.push(w);
      feed(w);
    }
  });
  return results;
}

// ---------------------------------------------------------------- summary

export interface BenchSummary {
  sessions: number; finished: number; errors: number;
  finishRate: number; finishRateCI95: [number, number];
  officialTime_s: { median: number | null; p10: number | null; p90: number | null; mean: number | null };
  firstFinish_s: { median: number | null };
  offLinePerValidRun: number; restartsPerSession: number; adjustmentsPerSession: number;
  checkpointsWithoutFinish: Record<string, number>; // sessions without a finish, by furthest checkpoint C (0 = none)
  byVariation: { name: string; sessions: number; finishRate: number; medianOfficial_s: number | null }[];
  byStyle: { style: string; sessions: number; finishRate: number; medianOfficial_s: number | null }[]; // variation (easy/normal/hard), route, novel
  byFeature: { feature: string; sessions: number; finishRate: number }[];
  failures: Record<string, number>; // how sessions without a valid time ended their runs
  wall_s: number; sessionsPerMinute: number;
}

const quant = (xs: number[], q: number) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const p = (s.length - 1) * q; const i = Math.floor(p); return +(s[i] + (s[Math.min(s.length - 1, i + 1)] - s[i]) * (p - i)).toFixed(3); };
// Wilson score interval for a proportion.
export function wilson(k: number, n: number, z = 1.96): [number, number] {
  if (!n) return [0, 0];
  const p = k / n, d = 1 + (z * z) / n, c = (p + (z * z) / (2 * n)) / d, h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [+Math.max(0, c - h).toFixed(4), +Math.min(1, c + h).toFixed(4)];
}

export function summarise(results: JobResult[], o: { setDir: string; part: Part }, wall_s: number): BenchSummary {
  const m = loadTrackSet(o.setDir);
  const byId = new Map(m.entries.map((e) => [e.id, e]));
  const ok = results.filter((r) => r.result);
  const fin = ok.filter((r) => r.result!.finished);
  const times = fin.map((r) => r.result!.officialTime_s!);
  const validRuns = ok.flatMap((r) => r.result!.runs.filter((x) => x.score_s !== null));
  const failures: Record<string, number> = {};
  for (const r of ok.filter((x) => !x.result!.finished)) for (const run of r.result!.runs) failures[run.end] = (failures[run.end] ?? 0) + 1;
  const feats = new Set<string>();
  for (const e of m.entries) for (const f of Object.keys(e.features)) if (f !== 'straight' && f !== 'diagonal') feats.add(f);
  feats.add('diagonal');
  return {
    sessions: results.length, finished: fin.length, errors: results.length - ok.length,
    finishRate: +(fin.length / Math.max(1, results.length)).toFixed(4), finishRateCI95: wilson(fin.length, results.length),
    officialTime_s: { median: quant(times, 0.5), p10: quant(times, 0.1), p90: quant(times, 0.9), mean: times.length ? +(times.reduce((a, b) => a + b, 0) / times.length).toFixed(3) : null },
    firstFinish_s: { median: quant(fin.map((r) => r.result!.firstFinish_s!), 0.5) },
    offLinePerValidRun: +(validRuns.reduce((a, x) => a + x.offLine, 0) / Math.max(1, validRuns.length)).toFixed(3),
    restartsPerSession: +(ok.reduce((a, r) => a + r.result!.restarts, 0) / Math.max(1, ok.length)).toFixed(3),
    adjustmentsPerSession: +(ok.reduce((a, r) => a + r.result!.adjustments, 0) / Math.max(1, ok.length)).toFixed(3),
    checkpointsWithoutFinish: ok.filter((r) => !r.result!.finished).reduce((acc, r) => { const k = String(Math.max(0, ...r.result!.runs.filter((x) => x.period === 'actual').map((x) => x.checkpoint))); acc[k] = (acc[k] ?? 0) + 1; return acc; }, {} as Record<string, number>),
    byVariation: VARIATIONS.map((v, i) => {
      const rs = results.filter((r) => r.variation === i);
      const f = rs.filter((r) => r.result?.finished);
      return { name: v.name, sessions: rs.length, finishRate: +(f.length / Math.max(1, rs.length)).toFixed(4), medianOfficial_s: quant(f.map((r) => r.result!.officialTime_s!), 0.5) };
    }).filter((x) => x.sessions > 0),
    byStyle: (() => {
      const styleOf = (id: string) => { const e = byId.get(id); return !e ? '?' : e.level === 'route' || e.level === 'novel' ? e.level : `variation (${e.level})`; };
      const names = [...new Set(results.map((r) => styleOf(r.trackId)))].sort();
      return names.map((name) => {
        const rs = results.filter((r) => styleOf(r.trackId) === name), f = rs.filter((r) => r.result?.finished);
        return { style: name, sessions: rs.length, finishRate: +(f.length / Math.max(1, rs.length)).toFixed(4), medianOfficial_s: quant(f.map((r) => r.result!.officialTime_s!), 0.5) };
      });
    })(),
    byFeature: [...feats].sort().map((f) => {
      const rs = results.filter((r) => ((byId.get(r.trackId)?.features as Record<string, number> | undefined)?.[f] ?? 0) > 0);
      return { feature: f, sessions: rs.length, finishRate: +(rs.filter((r) => r.result?.finished).length / Math.max(1, rs.length)).toFixed(4) };
    }).filter((x) => x.sessions > 0),
    failures,
    wall_s: +wall_s.toFixed(1), sessionsPerMinute: +((results.length / Math.max(1e-9, wall_s)) * 60).toFixed(1),
  };
}
