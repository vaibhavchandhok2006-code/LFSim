import { describe, expect, it } from 'vitest';
import { loadGridMaze, loadSampleTrack } from '../testutil';
import { Simulation } from '../sim/simulation';
import { DEFAULT_PROFILE } from '../sim/profile';
import { Algorithm, DEFAULT_SETTINGS, SettingsBrain, SettingsParams } from './settings';
import { Track } from '../track/track';
import { adjacency, buildGraph, runRule, turnAngle } from '../track/graph';

// Physical runs: the simulated robot (default profile, Settings mode) reads junctions only from its own sensors and
// odometry. Results are compared with the junction graph of the same image (reference, never shown to the brain).

function run(t: Track, prm: Partial<SettingsParams>, maxSeconds: number, memory: Record<string, unknown> = {}) {
  const sim = new Simulation(t, DEFAULT_PROFILE, new SettingsBrain({ ...DEFAULT_SETTINGS, ...prm }), undefined, undefined, memory);
  for (let k = 0; k < maxSeconds * 10 && !(sim.finishTime !== null && sim.brain.finished()); k += 1) sim.advance(0.1);
  return sim;
}
const junctionDecisions = (s: Simulation) => s.decisions.filter((d) => d.kind === 'B' || d.branches_deg.length >= 2).length;
const crossings = (s: Simulation) => s.events.filter((e) => e.kind === 'offline' && e.text.includes('crossed white')).length;

describe('clean grid maze: every algorithm reaches the finish like the graph says', () => {
  const t = loadGridMaze();
  const g = buildGraph(t);
  const ref = { left: runRule(g, 'left'), right: runRule(g, 'right') };

  it('the reference routes exist', () => {
    expect(ref.left.ok).toBe(true);
    expect(ref.right.ok).toBe(true);
  });

  for (const [alg, rule] of [['left-hand', 'left'], ['right-hand', 'right']] as const) {
    it(`${alg}: finishes, recognises the finish, same junction count and within 6 % of the graph distance`, () => {
      const s = run(t, { algorithm: alg }, 200);
      expect(s.finishTime).not.toBeNull();
      expect(s.brain.finished()).toBe(true);
      expect(s.events.some((e) => e.kind === 'brain-finished')).toBe(true);
      expect(s.offLineCount).toBe(0);
      const graphDecisions = ref[rule].decisions.length;
      expect(junctionDecisions(s)).toBe(graphDecisions);
      expect(Math.abs(s.distance - ref[rule].length_m) / ref[rule].length_m).toBeLessThan(0.06);
    }, 120000);
  }

  it('straight-first and Trémaux finish; LSRB run 2 replays and is faster; Trémaux run 2 is no longer', () => {
    expect(run(t, { algorithm: 'straight-first' }, 200).finishTime).not.toBeNull();
    const mem: Record<string, unknown> = {};
    const l1 = run(t, { algorithm: 'lsrb' }, 200, mem);
    expect(l1.finishTime).not.toBeNull();
    expect((mem.lsrb as { complete: boolean }).complete).toBe(true);
    const l2 = run(t, { algorithm: 'lsrb' }, 200, mem);
    expect(l2.finishTime).not.toBeNull();
    expect(l2.runTime()!).toBeLessThan(l1.runTime()!);
    expect(l2.decisions[0].note).toContain('replay');
    const tm: Record<string, unknown> = {};
    const t1 = run(t, { algorithm: 'tremaux' }, 200, tm);
    expect(t1.finishTime).not.toBeNull();
    const t2 = run(t, { algorithm: 'tremaux' }, 200, tm);
    expect(t2.finishTime).not.toBeNull();
    expect(t2.distance).toBeLessThanOrEqual(t1.distance * 1.02);
  }, 300000);

  // The test report's sweep: the outcome must not depend on speed or loop rate. At base 0.7 the default PID gains can
  // no longer hold the line (off-line moments are counted, as on a real robot) — that is a tuning limit, not tested.
  for (const baseSpeed of [0.3, 0.5]) for (const loopHz of [100, 500, 1000]) {
    it(`left-hand outcome is stable at base ${baseSpeed}, ${loopHz} Hz`, () => {
      const s = run(t, { algorithm: 'left-hand', baseSpeed, loopHz }, 200);
      expect(s.finishTime).not.toBeNull();
      expect(Math.abs(junctionDecisions(s) - ref.left.decisions.length)).toBeLessThanOrEqual(1);
      expect(crossings(s)).toBe(0);
    }, 120000);
  }
});

describe('Robo-Run sample: the robot reads junctions honestly', () => {
  const t = loadSampleTrack();

  // Every junction approached along a straight run of line: the reading (branch count and directions) and the turn the
  // robot then makes are checked against the graph.
  it('reads at least 88 % of junctions right on straight approaches and turns onto the chosen branch', () => {
    const g = buildGraph(t), adj = adjacency(g);
    const off = DEFAULT_PROFILE.sensorOffset_mm / 1000;
    const edgeAt = (x: number, y: number) => { let be = -1, bd = 1e9; for (const e of g.edges) for (const p of e.pts) { const d = Math.hypot(p[0] - x, p[1] - y); if (d < bd) { bd = d; be = e.id; } } return be; };
    let n = 0, readOk = 0, turnBad = 0;
    for (const [id, node] of g.nodes) {
      if (node.degree < 3) continue;
      for (const inc of adj.get(id)!) {
        const e = g.edges[inc.edge];
        const q = inc.dir > 0 ? e.pts : [...e.pts].reverse();
        let k = -1;
        for (const want of [0.22, 0.2, 0.18, 0.16, 0.14]) {
          let acc = 0, kk = 1;
          for (; kk < q.length; kk += 1) { acc += Math.hypot(q[kk][0] - q[kk - 1][0], q[kk][1] - q[kk - 1][1]); if (acc >= want) break; }
          if (acc < want || kk >= q.length - 1) continue;
          const ax = q[kk][0] - q[0][0], ay = q[kk][1] - q[0][1], L = Math.hypot(ax, ay);
          let dev = 0; for (let j = 0; j <= kk; j += 1) dev = Math.max(dev, Math.abs(((q[j][0] - q[0][0]) * ay - (q[j][1] - q[0][1]) * ax) / L));
          if (dev < 0.006) { k = kk; break; }
        }
        if (k < 0) continue;
        const tr = { ...t, startPose: { x: q[k][0], y: q[k][1], theta: Math.atan2(q[0][1] - q[k][1], q[0][0] - q[k][0]) } };
        const s = new Simulation(tr, DEFAULT_PROFILE, new SettingsBrain({ ...DEFAULT_SETTINGS, algorithm: 'left-hand' }));
        let dec = null as Simulation['decisions'][number] | null;
        for (let i = 0; i < 400 && !dec; i += 1) { s.advance(0.01); dec = s.decisions.find((d) => d.kind !== 'finish') ?? null; }
        n += 1;
        if (!dec) continue;
        const truth = adj.get(id)!.filter((o) => !(o.edge === inc.edge && o.dir === inc.dir))
          .map((o) => ({ o, t: turnAngle(g, inc.edge, (-inc.dir) as 1 | -1, o.edge, o.dir) })).sort((a, b) => b.t - a.t);
        const got = dec.branches_deg;
        if (!(got.length === truth.length && truth.every((x, i) => Math.abs(x.t - got[i]) < 35))) continue;
        readOk += 1;
        let following = 0;
        for (let i = 0; i < 300 && following <= 8; i += 1) { s.advance(0.01); following = s.brain.state() === 'Following line' ? following + 1 : 0; }
        const b = (s as unknown as { body: { x: number; y: number; theta: number } }).body;
        if (edgeAt(b.x + off * Math.cos(b.theta), b.y + off * Math.sin(b.theta)) !== truth[0].o.edge) turnBad += 1;
      }
    }
    expect(n).toBeGreaterThan(50);
    expect(readOk / n).toBeGreaterThanOrEqual(0.88);
    expect(turnBad / readOk).toBeLessThanOrEqual(0.03);
  }, 300000);

  // No look-around scan: the robot never turns onto a line that is not joined to the junction. If its code stops it
  // anywhere but the finish (e.g. it took the start square for the finish after odometry drift), the simulator says so
  // and does not count it as a finish.
  for (const algorithm of ['left-hand', 'right-hand', 'tremaux'] as Algorithm[]) {
    it(`${algorithm}: no crossing of white to another line in 90 s; a stop away from the finish is reported as such`, () => {
      const s = run(t, { algorithm }, 90);
      expect(crossings(s)).toBe(0);
      for (const e of s.events.filter((x) => x.kind === 'code-stopped')) expect(e.text).toContain('not at the finish');
      if (s.events.some((x) => x.kind === 'code-stopped')) expect(s.events.some((x) => x.kind === 'brain-finished')).toBe(false);
    }, 120000);
  }

  it('straight-first gets stuck circling (does not reach the finish in 2 minutes)', () => {
    const s = run(t, { algorithm: 'straight-first' }, 120);
    expect(s.finishTime).toBeNull();
  }, 120000);

  it('the brain never receives the track: its IO has no track, graph or finish fields', () => {
    const s = run(t, { algorithm: 'left-hand' }, 0.01);
    const io = (s as unknown as { io: Record<string, unknown> }).io;
    for (const k of Object.keys(io)) expect(['track', 'graph', 'finish', 'start']).not.toContain(k);
  });
});
