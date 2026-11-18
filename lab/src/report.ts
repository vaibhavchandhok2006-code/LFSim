// Results folder for a benchmark: summary.json, benchmark.csv (one row per session), runs.csv (one row per run),
// design.json, report.html (readable report), progress.html (live while running), and LFSim project files that replay
// failed runs in the website.
import fs from 'node:fs';
import path from 'node:path';
import type { BenchSummary } from './bench';
import type { JobResult } from './benchJob';
import { jobSeed } from './benchJob';
import type { Design } from './design';
import type { Competition } from './competition';
import { loadTrackSet, type Part } from './tracksets';
import { VARIATIONS, ALL_ON, disturbancesFor } from './variations';
import { DEFAULTS, DEFAULT_TRACK_SETUP, type ProjectFile } from '../../src/ui/persist';
import { Rng } from '../../src/sim/sensors';
import { loadSetTrack } from './tracksets';

const esc = (s: unknown) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const csvCell = (v: unknown) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const pct = (x: number) => `${(x * 100).toFixed(1)} %`;
const sec = (x: number | null) => (x === null ? '—' : `${x.toFixed(2)} s`);

const CSS = `body{font:15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;max-width:980px;margin:32px auto;padding:0 20px;color:#1d2433;background:#fafbfc}
h1{font-size:24px;margin:0 0 4px}h2{font-size:18px;margin:28px 0 8px;border-bottom:1px solid #d9dee7;padding-bottom:4px}
.meta{color:#5b6475;font-size:13px}.big{display:flex;gap:28px;flex-wrap:wrap;margin:16px 0}.big div{min-width:160px}
.big b{display:block;font-size:28px}.big span{color:#5b6475;font-size:13px}table{border-collapse:collapse;width:100%;font-size:14px}
th,td{text-align:left;padding:5px 8px;border-bottom:1px solid #e6e9ef}th{color:#5b6475;font-weight:600}
.bar{height:10px;background:#e6e9ef;border-radius:5px;overflow:hidden;width:180px;display:inline-block;vertical-align:middle}
.bar i{display:block;height:100%;background:#2a7a5a}.warn{background:#fff6e0;border:1px solid #f0d58c;padding:10px 14px;border-radius:6px}
code{background:#eef1f5;padding:1px 4px;border-radius:3px}`;

export function writeResults(dir: string, o: {
  results: JobResult[]; summary: BenchSummary; design: Design; competition: Competition; setDir: string; part: Part; variations: number; command: string;
}) {
  fs.mkdirSync(path.join(dir, 'projects'), { recursive: true });
  const { results, summary: s, design } = o;
  const m = loadTrackSet(o.setDir);
  fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify({ ...s, set: m.name, part: o.part, design: design.name, command: o.command }, null, 2));
  fs.writeFileSync(path.join(dir, 'design.json'), JSON.stringify(design, null, 2));
  const bench = [['track', 'variation', 'finished', 'official_time_s', 'first_finish_s', 'runs', 'restarts', 'closest_to_finish_m', 'error'].join(',')];
  const runs = [['track', 'variation', 'run', 'switch', 'phase', 'begin_s', 'end', 'elapsed_s', 'run_time_s', 'off_line', 'restarts_before', 'score_s', 'x_m', 'y_m', 'note'].join(',')];
  for (const r of results) {
    const x = r.result;
    bench.push([r.trackId, VARIATIONS[r.variation].name, x?.finished ?? '', x?.officialTime_s ?? '', x?.firstFinish_s ?? '', x?.runs.length ?? '', x?.restarts ?? '', x?.closestToFinish_m ?? '', r.error ?? ''].map(csvCell).join(','));
    for (const run of x?.runs ?? []) runs.push([r.trackId, VARIATIONS[r.variation].name, run.index, run.switch, run.phase, run.begin_s, run.end, run.elapsed_s, run.runTime_s, run.offLine, run.restartsBefore, run.score_s, run.where.x, run.where.y, run.note].map(csvCell).join(','));
  }
  fs.writeFileSync(path.join(dir, 'benchmark.csv'), bench.join('\n') + '\n');
  fs.writeFileSync(path.join(dir, 'runs.csv'), runs.join('\n') + '\n');

  // Replays: for up to 20 sessions without a valid time, the first failed run as an LFSim project.
  const failed = results.filter((r) => r.result && !r.result.finished).slice(0, 20);
  const replays: { file: string; track: string; variation: string; run: number; end: string }[] = [];
  for (const r of failed) {
    const run = r.result!.runs.find((x) => x.end !== 'finished' && x.end !== 'session-over');
    if (!run) continue;
    const file = `projects/${r.trackId}-v${r.variation}-run${run.index}.lfsim.json`;
    fs.writeFileSync(path.join(dir, file), JSON.stringify(replayProject(o.setDir, r, run.index, design)));
    replays.push({ file, track: r.trackId, variation: VARIATIONS[r.variation].name, run: run.index, end: run.end });
  }

  const ci = s.finishRateCI95;
  const meets = ci[0] >= 0.95;
  const failRows = Object.entries(s.failures).sort((a, b) => b[1] - a[1]);
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>LFSim Lab — ${esc(design.name)}</title><style>${CSS}</style>
<h1>${esc(design.name)}</h1>
<div class="meta">${esc(m.name)} · ${o.part === 'held' ? 'held-out tracks (never used for tuning)' : o.part === 'novel' ? 'novel-style tracks (a style never used for tuning)' : 'tuning tracks'} · ${s.sessions} full ${o.competition.session.access_s / 60}-minute sessions (${s.sessions / o.variations} tracks × ${o.variations} variation${o.variations > 1 ? 's' : ''}) · ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC</div>
<div class="big">
<div><b>${pct(s.finishRate)}</b><span>sessions with a valid time<br>95 % interval ${pct(ci[0])} – ${pct(ci[1])}</span></div>
<div><b>${sec(s.officialTime_s.median)}</b><span>median official time<br>10–90 %: ${sec(s.officialTime_s.p10)} – ${sec(s.officialTime_s.p90)}</span></div>
<div><b>${sec(s.firstFinish_s.median)}</b><span>median session time to the first finish</span></div>
<div><b>${s.restartsPerSession.toFixed(2)}</b><span>restarts per session<br>${s.adjustmentsPerSession.toFixed(2)} adjustments (switch changes)</span></div>
</div>
<p class="${meets ? '' : 'warn'}">${meets ? 'Meets the target (≥ 95 % of sessions finish, lower end of the 95 % interval).' : `Below the target of 95 % of sessions finishing${s.finishRate >= 0.95 ? ' (the rate is above 95 % but the interval reaches below it: more tracks would settle it)' : ''}.`}
Not calibrated against the real robot yet: the simulator's numbers are estimates until Phase 3.</p>
<h2>By variation</h2><table><tr><th>Variation</th><th>Sessions</th><th>Finish rate</th><th>Median official time</th></tr>
${s.byVariation.map((v) => `<tr><td>${esc(v.name)}</td><td>${v.sessions}</td><td><span class="bar"><i style="width:${v.finishRate * 100}%"></i></span> ${pct(v.finishRate)}</td><td>${sec(v.medianOfficial_s)}</td></tr>`).join('')}</table>
<h2>By maze style</h2><p class="meta">Variations of the real maze (easy / normal / hard), generated route-style mazes, and novel-style mazes (never used for tuning).</p><table><tr><th>Style</th><th>Sessions</th><th>Finish rate</th><th>Median official time</th></tr>
${s.byStyle.map((v) => `<tr><td>${esc(v.style)}</td><td>${v.sessions}</td><td><span class="bar"><i style="width:${v.finishRate * 100}%"></i></span> ${pct(v.finishRate)}</td><td>${sec(v.medianOfficial_s)}</td></tr>`).join('')}</table>
<h2>By track feature</h2><p class="meta">Finish rate over sessions on tracks that contain the feature.</p><table><tr><th>Feature</th><th>Sessions</th><th>Finish rate</th></tr>
${s.byFeature.map((v) => `<tr><td>${esc(v.feature)}</td><td>${v.sessions}</td><td><span class="bar"><i style="width:${v.finishRate * 100}%"></i></span> ${pct(v.finishRate)}</td></tr>`).join('')}</table>
${Object.keys(s.checkpointsWithoutFinish).length ? `<h2>Sessions without a finish: furthest checkpoint</h2><p class="meta">Such a session scores (time + penalties) ÷ C for its furthest checkpoint (C = 0: none reached; checkpoints assumed at 25 / 50 / 75 % of the shortest route).</p><table><tr><th>Furthest checkpoint C</th><th>Sessions</th></tr>${Object.entries(s.checkpointsWithoutFinish).sort().map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}</table>` : ''}
<h2>Why sessions failed</h2>${failRows.length ? `<p class="meta">How the runs ended in sessions without a valid time.</p><table><tr><th>Run ended by</th><th>Runs</th></tr>${failRows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${v}</td></tr>`).join('')}</table>` : '<p>Every session reached the finish.</p>'}
${replays.length ? `<h2>Replay a failed run</h2><p class="meta">Open a file below in the LFSim website (Save / Open → Open project). It holds the track, robot, settings, the run's start position and the robot's memory at that moment. Press Run, or Memory run for a run from the memory phase.</p><table><tr><th>File</th><th>Track</th><th>Variation</th><th>Run</th><th>Ended by</th></tr>${replays.map((p) => `<tr><td><code>${esc(p.file)}</code></td><td>${esc(p.track)}</td><td>${esc(p.variation)}</td><td>${p.run}</td><td>${esc(p.end)}</td></tr>`).join('')}</table>` : ''}
<h2>Design</h2><table><tr><th>Robot</th><td>${esc(design.robot.name)}</td></tr><tr><th>Algorithm</th><td>${esc(design.settings.algorithm)}</td></tr>
<tr><th>Explore</th><td>${esc(design.plan.explore.name)}</td></tr><tr><th>Memory ladder</th><td>${design.plan.memory.map((x) => esc(x.name)).join(' → ')}</td></tr>
<tr><th>Off-line per valid run</th><td>${s.offLinePerValidRun}</td></tr></table>
<h2>How this was measured</h2><p>Rules: ${esc(o.competition.name)}, ${o.competition.round} round. Each session plays the ${o.competition.session.access_s / 60} minutes of maze access${design.plan.dry_s && o.competition.session.dryRunAllowed ? `: a ${design.plan.dry_s} s dry run (not scored) to explore, then scored actual runs` : ', every run scored'}. Exploration runs continue until the robot holds a route, then memory runs move to a faster switch setting after each success and back after a failure. Re-entering the start square aborts a run (restart); the operator also stops runs that stop away from the finish, leave the mat, make no progress for ${o.competition.operator.stuckWindow_s} s or take over ${o.competition.operator.giveUpAfter_s} s. Placing, fetching and switching take ${o.competition.operator.setup_s} s, ${o.competition.operator.retrieve_s} s and ${o.competition.operator.switchChange_s} s (estimates).
Time score = run time + ${o.competition.scoring.offLine_s !== null ? `${o.competition.scoring.offLine_s} s` : `run time ÷ ${o.competition.scoring.offLineDivisor}`} per line crossing + ${o.competition.scoring.restart_s} s per restart + ${o.competition.scoring.adjustment_s} s per adjustment${o.competition.scoring.switchChangeIsAdjustment ? ' (each switch change in the scored part is one)' : ''}. ${s.errors ? `<b>${s.errors} sessions ended with an error</b> (see benchmark.csv).` : ''}</p>
<p class="meta">${s.sessions} sessions in ${s.wall_s} s (${s.sessionsPerMinute} per minute). Command: <code>${esc(o.command)}</code>. Files: summary.json, benchmark.csv, runs.csv, design.json.</p>
</html>`;
  fs.writeFileSync(path.join(dir, 'report.html'), html);
}

// A project file that replays one run of a benchmark session in the website: same track, robot, settings, mat
// variation, start position (with that run's placement jitter) and the robot's memory when the run began.
function replayProject(setDir: string, r: JobResult, runIndex: number, design: Design): ProjectFile {
  const m = loadTrackSet(setDir);
  const e = m.entries.find((x) => x.id === r.trackId)!;
  const track = loadSetTrack(setDir, e, design.robot.axleFromFront_mm);
  const seed = jobSeed(e, r.variation);
  // Same placement jitter sequence as the session (two gauss draws + one per run).
  const rng = new Rng((seed >>> 0) * 2246822519 + 3);
  let jit = { x: 0, y: 0, th: 0 };
  for (let k = 0; k <= runIndex; k += 1) jit = { x: rng.gauss() * 0.004, y: rng.gauss() * 0.004, th: (rng.gauss() * 2 * Math.PI) / 180 };
  const run = r.result!.runs[runIndex];
  const sw = run.phase === 'explore' ? design.plan.explore : design.plan.memory.find((x) => x.name === run.switch) ?? design.plan.memory[0];
  const png = fs.readFileSync(path.join(setDir, e.file));
  const sp = track.startPose;
  const settings = structuredClone(DEFAULTS);
  settings.profile = design.robot;
  settings.settings = { ...design.settings, ...sw.settings };
  settings.flags = ALL_ON;
  settings.disturbances = disturbancesFor(VARIATIONS[r.variation], seed);
  settings.brainMode = 'settings';
  settings.track = { ...DEFAULT_TRACK_SETUP, presetId: 'custom', custom: { width_m: e.size_m, height_m: e.size_m, lineWidth_cm: e.lineWidth_cm, maxRobotL_mm: 200, maxRobotW_mm: 200 }, normaliseWidth: false, imageName: `${e.id}.png`, poseOverride: { x: sp.x + jit.x, y: sp.y + jit.y, theta: sp.theta + jit.th } };
  return { lfsim: 'project', version: 1, settings, trackImage: `data:image/png;base64,${png.toString('base64')}`, runs: [], memory: run.phase === 'memory' ? sessionMemory(r) : null };
}

// Memory runs replay with the route the robot found (its memory does not change once the route is complete).
function sessionMemory(r: JobResult): Record<string, unknown> | null { return r.result?.memory ?? null; }

export function writeProgress(dir: string, p: { done: number; total: number; finished: number; started: number; title: string }) {
  const el = (Date.now() - p.started) / 1000;
  const eta = p.done ? (el / p.done) * (p.total - p.done) : 0;
  const html = `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="3"><title>${p.done}/${p.total} — LFSim Lab</title><style>${CSS}</style>
<h1>${esc(p.title)}</h1><div class="big"><div><b>${p.done} / ${p.total}</b><span>sessions done</span></div><div><b>${p.done ? pct(p.finished / p.done) : '—'}</b><span>finish rate so far</span></div><div><b>${Math.round(el)} s</b><span>elapsed · about ${Math.round(eta)} s left</span></div></div>
<span class="bar" style="width:100%"><i style="width:${(p.done / p.total) * 100}%"></i></span><p class="meta">This page reloads every 3 s. The report appears as report.html in this folder when the run ends.</p>`;
  fs.writeFileSync(path.join(dir, 'progress.html'), html);
}
