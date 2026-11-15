// Maze navigation decisions for Settings mode. Navigators only see what the robot measured at a junction:
// branch angles from its own 360° scan and its odometry pose estimate. They never see the track.

export interface JunctionView {
  branches: number[];      // branch angles in degrees, + = left of the arrival heading, sorted leftmost first; back excluded
  arrivalYaw_deg: number;  // odometry heading on arrival (brain's own frame, + = left/CCW)
  x: number; y: number;    // odometry position estimate, m (brain's own frame)
}

export interface Choice { angle: number; rank: number | null; kind: 'L' | 'S' | 'R' | 'B'; note: string }

export interface Navigator {
  readonly id: string;
  choose(j: JunctionView, memory: Record<string, unknown>): Choice;
  finished(j: { x: number; y: number; yaw_deg: number }, memory: Record<string, unknown>): void;
}

export const kindOf = (a: number): Choice['kind'] => (Math.abs(a) > 150 ? 'B' : a > 35 ? 'L' : a < -35 ? 'R' : 'S');
const wrap = (d: number) => ((d + 180) % 360 + 360) % 360 - 180;
const back = (note = 'dead end'): Choice => ({ angle: 180, rank: null, kind: 'B', note });
const pick = (j: JunctionView, i: number, note: string): Choice => ({ angle: j.branches[i], rank: i, kind: kindOf(j.branches[i]), note });

function leftmost(j: JunctionView): Choice { return j.branches.length ? pick(j, 0, 'leftmost branch') : back(); }
function rightmost(j: JunctionView): Choice { return j.branches.length ? pick(j, j.branches.length - 1, 'rightmost branch') : back(); }
function straightFirst(j: JunctionView, fallback: 'left' | 'right'): Choice {
  if (!j.branches.length) return back();
  let best = -1;
  j.branches.forEach((a, i) => { if (Math.abs(a) <= 35 && (best < 0 || Math.abs(a) < Math.abs(j.branches[best]))) best = i; });
  if (best >= 0) return pick(j, best, 'straight available');
  return fallback === 'left' ? { ...leftmost(j), note: 'no straight: left fallback' } : { ...rightmost(j), note: 'no straight: right fallback' };
}

export class RuleNavigator implements Navigator {
  constructor(readonly id: 'left-hand' | 'right-hand' | 'straight-first' | 'custom', private opt: { fallback: 'left' | 'right'; order: string }) {}
  choose(j: JunctionView): Choice {
    if (this.id === 'left-hand') return leftmost(j);
    if (this.id === 'right-hand') return rightmost(j);
    if (this.id === 'straight-first') return straightFirst(j, this.opt.fallback);
    // custom priority: first available letter wins
    for (const c of this.opt.order.toUpperCase()) {
      if (c === 'B') return back('priority says turn back');
      const idx = j.branches.map((a, i) => ({ a, i })).filter(({ a }) => kindOf(a) === c);
      if (idx.length) {
        const i = c === 'R' ? idx[idx.length - 1].i : c === 'L' ? idx[0].i : idx.reduce((p, q) => (Math.abs(q.a) < Math.abs(p.a) ? q : p)).i;
        return pick(j, i, `priority ${this.opt.order}: ${c}`);
      }
    }
    return back();
  }
  finished(): void { /* nothing to remember */ }
}

// ---------------- LSRB with branch numbers ----------------
// Run 1: left-hand rule; every junction is pushed on a stack as {branches, arrival heading, chosen heading}.
// A dead end pushes a DEAD marker; the next junction (the same one, reached on the way back) replaces its
// stored choice with the new choice, which cancels the out-and-back. If the new choice heads back the way the
// robot originally arrived, that junction was itself a dead-end subtree and is cancelled too.
// Run 2 replays the stored branch numbers.

interface LsrbEntry { n: number; rank: number; rel: number; branchesRel: number[] }
interface LsrbMemory { entries: LsrbEntry[]; complete: boolean }

export class LsrbNavigator implements Navigator {
  readonly id = 'lsrb';
  private stack: (LsrbEntry | 'DEAD')[] = [];
  private replayIdx = 0;
  choose(j: JunctionView, memory: Record<string, unknown>): Choice {
    const mem = memory.lsrb as LsrbMemory | undefined;
    if (mem?.complete) {
      // Run 2: replay
      const e = mem.entries[this.replayIdx];
      this.replayIdx += 1;
      if (!e) return { ...leftmost(j), note: 'replay: path ended early, using left-hand' };
      if (!j.branches.length) return back('replay: unexpected dead end');
      if (j.branches.length === e.n) return pick(j, Math.min(e.rank, j.branches.length - 1), `replay #${this.replayIdx}: branch ${e.rank + 1} of ${e.n} from the left`);
      // branch count differs from run 1: fall back to the stored angle
      let bi = 0;
      j.branches.forEach((a, i) => { if (Math.abs(wrap(a - e.rel)) < Math.abs(wrap(j.branches[bi] - e.rel))) bi = i; });
      return pick(j, bi, `replay #${this.replayIdx}: saw ${j.branches.length} branches, expected ${e.n}; nearest angle`);
    }
    // Run 1: explore with the left-hand rule and reduce on the fly. Only turn angles measured at the junctions are
    // used (no absolute heading), so odometry drift cannot spoil the reduction: coming back out of a dead end into the
    // junction left by branch `rel`, the robot arrives facing rel + 180°, so its new choice c is, relative to the
    // original arrival, rel + 180° + c.
    const c = leftmost(j);
    if (!j.branches.length) { this.stack.push('DEAD'); return c; }
    const top = this.stack[this.stack.length - 1];
    if (top === 'DEAD') {
      this.stack.pop();
      const p = this.stack[this.stack.length - 1];
      if (p && p !== 'DEAD') {
        const relNew = wrap(p.rel + 180 + c.angle);
        if (Math.abs(wrap(relNew - 180)) >= 40) {
          let r = 0;
          p.branchesRel.forEach((a, i) => { if (Math.abs(wrap(a - relNew)) < Math.abs(wrap(p.branchesRel[r] - relNew))) r = i; });
          p.rank = r; p.rel = p.branchesRel[r];
          return { ...c, note: `left-hand; replaces the dead-end choice at this junction with branch ${r + 1} of ${p.n}` };
        }
        this.stack.pop(); // this junction led only to dead ends
        this.stack.push('DEAD');
        return { ...c, note: 'left-hand; junction leads only to dead ends, cancelled' };
      }
    }
    this.stack.push({ n: j.branches.length, rank: c.rank ?? 0, rel: c.angle, branchesRel: j.branches.slice() });
    return c;
  }
  finished(_j: unknown, memory: Record<string, unknown>): void {
    if ((memory.lsrb as LsrbMemory | undefined)?.complete) return;
    const entries = this.stack.filter((e): e is LsrbEntry => e !== 'DEAD');
    memory.lsrb = { entries, complete: true } satisfies LsrbMemory;
  }
}

// ---------------- Trémaux mapping + shortest path ----------------
// Run 1 explores with Trémaux's rule using odometry to recognise junctions it has seen before, measuring each
// passage's length. At the finish it computes the shortest known route. Run 2 drives that route.

interface TBranch { abs: number; marks: number; to: number | null; len: number }
interface TNode { id: number; x: number; y: number; branches: TBranch[] }
interface TremauxMemory { route: { x: number; y: number; abs: number }[]; complete: boolean; nodes: number }

const MATCH_M = 0.15;

export class TremauxNavigator implements Navigator {
  readonly id = 'tremaux';
  private nodes: TNode[] = [{ id: 0, x: 0, y: 0, branches: [{ abs: 0, marks: 1, to: null, len: 0 }] }]; // start
  private from: { node: number; branch: number; x: number; y: number; dist: number } | null = { node: 0, branch: 0, x: 0, y: 0, dist: 0 };
  private odoAtLeave = 0;
  private replayIdx = 0;
  odometry = 0; // set by the brain before each choose()

  choose(j: JunctionView, memory: Record<string, unknown>): Choice {
    const mem = memory.tremaux as TremauxMemory | undefined;
    if (mem?.complete) return this.replay(j, mem);
    const backAbs = j.arrivalYaw_deg + 180;
    // A junction is "seen before" if it is close by odometry AND has the same shape (same number of passages,
    // each within 30°). Shape matters on tracks where junctions are only a few cm apart.
    const absNow = [...j.branches.map((a) => j.arrivalYaw_deg + a), backAbs];
    const sameShape = (n: TNode) => n.branches.length === absNow.length && absNow.every((a) => n.branches.some((b) => Math.abs(wrap(b.abs - a)) < 30));
    let node = this.nodes.find((n) => n.id !== 0 && Math.hypot(n.x - j.x, n.y - j.y) < MATCH_M && sameShape(n));
    const isNew = !node;
    if (!node) {
      node = { id: this.nodes.length, x: j.x, y: j.y, branches: [...j.branches.map((a) => ({ abs: j.arrivalYaw_deg + a, marks: 0, to: null, len: 0 })), { abs: backAbs, marks: 0, to: null, len: 0 }] };
      this.nodes.push(node);
    }
    // the passage we arrived by
    const near = (abs: number) => node!.branches.reduce((bi, b, i) => (Math.abs(wrap(b.abs - abs)) < Math.abs(wrap(node!.branches[bi].abs - abs)) ? i : bi), 0);
    const inB = node.branches[near(backAbs)];
    const len = this.odometry - this.odoAtLeave;
    inB.marks += 1;
    if (this.from) {
      const fb = this.nodes[this.from.node].branches[this.from.branch];
      fb.to = node.id; fb.len = len; inB.to = this.from.node; inB.len = len;
    }
    let outIdx: number;
    const others = node.branches.map((b, i) => ({ b, i })).filter(({ i }) => i !== near(backAbs));
    // order candidates leftmost first relative to the arrival heading
    others.sort((p, q) => wrap(q.b.abs - j.arrivalYaw_deg) - wrap(p.b.abs - j.arrivalYaw_deg));
    if (!isNew && inB.marks === 1 && others.length) outIdx = near(backAbs); // reached a known junction by a new passage: go back
    else {
      const fresh = others.find(({ b }) => b.marks === 0);
      const once = others.find(({ b }) => b.marks === 1);
      outIdx = fresh ? fresh.i : inB.marks < 2 ? near(backAbs) : once ? once.i : near(backAbs);
    }
    const out = node.branches[outIdx];
    out.marks += 1;
    this.from = { node: node.id, branch: outIdx, x: j.x, y: j.y, dist: 0 };
    this.odoAtLeave = this.odometry;
    const rel = wrap(out.abs - j.arrivalYaw_deg);
    const isBack = outIdx === near(backAbs);
    const rank = isBack ? null : j.branches.reduce((bi, a, i) => (Math.abs(wrap(a - rel)) < Math.abs(wrap(j.branches[bi] - rel)) ? i : bi), 0);
    return { angle: isBack ? 180 : j.branches[rank!], rank, kind: isBack ? 'B' : kindOf(rel), note: `Trémaux at junction #${node.id}${isNew ? ' (new)' : ''}, passage marks ${out.marks}` };
  }

  finished(j: { x: number; y: number; yaw_deg: number }, memory: Record<string, unknown>): void {
    if ((memory.tremaux as TremauxMemory | undefined)?.complete) return;
    const fin: TNode = { id: this.nodes.length, x: j.x, y: j.y, branches: [{ abs: j.yaw_deg + 180, marks: 1, to: this.from?.node ?? null, len: this.odometry - this.odoAtLeave }] };
    this.nodes.push(fin);
    if (this.from) { const fb = this.nodes[this.from.node].branches[this.from.branch]; fb.to = fin.id; fb.len = this.odometry - this.odoAtLeave; }
    // Dijkstra over known passages
    const dist = new Map<number, number>([[0, 0]]); const prev = new Map<number, { node: number; abs: number }>();
    const todo = new Set([0]);
    while (todo.size) {
      let u = -1, best = Infinity;
      for (const n of todo) if ((dist.get(n) ?? Infinity) < best) { best = dist.get(n)!; u = n; }
      todo.delete(u);
      for (const b of this.nodes[u].branches) {
        if (b.to === null) continue;
        const nd = best + b.len;
        if (nd < (dist.get(b.to) ?? Infinity)) { dist.set(b.to, nd); prev.set(b.to, { node: u, abs: b.abs }); todo.add(b.to); }
      }
    }
    const route: TremauxMemory['route'] = [];
    let n = fin.id;
    while (prev.has(n)) { const p = prev.get(n)!; route.unshift({ x: this.nodes[p.node].x, y: this.nodes[p.node].y, abs: p.abs }); n = p.node; }
    memory.tremaux = { route: route.slice(1), complete: route.length > 0, nodes: this.nodes.length } satisfies TremauxMemory; // first entry is the start
  }

  private replay(j: JunctionView, mem: TremauxMemory): Choice {
    // Find the next route junction near the current position (skip none: corners are junctions too).
    let k = -1, bd = Infinity;
    for (let i = this.replayIdx; i < Math.min(mem.route.length, this.replayIdx + 4); i += 1) {
      const d = Math.hypot(mem.route[i].x - j.x, mem.route[i].y - j.y);
      if (d < bd) { bd = d; k = i; }
    }
    if (k < 0 || bd > 0.35) return { ...leftmost(j), note: `replay: no stored junction near here (${bd.toFixed(2)} m), using left-hand` };
    this.replayIdx = k + 1;
    const rel = wrap(mem.route[k].abs - j.arrivalYaw_deg);
    if (!j.branches.length) return back('replay: unexpected dead end');
    const i = j.branches.reduce((bi, a, ii) => (Math.abs(wrap(a - rel)) < Math.abs(wrap(j.branches[bi] - rel)) ? ii : bi), 0);
    return pick(j, i, `replay: shortest path step ${k + 1} of ${mem.route.length}`);
  }
}
