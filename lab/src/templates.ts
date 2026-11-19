// Variations of a real maze. A clean top-down image of a real Robo-Run maze is traced into its lines and junctions
// (the simulator's junction graph), and each variation keeps its layout and character while changing it a little:
//   - symmetry: rotate / mirror, so the start can be in any corner
//   - layout: some rows and columns stretched, others squeezed (straight lines stay straight)
//   - features: some wiggly sections (zigzag, meander, S-bend, bump) redrawn as another wiggly feature
//   - level: easy removes some dead ends and straightens some wiggles; hard adds stubs, features and an extra link or
//     two (loops); normal does a little of both
//   - size: scaled to the competition mat (2027: 4 m), lines redrawn 3–4 cm wide
// Every variation then goes through the same rule checks as any generated track.
import { Rng } from '../../src/sim/sensors';
import { buildEdge, contacts, type Feature, type GeneratedMaze, type P2 } from '../../src/track/generate';
import { buildGraph } from '../../src/track/graph';
import { loadInputs } from './inputs';

export type Level = 'easy' | 'normal' | 'hard';
export interface Template {
  name: string;
  size_m: number;
  lines: P2[][];                       // polylines in metres, ends at junctions or line ends
  start: { x: number; y: number; side: number };
  finish: { x: number; y: number; side: number };
}

// Douglas–Peucker simplification (keeps the drawn shape within `tol` metres).
function simplify(pts: P2[], tol: number): P2[] {
  if (pts.length < 3) return pts;
  const [a, b] = [pts[0], pts[pts.length - 1]];
  const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1e-9;
  let far = 0, at = 0;
  for (let i = 1; i < pts.length - 1; i += 1) {
    const d = Math.abs((pts[i][0] - a[0]) * dy - (pts[i][1] - a[1]) * dx) / L;
    if (d > far) { far = d; at = i; }
  }
  if (far <= tol) return [a, b];
  return [...simplify(pts.slice(0, at + 1), tol).slice(0, -1), ...simplify(pts.slice(at), tol)];
}

export function templateFromImage(file: string, name = file): Template {
  const { start } = loadInputs({ track: file });
  const t = start.track;
  if (!t.start || !t.finish) throw new Error(`${file}: a template needs a start and a finish square.`);
  const g = buildGraph(t);
  const lines: P2[][] = [];
  for (const e of g.edges) {
    const A = g.nodes.get(e.a)!, B = g.nodes.get(e.b)!;
    const pts: P2[] = [[A.x, A.y], ...e.pts.map(([x, y]) => [x, y] as P2), [B.x, B.y]];
    lines.push(simplify(pts, 0.006));
  }
  const sq = (r: NonNullable<typeof t.start>) => ({ x: ((r.x0 + r.x1 + 1) / 2) * t.res, y: ((r.y0 + r.y1 + 1) / 2) * t.res, side: Math.min(r.x1 - r.x0 + 1, r.y1 - r.y0 + 1) * t.res });
  return { name, size_m: t.w * t.res, lines, start: sq(t.start), finish: sq(t.finish) };
}

const pathLen = (p: P2[]) => p.reduce((a, q, i) => (i ? a + Math.hypot(q[0] - p[i - 1][0], q[1] - p[i - 1][1]) : 0), 0);
const chord = (p: P2[]) => Math.hypot(p[p.length - 1][0] - p[0][0], p[p.length - 1][1] - p[0][1]);
const key = (p: P2) => `${p[0].toFixed(4)},${p[1].toFixed(4)}`;

// A monotone piecewise-linear map of [0, S] onto itself: some bands stretched, others squeezed (±f).
function stretchMap(rng: Rng, S: number, f: number): (v: number) => number {
  const n = 4;
  const w = Array.from({ length: n }, () => 1 + (rng.next() * 2 - 1) * f);
  const tot = w.reduce((a, b) => a + b, 0);
  const xs = Array.from({ length: n + 1 }, (_, i) => (S * i) / n);
  const ys = [0];
  for (let i = 0; i < n; i += 1) ys.push(ys[i] + (S * w[i]) / tot);
  return (v) => {
    const i = Math.min(n - 1, Math.max(0, Math.floor((v / S) * n)));
    return ys[i] + ((v - xs[i]) / (xs[i + 1] - xs[i])) * (ys[i + 1] - ys[i]);
  };
}

export interface VariantOptions { seed: number; level: Level; size_m: number; lineWidth_cm: [number, number] }

export function templateVariant(t: Template, o: VariantOptions): GeneratedMaze {
  const rng = new Rng(Math.imul((o.seed >>> 0) + 17, 2654435761) ^ 0x51ed27);
  const lw = (o.lineWidth_cm[0] + rng.next() * (o.lineWidth_cm[1] - o.lineWidth_cm[0])) / 100;
  // Fit the maze to the mat: its outline (lines and squares) is scaled uniformly to fill the mat less a 2.5 cm margin,
  // so the start square sits in the corner square as the rulebook says. Lines keep their 3–4 cm width.
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const grow = (x: number, y: number) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
  for (const l of t.lines) for (const [x, y] of l) grow(x, y);
  for (const q of [t.start, t.finish]) { grow(q.x - q.side / 2, q.y - q.side / 2); grow(q.x + q.side / 2, q.y + q.side / 2); }
  const margin = 0.025;
  const s = (o.size_m - 2 * margin) / Math.max(x1 - x0, y1 - y0);
  const fit = ([x, y]: P2): P2 => [margin + (x - x0) * s, margin + (y - y0) * s];
  let lines: P2[][] = t.lines.map((l) => l.map(fit));
  const [sx, sy] = fit([t.start.x, t.start.y]), [fxx, fyy] = fit([t.finish.x, t.finish.y]);
  const S0 = { x: sx, y: sy }, F0 = { x: fxx, y: fyy };
  // The squares are drawn at most 25 cm (one rulebook square); a line that ended at the larger square's edge is
  // continued to its centre so it still joins the square.
  const sqSide = Math.min(0.25, t.start.side * s);
  // The joining line is found by distance in the template's own scale (the trace stops a few cm short of the square's
  // edge; scaling the maze up scales that gap too).
  for (const q of [{ c: S0, side: t.start.side * s }, { c: F0, side: t.finish.side * s }]) {
    const inSq = (p: P2) => Math.max(Math.abs(p[0] - q.c.x), Math.abs(p[1] - q.c.y)) <= q.side / 2 + 0.03 * Math.max(1, s);
    lines = lines.map((l) => (inSq(l[0]) ? [[q.c.x, q.c.y] as P2, ...l] : inSq(l[l.length - 1]) ? [...l, [q.c.x, q.c.y] as P2] : l));
    if (!lines.some((l) => [l[0], l[l.length - 1]].some((p) => p[0] === q.c.x && p[1] === q.c.y))) throw new Error('template: no line joins a square');
  }
  const minSep = lw + 0.035;
  const counts: Record<string, number> = {};
  const note = (k: string) => { counts[k] = (counts[k] ?? 0) + 1; };
  const clear = (cand: P2[][]) => contacts(cand.map((pts, i) => ({ owner: `l${i}`, pts })), minSep, 0.075, o.size_m, lw / 2 + 0.015).size === 0;
  const baseOk = clear(lines);
  // Try an edit; keep it only if it adds no contact between lines (when the template itself is clean).
  const attempt = (next: P2[][], tag: string) => { if (!baseOk || clear(next)) { lines = next; note(tag); return true; } return false; };
  const ends = () => { const m = new Map<string, number>(); for (const l of lines) for (const p of [l[0], l[l.length - 1]]) m.set(key(p), (m.get(key(p)) ?? 0) + 1); return m; };
  const nearSquare = (p: P2) => [S0, F0].some((q) => Math.hypot(p[0] - q.x, p[1] - q.y) < 0.3);
  const deadEnds = () => { const m = ends(); return lines.map((l, i) => i).filter((i) => { const l = lines[i]; return [l[0], l[l.length - 1]].some((p) => m.get(key(p)) === 1 && !nearSquare(p)); }); };
  const wiggly = () => lines.map((l, i) => i).filter((i) => chord(lines[i]) > 0.18 && pathLen(lines[i]) / chord(lines[i]) > 1.35 && !nearSquare(lines[i][0]) && !nearSquare(lines[i][lines[i].length - 1]));
  const straight = () => lines.map((l, i) => i).filter((i) => lines[i].length === 2 && chord(lines[i]) > 0.35 && !nearSquare(lines[i][0]) && !nearSquare(lines[i][1]));
  const pickN = (arr: number[], n: number) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i -= 1) { const j = Math.floor(rng.next() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a.slice(0, n); };
  // Draw feature f between the ends of segment p (on its chord), replacing it.
  const drawOn = (p: P2[], f: Feature): P2[][] | null => {
    const A = p[0], B = p[p.length - 1], L = chord(p);
    const u: P2 = [(B[0] - A[0]) / L, (B[1] - A[1]) / L], n: P2 = [-u[1], u[0]];
    const loc = buildEdge(f, L, rng, 0.2, 1.3);
    if (!loc) return null;
    return loc.map((pl) => pl.map(([x, y]) => [A[0] + u[0] * x + n[0] * y, A[1] + u[1] * x + n[1] * y] as P2));
  };
  const replace = (i: number, parts: P2[][]) => [...lines.slice(0, i), ...parts, ...lines.slice(i + 1)];
  const WIGGLES: Feature[] = ['zigzag', 'meander', 'sbend', 'arc'];
  const ADDS: Feature[] = ['box', 'boxSide', 'diamond', 'zigzag', 'triangles', 'arc', 'comb', 'stub', 'oval'];

  // Feature swaps (all levels): a wiggly section becomes another wiggly feature.
  for (const i of pickN(wiggly(), o.level === 'easy' ? 0 : 1 + Math.floor(rng.next() * 2))) {
    const f = WIGGLES[Math.floor(rng.next() * WIGGLES.length)];
    const parts = drawOn(lines[i], f);
    if (parts) attempt(replace(i, parts), `swap→${f}`);
  }
  if (o.level === 'easy') {
    // Fewer dead ends (removing a whole dead-end segment), some wiggles straightened.
    const de = deadEnds();
    const drop = new Set(pickN(de, Math.ceil(de.length * (0.3 + rng.next() * 0.3))));
    if (drop.size) { lines = lines.filter((_, i) => !drop.has(i)); counts['dead end removed'] = drop.size; }
    for (const i of pickN(wiggly(), 1 + Math.floor(rng.next() * 2))) attempt(replace(i, [[lines[i][0], lines[i][lines[i].length - 1]]]), 'wiggle straightened');
  } else if (o.level === 'hard') {
    // More stubs (dead ends) and features on plain straight sections.
    for (const i of pickN(straight(), 3 + Math.floor(rng.next() * 3))) {
      if (i >= lines.length) continue;
      const f = ADDS[Math.floor(rng.next() * ADDS.length)];
      const parts = drawOn(lines[i], f);
      if (parts) attempt(replace(i, parts), `added ${f}`);
    }
  } else {
    for (const i of pickN(straight(), 1 + Math.floor(rng.next() * 2))) {
      if (i >= lines.length) continue;
      const f = ADDS[Math.floor(rng.next() * ADDS.length)];
      const parts = drawOn(lines[i], f);
      if (parts) attempt(replace(i, parts), `added ${f}`);
    }
    const de = deadEnds();
    if (de.length > 3 && rng.next() < 0.5) { const d = pickN(de, 1)[0]; lines = lines.filter((_, i) => i !== d); note('dead end removed'); }
  }

  // Layout: stretch / squeeze bands of rows and columns (±12 %), then rotate / mirror. If the stretch would squeeze two
  // lines together, the layout is kept unstretched.
  const S = o.size_m;
  const fx = stretchMap(rng, S, 0.12), fy = stretchMap(rng, S, 0.12);
  const sym = Math.floor(rng.next() * 8);
  const symm = ([a, b]: P2): P2 => { if (sym & 4) a = S - a; for (let r = 0; r < (sym & 3); r += 1) [a, b] = [S - b, a]; return [a, b]; };
  const stretchOk = !baseOk || clear(lines.map((l) => l.map(([x, y]) => [fx(x), fy(y)] as P2)));
  if (stretchOk) note('layout stretched');
  const tf = (p: P2): P2 => symm(stretchOk ? [fx(p[0]), fy(p[1])] : p);
  lines = lines.map((l) => l.map(tf));
  const place = (q: { x: number; y: number }) => { const [x, y] = tf([q.x, q.y]); return { x, y, side: sqSide }; };
  const start = place(S0), finish = place(F0);
  const corner = `${start.y < S / 2 ? 'top' : 'bottom'}-${start.x < S / 2 ? 'left' : 'right'}` as GeneratedMaze['corner'];
  return {
    seed: o.seed, size_m: o.size_m, lineWidth_m: lw,
    elements: lines.map((pts, i) => ({ owner: `l${i}`, pts })),
    start, finish, corner,
    features: counts as GeneratedMaze['features'],
    nodes: 0, edges: lines.length, loops: 0, attempts: 0,
  };
}
