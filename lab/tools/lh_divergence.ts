// Where does the robot's wall following first differ from the ideal one? (run the firmware with ORDER=6 or 7 first)
// npx tsx lab/tools/lh_divergence.ts <track id> <run dir> [left|right]
import fs from 'node:fs';
import { loadTrackSet, loadSetTrack } from '../src/tracksets';
import { buildGraph, runRule } from '../../src/track/graph';
const [id, dir, hand = 'left'] = process.argv.slice(2);
const SET = new URL('../tracksets/rr-2027', import.meta.url).pathname;
const m = loadTrackSet(SET);
const t = loadSetTrack(SET, m.entries.find((e) => e.id === id)!, 127);
const g = buildGraph(t);
const run = runRule(g, hand === 'right' ? 'right' : 'left');
const ideal: number[] = g.start !== null ? [g.start] : [];
for (const r of run.route) { const e = g.edges[r.edge]; const n = r.dir > 0 ? e.b : e.a; ideal.push(n); }
// A dead-end stub shorter than the sensor arm cannot be entered by a spinning robot; skipping it reaches the same next
// junction, so the excursion J -> stub -> J is left out of the ideal route.
for (let i = 1; i + 1 < ideal.length; i += 1) {
  const a = g.nodes.get(ideal[i - 1])!, s = g.nodes.get(ideal[i])!;
  if (s.degree === 1 && ideal[i + 1] === ideal[i - 1] && Math.hypot(a.x - s.x, a.y - s.y) < 0.13) { ideal.splice(i, 2); i -= 1; }
}
const rows = fs.readFileSync(`${dir}/${id}.csv`, 'utf8').trim().split('\n').slice(1).map((l) => l.split(',').map(Number));
const nodes = [...g.nodes.values()];
const seen: { n: number; t: number }[] = [];
for (let i = 0; i < rows.length; i += 5) {
  const [time, x, y] = rows[i];
  let best = -1, bd = 0.05;
  for (const n of nodes) { const d = Math.hypot(n.x - x, n.y - y); if (d < bd) { bd = d; best = n.id; } }
  if (best >= 0 && (!seen.length || seen[seen.length - 1].n !== best)) seen.push({ n: best, t: time });
}
// Leave out short dead-end excursions (entered or skipped) on both sides; only real wrong turns count.
const prune = (seq: number[]) => {
  const out: number[] = [];
  for (const n of seq) {
    const p = g.nodes.get(n)!, last = out.length ? g.nodes.get(out[out.length - 1])! : null;
    if (p.degree === 1 && last && Math.hypot(p.x - last.x, p.y - last.y) < 0.2) continue;
    if (out.length && out[out.length - 1] === n) continue;
    out.push(n);
  }
  return out;
};
const idealP = prune(ideal);
const seenP: { n: number; t: number }[] = [];
for (const s of seen) {
  const p = g.nodes.get(s.n)!, last = seenP.length ? g.nodes.get(seenP[seenP.length - 1].n)! : null;
  if (p.degree === 1 && last && Math.hypot(p.x - last.x, p.y - last.y) < 0.2) continue;
  if (seenP.length && seenP[seenP.length - 1].n === s.n) continue;
  seenP.push(s);
}
ideal.length = 0; ideal.push(...idealP); seen.length = 0; seen.push(...seenP);
let k = 0;
for (; k < Math.min(ideal.length, seen.length); k += 1) if (ideal[k] !== seen[k].n) break;
const at = (n: number) => { const p = g.nodes.get(n)!; return `node ${n} (${p.x.toFixed(2)}, ${p.y.toFixed(2)}, degree ${p.degree})`; };
console.log(`ideal ${hand}-hand route: ${ideal.length} nodes, ${run.ok ? 'reaches' : 'does not reach'} the finish; robot matched the first ${k}`);
if (k < seen.length && k < ideal.length) console.log(`first difference at t=${seen[k].t.toFixed(1)} s: after ${k ? at(ideal[k - 1]) : "the start"} the robot went to ${at(seen[k].n)}, ideal ${at(ideal[k])}`);
