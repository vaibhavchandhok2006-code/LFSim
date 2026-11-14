// Exports: path image (PNG), summary report (HTML), GIF clips. CSV comes from the worker; WebM is recorded in App.

import { GIFEncoder, quantize, applyPalette } from 'gifenc';
import { RobotProfile } from '../sim/profile';
import { SettingsParams } from '../brain/settings';
import { Track } from '../track/track';
import { F } from '../worker/protocol';
import { RunData, RunSummary } from './run';

const KIND_COLOR: Record<string, string> = { L: '#1F6B47', S: '#2457C5', R: '#C2410C', B: '#7C3AED', finish: '#16212C' };

export function pathImage(track: Track, bitmap: HTMLCanvasElement, run: RunData, t: number, size = 1250): HTMLCanvasElement {
  const c = document.createElement('canvas');
  const W = track.w * track.res, H = track.h * track.res;
  const k = size / Math.max(W, H);
  c.width = Math.round(W * k); c.height = Math.round(H * k);
  const ctx = c.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0, c.width, c.height);
  ctx.save(); ctx.scale(k, k);
  const end = run.indexAt(t);
  ctx.lineWidth = 0.012; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = '#D92D20';
  ctx.beginPath();
  for (let i = 0; i <= end; i += 2) { const x = run.get(i, F.x), y = run.get(i, F.y); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
  ctx.stroke();
  for (const d of run.decisions) {
    if (d.t > t) break;
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(d.x, d.y, 0.022, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = KIND_COLOR[d.kind] ?? '#16212C'; ctx.beginPath(); ctx.arc(d.x, d.y, 0.018, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
  ctx.font = '600 13px sans-serif';
  for (const d of run.decisions) {
    if (d.t > t) break;
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
    ctx.fillText(d.kind === 'finish' ? 'F' : d.kind, d.x * k, d.y * k + 4.5);
  }
  return c;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]!));

function lineChart(run: RunData, t: number, field: number, label: string, unit: string, color: string): string {
  const end = run.indexAt(t);
  if (end < 2) return '';
  const step = Math.max(1, Math.floor(end / 500));
  const pts: [number, number][] = [];
  for (let i = 0; i <= end; i += step) { const v = run.get(i, field); if (Number.isFinite(v)) pts.push([run.get(i, F.t), v]); }
  if (pts.length < 2) return '';
  const t0 = pts[0][0], t1 = pts[pts.length - 1][0];
  let lo = Math.min(...pts.map((p) => p[1])), hi = Math.max(...pts.map((p) => p[1]));
  if (hi - lo < 1e-6) { hi += 1; lo -= 1; }
  const X = (x: number) => 50 + ((x - t0) / (t1 - t0 || 1)) * 620, Y = (y: number) => 150 - ((y - lo) / (hi - lo)) * 130;
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)} ${Y(p[1]).toFixed(1)}`).join('');
  return `<figure><figcaption>${esc(label)}</figcaption><svg viewBox="0 0 680 170" width="100%" role="img" aria-label="${esc(label)}">
    <line x1="50" y1="150" x2="670" y2="150" stroke="#CFD7DF"/><line x1="50" y1="20" x2="50" y2="150" stroke="#CFD7DF"/>
    <text x="44" y="24" text-anchor="end" font-size="10" fill="#5B6876">${hi.toFixed(2)} ${unit}</text>
    <text x="44" y="150" text-anchor="end" font-size="10" fill="#5B6876">${lo.toFixed(2)} ${unit}</text>
    <text x="50" y="166" font-size="10" fill="#5B6876">${t0.toFixed(1)} s</text><text x="670" y="166" text-anchor="end" font-size="10" fill="#5B6876">${t1.toFixed(1)} s</text>
    <path d="${d}" fill="none" stroke="${color}" stroke-width="1.4"/></svg></figure>`;
}

export function reportHtml(o: { title: string; profile: RobotProfile; settings: SettingsParams | null; codeLang: string | null; track: Track; run: RunData; t: number; pathPng: string; summary: RunSummary }): string {
  const { profile: p, run, t, summary: s } = o;
  const r = run.at(t);
  const row = (k: string, v: string) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`;
  const issues: string[] = [];
  if (r.finish === null) issues.push('The robot did not reach the finish.');
  if (r.finish !== null && !r.codeStopped) issues.push('The robot reached the finish square but its code did not recognise it and stop.');
  if (r.offLine) issues.push(`The robot left the line ${r.offLine} time(s), adding ${((r.offLine / 20) * (r.runTime ?? 0)).toFixed(2)} s of penalty.`);
  if (r.aborted) issues.push('The robot re-entered the start square, which aborts the run under the rules.');
  if (run.error) issues.push(`Error: ${run.error}`);
  const dec = run.decisions.filter((d) => d.t <= t);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(o.title)}</title>
<style>body{font-family:system-ui,sans-serif;color:#16212C;max-width:900px;margin:32px auto;padding:0 24px;line-height:1.45}
h1{font-size:24px;margin:0 0 4px}h2{font-size:17px;margin:28px 0 8px;border-bottom:1px solid #CFD7DF;padding-bottom:4px}
table{border-collapse:collapse;width:100%;font-size:13px}th,td{text-align:left;padding:4px 8px;border-bottom:1px solid #E4E9EE;vertical-align:top}
th{color:#5B6876;font-weight:600;width:40%}.grid{display:grid;grid-template-columns:1fr 1fr;gap:24px}.kpi{display:flex;gap:28px;margin:12px 0}
.kpi div{display:flex;flex-direction:column}.kpi b{font-size:22px}.kpi span{color:#5B6876;font-size:12px}img{width:100%;border:1px solid #CFD7DF}
figure{margin:12px 0}figcaption{font-size:12px;color:#5B6876}.muted{color:#5B6876;font-size:12px}@media print{body{margin:0}}</style></head><body>
<h1>${esc(o.title)}</h1><p class="muted">LFSim run report · ${esc(new Date().toLocaleString())} · track ${esc(o.track.imageName)} (${o.track.preset.width_m} × ${o.track.preset.height_m} m, ${esc(o.track.preset.name)})</p>
<div class="kpi"><div><b>${r.runTime === null ? '—' : r.runTime.toFixed(2) + ' s'}</b><span>Run time</span></div><div><b>${r.offLine}</b><span>Off the line</span></div>
<div><b>${r.score === null ? '—' : r.score.toFixed(2) + ' s'}</b><span>Time score</span></div><div><b>${r.finish !== null ? 'Yes' : 'No'}</b><span>Reached finish</span></div>
<div><b>${r.codeStopped ? 'Yes' : 'No'}</b><span>Code saw finish</span></div><div><b>${r.distance.toFixed(2)} m</b><span>Distance</span></div></div>
<h2>Issues found</h2>${issues.length ? `<ul>${issues.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : '<p>None: the robot finished cleanly.</p>'}
<h2>Path</h2><img src="${o.pathPng}" alt="Robot path on the track"><p class="muted">Dots: junction decisions (L left, S straight, R right, B back, F finish).</p>
<h2>Graphs</h2>${lineChart(run, t, F.v, 'Speed (m/s)', 'm/s', '#2457C5')}${lineChart(run, t, F.err, 'Line error (mm)', 'mm', '#16212C')}${lineChart(run, t, F.vBatt, 'Battery (V)', 'V', '#1F6B47')}
<div class="grid"><div><h2>Robot</h2><table>${row('Name', p.name)}${row('Wheelbase', `${p.wheelbase_mm} mm`)}${row('Sensor offset', `${p.sensorOffset_mm} mm`)}${row('Wheel diameter', `${p.wheelDiameter_mm} mm`)}
${row('Size', `${p.length_mm} × ${p.width_mm} mm`)}${row('Sensors', `${p.sensor.channels} × ${p.sensor.spacing_mm} mm at ${p.sensor.height_mm} mm height`)}${row('Motors', `${p.motor.noLoadRpm} rpm, ${p.motor.stallTorque_kgcm} kg·cm at ${p.motor.ratedV} V`)}
${row('Driver', p.driver)}${row('Battery', `${p.battery.fullV} V full, ${p.battery.capacity_mAh} mAh`)}${row('Mass', `${p.mass_g} g`)}${row('Grip', String(p.grip))}</table></div>
<div><h2>Brain</h2><table>${o.settings ? `${row('Mode', 'Settings')}${row('Algorithm', s.algorithm)}${row('Kp / Ki / Kd', `${o.settings.kp} / ${o.settings.ki} / ${o.settings.kd}`)}${row('Loop rate', `${o.settings.loopHz} Hz`)}
${row('Base / max / turn speed', `${o.settings.baseSpeed} / ${o.settings.maxSpeed} / ${o.settings.turnSpeed}`)}${row('Inch forward', `${o.settings.inchForward_cm} cm`)}${row('Finish: black for', `${o.settings.finishBlack_cm} cm`)}` : `${row('Mode', 'Code')}${row('Firmware', o.codeLang ?? '')}`}
${row('Memory run', s.memoryRun ? 'Yes' : 'No')}</table></div></div>
<h2>Junction decisions (${dec.length})</h2><table><tr><th>Time</th><th>Decision</th></tr>${dec.map((d) => `<tr><td>${d.t.toFixed(2)} s</td><td>${esc(d.kind)} · branches ${esc(d.branches_deg.join(', ') || 'none')} → ${d.chosen_deg ?? '—'}° · ${esc(d.note)}</td></tr>`).join('')}</table>
<h2>Events</h2><table>${run.events.filter((e) => e.t <= t).map((e) => `<tr><td>${e.t.toFixed(2)} s</td><td>${esc(e.text)}</td></tr>`).join('')}</table>
</body></html>`;
}

// Short GIF clip from successive canvas snapshots.
export class GifClip {
  private enc = GIFEncoder();
  private w: number; private h: number;
  private c: HTMLCanvasElement;
  frames = 0;
  constructor(width = 480, aspect = 0.75) {
    this.w = width; this.h = Math.round(width * aspect);
    this.c = document.createElement('canvas'); this.c.width = this.w; this.c.height = this.h;
  }
  add(src: HTMLCanvasElement, delayMs: number) {
    const ctx = this.c.getContext('2d', { willReadFrequently: true })!;
    const s = Math.min(this.w / src.width, this.h / src.height);
    ctx.fillStyle = '#DCE3EA'; ctx.fillRect(0, 0, this.w, this.h);
    ctx.drawImage(src, (this.w - src.width * s) / 2, (this.h - src.height * s) / 2, src.width * s, src.height * s);
    const data = ctx.getImageData(0, 0, this.w, this.h).data;
    const palette = quantize(data, 128);
    this.enc.writeFrame(applyPalette(data, palette), this.w, this.h, { palette, delay: delayMs });
    this.frames += 1;
  }
  finish(): Blob { this.enc.finish(); return new Blob([new Uint8Array(this.enc.bytes())], { type: "image/gif" }); }
}
