// Judge for "cutting across white to another line" (spec: off-line, counted). The judge, not the robot, may use the
// track's junction graph. It follows which line segment the axle centre is on; switching to a segment that is not
// joined to the previous one at a junction near the robot, or jumping along the same segment much further than the
// robot moved, means the robot crossed white to reach it.

import { Track } from '../track/track';
import { JunctionGraph } from '../track/graph';

const NEAR_LINE_M = 0.025;   // the axle counts as "on" a segment within this distance of its centre line
const JUNCTION_M = 0.1;      // a junction joins two segments if the axle is within this distance of it
const CLUSTER_EDGE_M = 0.12; // junction nodes joined by edges shorter than this count as one junction

export class ShortcutJudge {
  private readonly label: Int32Array;      // per track pixel: edge index + 1, 0 = none
  private readonly along: Float32Array;    // per track pixel: distance along that edge (m)
  private readonly g: JunctionGraph;
  private readonly t: Track;
  private lastEdge = -1;
  private lastAlong = 0;
  private lastX = 0; private lastY = 0;
  private moved = 0;                       // axle distance since lastEdge/lastAlong were set

  constructor(track: Track, graph: JunctionGraph) {
    this.t = track; this.g = graph;
    const n = track.w * track.h;
    this.label = new Int32Array(n);
    this.along = new Float32Array(n);
    graph.edges.forEach((e, i) => {
      let s = 0;
      for (let k = 0; k < e.pts.length; k += 1) {
        if (k > 0) s += Math.hypot(e.pts[k][0] - e.pts[k - 1][0], e.pts[k][1] - e.pts[k - 1][1]);
        const px = Math.round(e.pts[k][0] / track.res), py = Math.round(e.pts[k][1] / track.res);
        if (px < 0 || py < 0 || px >= track.w || py >= track.h) continue;
        this.label[py * track.w + px] = i + 1;
        this.along[py * track.w + px] = s;
      }
    });
  }

  private nearest(x: number, y: number): { edge: number; along: number } | null {
    const t = this.t, R = Math.ceil(NEAR_LINE_M / t.res);
    const cx = Math.round(x / t.res), cy = Math.round(y / t.res);
    let best = R * R + 1, edge = -1, along = 0;
    for (let dy = -R; dy <= R; dy += 1) {
      const yy = cy + dy; if (yy < 0 || yy >= t.h) continue;
      for (let dx = -R; dx <= R; dx += 1) {
        const xx = cx + dx; if (xx < 0 || xx >= t.w) continue;
        const d2 = dx * dx + dy * dy;
        const l = this.label[yy * t.w + xx];
        if (l && d2 < best) { best = d2; edge = l - 1; along = this.along[yy * t.w + xx]; }
      }
    }
    return edge < 0 ? null : { edge, along };
  }

  // Junction nodes within reach of the axle, grown across very short edges (merged junctions).
  private junctionCluster(x: number, y: number): Set<number> {
    const set = new Set<number>();
    for (const n of this.g.nodes.values()) if (Math.hypot(n.x - x, n.y - y) < JUNCTION_M) set.add(n.id);
    let grew = true;
    while (grew) {
      grew = false;
      for (const e of this.g.edges) {
        if (e.length_m >= CLUSTER_EDGE_M) continue;
        if (set.has(e.a) && !set.has(e.b)) { set.add(e.b); grew = true; }
        if (set.has(e.b) && !set.has(e.a)) { set.add(e.a); grew = true; }
      }
    }
    return set;
  }

  // Call regularly with the axle position. Returns true when the robot has just reached a line it is not connected to.
  onLine = false; // true when the last update found the axle on a segment

  update(x: number, y: number, ignore: boolean): boolean {
    this.moved += Math.hypot(x - this.lastX, y - this.lastY);
    this.lastX = x; this.lastY = y;
    if (ignore) { this.lastEdge = -1; this.onLine = false; return false; }
    const hit = this.nearest(x, y);
    this.onLine = hit !== null;
    if (!hit) return false; // over white: keep the last segment
    if (this.lastEdge < 0) { this.set(hit); return false; }
    let shortcut = false;
    if (hit.edge !== this.lastEdge) {
      const a = this.g.edges[this.lastEdge], b = this.g.edges[hit.edge];
      const cluster = this.junctionCluster(x, y);
      const joined = (cluster.has(a.a) || cluster.has(a.b)) && (cluster.has(b.a) || cluster.has(b.b));
      shortcut = !joined;
    } else {
      // Same segment: a jump along it much longer than the robot moved means it cut across a loop or hairpin.
      const e = this.g.edges[hit.edge];
      let jump = Math.abs(hit.along - this.lastAlong);
      if (e.a === e.b) jump = Math.min(jump, e.length_m - jump); // a closed loop: along wraps round
      shortcut = jump > 2 * this.moved + 0.1;
    }
    this.set(hit);
    return shortcut;
  }

  private set(hit: { edge: number; along: number }) { this.lastEdge = hit.edge; this.lastAlong = hit.along; this.moved = 0; }
}
