// Generated Robo-Run tracks: generate → draw → import exactly like a track image → check against the rulebook.
import { generateMaze, renderMaze, type GeneratedMaze, type GenOptions } from '../../src/track/generate';
import { processTrack, startPoseFor } from '../../src/track/importTrack';
import { PRESETS, type Track } from '../../src/track/track';
import { adjacency, buildGraph, runRule, shortestPath, type JunctionGraph } from '../../src/track/graph';
import { DEFAULT_PROFILE } from '../../src/sim/profile';
import type { Competition } from './competition';
import type { Checkpoint } from './session';

export interface TrackCheck {
  ok: boolean;
  problems: string[];
  shortest_m: number | null;
  leftHand: { reaches: boolean; length_m: number };
  rightHand: { reaches: boolean; length_m: number };
  junctions: number;      // graph nodes with 3+ lines
  deadEnds: number;       // line ends other than start and finish
  cycles: number;         // independent loops (edges − nodes + 1)
}

export interface GeneratedTrack { maze: GeneratedMaze; track: Track; graph: JunctionGraph; check: TrackCheck; gray: Uint8ClampedArray; checkpoints: Checkpoint[] }

// Checkpoints (2027 rules): their places and values are told at the start of a match. Assumption: three, on the
// shortest route at 25 %, 50 % and 75 % of its length, worth C = 1, 2, 3 (the nearer the destination, the higher).
export function checkpointsFor(g: JunctionGraph): Checkpoint[] {
  const sp = shortestPath(g);
  if (!sp.ok) return [];
  const pts: [number, number][] = [];
  for (const r of sp.route) {
    const e = g.edges[r.edge];
    const p = r.dir > 0 ? e.pts : [...e.pts].reverse();
    for (const q of p) pts.push([q[0], q[1]]);
  }
  const out: Checkpoint[] = [];
  let acc = 0, k = 0;
  const targets = [0.25, 0.5, 0.75].map((f) => f * sp.length_m);
  for (let i = 1; i < pts.length && k < targets.length; i += 1) {
    acc += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (acc >= targets[k]) { out.push({ x: +pts[i][0].toFixed(3), y: +pts[i][1].toFixed(3), C: k + 1 }); k += 1; }
  }
  return out;
}

// A plain line follower "easily finds" the finish if a wall-following rule reaches it without travelling much more than
// the shortest route. Assumption (the rulebook gives no number): it must need at least this factor.
export const HIDDEN_FACTOR = 1.5;

export function checkTrack(track: Track, g: JunctionGraph, c: Competition): TrackCheck {
  const problems: string[] = [];
  const size = track.w * track.res;
  const want = (c.mat.gridN * c.mat.cell_cm) / 100;
  if (Math.abs(size - want) > 0.005) problems.push(`mat is ${size.toFixed(3)} m, rulebook says ${want} m`);
  if (track.measuredLineWidth_cm < c.mat.lineWidth_cm.min - 0.25 || track.measuredLineWidth_cm > c.mat.lineWidth_cm.max + 0.25) problems.push(`line width ${track.measuredLineWidth_cm.toFixed(2)} cm outside ${c.mat.lineWidth_cm.min}–${c.mat.lineWidth_cm.max} cm`);
  if (!track.start) problems.push('no start square');
  if (!track.finish) problems.push('no finish square');
  if (track.start) {
    const cx = ((track.start.x0 + track.start.x1) / 2) * track.res, cy = ((track.start.y0 + track.start.y1) / 2) * track.res;
    const cell = c.mat.cell_cm / 100;
    const inCorner = (cx < cell || cx > size - cell) && (cy < cell || cy > size - cell);
    if (!inCorner) problems.push('start square is not in a corner cell');
  }
  if (g.start === null) problems.push('no line leaves the start square');
  if (g.finish === null) problems.push('no line reaches the finish square');
  const adj = adjacency(g);
  if (g.finish !== null && (adj.get(g.finish)?.length ?? 0) !== 1) problems.push('the finish has more than one pathway');
  if (g.start !== null && (adj.get(g.start)?.length ?? 0) !== 1) problems.push('the start square has more than one exit');
  const sp = shortestPath(g);
  if (!sp.ok) problems.push('the finish cannot be reached from the start');
  // Everything drawn must be reachable from the start (no stray lines).
  if (g.start !== null) {
    const seen = new Set<number>([g.start]); const q = [g.start];
    while (q.length) { const n = q.pop()!; for (const o of adj.get(n) ?? []) { const e = g.edges[o.edge]; const m = o.dir > 0 ? e.b : e.a; if (!seen.has(m)) { seen.add(m); q.push(m); } } }
    // (Degree-0 nodes are single skeleton dots left by thinning, not lines.)
    const stray = [...g.nodes.values()].filter((n) => n.degree > 0 && !seen.has(n.id)).length;
    if (stray) problems.push(`${stray} line ends or junctions are not connected to the start`);
  }
  // Multiple paths: some edge of the shortest route can be removed and the finish is still reachable.
  let multiple = false;
  if (sp.ok) {
    for (const r of sp.route) {
      const g2: JunctionGraph = { ...g, edges: g.edges.filter((e) => e.id !== r.edge).map((e, i) => ({ ...e, id: i })) };
      if (shortestPath(g2).ok) { multiple = true; break; }
    }
    if (!multiple) problems.push('only one path to the finish');
  }
  const lh = runRule(g, 'left'), rh = runRule(g, 'right');
  const easy = (r: typeof lh) => r.ok && sp.ok && r.length_m < HIDDEN_FACTOR * sp.length_m;
  if (easy(lh) || easy(rh)) problems.push(`a ${easy(lh) ? 'left' : 'right'}-hand wall follower finds the finish easily`);
  let junctions = 0, deadEnds = 0;
  for (const n of g.nodes.values()) { if (n.degree >= 3) junctions += 1; if (n.degree === 1 && n.id !== g.start && n.id !== g.finish) deadEnds += 1; }
  return {
    ok: problems.length === 0, problems,
    shortest_m: sp.ok ? +sp.length_m.toFixed(3) : null,
    leftHand: { reaches: lh.ok, length_m: +lh.length_m.toFixed(3) },
    rightHand: { reaches: rh.ok, length_m: +rh.length_m.toFixed(3) },
    junctions, deadEnds, cycles: g.edges.length - g.nodes.size + 1,
  };
}

// Draw a maze and import it the same way the website imports an image (2 mm/px, line width kept as drawn).
export function trackFromMaze(maze: GeneratedMaze, name: string): { track: Track; gray: Uint8ClampedArray } {
  const { gray, width, height } = renderMaze(maze, 0.002);
  const preset = { ...PRESETS[0], width_m: maze.size_m, height_m: maze.size_m, lineWidth_cm: +(maze.lineWidth_m * 100).toFixed(2) };
  const { track } = processTrack(gray, width, height, preset, { normaliseWidth: false, imageName: name });
  track.startPose = startPoseFor(track, DEFAULT_PROFILE.axleFromFront_mm / 1000);
  return { track, gray };
}

// Generate the maze for a seed; if it breaks a rule, move to the next sub-seed (recorded) until one passes.
export function generateTrack(seed: number, c: Competition, gen: Partial<GenOptions> = {}, maxTries = 80): GeneratedTrack & { subSeed: number; rejected: string[] } {
  const rejected: string[] = [];
  for (let k = 0; k < maxTries; k += 1) {
    const sub = seed * 1000 + k;
    let maze: GeneratedMaze;
    try { maze = generateMaze({ ...gen, seed: sub, size_m: (c.mat.gridN * c.mat.cell_cm) / 100, cell_m: c.mat.cell_cm / 100, lineWidth_cm: [c.mat.lineWidth_cm.min, c.mat.lineWidth_cm.max] }); }
    catch (e) { rejected.push(`${sub}: ${(e as Error).message}`); continue; }
    const { track, gray } = trackFromMaze(maze, `gen-${seed}.png`);
    const graph = buildGraph(track);
    const check = checkTrack(track, graph, c);
    if (check.ok) return { maze, track, graph, check, gray, checkpoints: checkpointsFor(graph), subSeed: sub, rejected };
    rejected.push(`${sub}: ${check.problems.join('; ')}`);
  }
  throw new Error(`No valid maze for seed ${seed} in ${maxTries} tries: ${rejected.slice(-3).join(' | ')}`);
}
