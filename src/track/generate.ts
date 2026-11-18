// Seeded Robo-Run maze generator. A maze is carved on a coarse lattice of junction points (a spanning tree plus a few
// extra edges for loops), then each edge and junction is drawn with a feature seen on real Shaastra mazes: zigzags,
// arcs, S-bends, rectangle / oval / diamond / triangle loops, dead-end stubs and combs, rings with spokes, rounded
// corners and diagonals. The drawing is checked for unintended contact between lines, then rasterised at 2 mm/px.
// Pure TypeScript (no Node, no DOM): the same seed always gives the same maze.

import { Rng } from '../sim/sensors';

export type Feature =
  | 'straight' | 'zigzag' | 'arc' | 'sbend' | 'box' | 'boxSide' | 'oval' | 'diamond' | 'triangles'
  | 'stub' | 'comb' | 'ring' | 'curve' | 'diagonal';

export const FEATURES: Feature[] = ['straight', 'zigzag', 'arc', 'sbend', 'box', 'boxSide', 'oval', 'diamond', 'triangles', 'stub', 'comb', 'ring', 'curve', 'diagonal'];

export interface GenOptions {
  seed: number;
  size_m: number;          // mat side (Robo-Run: 10 × 25 cm = 2.5 m)
  cell_m: number;          // rulebook unit square (start square sits in the corner cell)
  lineWidth_cm: [number, number]; // drawn width is chosen per maze in this range
  lattice: number;         // junction lattice points per side
  dropFrac: [number, number]; // share of lattice points left unused
  loopFrac: [number, number]; // extra edges (loops) per used point
  diagonalP: number;       // chance a tree edge may be a diagonal
  // Relative weights of edge features (an edge that cannot fit its feature is drawn straight).
  edgeMix: Partial<Record<Feature, number>>;
  ringP: number;           // chance a junction (3+ lines) is drawn as a ring
  curveP: number;          // chance a 90° bend is rounded
  squareSide_m: number;    // start / finish square side (assumption: 20 cm, inside a 25 cm cell)
}

export const DEFAULT_GEN: Omit<GenOptions, 'seed'> = {
  size_m: 2.5, cell_m: 0.25, lineWidth_cm: [3, 4], lattice: 7, dropFrac: [0.0, 0.08], loopFrac: [0.3, 0.55], diagonalP: 0.12,
  edgeMix: { straight: 2.2, zigzag: 1.1, arc: 0.9, sbend: 1.1, box: 1.1, boxSide: 0.9, oval: 0.7, diamond: 0.8, triangles: 0.7, stub: 1.4, comb: 0.8 },
  ringP: 0.25, curveP: 0.7, squareSide_m: 0.2,
};

type P2 = [number, number];
export interface GenElement { pts: P2[]; owner: string } // a drawn polyline; owner = the edge or junction it belongs to
export interface GeneratedMaze {
  seed: number;
  size_m: number;
  lineWidth_m: number;
  elements: GenElement[];
  start: { x: number; y: number; side: number };
  finish: { x: number; y: number; side: number };
  corner: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  features: Partial<Record<Feature, number>>; // count of each feature drawn
  nodes: number; edges: number; loops: number;
  attempts: number;        // feature downgrades needed to clear contacts
}

// ---------------------------------------------------------------- lattice carving

interface LEdge { a: number; b: number; diag: boolean }

function carve(o: GenOptions, rng: Rng) {
  const K = o.lattice;
  const id = (i: number, j: number) => j * K + i;
  const keep = new Array(K * K).fill(true);
  const drop = o.dropFrac[0] + rng.next() * (o.dropFrac[1] - o.dropFrac[0]);
  for (let n = 0; n < K * K; n += 1) if (n !== id(0, 0) && n !== id(1, 0) && n !== id(0, 1) && rng.next() < drop) keep[n] = false;
  const neighbours = (n: number, diag: boolean) => {
    const i = n % K, j = Math.floor(n / K), out: { m: number; diag: boolean }[] = [];
    const d4 = [[1, 0], [-1, 0], [0, 1], [0, -1]], dd = [[1, 1], [-1, 1], [1, -1], [-1, -1]];
    for (const [a, b] of d4) { const x = i + a, y = j + b; if (x >= 0 && y >= 0 && x < K && y < K) out.push({ m: id(x, y), diag: false }); }
    if (diag) for (const [a, b] of dd) { const x = i + a, y = j + b; if (x >= 0 && y >= 0 && x < K && y < K) out.push({ m: id(x, y), diag: true }); }
    return out.filter((q) => keep[q.m] && q.m !== id(0, 0));
  };
  const cellOf = (a: number, b: number) => Math.min(a % K, b % K) + Math.min(Math.floor(a / K), Math.floor(b / K)) * K;
  const diagCells = new Set<number>();
  const edges: LEdge[] = [];
  const has = new Set<string>();
  const key = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);
  const add = (a: number, b: number, diag: boolean) => { edges.push({ a, b, diag }); has.add(key(a, b)); if (diag) diagCells.add(cellOf(a, b)); };

  // Start (lattice corner) → its only neighbour; the start square must have a single exit.
  const first = rng.next() < 0.5 ? id(1, 0) : id(0, 1);
  add(id(0, 0), first, false);
  // Randomised depth-first spanning tree from there.
  const seen = new Set<number>([id(0, 0), first]);
  const stack = [first];
  while (stack.length) {
    const c = stack[stack.length - 1];
    const nb = neighbours(c, rng.next() < o.diagonalP).filter((q) => !seen.has(q.m) && !(q.diag && diagCells.has(cellOf(c, q.m))));
    if (!nb.length) { stack.pop(); continue; }
    // Prefer orthogonal moves; diagonals stay a minority.
    const q = nb[Math.floor(rng.next() * nb.length)];
    add(c, q.m, q.diag); seen.add(q.m); stack.push(q.m);
  }
  const used = [...seen];
  const degree = (n: number) => edges.filter((e) => e.a === n || e.b === n).length;
  // Hops from the start, for choosing a far finish.
  const hops = new Map<number, number>([[id(0, 0), 0]]);
  const q: number[] = [id(0, 0)];
  while (q.length) { const c = q.shift()!; for (const e of edges) { const m = e.a === c ? e.b : e.b === c ? e.a : -1; if (m >= 0 && !hops.has(m)) { hops.set(m, hops.get(c)! + 1); q.push(m); } } }
  const leaves = used.filter((n) => n !== id(0, 0) && n !== first && degree(n) === 1).sort((a, b) => hops.get(b)! - hops.get(a)!);
  if (!leaves.length) return null;
  const pool = leaves.slice(0, Math.max(1, Math.ceil(leaves.length / 3)));
  const finish = pool[Math.floor(rng.next() * pool.length)];
  // Loops: extra edges between used points, never touching the start or the finish.
  const loopFrac = o.loopFrac[0] + rng.next() * (o.loopFrac[1] - o.loopFrac[0]);
  const want = Math.round(loopFrac * used.length);
  const cands: LEdge[] = [];
  for (const a of used) for (const nb of neighbours(a, true)) {
    const b = nb.m;
    if (b <= a || !seen.has(b) || has.has(key(a, b)) || a === finish || b === finish || a === id(0, 0) || b === id(0, 0)) continue;
    if (nb.diag && rng.next() > 0.3) continue;
    cands.push({ a, b, diag: nb.diag });
  }
  let loops = 0;
  while (loops < want && cands.length) {
    const k = Math.floor(rng.next() * cands.length);
    const c = cands.splice(k, 1)[0];
    if (has.has(key(c.a, c.b)) || (c.diag && diagCells.has(cellOf(c.a, c.b)))) continue;
    add(c.a, c.b, c.diag); loops += 1;
  }
  return { K, edges, start: id(0, 0), finish, used, loops };
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
type Local = P2[][];
const range = (rng: Rng, a: number, b: number) => a + rng.next() * (b - a);
const side = (rng: Rng) => (rng.next() < 0.5 ? 1 : -1);

function buildEdge(f: Feature, L: number, rng: Rng, across: number): Local | null {
  // `across` = free room on each side of the edge (m) before another lattice edge.
  const lead = 0.06;
  const s = side(rng);
  switch (f) {
    case 'straight': case 'diagonal': return [[[0, 0], [L, 0]]];
    case 'zigzag': {
      const M = L - 2 * lead, a = Math.min(range(rng, 0.06, 0.11), across - 0.06), k = Math.floor(M / range(rng, 0.09, 0.13));
      if (k < 2 || a < 0.05) return null;
      const pts: P2[] = [[0, 0], [lead, 0]];
      for (let i = 1; i < 2 * k; i += 1) pts.push([lead + (M * i) / (2 * k), i % 2 ? a * s : 0]);
      pts.push([L - lead, 0], [L, 0]);
      return [pts];
    }
    case 'arc': {
      const r = Math.min(range(rng, 0.05, 0.09), across - 0.05), m = L / 2;
      if (r < 0.045 || m - r < lead) return null;
      return [[[0, 0], ...arcPts(m, 0, r, Math.PI, s > 0 ? 0 : 2 * Math.PI).map(([x, y]) => [x, s > 0 ? Math.abs(y) : -Math.abs(y)] as P2), [L, 0]]];
    }
    case 'sbend': {
      const w = range(rng, 0.085, 0.11), a = Math.min(range(rng, 0.06, 0.09), across - w / 2 - 0.05), m = rng.next() < 0.5 ? 2 : 3;
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
      const bl = f === 'oval' ? range(rng, 0.15, 0.2) : range(rng, 0.13, 0.2);
      const h = Math.min(f === 'boxSide' ? range(rng, 0.09, 0.12) : range(rng, 0.06, 0.1), across - 0.05);
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
      const bl = f === 'triangles' ? range(rng, 0.1, 0.13) : range(rng, 0.12, 0.16), gap = 0.035, h = Math.min(range(rng, 0.07, 0.1), across - 0.05);
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
      const sl = Math.min(range(rng, 0.07, 0.13), across - 0.06), sp = range(rng, 0.085, 0.11);
      const ang = f === 'stub' && rng.next() < 0.35 ? Math.PI / 4 : Math.PI / 2;
      const span = (n - 1) * sp;
      let x = (L - span) / 2 + (f === 'stub' ? range(rng, -0.05, 0.05) : 0);
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
    default: return null;
  }
}

// ---------------------------------------------------------------- contact check

// True if two different drawn lines come closer than `minSep` anywhere except where they are meant to meet.
// Near a junction, lines that meet at an angle are close for a while; that is meant. Two points count as touching
// by accident only if the way between them along the lines (via the junction) is much longer than the gap.
function contacts(els: GenElement[], minSep: number, joinR: number, size: number, margin: number): Set<string> {
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

function pick<T extends string>(rng: Rng, w: Partial<Record<T, number>>): T {
  const ent = Object.entries(w) as [T, number][];
  const tot = ent.reduce((a, [, v]) => a + Math.max(0, v), 0);
  let r = rng.next() * tot;
  for (const [k, v] of ent) { r -= Math.max(0, v); if (r <= 0) return k; }
  return ent[0][0];
}

export function generateMaze(opts: Partial<GenOptions> & { seed: number }): GeneratedMaze {
  const o: GenOptions = { ...DEFAULT_GEN, ...opts };
  const rng = new Rng(Math.imul(o.seed >>> 0, 2654435761) ^ 0x9e3779b9);
  let lat = carve(o, rng);
  for (let t = 0; !lat && t < 20; t += 1) lat = carve(o, rng);
  if (!lat) throw new Error('Could not carve a maze with a finish leaf.');
  const lw = (o.lineWidth_cm[0] + rng.next() * (o.lineWidth_cm[1] - o.lineWidth_cm[0])) / 100;
  const K = lat.K;
  const off = o.cell_m / 2;
  const pitch = (o.size_m - 2 * off) / (K - 1);
  const pos = (n: number): P2 => [off + (n % K) * pitch, off + Math.floor(n / K) * pitch];
  const inc = new Map<number, number[]>(); // node → edge indices
  lat.edges.forEach((e, k) => { for (const n of [e.a, e.b]) { const a = inc.get(n); if (a) a.push(k); else inc.set(n, [k]); } });
  const dirFrom = (n: number, k: number): P2 => { const e = lat!.edges[k]; const m = e.a === n ? e.b : e.a; const d = sub(pos(m), pos(n)); const l = len(d); return [d[0] / l, d[1] / l]; };

  // Per-junction treatment and per-edge feature, chosen once; contacts downgrade them to plain drawings.
  const nodeKind = new Map<number, { kind: 'plain' | 'ring' | 'curve'; r: number; spokes: number[] }>();
  for (const [n, ks] of inc) {
    const special = n === lat.start || n === lat.finish;
    if (!special && ks.length >= 3 && rng.next() < o.ringP) {
      const R = range(rng, 0.065, 0.1);
      const used = ks.map((k) => Math.atan2(dirFrom(n, k)[1], dirFrom(n, k)[0]));
      const spokes: number[] = [];
      const nsp = Math.floor(rng.next() * 4);
      for (let t = 0; t < 12 && spokes.length < nsp; t += 1) {
        const a = rng.next() * 2 * Math.PI;
        const clear = [...used, ...spokes].every((u) => Math.abs(((a - u + 3 * Math.PI) % (2 * Math.PI)) - Math.PI) > 0.75);
        if (clear) spokes.push(a);
      }
      nodeKind.set(n, { kind: 'ring', r: R, spokes });
    } else if (!special && ks.length === 2) {
      const d1 = dirFrom(n, ks[0]), d2 = dirFrom(n, ks[1]);
      const perp = Math.abs(d1[0] * d2[0] + d1[1] * d2[1]) < 0.05;
      nodeKind.set(n, perp && rng.next() < o.curveP ? { kind: 'curve', r: range(rng, 0.06, 0.13), spokes: [] } : { kind: 'plain', r: 0, spokes: [] });
    } else nodeKind.set(n, { kind: 'plain', r: 0, spokes: [] });
  }
  const edgeFeat: Feature[] = lat.edges.map((e) => {
    if (e.a === lat!.start || e.b === lat!.start) return 'straight';
    const f = pick(rng, o.edgeMix);
    if (e.diag) return f === 'zigzag' || f === 'stub' || f === 'arc' ? f : 'diagonal';
    return f;
  });
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
      let loc = L > 0.1 ? buildEdge(edgeFeat[k], L, r, across) : null;
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
  const minSep = lw + 0.035;
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
      if (b.startsWith('e')) { const k = Number(b.slice(1)); edgeFeat[k] = lat.edges[k].diag ? 'diagonal' : 'straight'; }
      else if (b.startsWith('n')) nodeKind.set(Number(b.slice(1)), { kind: 'plain', r: 0, spokes: [] });
    }
    els = build();
  }

  // Count features as drawn.
  const features: Partial<Record<Feature, number>> = {};
  const bump = (f: Feature) => { features[f] = (features[f] ?? 0) + 1; };
  edgeFeat.forEach((f) => bump(f));
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
