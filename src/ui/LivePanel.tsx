import { useEffect, useRef, useState } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { RobotProfile } from '../sim/profile';
import { F } from '../worker/protocol';
import { RunData } from './run';

interface Props { run: RunData | null; t: number; profile: RobotProfile; frame: number }

const SENSOR_COLORS = ['#2457C5', '#1F6B47', '#B9470F', '#7C3AED', '#0E7490', '#BE185D', '#4D7C0F', '#92400E', '#1D4ED8', '#047857', '#C2410C', '#6D28D9', '#0369A1', '#9D174D', '#65A30D', '#78350F'];

export function LivePanel({ run, t, profile, frame }: Props) {
  const s = profile.sensor;
  const fi = run ? run.indexAt(t) : -1;
  const has = run !== null && fi >= 0;
  const raw = has ? run!.sensors(fi, s.channels) : new Array(s.channels).fill(s.whiteRaw);
  const max = 2 ** s.adcBits - 1;
  const highIsBlack = s.blackRaw >= s.whiteRaw;
  const g = (k: number) => (has ? run!.get(fi, k) : NaN);
  const num = (v: number, d = 2, unit = '') => (Number.isFinite(v) ? `${v.toFixed(d)}${unit}` : '—');
  const [windowS, setWindowS] = useState(5);

  return (
    <aside className="live" aria-label="Live robot data">
      <section>
        <h3>Sensors</h3>
        <div className="bars" style={{ gridTemplateColumns: `repeat(${s.channels}, 1fr)` }}>
          {raw.map((v, i) => {
            const on = highIsBlack ? v > s.threshold : v < s.threshold;
            return (
              <div className="bar-col" key={i} title={`Sensor ${i + 1}: ${v}`}>
                <span className={`led${on ? ' on' : ''}`} />
                <div className="bar"><div className="bar-fill" style={{ height: `${(v / max) * 100}%` }} /><div className="bar-th" style={{ bottom: `${(s.threshold / max) * 100}%` }} /></div>
                <span className="bar-v">{v}</span>
              </div>
            );
          })}
        </div>
        <p className="hint">Leftmost sensor first. The tick marks the threshold.</p>
      </section>

      <section>
        <h3>Robot</h3>
        <dl className="readout">
          <dt>State</dt><dd>{has ? run!.states[g(F.state)] ?? '' : 'Ready'}</dd>
          <dt>Speed</dt><dd>{num(g(F.v), 2, ' m/s')}</dd>
          <dt>Wheels L / R</dt><dd>{num(g(F.vL))} / {num(g(F.vR))} m/s</dd>
          <dt>PWM L / R</dt><dd>{num(g(F.dutyL))} / {num(g(F.dutyR))}</dd>
          <dt>Line error</dt><dd>{num(g(F.err), 1, ' mm')}</dd>
          <dt>Battery</dt><dd>{has ? num(g(F.vBatt), 2, ' V') : `${profile.battery.fullV.toFixed(2)} V`}</dd>
          <dt>Current L / R</dt><dd>{num(g(F.iL))} / {num(g(F.iR))} A</dd>
          <dt>Wheel slip</dt><dd>{has ? (g(F.slip) ? 'Skidding' : 'Gripping') : '—'}</dd>
        </dl>
      </section>

      <section>
        <div className="graph-head">
          <h3>Graphs</h3>
          <div className="speed small" role="group" aria-label="Graph window">
            {[5, 20, 0].map((w) => <button key={w} className={windowS === w ? 'on' : ''} onClick={() => setWindowS(w)}>{w ? `${w} s` : 'All'}</button>)}
          </div>
        </div>
        <Charts run={run} t={t} frame={frame} windowS={windowS} channels={s.channels} />
      </section>
    </aside>
  );
}

interface ChartDef { title: string; series: { label: string; color: string; get: (r: RunData, i: number) => number; scale?: string }[]; scales?: Record<string, { range?: [number, number] }> }

function Charts({ run, t, frame, windowS, channels }: { run: RunData | null; t: number; frame: number; windowS: number; channels: number }) {
  const defs: ChartDef[] = [
    { title: 'Line error (mm) and PID output', series: [
      { label: 'Error mm', color: '#16212C', get: (r, i) => r.get(i, F.err) },
      { label: 'PID', color: '#B9470F', get: (r, i) => r.get(i, F.pid), scale: 'pid' },
    ] },
    { title: 'Wheel speed (m/s) and PWM', series: [
      { label: 'Left m/s', color: '#2457C5', get: (r, i) => r.get(i, F.vL) },
      { label: 'Right m/s', color: '#C2410C', get: (r, i) => r.get(i, F.vR) },
      { label: 'PWM L', color: '#93B4F0', get: (r, i) => r.get(i, F.dutyL), scale: 'pwm' },
      { label: 'PWM R', color: '#F0B48F', get: (r, i) => r.get(i, F.dutyR), scale: 'pwm' },
    ] },
    { title: 'Battery (V)', series: [{ label: 'Battery V', color: '#1F6B47', get: (r, i) => r.get(i, F.vBatt) }] },
    { title: 'Raw sensors', series: Array.from({ length: channels }, (_, k) => ({ label: `S${k + 1}`, color: SENSOR_COLORS[k % SENSOR_COLORS.length], get: (r: RunData, i: number) => r.get(i, r.stride - channels + k) })) },
  ];
  return <>{defs.map((d) => <Chart key={d.title + channels} def={d} run={run} t={t} frame={frame} windowS={windowS} />)}</>;
}

function Chart({ def, run, t, frame, windowS }: { def: ChartDef; run: RunData | null; t: number; frame: number; windowS: number }) {
  const box = useRef<HTMLDivElement>(null);
  const plot = useRef<uPlot | null>(null);
  useEffect(() => {
    const el = box.current!;
    const scales: uPlot.Scales = { x: { time: false } };
    for (const s of def.series) if (s.scale) scales[s.scale] = {};
    const axes: uPlot.Axis[] = [{ size: 22, font: '10px Atkinson Hyperlegible Next', stroke: '#5B6876', grid: { stroke: '#E4E9EE' } }, { size: 40, font: '10px Atkinson Hyperlegible Next', stroke: '#5B6876', grid: { stroke: '#E4E9EE' } }];
    const extra = def.series.find((s) => s.scale);
    if (extra) axes.push({ scale: extra.scale, side: 1, size: 34, font: '10px Atkinson Hyperlegible Next', stroke: '#8794A1', grid: { show: false } });
    plot.current = new uPlot({
      width: el.clientWidth || 260, height: 110, legend: { show: true, live: false }, cursor: { show: false }, scales, axes,
      series: [{ label: 's' }, ...def.series.map((s) => ({ label: s.label, stroke: s.color, width: 1.4, scale: s.scale, points: { show: false } }))],
    }, [[], ...def.series.map(() => [])], el);
    return () => { plot.current?.destroy(); plot.current = null; };
  }, [def.series.length]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const p = plot.current; if (!p) return;
    if (!run || run.count === 0) { p.setData([[], ...def.series.map(() => [])]); return; }
    const end = run.indexAt(t);
    const startT = windowS ? t - windowS : 0;
    let start = windowS ? run.indexAt(startT) : 0;
    if (start < 0) start = 0;
    const step = Math.max(1, Math.floor((end - start) / 400));
    const xs: number[] = []; const ys = def.series.map(() => [] as (number | null)[]);
    for (let i = start; i <= end; i += step) {
      xs.push(run.get(i, F.t));
      def.series.forEach((s, k) => { const v = s.get(run, i); ys[k].push(Number.isFinite(v) ? v : null); });
    }
    p.setData([xs, ...ys] as uPlot.AlignedData);
  }, [run, t, frame, windowS, def]);

  return (
    <figure className="chart">
      <figcaption>{def.title}</figcaption>
      <div ref={box} />
    </figure>
  );
}
