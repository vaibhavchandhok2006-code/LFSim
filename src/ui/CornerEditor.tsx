// Mark the mat's four corners on an angled photo by dragging numbered handles. The track is rebuilt when a handle is
// let go (rebuilding on every move would be slow).
import { useEffect, useRef, useState } from 'react';
import { quadProblem, type Quad } from '../track/warp';

const LABELS = ['1 top-left', '2 top-right', '3 bottom-right', '4 bottom-left'];

interface Props {
  imageUrl: string;
  aspect: number;                    // image width / height
  corners: [number, number][];       // % of the image
  onCommit: (c: [number, number][]) => void;
}

export function CornerEditor({ imageUrl, aspect, corners, onCommit }: Props) {
  const [pts, setPts] = useState(corners);
  const drag = useRef<number | null>(null);
  const box = useRef<SVGSVGElement>(null);
  useEffect(() => { setPts(corners); }, [corners]);
  const W = 1000, H = Math.round(1000 / aspect);
  const toSvg = ([x, y]: [number, number]) => [(x / 100) * W, (y / 100) * H];
  const problem = quadProblem(pts as Quad);

  const move = (e: React.PointerEvent) => {
    if (drag.current === null || !box.current) return;
    const r = box.current.getBoundingClientRect();
    const x = Math.max(-5, Math.min(105, ((e.clientX - r.left) / r.width) * 100));
    const y = Math.max(-5, Math.min(105, ((e.clientY - r.top) / r.height) * 100));
    setPts((p) => p.map((q, i) => (i === drag.current ? [+x.toFixed(2), +y.toFixed(2)] : q)));
  };
  const end = () => { if (drag.current !== null) { drag.current = null; if (!quadProblem(pts as Quad)) onCommit(pts); } };
  const nudge = (i: number, dx: number, dy: number) => {
    const next = pts.map((q, k) => (k === i ? [+(q[0] + dx).toFixed(2), +(q[1] + dy).toFixed(2)] as [number, number] : q));
    setPts(next);
    if (!quadProblem(next as Quad)) onCommit(next);
  };

  return (
    <div className="corner-editor">
      <svg ref={box} viewBox={`-30 -30 ${W + 60} ${H + 60}`} onPointerMove={move} onPointerUp={end} onPointerLeave={end} role="group" aria-label="Mat corners on the photo">
        <image href={imageUrl} x={0} y={0} width={W} height={H} preserveAspectRatio="none" />
        <polygon points={pts.map((p) => toSvg(p).join(',')).join(' ')} className={problem ? 'quad bad' : 'quad'} />
        {pts.map((p, i) => {
          const [x, y] = toSvg(p);
          return (
            <g key={i} className="handle" tabIndex={0} aria-label={`Corner ${LABELS[i]}: ${p[0].toFixed(1)} %, ${p[1].toFixed(1)} %. Arrow keys move it.`}
              onPointerDown={(e) => { drag.current = i; (e.currentTarget as Element).setPointerCapture?.(e.pointerId); e.preventDefault(); }}
              onKeyDown={(e) => {
                const s = e.shiftKey ? 1 : 0.2;
                if (e.key === 'ArrowLeft') nudge(i, -s, 0); else if (e.key === 'ArrowRight') nudge(i, s, 0);
                else if (e.key === 'ArrowUp') nudge(i, 0, -s); else if (e.key === 'ArrowDown') nudge(i, 0, s); else return;
                e.preventDefault();
              }}>
              <circle cx={x} cy={y} r={22} />
              <text x={x} y={y + 8}>{i + 1}</text>
            </g>
          );
        })}
      </svg>
      <p className="group-text">{problem ? problem : 'Drag 1–4 onto the mat’s corners: 1 is the corner with the start square, then go clockwise. Arrow keys fine-tune a selected handle.'}</p>
    </div>
  );
}
