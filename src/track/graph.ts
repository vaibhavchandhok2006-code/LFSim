// Junction graph of a track: nodes = junctions and line ends, edges = line segments between them.
// Used for the ideal-path overlay and validation ONLY. Robot brains never see this.

import { Track } from './track';

export interface GNode { id: number; x: number; y: number; degree: number } // x, y in metres
export interface GEdge { id: number; a: number; b: number; pts: [number, number][]; length_m: number }
export interface JunctionGraph { nodes: Map<number, GNode>; edges: GEdge[]; start: number | null; finish: number | null }

// Zhang–Suen thinning on a binary image (1 = line). Modifies in place.
export function thin(img: Uint8Array, w: number, h: number): void {
  const del: number[] = [];
  let changed = true;
  const P = (x: number, y: number) => img[y * w + x];
  while (changed) {
    changed = false;
    for (let pass = 0; pass < 2; pass += 1) {
      del.length = 0;
      for (let y = 1; y < h - 1; y += 1) {
        for (let x = 1; x < w - 1; x += 1) {
          if (!img[y * w + x]) continue;
          const p2 = P(x, y - 1), p3 = P(x + 1, y - 1), p4 = P(x + 1, y), p5 = P(x + 1, y + 1);
          const p6 = P(x, y + 1), p7 = P(x - 1, y + 1), p8 = P(x - 1, y), p9 = P(x - 1, y - 1);
          const B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
          if (B < 2 || B > 6) continue;
          const seq = [p2, p3, p4, p5, p6, p7, p8, p9, p2];
          let A = 0;
          for (let k = 0; k < 8; k += 1) if (seq[k] === 0 && seq[k + 1] === 1) A += 1;
          if (A !== 1) continue;
          if (pass === 0 ? (p2 * p4 * p6 !== 0 || p4 * p6 * p8 !== 0) : (p2 * p4 * p8 !== 0 || p2 * p6 * p8 !== 0)) continue;
          del.push(y * w + x);
        }
      }
      if (del.length) { changed = true; for (const i of del) img[i] = 0; }
    }
  }
}

const N8 = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]] as const;

// Number of separate skeleton branches around a pixel (0->1 transitions around its 8 neighbours).
// Unlike a plain neighbour count, staircase pixels on diagonal lines don't count as junctions.
function crossings(sk: Uint8Array, w: number, i: number): number {
  const x = i % w, y = (i - x) / w;
  const ring = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];
  let c = 0;
  for (let k = 0; k < 8; k += 1) {
    const [ax, ay] = ring[k], [bx, by] = ring[(k + 1) % 8];
    if (!sk[(y + ay) * w + x + ax] && sk[(y + by) * w + x + bx]) c += 1;
  }
  return c;
}

// Branches leaving a square ring of radius r around a pixel. Thinning can leave a small blob where lines meet (no single
// pixel then has 3 crossings); counted on a ring a few pixels out, the branches still show.
function ringCrossings(sk: Uint8Array, w: number, h: number, i: number, r: number): number {
  const x = i % w, y = (i - x) / w;
  if (x < r || y < r || x >= w - r || y >= h - r) return 0;
  const ring: number[] = [];
  for (let k = -r; k < r; k += 1) ring.push((y - r) * w + x + k);
  for (let k = -r; k < r; k += 1) ring.push((y + k) * w + x + r);
  for (let k = r; k > -r; k -= 1) ring.push((y + r) * w + x + k);
  for (let k = r; k > -r; k -= 1) ring.push((y + k) * w + x - r);
  let c = 0;
  for (let k = 0; k < ring.length; k += 1) if (!sk[ring[k]] && sk[ring[(k + 1) % ring.length]]) c += 1;
  return c;
}

function degreeAt(sk: Uint8Array, w: number, i: number): number {
  const x = i % w, y = (i - x) / w;
  let d = 0;
  for (const [dx, dy] of N8) d += sk[(y + dy) * w + x + dx];
  return d;
}

export function buildGraph(t: Track): JunctionGraph {
  const { w, h } = t;
  const sk = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y += 1) for (let x = 1; x < w - 1; x += 1) sk[y * w + x] = t.dark[y * w + x] > 0.5 ? 1 : 0;
  // Remove start/finish squares; the line stubs that leave them become the start/finish ends.
  for (const r of [t.start, t.finish]) {
    if (!r) continue;
    for (let y = Math.max(0, Math.floor(r.y0) - 2); y <= Math.min(h - 1, Math.ceil(r.y1) + 2); y += 1)
      for (let x = Math.max(0, Math.floor(r.x0) - 2); x <= Math.min(w - 1, Math.ceil(r.x1) + 2); x += 1) sk[y * w + x] = 0;
  }
  thin(sk, w, h);

  // Prune short spurs (thinning artefacts at thick corners).
  for (let round = 0; round < 3; round += 1) {
    let removed = 0;
    for (let i = 0; i < w * h; i += 1) {
      if (!sk[i] || degreeAt(sk, w, i) !== 1) continue;
      const path = [i];
      let cur = i, prev = -1, ok = false;
      while (path.length <= 12) {
        const x = cur % w, y = (cur - x) / w;
        const nb: number[] = [];
        for (const [dx, dy] of N8) { const j = (y + dy) * w + x + dx; if (sk[j] && j !== prev && !path.includes(j)) nb.push(j); }
        if (nb.length === 0) break;
        if (nb.length >= 2 && crossings(sk, w, cur) >= 3) { ok = true; break; }
        prev = cur; cur = nb[0]; path.push(cur);
        if (crossings(sk, w, cur) >= 3) { ok = true; break; }
      }
      if (ok && path.length <= 12) { for (const p of path.slice(0, -1)) sk[p] = 0; removed += 1; }
    }
    if (!removed) break;
  }

  // Node pixels: junctions (degree >= 3) grown by 3 px, plus endpoints.
  const nodeMask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i += 1) {
    if (!sk[i]) continue;
    const d = degreeAt(sk, w, i);
    if (crossings(sk, w, i) >= 3 || (d >= 3 && ringCrossings(sk, w, h, i, 3) >= 3)) {
      const x = i % w, y = (i - x) / w;
      for (let dy = -3; dy <= 3; dy += 1) for (let dx = -3; dx <= 3; dx += 1) { const j = (y + dy) * w + x + dx; if (sk[j]) nodeMask[j] = 1; }
    } else if (d === 1) nodeMask[i] = 1;
  }
  const label = new Int32Array(w * h);
  const nodePix = new Map<number, number[]>();
  let nl = 0;
  for (let i = 0; i < w * h; i += 1) {
    if (!nodeMask[i] || label[i]) continue;
    nl += 1; const pix: number[] = []; const st = [i]; label[i] = nl;
    while (st.length) {
      const j = st.pop()!; pix.push(j);
      const x = j % w, y = (j - x) / w;
      for (const [dx, dy] of N8) { const k = (y + dy) * w + x + dx; if (nodeMask[k] && !label[k]) { label[k] = nl; st.push(k); } }
    }
    nodePix.set(nl, pix);
  }
  const nodes = new Map<number, GNode>();
  for (const [id, pix] of nodePix) {
    let sx = 0, sy = 0;
    for (const p of pix) { sx += p % w; sy += Math.floor(p / w); }
    nodes.set(id, { id, x: ((sx / pix.length) + 0.5) * t.res, y: ((sy / pix.length) + 0.5) * t.res, degree: 0 });
  }

  // Edges: skeleton pixels that are not node pixels, traced in order.
  const seen = new Uint8Array(w * h);
  const edges: GEdge[] = [];
  const nodeTouching = (i: number): number => {
    const x = i % w, y = (i - x) / w;
    for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) { const j = (y + dy) * w + x + dx; if (j >= 0 && j < w * h && label[j]) return label[j]; }
    return 0;
  };
  for (let i = 0; i < w * h; i += 1) {
    if (!sk[i] || nodeMask[i] || seen[i]) continue;
    // collect component
    const comp: number[] = []; const st = [i]; seen[i] = 1;
    while (st.length) {
      const j = st.pop()!; comp.push(j);
      const x = j % w, y = (j - x) / w;
      for (const [dx, dy] of N8) { const k = (y + dy) * w + x + dx; if (sk[k] && !nodeMask[k] && !seen[k]) { seen[k] = 1; st.push(k); } }
    }
    const inComp = new Set(comp);
    const nbr = (j: number) => { const x = j % w, y = (j - x) / w; const out: number[] = []; for (const [dx, dy] of N8) { const k = (y + dy) * w + x + dx; if (inComp.has(k)) out.push(k); } return out; };
    // Ends = pixels next to a node (or with a single neighbour). Order the pixels by a shortest path between the two
    // ends farthest apart, so staircase pixels can't derail the trace.
    let ends = comp.filter((j) => nodeTouching(j));
    if (ends.length < 2) ends = comp.filter((j) => nbr(j).length <= 1);
    if (!ends.length) continue;
    const bfs = (from: number) => {
      const prevMap = new Map<number, number>([[from, -1]]); const q = [from]; let last = from;
      for (let qi = 0; qi < q.length; qi += 1) { const j = q[qi]; last = j; for (const k of nbr(j)) if (!prevMap.has(k)) { prevMap.set(k, j); q.push(k); } }
      return { prevMap, q, last };
    };
    const first = bfs(ends[0]);
    let far = ends[0], fd = -1;
    for (const e of ends) { const d = first.q.indexOf(e); if (d > fd) { fd = d; far = e; } }
    const second = bfs(far);
    let tgt = far, td = -1;
    for (const e of ends) { const d = second.q.indexOf(e); if (d > td) { td = d; tgt = e; } }
    const order: number[] = [];
    for (let c = tgt; c !== -1; c = second.prevMap.get(c)!) order.push(c);
    const A = nodeTouching(order[0]), B = nodeTouching(order[order.length - 1]);
    if (!A || !B) continue;
    const na = nodes.get(A)!, nb = nodes.get(B)!;
    const pts: [number, number][] = [[na.x, na.y], ...order.map((j): [number, number] => [((j % w) + 0.5) * t.res, (Math.floor(j / w) + 0.5) * t.res]), [nb.x, nb.y]];
    edges.push({ id: edges.length, a: A, b: B, pts, length_m: 0 });
  }

  // Merge junction nodes closer than 5 cm (one physical junction split by thinning).
  const mergeInto = (keep: number, drop: number) => {
    const k = nodes.get(keep)!, d = nodes.get(drop)!;
    k.x = (k.x + d.x) / 2; k.y = (k.y + d.y) / 2;
    for (const e of edges) { if (e.a === drop) e.a = keep; if (e.b === drop) e.b = keep; }
    nodes.delete(drop);
  };
  const plen = (pts: [number, number][]) => { let s = 0; for (let k = 1; k < pts.length; k += 1) s += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]); return s; };
  let changed = true;
  while (changed) {
    changed = false;
    const ids = [...nodes.keys()];
    outer: for (let p = 0; p < ids.length; p += 1) for (let q = p + 1; q < ids.length; q += 1) {
      const a = nodes.get(ids[p]), b = nodes.get(ids[q]);
      if (!a || !b) continue;
      if (Math.hypot(a.x - b.x, a.y - b.y) < 0.05) { mergeInto(a.id, b.id); changed = true; break outer; }
    }
    for (let k = edges.length - 1; k >= 0; k -= 1) {
      const e = edges[k];
      if (e.a === e.b && plen(e.pts) < 0.08) { edges.splice(k, 1); changed = true; }
      else if (e.a !== e.b && plen(e.pts) < 0.055) { mergeInto(e.a, e.b); edges.splice(k, 1); changed = true; break; }
    }
  }
  for (const e of edges) {
    const a = nodes.get(e.a)!, b = nodes.get(e.b)!;
    e.pts[0] = [a.x, a.y]; e.pts[e.pts.length - 1] = [b.x, b.y];
    e.length_m = plen(e.pts);
  }
  edges.forEach((e, i) => { e.id = i; });
  for (const n of nodes.values()) n.degree = 0;
  for (const e of edges) { nodes.get(e.a)!.degree += 1; nodes.get(e.b)!.degree += 1; }

  // Start / finish = line ends nearest each square.
  const endNear = (r: Track['start']) => {
    if (!r) return null;
    const cx = ((r.x0 + r.x1) / 2) * t.res, cy = ((r.y0 + r.y1) / 2) * t.res;
    let best: number | null = null, bd = Infinity;
    for (const n of nodes.values()) { if (n.degree !== 1) continue; const d = Math.hypot(n.x - cx, n.y - cy); if (d < bd) { bd = d; best = n.id; } }
    return best;
  };
  return { nodes, edges, start: endNear(t.start), finish: endNear(t.finish) };
}

// ---------------- graph-level navigation (reference results, overlay) ----------------

export type Rule = 'left' | 'right' | 'straight-left' | 'straight-right';
export interface GraphRun { ok: boolean; route: { edge: number; dir: 1 | -1 }[]; length_m: number; decisions: { node: number; turn_deg: number; kind: 'L' | 'S' | 'R' | 'B' }[] }

function oriented(g: JunctionGraph, edge: number, dir: 1 | -1) { const p = g.edges[edge].pts; return dir > 0 ? p : [...p].reverse(); }
function headingAlong(pts: [number, number][], fromStart: boolean, look = 0.06): number {
  const seq = fromStart ? pts : [...pts].reverse();
  let acc = 0;
  for (let k = 1; k < seq.length; k += 1) {
    acc += Math.hypot(seq[k][0] - seq[k - 1][0], seq[k][1] - seq[k - 1][1]);
    if (acc >= look) return fromStart ? Math.atan2(seq[k][1] - seq[0][1], seq[k][0] - seq[0][0]) : Math.atan2(seq[0][1] - seq[k][1], seq[0][0] - seq[k][0]);
  }
  const a = seq[0], b = seq[seq.length - 1];
  return fromStart ? Math.atan2(b[1] - a[1], b[0] - a[0]) : Math.atan2(a[1] - b[1], a[0] - b[0]);
}
const wrapDeg = (d: number) => ((d + 180) % 360 + 360) % 360 - 180;

export function adjacency(g: JunctionGraph) {
  const adj = new Map<number, { edge: number; dir: 1 | -1 }[]>();
  for (const e of g.edges) {
    if (!adj.has(e.a)) adj.set(e.a, []);
    if (!adj.has(e.b)) adj.set(e.b, []);
    adj.get(e.a)!.push({ edge: e.id, dir: 1 });
    adj.get(e.b)!.push({ edge: e.id, dir: -1 });
  }
  return adj;
}

// Turn angle in degrees (+ = left) from arriving along (edge,dir) to leaving along (edge2,dir2).
// The image frame is y-down, so a left turn is a negative change in atan2 angle.
export function turnAngle(g: JunctionGraph, inE: number, inD: 1 | -1, outE: number, outD: 1 | -1): number {
  const hin = headingAlong(oriented(g, inE, inD), false);
  const hout = headingAlong(oriented(g, outE, outD), true);
  return wrapDeg(-((hout - hin) * 180) / Math.PI);
}

export function runRule(g: JunctionGraph, rule: Rule, maxSteps = 3000): GraphRun {
  const adj = adjacency(g);
  if (g.start === null || g.finish === null) return { ok: false, route: [], length_m: 0, decisions: [] };
  let cur = adj.get(g.start)![0];
  const route = [cur];
  const decisions: GraphRun['decisions'] = [];
  const seen = new Set<string>();
  for (let s = 0; s < maxSteps; s += 1) {
    const e = g.edges[cur.edge];
    const node = cur.dir > 0 ? e.b : e.a;
    if (node === g.finish) return { ok: true, route, length_m: route.reduce((a, r) => a + g.edges[r.edge].length_m, 0), decisions };
    const opts = adj.get(node)!.filter((o) => !(o.edge === cur.edge && o.dir === -cur.dir));
    if (!opts.length) { decisions.push({ node, turn_deg: 180, kind: 'B' }); cur = { edge: cur.edge, dir: (-cur.dir) as 1 | -1 }; route.push(cur); continue; }
    const scored = opts.map((o) => ({ o, t: turnAngle(g, cur.edge, cur.dir, o.edge, o.dir) }));
    let pick = scored[0];
    if (rule === 'left') pick = scored.reduce((a, b) => (b.t > a.t ? b : a));
    else if (rule === 'right') pick = scored.reduce((a, b) => (b.t < a.t ? b : a));
    else {
      const st = scored.filter((x) => Math.abs(x.t) <= 35);
      pick = st.length ? st.reduce((a, b) => (Math.abs(b.t) < Math.abs(a.t) ? b : a))
        : rule === 'straight-left' ? scored.reduce((a, b) => (b.t > a.t ? b : a)) : scored.reduce((a, b) => (b.t < a.t ? b : a));
    }
    if (adj.get(node)!.length >= 3) decisions.push({ node, turn_deg: pick.t, kind: pick.t > 35 ? 'L' : pick.t < -35 ? 'R' : 'S' });
    const key = `${node}:${cur.edge}:${cur.dir}`;
    if (seen.has(key)) return { ok: false, route, length_m: route.reduce((a, r) => a + g.edges[r.edge].length_m, 0), decisions };
    seen.add(key);
    cur = pick.o; route.push(cur);
  }
  return { ok: false, route, length_m: 0, decisions };
}

// Dead-end cancellation (what LSRB run 2 drives): remove out-and-back pairs from a route.
export function cancelDeadEnds(route: GraphRun['route']): GraphRun['route'] {
  const st: GraphRun['route'] = [];
  for (const r of route) {
    const top = st[st.length - 1];
    if (top && top.edge === r.edge && top.dir === -r.dir) st.pop(); else st.push(r);
  }
  return st;
}

// Ideal path: shortest route from start to finish (Dijkstra on edge lengths).
export function shortestPath(g: JunctionGraph): GraphRun {
  if (g.start === null || g.finish === null) return { ok: false, route: [], length_m: 0, decisions: [] };
  const adj = adjacency(g);
  const dist = new Map<number, number>([[g.start, 0]]);
  const prev = new Map<number, { edge: number; dir: 1 | -1; from: number }>();
  const todo = new Set<number>([g.start]);
  while (todo.size) {
    let u = -1, best = Infinity;
    for (const n of todo) { const d = dist.get(n)!; if (d < best) { best = d; u = n; } }
    todo.delete(u);
    if (u === g.finish) break;
    for (const o of adj.get(u) ?? []) {
      const e = g.edges[o.edge];
      const v = o.dir > 0 ? e.b : e.a;
      const nd = best + e.length_m;
      if (nd < (dist.get(v) ?? Infinity)) { dist.set(v, nd); prev.set(v, { edge: o.edge, dir: o.dir, from: u }); todo.add(v); }
    }
  }
  if (!dist.has(g.finish)) return { ok: false, route: [], length_m: 0, decisions: [] };
  const route: GraphRun['route'] = [];
  let n = g.finish;
  while (n !== g.start) { const p = prev.get(n)!; route.unshift({ edge: p.edge, dir: p.dir }); n = p.from; }
  return { ok: true, route, length_m: dist.get(g.finish)!, decisions: [] };
}

export function routePoints(g: JunctionGraph, route: GraphRun['route']): [number, number][] {
  const out: [number, number][] = [];
  for (const r of route) { const p = oriented(g, r.edge, r.dir); out.push(...(out.length ? p.slice(1) : p)); }
  return out;
}
