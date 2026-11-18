// Feature statistics of a track, measured the same way on real (imported) and generated tracks, so generated sets can
// be compared with the reference mazes.
import type { Track } from '../../src/track/track';
import type { JunctionGraph } from '../../src/track/graph';

export interface TrackStats {
  lineLength_m: number;     // total length of line
  junctions: number;        // points where 3+ lines meet
  junctions4: number;       // of those, 4+ lines
  deadEnds: number;
  cycles: number;           // independent loops
  curvedShare: number;      // share of line length that turns more than 25° per 10 cm
  shortEdges: number;       // segments between junctions shorter than 15 cm
  inkShare: number;         // share of the mat that is black
}

export function trackStats(t: Track, g: JunctionGraph): TrackStats {
  let len = 0, curved = 0, short = 0;
  for (const e of g.edges) {
    len += e.length_m;
    if (e.length_m < 0.15) short += 1;
    const p = e.pts;
    // heading change over 10 cm windows
    let acc = 0, k0 = 0;
    for (let k = 1; k < p.length; k += 1) {
      acc += Math.hypot(p[k][0] - p[k - 1][0], p[k][1] - p[k - 1][1]);
      if (acc >= 0.1 && k - k0 >= 2) {
        const m = Math.floor((k0 + k) / 2);
        const h1 = Math.atan2(p[m][1] - p[k0][1], p[m][0] - p[k0][0]), h2 = Math.atan2(p[k][1] - p[m][1], p[k][0] - p[m][0]);
        const d = Math.abs(((h2 - h1 + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
        if (d > (25 * Math.PI) / 180) curved += acc;
        acc = 0; k0 = k;
      }
    }
  }
  let j = 0, j4 = 0, de = 0;
  for (const n of g.nodes.values()) { if (n.degree >= 3) j += 1; if (n.degree >= 4) j4 += 1; if (n.degree === 1 && n.id !== g.start && n.id !== g.finish) de += 1; }
  let ink = 0; for (let i = 0; i < t.dark.length; i += 1) ink += t.dark[i];
  const nodes = [...g.nodes.values()].filter((n) => n.degree > 0).length;
  return {
    lineLength_m: +len.toFixed(2), junctions: j, junctions4: j4, deadEnds: de, cycles: g.edges.length - nodes + 1,
    curvedShare: +(curved / Math.max(len, 1e-9)).toFixed(3), shortEdges: short, inkShare: +(ink / t.dark.length).toFixed(4),
  };
}
