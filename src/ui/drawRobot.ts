// Draws the robot from its profile in world units (metres). The caller sets up the world transform.

import { RobotProfile, sensorLateral_mm, spotDiameter_mm } from '../sim/profile';

export const COLORS = {
  bench: '#DCE3EA',
  matShadow: 'rgba(30, 45, 60, 0.18)',
  ink: '#16212C',
  inkSoft: '#5B6876',
  chassis: '#1F6B47',
  chassisEdge: '#134A30',
  silk: '#E8F2EC',
  rubber: '#23272B',
  tread: '#3A4046',
  sensorBoard: '#1B1F23',
  ledOn: '#FF3B2F',
  ledOff: '#5A2522',
  start: '#2457C5',
  finish: '#C2410C',
  off: '#D92D20',
};

export interface RobotDrawState {
  x: number; y: number; theta: number;
  angL: number; angR: number;
  leds: boolean[] | null;   // null = no readings yet
  showSpots?: boolean;
  ghost?: boolean;          // draw faded (placement preview)
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// px = screen pixels per metre, used to keep hairlines visible at any zoom.
export function drawRobot(ctx: CanvasRenderingContext2D, p: RobotProfile, s: RobotDrawState, px: number) {
  const mm = 0.001;
  const hair = 1 / px;
  ctx.save();
  ctx.translate(s.x, s.y);
  ctx.rotate(s.theta);
  if (s.ghost) ctx.globalAlpha = 0.55;
  // In robot frame: +x forward, +y towards the robot's RIGHT (image frame is y-down).

  const front = p.axleFromFront_mm * mm;
  const rear = (p.length_mm - p.axleFromFront_mm) * mm;
  const W = p.width_mm * mm;
  const halfB = (p.wheelbase_mm / 2) * mm;
  const wr = (p.wheelDiameter_mm / 2) * mm;
  const ww = p.wheelWidth_mm * mm;

  // floor spots of each sensor (where it actually looks)
  const lat = sensorLateral_mm(p.sensor).map((v) => v * mm);
  const so = p.sensorOffset_mm * mm;
  if (s.showSpots) {
    const r = (spotDiameter_mm(p.sensor) / 2) * mm;
    ctx.fillStyle = 'rgba(255, 59, 47, 0.18)';
    for (const l of lat) { ctx.beginPath(); ctx.arc(so, -l, r, 0, Math.PI * 2); ctx.fill(); }
  }

  // shadow
  ctx.fillStyle = 'rgba(20, 30, 40, 0.22)';
  roundRect(ctx, -rear + 2 * mm, -W / 2 + 3 * mm, front + rear, W, 10 * mm);
  ctx.fill();

  // chassis plate
  ctx.fillStyle = p.length_mm > 0 ? COLORS.chassis : '#999';
  ctx.strokeStyle = COLORS.chassisEdge;
  ctx.lineWidth = Math.max(hair, 1.2 * mm);
  roundRect(ctx, -rear, -W / 2, front + rear, W, 10 * mm);
  ctx.fill(); ctx.stroke();

  // silkscreen: centreline and axle mark
  ctx.strokeStyle = COLORS.silk;
  ctx.globalAlpha *= 0.5;
  ctx.lineWidth = Math.max(hair, 0.8 * mm);
  ctx.setLineDash([4 * mm, 3 * mm]);
  ctx.beginPath(); ctx.moveTo(-rear + 6 * mm, 0); ctx.lineTo(front - 6 * mm, 0); ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath(); ctx.moveTo(0, -halfB + ww); ctx.lineTo(0, halfB - ww); ctx.stroke();
  ctx.globalAlpha = s.ghost ? 0.55 : 1;

  // caster
  ctx.fillStyle = '#B8C2CC';
  ctx.strokeStyle = COLORS.ink;
  ctx.lineWidth = Math.max(hair, 0.8 * mm);
  ctx.beginPath(); ctx.arc(p.casterOffset_mm * mm, 0, 7 * mm, 0, Math.PI * 2); ctx.fill(); ctx.stroke();

  // wheels with tread marks that move with the wheel angle
  const wheel = (side: number, ang: number) => {
    const cy = side * halfB; // side +1 = right (y+), -1 = left
    ctx.fillStyle = COLORS.rubber;
    roundRect(ctx, -wr, cy - ww / 2, 2 * wr, ww, 2.5 * mm);
    ctx.fill();
    ctx.save();
    roundRect(ctx, -wr, cy - ww / 2, 2 * wr, ww, 2.5 * mm);
    ctx.clip();
    ctx.strokeStyle = COLORS.tread;
    ctx.lineWidth = Math.max(hair, 1.6 * mm);
    const pitch = 5 * mm;
    const off = ((ang * wr) % pitch + pitch) % pitch;
    for (let x = -wr - pitch + off; x < wr + pitch; x += pitch) {
      ctx.beginPath(); ctx.moveTo(-x, cy - ww / 2); ctx.lineTo(-x, cy + ww / 2); ctx.stroke();
    }
    ctx.restore();
  };
  wheel(-1, s.angL);
  wheel(1, s.angR);

  // sensor board across the front
  const span = (lat.length ? Math.max(...lat) - Math.min(...lat) : 0) + p.sensor.spacing_mm * mm;
  ctx.fillStyle = COLORS.sensorBoard;
  roundRect(ctx, so - 5 * mm, -span / 2 - 3 * mm, 10 * mm, span + 6 * mm, 2 * mm);
  ctx.fill();
  // bracket from chassis to the board if the board sits past the chassis front
  if (so - 5 * mm > front) {
    ctx.fillStyle = COLORS.chassis;
    ctx.fillRect(front - 2 * mm, -6 * mm, so - 5 * mm - front + 3 * mm, 12 * mm);
  }
  // sensors + LEDs (LED drawn just behind each sensor, like on most arrays)
  for (let i = 0; i < lat.length; i += 1) {
    const yv = -lat[i]; // + lateral = left = -y in robot frame
    ctx.fillStyle = '#E6EAEE';
    ctx.fillRect(so - 0.5 * mm, yv - 2 * mm, 3 * mm, 4 * mm);
    const on = s.leds ? s.leds[i] : false;
    if (on) {
      ctx.fillStyle = 'rgba(255, 59, 47, 0.35)';
      ctx.beginPath(); ctx.arc(so - 3 * mm, yv, 3.6 * mm, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = on ? COLORS.ledOn : COLORS.ledOff;
    ctx.beginPath(); ctx.arc(so - 3 * mm, yv, 1.6 * mm, 0, Math.PI * 2); ctx.fill();
  }

  // heading tick at the front edge
  ctx.fillStyle = COLORS.silk;
  ctx.beginPath();
  ctx.moveTo(front - 3 * mm, 0);
  ctx.lineTo(front - 11 * mm, -5 * mm);
  ctx.lineTo(front - 11 * mm, 5 * mm);
  ctx.closePath(); ctx.fill();

  ctx.restore();
}

// True if a world point is inside the robot footprint (for drag-to-place).
export function hitRobot(p: RobotProfile, pose: { x: number; y: number; theta: number }, wx: number, wy: number): boolean {
  const dx = wx - pose.x, dy = wy - pose.y;
  const c = Math.cos(-pose.theta), s = Math.sin(-pose.theta);
  const fx = dx * c - dy * s, fy = dx * s + dy * c;
  const front = Math.max(p.axleFromFront_mm, p.sensorOffset_mm + 5) / 1000;
  const rear = (p.length_mm - p.axleFromFront_mm) / 1000;
  return fx <= front && fx >= -rear && Math.abs(fy) <= p.width_mm / 2000;
}
