// Track sets: generated tracks saved as PNG images plus a manifest, split into a tuning part and a held-out part that
// never share a seed. The final numbers of any design come from the held-out part only.
import fs from 'node:fs';
import os from 'node:os';
import { Worker } from 'node:worker_threads';
import path from 'node:path';
import { PNG } from 'pngjs';
import { processTrack, startPoseFor } from '../../src/track/importTrack';
import { PRESETS, type Track } from '../../src/track/track';
import { DEFAULT_PROFILE } from '../../src/sim/profile';
import { buildGraph } from '../../src/track/graph';
import type { Feature } from '../../src/track/generate';
import type { Competition } from './competition';
import type { Checkpoint } from './session';
import { generateTrack, checkTrack, type TrackCheck } from './tracks';
import { trackStats, type TrackStats } from './stats';

export const GENERATOR_VERSION = 2; // 2: Robo-Run 2027 (4 m mat), finish mostly at the far end, checkpoints // bump when the generator's output for a seed changes
export const HELD_OUT_SEED_BASE = 1_000_000; // held-out seeds start here; tuning seeds start at 1

export type Part = 'tune' | 'held';
export interface SetEntry {
  id: string;               // e.g. tune-0001
  part: Part;
  seed: number;             // generator seed (the sub-seed that passed the checks)
  file: string;             // PNG, relative to the set folder
  size_m: number;           // mat side
  lineWidth_cm: number;
  checkpoints: Checkpoint[];
  corner: string;
  features: Partial<Record<Feature, number>>;
  check: TrackCheck;
  stats: TrackStats;
}
export interface TrackSetManifest {
  schema: 'lfsim-lab/trackset';
  version: 1;
  name: string;
  generatorVersion: number;
  competition: string;
  created: string;
  entries: SetEntry[];
}

export function writePng(file: string, gray: Uint8ClampedArray, w: number, h: number) {
  const png = new PNG({ width: w, height: h });
  for (let i = 0; i < w * h; i += 1) { png.data[i * 4] = png.data[i * 4 + 1] = png.data[i * 4 + 2] = gray[i]; png.data[i * 4 + 3] = 255; }
  fs.writeFileSync(file, PNG.sync.write(png, { colorType: 0, inputColorType: 6 }));
}

export interface TrackJob { part: Part; k: number; seed: number; dir: string; competition: Competition }

// Generate one track of a set and save its PNG (runs on a worker thread when the set is made in parallel).
export function makeOne(j: TrackJob): SetEntry {
  const t = generateTrack(j.seed, j.competition);
  const id = `${j.part}-${String(j.k + 1).padStart(4, '0')}`;
  const file = `tracks/${id}.png`;
  writePng(path.join(j.dir, file), t.gray, t.track.w, t.track.h);
  return {
    id, part: j.part, seed: t.subSeed, file, size_m: t.maze.size_m, checkpoints: t.checkpoints,
    lineWidth_cm: +(t.maze.lineWidth_m * 100).toFixed(2), corner: t.maze.corner, features: t.maze.features, check: t.check, stats: trackStats(t.track, t.graph),
  };
}

export async function makeTrackSet(dir: string, name: string, c: Competition, counts: { tune: number; held: number }, onProgress?: (done: number, total: number) => void, workers = Math.max(1, os.availableParallelism() - 1)): Promise<TrackSetManifest> {
  fs.mkdirSync(path.join(dir, 'tracks'), { recursive: true });
  const jobs: TrackJob[] = [
    ...Array.from({ length: counts.tune }, (_, k) => ({ part: 'tune' as Part, k, seed: 1 + k, dir, competition: c })),
    ...Array.from({ length: counts.held }, (_, k) => ({ part: 'held' as Part, k, seed: HELD_OUT_SEED_BASE + 1 + k, dir, competition: c })),
  ];
  const entries: SetEntry[] = new Array(jobs.length);
  let done = 0;
  if (workers <= 0 || jobs.length < 2) {
    jobs.forEach((j, i) => { entries[i] = makeOne(j); onProgress?.(++done, jobs.length); });
  } else {
    await new Promise<void>((resolve, reject) => {
      let next = 0;
      const pool: Worker[] = [];
      const feed = (w: Worker) => { if (next < jobs.length) { const i = next++; w.postMessage({ i, job: jobs[i] }); } };
      for (let k = 0; k < Math.min(workers, jobs.length); k += 1) {
        const w = new Worker(new URL('./trackWorker.ts', import.meta.url), { execArgv: ['--import', 'tsx'] });
        w.on('message', (m: { i: number; entry?: SetEntry; error?: string }) => {
          if (m.error) { for (const p of pool) void p.terminate(); reject(new Error(m.error)); return; }
          entries[m.i] = m.entry!; onProgress?.(++done, jobs.length);
          if (done === jobs.length) { for (const p of pool) void p.terminate(); resolve(); } else feed(w);
        });
        w.on('error', (e) => { for (const p of pool) void p.terminate(); reject(e); });
        pool.push(w); feed(w);
      }
    });
  }
  const m: TrackSetManifest = { schema: 'lfsim-lab/trackset', version: 1, name, generatorVersion: GENERATOR_VERSION, competition: c.id, created: new Date().toISOString(), entries };
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(m, null, 1));
  return m;
}

export function loadTrackSet(dir: string): TrackSetManifest {
  const file = path.join(dir, 'manifest.json');
  if (!fs.existsSync(file)) throw new Error(`${dir} is not a track set (no manifest.json). Make one with: npm run lab -- tracks make --out ${dir}`);
  if (fs.statSync(file).size > 50 * 1024 * 1024) throw new Error('Track set manifest too large.');
  const m = JSON.parse(fs.readFileSync(file, 'utf8')) as TrackSetManifest;
  if (m.schema !== 'lfsim-lab/trackset' || m.version !== 1 || !Array.isArray(m.entries)) throw new Error(`${file}: not a version-1 track set manifest.`);
  if (m.generatorVersion !== GENERATOR_VERSION) throw new Error(`${file}: made by generator version ${m.generatorVersion}; this build is version ${GENERATOR_VERSION}. Make a new set.`);
  for (const e of m.entries) {
    if (typeof e.id !== 'string' || !/^(tune|held)-\d{4}$/.test(e.id) || (e.part !== 'tune' && e.part !== 'held')) throw new Error(`${file}: bad entry id or part.`);
    if (typeof e.file !== 'string' || !/^tracks\/(tune|held)-\d{4}\.png$/.test(e.file)) throw new Error(`${file}: bad track file name for ${e.id}.`);
    if (!(e.lineWidth_cm >= 1 && e.lineWidth_cm <= 10)) throw new Error(`${file}: bad line width for ${e.id}.`);
    if (!(e.size_m >= 0.5 && e.size_m <= 10)) throw new Error(`${file}: bad mat size for ${e.id}.`);
    if (!Array.isArray(e.checkpoints) || e.checkpoints.length > 20 || !e.checkpoints.every((c) => [c.x, c.y, c.C].every((v) => typeof v === 'number' && Number.isFinite(v)))) throw new Error(`${file}: bad checkpoints for ${e.id}.`);
  }
  // Tuning and held-out tracks must never share a seed (F6).
  const tuneSeeds = new Set(m.entries.filter((e) => e.part === 'tune').map((e) => Math.floor(e.seed / 1000)));
  if (m.entries.some((e) => e.part === 'held' && tuneSeeds.has(Math.floor(e.seed / 1000)))) throw new Error(`${file}: a held-out track shares a seed with a tuning track.`);
  return m;
}

// Load one track of a set exactly as it was generated (2 mm/px, its own line width, start pose from the start square).
export function loadSetTrack(dir: string, e: SetEntry, axleFromFront_mm = DEFAULT_PROFILE.axleFromFront_mm): Track {
  const png = PNG.sync.read(fs.readFileSync(path.join(dir, e.file)));
  const gray = new Uint8ClampedArray(png.width * png.height);
  for (let i = 0; i < gray.length; i += 1) gray[i] = png.data[i * 4];
  const { track } = processTrack(gray, png.width, png.height, { ...PRESETS[0], width_m: e.size_m, height_m: e.size_m, lineWidth_cm: e.lineWidth_cm }, { normaliseWidth: false, imageName: `${e.id}.png` });
  track.startPose = startPoseFor(track, axleFromFront_mm / 1000);
  return track;
}

// Re-check every track of a set (used by the tests and `tracks check`).
export function recheckSet(dir: string, c: Competition, part?: Part): { id: string; problems: string[] }[] {
  const m = loadTrackSet(dir);
  return m.entries.filter((e) => !part || e.part === part).map((e) => { const t = loadSetTrack(dir, e); return { id: e.id, problems: checkTrack(t, buildGraph(t), c).problems }; });
}

// A review sheet for approving a generator version (spec F5): sample tracks with their features, and the set's
// statistics next to the reference maze's.
export function writeSheet(dir: string, count: number, reference: TrackStats | null): string {
  const m = loadTrackSet(dir);
  const pick = m.entries.filter((e) => e.part === 'tune').slice(0, count);
  const keys: (keyof TrackStats)[] = ['lineLength_m', 'junctions', 'junctions4', 'deadEnds', 'cycles', 'curvedShare', 'shortEdges'];
  const all = m.entries.map((e) => e.stats);
  const q = (k: keyof TrackStats, p: number) => { const s = all.map((x) => x[k]).sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))]; };
  const esc = (s: unknown) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  const html = `<!doctype html><meta charset="utf-8"><title>${esc(m.name)} — review</title>
<style>body{font:14px system-ui,sans-serif;margin:24px;color:#1d2433}h1{font-size:20px}table{border-collapse:collapse;margin:8px 0 20px}td,th{padding:4px 10px;border-bottom:1px solid #e3e7ee;text-align:left}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px}figure{margin:0}img{width:100%;border:1px solid #ccd}figcaption{font-size:12px;color:#556}</style>
<h1>${esc(m.name)}: ${pick.length} sample tracks for review</h1>
<p>Generator version ${m.generatorVersion}. Do these look like Robo-Run mazes? Note anything missing or wrong.</p>
<table><tr><th>Statistic</th><th>Set 10 %</th><th>Set median</th><th>Set 90 %</th><th>Reference</th></tr>
${keys.map((k) => `<tr><td>${k}</td><td>${q(k, 0.1)}</td><td>${q(k, 0.5)}</td><td>${q(k, 0.9)}</td><td>${reference ? reference[k] : '—'}</td></tr>`).join('')}</table>
<div class="grid">${pick.map((e) => `<figure><img src="${esc(e.file)}" alt="${esc(e.id)}"><figcaption>${esc(e.id)} · line ${e.lineWidth_cm} cm · ${e.check.junctions} junctions, ${e.check.deadEnds} dead ends, ${e.check.cycles} loops · ${Object.entries(e.features).filter(([f]) => f !== 'straight').map(([f, n]) => `${f} ${n}`).join(', ')}</figcaption></figure>`).join('')}</div>`;
  const file = path.join(dir, 'sheet.html');
  fs.writeFileSync(file, html);
  return file;
}
