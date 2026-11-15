import { useEffect, useRef, useState } from 'react';
import { RunData } from './run';
import { F } from '../worker/protocol';
import { RobotProfile } from '../sim/profile';
import { Pose, Track } from '../track/track';
import { COLORS, drawRobot, hitRobot } from './drawRobot';

export interface ViewOptions { follow: boolean; grid: boolean; trail: boolean; spots: boolean; ideal: boolean; decisions: boolean }

export interface Overlay { points: [number, number][]; color: string; label: string; dashed?: boolean }

interface Props {
  track: Track | null;
  bitmap: HTMLCanvasElement | null;
  run: RunData | null;
  t: number;                     // playback time
  profile: RobotProfile;
  overlays: Overlay[];           // ideal path, compared runs
  folds: { horizontal: boolean; pos: number; width: number }[];
  canvasRef?: (c: HTMLCanvasElement | null) => void;
  pose: Pose;                    // start pose (shown when no sim has run)
  editable: boolean;             // robot can be dragged
  onPoseChange: (p: Pose) => void;
  view: ViewOptions;
  frame: number;                 // bump to redraw
  mode: 'track' | 'robot';
}

interface Cam { cx: number; cy: number; scale: number }

// Text is drawn in screen pixels at a world point, so it stays readable at any zoom.
function screenText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, size = 12, weight = 600, align: CanvasTextAlign = 'left') {
  const pt = ctx.getTransform().transformPoint(new DOMPoint(x, y));
  const dpr = window.devicePixelRatio || 1;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.font = `${weight} ${size * dpr}px "Atkinson Hyperlegible Next", sans-serif`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.fillText(text, pt.x, pt.y);
  ctx.restore();
}

function speedColor(v: number, vmax: number): string {
  const t = Math.max(0, Math.min(1, Math.abs(v) / Math.max(0.05, vmax)));
  // slow = deep blue, fast = amber
  const a = [36, 87, 197], b = [217, 119, 6];
  const c = a.map((x, i) => Math.round(x + (b[i] - x) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

export function Viewport(props: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const cam = useRef<Cam>({ cx: 1.25, cy: 1.25, scale: 300 });
  const fitted = useRef<string>('');
  const drag = useRef<{ kind: 'pan' | 'move' | 'rotate'; sx: number; sy: number; cam: Cam; pose: Pose } | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const [, setTick] = useState(0);
  const force = () => setTick((t) => t + 1);
  const forceRef = useRef(force);
  forceRef.current = force;

  const toWorld = (ev: { clientX: number; clientY: number }) => {
    const c = ref.current!; const r = c.getBoundingClientRect();
    const k = cam.current;
    return [k.cx + (ev.clientX - r.left - r.width / 2) / k.scale, k.cy + (ev.clientY - r.top - r.height / 2) / k.scale];
  };

  const fit = () => {
    const c = ref.current; if (!c) return;
    const r = c.getBoundingClientRect();
    const p = latest.current;
    if (p.mode === 'robot') {
      const L = Math.max(p.profile.length_mm, p.profile.sensorOffset_mm + 20, p.profile.width_mm) / 1000;
      cam.current = { cx: p.pose.x + 0.02, cy: p.pose.y, scale: Math.min(r.width, r.height) / (L * 1.6) };
    } else if (p.track) {
      const W = p.track.w * p.track.res, H = p.track.h * p.track.res;
      cam.current = { cx: W / 2, cy: H / 2, scale: Math.min(r.width / (W * 1.06), r.height / (H * 1.06)) };
    }
  };

  // draw
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const r = c.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== Math.round(r.width * dpr) || c.height !== Math.round(r.height * dpr)) {
      c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr);
    }
    const key = `${props.mode}:${props.track?.imageName}:${props.track?.w}:${props.track?.preset.id}:${Math.round(r.width / 40)}:${Math.round(r.height / 40)}`;
    if (fitted.current !== key) { fitted.current = key; fit(); }
    const ctx = c.getContext('2d')!;
    const { track, bitmap, run, profile, view, t } = props;
    const k = cam.current;
    const fi = run ? run.indexAt(t) : -1;
    const has = run !== null && fi >= 0;
    const pose = has ? { x: run!.get(fi, F.x), y: run!.get(fi, F.y), theta: run!.get(fi, F.theta) } : props.pose;
    if (view.follow && has && props.mode === 'track') {
      k.cx += (pose.x - k.cx) * 0.15; k.cy += (pose.y - k.cy) * 0.15;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = getComputedStyle(c).getPropertyValue('--bench').trim() || COLORS.bench;
    ctx.fillRect(0, 0, r.width, r.height);
    ctx.setTransform(dpr * k.scale, 0, 0, dpr * k.scale, dpr * (r.width / 2 - k.cx * k.scale), dpr * (r.height / 2 - k.cy * k.scale));
    const px = k.scale;

    if (props.mode === 'robot') {
      // engineering grid behind the robot, 10 mm
      ctx.strokeStyle = 'rgba(22,33,44,0.08)';
      ctx.lineWidth = 1 / px;
      const g = 0.01, x0 = k.cx - r.width / 2 / px, x1 = k.cx + r.width / 2 / px, y0 = k.cy - r.height / 2 / px, y1 = k.cy + r.height / 2 / px;
      for (let x = Math.floor(x0 / g) * g; x < x1; x += g) { ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.stroke(); }
      for (let y = Math.floor(y0 / g) * g; y < y1; y += g) { ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke(); }
      drawRobot(ctx, profile, { ...pose, angL: 0, angR: 0, leds: null, showSpots: true }, px);
      drawDims(ctx, profile, pose, px);
      return;
    }

    if (track && bitmap) {
      const W = track.w * track.res, H = track.h * track.res;
      ctx.fillStyle = COLORS.matShadow;
      ctx.fillRect(0.006, 0.01, W, H);
      ctx.imageSmoothingEnabled = k.scale * track.res < 2;
      ctx.drawImage(bitmap, 0, 0, W, H);
      if (view.grid) {
        ctx.strokeStyle = 'rgba(36,87,197,0.16)';
        ctx.lineWidth = 1 / px;
        const step = track.preset.id === 'roborun' ? 0.25 : 0.1;
        for (let x = 0; x <= W + 1e-9; x += step) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
        for (let y = 0; y <= H + 1e-9; y += step) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
      }
      const box = (rect: NonNullable<Track['start']>, color: string, label: string) => {
        ctx.strokeStyle = color; ctx.lineWidth = 2.5 / px;
        ctx.strokeRect(rect.x0 * track.res, rect.y0 * track.res, (rect.x1 - rect.x0) * track.res, (rect.y1 - rect.y0) * track.res);
        screenText(ctx, label, rect.x0 * track.res, rect.y0 * track.res - 6 / px, color, 13);
      };
      if (track.start) box(track.start, COLORS.start, 'Start');
      if (track.finish) box(track.finish, COLORS.finish, 'Finish');
    }

    if (track) {
      for (const f of props.folds) {
        ctx.fillStyle = 'rgba(185, 71, 15, 0.08)';
        const W = track.w * track.res, H = track.h * track.res;
        if (f.horizontal) ctx.fillRect(0, f.pos - f.width / 2, W, f.width); else ctx.fillRect(f.pos - f.width / 2, 0, f.width, H);
      }
    }
    for (const o of props.overlays) {
      if (o.points.length < 2) continue;
      ctx.strokeStyle = o.color; ctx.lineWidth = 3 / px; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.setLineDash(o.dashed ? [8 / px, 6 / px] : []);
      ctx.beginPath(); ctx.moveTo(o.points[0][0], o.points[0][1]);
      for (const q of o.points.slice(1)) ctx.lineTo(q[0], q[1]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (has && view.trail && fi > 0) {
      const r0 = run!;
      const vmax = 1.2;
      ctx.lineCap = 'round';
      ctx.lineWidth = 4 / px;
      const step = Math.max(1, Math.floor(r0.frameHz / 50));
      let prev = 0;
      for (let i = step; i <= fi; i += step) {
        ctx.strokeStyle = r0.get(i, F.off) ? COLORS.off : speedColor(r0.get(i, F.v), vmax);
        ctx.beginPath(); ctx.moveTo(r0.get(prev, F.x), r0.get(prev, F.y)); ctx.lineTo(r0.get(i, F.x), r0.get(i, F.y)); ctx.stroke();
        prev = i;
      }
      for (const e of r0.events) {
        if (e.t > t) break;
        if (e.kind === 'offline' || e.kind === 'code-stopped') {
          ctx.strokeStyle = COLORS.off; ctx.lineWidth = 2.5 / px;
          const d = 7 / px;
          ctx.beginPath(); ctx.moveTo(e.x - d, e.y - d); ctx.lineTo(e.x + d, e.y + d); ctx.moveTo(e.x + d, e.y - d); ctx.lineTo(e.x - d, e.y + d); ctx.stroke();
        }
      }
      if (view.decisions) {
        const col: Record<string, string> = { L: '#1F6B47', S: '#2457C5', R: '#C2410C', B: '#7C3AED', finish: '#16212C' };
        for (const d of r0.decisions) {
          if (d.t > t) break;
          ctx.fillStyle = '#fff';
          ctx.beginPath(); ctx.arc(d.x, d.y, 9 / px, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = col[d.kind] ?? '#16212C';
          ctx.beginPath(); ctx.arc(d.x, d.y, 7.5 / px, 0, Math.PI * 2); ctx.fill();
          screenText(ctx, d.kind === 'finish' ? 'F' : d.kind, d.x, d.y + 3.5 / px, '#fff', 10, 700, 'center');
        }
      }
    }

    const n = profile.sensor.channels;
    const leds = has ? run!.sensors(fi, n).map((v) => (profile.sensor.blackRaw >= profile.sensor.whiteRaw ? v > profile.sensor.threshold : v < profile.sensor.threshold)) : null;
    drawRobot(ctx, profile, {
      ...pose, angL: has ? run!.get(fi, F.angL) : 0, angR: has ? run!.get(fi, F.angR) : 0, leds,
      showSpots: view.spots, ghost: !has && props.editable,
    }, px);
  });

  // interaction: wheel zoom, drag to pan, drag robot to place (Shift = rotate)
  useEffect(() => {
    const c = ref.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const [wx, wy] = toWorld(e);
      const k = cam.current;
      const f = Math.exp(-e.deltaY * 0.0015);
      const ns = Math.max(40, Math.min(20000, k.scale * f));
      k.cx = wx - (wx - k.cx) * (k.scale / ns);
      k.cy = wy - (wy - k.cy) * (k.scale / ns);
      k.scale = ns;
      forceRef.current();
    };
    c.addEventListener('wheel', onWheel, { passive: false });
    return () => c.removeEventListener('wheel', onWheel);
  }, []);

  const onDown = (e: React.PointerEvent) => {
    const p = latest.current;
    const [wx, wy] = toWorld(e);
    let kind: 'pan' | 'move' | 'rotate' = 'pan';
    if (p.editable && p.mode === 'track' && hitRobot(p.profile, p.pose, wx, wy)) kind = e.shiftKey ? 'rotate' : 'move';
    drag.current = { kind, sx: e.clientX, sy: e.clientY, cam: { ...cam.current }, pose: { ...p.pose } };
    (e.target as Element).setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current; if (!d) return;
    const p = latest.current;
    if (d.kind === 'pan') {
      cam.current.cx = d.cam.cx - (e.clientX - d.sx) / d.cam.scale;
      cam.current.cy = d.cam.cy - (e.clientY - d.sy) / d.cam.scale;
      force();
    } else if (d.kind === 'move') {
      p.onPoseChange({ ...d.pose, x: d.pose.x + (e.clientX - d.sx) / cam.current.scale, y: d.pose.y + (e.clientY - d.sy) / cam.current.scale });
    } else {
      const [wx, wy] = toWorld(e);
      p.onPoseChange({ ...d.pose, theta: Math.atan2(wy - d.pose.y, wx - d.pose.x) });
    }
  };
  const onUp = () => { drag.current = null; };

  return (
    <div className="viewport">
      <canvas
        ref={(c) => { (ref as { current: HTMLCanvasElement | null }).current = c; props.canvasRef?.(c); }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onDoubleClick={() => { fit(); force(); }}
        aria-label={props.mode === 'robot' ? 'Robot top view' : 'Track and robot'}
      />
      <div className="viewport-hint">
        {props.mode === 'robot'
          ? 'Drawn to scale from your dimensions. Scroll to zoom, double-click to fit.'
          : props.editable
            ? 'Drag the robot to place it, Shift-drag to turn it. Scroll to zoom, drag the mat to pan.'
            : 'Scroll to zoom, drag to pan, double-click to fit.'}
      </div>
    </div>
  );
}

function drawDims(ctx: CanvasRenderingContext2D, p: RobotProfile, pose: Pose, px: number) {
  const mm = 0.001;
  ctx.save();
  ctx.translate(pose.x, pose.y); ctx.rotate(pose.theta);
  ctx.strokeStyle = COLORS.start; ctx.fillStyle = COLORS.start;
  ctx.lineWidth = 1.2 / px;
  const dim = (x0: number, y0: number, x1: number, y1: number, text: string, off: number) => {
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    const t = 4 / px;
    const ang = Math.atan2(y1 - y0, x1 - x0) + Math.PI / 2;
    for (const [x, y] of [[x0, y0], [x1, y1]]) { ctx.beginPath(); ctx.moveTo(x - Math.cos(ang) * t, y - Math.sin(ang) * t); ctx.lineTo(x + Math.cos(ang) * t, y + Math.sin(ang) * t); ctx.stroke(); }
    screenText(ctx, text, (x0 + x1) / 2 + Math.cos(ang) * off, (y0 + y1) / 2 + Math.sin(ang) * off + 4 / px, COLORS.start, 12, 600, 'center');
  };
  const W = p.width_mm * mm, front = p.axleFromFront_mm * mm, rear = (p.length_mm - p.axleFromFront_mm) * mm;
  dim(-rear - 14 * mm, -p.wheelbase_mm * mm / 2, -rear - 14 * mm, p.wheelbase_mm * mm / 2, `wheelbase ${p.wheelbase_mm} mm`, 0);
  dim(0, W / 2 + 14 * mm, p.sensorOffset_mm * mm, W / 2 + 14 * mm, `sensor offset ${p.sensorOffset_mm} mm`, 14 / px);
  dim(-rear, -W / 2 - 14 * mm, front, -W / 2 - 14 * mm, `length ${p.length_mm} mm`, -14 / px);
  ctx.restore();
}
