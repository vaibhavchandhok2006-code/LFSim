// Seeded Robo-Run maze generator, modelled on real Shaastra mazes: one long route winds band by band from the start
// corner to the finish at the far end, with a few side branches (dead ends) and shortcuts (loops), and a budget of
// features measured on reference mazes — a zigzag or two, a square-wave meander, S-bend, half-circle bumps, a few
// rectangles, a circle (sometimes with spokes), a triangle chain, a diamond or V, combs and stubs, diagonals and rounded
// corners — on plenty of plain line and white space. The drawing is checked for unintended contact between lines, then
// rasterised at 2 mm/px. Pure TypeScript (no Node, no DOM): the same seed always gives the same maze.

import { Rng } from '../sim/sensors';

export type Feature =
  | 'straight' | 'zigzag' | 'arc' | 'sbend' | 'box' | 'boxSide' | 'oval' | 'diamond' | 'triangles'
  | 'stub' | 'comb' | 'ring' | 'curve' | 'diagonal' | 'meander'
  | 'chevron' | 'fork' | 'ladder' | 'circles' | 'cross';

export const FEATURES: Feature[] = ['straight', 'zigzag', 'arc', 'sbend', 'meander', 'box', 'boxSide', 'oval', 'diamond', 'triangles', 'stub', 'comb', 'ring', 'curve', 'diagonal', 'chevron', 'fork', 'ladder', 'circles', 'cross'];

// Feature counts on the reference mazes (lab/references/features.json), per maze, as [min, max] ranges the generator
// draws from (a little above the references, as asked). Edge features sit on route segments; ring and curve on corners
// and junctions; diagonal = a corner cut at 45°.
export const REFERENCE_BUDGET: Partial<Record<Feature, [number, number]>> = {
  zigzag: [1, 2], meander: [0, 1], sbend: [0, 1], arc: [1, 2], box: [4, 7], boxSide: [1, 2], oval: [0, 1], diamond: [0, 1],
  triangles: [0, 1], comb: [1, 2], stub: [2, 4], ring: [1, 2], curve: [1, 3], diagonal: [2, 5],
};

// "Novel" mazes test styles never used for tuning: features the rulebook allows or other photos show, that the
// reference maze has few or none of — chevrons crossing a line, acute Y-forks, ladders, circles on the line, plus-shaped
// crossings — with the usual ones rarer, and tighter gaps between neighbouring lines.
export const NOVEL_BUDGET: Partial<Record<Feature, [number, number]>> = {
  chevron: [1, 3], fork: [1, 3], ladder: [1, 2], circles: [1, 3], cross: [1, 3], zigzag: [0, 1], box: [1, 3], diamond: [0, 2],
  triangles: [0, 1], stub: [1, 3], arc: [0, 1], ring: [0, 1], curve: [1, 3], diagonal: [2, 5],
};

export interface GenOptions {
  seed: number;
  size_m: number;          // mat side (Robo-Run 2027: 16 × 25 cm = 4 m; 2026: 10 × 25 cm = 2.5 m)
  cell_m: number;          // rulebook unit square (start square sits in the corner cell)
  lineWidth_cm: [number, number]; // drawn width is chosen per maze in this range
  lattice?: number;        // route lattice points per side (default: from the mat size, 2 cells apart)
  finish: { corner: number; edge: number; inside: number }; // where the finish goes (relative weights)
  budget: Partial<Record<Feature, [number, number]>>; // features per maze
  branches: [number, number];  // side branches (dead ends) off the route
  shortcuts: [number, number]; // links between route parts (loops: more than one way to the finish)
  merge: number;           // chance two straight route segments in line are drawn as one long segment (room for features)
  squareSide_m: number;    // start / finish square side (assumption: 20 cm, inside a 25 cm cell)
  gap_cm: number;          // smallest white gap between lines that are not meant to meet
}

export const DEFAULT_GEN: Omit<GenOptions, 'seed'> = {
  size_m: 4, cell_m: 0.25, lineWidth_cm: [3, 4], finish: { corner: 0.7, edge: 0.2, inside: 0.1 },
  budget: REFERENCE_BUDGET, branches: [4, 7], shortcuts: [3, 5], merge: 0.45, squareSide_m: 0.2, gap_cm: 3.5,
};

export type P2 = [number, number];
export interface GenElement { pts: P2[]; owner: string } // a drawn polyline; owner = the edge or junction it belongs to
export interface GeneratedMaze {
  seed: number;
  size_m: number;
  lineWidth_m: number;
  elements: GenElement[];
  start: { x: number; y: number; side: number };
  finish: { x: number; y: number; side: number };
  corner: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  features: Partial<Record<Feature | 'ringSpokes', number>>; // count of each feature drawn (ringSpokes: rings with spokes)
  nodes: number; edges: number; loops: number;
  attempts: number;        // feature downgrades needed to clear contacts
}

// ---------------------------------------------------------------- lattice carving

interface LEdge { a: number; b: number; diag: boolean; long?: boolean }

// Route points two rulebook squares apart (room for features at the size seen on real mazes).
export const latticeFor = (size_m: number, cell_m: number) => Math.round((size_m - cell_m) / (2 * cell_m)) + 1;

const ri = (rng: Rng, r: [number, number]) => r[0] + Math.floor(rng.next() * (r[1] - r[0] + 1));

// The route: from the start corner (0, 0) along horizontal bands of 2–3 lattice rows, left to right then right to left,
// stepping up or down inside a band now and then, down to the next band at the end of each. It ends on the bottom row
// (usually at a bottom corner, sometimes along the bottom edge), or the finish goes at the end of a branch inside.
function carveRoute(o: GenOptions, rng: Rng) {
  const K = o.lattice ?? latticeFor(o.size_m, o.cell_m);
  const id = (i: number, j: number) => j * K + i;
  const col = (n: number) => n % K, row = (n: number) => Math.floor(n / K);
  const bands: [number, number][] = [];
  for (let r = 0; r < K;) { let h = rng.next() < 0.5 ? 2 : 3; if (K - (r + h) === 1) h += 1; if (r + h > K) h = K - r; bands.push([r, r + h - 1]); r += h; }
  const fw = o.finish.corner + o.finish.edge + o.finish.inside, fr = rng.next() * fw;
  const finishKind = fr < o.finish.corner ? 'corner' : fr < o.finish.corner + o.finish.edge ? 'edge' : 'inside';
  const path: number[] = [id(0, 0)];
  const used = new Set<number>(path);
  let c = 0, r = 0, dir = 1, vertCol = -1;
  const go = (i: number, j: number) => { c = i; r = j; const n = id(i, j); path.push(n); used.add(n); };
  for (let b = 0; b < bands.length; b += 1) {
    const [r0, r1] = bands[b];
    const last = b === bands.length - 1;
    const endCol = dir > 0 ? K - 1 : 0;
    const stopCol = last && finishKind === 'edge' ? (dir > 0 ? 2 + Math.floor(rng.next() * (K - 4)) : 1 + Math.floor(rng.next() * (K - 4))) : endCol;
    while (c !== stopCol) {
      // A step up or down inside the band (at most one vertical run per column, so the route never meets itself).
      if (path.length > 1 && r1 > r0 && c !== vertCol && rng.next() < 0.3) {
        const t = r0 + Math.floor(rng.next() * (r1 - r0 + 1));
        if (t !== r) vertCol = c;
        while (r !== t) go(c, r + Math.sign(t - r));
      }
      go(c + dir, r);
    }
    if (last) { while (r < K - 1) go(c, r + 1); break; }
    const [n0, n1] = bands[b + 1];
    const t = n0 + Math.floor(rng.next() * (n1 - n0 + 1));
    vertCol = c;
    while (r !== t) go(c, r + 1);
    dir = -dir;
  }
  const edges: LEdge[] = [];
  const has = new Set<string>();
  const key = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);
  const add = (a: number, b: number, diag = false) => { edges.push({ a, b, diag }); has.add(key(a, b)); };
  for (let i = 1; i < path.length; i += 1) add(path[i - 1], path[i]);
  const idx = new Map(path.map((n, i) => [n, i]));
  let finish = path[path.length - 1];
  const start = path[0];
  const nb4 = (n: number) => [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([a, b]) => [col(n) + a, row(n) + b]).filter(([x, y]) => x >= 0 && y >= 0 && x < K && y < K).map(([x, y]) => id(x, y));

  // Inside finish: at the end of a short branch from the middle of the route; the route's own end becomes a dead end.
  if (finishKind === 'inside') {
    const mids = path.filter((n, i) => i > path.length * 0.4 && i < path.length * 0.8);
    let placed = false;
    for (let t = 0; t < 30 && !placed; t += 1) {
      const p = mids[Math.floor(rng.next() * mids.length)];
      const q = nb4(p).filter((m) => !used.has(m) && nb4(m).every((x) => x === p || !used.has(x)));
      if (!q.length) continue;
      const f = q[Math.floor(rng.next() * q.length)];
      add(p, f); used.add(f); finish = f; placed = true;
    }
  }
  const protectedNodes = new Set([start, path[1], finish]);
  const degree = (n: number) => edges.filter((e) => e.a === n || e.b === n).length;
  // Shortcuts: link two route points that are lattice neighbours but far apart along the route (a loop).
  const wantS = ri(rng, o.shortcuts);
  let loops = 0;
  const cand: [number, number][] = [];
  for (const p of path) for (const q of nb4(p)) if (idx.has(q) && p < q && Math.abs(idx.get(p)! - idx.get(q)!) >= 4 && !has.has(key(p, q)) && !protectedNodes.has(p) && !protectedNodes.has(q)) cand.push([p, q]);
  // Prefer shortcuts that skip a long stretch of the route (between bands): they make the finish hard to find by
  // simply following a wall, as the rulebook asks, and give real alternative routes.
  cand.sort((x, y) => Math.abs(idx.get(y[0])! - idx.get(y[1])!) - Math.abs(idx.get(x[0])! - idx.get(x[1])!));
  const top = cand.slice(0, Math.max(wantS * 4, Math.ceil(cand.length / 3)));
  while (loops < wantS && top.length) { const [p, q] = top.splice(Math.floor(rng.next() * top.length), 1)[0]; if (degree(p) < 3 && degree(q) < 3) { add(p, q); loops += 1; } }
  // Branches: dead ends of 1–3 segments into empty lattice points.
  const wantB = ri(rng, o.branches);
  for (let b = 0, t = 0; b < wantB && t < 60; t += 1) {
    const p = path[2 + Math.floor(rng.next() * (path.length - 3))];
    if (protectedNodes.has(p) || degree(p) >= 3) continue;
    let cur = p, steps = 1 + Math.floor(rng.next() * 3), made = 0;
    while (steps-- > 0) {
      const q = nb4(cur).filter((m) => !used.has(m));
      if (!q.length) break;
      const nx = q[Math.floor(rng.next() * q.length)];
      add(cur, nx); used.add(nx); cur = nx; made += 1;
    }
    if (made) b += 1;
  }
  // Diagonal corner cuts: a route corner a–m–b (one horizontal, one vertical segment, m plain) becomes one 45° line a–b.
  const wantD = ri(rng, o.budget.diagonal ?? [0, 0]);
  const diagCells = new Set<string>();
  let diagonals = 0;
  for (let t = 0; t < 200 && diagonals < wantD; t += 1) {
    const m = path[2 + Math.floor(rng.next() * Math.max(1, path.length - 4))];
    if (protectedNodes.has(m)) continue;
    const ks = edges.map((e, k) => (e.a === m || e.b === m ? k : -1)).filter((k) => k >= 0);
    if (ks.length !== 2) continue;
    const [e1, e2] = ks.map((k) => edges[k]);
    if (e1.diag || e2.diag) continue;
    const a = e1.a === m ? e1.b : e1.a, b = e2.a === m ? e2.b : e2.a;
    if (col(a) === col(b) || row(a) === row(b) || protectedNodes.has(a) || protectedNodes.has(b)) continue;
    const cell = `${Math.min(col(a), col(b))},${Math.min(row(a), row(b))}`;
    if (diagCells.has(cell) || has.has(key(a, b))) continue;
    for (const k of ks.sort((x, y) => y - x)) edges.splice(k, 1);
    add(a, b, true); diagCells.add(cell); used.delete(m); diagonals += 1;
  }
  // Long segments: two straight route segments in line through a plain point are drawn as one (room for long features).
  for (const m of [...used]) {
    if (protectedNodes.has(m) || rng.next() > o.merge) continue;
    const ks = edges.map((e, k) => (e.a === m || e.b === m ? k : -1)).filter((k) => k >= 0);
    if (ks.length !== 2) continue;
    const [e1, e2] = ks.map((k) => edges[k]);
    if (e1.diag || e2.diag || (e1 as LEdge & { long?: boolean }).long || (e2 as LEdge & { long?: boolean }).long) continue;
    const a = e1.a === m ? e1.b : e1.a, b = e2.a === m ? e2.b : e2.a;
    if (!(col(a) === col(b) || row(a) === row(b)) || protectedNodes.has(a) || protectedNodes.has(b)) continue;
    for (const k of ks.sort((x, y) => y - x)) edges.splice(k, 1);
    edges.push({ a, b, diag: false, long: true } as LEdge); used.delete(m);
  }
  return { K, edges, start, finish, used: [...used], loops, diagonals };
}

// ---------------------------------------------------------------- geometry helpers

const sub = (a: P2, b: P2): P2 => [a[0] - b[0], a[1] - b[1]];
const len = (a: P2) => Math.hypot(a[0], a[1]);
function arcPts(cx: number, cy: number, r: number, a0: number, a1: number): P2[] {
  const n = Math.max(4, Math.ceil((Math.abs(a1 - a0) * r) / 0.01));
  return Array.from({ length: n + 1 }, (_, k) => { const a = a0 + ((a1 - a0) * k) / n; return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as P2; });
}

// Local edge frame: x along the edge from 0 to L, y across it. Each builder returns polylines (elements) whose ends are
// where they meet other lines.
export type Local = P2[][];
const range = (rng: Rng, a: number, b: number) => a + rng.next() * (b - a);
const side = (rng: Rng) => (rng.next() < 0.5 ? 1 : -1);

export function buildEdge(f: Feature, L: number, rng: Rng, across: number, sc = 1): Local | null {
  // Feature sizes scale with the route spacing (sc = 1 at 37.5 cm); clearance limits stay absolute.
  const R = (lo: number, hi: number): number => range(rng, lo * sc, hi * sc);
  // `across` = free room on each side of the edge (m) before another lattice edge.
  const lead = 0.06;
  const s = side(rng);
  switch (f) {
    case 'straight': case 'diagonal': return [[[0, 0], [L, 0]]];
    case 'zigzag': {
      const M = L - 2 * lead, a = Math.min(R(0.08, 0.13), across - 0.06), k = Math.floor(M / R(0.09, 0.13));
      if (k < 2 || a < 0.05) return null;
      const pts: P2[] = [[0, 0], [lead, 0]];
      for (let i = 1; i < 2 * k; i += 1) pts.push([lead + (M * i) / (2 * k), i % 2 ? a * s : 0]);
      pts.push([L - lead, 0], [L, 0]);
      return [pts];
    }
    case 'arc': {
      const r = Math.min(R(0.05, 0.09), across - 0.05), m = L / 2;
      if (r < 0.045 || m - r < lead) return null;
      return [[[0, 0], ...arcPts(m, 0, r, Math.PI, s > 0 ? 0 : 2 * Math.PI).map(([x, y]) => [x, s > 0 ? Math.abs(y) : -Math.abs(y)] as P2), [L, 0]]];
    }
    case 'meander': { // square wave: up, across, down past the line, across, back (sample maze, top row)
      const w = R(0.11, 0.15), a = Math.min(R(0.09, 0.13), across - 0.05), m = rng.next() < 0.5 ? 2 : 3;
      const x0 = (L - m * w) / 2;
      if (x0 < lead || a < 0.07) return null;
      const pts: P2[] = [[0, 0], [x0, 0]];
      for (let k = 0; k <= m; k += 1) {
        const yPrev = k === 0 ? 0 : s * a * (k % 2 ? 1 : -1);
        const yNext = k === m ? 0 : s * a * (k % 2 ? -1 : 1);
        pts.push([x0 + k * w, yPrev], [x0 + k * w, yNext]);
      }
      pts.push([L, 0]);
      return [pts];
    }
    case 'sbend': {
      const w = R(0.085, 0.11), a = Math.min(R(0.06, 0.09), across - w / 2 - 0.05), m = rng.next() < 0.5 ? 2 : 3;
      const x0 = (L - m * w) / 2;
      if (x0 < lead || a < 0.05) return null;
      const pts: P2[] = [[0, 0], [x0, 0]];
      let y = 0;
      for (let k = 0; k <= m; k += 1) {
        const sk = s * (k % 2 ? -1 : 1);
        const yEnd = k === m ? 0 : sk * a;
        pts.push([x0 + k * w, y], [x0 + k * w, yEnd]);
        if (k < m) { // half circle joining this column to the next, bulging outward
          const cy = yEnd, r = w / 2;
          for (const p of arcPts(x0 + k * w + r, cy, r, Math.PI, 0)) pts.push([p[0], cy + sk * Math.abs(p[1] - cy)]);
          y = yEnd;
        }
      }
      pts.push([L, 0]);
      return [pts];
    }
    case 'box': case 'boxSide': case 'oval': {
      // A loop with no line through it (box, oval) may be flatter than one with a straight inside (boxSide).
      const bl = f === 'oval' ? R(0.15, 0.2) : R(0.15, 0.24);
      const h = Math.min(f === 'boxSide' ? R(0.09, 0.12) : R(0.07, 0.11), across - 0.05);
      const x1 = (L - bl) / 2, x2 = x1 + bl;
      if (x1 < 0.08 || h < (f === 'boxSide' ? 0.085 : 0.058)) return null;
      const out: Local = [[[0, 0], [x1, 0]], [[x2, 0], [L, 0]]];
      const loop = (sg: number): P2[] => f === 'oval'
        ? [...arcPts(x1 + h, 0, h, Math.PI, Math.PI + (sg > 0 ? -1 : 1) * (Math.PI / 2)).map(([x, y]) => [x, sg * Math.abs(y)] as P2),
          ...arcPts(x2 - h, 0, h, Math.PI / 2, 0).map(([x, y]) => [x, sg * Math.abs(y)] as P2)]
        : [[x1, 0], [x1, sg * h], [x2, sg * h], [x2, 0]];
      if (f === 'oval' && bl < 2 * h + 0.02) return null;
      out.push(loop(s));
      if (f === 'boxSide') out.push([[x1, 0], [x2, 0]]); else out.push(loop(-s));
      return out;
    }
    case 'diamond': case 'triangles': {
      // Triangles: one arrow-head, or two in a row when the edge is long enough (the back of a triangle must stay
      // clear of lines at the junctions).
      const bl = f === 'triangles' ? R(0.1, 0.13) : R(0.12, 0.16), gap = 0.035, h = Math.min(R(0.07, 0.1), across - 0.05);
      const n = f === 'triangles' && 2 * bl + gap <= L - 0.2 ? 2 : 1;
      const total = n * bl + (n - 1) * gap;
      let x1 = (L - total) / 2;
      if (x1 < (f === 'triangles' ? 0.1 : lead) || h < 0.065) return null;
      const out: Local = [[[0, 0], [x1, 0]]];
      for (let k = 0; k < n; k += 1) {
        const x2 = x1 + bl;
        if (f === 'diamond') { out.push([[x1, 0], [(x1 + x2) / 2, h], [x2, 0]], [[x1, 0], [(x1 + x2) / 2, -h], [x2, 0]]); }
        else { out.push([[x1, 0], [x1, h], [x2, 0]], [[x1, 0], [x1, -h], [x2, 0]]); }
        const next = k < n - 1 ? x2 + gap : L;
        out.push([[x2, 0], [next, 0]]);
        x1 = next;
      }
      return out;
    }
    case 'stub': case 'comb': {
      const n = f === 'comb' ? 2 + Math.floor(rng.next() * 3) : 1;
      const sl = Math.min(R(0.07, 0.13), across - 0.06), sp = R(0.085, 0.11);
      const ang = f === 'stub' && rng.next() < 0.35 ? Math.PI / 4 : Math.PI / 2;
      const span = (n - 1) * sp;
      let x = (L - span) / 2 + (f === 'stub' ? R(-0.05, 0.05) : 0);
      if (x < lead + 0.02 || x + span > L - lead - 0.02 || sl < 0.06) return null;
      const out: Local = [];
      let prev = 0;
      for (let k = 0; k < n; k += 1, x += sp) {
        out.push([[prev, 0], [x, 0]], [[x, 0], [x + sl * Math.cos(ang) * (rng.next() < 0.5 ? 1 : -1) * (ang === Math.PI / 2 ? 0 : 1), s * sl * Math.sin(ang)]]);
        prev = x;
      }
      out.push([[prev, 0], [L, 0]]);
      return out;
    }
    case 'chevron': { // a bracket crossing the line, its arms pointing back (sample maze: the two '>' shapes)
      const h = Math.min(R(0.09, 0.13), across - 0.05), d = R(0.07, 0.1), xm = L / 2 + R(-0.03, 0.03), e = 0.02;
      if (xm - d < lead + 0.03 || h < 0.07) return null;
      const dirn = rng.next() < 0.5 ? -1 : 1;
      return [[[0, 0], [xm, 0]], [[xm, 0], [L, 0]], [[xm, 0], [xm, -h + e], [xm + dirn * d, -h]], [[xm, 0], [xm, h - e], [xm + dirn * d, h]]];
    }
    case 'fork': { // acute Y: the line splits at a narrow angle and joins again
      const bl = R(0.24, 0.32), h = Math.min(R(0.05, 0.07), across - 0.05);
      const x1 = (L - bl) / 2, x2 = x1 + bl;
      if (x1 < lead || h < 0.045) return null;
      const sg = side(rng);
      return [[[0, 0], [x1, 0]], [[x2, 0], [L, 0]], [[x1, 0], [x2, 0]], [[x1, 0], [x1 + bl * 0.3, sg * h], [x2 - bl * 0.3, sg * h], [x2, 0]]];
    }
    case 'ladder': { // two parallel lines joined by rungs (sample maze: left side)
      const bl = R(0.22, 0.3), h = Math.min(R(0.1, 0.13), across - 0.05), n = 1 + Math.floor(rng.next() * 2);
      const x1 = (L - bl) / 2, x2 = x1 + bl;
      if (x1 < lead || h < 0.085) return null;
      const sg = side(rng);
      const xs = [x1, ...Array.from({ length: n }, (_, k) => x1 + (bl * (k + 1)) / (n + 1)), x2];
      const out: Local = [[[0, 0], [x1, 0]], [[x2, 0], [L, 0]]];
      for (let k = 0; k < xs.length - 1; k += 1) { out.push([[xs[k], 0], [xs[k + 1], 0]], [[xs[k], sg * h], [xs[k + 1], sg * h]]); }
      for (const x of xs) out.push([[x, 0], [x, sg * h]]);
      return out;
    }
    case 'circles': { // one or two circles threaded on the line (photo: "dumbbells")
      const r = Math.min(R(0.06, 0.08), across - 0.05), n = rng.next() < 0.5 ? 1 : 2, gap = 0.06;
      const span = n * 2 * r + (n - 1) * gap;
      let x = (L - span) / 2;
      if (x < lead || r < 0.05) return null;
      const out: Local = [[[0, 0], [x, 0]]];
      for (let k = 0; k < n; k += 1) {
        const c = x + r;
        out.push(arcPts(c, 0, r, Math.PI, 0).map(([px, py]) => [px, -Math.abs(py)] as P2), arcPts(c, 0, r, Math.PI, 0).map(([px, py]) => [px, Math.abs(py)] as P2));
        const next = k < n - 1 ? x + 2 * r + gap : L;
        out.push([[x + 2 * r, 0], [next, 0]]);
        x = next;
      }
      return out;
    }
    case 'cross': { // a short line crossing the route: a 4-way crossing with two dead ends
      const a = Math.min(R(0.07, 0.11), across - 0.05), xm = L / 2 + R(-0.05, 0.05);
      if (xm < lead + 0.03 || a < 0.06) return null;
      return [[[0, 0], [xm, 0]], [[xm, 0], [L, 0]], [[xm, 0], [xm, a]], [[xm, 0], [xm, -a]]];
    }
    default: return null;
  }
}

// ---------------------------------------------------------------- contact check

// True if two different drawn lines come closer than `minSep` anywhere except where they are meant to meet.
// Near a junction, lines that meet at an angle are close for a while; that is meant. Two points count as touching
// by accident only if the way between them along the lines (via the junction) is much longer than the gap.
export function contacts(els: GenElement[], minSep: number, joinR: number, size: number, margin: number): Set<string> {
  const step = 0.01;
  const pts: { x: number; y: number; e: number; s: number }[] = [];
  els.forEach((el, e) => {
    let acc = 0;
    for (let k = 0; k < el.pts.length - 1; k += 1) {
      const a = el.pts[k], b = el.pts[k + 1], L = len(sub(b, a)), n = Math.max(1, Math.ceil(L / step));
      for (let i = 0; i < n; i += 1) pts.push({ x: a[0] + ((b[0] - a[0]) * i) / n, y: a[1] + ((b[1] - a[1]) * i) / n, e, s: acc + (L * i) / n });
      acc += L;
    }
    const l = el.pts[el.pts.length - 1];
    pts.push({ x: l[0], y: l[1], e, s: acc });
  });
  // Junction points: element ends, and which elements touch each one.
  const ends: P2[] = [];
  els.forEach((el) => { ends.push(el.pts[0], el.pts[el.pts.length - 1]); });
  const cell = minSep;
  const grid = new Map<string, number[]>();
  const gk = (x: number, y: number) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
  pts.forEach((p, i) => { const k = gk(p.x, p.y); const a = grid.get(k); if (a) a.push(i); else grid.set(k, [i]); });
  const touching = (pt: P2) => {
    const s = new Set<number>();
    const cx = Math.floor(pt[0] / cell), cy = Math.floor(pt[1] / cell);
    for (let dx = -1; dx <= 1; dx += 1) for (let dy = -1; dy <= 1; dy += 1) for (const i of grid.get(`${cx + dx},${cy + dy}`) ?? []) if (Math.hypot(pts[i].x - pt[0], pts[i].y - pt[1]) < 0.006) s.add(pts[i].e);
    return s;
  };
  const joins = ends.map((pt) => ({ pt, els: touching(pt) })).filter((j) => j.els.size >= 2);
  const bad = new Set<string>();
  for (const p of pts) if (p.x < margin || p.y < margin || p.x > size - margin || p.y > size - margin) bad.add(els[p.e].owner); // stays on the mat
  for (let i = 0; i < pts.length; i += 1) {
    const p = pts[i];
    const cx = Math.floor(p.x / cell), cy = Math.floor(p.y / cell);
    for (let dx = -1; dx <= 1; dx += 1) for (let dy = -1; dy <= 1; dy += 1) for (const j of grid.get(`${cx + dx},${cy + dy}`) ?? []) {
      if (j <= i) continue;
      const q = pts[j];
      const d = Math.hypot(p.x - q.x, p.y - q.y);
      if (d >= minSep) continue;
      const allowed = Math.max(2 * joinR, 3.2 * d);
      if (p.e === q.e) { if (Math.abs(p.s - q.s) > allowed) bad.add(els[p.e].owner); continue; }
      const ok = joins.some((jn) => jn.els.has(p.e) && jn.els.has(q.e) && Math.hypot(p.x - jn.pt[0], p.y - jn.pt[1]) + Math.hypot(q.x - jn.pt[0], q.y - jn.pt[1]) <= allowed);
      if (!ok) { bad.add(els[p.e].owner); bad.add(els[q.e].owner); }
    }
  }
  return bad;
}

// ---------------------------------------------------------------- the generator

export function generateMaze(opts: Partial<GenOptions> & { seed: number }): GeneratedMaze {
  const o: GenOptions = { ...DEFAULT_GEN, ...opts };
  const rng = new Rng(Math.imul(o.seed >>> 0, 2654435761) ^ 0x9e3779b9);
  const lat = carveRoute(o, rng);
  const lw = (o.lineWidth_cm[0] + rng.next() * (o.lineWidth_cm[1] - o.lineWidth_cm[0])) / 100;
  const K = lat.K;
  const off = o.cell_m / 2;
  const pitch = (o.size_m - 2 * off) / (K - 1);
  const pos = (n: number): P2 => [off + (n % K) * pitch, off + Math.floor(n / K) * pitch];
  const inc = new Map<number, number[]>(); // node → edge indices
  lat.edges.forEach((e, k) => { for (const n of [e.a, e.b]) { const a = inc.get(n); if (a) a.push(k); else inc.set(n, [k]); } });
  const dirFrom = (n: number, k: number): P2 => { const e = lat.edges[k]; const m = e.a === n ? e.b : e.a; const d = sub(pos(m), pos(n)); const l = len(d); return [d[0] / l, d[1] / l]; };

  // Features by budget: draw a count of each, place them on random route segments (long features on long segments)
  // and rings / rounded corners on route points. A feature that touches another line is moved once, then dropped.
  const want = (f: Feature) => ri(rng, o.budget[f] ?? [0, 0]);
  const shuffle = <T,>(arr: T[]) => { for (let i = arr.length - 1; i > 0; i -= 1) { const j = Math.floor(rng.next() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; };
  type NodeKind = { kind: 'plain' | 'ring' | 'curve'; r: number; spokes: number[] };
  const nodeKind = new Map<number, NodeKind>();
  for (const [n] of inc) nodeKind.set(n, { kind: 'plain', r: 0, spokes: [] });
  const special = (n: number) => n === lat.start || n === lat.finish;
  const makeRing = (n: number, spokes: boolean): NodeKind => {
    const ks = inc.get(n)!;
    const used = ks.map((k) => Math.atan2(dirFrom(n, k)[1], dirFrom(n, k)[0]));
    const sp: number[] = [];
    const nsp = spokes ? 2 + Math.floor(rng.next() * 2) : 0;
    for (let t = 0; t < 20 && sp.length < nsp; t += 1) {
      const a = rng.next() * 2 * Math.PI;
      if ([...used, ...sp].every((u) => Math.abs(((a - u + 3 * Math.PI) % (2 * Math.PI)) - Math.PI) > 0.75)) sp.push(a);
    }
    return { kind: 'ring', r: range(rng, 0.12, 0.16), spokes: sp }; // circles on real mazes are about 30 cm across
  };
  const ringSpots = shuffle([...inc.keys()].filter((n) => !special(n) && inc.get(n)!.length >= 2 && inc.get(n)!.length <= 3 && inc.get(n)!.every((k) => !lat.edges[k].diag)));
  const nRings = want('ring');
  ringSpots.slice(0, nRings).forEach((n, i) => nodeKind.set(n, makeRing(n, i === 0 && rng.next() < 0.7)));
  const bends = shuffle([...inc.keys()].filter((n) => {
    const ks = inc.get(n)!;
    if (special(n) || nodeKind.get(n)!.kind !== 'plain' || ks.length !== 2) return false;
    const d1 = dirFrom(n, ks[0]), d2 = dirFrom(n, ks[1]);
    return Math.abs(d1[0] * d2[0] + d1[1] * d2[1]) < 0.05;
  }));
  bends.slice(0, want('curve')).forEach((n) => nodeKind.set(n, { kind: 'curve', r: range(rng, 0.1, 0.18), spokes: [] }));
  const plain = (k: number): Feature => (lat.edges[k].diag ? 'diagonal' : 'straight');
  const edgeFeat: Feature[] = lat.edges.map((_, k) => plain(k));
  const touchesSpecial = (k: number) => { const e = lat.edges[k]; return special(e.a) || special(e.b); };
  const LONG: Feature[] = ['zigzag', 'triangles', 'meander', 'sbend', 'comb', 'fork', 'ladder', 'circles'];
  const fits = (f: Feature, k: number) => {
    const e = lat.edges[k];
    if (e.diag) return f === 'zigzag' || f === 'stub' || f === 'arc';
    return LONG.includes(f) ? !!e.long || rng.next() < 0.25 : true;
  };
  const free = shuffle(lat.edges.map((_, k) => k).filter((k) => !touchesSpecial(k)));
  const tried = new Map<number, Set<number>>(); // instance → edges tried
  const instanceAt = new Map<number, number>(); // edge → instance
  const instFeat: Feature[] = [];
  const place = (inst: number): boolean => {
    const f = instFeat[inst], seen = tried.get(inst) ?? new Set<number>();
    tried.set(inst, seen);
    const k = free.find((x) => edgeFeat[x] === plain(x) && !seen.has(x) && fits(f, x));
    if (k === undefined) return false;
    edgeFeat[k] = f; instanceAt.set(k, inst); seen.add(k);
    return true;
  };
  const order: Feature[] = [];
  for (const f of FEATURES) if (!['ring', 'curve', 'straight', 'diagonal'].includes(f)) for (let i = want(f); i > 0; i -= 1) order.push(f);
  // Long features first, so they get the long segments.
  for (const f of [...order.filter((x) => LONG.includes(x)), ...shuffle(order.filter((x) => !LONG.includes(x)))]) { instFeat.push(f); place(instFeat.length - 1); }
  const edgeSeed = lat.edges.map(() => Math.floor(rng.next() * 2 ** 31));

  const build = (): GenElement[] => {
    const els: GenElement[] = [];
    const port = (n: number, k: number): P2 => {
      const nk = nodeKind.get(n)!, d = dirFrom(n, k), p = pos(n);
      return nk.kind === 'plain' ? p : [p[0] + d[0] * nk.r, p[1] + d[1] * nk.r];
    };
    lat!.edges.forEach((e, k) => {
      const A = port(e.a, k), B = port(e.b, k), d = sub(B, A), L = len(d);
      const u: P2 = [d[0] / L, d[1] / L], nrm: P2 = [-u[1], u[0]];
      const across = e.diag ? pitch * 0.5 : pitch / 2;
      const r = new Rng(edgeSeed[k] || 1);
      let loc = L > 0.1 ? buildEdge(edgeFeat[k], L, r, across, pitch / 0.375) : null;
      if (!loc) { edgeFeat[k] = e.diag ? 'diagonal' : 'straight'; loc = [[[0, 0], [L, 0]]]; }
      for (const pl of loc) els.push({ owner: `e${k}`, pts: pl.map(([x, y]) => [A[0] + u[0] * x + nrm[0] * y, A[1] + u[1] * x + nrm[1] * y] as P2) });
    });
    for (const [n, nk] of nodeKind) {
      const p = pos(n), ks = inc.get(n)!;
      if (nk.kind === 'curve') {
        const d1 = dirFrom(n, ks[0]), d2 = dirFrom(n, ks[1]);
        const c: P2 = [p[0] + (d1[0] + d2[0]) * nk.r, p[1] + (d1[1] + d2[1]) * nk.r];
        const a0 = Math.atan2(p[1] + d1[1] * nk.r - c[1], p[0] + d1[0] * nk.r - c[0]);
        let a1 = Math.atan2(p[1] + d2[1] * nk.r - c[1], p[0] + d2[0] * nk.r - c[0]);
        if (a1 - a0 > Math.PI) a1 -= 2 * Math.PI; else if (a0 - a1 > Math.PI) a1 += 2 * Math.PI;
        els.push({ owner: `n${n}`, pts: arcPts(c[0], c[1], nk.r, a0, a1) });
      } else if (nk.kind === 'ring') {
        const angs = [...ks.map((k) => Math.atan2(dirFrom(n, k)[1], dirFrom(n, k)[0])), ...nk.spokes].map((a) => (a + 2 * Math.PI) % (2 * Math.PI)).sort((a, b) => a - b);
        for (let i = 0; i < angs.length; i += 1) {
          const a0 = angs[i], a1 = i + 1 < angs.length ? angs[i + 1] : angs[0] + 2 * Math.PI;
          els.push({ owner: `n${n}`, pts: arcPts(p[0], p[1], nk.r, a0, a1) });
        }
        for (const a of nk.spokes) {
          const sl = range(new Rng((n + 1) * 7919), 0.05, 0.08);
          els.push({ owner: `n${n}`, pts: [[p[0] + Math.cos(a) * nk.r, p[1] + Math.sin(a) * nk.r], [p[0] + Math.cos(a) * (nk.r + sl), p[1] + Math.sin(a) * (nk.r + sl)]] });
        }
      }
    }
    // Start and finish squares, as filled outlines for the contact check (owner = their node).
    for (const n of [lat!.start, lat!.finish]) {
      const p = pos(n), h = o.squareSide_m / 2;
      els.push({ owner: n === lat!.start ? 'start' : 'finish', pts: [[p[0] - h, p[1] - h], [p[0] + h, p[1] - h], [p[0] + h, p[1] + h], [p[0] - h, p[1] + h], [p[0] - h, p[1] - h]] });
    }
    return els;
  };

  // Clear contacts: downgrade the features of every owner involved, until nothing touches by accident.
  let els = build();
  let attempts = 0;
  const minSep = lw + o.gap_cm / 100;
  for (; attempts < 12; attempts += 1) {
    const bad = contacts(els.filter((e) => e.owner !== 'start' && e.owner !== 'finish'), minSep, 0.075, o.size_m, lw / 2 + 0.015);
    // Squares: no other line within the gap, except the line that enters it.
    const sq = (name: 'start' | 'finish', n: number) => {
      const p = pos(n), h = o.squareSide_m / 2 + minSep;
      const mine = new Set(inc.get(n)!.map((k) => `e${k}`));
      for (const el of els) {
        if (el.owner === name || mine.has(el.owner)) continue;
        if (el.pts.some(([x, y]) => Math.abs(x - p[0]) < h && Math.abs(y - p[1]) < h)) bad.add(el.owner);
      }
    };
    sq('start', lat.start); sq('finish', lat.finish);
    if (!bad.size) break;
    if (attempts === 11) throw new Error(`Maze ${o.seed}: lines still touch after downgrading features (${[...bad].join(', ')}).`);
    for (const b of bad) {
      if (b.startsWith('e')) {
        const k = Number(b.slice(1));
        const inst = instanceAt.get(k);
        edgeFeat[k] = plain(k); instanceAt.delete(k);
        if (inst !== undefined && (tried.get(inst)?.size ?? 0) < 3) place(inst); // try it on another segment
      } else if (b.startsWith('n')) nodeKind.set(Number(b.slice(1)), { kind: 'plain', r: 0, spokes: [] });
    }
    els = build();
  }

  // Count features as drawn.
  const features: Partial<Record<Feature | 'ringSpokes', number>> = {};
  const bump = (f: Feature) => { features[f] = (features[f] ?? 0) + 1; };
  edgeFeat.forEach((f) => bump(f));
  for (const nk of nodeKind.values()) if (nk.kind === 'ring' && nk.spokes.length) features.ringSpokes = (features.ringSpokes ?? 0) + 1;
  for (const nk of nodeKind.values()) if (nk.kind !== 'plain') bump(nk.kind);

  // Put the start in a random corner (mirror the drawing).
  const corners = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const;
  const corner = corners[Math.floor(rng.next() * 4)];
  const fx = corner.endsWith('right'), fy = corner.startsWith('bottom');
  const m = ([x, y]: P2): P2 => [fx ? o.size_m - x : x, fy ? o.size_m - y : y];
  const S = m(pos(lat.start)), F = m(pos(lat.finish));
  return {
    seed: o.seed, size_m: o.size_m, lineWidth_m: lw,
    elements: els.filter((e) => e.owner !== 'start' && e.owner !== 'finish').map((e) => ({ owner: e.owner, pts: e.pts.map(m) })),
    start: { x: S[0], y: S[1], side: o.squareSide_m }, finish: { x: F[0], y: F[1], side: o.squareSide_m },
    corner, features, nodes: lat.used.length, edges: lat.edges.length, loops: lat.loops, attempts,
  };
}

// Rasterise to a grey image (0 = black line, 255 = white mat) at `res` metres per pixel.
export function renderMaze(g: GeneratedMaze, res = 0.002): { gray: Uint8ClampedArray; width: number; height: number } {
  const W = Math.round(g.size_m / res);
  const gray = new Uint8ClampedArray(W * W).fill(255);
  const r = g.lineWidth_m / 2;
  const seg = (a: P2, b: P2) => {
    const x0 = Math.max(0, Math.floor((Math.min(a[0], b[0]) - r) / res)), x1 = Math.min(W - 1, Math.ceil((Math.max(a[0], b[0]) + r) / res));
    const y0 = Math.max(0, Math.floor((Math.min(a[1], b[1]) - r) / res)), y1 = Math.min(W - 1, Math.ceil((Math.max(a[1], b[1]) + r) / res));
    const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
    for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) {
      const px = (x + 0.5) * res, py = (y + 0.5) * res;
      const t = L2 ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / L2)) : 0;
      if (Math.hypot(px - a[0] - t * dx, py - a[1] - t * dy) <= r) gray[y * W + x] = 0;
    }
  };
  for (const el of g.elements) for (let k = 0; k < el.pts.length - 1; k += 1) seg(el.pts[k], el.pts[k + 1]);
  for (const s of [g.start, g.finish]) {
    for (let y = Math.floor((s.y - s.side / 2) / res); y < (s.y + s.side / 2) / res; y += 1) for (let x = Math.floor((s.x - s.side / 2) / res); x < (s.x + s.side / 2) / res; x += 1) if (x >= 0 && y >= 0 && x < W && y < W) gray[y * W + x] = 0;
  }
  return { gray, width: W, height: W };
}
